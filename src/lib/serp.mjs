// Google web search result page (SERP) classifier. Pure: takes a Document-like object (the real page
// document, or test/helpers/mini-dom.mjs in tests) and returns organic results, ads, SERP features and
// the AI Overview. No network, no globals, never throws on unexpected markup (callers still wrap it).
//
// Design: Google's class names are obfuscated and change often, so every rule here leans on structure
// that carries meaning (a heading inside a link, a displayed-URL <cite>, links to Google's ad-click
// path, expandable question rows, Google's own custom elements) and uses heading words only as one
// signal among several. Written for Seorius from scratch.

import { toCsv } from './csv.mjs';

/** Google search hosts the content script runs on. Single source for the manifest test and check-dist. */
export const SERP_HOSTS = [
  'www.google.com', 'www.google.com.tr', 'www.google.co.uk', 'www.google.de', 'www.google.fr', 'www.google.es',
  'www.google.it', 'www.google.nl', 'www.google.pl', 'www.google.ru', 'www.google.com.br', 'www.google.com.mx',
  'www.google.ca', 'www.google.com.au', 'www.google.co.in', 'www.google.co.jp', 'www.google.co.kr', 'www.google.com.sa',
  'www.google.ae', 'www.google.az', 'www.google.com.ua', 'www.google.at', 'www.google.ch', 'www.google.be',
  'www.google.se', 'www.google.no', 'www.google.dk', 'www.google.fi', 'www.google.pt', 'www.google.gr',
  'www.google.ro', 'www.google.cz', 'www.google.hu', 'www.google.bg', 'www.google.ie', 'www.google.co.za',
  'www.google.com.eg', 'www.google.com.pk', 'www.google.co.id', 'www.google.com.sg', 'www.google.com.ar', 'www.google.cl',
  'www.google.co.nz',
];
export const SERP_MATCHES = SERP_HOSTS.map((h) => `https://${h}/search*`);

export const FEATURES = ['featured_snippet', 'paa', 'local_pack', 'video', 'images', 'top_stories', 'sitelinks', 'ai_overview'];

// Heading words, used only together with a structural signal. Lower-case, matched as substrings.
const WORDS = {
  featured_snippet: ['featured snippet', 'öne çıkan snippet', 'hervorgehobenes snippet', 'extrait optimisé', 'fragmento destacado', 'snippet in primo piano'],
  paa: ['people also ask', 'diğer kullanıcılar şunları da sordu', 'nutzer fragen auch', 'autres questions posées', 'otras preguntas', 'altre domande', 'andere vragen'],
  local_pack: ['places', 'yerler', 'işletmeler', 'orte', 'lieux', 'lugares', 'luoghi', 'locaties', 'businesses'],
  video: ['videos', 'videolar', 'vídeos', 'vidéos', 'video'],
  images: ['images', 'görseller', 'bilder', 'imágenes', 'immagini', 'afbeeldingen'],
  top_stories: ['top stories', 'öne çıkan haberler', 'haberler', 'schlagzeilen', 'à la une', 'noticias destacadas', 'notizie principali', 'nieuws'],
  ai_overview: ['ai overview', 'yapay zeka', 'yapay zekâ', 'ki-übersicht', 'aperçu ia', 'aperçu généré par l\'ia', 'visión general creada por ia', 'panoramica ai', 'ai による概要'],
};
const SPONSORED = ['sponsored', 'sponsorlu', 'reklam', 'ad', 'ads', 'anzeige', 'annonce', 'patrocinado', 'sponsorizzato', 'gesponsord', 'реклама'];
const VIDEO_HOST = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|tiktok\.com|facebook\.com\/watch|twitch\.tv)$/;
const OWN = 'data-seorius-serp';

// ---------------------------------------------------------------- URL helpers

