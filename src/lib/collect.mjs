// DOM collectors for the report tables. They use the plain DOM read surface, so they also run on
// test/helpers/mini-dom.mjs in Node. Live-only properties (naturalWidth, computed style,
// checkVisibility, styleSheets) are read only when present and otherwise reported as null.

const lname = (el) => String(el.localName || el.nodeName || '').toLowerCase();
const attr = (el, n) => (el.getAttribute ? el.getAttribute(n) : null);
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const all = (root, sel) => Array.from(root.querySelectorAll(sel));
const kids = (el) => Array.from(el.children || (el.childNodes || []).filter((c) => c.nodeType === 1));

export function baseUrl(doc, pageUrl) {
  const b = doc.querySelector ? doc.querySelector('base[href]') : null;
  try { return b ? new URL(attr(b, 'href'), pageUrl).toString() : pageUrl; } catch { return pageUrl; }
}
export function resolve(raw, base) {
  if (raw === null || raw === undefined) return null;
  try { return new URL(String(raw).trim(), base).toString(); } catch { return null; }
}

export function headDump(doc) {
  const head = doc.head || doc.querySelector('head');
  if (!head) return [];
  const seen = new Map();
  return kids(head).map((el) => {
    const tag = lname(el);
    const attrs = Array.from(el.attributes || []).map((a) => [a.name, a.value]);
    const keyAttr = tag === 'meta' ? (attr(el, 'name') || attr(el, 'property') || attr(el, 'http-equiv') || (attr(el, 'charset') !== null ? 'charset' : null)) : tag === 'link' ? `${attr(el, 'rel') || ''}|${attr(el, 'hreflang') || ''}|${attr(el, 'media') || ''}` : tag === 'title' || tag === 'base' ? tag : null;
    const dupKey = keyAttr ? `${tag}:${String(keyAttr).toLowerCase()}` : null;
    const n = dupKey ? (seen.get(dupKey) || 0) + 1 : 0;
    if (dupKey) seen.set(dupKey, n);
    const text = ['title', 'script', 'style', 'noscript'].includes(tag) ? squash(el.textContent).slice(0, 300) : '';
    return { tag, attrs, text, dupKey, occurrence: n };
  }).map((row, _, arr) => ({ ...row, duplicate: !!row.dupKey && !/^meta:(og:image|og:locale:alternate|article:tag|og:video)/.test(row.dupKey) && !/^link:alternate\|/.test(row.dupKey) && arr.filter((r) => r.dupKey === row.dupKey).length > 1 }));
}

export function pageInfo(doc, pageUrl, headers = {}) {
  const metas = all(doc, 'meta');
  const byName = (n) => metas.filter((m) => String(attr(m, 'name') || '').toLowerCase() === n).map((m) => attr(m, 'content') ?? '');
  const byEquiv = (n) => metas.filter((m) => String(attr(m, 'http-equiv') || '').toLowerCase() === n).map((m) => attr(m, 'content') ?? '');
  const base = baseUrl(doc, pageUrl);
  const links = all(doc, 'link');
  const relHas = (l, t) => String(attr(l, 'rel') || '').toLowerCase().split(/\s+/).includes(t);
  const icons = links.filter((l) => ['icon', 'shortcut', 'apple-touch-icon', 'apple-touch-icon-precomposed', 'mask-icon', 'manifest'].some((t) => relHas(l, t)))
    .map((l) => ({ rel: attr(l, 'rel'), href: resolve(attr(l, 'href'), base), sizes: attr(l, 'sizes'), type: attr(l, 'type') }));
  const keywords = byName('keywords')[0] ?? null;
  const xfn = {};
  const SKIP = new Set(['nofollow', 'noopener', 'noreferrer', 'sponsored', 'ugc', 'external']);
  for (const a of all(doc, 'a[rel]')) for (const t of String(attr(a, 'rel')).toLowerCase().split(/\s+/).filter(Boolean)) if (!SKIP.has(t)) xfn[t] = (xfn[t] || 0) + 1;
  return {
    keywords, keywordCount: keywords ? keywords.split(',').map((s) => s.trim()).filter(Boolean).length : 0,
    robotsMeta: ['robots', 'googlebot', 'googlebot-news', 'bingbot'].map((n) => ({ name: n, values: byName(n) })).filter((x) => x.values.length),
    xRobotsTag: headers['x-robots-tag'] || null,
    author: byName('author'), publisherMeta: byName('publisher'),
    relAuthor: links.filter((l) => relHas(l, 'author')).map((l) => resolve(attr(l, 'href'), base)).concat(all(doc, 'a[rel]').filter((a) => relHas(a, 'author')).map((a) => resolve(attr(a, 'href'), base))).slice(0, 10),
    relPublisher: links.filter((l) => relHas(l, 'publisher')).map((l) => resolve(attr(l, 'href'), base)),
    xfn,
    contentLanguage: byEquiv('content-language'), metaLanguage: byName('language'),
    generator: byName('generator'), themeColor: byName('theme-color'),
    icons, hasIconLink: icons.some((i) => /icon/i.test(i.rel || '') && !/apple|mask/i.test(i.rel || '')),
    base: base !== pageUrl ? base : null,
  };
}

