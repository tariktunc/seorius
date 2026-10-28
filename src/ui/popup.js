import { loadSettings, applyFontSize, resolveLang, loadLocale, applyI18n, t, el, sevBadge, findingText, checkName, isInspectable, scanTab, callInTab, watchTab, errorText, short } from './common.js';
import { renderPreview, kvTable, schemaTypeList } from './views.js';

let tab; let settings; let scan = null; let active = 'overview';
const $ = (id) => document.getElementById(id);

const TABS = ['overview', 'headings', 'images', 'links', 'social', 'schema'];

function statusOf(key) { return scan.audit.checks.find((c) => c.key === key)?.status || 'not-run'; }

function row(label, value, checkKey) {
  return el('div', { class: 'row' },
    el('div', { class: 'row-label' }, label, checkKey ? [' ', sevBadge(statusOf(checkKey))] : null),
    el('div', { class: 'row-value' }, value === null || value === undefined || value === '' ? el('em', { class: 'muted' }, t('val_missing')) : value));
}

function renderSummary() {
  const s = $('summary'); s.replaceChildren();
  if (!scan) return;
  const p = scan.network.page;
  const c = scan.audit.counts;
  s.append(
    el('div', { class: 'url', title: scan.url }, short(scan.url, 70)),
    el('div', { class: 'counts' },
      el('span', { class: 'http' }, p && !p.error ? `HTTP ${p.status}` : `HTTP ${t('val_unknown')}`),
      el('span', { class: 'cnt cnt-error' }, `${c.error} ${t('cnt_errors')}`),
      el('span', { class: 'cnt cnt-warning' }, `${c.warning} ${t('cnt_warnings')}`),
      el('span', { class: 'cnt cnt-notice' }, `${c.notice} ${t('cnt_notices')}`),
      el('span', { class: 'cnt cnt-not-run' }, `${c['not-run']} ${t('cnt_notrun')}`)));
}

function renderAttention() {
  const a = $('attention'); a.replaceChildren();
  if (!scan) return;
  a.append(el('h2', {}, t('needs_attention')));
  if (!scan.audit.attention.length) { a.append(el('p', { class: 'muted' }, t('attention_none'))); return; }
  a.append(el('ul', { class: 'findings' }, scan.audit.attention.map((f) => el('li', {}, sevBadge(f.severity), ' ', el('strong', {}, checkName(f.check)), ': ', findingText(f)))));
}

function renderTabs() {
  const n = $('tabs'); n.replaceChildren();
  for (const k of TABS) n.append(el('button', { type: 'button', role: 'tab', class: k === active ? 'tab active' : 'tab', 'aria-selected': k === active ? 'true' : 'false', onclick: () => { active = k; renderTabs(); renderPanel(); } }, t(`tab_${k}`)));
}

