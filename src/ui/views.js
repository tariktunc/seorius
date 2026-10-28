// View pieces shared by popup and report.
import { el, t, short } from './common.js';

export function kvTable(obj) {
  const entries = Object.entries(obj || {});
  if (!entries.length) return el('p', { class: 'muted' }, t('val_none'));
  return el('table', { class: 'kv' }, el('tbody', {}, entries.map(([k, v]) => el('tr', {}, el('th', {}, k), el('td', {}, [].concat(v).join(' | '))))));
}

/** Share card. The image is loaded only when the user clicks, because it is a request to the
 * image host that the inspection itself does not need. */
export function renderPreview(p) {
  const media = el('div', { class: 'card-media' });
  if (p.image) {
    media.append(el('button', { type: 'button', class: 'linkish', onclick: () => {
      media.replaceChildren(el('img', { src: p.image, alt: '', referrerpolicy: 'no-referrer' }));
    } }, t('preview_load_image')));
  } else media.append(el('span', { class: 'muted' }, t('preview_no_image')));
  return el('div', { class: 'share-card' }, media,
    el('div', { class: 'card-body' },
      el('div', { class: 'card-site' }, p.site || ''),
      el('div', { class: 'card-title' }, p.title || t('val_missing')),
      el('div', { class: 'card-desc' }, short(p.description || '', 200))));
}

export function schemaTypeList(schema) {
  const out = el('div', {});
  const jl = schema.jsonLd || [];
  const types = new Set(jl.flatMap((b) => b.nodes.flatMap((n) => n.types)));
  out.append(el('h3', {}, `JSON-LD (${jl.length})`),
    types.size ? el('div', { class: 'chips' }, [...types].map((x) => el('span', { class: 'chip' }, x))) : el('p', { class: 'muted' }, t('val_none')));
  const errs = jl.filter((b) => b.error);
  if (errs.length) out.append(el('ul', { class: 'findings' }, errs.map((b) => el('li', { class: 'error' }, t('schema_parse_error', { n: b.index + 1, error: b.error })))));
  const md = new Set((schema.microdata || []).flatMap((m) => m.types));
  out.append(el('h3', {}, `Microdata (${(schema.microdata || []).length})`), md.size ? el('div', { class: 'chips' }, [...md].map((x) => el('span', { class: 'chip' }, x))) : el('p', { class: 'muted' }, t('val_none')));
  const rd = new Set((schema.rdfa || []).flatMap((m) => m.types));
  out.append(el('h3', {}, `RDFa (${(schema.rdfa || []).length})`), rd.size ? el('div', { class: 'chips' }, [...rd].map((x) => el('span', { class: 'chip' }, x))) : el('p', { class: 'muted' }, t('val_none')));
  return out;
}

/** columns: [{key, label, get(row) -> string|Node, cls}] */
export function table(columns, rows, { empty } = {}) {
  if (!rows.length) return el('p', { class: 'muted' }, empty || t('val_none'));
  return el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
    el('thead', {}, el('tr', {}, columns.map((c) => el('th', {}, c.label)))),
    el('tbody', {}, rows.map((r) => el('tr', {}, columns.map((c) => el('td', { class: c.cls || null }, c.get(r))))))));
}
