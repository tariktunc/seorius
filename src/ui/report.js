import { loadSettings, applyFontSize, resolveLang, loadLocale, applyI18n, t, has, el, sevBadge, findingText, checkName, scanTab, storedScan, callInTab, watchTab, errorText, download, fmtBytes, short } from './common.js';
import { renderPreview, kvTable, table } from './views.js';
import { GROUPS } from '../lib/audit.mjs';
import { compareMatrix } from '../lib/compare.mjs';
import { toCsv, fileStamp } from '../lib/csv.mjs';
import { AGENTS } from '../lib/robots.mjs';
import SRULES from '../engine/seorius-rules.json';

const $ = (id) => document.getElementById(id);
const tabId = Number(new URLSearchParams(location.search).get('tab'));
let settings; let scan = null;
const linkStatus = new Map(); // url -> result
const imageBytes = new Map(); // url -> result
const ui = { linkFilter: 'all', imageFilter: 'all', compare: null, linkProgress: null, imageProgress: null };

const SECTIONS = ['audit', 'pageinfo', 'head', 'headings', 'images', 'links', 'keywords', 'social', 'schema', 'technical', 'rawrendered', 'frames', 'tracking', 'compare', 'tools', 'help', 'export'];

function section(id, ...content) {
  return el('section', { id: `s-${id}`, class: 'r-section' }, el('h2', {}, t(`sec_${id}`)), ...content);
}
const kvRows = (pairs) => el('table', { class: 'kv' }, el('tbody', {}, pairs.map(([k, v]) => el('tr', {}, el('th', {}, k), el('td', {}, v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) ? el('em', { class: 'muted' }, t('val_missing')) : Array.isArray(v) ? v.join(' | ') : v)))));
const yesNo = (b) => (b === null || b === undefined ? t('val_unknown') : b ? t('yes') : t('no'));

// ---------- sections ----------

function sAudit() {
  const wrap = el('div', {});
  wrap.append(el('p', { class: 'muted small' }, t('audit_note')));
  for (const g of GROUPS) {
    if (!settings.auditGroups[g]) continue;
    const checks = scan.audit.checks.filter((c) => c.group === g);
    wrap.append(el('h3', {}, t(`grp_${g}`)), el('ul', { class: 'checks' }, checks.map((c) => el('li', { class: `check st-${c.status}` },
      el('div', { class: 'check-head' }, sevBadge(c.status), ' ', el('strong', {}, checkName(c.key)), ' ', el('a', { href: `#help-${c.key}`, class: 'small' }, t('help_link'))),
      c.findings.length ? el('ul', { class: 'findings' }, c.findings.map((f) => el('li', {}, sevBadge(f.severity), ' ', findingText(f), f.fix_hint ? el('div', { class: 'fix' }, f.fix_hint) : null))) : el('div', { class: 'muted small' }, t('check_pass_note'))))));
  }
  if (resolveLang(settings) === 'tr') wrap.append(el('p', { class: 'muted small' }, t('engine_lang_note')));
  return section('audit', wrap);
}

function sPageInfo() {
  const e = scan.engine; const pi = scan.pageInfo; const m = scan.urlMetrics;
  return section('pageinfo', kvRows([
    [t('f_title'), e.title.text ? `${e.title.text} (${t('chars', { n: e.title.length })}, ${t('count_n', { n: e.title.count })})` : null],
    [t('f_description'), e.metaDescription.text ? `${e.metaDescription.text} (${t('chars', { n: e.metaDescription.length })}, ${t('count_n', { n: e.metaDescription.count })})` : null],
    [t('f_keywords'), pi.keywords !== null ? `${pi.keywords} (${pi.keywordCount})` : null],
    [t('f_robots'), pi.robotsMeta.map((r) => `${r.name}: ${r.values.join(' / ')}`)],
    ['X-Robots-Tag', pi.xRobotsTag],
    [t('f_canonical'), e.canonical.href ? `${e.canonical.href} → ${t(`rel_${e.canonical.relation.replace(/-/g, '_')}`)}${e.canonical.headerCanonical ? ` | Link header: ${e.canonical.headerCanonical}` : ''}` : null],
    [t('f_lang'), e.lang],
    [t('f_meta_language'), [...pi.contentLanguage.map((v) => `content-language: ${v}`), ...pi.metaLanguage.map((v) => `language: ${v}`)]],
    [t('f_charset'), [e.charset.meta && `meta: ${e.charset.meta}`, e.charset.header && `header: ${e.charset.header}`].filter(Boolean)],
    [t('f_doctype'), e.doctype],
    [t('f_viewport'), e.viewport],
    [t('f_author'), pi.author],
    [t('f_publisher'), [...pi.publisherMeta, ...pi.relPublisher]],
    ['rel=author', pi.relAuthor],
    [t('f_xfn'), Object.entries(pi.xfn).map(([k, v]) => `${k} (${v})`)],
    [t('f_icons'), pi.icons.map((i) => `${i.rel}: ${i.href || '?'}${i.sizes ? ` [${i.sizes}]` : ''}${i.type ? ` ${i.type}` : ''}`)],
    [t('f_base'), pi.base],
    [t('f_generator'), pi.generator],
    [t('f_url_quality'), m ? t('url_metrics', m) : null],
  ]));
}

