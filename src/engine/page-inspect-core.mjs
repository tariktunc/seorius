// Vendored from WebForge site-builder/seo-uzman/health/page-inspect-core.mjs (2026-10-28), import paths
// changed, plus ONE Seorius patch: every add() call carries a message code + params, emitted as
// msgKey (e_<code>) / params / fixKey (e_<code>_fix) next to the English message, so the UI can
// translate findings without parsing sentences. Keys live in src/_locales/*/messages.json.
// When re-copying from WebForge, re-apply this patch (or upstream it); test/engine-i18n.test.mjs
// fails if a code has no locale entry.
/**
 * page-inspect-core — environment-agnostic single-page on-page inspection engine
 * (seo-uzman, 2026-10-28). The ONE analysis core: the CLI (health/page-inspect.mjs) and the future
 * blakfy-seo Chrome extension (Manifest V3) are views over this module.
 *
 * Contract
 *   inspectDocument(doc, { rules, url, headers, rawHtml, surface }) -> result (JSON-serialisable)
 *     doc      Document-like: a real `document` (extension) or _lib/mini-dom.mjs parseHtml() (Node).
 *              Used surface: documentElement, head, body, doctype, compatMode, querySelectorAll,
 *              element.getAttribute/localName/textContent/childNodes/nodeType. Nothing else.
 *     rules    parsed health/_config/on-page-rules.json (REQUIRED; this module never reads files).
 *     url      the page URL (final, after redirects). Without it canonical-self, internal/external
 *              links, hreflang self-reference and mixed content cannot be judged: they are reported
 *              as 'not-run', never as a pass.
 *     headers  optional response headers (plain object, Map or Headers). Without them X-Robots-Tag,
 *              HSTS and Content-Type charset are 'not-run'. An extension cannot read the main
 *              document's headers from a content script; the background worker can (webRequest).
 *     rawHtml  optional source string (doctype, charset byte offset, text/HTML ratio). Without it
 *              doctype falls back to doc.doctype/compatMode and the ratio to outerHTML.
 *     surface  free label echoed in the result ('raw-html' | 'rendered-dom'), because K23 says head
 *              claims may come from the rendered DOM only: the caller must state what it passed.
 *
 * Findings use _lib/finding-schema.mjs ({id, severity, page, message, fix_hint}); severity vocabulary
 * pass/info/warn/fail/not-run. Only problems, observations and not-run are emitted, never 'pass'.
 *
 * No Node built-ins are imported here (verified by grep in the task); URL, TextEncoder, JSON, RegExp
 * with \p{} are web-platform globals. Imports are two pure sibling modules.
 */

import { makeFinding, stableId } from './finding-schema.mjs';
import { fold, STOPWORDS } from './aio-lib.mjs';

const lname = (el) => String(el.localName || el.nodeName || '').toLowerCase();
const attr = (el, n) => (el.getAttribute ? el.getAttribute(n) : null);
const cpLen = (s) => [...String(s)].length;
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();
const all = (root, sel) => Array.from(root.querySelectorAll(sel));
const relTokens = (el) => String(attr(el, 'rel') || '').toLowerCase().split(/\s+/).filter(Boolean);

export function normalizeHeaders(h) {
  const out = {};
  if (!h) return out;
  if (typeof h.forEach === 'function' && !Array.isArray(h) && typeof h.get === 'function') h.forEach((v, k) => { out[String(k).toLowerCase()] = String(v); });
  else for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
  return out;
}

function normUrl(u, { stripSlash = false } = {}) {
  try {
    const x = new URL(u);
    x.hash = '';
    let s = x.toString();
    if (stripSlash && x.pathname !== '/') s = s.replace(/\/(?=(\?|$))/, '');
    return s;
  } catch { return null; }
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };

function visibleText(root) {
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head']);
  const BLOCK = new Set(['p', 'div', 'li', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'section', 'article', 'header', 'footer', 'nav', 'ul', 'ol', 'table', 'blockquote', 'main', 'aside', 'form']);
  const parts = [];
  const walk = (n) => {
    for (const c of n.childNodes || []) {
      if (c.nodeType === 3) parts.push(c.nodeValue ?? c.data ?? '');
      else if (c.nodeType === 1) {
        const t = lname(c);
        if (SKIP.has(t)) continue;
        if (BLOCK.has(t)) parts.push(' ');
        walk(c);
        if (BLOCK.has(t)) parts.push(' ');
      }
    }
  };
  walk(root);
  return squash(parts.join(''));
}

function parseDirectiveHeader(value) {
  const KNOWN = /^(noindex|nofollow|none|noarchive|nosnippet|notranslate|noimageindex|unavailable_after|max-snippet|max-image-preview|max-video-preview|indexifembedded|index|follow|all)\b/i;
  const out = [];
  let agent = '*';
  for (const piece of String(value).split(',')) {
    const p = piece.trim();
    if (!p) continue;
    const m = /^([a-z0-9_-]+)\s*:\s*(.*)$/i.exec(p);
    if (m && !KNOWN.test(m[1])) { agent = m[1].toLowerCase(); if (m[2]) out.push({ agent, token: m[2].trim().toLowerCase() }); }
    else out.push({ agent, token: p.toLowerCase() });
  }
  return out;
}

