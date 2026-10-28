// Vendored subset of WebForge site-builder/seo-uzman/_lib/finding-schema.mjs (2026-10-28).
// Kept: makeFinding, stableId and the HEALTH "PI *" ids used by page-inspect-core.mjs.
// The other areas of the original registry are not needed by the extension and are left out.

export const FINDING_SCHEMA_VERSION = 1;

export const RULE_IDS = Object.freeze({
  HEALTH: Object.freeze({
    'PI title': 'HEALTH-INSPECT-TITLE',
    'PI description': 'HEALTH-INSPECT-DESCRIPTION',
    'PI robots': 'HEALTH-INSPECT-ROBOTS',
    'PI canonical': 'HEALTH-INSPECT-CANONICAL',
    'PI consistency': 'HEALTH-INSPECT-INDEX-CONSISTENCY',
    'PI lang': 'HEALTH-INSPECT-LANG',
    'PI viewport': 'HEALTH-INSPECT-VIEWPORT',
    'PI charset': 'HEALTH-INSPECT-CHARSET',
    'PI doctype': 'HEALTH-INSPECT-DOCTYPE',
    'PI hreflang': 'HEALTH-INSPECT-HREFLANG',
    'PI h1': 'HEALTH-INSPECT-H1',
    'PI outline': 'HEALTH-INSPECT-HEADING-OUTLINE',
    'PI images': 'HEALTH-INSPECT-IMAGES',
    'PI links': 'HEALTH-INSPECT-LINKS',
    'PI open-graph': 'HEALTH-INSPECT-OPEN-GRAPH',
    'PI twitter-card': 'HEALTH-INSPECT-TWITTER-CARD',
    'PI structured-data': 'HEALTH-INSPECT-STRUCTURED-DATA',
    'PI tracking': 'HEALTH-INSPECT-TRACKING',
    'PI content': 'HEALTH-INSPECT-CONTENT',
    'PI keywords': 'HEALTH-INSPECT-KEYWORDS',
    'PI mixed-content': 'HEALTH-INSPECT-MIXED-CONTENT',
    'PI hsts': 'HEALTH-INSPECT-HSTS',
  }),
});

const warned = new Set();
export function stableId(area, rawKey) {
  const table = RULE_IDS[area];
  const id = table && table[rawKey];
  if (id) return id;
  const fallback = `${area}-UNREGISTERED-${String(rawKey).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
  const warnKey = `${area}::${rawKey}`;
  if (!warned.has(warnKey)) {
    warned.add(warnKey);
    console.warn(`[finding-schema] no RULE_IDS.${area} entry for "${rawKey}" — using fallback "${fallback}".`);
  }
  return fallback;
}

export function makeFinding({ id, severity, page, message, fix_hint = null }) {
  if (!id) throw new Error('makeFinding: id is required');
  if (!severity) throw new Error(`makeFinding(${id}): severity is required`);
  if (page === undefined || page === null || page === '') throw new Error(`makeFinding(${id}): page is required`);
  if (!message) throw new Error(`makeFinding(${id}): message is required`);
  return { id, severity, page, message, fix_hint };
}
