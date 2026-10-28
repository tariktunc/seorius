// Field comparisons: raw HTML vs rendered DOM (same engine run on both surfaces) and the
// multi-URL on-page matrix. Pure: both take engine results.

const first = (v) => (Array.isArray(v) ? v[0] : v) ?? null;

export const FIELDS = [
  ['title', (r) => r.title?.text ?? null],
  ['description', (r) => r.metaDescription?.text ?? null],
  ['canonical', (r) => r.canonical?.href ?? null],
  ['robots', (r) => (r.robots?.entries || []).filter((e) => e.source === 'meta').map((e) => `${e.agent}:${e.token}`).join(', ') || null],
  ['lang', (r) => r.lang ?? null],
  ['h1', (r) => (r.headings?.outline || []).filter((h) => h.level === 1).map((h) => h.text).join(' | ') || null],
  ['h1Count', (r) => r.h1Count ?? 0],
  ['ogTitle', (r) => first(r.openGraph?.['og:title'])],
  ['ogDescription', (r) => first(r.openGraph?.['og:description'])],
  ['ogImage', (r) => first(r.openGraph?.['og:image'])],
  ['hreflangCount', (r) => (r.hreflang || []).length],
  ['schemaTypes', (r) => [...(r.schemaTypes || [])].sort().join(', ') || null],
  ['wordCount', (r) => r.content?.wordCount ?? 0],
  ['linkCount', (r) => r.links?.total ?? 0],
  ['imageCount', (r) => r.images?.total ?? 0],
];

export function rawVsRendered(raw, rendered) {
  return FIELDS.map(([field, get]) => {
    const a = get(raw); const b = get(rendered);
    let state = 'same';
    if (String(a ?? '') !== String(b ?? '')) state = (a === null || a === '' || a === 0) ? 'rendered-only' : (b === null || b === '' || b === 0) ? 'raw-only' : 'different';
    return { field, raw: a, rendered: b, state };
  });
}

export function compareMatrix(entries) {
  // entries: [{url, result|null, error|null}]
  const fields = [['status', (e) => e.status ?? null], ...FIELDS.map(([f, g]) => [f, (e) => (e.result ? g(e.result) : null)])];
  return { urls: entries.map((e) => e.url), rows: fields.map(([field, get]) => ({ field, values: entries.map((e) => (e.error ? null : get(e))) })), errors: entries.map((e) => e.error || null) };
}
