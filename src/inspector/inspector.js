// Seorius injected inspector. Bundled by esbuild into dist/inspector.js and injected with
// chrome.scripting.executeScript (isolated world) only after the user clicks the extension icon
// (activeTab). It defines globalThis.__seorius once; the extension then calls its methods.
//
// Network: every request goes from the page context to the inspected page's OWN origin
// (page re-fetch, /robots.txt, same-origin sitemaps), except the user-started link / image-size
// checks. Without the optional host permission those also try cross-origin URLs from here in CORS
// mode (unreadable = "not checked"); with it, the report page probes cross-origin URLs itself and
// only same-origin URLs come here. Credentials are never sent.

import { inspectDocument, normalizeHeaders } from '../engine/page-inspect-core.mjs';
import RULES from '../engine/on-page-rules.json';
import SRULES from '../engine/seorius-rules.json';
import { parseRobots, verdicts } from '../lib/robots.mjs';
import { parseSitemap, isListed } from '../lib/sitemap.mjs';
import { headDump, pageInfo, headings, images, linkDescriptors, iframes, mediaQueries, visibleText, sharePreview } from '../lib/collect.mjs';
import { groupLinks, linkSummary } from '../lib/links.mjs';
import { checkLinksWith, measureImagesWith } from '../lib/probe.mjs';
import { tokenize, keywordTable, parseWordList } from '../lib/keywords.mjs';
import { readJsonLd, readMicrodata, readRdfa } from '../lib/schema.mjs';
import { rawVsRendered } from '../lib/compare.mjs';
import { urlMetrics } from '../lib/urlquality.mjs';
import { extraFindings } from '../lib/extras.mjs';
import { buildAudit } from '../lib/audit.mjs';
import { mergeSurfaces } from '../lib/surfaces.mjs';
import { overlay, overlayState } from './overlay.js';

const SELECTED_HEADERS = ['content-type', 'content-length', 'content-encoding', 'cache-control', 'expires', 'age', 'last-modified', 'etag', 'vary', 'server', 'x-robots-tag', 'strict-transport-security', 'link', 'content-language', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'content-security-policy', 'permissions-policy', 'cross-origin-opener-policy'];

const stripHash = (u) => { try { const x = new URL(u); x.hash = ''; return x.toString(); } catch { return u; } };

async function timedFetch(url, init = {}, ms = SRULES.fetch.timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return { res: await fetch(url, { credentials: 'omit', cache: 'no-store', redirect: 'follow', ...init, signal: ctl.signal }), ctl }; } finally { clearTimeout(t); }
}

async function readCapped(res, cap) {
  const ctype = res.headers.get('content-type') || '';
  const cs = (/charset=([^;\s]+)/i.exec(ctype) || [])[1] || 'utf-8';
  let dec;
  try { dec = new TextDecoder(cs.replace(/"/g, '')); } catch { dec = new TextDecoder('utf-8'); }
  if (!res.body) { const t = await res.text(); return { text: t, bytes: new TextEncoder().encode(t).length, truncated: false }; }
  const reader = res.body.getReader();
  const chunks = []; let bytes = 0; let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > cap) { truncated = true; try { await reader.cancel(); } catch { /* ignore */ } break; }
    chunks.push(value);
  }
  let text = '';
  for (const c of chunks) text += dec.decode(c, { stream: true });
  text += dec.decode();
  return { text, bytes: Math.min(bytes, cap), truncated };
}

function headerObject(res) {
  const all = {};
  res.headers.forEach((v, k) => { all[k.toLowerCase()] = v; });
  return all;
}

async function fetchPage(url) {
  try {
    const { res } = await timedFetch(url);
    const headers = headerObject(res);
    const body = await readCapped(res, SRULES.fetch.maxHtmlBytes);
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      url, status: res.status, statusText: res.statusText, redirected: res.redirected, finalUrl: res.url,
      headers, headerNames: Object.keys(headers).sort(),
      selectedHeaders: SELECTED_HEADERS.filter((h) => h in headers).map((h) => [h, headers[h].slice(0, 600)]),
      html: body.text, htmlBytesDecoded: body.bytes, truncated: body.truncated,
      contentLengthHeader: headers['content-length'] ? Number(headers['content-length']) : null,
      contentEncoding: headers['content-encoding'] || null,
      navigation: nav ? { transferSize: nav.transferSize, encodedBodySize: nav.encodedBodySize, decodedBodySize: nav.decodedBodySize } : null,
      error: null,
    };
  } catch (e) {
    return { url, error: String(e && e.name === 'AbortError' ? 'timeout' : e && e.message || e) };
  }
}

