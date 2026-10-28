// Google search results overlay (content script, Google web search pages only; see manifest
// content_scripts). Numbers organic results, labels ads separately, adds SERP feature chips and a
// floating panel with counts, toggles, CSV export, AI Overview sources and a locale switcher.
//
// Privacy: this script makes NO network request of any kind. It reads the page that is already
// loaded and the extension's own settings (chrome.storage). check-dist fails the build if the bundle
// contains fetch / XMLHttpRequest / sendBeacon / WebSocket / EventSource.
// Robustness: every step is wrapped; on any error the page is left as Google rendered it.

import { classifySerp, serpPage, serpCsv, aioCsv, serpFileName, domainMatches } from '../lib/serp.mjs';
import { mergeSettings, fontPx } from '../lib/settings.mjs';
import MESSAGES from 'seorius:serp-messages';

const NODE = 'data-seorius-serp'; // on every node Seorius inserts (the classifier skips these)
const MARK = ['data-seorius-serp-ad', 'data-seorius-serp-mine', 'data-seorius-serp-feature'];
const COUNTRIES = ['us', 'tr', 'gb', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'ru', 'br', 'mx', 'ca', 'au', 'in', 'jp', 'kr', 'sa', 'ae', 'az', 'ua', 'at', 'ch', 'be', 'se', 'no', 'dk', 'fi', 'pt', 'gr', 'ro', 'cz', 'hu', 'bg', 'ie', 'za', 'eg', 'pk', 'id', 'sg', 'ar', 'cl', 'nz'];
const LANGUAGES = ['en', 'tr', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'ru', 'pt', 'ar', 'ja', 'ko', 'az', 'uk', 'sv', 'no', 'da', 'fi', 'el', 'ro', 'cs', 'hu', 'bg', 'id', 'ur'];

let settings = mergeSettings({});
let lang = 'en';
let result = null;
let signature = '';
let host = null; let shadow = null;
let observer = null; let timer = null; let lastHref = location.href;

// ---------------------------------------------------------------- text

function t(key, params = {}) {
  const m = (MESSAGES[lang] && MESSAGES[lang][key]) || MESSAGES.en[key] || key;
  return m.replace(/\{(\w+)\}/g, (_, p) => (params[p] !== undefined ? String(params[p]) : ''));
}
function resolveLang(s) {
  if (s.lang === 'tr' || s.lang === 'en') return s.lang;
  let ui = 'en';
  try { ui = chrome.i18n.getUILanguage(); } catch { /* keep */ }
  return String(ui).toLowerCase().startsWith('tr') ? 'tr' : 'en';
}
function displayName(code, type) {
  try { return new Intl.DisplayNames([lang], { type }).of(type === 'region' ? code.toUpperCase() : code) || code; } catch { return code; }
}

// ---------------------------------------------------------------- DOM helpers

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