function sHead() {
  return section('head', el('p', { class: 'muted small' }, t('head_note')), table([
    { label: '#', get: (r) => String(r.i + 1) },
    { label: t('col_tag'), get: (r) => r.tag },
    { label: t('col_attributes'), get: (r) => r.attrs.map(([k, v]) => `${k}="${short(v, 160)}"`).join(' '), cls: 'mono' },
    { label: t('col_text'), get: (r) => short(r.text, 160) },
    { label: t('col_duplicate'), get: (r) => (r.duplicate ? el('span', { class: 'sev sev-warning' }, t('duplicate')) : '') },
  ], scan.headDump.map((r, i) => ({ ...r, i }))));
}

function sHeadings() {
  const e = scan.engine;
  return section('headings',
    el('div', { class: 'chips' }, Object.entries(e.headings.counts).map(([k, v]) => el('span', { class: 'chip' }, `${k.toUpperCase()}: ${v}`))),
    el('ol', { class: 'outline' }, scan.headings.map((h, i) => {
      const prev = scan.headings[i - 1];
      const skip = prev && h.level - prev.level > 1;
      return el('li', { style: `margin-left:${(h.level - 1) * 18}px` }, el('span', { class: 'lvl' }, `H${h.level}`), ' ', h.text || el('em', { class: 'muted' }, t('val_empty')), h.hidden ? el('span', { class: 'tag' }, t('hidden')) : null, skip ? el('span', { class: 'tag warn' }, t('level_skip')) : null);
    })));
}

function bytesOf(img) {
  if (img.bytes) return { v: img.bytes, src: 'resource-timing' };
  const m = imageBytes.get(img.src);
  if (m && m.bytes !== null && m.bytes !== undefined) return { v: m.bytes, src: m.source };
  return { v: null, src: m ? m.reason : null };
}

function sImages() {
  const cols = settings.columns.images;
  const filters = ['all', 'missing-alt', 'empty-alt', 'oversized', 'no-dims'];
  const rows = scan.images.filter((i) => ui.imageFilter === 'all' || (ui.imageFilter === 'missing-alt' && i.altState === 'missing') || (ui.imageFilter === 'empty-alt' && i.altState === 'empty') || (ui.imageFilter === 'oversized' && (i.oversized || (bytesOf(i).v || 0) >= SRULES.images.oversizedBytes)) || (ui.imageFilter === 'no-dims' && (!i.widthAttr || !i.heightAttr)));
  const all = [
    ['src', { label: 'src', get: (r) => el('a', { href: r.src, target: '_blank', rel: 'noopener noreferrer', title: r.src }, short(r.src, 70)), cls: 'mono' }],
    ['alt', { label: 'alt', get: (r) => (r.altState === 'missing' ? el('span', { class: 'sev sev-warning' }, t('alt_missing')) : r.altState === 'empty' ? el('span', { class: 'sev sev-notice' }, t('alt_empty')) : r.alt) }],
    ['title', { label: 'title', get: (r) => r.title || '' }],
    ['dims', { label: t('col_dims_attr'), get: (r) => (r.widthAttr && r.heightAttr ? `${r.widthAttr}×${r.heightAttr}` : el('span', { class: 'muted' }, '—')) }],
    ['natural', { label: t('col_natural'), get: (r) => (r.natural ? `${r.natural.w}×${r.natural.h}` : '—') }],
    ['rendered', { label: t('col_rendered'), get: (r) => [r.rendered ? `${r.rendered.w}×${r.rendered.h}` : '—', r.oversized ? el('span', { class: 'tag warn' }, t('served_larger')) : null] }],
    ['bytes', { label: t('col_bytes'), get: (r) => { const b = bytesOf(r); return b.v !== null ? `${fmtBytes(b.v)} (${t(`src_${b.src.replace(/-/g, '_')}`)})` : el('span', { class: 'muted', title: b.src || '' }, b.src ? t(`reason_${b.src.replace(/-/g, '_')}`) : t('val_unknown')); } }],
    ['format', { label: t('col_format'), get: (r) => r.format }],
  ];
  const fmt = Object.entries(scan.imageFormats).sort((a, b) => b[1] - a[1]);
  const total = scan.images.length || 1;
  const btn = el('button', { type: 'button', onclick: runImageSizes, disabled: ui.imageProgress !== null }, ui.imageProgress ? t('progress', ui.imageProgress) : t('btn_measure_images'));
  return section('images',
    el('div', { class: 'chips' }, fmt.map(([k, v]) => el('span', { class: 'chip' }, `${k}: ${v} (${Math.round((v / total) * 100)}%)`))),
    el('div', { class: 'toolbar' }, filters.map((f) => el('button', { type: 'button', class: ui.imageFilter === f ? 'tab active' : 'tab', onclick: () => { ui.imageFilter = f; rerender('images'); } }, t(`flt_${f.replace(/-/g, '_')}`))), btn,
      el('button', { type: 'button', onclick: exportImages }, 'CSV')),
    el('p', { class: 'muted small' }, t('images_note')),
    table(all.filter(([k]) => cols[k]).map(([, c]) => c), rows));
}