function isHidden(el) {
  if (typeof el.checkVisibility === 'function') return !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  return null; // unknown outside a live page
}

export function headings(doc) {
  return all(doc, 'h1,h2,h3,h4,h5,h6').map((h) => ({ level: Number(lname(h)[1]), text: squash(h.textContent).slice(0, 200), hidden: isHidden(h) }));
}

export function formatOf(src) {
  if (!src) return 'unknown';
  const d = /^data:image\/([a-z0-9.+-]+)/i.exec(src);
  if (d) return d[1].toLowerCase().replace('svg+xml', 'svg').replace('jpeg', 'jpg');
  try {
    const ext = /\.([a-z0-9]{2,5})$/i.exec(new URL(src).pathname);
    if (!ext) return 'unknown';
    const e = ext[1].toLowerCase();
    return e === 'jpeg' ? 'jpg' : e;
  } catch { return 'unknown'; }
}

/** @param sizes Map<url, {encoded, decoded}> from Resource Timing (live page only) */
export function images(doc, pageUrl, sizes = new Map(), oversizedRenderRatio = 2) {
  const base = baseUrl(doc, pageUrl);
  return all(doc, 'img').slice(0, 1000).map((el) => {
    const cur = el.currentSrc || null;
    const raw = attr(el, 'src') || attr(el, 'data-src') || attr(el, 'data-lazy-src') || '';
    const src = cur || resolve(raw, base) || raw;
    const alt = attr(el, 'alt');
    let rendered = null;
    if (typeof el.getBoundingClientRect === 'function') { const r = el.getBoundingClientRect(); rendered = { w: Math.round(r.width), h: Math.round(r.height) }; }
    const natural = typeof el.naturalWidth === 'number' && el.naturalWidth ? { w: el.naturalWidth, h: el.naturalHeight } : null;
    const s = sizes.get(src);
    return {
      src, alt, altState: alt === null ? 'missing' : alt.trim() ? 'text' : 'empty',
      title: attr(el, 'title'), widthAttr: attr(el, 'width'), heightAttr: attr(el, 'height'),
      loading: attr(el, 'loading'), natural, rendered,
      oversized: !!(natural && rendered && rendered.w > 0 && natural.w >= rendered.w * oversizedRenderRatio),
      bytes: s && s.encoded > 0 ? s.encoded : null, bytesSource: s && s.encoded > 0 ? 'resource-timing' : null,
      format: formatOf(src),
    };
  });
}

