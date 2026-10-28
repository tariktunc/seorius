// Structured data readers: JSON-LD (with @graph flattening), microdata (scope-aware itemprop tree)
// and RDFa (top-level typeof nodes with their property children, shallow).
// The DOM readers use only querySelectorAll / getAttribute / children / textContent / parentElement.

const lastSeg = (t) => String(t).replace(/[#/]+$/, '').split(/[/#:]/).pop();

export function typeNames(t) {
  return [].concat(t || []).filter((x) => typeof x === 'string').map(lastSeg);
}

/** Flatten a parsed JSON-LD value into nodes that carry @type (nested objects included). */
export function flattenJsonLd(value) {
  const nodes = [];
  const walk = (v, depth) => {
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth)); return; }
    if (!v || typeof v !== 'object') return;
    if (v['@type']) nodes.push({ types: typeNames(v['@type']), id: typeof v['@id'] === 'string' ? v['@id'] : null, depth, props: Object.keys(v).filter((k) => !k.startsWith('@')).slice(0, 40) });
    for (const [k, x] of Object.entries(v)) if (x && typeof x === 'object') walk(x, k === '@graph' ? depth : depth + 1);
  };
  walk(value, 0);
  return nodes;
}

export function readJsonLd(doc) {
  return Array.from(doc.querySelectorAll('script')).filter((s) => /ld\+json/i.test(s.getAttribute('type') || '')).map((s, index) => {
    const raw = s.textContent || '';
    try {
      const parsed = JSON.parse(raw);
      return { index, raw: raw.slice(0, 20000), error: null, nodes: flattenJsonLd(parsed) };
    } catch (e) {
      return { index, raw: raw.slice(0, 20000), error: String(e.message).slice(0, 200), nodes: [] };
    }
  });
}

function itemValue(el) {
  const tag = String(el.localName || el.tagName || '').toLowerCase();
  const g = (a) => el.getAttribute(a);
  if (el.getAttribute('itemscope') !== null) return null;
  if (tag === 'meta') return g('content');
  if (['a', 'link', 'area'].includes(tag)) return g('href');
  if (['img', 'audio', 'video', 'source', 'iframe', 'embed', 'track'].includes(tag)) return g('src');
  if (tag === 'object') return g('data');
  if (tag === 'time') return g('datetime') || el.textContent;
  if (tag === 'data' || tag === 'meter') return g('value');
  return String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

const kids = (el) => Array.from(el.children || (el.childNodes || []).filter((c) => c.nodeType === 1));

function microItem(scope, depth = 0) {
  const item = { types: typeNames((scope.getAttribute('itemtype') || '').split(/\s+/).filter(Boolean)), props: [] };
  const visit = (el) => {
    for (const c of kids(el)) {
      const prop = c.getAttribute('itemprop');
      const isScope = c.getAttribute('itemscope') !== null;
      if (prop) {
        for (const name of prop.split(/\s+/).filter(Boolean)) {
          item.props.push(isScope && depth < 6 ? { name, item: microItem(c, depth + 1) } : { name, value: itemValue(c) });
        }
      }
      if (!isScope) visit(c);
    }
  };
  visit(scope);
  return item;
}

export function readMicrodata(doc) {
  return Array.from(doc.querySelectorAll('[itemscope]')).filter((el) => el.getAttribute('itemprop') === null).slice(0, 50).map((el) => microItem(el));
}

export function readRdfa(doc) {
  const tops = Array.from(doc.querySelectorAll('[typeof]')).filter((el) => {
    for (let p = el.parentElement || el.parentNode; p && p.nodeType === 1; p = p.parentElement || p.parentNode) if (p.getAttribute && p.getAttribute('typeof') !== null) return false;
    return true;
  });
  return tops.slice(0, 50).map((el) => ({
    types: typeNames((el.getAttribute('typeof') || '').split(/\s+/).filter(Boolean)),
    vocab: el.getAttribute('vocab') || null,
    props: Array.from(el.querySelectorAll('[property]')).slice(0, 60).map((p) => ({ name: p.getAttribute('property'), value: p.getAttribute('content') || p.getAttribute('href') || p.getAttribute('src') || String(p.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200) })),
  }));
}