function linkRows() {
  return scan.linkGroups.filter((g) => {
    switch (ui.linkFilter) {
      case 'internal': return g.type === 'internal';
      case 'external': return g.type === 'external' || g.type === 'subdomain';
      case 'nofollow': return g.nofollow > 0;
      case 'empty-anchor': return g.anchorTypes.includes('empty');
      case 'problems': { const s = linkStatus.get(g.url); return s && !['ok', 'skipped'].includes(s.status); }
      default: return true;
    }
  });
}

function statusCell(url) {
  const s = linkStatus.get(url);
  if (!s) return el('span', { class: 'muted' }, '—');
  const cls = { ok: 'pass', redirected: 'notice', broken: 'error', 'login-required': 'notice', 'could-not-check': 'not-run', 'not-checked': 'not-run', skipped: 'not-run' }[s.status] || 'not-run';
  return el('span', { title: s.finalUrl || s.reason || '' }, el('span', { class: `sev sev-${cls}` }, t(`ls_${s.status.replace(/-/g, '_')}`)), s.http ? ` ${s.http}` : '', s.reason ? el('span', { class: 'muted small' }, ` ${t(`reason_${s.reason.replace(/-/g, '_')}`)}`) : '', s.finalUrl && s.status !== 'ok' ? el('div', { class: 'small mono' }, `→ ${short(s.finalUrl, 70)}`) : null);
}

function sLinks() {
  const cols = settings.columns.links;
  const l = scan.linkSummary;
  const all = [
    ['url', { label: 'URL', get: (r) => (/^https?:/i.test(r.url) ? el('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', title: r.url }, short(r.url, 70)) : short(r.url, 70)), cls: 'mono' }],
    ['count', { label: t('col_count'), get: (r) => String(r.count) }],
    ['anchors', { label: t('col_anchors'), get: (r) => r.anchors.map((a) => a || `(${t('val_empty')})`).join(' | ') }],
    ['anchorType', { label: t('col_anchor_type'), get: (r) => r.anchorTypes.map((a) => t(`at_${a}`)).join(', ') }],
    ['rel', { label: 'rel', get: (r) => r.rels.join(' ') }],
    ['type', { label: t('col_type'), get: (r) => t(`lt_${r.type.replace(/-/g, '_')}`) }],
    ['status', { label: t('col_status'), get: (r) => statusCell(r.url) }],
  ];
  const filters = ['all', 'internal', 'external', 'nofollow', 'empty-anchor', 'problems'];
  const redirectedInternal = scan.linkGroups.filter((g) => g.type === 'internal' && linkStatus.get(g.url)?.status === 'redirected').length;
  return section('links',
    el('div', { class: 'chips' }, [['lk_internal', l.internal], ['lk_subdomain', l.subdomain], ['lk_external', l.external], ['lk_other', l.other], ['lk_follow', l.follow], ['nofollow', l.nofollow], ['sponsored', l.sponsored], ['ugc', l.ugc], ['lk_empty_anchor', l.emptyAnchor]].map(([k, v]) => el('span', { class: 'chip' }, `${has(k) ? t(k) : k}: ${v}`))),
    el('p', { class: 'muted small' }, t('links_note')),
    linkStatus.size ? el('p', { class: 'small' }, t('redirected_internal', { n: redirectedInternal })) : null,
    el('div', { class: 'toolbar' }, filters.map((f) => el('button', { type: 'button', class: ui.linkFilter === f ? 'tab active' : 'tab', onclick: () => { ui.linkFilter = f; rerender('links'); } }, t(`flt_${f.replace(/-/g, '_')}`))),
      el('button', { type: 'button', onclick: runLinkCheck, disabled: ui.linkProgress !== null }, ui.linkProgress ? t('progress', ui.linkProgress) : t('btn_check_links')),
      el('button', { type: 'button', onclick: exportLinks }, 'CSV')),
    el('details', {}, el('summary', {}, t('linkcheck_policy_title')), el('p', { class: 'small' }, t('linkcheck_policy'))),
    table(all.filter(([k]) => cols[k]).map(([, c]) => c), linkRows()));
}

