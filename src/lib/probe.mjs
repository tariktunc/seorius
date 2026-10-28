// User-started network probes (broken-link check, image byte size, cross-origin sitemaps), shared by
// the injected inspector (page context, CORS mode) and the report page (extension context, after the
// optional host permission is granted, so other sites' responses are readable without CORS).
// The safety policy (MODEL.md section 3) is the same on both paths: skipReason() first, HEAD then
// GET, no credentials, concurrency limit, interpretProbe() for the verdict. Only fetchImpl and
// "corsBound" differ. corsBound = a failed cross-origin request may just be a CORS block, so it is
// reported "not checked" rather than as a network error.

import { skipReason, interpretProbe } from './links.mjs';
import { parseSitemap, isListed } from './sitemap.mjs';

const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };

/**
 * Path selection. Same-origin URLs stay in the page (as before). Cross-origin URLs go to the
 * extension page when the optional host permission is granted, otherwise they stay in the page
 * and depend on the target's CORS headers.
 */
export function splitProbeTargets(urls, pageUrl, granted) {
  const po = originOf(pageUrl);
  const inPage = []; const fromExtension = [];
  for (const u of urls) (granted && originOf(u) !== po ? fromExtension : inPage).push(u);
  return { inPage, fromExtension };
}

export async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

async function timed(fetchImpl, url, init, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return { res: await fetchImpl(url, { credentials: 'omit', cache: 'no-store', redirect: 'follow', ...init, signal: ctl.signal }), ctl }; } finally { clearTimeout(t); }
}

/** opts: { fetchImpl, pageUrl, timeoutMs, corsBound } */
export function makeProbe({ fetchImpl, pageUrl, timeoutMs = 10000, corsBound = true }) {
  const po = originOf(pageUrl);
  return async function probe(url, method = 'HEAD') {
    const crossOrigin = corsBound && originOf(url) !== po;
    const once = async (m) => {
      const { res, ctl } = await timed(fetchImpl, url, { method: m, mode: 'cors' }, timeoutMs);
      const h = (n) => res.headers.get(n);
      const r = { status: res.status, redirected: res.redirected, finalUrl: res.url, challenge: h('cf-mitigated') === 'challenge', contentLength: h('content-length') ? Number(h('content-length')) : null, contentType: h('content-type'), crossOrigin };
      if (m === 'GET') try { ctl.abort(); } catch { /* ignore */ }
      return r;
    };
    try {
      let r = await once(method);
      if (method === 'HEAD' && (r.status === 405 || r.status === 501)) r = await once('GET');
      return r;
    } catch (e) {
      if (method === 'HEAD' && !crossOrigin) { try { return await once('GET'); } catch { /* fall through */ } }
      return { error: String(e && e.message || e), crossOrigin };
    }
  };
}

/** opts: { fetchImpl, pageUrl, timeoutMs, concurrency, corsBound } -> [{url, status, ...}] */
export function checkLinksWith(urls, opts) {
  const probe = makeProbe(opts);
  return pool(urls, opts.concurrency, async (u) => {
    const skip = skipReason(u, opts.pageUrl);
    if (skip) return { url: u, status: 'skipped', reason: skip };
    return { url: u, ...interpretProbe(await probe(u, 'HEAD'), u) };
  });
}

export function measureImagesWith(urls, opts) {
  const probe = makeProbe(opts);
  return pool(urls, opts.concurrency, async (u) => {
    if (/^data:/i.test(u)) return { url: u, bytes: Math.round((u.length - u.indexOf(',') - 1) * 0.75), source: 'data-url' };
    const skip = skipReason(u, opts.pageUrl);
    if (skip) return { url: u, bytes: null, source: null, reason: skip };
    const p = await probe(u, 'HEAD');
    if (p.error) return { url: u, bytes: null, source: null, reason: p.crossOrigin ? 'cross-origin-unreadable' : 'network-error' };
    return { url: u, bytes: p.contentLength, source: p.contentLength !== null ? 'content-length' : null, contentType: p.contentType, http: p.status, reason: p.contentLength === null ? 'no-content-length' : null };
  });
}

/**
 * Sitemaps declared in robots.txt on another host. Same skip policy as links; a sitemap index is
 * followed for at most childCap children. opts: { fetchImpl, pageUrl, timeoutMs, maxBytes, urlCap, childCap }
 * -> [{url, ok, status, type, urlCount, listed, error, reason}]
 */
export async function checkSitemapsWith(urls, opts) {
  const readXml = async (u) => {
    const { res } = await timed(opts.fetchImpl, u, {}, opts.timeoutMs);
    if (!res.ok) return { ok: false, status: res.status };
    if (/gzip/i.test(res.headers.get('content-type') || '') || /\.gz$/i.test(u)) return { ok: false, status: res.status, reason: 'gzip' };
    const text = await res.text();
    return { ok: true, status: res.status, parsed: parseSitemap(text.slice(0, opts.maxBytes), opts.urlCap) };
  };
  const out = [];
  for (const u of urls) {
    const skip = skipReason(u, opts.pageUrl);
    if (skip) { out.push({ url: u, ok: false, reason: skip }); continue; }
    try {
      const r = await readXml(u);
      if (!r.ok || !r.parsed || r.parsed.type === 'unknown') { out.push({ url: u, ok: false, status: r.status ?? null, reason: r.reason || 'not-a-sitemap' }); continue; }
      const row = { url: u, ok: true, status: r.status, type: r.parsed.type, urlCount: r.parsed.total, listed: null };
      if (r.parsed.type === 'urlset') row.listed = isListed(r.parsed.locs, opts.pageUrl);
      else {
        for (const k of r.parsed.locs.slice(0, opts.childCap)) {
          if (skipReason(k, opts.pageUrl)) continue;
          try {
            const c = await readXml(k);
            if (!c.ok || !c.parsed) continue;
            if (isListed(c.parsed.locs, opts.pageUrl)) { row.listed = true; break; }
            row.listed = false;
          } catch { /* skip child */ }
        }
      }
      out.push(row);
    } catch (e) { out.push({ url: u, ok: false, error: String(e && e.name === 'AbortError' ? 'timeout' : e && e.message || e) }); }
  }
  return out;
}