async function fetchRobots(origin, pageUrl) {
  const url = `${origin}/robots.txt`;
  try {
    const { res } = await timedFetch(url, {}, 8000);
    const out = { url, status: res.status, finalUrl: res.url, error: null };
    if (res.ok) {
      const body = await readCapped(res, 512000);
      out.parsed = parseRobots(body.text);
      out.verdicts = verdicts(out.parsed, pageUrl);
      out.sitemaps = out.parsed.sitemaps;
      out.size = body.bytes;
    }
    return out;
  } catch (e) { return { url, error: String(e && e.message || e) }; }
}

async function fetchXml(url) {
  const { res } = await timedFetch(url, {}, SRULES.fetch.timeoutMs);
  if (!res.ok) return { url, status: res.status, ok: false };
  const ctype = res.headers.get('content-type') || '';
  if (/gzip/i.test(ctype) || /\.gz$/i.test(url)) return { url, status: res.status, ok: false, gz: true };
  const body = await readCapped(res, SRULES.fetch.maxSitemapBytes);
  return { url, status: res.status, ok: true, parsed: parseSitemap(body.text, SRULES.fetch.sitemapUrlCap), truncated: body.truncated };
}

async function fetchSitemap(origin, pageUrl, robots) {
  const declared = (robots && robots.sitemaps) || [];
  const sameOrigin = (u) => { try { return new URL(u, origin).origin === origin; } catch { return false; } };
  const skippedCrossOrigin = declared.filter((u) => !sameOrigin(u));
  const candidates = [...new Set([...declared.filter(sameOrigin).map((u) => new URL(u, origin).toString()), `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`])];
  const tried = [];
  for (const c of candidates) {
    tried.push(c);
    let r;
    try { r = await fetchXml(c); } catch (e) { continue; }
    if (!r.ok || !r.parsed || r.parsed.type === 'unknown') continue;
    const out = { found: true, checked: true, url: c, type: r.parsed.type, urlCount: r.parsed.total, truncated: r.truncated || r.parsed.truncated, declaredInRobots: robots && !robots.error && robots.status < 400 ? declared.some((d) => { try { return new URL(d, origin).toString() === c; } catch { return false; } }) : null, skippedCrossOrigin, tried };
    if (r.parsed.type === 'urlset') { out.listed = isListed(r.parsed.locs, pageUrl); out.complete = !out.truncated; out.checkedFiles = 1; out.childTotal = 1; }
    else {
      const kids = r.parsed.locs.filter(sameOrigin);
      out.childTotal = r.parsed.locs.length; out.checkedFiles = 0; out.childUrlCount = 0; out.listed = false;
      for (const k of kids.slice(0, SRULES.fetch.sitemapChildCap)) {
        try {
          const cr = await fetchXml(k);
          if (!cr.ok || !cr.parsed) continue;
          out.checkedFiles++; out.childUrlCount += cr.parsed.total;
          if (isListed(cr.parsed.locs, pageUrl)) { out.listed = true; break; }
        } catch { /* skip */ }
      }
      out.complete = out.listed || out.checkedFiles === out.childTotal;
      if (!out.checkedFiles) out.listed = null;
    }
    return out;
  }
  return { found: false, checked: true, tried, skippedCrossOrigin };
}

function resourceSizes() {
  const m = new Map();
  for (const e of performance.getEntriesByType('resource')) m.set(e.name, { encoded: e.encodedBodySize || e.transferSize || 0, decoded: e.decodedBodySize || 0 });
  return m;
}