function sKeywords() {
  const k = scan.keywords;
  const out = [el('p', {}, t('kw_tokens', { n: k.totalTokens, words: scan.engine.content.wordCount })), el('p', { class: 'muted small' }, t('kw_note'))];
  const uni = k.byLength[1] || [];
  if (uni.length) {
    const max = uni[0].count;
    out.push(el('div', { class: 'cloud' }, uni.slice(0, 30).map((u) => el('span', { style: `font-size:max(14px, ${(0.8 + (u.count / max) * 1.2).toFixed(2)}em)` }, u.phrase))));
  }
  for (const n of [1, 2, 3, 4]) {
    out.push(el('h3', {}, t('kw_n', { n })), table([
      { label: t('col_phrase'), get: (r) => r.phrase },
      { label: t('col_count'), get: (r) => String(r.count) },
      { label: t('col_density'), get: (r) => [`${r.densityPercent}%`, r.densityPercent >= SRULES.keywords.densityNoticePercent && k.totalTokens >= 100 ? el('span', { class: 'tag warn' }, t('high')) : null] },
      { label: t('col_prominence'), get: (r) => String(r.prominence) },
    ], k.byLength[n] || []));
  }
  out.push(el('div', { class: 'toolbar' }, el('button', { type: 'button', onclick: exportKeywords }, 'CSV')));
  return section('keywords', ...out);
}

function sSocial() {
  return section('social', renderPreview(scan.social.preview), el('p', { class: 'muted small' }, t('preview_note')), el('h3', {}, 'Open Graph'), kvTable(scan.social.og), el('h3', {}, 'Twitter / X'), kvTable(scan.social.twitter));
}

function microTree(item) {
  return el('ul', { class: 'tree' }, el('li', {}, el('strong', {}, item.types.join(', ') || '(untyped)'), el('ul', {}, item.props.map((p) => el('li', {}, el('code', {}, p.name), ': ', p.item ? microTree(p.item) : short(p.value ?? '', 160))))));
}

function sSchema() {
  const s = scan.schema;
  return section('schema',
    el('h3', {}, `JSON-LD (${s.jsonLd.length})`),
    ...s.jsonLd.map((b) => el('details', { class: b.error ? 'bad' : '' }, el('summary', {}, `#${b.index + 1} `, b.error ? el('span', { class: 'sev sev-error' }, t('schema_parse_error', { n: b.index + 1, error: b.error })) : b.nodes.map((n) => n.types.join('/')).join(', ') || '(no @type)'),
      el('pre', { class: 'mono' }, prettyJson(b.raw)))),
    el('h3', {}, `Microdata (${s.microdata.length})`), ...s.microdata.map(microTree),
    el('h3', {}, `RDFa (${s.rdfa.length})`), ...s.rdfa.map((r) => el('ul', { class: 'tree' }, el('li', {}, el('strong', {}, r.types.join(', ')), r.vocab ? ` (${r.vocab})` : '', el('ul', {}, r.props.map((p) => el('li', {}, el('code', {}, p.name), ': ', short(p.value, 160))))))),
    el('p', { class: 'muted small' }, t('schema_note')));
}
function prettyJson(raw) { try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; } }