/** Google light or dark: page background luminance, falling back to the OS setting. */
function isDark() {
  try {
    for (const n of [document.body, document.documentElement]) {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(getComputedStyle(n).backgroundColor);
      if (m && (m[4] === undefined || Number(m[4]) > 0.5)) return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 < 0.45;
    }
  } catch { /* fall through */ }
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

/** A node Seorius inserts into Google's markup: tagged, themed and sized. */
function tagNode(tag, kind, text, dark) {
  const n = el(tag, { [NODE]: kind, 'data-theme': dark ? 'dark' : 'light' }, text);
  n.style.setProperty('--seorius-fs', `${fontPx(settings)}px`);
  return n;
}

function cleanup() {
  document.querySelectorAll(`[${NODE}]:not([${NODE}="panel"])`).forEach((n) => n.remove());
  for (const a of MARK) document.querySelectorAll(`[${a}]`).forEach((n) => n.removeAttribute(a));
}

function removePanel() { if (host) { host.remove(); host = null; shadow = null; } }

// ---------------------------------------------------------------- page marks

function renderMarks(dark) {
  const s = settings.serp;
  for (const o of result.organic) {
    const mine = domainMatches(o.domain, s.myDomain);
    if (mine) o.el.setAttribute('data-seorius-serp-mine', '');
    if (s.numbers) {
      const b = tagNode('span', 'pos', String(o.position), dark);
      b.title = t('serp_pos_title', { n: o.position });
      b.setAttribute('aria-label', t('serp_pos_title', { n: o.position }));
      o.heading.prepend(b);
    }
    if (mine) o.heading.prepend(tagNode('span', 'mine', t('serp_my_domain'), dark));
  }
  if (s.ads) {
    for (const a of result.ads) {
      a.el.setAttribute('data-seorius-serp-ad', a.slot);
      a.el.prepend(tagNode('div', 'ad', `${t('serp_ad_badge', { n: a.n })} · ${t(a.slot === 'top' ? 'serp_ad_top' : 'serp_ad_bottom')}`, dark));
    }
  }
  if (s.features) {
    for (const f of result.features) {
      const prev = f.el.getAttribute('data-seorius-serp-feature');
      f.el.setAttribute('data-seorius-serp-feature', prev ? `${prev} ${f.kind}` : f.kind);
      f.el.prepend(tagNode('div', 'chip', t(`serp_feat_${f.kind}`), dark));
    }
  }
}

// ---------------------------------------------------------------- panel

const PANEL_CSS = `
:host{all:initial}
.p{--bg:#fff;--fg:#10243a;--muted:#5b6b7f;--line:#dde4ec;--soft:#f2f6f9;--accent:#10243a;--on-accent:#fff;--ad:#b45309;
  position:fixed;right:16px;bottom:16px;z-index:2147483000;width:340px;max-height:70vh;overflow:auto;box-sizing:border-box;
  font:var(--fs)/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg);background:var(--bg);
  border:1px solid var(--line);border-radius:10px;box-shadow:0 6px 24px rgba(16,36,58,.22)}
.p.dark{--bg:#0b1a2b;--fg:#e6edf3;--muted:#9aabbd;--line:#22364d;--soft:#12263c;--accent:#7fd8c8;--on-accent:#10243a;--ad:#f5b26b}
.p *{box-sizing:border-box;font:inherit}
.p.collapsed{width:auto;overflow:hidden}
.h{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid var(--line)}
.p.collapsed .h{border-bottom:none}
.brand{font-weight:700}.brand b{color:var(--accent)}
.b{padding:8px 10px;border-bottom:1px solid var(--line)}
.b:last-child{border-bottom:none}
.n{font-weight:700}.ad{color:var(--ad)}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.chip{background:var(--soft);border:1px solid var(--line);border-radius:4px;padding:0 6px}
.muted{color:var(--muted)}
label{display:flex;align-items:center;gap:6px;margin:2px 0;cursor:pointer}
button,select{border:1px solid var(--line);background:var(--soft);color:var(--fg);border-radius:5px;padding:3px 9px;cursor:pointer;max-width:100%}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
button:focus-visible,select:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px}
ol{margin:4px 0 0;padding-left:22px}li{margin:2px 0;word-break:break-word}
a{color:var(--accent)}
h3{margin:0 0 4px;font-weight:700}
`;

function savePatch(patch) {
  settings = mergeSettings({ ...settings, serp: { ...settings.serp, ...patch } });
  try { chrome.storage.sync.set({ settings }); } catch { /* extension reloaded: keep local state */ }
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = el('a', { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function featureSummary() {
  const counts = new Map();
  for (const f of result.features) counts.set(f.kind, (counts.get(f.kind) || 0) + 1);
  return [...counts];
}

function renderPanel(dark) {
  if (!host) {
    host = el('div', { [NODE]: 'panel', id: 'seorius-serp-panel' });
    shadow = host.attachShadow({ mode: 'closed' });
    try { const sheet = new CSSStyleSheet(); sheet.replaceSync(PANEL_CSS); shadow.adoptedStyleSheets = [sheet]; } catch { shadow.append(el('style', {}, PANEL_CSS)); }
    document.documentElement.append(host);
  }
  const s = settings.serp;
  const p = el('div', { class: `p${dark ? ' dark' : ''}${s.collapsed ? ' collapsed' : ''}`, role: 'region', 'aria-label': t('serp_title') });
  p.style.setProperty('--fs', `${fontPx(settings)}px`);
  const top = result.ads.filter((a) => a.slot === 'top').length;
  p.append(el('div', { class: 'h' },
    el('span', { class: 'brand' }, 'Seorius ', el('b', {}, 'SERP'), s.collapsed ? el('span', { class: 'muted' }, ` · ${result.organic.length} / ${result.ads.length}`) : null),
    el('button', { type: 'button', 'aria-expanded': s.collapsed ? 'false' : 'true', onclick: () => { savePatch({ collapsed: !s.collapsed }); renderPanel(isDark()); } }, s.collapsed ? t('serp_expand') : t('serp_collapse'))));
  if (!s.collapsed) {
    const feats = featureSummary();
    p.append(
      el('div', { class: 'b' },
        el('div', {}, t('serp_organic'), ': ', el('span', { class: 'n' }, String(result.organic.length)),
          result.organic.length ? el('span', { class: 'muted' }, ` (${result.organic[0].position}–${result.organic[result.organic.length - 1].position})`) : null),
        el('div', { class: 'ad' }, t('serp_ads'), ': ', el('span', { class: 'n' }, String(result.ads.length)), ` (${t('serp_ad_top')} ${top} · ${t('serp_ad_bottom')} ${result.ads.length - top})`),
        el('div', { class: 'muted' }, t('serp_features'), ':'),
        feats.length ? el('div', { class: 'chips' }, feats.map(([k, n]) => el('span', { class: 'chip' }, n > 1 ? `${t(`serp_feat_${k}`)} ×${n}` : t(`serp_feat_${k}`)))) : el('div', { class: 'muted' }, t('serp_none'))),
      el('div', { class: 'b' },
        ['numbers', 'ads', 'features'].map((k) => el('label', {}, el('input', { type: 'checkbox', checked: s[k], onchange: (e) => savePatch({ [k]: e.target.checked }) }), t(`serp_toggle_${k}`))),
        el('div', { class: 'row' }, el('button', { type: 'button', class: 'primary', onclick: () => download(serpFileName(result.page.query), serpCsv(result)) }, t('serp_export')))));
    if (result.aiOverview) {
      const src = result.aiOverview.sources;
      p.append(el('div', { class: 'b' }, el('h3', {}, t('serp_aio_title', { n: src.length })),
        el('ol', {}, src.map((x) => el('li', {}, el('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer' }, x.domain), x.title ? el('span', { class: 'muted' }, ` — ${x.title}`) : null))),
        el('div', { class: 'row' }, el('button', { type: 'button', onclick: () => download(serpFileName(result.page.query, 'seorius-ai-overview'), aioCsv(src)) }, t('serp_aio_export')))));
    }
    const gl = el('select', { 'aria-label': t('serp_country') }, el('option', { value: '' }, `${t('serp_country')}: —`), COUNTRIES.map((c) => el('option', { value: c, selected: result.page.gl === c }, `${displayName(c, 'region')} (${c})`)));
    const hl = el('select', { 'aria-label': t('serp_language') }, el('option', { value: '' }, `${t('serp_language')}: —`), LANGUAGES.map((c) => el('option', { value: c, selected: result.page.hl === c }, `${displayName(c, 'language')} (${c})`)));
    p.append(el('div', { class: 'b' }, el('h3', {}, t('serp_locale')), el('div', { class: 'row' }, gl, hl,
      el('button', { type: 'button', onclick: () => {
        const u = new URL(location.href);
        for (const [k, v] of [['gl', gl.value], ['hl', hl.value]]) { if (v) u.searchParams.set(k, v); else u.searchParams.delete(k); }
        location.assign(u.href);
      } }, t('serp_apply')))),
    el('div', { class: 'b muted' }, t('serp_privacy')));
  }
  shadow.replaceChildren(p);
}

// ---------------------------------------------------------------- run loop

function sig(r) {
  return JSON.stringify([location.href, settings, r.organic.map((o) => o.url), r.ads.map((a) => a.title), r.features.map((f) => f.kind), r.aiOverview ? r.aiOverview.sources.length : 0]);
}

function run(force = false) {
  observer && observer.disconnect();
  try {
    const page = serpPage(location.href);
    if (page.skip || !settings.serp.enabled) { cleanup(); removePanel(); result = null; signature = ''; return; }
    const r = classifySerp(document, location.href);
    if (r.skip) { cleanup(); removePanel(); return; }
    const sgn = sig(r);
    const intact = document.querySelector(`[${NODE}]:not([${NODE}="panel"])`) || (!settings.serp.numbers && !settings.serp.ads && !settings.serp.features);
    if (!force && sgn === signature && intact && host && host.isConnected) return;
    signature = sgn;
    result = r;
    cleanup();
    const dark = isDark();
    renderMarks(dark);
    renderPanel(dark);
  } catch (e) {
    // Never break Google: drop our marks and stay quiet.
    try { cleanup(); } catch { /* ignore */ }
    console.debug('[Seorius SERP]', e);
  } finally {
    observe();
  }
}

function schedule(ms = 500, force = false) {
  clearTimeout(timer);
  timer = setTimeout(() => run(force), ms);
}

function observe() {
  if (!observer) {
    observer = new MutationObserver(() => {
      if (location.href !== lastHref) { lastHref = location.href; signature = ''; schedule(300, true); } else schedule(600);
    });
  }
  observer.takeRecords();
  try { observer.observe(document.documentElement, { childList: true, subtree: true }); } catch { /* ignore */ }
}

(async function main() {
  if (window.top !== window || globalThis.__seoriusSerp) return;
  globalThis.__seoriusSerp = true;
  try { const { settings: st } = await chrome.storage.sync.get('settings'); settings = mergeSettings(st); } catch { /* defaults */ }
  lang = resolveLang(settings);
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'sync' || !ch.settings) return;
      settings = mergeSettings(ch.settings.newValue);
      lang = resolveLang(settings);
      signature = '';
      schedule(0, true);
    });
  } catch { /* ignore */ }
  addEventListener('popstate', () => schedule(300, true));
  addEventListener('pageshow', () => schedule(300, true));
  run(true);
})();