function collectTypes(node, set, ctx) {
  if (Array.isArray(node)) { node.forEach((n) => collectTypes(n, set, ctx)); return; }
  if (!node || typeof node !== 'object') return;
  const t = node['@type'];
  if (typeof t === 'string') set.add(t); else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && set.add(x));
  for (const v of Object.values(node)) if (v && typeof v === 'object') collectTypes(v, set, ctx);
}

export function inspectDocument(doc, opts = {}) {
  const { rules, url = null, rawHtml = null, surface = 'unspecified' } = opts;
  if (!rules || !rules.title) throw new Error('inspectDocument: opts.rules (parsed on-page-rules.json) is required');
  const headers = normalizeHeaders(opts.headers);
  const hasHeaders = Object.keys(headers).length > 0;
  const page = url || 'document';
  const findings = [];
  // msg = 'code' or ['code', params]: a stable message key for translated UIs (Seorius patch, see header).
  const add = (key, severity, msg, message, fix_hint = null) => {
    const [code, params] = Array.isArray(msg) ? msg : [msg, {}];
    findings.push({ ...makeFinding({ id: stableId('HEALTH', `PI ${key}`), severity, page, message, fix_hint }), msgKey: `e_${code}`, params, fixKey: fix_hint ? `e_${code}_fix` : null });
  };
  const isHttps = url ? /^https:/i.test(url) : null;
  const root = doc.documentElement;
  const out = { url, surface, headersSupplied: hasHeaders };

  // ---- title ----
  const inSvg = (el) => { for (let p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) if (lname(p) === 'svg') return true; return false; };
  const titles = all(doc, 'title').filter((t) => !inSvg(t));
  const titleText = titles.length ? squash(titles[0].textContent) : null;
  const T = rules.title;
  out.title = { text: titleText, length: titleText === null ? 0 : cpLen(titleText), count: titles.length };
  if (!titles.length || !titleText) add('title', 'fail', titles.length ? 'title_empty' : 'title_missing', titles.length ? 'Empty <title>.' : 'No <title> element.', 'Add a unique, service-led <title>.');
  else {
    if (titles.length > 1) add('title', 'warn', ['title_multiple', { n: titles.length }], `${titles.length} <title> elements; only the first is used.`, 'Keep one <title>.');
    if (out.title.length < T.min) add('title', 'warn', ['title_short', { n: out.title.length, min: T.min, max: T.max }], `Title is ${out.title.length} chars (band ${T.min}-${T.max}, advisory; Google sets no minimum).`, 'Lengthen with the service and benefit.');
    else if (out.title.length > T.max) add('title', 'info', ['title_long', { n: out.title.length, min: T.min, max: T.max }], `Title is ${out.title.length} chars (band ${T.min}-${T.max}); Google may shorten it on narrow devices.`, 'Trim, putting the key words first.');
  }

  // ---- meta description ----
  const metas = all(doc, 'meta');
  const metaByName = (n) => metas.filter((m) => String(attr(m, 'name') || '').toLowerCase() === n);
  const descEls = metaByName('description');
  const descText = descEls.length ? squash(attr(descEls[0], 'content') || '') : null;
  const D = rules.metaDescription;
  out.metaDescription = { text: descText, length: descText === null ? 0 : cpLen(descText), count: descEls.length };
  if (!descEls.length || !descText) add('description', 'warn', descEls.length ? 'desc_empty' : 'desc_missing', descEls.length ? 'Empty meta description.' : 'No meta description.', 'Write a unique summary; Google may still rewrite it.');
  else {
    if (descEls.length > 1) add('description', 'warn', ['desc_multiple', { n: descEls.length }], `${descEls.length} meta description tags.`, 'Keep one.');
    if (out.metaDescription.length < D.min) add('description', 'info', ['desc_short', { n: out.metaDescription.length, min: D.min, max: D.max }], `Description is ${out.metaDescription.length} chars (band ${D.min}-${D.max}, advisory).`);
    else if (out.metaDescription.length > D.max) add('description', 'info', ['desc_long', { n: out.metaDescription.length, min: D.min, max: D.max }], `Description is ${out.metaDescription.length} chars (band ${D.min}-${D.max}); the tail may be cut.`);
  }

  // ---- robots (meta + X-Robots-Tag) ----
  const robotsEntries = [];
  for (const m of metas) {
    const n = String(attr(m, 'name') || '').toLowerCase();
    if (['robots', 'googlebot', 'googlebot-news', 'bingbot'].includes(n)) {
      for (const tok of String(attr(m, 'content') || '').split(',')) if (tok.trim()) robotsEntries.push({ source: 'meta', agent: n === 'robots' ? '*' : n, token: tok.trim().toLowerCase() });
    }
  }
  const xrt = headers['x-robots-tag'];
  if (xrt) for (const e of parseDirectiveHeader(xrt)) robotsEntries.push({ source: 'header', ...e });
  const isNo = (e, w) => e.token === w || (w !== 'none' && e.token === 'none');
  const metaNoindex = robotsEntries.some((e) => e.source === 'meta' && isNo(e, 'noindex'));
  const headerNoindex = robotsEntries.some((e) => e.source === 'header' && isNo(e, 'noindex'));
  const nofollowAll = robotsEntries.some((e) => isNo(e, 'nofollow'));
  out.robots = { entries: robotsEntries, noindex: metaNoindex || headerNoindex, noindexVia: [metaNoindex && 'meta', headerNoindex && 'header'].filter(Boolean), nofollow: nofollowAll, xRobotsTag: xrt || null };
  if (out.robots.noindex) add('robots', 'warn', `robots_noindex_${metaNoindex && headerNoindex ? 'both' : metaNoindex ? 'meta' : 'header'}`, `Page is noindex via ${out.robots.noindexVia.join(' + ')}.`, 'Intended only for pages that must stay out of search.');
  if (nofollowAll) add('robots', 'info', 'robots_nofollow', 'Page-level nofollow: links on this page pass no signals.');
  if (!hasHeaders) add('robots', 'not-run', 'robots_xrt_notrun', 'X-Robots-Tag not checked: no response headers supplied.');

  // ---- canonical ----
  const canonEls = all(doc, 'link').filter((l) => relTokens(l).includes('canonical'));
  const linkHdr = headers.link ? /<([^>]+)>\s*;\s*rel="?canonical"?/i.exec(headers.link) : null;
  const rawCanon = canonEls.length ? (attr(canonEls[0], 'href') || '').trim() : null;
  let resolved = null;
  try { if (rawCanon) resolved = new URL(rawCanon, url || undefined).toString(); } catch { resolved = null; }
  const absolute = rawCanon ? /^https?:\/\//i.test(rawCanon) : null;
  let relation = 'unknown';
  if (!rawCanon) relation = 'missing';
  else if (url && resolved) {
    if (normUrl(resolved) === normUrl(url)) relation = 'self';
    else if (normUrl(resolved, { stripSlash: true }) === normUrl(url, { stripSlash: true })) relation = 'self-slash-variant';
    else relation = 'other';
  }
  out.canonical = { href: rawCanon, resolved, count: canonEls.length, absolute, relation, headerCanonical: linkHdr ? linkHdr[1] : null };
  if (!canonEls.length) add('canonical', 'warn', 'canonical_missing', 'No rel=canonical link.', 'Add a self-referencing absolute canonical.');
  else {
    if (canonEls.length > 1) add('canonical', 'fail', ['canonical_multiple', { n: canonEls.length }], `${canonEls.length} canonical links; conflicting declarations are ignored by Google.`, 'Keep exactly one.');
    if (!rawCanon) add('canonical', 'fail', 'canonical_empty', 'Canonical link has an empty href.');
    else if (!absolute) add('canonical', 'warn', ['canonical_relative', { href: rawCanon }], `Canonical "${rawCanon}" is relative.`, 'Use an absolute URL.');
    if (relation === 'other') add('canonical', 'info', ['canonical_other', { url: resolved }], `Canonical points to another URL (${resolved}); this page asks not to be the indexed version.`);
    if (relation === 'self-slash-variant') add('canonical', 'info', 'canonical_slash', 'Canonical equals the page URL except for a trailing slash.');
    if (relation === 'unknown' && rawCanon) add('canonical', 'not-run', 'canonical_notrun', 'Canonical self-reference not judged: page URL not supplied.');
    if (isHttps && resolved && /^http:/i.test(resolved)) add('canonical', 'warn', 'canonical_http', 'Canonical uses http on an https page.');
  }

  // ---- noindex vs canonical vs robots consistency ----
  if (out.robots.noindex && relation === 'other') add('consistency', 'warn', 'consistency_noindex_canonical', 'noindex combined with a canonical to a different URL: contradictory signals.', 'Pick one: noindex, or canonical to the preferred URL.');
  else if (out.robots.noindex && (relation === 'self' || relation === 'self-slash-variant')) add('consistency', 'info', 'consistency_noindex_self', 'noindex with a self canonical: the canonical has no effect.');
  if (headerNoindex && !metaNoindex) add('consistency', 'warn', 'consistency_header_only', 'X-Robots-Tag says noindex but the meta robots tag does not: the header wins and is easy to overlook.', 'Align header and meta.');

  // ---- lang ----
  const lang = (attr(root, 'lang') || '').trim() || null;
  out.lang = lang;
  if (!lang) add('lang', 'warn', 'lang_missing', 'No <html lang>.', 'Set the page language (e.g. lang="tr").');
  else if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang)) add('lang', 'warn', ['lang_malformed', { lang }], `<html lang="${lang}"> is not a well-formed language tag.`);

  // ---- viewport ----
  const vpEl = metaByName('viewport')[0];
  const vpContent = vpEl ? attr(vpEl, 'content') || '' : null;
  const vp = {};
  if (vpContent) for (const kv of vpContent.split(/[,;]/)) { const [k, v] = kv.split('='); if (k && v !== undefined) vp[k.trim().toLowerCase()] = v.trim().toLowerCase(); }
  out.viewport = vpContent;
  if (!vpEl) add('viewport', 'fail', 'viewport_missing', 'No meta viewport.', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.');
  else {
    if (vp.width !== 'device-width') add('viewport', 'warn', vp.width === undefined ? 'viewport_width_unset' : ['viewport_width', { width: vp.width }], `Viewport width is "${vp.width ?? 'unset'}", not device-width.`);
    const maxScale = parseFloat(vp['maximum-scale']);
    if (['no', '0'].includes(vp['user-scalable']) || (Number.isFinite(maxScale) && maxScale < rules.viewport.minMaximumScale)) add('viewport', 'warn', ['viewport_zoom', { content: vpContent }], `Viewport blocks zoom (${vpContent}); WCAG 1.4.4 needs 200% resize.`, 'Remove user-scalable=no / maximum-scale below 2.');
  }

  // ---- charset ----
  const charsetMeta = metas.find((m) => attr(m, 'charset') !== null) || metas.find((m) => String(attr(m, 'http-equiv') || '').toLowerCase() === 'content-type');
  let cs = null;
  if (charsetMeta) cs = (attr(charsetMeta, 'charset') || (/charset=([^;\s]+)/i.exec(attr(charsetMeta, 'content') || '') || [])[1] || '').toLowerCase() || null;
  const hdrCs = (/charset=([^;\s]+)/i.exec(headers['content-type'] || '') || [])[1]?.toLowerCase().replace(/"/g, '') || null;
  out.charset = { meta: cs, header: hdrCs };
  if (!cs && !hdrCs) add('charset', 'warn', 'charset_missing', 'No charset declared in meta or Content-Type.', 'Add <meta charset="utf-8"> early in <head>.');
  else {
    if ((cs || hdrCs) !== 'utf-8') add('charset', 'warn', ['charset_not_utf8', { charset: cs || hdrCs }], `Charset is "${cs || hdrCs}", not utf-8.`);
    if (cs && hdrCs && cs !== hdrCs) add('charset', 'warn', ['charset_mismatch', { meta: cs, header: hdrCs }], `Meta charset (${cs}) and Content-Type charset (${hdrCs}) differ.`);
  }
  if (cs && rawHtml) {
    const idx = rawHtml.search(/<meta[^>]+charset/i);
    if (idx > 0 && new TextEncoder().encode(rawHtml.slice(0, idx)).length > rules.charset.maxByteOffset) add('charset', 'warn', ['charset_late', { bytes: rules.charset.maxByteOffset }], `Charset meta starts after byte ${rules.charset.maxByteOffset} (HTML requires the first ${rules.charset.maxByteOffset}).`);
  }

  // ---- doctype ----
  let doctype = 'unknown';
  if (rawHtml) doctype = /^﻿?\s*(<!--[\s\S]*?-->\s*)*<!doctype\s+html(\s|>)/i.test(rawHtml) ? 'html5' : 'missing-or-legacy';
  else if (doc.doctype) doctype = String(doc.doctype.name).toLowerCase() === 'html' ? 'html5' : 'missing-or-legacy';
  else if (doc.compatMode) doctype = doc.compatMode === 'CSS1Compat' ? 'html5' : 'missing-or-legacy';
  out.doctype = doctype;
  if (doctype === 'missing-or-legacy') add('doctype', 'warn', 'doctype_missing', 'No <!doctype html> (browser falls into quirks mode).', 'Add <!doctype html> as the first line.');
  else if (doctype === 'unknown') add('doctype', 'not-run', 'doctype_notrun', 'Doctype not checked: no source and no doc.doctype.');

  // ---- hreflang ----
  const hreflang = all(doc, 'link').filter((l) => relTokens(l).includes('alternate') && attr(l, 'hreflang')).map((l) => ({ hreflang: attr(l, 'hreflang').trim(), href: (attr(l, 'href') || '').trim() }));
  out.hreflang = hreflang;
  if (hreflang.length) {
    const bad = hreflang.filter((h) => h.hreflang.toLowerCase() !== 'x-default' && !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(h.hreflang));
    if (bad.length) add('hreflang', 'warn', ['hreflang_malformed', { values: bad.map((b) => b.hreflang).join(', ') }], `Malformed hreflang value(s): ${bad.map((b) => b.hreflang).join(', ')}.`);
    const rel = hreflang.filter((h) => !/^https?:\/\//i.test(h.href));
    if (rel.length) add('hreflang', 'warn', ['hreflang_relative', { n: rel.length }], `${rel.length} hreflang href(s) not absolute.`);
    const seen = new Set(); const dup = [];
    for (const h of hreflang) { const k = h.hreflang.toLowerCase(); if (seen.has(k)) dup.push(k); seen.add(k); }
    if (dup.length) add('hreflang', 'warn', ['hreflang_duplicate', { values: [...new Set(dup)].join(', ') }], `Duplicate hreflang value(s): ${[...new Set(dup)].join(', ')}.`);
    if (!seen.has('x-default')) add('hreflang', 'info', 'hreflang_no_default', 'No x-default hreflang.');
    if (url) {
      if (!hreflang.some((h) => normUrl(h.href, { stripSlash: true }) === normUrl(url, { stripSlash: true }))) add('hreflang', 'warn', 'hreflang_no_self', 'hreflang set does not include the page itself.');
    } else add('hreflang', 'not-run', 'hreflang_notrun', 'hreflang self-reference not judged: page URL not supplied.');
  }

  // ---- headings ----
  const heads = all(doc, 'h1,h2,h3,h4,h5,h6').map((h) => ({ level: Number(lname(h)[1]), text: squash(h.textContent).slice(0, 120) }));
  const h1s = heads.filter((h) => h.level === 1);
  out.h1Count = h1s.length;
  out.headings = { outline: heads, counts: [1, 2, 3, 4, 5, 6].reduce((a, l) => ({ ...a, [`h${l}`]: heads.filter((h) => h.level === l).length }), {}) };
  if (h1s.length === 0) add('h1', 'warn', 'h1_missing', 'No H1.', 'Add one H1 stating the page topic.');
  else if (h1s.length > rules.headings.maxH1) add('h1', 'warn', ['h1_multiple', { n: h1s.length }], `${h1s.length} H1 elements. Google tolerates this; our page-anatomy rule is one H1 (clarity, not ranking).`, 'Keep one H1.');
  if (h1s.some((h) => !h.text)) add('h1', 'warn', 'h1_empty', 'An H1 is empty.');
  const skips = [];
  heads.forEach((h, i) => { if (i && h.level - heads[i - 1].level > 1) skips.push(`h${heads[i - 1].level}->h${h.level}`); });
  if (skips.length) add('outline', 'info', ['outline_skip', { skips: skips.slice(0, 5).join(', ') }], `Heading level skipped (${skips.slice(0, 5).join(', ')}). Google says heading order is not a ranking factor; it helps accessibility.`);
  const emptyH = heads.filter((h) => h.level > 1 && !h.text).length;
  if (emptyH) add('outline', 'warn', ['outline_empty', { n: emptyH }], `${emptyH} empty heading(s).`);

  // ---- images ----
  const imgEls = all(doc, 'img');
  const imgIssues = [];
  const img = { total: imgEls.length, altMissing: 0, altEmpty: 0, altOk: 0, withTitle: 0, missingDimensions: 0 };
  imgEls.forEach((el) => {
    const src = attr(el, 'src') || attr(el, 'data-src') || '';
    const alt = attr(el, 'alt');
    if (alt === null) { img.altMissing++; if (imgIssues.length < 25) imgIssues.push({ src, issue: 'alt-missing' }); }
    else if (!alt.trim()) img.altEmpty++; else img.altOk++;
    if (attr(el, 'title')) img.withTitle++;
    if (rules.images.requireDimensions && (!attr(el, 'width') || !attr(el, 'height'))) { img.missingDimensions++; if (imgIssues.length < 25) imgIssues.push({ src, issue: 'dimensions-missing' }); }
  });
  out.images = { ...img, issues: imgIssues };
  if (img.altMissing) add('images', 'warn', ['images_alt_missing', { n: img.altMissing, total: img.total }], `${img.altMissing}/${img.total} image(s) have no alt attribute.`, 'Add descriptive alt, or alt="" for decorative images.');
  if (img.altEmpty) add('images', 'info', ['images_alt_empty', { n: img.altEmpty }], `${img.altEmpty} image(s) have empty alt (fine only if decorative).`);
  if (img.missingDimensions) add('images', 'info', ['images_no_dims', { n: img.missingDimensions, total: img.total }], `${img.missingDimensions}/${img.total} image(s) lack width/height (layout-shift risk).`);

  // ---- links ----
  const myHost = url ? hostOf(url) : null;
  const lk = { total: 0, internal: 0, external: 0, mailto: 0, tel: 0, fragment: 0, javascript: 0, placeholderHref: 0, nofollow: 0, sponsored: 0, ugc: 0, noopener: 0, emptyAnchors: 0 };
  const emptyList = []; const nofollowExternal = [];
  for (const a of all(doc, 'a')) {
    const hrefRaw = attr(a, 'href');
    if (hrefRaw === null) continue;
    lk.total++;
    const href = hrefRaw.trim();
    const rel = relTokens(a);
    for (const k of ['nofollow', 'sponsored', 'ugc', 'noopener']) if (rel.includes(k)) lk[k]++;
    const hasLabel = squash(a.textContent) || all(a, 'img').some((i) => (attr(i, 'alt') || '').trim()) || attr(a, 'aria-label') || attr(a, 'title') || attr(a, 'aria-labelledby');
    if (!hasLabel) { lk.emptyAnchors++; if (emptyList.length < 20) emptyList.push(href); }
    if (href === '' || href === '#') { lk.placeholderHref++; continue; }
    if (href.startsWith('#')) { lk.fragment++; continue; }
    if (/^mailto:/i.test(href)) { lk.mailto++; continue; }
    if (/^tel:/i.test(href)) { lk.tel++; continue; }
    if (/^javascript:/i.test(href)) { lk.javascript++; continue; }
    let host = null;
    try { host = hostOf(new URL(href, url || 'https://unknown.invalid/').toString()); } catch { /* malformed: counted external-unknown below */ }
    const absoluteHref = /^([a-z][a-z0-9+.-]*:)?\/\//i.test(href);
    const internal = absoluteHref ? (myHost ? host === myHost : false) : true;
    if (internal) lk.internal++; else { lk.external++; if (rel.includes('nofollow') && nofollowExternal.length < 20) nofollowExternal.push(href); }
  }
  out.links = { ...lk, emptyAnchorHrefs: emptyList, nofollowExternal, hostKnown: !!myHost };
  if (lk.emptyAnchors) add('links', 'warn', ['links_empty_anchor', { n: lk.emptyAnchors }], `${lk.emptyAnchors} link(s) with no text, image alt or aria-label.`, 'Give every link an accessible name.');
  if (lk.javascript) add('links', 'warn', ['links_javascript', { n: lk.javascript }], `${lk.javascript} javascript: link(s) are not crawlable.`);
  if (lk.placeholderHref) add('links', 'info', ['links_placeholder', { n: lk.placeholderHref }], `${lk.placeholderHref} link(s) with empty or "#" href.`);
  if (!myHost && lk.total) add('links', 'not-run', 'links_notrun', 'Internal/external split not reliable: page URL not supplied (absolute links all counted external).');

  // ---- Open Graph + Twitter ----
  const og = {}; const tw = {};
  for (const m of metas) {
    const k = String(attr(m, 'property') || attr(m, 'name') || '').toLowerCase();
    const v = attr(m, 'content');
    if (v === null) continue;
    const bucket = k.startsWith('og:') ? og : k.startsWith('twitter:') ? tw : null;
    if (!bucket) continue;
    bucket[k] = k in bucket ? [].concat(bucket[k], v) : v;
  }
  out.openGraph = og; out.twitterCard = tw;
  const ogMissing = rules.openGraph.required.filter((k) => !og[k] || !String(og[k]).trim());
  if (ogMissing.length) add('open-graph', 'warn', ['og_missing', { fields: ogMissing.join(', ') }], `Open Graph missing: ${ogMissing.join(', ')}.`, 'Add the four required OG properties.');
  const ogImg = [].concat(og['og:image'] || []);
  if (ogImg.some((u) => !/^https?:\/\//i.test(u))) add('open-graph', 'warn', 'og_image_relative', 'og:image is not an absolute URL.');
  if (og['og:url'] && resolved && normUrl(String(og['og:url']), { stripSlash: true }) !== normUrl(resolved, { stripSlash: true })) add('open-graph', 'info', ['og_url_differs', { url: og['og:url'] }], `og:url (${og['og:url']}) differs from the canonical.`);
  const twMissing = rules.twitterCard.required.filter((k) => !tw[k]);
  if (twMissing.length) add('twitter-card', 'info', ['twitter_missing', { fields: twMissing.join(', ') }], `Twitter/X card missing: ${twMissing.join(', ')} (X falls back to OG for the other fields).`);

  // ---- structured data ----
  const ldScripts = all(doc, 'script').filter((s) => /ld\+json/i.test(attr(s, 'type') || ''));
  const typeSet = new Set(); const ldErrors = []; const httpContext = [];
  ldScripts.forEach((s, i) => {
    try {
      const j = JSON.parse(s.textContent);
      collectTypes(j, typeSet);
      for (const node of [].concat(j)) { const c = node && node['@context']; if (typeof c === 'string' && /^http:\/\/schema\.org/i.test(c)) httpContext.push(i); }
    } catch (e) { ldErrors.push({ index: i, error: String(e.message).slice(0, 120) }); }
  });
  const microTypes = new Set();
  for (const el of all(doc, '*')) { const it = attr(el, 'itemtype'); if (it) it.split(/\s+/).forEach((t) => microTypes.add(t.split('/').pop())); }
  out.schemaTypes = [...typeSet];
  out.structuredData = { jsonLdBlocks: ldScripts.length, jsonLdTypes: [...typeSet], jsonLdErrors: ldErrors, microdataTypes: [...microTypes], note: 'RDFa not scanned' };
  if (ldErrors.length) add('structured-data', 'fail', ['sd_parse_error', { n: ldErrors.length, errors: ldErrors.map((e) => e.error).join(' | ') }], `${ldErrors.length} JSON-LD block(s) fail to parse: ${ldErrors.map((e) => e.error).join(' | ')}`, 'Fix the JSON syntax; run schema/schema-validate.mjs for rule checks.');
  if (httpContext.length) add('structured-data', 'info', 'sd_http_context', '@context uses http://schema.org; https is preferred.');
  if (!ldScripts.length && !microTypes.size) add('structured-data', 'info', 'sd_none', 'No JSON-LD or microdata found in this document.');

  // ---- tracking tags ----
  const srcs = [...all(doc, 'script'), ...all(doc, 'iframe'), ...all(doc, 'img')].map((e) => attr(e, 'src') || '').filter(Boolean);
  const inline = [...all(doc, 'script').filter((s) => !attr(s, 'src')), ...all(doc, 'noscript')].map((e) => e.textContent).join('\n');
  const tracking = [];
  for (const t of rules.trackers) {
    const sRe = new RegExp(t.src, 'i'); const iRe = new RegExp(t.inline, 'i');
    const bySrc = srcs.filter((s) => sRe.test(s));
    const byInline = iRe.test(inline);
    if (!bySrc.length && !byInline) continue;
    const idRe = new RegExp(t.idPattern, 'gi'); const ids = new Set();
    for (const hay of [...bySrc, inline]) { let m; idRe.lastIndex = 0; while ((m = idRe.exec(hay))) ids.add(m[1] || m[0]); }
    tracking.push({ id: t.id, label: t.label, matchedBy: [bySrc.length && 'src', byInline && 'inline'].filter(Boolean), ids: [...ids].slice(0, 5) });
  }
  out.tracking = tracking;
  if (tracking.some((t) => t.id === 'ua-legacy')) add('tracking', 'warn', 'tracking_ua', 'Legacy Universal Analytics tag present; it no longer processes data.', 'Remove or migrate to GA4.');
  if (!tracking.length) add('tracking', 'info', 'tracking_none', 'No analytics/pixel tag found by script src or inline init (tags loaded inside a GTM container or after consent are invisible here).');

  // ---- text, ratio, words, keywords ----
  const body = doc.body || root;
  const text = visibleText(body);
  const wordRe = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
  const words = text.match(wordRe) || [];
  const htmlLen = rawHtml != null ? rawHtml.length : (typeof root.outerHTML === 'string' ? root.outerHTML.length : null);
  const C = rules.content;
  const ratio = htmlLen ? Math.round((text.length / htmlLen) * 1000) / 10 : null;
  out.content = { wordCount: words.length, textChars: text.length, htmlChars: htmlLen, textHtmlRatioPercent: ratio };
  if (words.length < C.thinContentWords) add('content', 'info', ['content_thin', { n: words.length, min: C.thinContentWords }], `${words.length} words of visible text (WebForge floor ${C.thinContentWords}; Google has no word-count target).`);
  if (ratio === null) add('content', 'not-run', 'content_ratio_notrun', 'Text/HTML ratio not computed: no source string or outerHTML.');
  else if (ratio < C.minTextHtmlRatioPercent) add('content', 'info', ['content_ratio_low', { ratio, min: C.minTextHtmlRatioPercent }], `Text/HTML ratio ${ratio}% (< ${C.minTextHtmlRatioPercent}%; an SEO-tool heuristic, not a Google signal).`);

  const turkish = !!lang && /^tr\b/i.test(lang);
  const lower = (s) => (turkish ? s.replace(/İ/g, 'i').replace(/I/g, 'ı') : s).toLowerCase();
  const toks = words.map(lower);
  const content = toks.filter((t) => cpLen(t) >= C.keywordMinTokenLength && !/^\d+$/.test(t) && !STOPWORDS.has(fold(t)));
  const freq = new Map(); content.forEach((t) => freq.set(t, (freq.get(t) || 0) + 1));
  const foldTitle = fold(titleText || ''); const foldH1 = fold(h1s.map((h) => h.text).join(' '));
  const unigrams = [...freq].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, C.topKeywords)
    .map(([word, count]) => ({ word, count, densityPercent: Math.round((count / (toks.length || 1)) * 1000) / 10, inTitle: foldTitle.includes(fold(word)), inH1: foldH1.includes(fold(word)) }));
  const bi = new Map();
  for (let i = 0; i + 1 < toks.length; i++) {
    const a = toks[i]; const b = toks[i + 1];
    if ([a, b].every((t) => cpLen(t) >= C.keywordMinTokenLength && !/^\d+$/.test(t) && !STOPWORDS.has(fold(t)))) bi.set(`${a} ${b}`, (bi.get(`${a} ${b}`) || 0) + 1);
  }
  const bigrams = [...bi].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([phrase, count]) => ({ phrase, count }));
  out.keywords = { totalTokens: toks.length, unigrams, bigrams, stopWordSource: 'aio/_aio-lib.mjs STOPWORDS (~70 tr+en words; a fuller Turkish list exists unexported in content/content-ngram-audit.mjs)', language: lang };
  const stuffed = unigrams.filter((u) => u.densityPercent > C.keywordDensityMaxPercent && toks.length >= 100);
  if (stuffed.length) add('keywords', 'info', ['keywords_density', { max: C.keywordDensityMaxPercent, words: stuffed.map((u) => `${u.word} ${u.densityPercent}%`).join(', ') }], `Keyword density above ${C.keywordDensityMaxPercent}%: ${stuffed.map((u) => `${u.word} ${u.densityPercent}%`).join(', ')} (heuristic; no published Google figure).`);

  // ---- mixed content ----
  if (isHttps === true) {
    const active = []; const passive = [];
    const chk = (sel, a, bucket) => all(doc, sel).forEach((e) => { const v = attr(e, a); if (v && /^http:\/\//i.test(v.trim())) bucket.push(v.trim()); });
    chk('script', 'src', active); chk('iframe', 'src', active); chk('embed', 'src', active); chk('object', 'data', active);
    all(doc, 'link').filter((l) => relTokens(l).includes('stylesheet')).forEach((l) => { const v = attr(l, 'href'); if (v && /^http:\/\//i.test(v.trim())) active.push(v.trim()); });
    chk('img', 'src', passive); chk('audio', 'src', passive); chk('video', 'src', passive); chk('source', 'src', passive); chk('form', 'action', active);
    out.mixedContent = { active, passive };
    if (active.length) add('mixed-content', 'fail', ['mixed_active', { n: active.length, urls: active.slice(0, 3).join(', ') }], `${active.length} active http:// subresource(s) on an https page (blocked by browsers): ${active.slice(0, 3).join(', ')}`, 'Serve every subresource over https.');
    if (passive.length) add('mixed-content', 'warn', ['mixed_passive', { n: passive.length, urls: passive.slice(0, 3).join(', ') }], `${passive.length} passive http:// resource(s) on an https page: ${passive.slice(0, 3).join(', ')}`, 'Serve media over https.');
  } else {
    out.mixedContent = null;
    add('mixed-content', 'not-run', isHttps === false ? 'mixed_http_page' : 'mixed_notrun', isHttps === false ? 'Mixed content not applicable: page is served over http (itself a defect).' : 'Mixed content not checked: page URL not supplied.');
  }

  // ---- HSTS ----
  const hsts = headers['strict-transport-security'] || null;
  out.hsts = null;
  if (!hasHeaders) add('hsts', 'not-run', 'hsts_notrun', 'HSTS not checked: no response headers supplied.');
  else if (isHttps === false) add('hsts', 'warn', 'hsts_http_page', 'Page is served over http; HSTS only applies to https responses.');
  else if (!hsts) add('hsts', 'warn', 'hsts_missing', 'No Strict-Transport-Security header.', 'Send max-age=31536000; includeSubDomains.');
  else {
    const maxAge = parseInt((/max-age=(\d+)/i.exec(hsts) || [])[1], 10);
    out.hsts = { raw: hsts, maxAge: Number.isFinite(maxAge) ? maxAge : null, includeSubDomains: /includesubdomains/i.test(hsts), preload: /\bpreload\b/i.test(hsts) };
    if (!Number.isFinite(maxAge) || maxAge < rules.hsts.minMaxAgeSeconds) add('hsts', 'warn', Number.isFinite(maxAge) ? ['hsts_short', { maxAge, min: rules.hsts.minMaxAgeSeconds }] : ['hsts_no_maxage', { min: rules.hsts.minMaxAgeSeconds }], `HSTS max-age ${Number.isFinite(maxAge) ? maxAge : 'missing'} is below ${rules.hsts.minMaxAgeSeconds} (1 year).`);
    if (!out.hsts.includeSubDomains) add('hsts', 'info', 'hsts_no_subdomains', 'HSTS lacks includeSubDomains (needed for preload eligibility).');
  }

  const summary = { fail: 0, warn: 0, info: 0, 'not-run': 0 };
  for (const f of findings) if (f.severity in summary) summary[f.severity]++;
  return { ...out, findings, summary, rulesVersion: rules.version ?? null };
}