function sTechnical() {
  const p = scan.network.page; const e = scan.engine; const rb = scan.network.robots; const sm = scan.network.sitemap; const mq = scan.mediaQueries;
  const parts = [];
  parts.push(el('p', { class: 'muted small' }, t('tech_surface_note')));
  if (p.error) parts.push(el('p', { class: 'error' }, t('fetch_failed', { error: p.error })));
  else {
    parts.push(kvRows([
      [t('f_http_status'), `${p.status} ${p.statusText || ''}`],
      [t('f_redirected'), p.redirected ? `${yesNo(true)} → ${p.finalUrl}` : yesNo(false)],
      [t('f_final_url'), p.finalUrl],
      ['HTTPS', yesNo(/^https:/i.test(scan.url))],
      ['HSTS', e.hsts ? `${e.hsts.raw} (max-age ${e.hsts.maxAge ?? '?'}, includeSubDomains ${yesNo(e.hsts.includeSubDomains)}, preload ${yesNo(e.hsts.preload)})` : null],
      [t('f_html_decoded'), `${fmtBytes(p.htmlBytesDecoded)}${p.truncated ? ` (${t('truncated')})` : ''} — ${t('surface_refetch_body')}`],
      [t('f_html_compressed'), p.contentEncoding && p.contentLengthHeader ? `${fmtBytes(p.contentLengthHeader)} (${p.contentEncoding}) — ${t('surface_content_length')}` : p.navigation && p.navigation.encodedBodySize ? `${fmtBytes(p.navigation.encodedBodySize)} — ${t('surface_navigation')}` : null],
      [t('f_text_ratio'), e.content.textHtmlRatioPercent !== null ? `${e.content.textHtmlRatioPercent}% (${t(e.surfaces && e.surfaces.textHtmlRatio === 'raw-html' ? 'ratio_def' : 'ratio_def_live')})` : null],
      [t('f_media_queries'), mq ? t('mq_value', mq) : null],
    ]));
    parts.push(el('h3', {}, t('response_headers')), table([
      { label: t('col_header'), get: (r) => r[0], cls: 'mono' },
      { label: t('col_value'), get: (r) => r[1], cls: 'mono' },
    ], p.selectedHeaders), el('details', {}, el('summary', {}, t('all_header_names', { n: p.headerNames.length })), el('p', { class: 'mono small' }, p.headerNames.join(', '))));
  }
  parts.push(el('h3', {}, t('mixed_content')));
  if (e.mixedContent) parts.push(kvRows([[t('mc_active'), e.mixedContent.active], [t('mc_passive'), e.mixedContent.passive]]));
  else parts.push(el('p', { class: 'muted' }, t('mc_notrun')));

  parts.push(el('h3', {}, 'robots.txt'));
  if (!rb || rb.error) parts.push(el('p', { class: 'muted' }, t('fetch_failed', { error: rb?.error || '' })));
  else {
    parts.push(el('p', {}, `${rb.url} — HTTP ${rb.status}`));
    if (rb.verdicts) {
      parts.push(table([
        { label: t('col_agent'), get: (r) => r.agent },
        { label: t('col_group'), get: (r) => r.group || t('no_group') },
        { label: t('col_verdict'), get: (r) => el('span', { class: `sev sev-${r.allowed ? 'pass' : 'error'}` }, r.allowed ? t('allowed') : t('blocked')) },
        { label: t('col_rule'), get: (r) => (r.rule ? `${r.rule.type}: ${r.rule.path}` : '—'), cls: 'mono' },
      ], rb.verdicts));
      parts.push(kvRows([[t('sitemap_lines'), rb.sitemaps], [t('robots_errors'), rb.parsed.errors.map((x) => `L${x.line}: ${x.kind}`)]]));
    } else parts.push(el('p', { class: 'muted' }, t('robots_no_rules')));
  }
  parts.push(el('h3', {}, 'Sitemap'));
  if (!sm || !sm.found) parts.push(el('p', { class: 'muted' }, t('sitemap_not_found', { tried: (sm?.tried || []).join(', ') })));
  else parts.push(kvRows([
    ['URL', sm.url], [t('col_type'), sm.type], [t('sm_urls'), sm.type === 'urlset' ? String(sm.urlCount) : `${sm.urlCount} ${t('sm_children')}`],
    [t('sm_declared'), yesNo(sm.declaredInRobots)], [t('sm_listed'), sm.listed === null ? t('val_unknown') : `${yesNo(sm.listed)}${sm.complete ? '' : ` (${t('sm_partial', { checked: sm.checkedFiles, total: sm.childTotal })})`}`],
    [t('sm_crossorigin'), sm.skippedCrossOrigin],
  ]));
  return section('technical', ...parts);
}