/** {query, start, vertical, skip}. skip is true for non-Google hosts, non-/search paths and vertical tabs. */
export function serpPage(href) {
  let u;
  try { u = new URL(href); } catch { return { skip: true, reason: 'bad-url' }; }
  if (!SERP_HOSTS.includes(u.hostname) || u.pathname !== '/search') return { skip: true, reason: 'not-serp' };
  const tbm = u.searchParams.get('tbm');
  const udm = u.searchParams.get('udm');
  // tbm=<anything> is a vertical tab (isch, vid, shop, nws, bks, fin...). udm=14 is the plain "Web"
  // filter and keeps web results; every other udm value is a vertical (images, videos, shopping, AI mode).
  if (tbm) return { skip: true, reason: 'vertical', vertical: `tbm=${tbm}` };
  if (udm && udm !== '14') return { skip: true, reason: 'vertical', vertical: `udm=${udm}` };
  const start = Math.max(0, parseInt(u.searchParams.get('start') || '0', 10) || 0);
  return { skip: false, query: u.searchParams.get('q') || '', start, gl: u.searchParams.get('gl') || '', hl: u.searchParams.get('hl') || '' };
}

const isGoogleHost = (h) => /(^|\.)google\.[a-z.]+$/.test(h);

/** Resolves an href against the page and unwraps Google's /url?q= redirect. Never fetches anything. */
export function unwrapUrl(href, base) {
  if (!href) return null;
  let u;
  try { u = new URL(href, base); } catch { return null; }
  if (isGoogleHost(u.hostname) && u.pathname === '/url') {
    const t = u.searchParams.get('q') || u.searchParams.get('url');
    if (t) { try { u = new URL(t); } catch { return null; } }
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  u.hash = '';
  return u.href;
}

export const domainOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** True for Google links that are not results (search, maps, image viewer, ad click). */
function isGoogleInternal(url) {
  try {
    const u = new URL(url);
    return isGoogleHost(u.hostname) && /^\/(search|maps|aclk|url|imgres|shopping|preferences|setprefs|webhp|travel|finance)\b/.test(u.pathname);
  } catch { return true; }
}

export const isAdHref = (href) => /\/aclk\?|googleadservices\.com\/pagead\/aclk|\/pagead\/aclk/i.test(String(href || ''));

/** "example.com" matches example.com and its subdomains. */
export function domainMatches(domain, mine) {
  const m = String(mine || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (!m || !domain) return false;
  const d = domain.toLowerCase();
  return d === m || d.endsWith(`.${m}`);
}

// ---------------------------------------------------------------- DOM helpers (work on mini-dom too)

const own = (n) => n.nodeType === 1 && typeof n.getAttribute === 'function' && n.getAttribute(OWN) !== null;

/** Text of a node, skipping Seorius' own inserted nodes, scripts and styles. */
export function textOf(n) {
  if (!n) return '';
  if (n.nodeType === 3) return n.data || n.nodeValue || '';
  if (n.nodeType !== 1 || own(n) || n.localName === 'script' || n.localName === 'style') return '';
  let s = '';
  for (const c of n.childNodes) s += textOf(c);
  return s;
}
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function contains(a, b) {
  for (let p = b; p; p = p.parentNode) if (p === a) return true;
  return false;
}
function up(el, pred, stop) {
  for (let p = el; p && p.nodeType === 1 && p !== stop; p = p.parentNode) if (pred(p)) return p;
  return null;
}
const id = (el) => (el && el.getAttribute ? el.getAttribute('id') : null);
const hasWord = (text, list) => { const s = clean(text).toLowerCase(); return list.some((w) => s === w || s.startsWith(`${w} `) || s.includes(w)); };
/** querySelectorAll as an array (a real NodeList has no filter/map). */
const qa = (el, sel) => (el ? Array.from(el.querySelectorAll(sel)) : []);
const headingsIn = (el) => qa(el, 'h1, h2, h3, h4, [role="heading"]');

/** Lowest common ancestor of a list of elements. */
function lca(els) {
  if (!els.length) return null;
  let a = els[0];
  for (const e of els.slice(1)) { while (a && !contains(a, e)) a = a.parentNode; }
  return a && a.nodeType === 1 ? a : null;
}

// ---------------------------------------------------------------- classifier

/**
 * @param {Document} doc
 * @param {string} href page URL (for start=, link resolution)
 * @returns {{skip, page, organic:[], ads:[], features:[], aiOverview, counts}}
 *   organic: {el (result block), link, heading, position, title, url, domain, displayed, features:[]}
 *   ads:     {el, n, slot:'top'|'bottom', title, url, domain, displayed}
 *   features:{kind, el}
 */
export function classifySerp(doc, href) {
  const page = serpPage(href);
  const empty = { skip: true, page, organic: [], ads: [], features: [], aiOverview: null, counts: { organic: 0, ads: 0 } };
  if (page.skip) return empty;
  const root = doc.querySelector('#center_col') || doc.querySelector('#rcnt') || doc.querySelector('#main') || doc.body;
  if (!root) return empty;
  const rhs = doc.querySelector('#rhs');
  const order = new Map();
  qa(root, '*').forEach((e, i) => order.set(e, i));
  const pos = (e) => (order.has(e) ? order.get(e) : -1);
  const outsideRhs = (e) => !rhs || !contains(rhs, e);

  // 1. Raw title candidates: a link that contains a heading (h3 or role=heading), or a heading that contains a link.
  const raw = [];
  const seenLink = new Set();
  for (const h of qa(root, 'h3, [role="heading"]')) {
    if (own(h) || !outsideRhs(h)) continue;
    let link = up(h, (p) => p.localName === 'a' && p.getAttribute('href') !== null, root);
    if (!link) link = h.querySelector('a[href]');
    if (!link || seenLink.has(link)) continue;
    seenLink.add(link);
    raw.push({ heading: h, link, href: link.getAttribute('href') || '' });
  }
  const rawIn = (el) => raw.filter((c) => contains(el, c.link));

  /** Widens a core element to the largest ancestor that holds no title candidate from outside the core. */
  function blockOf(core) {
    const inside = new Set(rawIn(core).map((c) => c.link));
    let b = core;
    while (b.parentNode && b.parentNode !== root && b.parentNode.nodeType === 1) {
      const p = b.parentNode;
      if (rawIn(p).some((c) => !inside.has(c.link))) break;
      b = p;
    }
    return b;
  }

  // 2. Ads: known ad regions, units marked as text ads, links to the ad-click path, and the sponsored label.
  const adUnits = [];
  const addAd = (el) => { if (el && !adUnits.some((u) => contains(u, el) || contains(el, u))) adUnits.push(el); };
  for (const u of qa(root, '[data-text-ad]')) addAd(u);
  const adRegions = ['#tads', '#tadsb', '#bottomads'].map((s) => doc.querySelector(s)).filter(Boolean);
  const adLinks = qa(root, 'a[href]').filter((a) => isAdHref(a.getAttribute('href')) || isAdHref(a.getAttribute('data-rw')) || isAdHref(a.getAttribute('data-pcu')));
  for (const a of adLinks) {
    if (adUnits.some((u) => contains(u, a))) continue;
    // A row of product ads in a scroller is one ad unit.
    const scroller = up(a, (p) => p.localName === 'g-scrolling-carousel' || p.getAttribute('role') === 'list', root);
    addAd(scroller ? blockOf(scroller) : blockOf(up(a, (p) => headingsIn(p).length > 0 || p.parentNode === root, root) || a));
  }
  // Sponsored label: a short text node whose whole text is a sponsored word, next to a heading link.
  for (const s of qa(root, 'span, div')) {
    if (s.children.length || own(s)) continue;
    const tx = clean(textOf(s)).toLowerCase();
    if (!tx || tx.length > 14 || !SPONSORED.includes(tx)) continue;
    const unit = up(s, (p) => rawIn(p).length > 0, root);
    if (unit && rawIn(unit).length === 1) addAd(blockOf(unit));
  }
  for (const r of adRegions) if (!adUnits.some((u) => contains(r, u)) && rawIn(r).length) addAd(r);
  const inAd = (el) => adUnits.some((u) => contains(u, el)) || adRegions.some((r) => contains(r, el));

  // 3. Features.
  const features = [];
  const addFeature = (kind, core) => {
    if (!core || !outsideRhs(core) || inAd(core)) return;
    const el = blockOf(core);
    if (features.some((f) => f.kind === kind && (contains(f.el, el) || contains(el, f.el)))) return;
    features.push({ kind, el });
  };

  // AI Overview: a level-2 heading with AI-overview words, a section of 120+ characters and 2+ distinct cited sites.
  let aiOverview = null;
  for (const h of qa(root, 'h1, h2, [role="heading"][aria-level="2"], [role="heading"][aria-level="1"]')) {
    if (own(h) || !outsideRhs(h) || !hasWord(textOf(h), WORDS.ai_overview)) continue;
    let sec = h;
    while (sec.parentNode && sec.parentNode !== root && sec.parentNode.nodeType === 1) {
      const p = sec.parentNode;
      if (clean(textOf(sec)).length >= 120 && citedLinks(sec, href).length >= 2) break;
      // Never grow into regular results (they carry a displayed-URL <cite>).
      if (qa(p, 'cite').length > qa(sec, 'cite').length) break;
      sec = p;
    }
    const sources = citedLinks(sec, href);
    if (clean(textOf(sec)).length >= 120 && sources.length >= 2) {
      aiOverview = { el: sec, sources };
      addFeature('ai_overview', sec);
      break;
    }
  }

  // People also ask: 2+ expandable rows whose text reads as a question, or Google's question-row element.
  const qRows = qa(root, 'related-question-pair, [data-q], [aria-expanded]')
    .filter((e) => !own(e) && outsideRhs(e) && (e.localName === 'related-question-pair' || e.getAttribute('data-q') !== null || /[?？؟]\s*$/.test(clean(textOf(e)).slice(0, 300))));
  if (qRows.length >= 2) {
    const groups = [];
    for (const q of qRows) {
      // One question can match twice (row element + its expandable child): keep the outer one.
      if (groups.some((x) => x.some((y) => contains(y, q) || contains(q, y)))) continue;
      const g = groups.find((x) => { const c = lca([x[0], q]); return c && c !== root && pos(q) - pos(x[x.length - 1]) < 400; });
      if (g) g.push(q); else groups.push([q]);
    }
    for (const g of groups) if (g.length >= 2) addFeature('paa', lca(g));
  }

  // Featured snippet: Google's block-component wrapper, or a heading that names it.
  for (const b of qa(root, 'block-component')) addFeature('featured_snippet', b);
  for (const h of qa(root, 'h2, [role="heading"]')) {
    if (!own(h) && hasWord(textOf(h), WORDS.featured_snippet)) addFeature('featured_snippet', h.parentNode && h.parentNode !== root ? h.parentNode : h);
  }

  // Video carousel: Google's video element, or a scroller/heading section with 2+ links to video hosts.
  for (const v of qa(root, 'video-voyager')) addFeature('video', v);
  const linkHosts = (el) => qa(el, 'a[href]').map((a) => unwrapUrl(a.getAttribute('href'), href)).filter(Boolean).map((u) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + x.pathname + x.search; } catch { return ''; } });
  for (const sec of sectionsWithHeading(root, WORDS.video)) {
    const vids = new Set(linkHosts(sec).filter((h) => VIDEO_HOST.test(h.split('/')[0]) || /^youtube\.com\/watch/.test(h)));
    if (vids.size >= 2) addFeature('video', sec);
  }
  for (const c of qa(root, 'g-scrolling-carousel')) {
    const vids = new Set(linkHosts(c).filter((h) => /^(youtube\.com\/watch|youtu\.be\/|vimeo\.com\/\d|dailymotion\.com\/video|tiktok\.com\/@)/.test(h)));
    if (vids.size >= 2) addFeature('video', c);
  }

  // Image pack: 3+ links into Google Images (tbm=isch / udm=2 / imgres) in one block.
  const imgLinks = qa(root, 'a[href]').filter((a) => !own(a) && outsideRhs(a) && /[?&](tbm=isch|udm=2)\b|\/imgres\?/.test(a.getAttribute('href') || ''));
  if (imgLinks.length >= 3) {
    const groups = [];
    for (const a of imgLinks) { const g = groups.find((x) => pos(a) - pos(x[x.length - 1]) < 200); if (g) g.push(a); else groups.push([a]); }
    for (const g of groups) if (g.length >= 3) { const c = lca(g); if (c && c !== root) addFeature('images', c); }
  }

  // Local pack: a link into Google Maps plus 2+ place entries (data-cid) or a places heading.
  for (const sec of [...sectionsWithHeading(root, WORDS.local_pack), ...qa(root, '[data-cid]').map((e) => e.parentNode)]) {
    if (!sec || sec === root) continue;
    const s = up(sec, (p) => qa(p, 'a[href*="/maps"]').length > 0 || qa(p, '[data-cid]').length >= 2, root) || sec;
    const maps = qa(s, 'a[href*="/maps"]').length > 0;
    const places = qa(s, '[data-cid]').length;
    if (maps && (places >= 2 || hasWord(textOf(headingsIn(s)[0]), WORDS.local_pack))) addFeature('local_pack', s);
  }

  // Top stories: a section headed with news words holding 2+ article links to distinct sites.
  for (const sec of sectionsWithHeading(root, WORDS.top_stories)) {
    const sites = new Set(qa(sec, 'a[href]').map((a) => unwrapUrl(a.getAttribute('href'), href)).filter((u) => u && !isGoogleInternal(u)).map(domainOf));
    if (sites.size >= 2) addFeature('top_stories', sec);
  }

  // 4. Organic results: every candidate outside ads and non-result features.
  const excluded = features.filter((f) => f.kind !== 'featured_snippet').map((f) => f.el);
  const inExcluded = (el) => excluded.some((x) => contains(x, el)) || !!up(el, (p) => p.localName === 'g-scrolling-carousel' || p.localName === 'g-inner-card' || p.localName === 'related-question-pair', root);
  const organic = [];
  const seenUrl = new Set();
  for (const c of raw) {
    if (inAd(c.link) || inExcluded(c.link)) continue;
    const url = unwrapUrl(c.href, href);
    if (!url || isGoogleInternal(url) || isAdHref(c.href)) continue;
    // The result's own area: the largest ancestor that holds no other candidate.
    let own_ = c.link;
    while (own_.parentNode && own_.parentNode !== root && rawIn(own_.parentNode).length === 1) own_ = own_.parentNode;
    const cite = own_.querySelector('cite');
    const snippet = clean(textOf(own_)).length - clean(textOf(c.heading)).length >= 40;
    if (!cite) {
      // No displayed URL: a sublink under a result (sitelinks) when the previous result is the same site.
      const prev = organic[organic.length - 1];
      if (prev && prev.domain === domainOf(url)) { if (!prev.features.includes('sitelinks')) prev.features.push('sitelinks'); if (!prev.sitelinks.includes(url)) { prev.sitelinks.push(url); prev.sitelinkEls.push(c.link); } seenUrl.add(url); continue; }
      // Otherwise keep it only when it still looks like a result (a snippet under the title).
      if (!snippet) continue;
    }
    if (seenUrl.has(url)) continue;
    seenUrl.add(url);
    const block = blockOf(own_);
    const fs = features.filter((f) => f.kind === 'featured_snippet' && (contains(f.el, c.link) || contains(block, f.el) || contains(f.el, block))).map((f) => f.kind);
    organic.push({ el: block, link: c.link, heading: c.heading, title: clean(textOf(c.heading)), url, domain: domainOf(url), displayed: cite ? clean(textOf(cite)) : '', features: fs, sitelinks: [], sitelinkEls: [] });
  }
  // A result with sitelinks: its block is the area holding the title and all its sublinks.
  for (const o of organic) {
    if (o.sitelinkEls.length) { const core = lca([o.link, ...o.sitelinkEls]); if (core && core !== root) o.el = blockOf(core); }
    delete o.sitelinkEls;
  }
  organic.forEach((o, i) => { o.position = page.start + i + 1; });
  for (const o of organic) if (o.features.includes('sitelinks')) features.push({ kind: 'sitelinks', el: o.el });

  // 5. Number ads in page order; "top" = before the first organic result.
  const firstOrganic = organic.length ? pos(organic[0].el) : Infinity;
  const ads = adUnits.filter(outsideRhs).sort((a, b) => pos(a) - pos(b)).map((el, i) => {
    const link = qa(el, 'a[href]').find((a) => headingsIn(a).length || up(a, (p) => p.getAttribute('role') === 'heading', el)) || el.querySelector('a[href]');
    const h = link ? (headingsIn(link)[0] || link) : el;
    const rawHref = link ? link.getAttribute('href') : '';
    const shown = el.querySelector('cite') || el.querySelector('[data-dtld]');
    // Ad-click links hide the landing page; the displayed URL is what the advertiser shows.
    const url = rawHref && !isAdHref(rawHref) ? unwrapUrl(rawHref, href) : '';
    const displayed = shown ? clean(textOf(shown)) : '';
    const shownHost = (shown && shown.getAttribute('data-dtld')) || displayed.replace(/^https?:\/\//i, '').split(/[\s›/]/)[0];
    return { el, n: i + 1, slot: pos(el) < firstOrganic ? 'top' : 'bottom', title: clean(textOf(h)), url: url || '', domain: url ? domainOf(url) : domainOf(`https://${shownHost}`), displayed, heading: h };
  });

  return { skip: false, page, organic, ads, features, aiOverview, counts: { organic: organic.length, ads: ads.length } };
}

/**
 * Sections introduced by a heading with one of the words. The heading's parent is widened while the
 * heading stays the first heading inside it and no new displayed-URL <cite> (a regular result) comes in.
 */
function sectionsWithHeading(root, words) {
  const out = [];
  for (const h of qa(root, 'h2, h3, [role="heading"]')) {
    if (own(h)) continue;
    const tx = clean(textOf(h)).toLowerCase();
    if (!tx || tx.length > 60 || !words.some((w) => tx === w || tx.startsWith(w))) continue;
    let s = h.parentNode;
    if (!s || s === root) continue;
    while (s.parentNode && s.parentNode !== root && s.parentNode.nodeType === 1) {
      const p = s.parentNode;
      if (headingsIn(p)[0] !== h || qa(p, 'cite').length > qa(s, 'cite').length) break;
      s = p;
    }
    out.push(s);
  }
  return out;
}

/** Distinct cited external pages inside an element: [{title, url, domain}]. */
export function citedLinks(el, base) {
  const out = []; const seen = new Set();
  for (const a of qa(el, 'a[href]')) {
    if (own(a)) continue;
    const url = unwrapUrl(a.getAttribute('href'), base);
    if (!url || isGoogleInternal(url) || isAdHref(a.getAttribute('href'))) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ title: clean(textOf(a)) || clean(a.getAttribute('aria-label')), url, domain: domainOf(url) });
  }
  return out;
}