export function anchorType(a) {
  if (squash(a.textContent)) return 'text';
  if (a.querySelector && a.querySelector('img')) return 'image';
  if (a.querySelector && a.querySelector('svg')) return 'svg';
  if (a.querySelector && a.querySelector('video,audio,picture,canvas')) return 'media';
  if (attr(a, 'aria-label') || attr(a, 'title') || attr(a, 'aria-labelledby')) return 'label';
  return 'empty';
}

export function linkDescriptors(doc, pageUrl) {
  const base = baseUrl(doc, pageUrl);
  return all(doc, 'a[href], area[href]').slice(0, 5000).map((a) => {
    const raw = attr(a, 'href');
    const type = anchorType(a);
    let text = squash(a.textContent).slice(0, 120);
    if (!text && type === 'image') text = `[img] ${squash(attr(a.querySelector('img'), 'alt') || '')}`.trim();
    if (!text && type === 'label') text = `[label] ${squash(attr(a, 'aria-label') || attr(a, 'title') || '')}`;
    return { raw, href: resolve(raw, base), text, anchorType: type, rel: attr(a, 'rel') || '' };
  });
}

export function iframes(doc, pageUrl) {
  let origin = null;
  try { origin = new URL(pageUrl).origin; } catch { /* keep */ }
  return all(doc, 'iframe, frame').slice(0, 200).map((f) => {
    const src = resolve(attr(f, 'src'), pageUrl);
    let sameOrigin = null;
    try { sameOrigin = src ? new URL(src).origin === origin : null; } catch { sameOrigin = null; }
    return { src: src || (attr(f, 'srcdoc') !== null ? '(srcdoc)' : '(none)'), title: attr(f, 'title'), sameOrigin, loading: attr(f, 'loading') };
  });
}

export function mediaQueries(doc) {
  if (!doc.styleSheets) return null;
  let count = 0; let readable = 0; let unreadable = 0;
  const walk = (rules) => {
    for (const r of rules) {
      if (r.type === 4 || (typeof CSSMediaRule !== 'undefined' && r instanceof CSSMediaRule)) count++;
      if (r.cssRules) walk(r.cssRules);
    }
  };
  for (const sh of Array.from(doc.styleSheets)) {
    try { walk(sh.cssRules); readable++; } catch { unreadable++; }
  }
  return { count, readableSheets: readable, unreadableSheets: unreadable };
}

export function visibleText(root) {
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'svg', 'iframe', 'textarea', 'select']);
  const BLOCK = /^(p|div|li|br|h[1-6]|tr|td|th|section|article|header|footer|nav|ul|ol|table|blockquote|main|aside|form|figure|figcaption|dd|dt)$/;
  const parts = [];
  const walk = (n) => {
    for (const c of n.childNodes || []) {
      if (c.nodeType === 3) parts.push(c.nodeValue ?? c.data ?? '');
      else if (c.nodeType === 1) {
        const t = lname(c);
        if (SKIP.has(t)) continue;
        const b = BLOCK.test(t);
        if (b) parts.push(' ');
        walk(c);
        if (b) parts.push(' ');
      }
    }
  };
  walk(root);
  return squash(parts.join(''));
}

export function sharePreview(r, pageUrl) {
  const og = r.openGraph || {}; const tw = r.twitterCard || {};
  const f = (v) => (Array.isArray(v) ? v[0] : v) || null;
  let host = '';
  try { host = new URL(pageUrl).hostname; } catch { /* keep */ }
  return {
    title: f(og['og:title']) || f(tw['twitter:title']) || r.title?.text || null,
    description: f(og['og:description']) || f(tw['twitter:description']) || r.metaDescription?.text || null,
    image: f(og['og:image']) || f(tw['twitter:image']) || null,
    site: f(og['og:site_name']) || host,
    source: { title: og['og:title'] ? 'og' : tw['twitter:title'] ? 'twitter' : 'title', image: og['og:image'] ? 'og' : tw['twitter:image'] ? 'twitter' : null },
  };
}