function sRawRendered() {
  if (!scan.rawVsRendered) return section('rawrendered', el('p', { class: 'muted' }, t('raw_notrun')));
  return section('rawrendered', el('p', { class: 'muted small' }, t('raw_note')), table([
    { label: t('col_field'), get: (r) => t(`fld_${r.field}`) },
    { label: t('col_raw'), get: (r) => short(r.raw ?? '—', 140) },
    { label: t('col_rendered_dom'), get: (r) => short(r.rendered ?? '—', 140) },
    { label: t('col_state'), get: (r) => el('span', { class: `sev sev-${r.state === 'same' ? 'pass' : 'notice'}` }, t(`rs_${r.state.replace(/-/g, '_')}`)) },
  ], scan.rawVsRendered));
}

function sFrames() {
  return section('frames', el('p', { class: 'muted small' }, t('frames_note')), table([
    { label: 'src', get: (r) => short(r.src, 100), cls: 'mono' },
    { label: 'title', get: (r) => r.title || '' },
    { label: t('col_origin'), get: (r) => (r.sameOrigin === null ? t('val_unknown') : r.sameOrigin ? t('same_origin') : t('cross_origin')) },
    { label: t('col_status'), get: () => el('span', { class: 'sev sev-not-run' }, t('not_inspected')) },
  ], scan.iframes, { empty: t('frames_none') }));
}

function sTracking() {
  return section('tracking', el('p', { class: 'muted small' }, t('tracking_note')), table([
    { label: t('col_vendor'), get: (r) => r.label },
    { label: t('col_ids'), get: (r) => r.ids.join(', ') || '—', cls: 'mono' },
    { label: t('col_matched_by'), get: (r) => r.matchedBy.join(' + ') },
  ], scan.engine.tracking, { empty: t('tracking_none') }));
}

function sCompare() {
  const ta = el('textarea', { rows: 5, id: 'cmp-urls', placeholder: t('cmp_placeholder') });
  ta.value = ui.compare?.input || `${scan.url}\n`;
  const out = [el('p', { class: 'muted small' }, t('cmp_note')), ta, el('div', { class: 'toolbar' }, el('button', { type: 'button', onclick: () => runCompare(ta.value), disabled: ui.compare?.running }, ui.compare?.running ? t('scanning') : t('btn_compare')), ui.compare?.matrix ? el('button', { type: 'button', onclick: exportCompare }, 'CSV') : null)];
  if (ui.compare?.error) out.push(el('p', { class: 'error' }, ui.compare.error));
  const m = ui.compare?.matrix;
  if (m) {
    out.push(el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, el('th', {}, t('col_field')), m.urls.map((u, i) => el('th', { title: u }, short(u, 40), m.errors[i] ? el('div', { class: 'error small' }, t(`reason_${m.errors[i].replace(/-/g, '_')}`) || m.errors[i]) : null)))),
      el('tbody', {}, m.rows.map((r) => el('tr', {}, el('th', {}, r.field === 'status' ? t('f_http_status') : t(`fld_${r.field}`)), r.values.map((v) => el('td', {}, v === null ? '—' : short(v, 120)))))))));
  }
  return section('compare', ...out);
}

function sTools() {
  const u = encodeURIComponent(scan.url);
  let host = '';
  try { host = new URL(scan.url).hostname; } catch { /* keep */ }
  const tools = [
    ['Google Rich Results Test', `https://search.google.com/test/rich-results?url=${u}`],
    ['Schema Markup Validator', `https://validator.schema.org/#url=${u}`],
    ['PageSpeed Insights', `https://pagespeed.web.dev/analysis?url=${u}`],
    ['W3C HTML Validator', `https://validator.w3.org/nu/?doc=${u}`],
    ['W3C CSS Validator', `https://jigsaw.w3.org/css-validator/validator?uri=${u}`],
    ['Facebook Sharing Debugger', `https://developers.facebook.com/tools/debug/?q=${u}`],
    ['LinkedIn Post Inspector', `https://www.linkedin.com/post-inspector/inspect/${u}`],
    ['Wayback Machine', `https://web.archive.org/web/*/${scan.url}`],
    ['Security Headers', `https://securityheaders.com/?q=${u}&followRedirects=on`],
    ['SSL Labs', `https://www.ssllabs.com/ssltest/analyze.html?d=${encodeURIComponent(host)}`],
    ['Google site:', `https://www.google.com/search?q=${encodeURIComponent(`site:${host}`)}`],
    ['Bing site:', `https://www.bing.com/search?q=${encodeURIComponent(`site:${host}`)}`],
  ];
  return section('tools', el('p', { class: 'muted small' }, t('tools_note')), el('ul', { class: 'tools' }, tools.map(([n, href]) => el('li', {}, el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, n)))));
}