// ---------------------------------------------------------------- CSV


export const SERP_CSV_HEADER = ['type', 'position', 'title', 'url', 'domain', 'displayed_url', 'features'];

/** Rows for the SERP CSV: ads (top), organic, ads (bottom), in page order. UTF-8 BOM included. */
export function serpCsv(result) {
  const ad = (a) => ['ad', a.n, a.title, a.url, a.domain, a.displayed, a.slot];
  const rows = [
    ...result.ads.filter((a) => a.slot === 'top').map(ad),
    ...result.organic.map((o) => ['organic', o.position, o.title, o.url, o.domain, o.displayed, o.features.join(' ')]),
    ...result.ads.filter((a) => a.slot === 'bottom').map(ad),
  ];
  return `﻿${toCsv(SERP_CSV_HEADER, rows)}`;
}

export function aioCsv(sources) {
  return `﻿${toCsv(['#', 'title', 'url', 'domain'], sources.map((s, i) => [i + 1, s.title, s.url, s.domain]))}`;
}

/** File name: "<query> - seorius-serp.csv", with characters Windows/macOS reject removed. */
export function serpFileName(query, suffix = 'seorius-serp') {
  const q = clean(String(query || 'serp').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')).slice(0, 80) || 'serp';
  return `${q} - ${suffix}.csv`;
}