async function scan(settings = {}) {
  const t0 = performance.now();
  const url = stripHash(location.href);
  const origin = location.origin;
  const page = await fetchPage(url);
  const isHtml = page.error ? false : /html|xml/i.test(page.headers['content-type'] || 'text/html');
  const rawHtml = !page.error && isHtml ? page.html : null;
  const headers = page.error ? null : normalizeHeaders(page.headers);

  const live = inspectDocument(document, { rules: RULES, url, headers, surface: 'rendered-dom' });
  let rawEngine = null;
  if (rawHtml) {
    const rawDoc = new DOMParser().parseFromString(rawHtml, 'text/html');
    rawEngine = inspectDocument(rawDoc, { rules: RULES, url, headers, rawHtml, surface: 'raw-html' });
  }
  const engine = mergeSurfaces(live, rawEngine);

  const robots = await fetchRobots(origin, url);
  const sitemap = await fetchSitemap(origin, url, robots);

  const linkDescs = linkDescriptors(document, url);
  const linkGroups = groupLinks(linkDescs, url);
  const imgs = images(document, url, resourceSizes(), SRULES.images.oversizedRenderRatio);
  const fmt = {};
  for (const i of imgs) fmt[i.format] = (fmt[i.format] || 0) + 1;
  const tokens = tokenize(visibleText(document.body || document.documentElement), engine.lang);
  const keywords = keywordTable(tokens, { maxN: SRULES.keywords.maxPhraseWords, minCount: SRULES.keywords.minPhraseCount, topRows: SRULES.keywords.topRows, minTokenLength: RULES.content.keywordMinTokenLength, userStop: parseWordList(settings.stopWords), whitelist: parseWordList(settings.whitelist) });

  const { html, ...pageNoHtml } = page;
  const s = {
    version: 1,
    scannedAt: new Date().toISOString(),
    url, origin, title: document.title,
    engine,
    rawEngine: rawEngine ? { ...rawEngine, findings: undefined } : null,
    rawVsRendered: rawEngine ? rawVsRendered(rawEngine, engine) : null,
    network: { page: pageNoHtml, robots, sitemap },
    headDump: headDump(document),
    pageInfo: pageInfo(document, url, headers || {}),
    headings: headings(document),
    images: imgs, imageFormats: fmt,
    linkGroups, linkSummary: linkSummary(linkGroups),
    keywords,
    schema: { jsonLd: readJsonLd(document), microdata: readMicrodata(document), rdfa: readRdfa(document) },
    social: { og: engine.openGraph, twitter: engine.twitterCard, preview: sharePreview(engine, url) },
    iframes: iframes(document, url),
    mediaQueries: mediaQueries(document),
    urlMetrics: (() => { try { return urlMetrics(url); } catch { return null; } })(),
  };
  s.extraFindings = extraFindings(s, SRULES);
  s.audit = buildAudit(engine.findings, s.extraFindings);
  s.durationMs = Math.round(performance.now() - t0);
  return s;
}

// ---- on-demand probes (link check, image sizes): policy in ../lib/probe.mjs + ../lib/links.mjs ----

const probeOpts = () => ({ fetchImpl: (u, i) => fetch(u, i), pageUrl: stripHash(location.href), timeoutMs: SRULES.linkCheck.timeoutMs, concurrency: SRULES.linkCheck.concurrency, corsBound: true });
const checkLinks = (urls) => checkLinksWith(urls, probeOpts());
const measureImages = (urls) => measureImagesWith(urls, probeOpts());

async function fetchAndInspect(url) {
  let target;
  try { target = new URL(url, location.href); } catch { return { url, error: 'invalid-url' }; }
  if (!/^https?:$/.test(target.protocol)) return { url, error: 'non-http' };
  const crossOrigin = target.origin !== location.origin;
  try {
    const { res } = await timedFetch(target.toString());
    const body = await readCapped(res, SRULES.fetch.maxHtmlBytes);
    const doc = new DOMParser().parseFromString(body.text, 'text/html');
    const result = inspectDocument(doc, { rules: RULES, url: res.url || target.toString(), headers: headerObject(res), rawHtml: body.text, surface: 'raw-html' });
    return { url: target.toString(), status: res.status, finalUrl: res.url, result };
  } catch (e) {
    return { url: target.toString(), error: crossOrigin ? 'cross-origin-unreadable' : String(e && e.message || e) };
  }
}

// ---- URL watcher for SPA navigation (lives only while a Seorius page holds the port) ----
let watcher = null;
function watch() {
  if (watcher) return true;
  let port;
  try { port = chrome.runtime.connect({ name: 'seorius-watch' }); } catch { return false; }
  let last = location.href;
  const tick = () => { if (location.href !== last) { last = location.href; try { port.postMessage({ type: 'url-changed', href: last }); } catch { /* closed */ } } };
  const id = setInterval(tick, 1000);
  const nav = globalThis.navigation;
  if (nav && nav.addEventListener) nav.addEventListener('navigatesuccess', tick);
  watcher = { port, id };
  port.onDisconnect.addListener(() => { clearInterval(id); if (nav && nav.removeEventListener) nav.removeEventListener('navigatesuccess', tick); watcher = null; });
  return true;
}

if (!globalThis.__seorius) {
  globalThis.__seorius = { version: 1, scan, checkLinks, measureImages, fetchAndInspect, overlay, overlayState, watch };
}