const DIRECTIVES = ['index', 'noindex', 'follow', 'nofollow', 'none', 'all', 'noarchive', 'nosnippet', 'max-snippet', 'max-image-preview', 'max-video-preview', 'notranslate', 'noimageindex', 'unavailable_after', 'indexifembedded'];
function sHelp() {
  return section('help',
    el('h3', {}, t('help_robots_title')),
    el('dl', { class: 'help' }, DIRECTIVES.map((d) => [el('dt', {}, el('code', {}, d)), el('dd', {}, t(`dir_${d.replace(/-/g, '_')}`))])),
    el('h3', {}, t('help_checks_title')),
    el('dl', { class: 'help' }, scan.audit.checks.map((c) => [el('dt', { id: `help-${c.key}` }, checkName(c.key)), el('dd', {}, t(`help_${c.key.replace(/-/g, '_')}`))])),
    el('h3', {}, t('help_severity_title')),
    el('dl', { class: 'help' }, ['error', 'warning', 'notice', 'pass', 'not_run'].map((s) => [el('dt', {}, sevBadge(s.replace('_', '-'))), el('dd', {}, t(`help_sev_${s}`))])));
}

function sExport() {
  return section('export', el('div', { class: 'toolbar' },
    el('button', { type: 'button', onclick: () => download(`${fileStamp(scan.url)}.json`, JSON.stringify({ ...scan, linkStatus: Object.fromEntries(linkStatus), imageBytes: Object.fromEntries(imageBytes) }, null, 2), 'application/json') }, t('exp_json')),
    el('button', { type: 'button', onclick: exportLinks }, t('exp_links')),
    el('button', { type: 'button', onclick: exportImages }, t('exp_images')),
    el('button', { type: 'button', onclick: exportKeywords }, t('exp_keywords')),
    el('button', { type: 'button', onclick: () => window.print() }, t('btn_print'))), el('p', { class: 'muted small' }, t('export_note')));
}

const RENDER = { audit: sAudit, pageinfo: sPageInfo, head: sHead, headings: sHeadings, images: sImages, links: sLinks, keywords: sKeywords, social: sSocial, schema: sSchema, technical: sTechnical, rawrendered: sRawRendered, frames: sFrames, tracking: sTracking, compare: sCompare, tools: sTools, help: sHelp, export: sExport };

function rerender(id) { const old = $(`s-${id}`); if (old) old.replaceWith(RENDER[id]()); }

function renderAll() {
  const c = scan.audit.counts;
  $('r-meta').replaceChildren(
    el('div', { class: 'url', title: scan.url }, scan.url),
    el('div', { class: 'counts' },
      el('span', { class: 'http' }, scan.network.page.error ? `HTTP ${t('val_unknown')}` : `HTTP ${scan.network.page.status}`),
      el('span', { class: 'cnt cnt-error' }, `${c.error} ${t('cnt_errors')}`), el('span', { class: 'cnt cnt-warning' }, `${c.warning} ${t('cnt_warnings')}`),
      el('span', { class: 'cnt cnt-notice' }, `${c.notice} ${t('cnt_notices')}`), el('span', { class: 'cnt cnt-not-run' }, `${c['not-run']} ${t('cnt_notrun')}`),
      el('span', { class: 'muted small' }, t('scanned_at', { at: new Date(scan.scannedAt).toLocaleString() }))));
  $('r-nav').replaceChildren(el('ul', {}, SECTIONS.map((s) => el('li', {}, el('a', { href: `#s-${s}` }, t(`sec_${s}`))))));
  $('r-main').replaceChildren(...SECTIONS.map((s) => RENDER[s]()));
}

// ---------- actions ----------

async function runLinkCheck() {
  const urls = scan.linkGroups.filter((g) => ['internal', 'subdomain', 'external'].includes(g.type)).map((g) => g.url).slice(0, SRULES.linkCheck.cap);
  ui.linkProgress = { done: 0, total: urls.length }; rerender('links');
  try {
    for (let i = 0; i < urls.length; i += 12) {
      const res = await callInTab(tabId, 'checkLinks', urls.slice(i, i + 12));
      for (const r of res) linkStatus.set(r.url, r);
      ui.linkProgress = { done: Math.min(i + 12, urls.length), total: urls.length }; rerender('links');
    }
  } catch (e) { alert(errorText(e)); }
  ui.linkProgress = null; rerender('links');
}