function renderPanel() {
  const p = $('panel'); p.replaceChildren();
  if (!scan) return;
  const e = scan.engine;
  if (active === 'overview') {
    p.append(
      row(t('f_title'), e.title.text ? `${e.title.text} (${t('chars', { n: e.title.length })})` : null, 'title'),
      row(t('f_description'), e.metaDescription.text ? `${e.metaDescription.text} (${t('chars', { n: e.metaDescription.length })})` : null, 'description'),
      row(t('f_canonical'), e.canonical.href ? `${e.canonical.href} — ${t(`rel_${e.canonical.relation.replace(/-/g, '_')}`)}` : null, 'canonical'),
      row(t('f_robots'), [e.robots.entries.map((x) => `${x.source}${x.agent !== '*' ? `/${x.agent}` : ''}: ${x.token}`).join(', ') || t('val_none_default')], 'robots'),
      row(t('f_lang'), e.lang, 'lang'),
      row('H1', e.headings.outline.filter((h) => h.level === 1).map((h) => h.text || t('val_empty')).join(' | ') || null, 'h1'));
  } else if (active === 'headings') {
    p.append(el('div', { class: 'chips' }, Object.entries(e.headings.counts).map(([k, v]) => el('span', { class: 'chip' }, `${k.toUpperCase()}: ${v}`))));
    p.append(el('ol', { class: 'outline' }, scan.headings.slice(0, 300).map((h) => el('li', { style: `margin-left:${(h.level - 1) * 12}px` }, el('span', { class: 'lvl' }, `H${h.level}`), ' ', h.text || el('em', { class: 'muted' }, t('val_empty')), h.hidden ? el('span', { class: 'tag' }, t('hidden')) : null))));
  } else if (active === 'images') {
    const i = e.images;
    p.append(row(t('img_total'), String(i.total)), row(t('img_alt_missing'), String(i.altMissing), 'images'), row(t('img_alt_empty'), String(i.altEmpty)), row(t('img_no_dims'), String(i.missingDimensions)), row(t('img_oversized'), String(scan.images.filter((x) => x.oversized).length), 'image-sizing'));
  } else if (active === 'links') {
    const l = scan.linkSummary;
    p.append(row(t('lk_internal'), String(l.internal), 'internal-links'), row(t('lk_subdomain'), String(l.subdomain)), row(t('lk_external'), String(l.external)), row(t('lk_other'), String(l.other)),
      row(t('lk_follow'), String(l.follow)), row('nofollow', String(l.nofollow)), row('sponsored', String(l.sponsored)), row('ugc', String(l.ugc)), row(t('lk_empty_anchor'), String(l.emptyAnchor), 'links'),
      el('p', { class: 'muted small' }, t('lk_unique_note')));
  } else if (active === 'social') {
    p.append(renderPreview(scan.social.preview), el('h3', {}, 'Open Graph'), kvTable(scan.social.og), el('h3', {}, 'Twitter / X'), kvTable(scan.social.twitter));
  } else if (active === 'schema') {
    p.append(schemaTypeList(scan.schema));
  }
}

async function overlaysSync() {
  try {
    const st = await callInTab(tab.id, 'overlayState');
    document.querySelectorAll('[data-overlay]').forEach((c) => { c.checked = !!st[c.dataset.overlay]; });
  } catch { /* ignore */ }
}

async function run() {
  $('panel').replaceChildren(el('p', { class: 'muted' }, t('scanning')));
  try {
    scan = await scanTab(tab.id, settings);
    renderSummary(); renderAttention(); renderTabs(); renderPanel();
  } catch (e) {
    scan = null; renderSummary(); renderAttention();
    $('panel').replaceChildren(el('p', { class: 'error' }, errorText(e)));
  }
}

(async function main() {
  settings = await loadSettings();
  applyFontSize(settings);
  await loadLocale(resolveLang(settings));
  applyI18n();
  // ?tab=<id> renders the popup against a given tab (used by the smoke test, which cannot click
  // the toolbar icon); access still depends on the extension's grant for that tab.
  const forced = Number(new URLSearchParams(location.search).get('tab'));
  if (Number.isInteger(forced) && forced > 0) tab = await chrome.tabs.get(forced);
  else [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('options').addEventListener('click', (ev) => { ev.preventDefault(); chrome.runtime.openOptionsPage(); });
  if (!tab || !isInspectable(tab.url)) {
    document.querySelectorAll('button, input').forEach((b) => { b.disabled = true; });
    $('panel').replaceChildren(el('p', { class: 'muted' }, t('err_not_inspectable')));
    return;
  }
  $('rescan').addEventListener('click', run);
  $('report').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL(`report.html?tab=${tab.id}`) }));
  document.querySelectorAll('[data-overlay]').forEach((c) => c.addEventListener('change', async () => {
    try { await callInTab(tab.id, 'overlay', c.dataset.overlay, c.checked, settings.overlayColors); } catch (e) { c.checked = false; $('panel').prepend(el('p', { class: 'error' }, errorText(e))); }
  }));
  renderTabs();
  await run();
  overlaysSync();
  watchTab(tab.id, () => run());
})();