async function runImageSizes() {
  const urls = [...new Set(scan.images.filter((i) => !i.bytes && i.src).map((i) => i.src))].slice(0, SRULES.images.sizeCheckCap);
  ui.imageProgress = { done: 0, total: urls.length }; rerender('images');
  try {
    for (let i = 0; i < urls.length; i += 12) {
      const res = await callInTab(tabId, 'measureImages', urls.slice(i, i + 12));
      for (const r of res) imageBytes.set(r.url, r);
      ui.imageProgress = { done: Math.min(i + 12, urls.length), total: urls.length }; rerender('images');
    }
  } catch (e) { alert(errorText(e)); }
  ui.imageProgress = null; rerender('images');
}

async function runCompare(input) {
  const urls = [...new Set(input.split(/\s+/).map((s) => s.trim()).filter(Boolean))];
  ui.compare = { input, running: true };
  if (urls.length < 2 || urls.length > 5) { ui.compare = { input, error: t('cmp_count') }; rerender('compare'); return; }
  rerender('compare');
  try {
    const entries = [];
    for (const u of urls) entries.push(await callInTab(tabId, 'fetchAndInspect', u));
    ui.compare = { input, matrix: compareMatrix(entries) };
  } catch (e) { ui.compare = { input, error: errorText(e) }; }
  rerender('compare');
}

function exportLinks() {
  download(`${fileStamp(scan.url)}-links.csv`, toCsv(['url', 'type', 'count', 'anchors', 'anchor_types', 'rel', 'follow', 'nofollow', 'sponsored', 'ugc', 'check_status', 'http', 'final_url', 'reason'],
    scan.linkGroups.map((g) => { const s = linkStatus.get(g.url) || {}; return [g.url, g.type, g.count, g.anchors, g.anchorTypes, g.rels.join(' '), g.follow, g.nofollow, g.sponsored, g.ugc, s.status || '', s.http || '', s.finalUrl || '', s.reason || '']; })), 'text/csv');
}
function exportImages() {
  download(`${fileStamp(scan.url)}-images.csv`, toCsv(['src', 'alt_state', 'alt', 'title', 'width_attr', 'height_attr', 'natural', 'rendered', 'served_larger', 'bytes', 'bytes_source', 'format'],
    scan.images.map((i) => { const b = bytesOf(i); return [i.src, i.altState, i.alt ?? '', i.title ?? '', i.widthAttr ?? '', i.heightAttr ?? '', i.natural ? `${i.natural.w}x${i.natural.h}` : '', i.rendered ? `${i.rendered.w}x${i.rendered.h}` : '', i.oversized, b.v ?? '', b.v !== null ? b.src : '', i.format]; })), 'text/csv');
}
function exportKeywords() {
  const rows = [];
  for (const n of [1, 2, 3, 4]) for (const r of scan.keywords.byLength[n] || []) rows.push([n, r.phrase, r.count, r.densityPercent, r.prominence]);
  download(`${fileStamp(scan.url)}-keywords.csv`, toCsv(['words', 'phrase', 'count', 'density_percent', 'prominence'], rows), 'text/csv');
}
function exportCompare() {
  const m = ui.compare.matrix;
  download(`${fileStamp(scan.url)}-compare.csv`, toCsv(['field', ...m.urls], m.rows.map((r) => [r.field, ...r.values])), 'text/csv');
}

async function rescan() {
  $('r-main').prepend(el('p', { class: 'muted', id: 'scanning' }, t('scanning')));
  try {
    scan = await scanTab(tabId, settings);
    linkStatus.clear(); imageBytes.clear();
    renderAll();
  } catch (e) {
    $('scanning')?.remove();
    $('r-main').prepend(el('p', { class: 'error' }, errorText(e)));
  }
}

(async function main() {
  settings = await loadSettings();
  applyFontSize(settings);
  await loadLocale(resolveLang(settings));
  applyI18n();
  $('print').addEventListener('click', () => window.print());
  $('rescan').addEventListener('click', rescan);
  if (!Number.isInteger(tabId)) { $('r-main').replaceChildren(el('p', { class: 'error' }, t('err_no_tab'))); return; }
  scan = await storedScan(tabId);
  if (scan) renderAll(); else await rescan();
  watchTab(tabId, () => rescan());
})();
