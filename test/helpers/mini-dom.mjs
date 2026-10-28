// Vendored test helper, copied verbatim from WebForge site-builder/seo-uzman/_lib/mini-dom.mjs (2026-10-28).
// Used only by node --test to give the engine a Document-like object; never bundled.
/**
 * mini-dom — dependency-free HTML parser that returns a Document-like object (seo-uzman, 2026-10-28).
 *
 * Why it exists: no HTML parser package (cheerio/jsdom/parse5/linkedom) is installed in this repo
 * (measured 2026-10-28: node_modules has none), and health/page-inspect-core.mjs must run both in
 * Node and inside the blakfy-seo browser extension, where a REAL `document` is passed instead. This
 * file lets Node build the same read-only surface the core uses on a real DOM:
 *   document.documentElement / head / body / doctype / querySelectorAll / querySelector
 *   element: nodeType, nodeName, tagName, localName, getAttribute, hasAttribute, attributes (array of
 *   {name,value}), childNodes, children, parentNode, textContent, querySelectorAll, querySelector
 *   text node: nodeType 3, nodeValue, data, textContent
 * Selector subset: tag, *, #id, .class, [attr], [attr=v], [attr~=v], [attr^=v], [attr$=v], [attr*=v],
 * descendant (space) and child (>) combinators, comma lists. Results come back in document order.
 *
 * It is a tolerant tokenizer, NOT a WHATWG-conformant parser: no adoption agency, no table foster
 * parenting, no implied-tag repair beyond the small optional-end-tag table below. Good enough to read
 * head tags, headings, links, images and JSON-LD of real pages; do not use it to judge markup validity.
 * Pure: no imports, no Node built-ins.
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);
const BLOCK_CLOSES_P = ['address', 'article', 'aside', 'blockquote', 'div', 'dl', 'fieldset', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul'];
const AUTO_CLOSE = {
  li: ['li'], dt: ['dt', 'dd'], dd: ['dt', 'dd'], tr: ['tr', 'td', 'th'], td: ['td', 'th'], th: ['td', 'th'], option: ['option'],
};
for (const b of BLOCK_CLOSES_P) AUTO_CLOSE[b] = [...(AUTO_CLOSE[b] || []), 'p'];

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·', trade: '™', euro: '€' };

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, g) => {
    if (g[0] === '#') {
      const cp = g[1].toLowerCase() === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      try { return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m; } catch { return m; }
    }
    const v = NAMED[g.toLowerCase()];
    return v === undefined ? m : v;
  });
}

class TextNode {
  constructor(data) { this.nodeType = 3; this.nodeName = '#text'; this.data = data; this.nodeValue = data; this.parentNode = null; }
  get textContent() { return this.data; }
}

class Element {
  constructor(name, attrs) {
    this.nodeType = 1;
    this.localName = name;
    this.nodeName = this.tagName = name.toUpperCase();
    this.attributes = attrs; // [{name, value}]
    this.childNodes = [];
    this.parentNode = null;
  }
  getAttribute(n) { const k = String(n).toLowerCase(); const a = this.attributes.find((x) => x.name === k); return a ? a.value : null; }
  hasAttribute(n) { return this.getAttribute(n) !== null; }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  querySelectorAll(sel) { return queryAll(this, sel); }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
}

class Document {
  constructor(root, doctype) {
    this.nodeType = 9;
    this.nodeName = '#document';
    this.root = root; // synthetic container
    this.doctype = doctype;
    this.documentElement = null;
    this.head = null;
    this.body = null;
  }
  querySelectorAll(sel) { return queryAll(this.root, sel); }
  querySelector(sel) { return queryAll(this.root, sel)[0] || null; }
}

function parseAttrs(src) {
  const attrs = [];
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1].toLowerCase();
    if (attrs.some((a) => a.name === name)) continue; // first wins, like HTML
    const raw = m[2] ?? m[3] ?? m[4] ?? '';
    attrs.push({ name, value: decodeEntities(raw) });
  }
  return attrs;
}

export function parseHtml(html) {
  const src = String(html ?? '');
  const root = new Element('#root', []);
  root.nodeName = root.tagName = '#root';
  const stack = [root];
  let doctype = null;
  let i = 0;
  const top = () => stack[stack.length - 1];
  const addText = (t) => {
    if (!t) return;
    const n = new TextNode(decodeEntities(t));
    n.parentNode = top();
    top().childNodes.push(n);
  };
  const addRawText = (el, t) => { if (t) { const n = new TextNode(t); n.parentNode = el; el.childNodes.push(n); } };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { addText(src.slice(i)); break; }
    if (lt > i) addText(src.slice(i, lt));
    i = lt;
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (/^<!doctype/i.test(src.slice(i, i + 9))) {
      const end = src.indexOf('>', i);
      const body = src.slice(i + 9, end === -1 ? src.length : end).trim();
      doctype = { name: (body.split(/\s+/)[0] || '').toLowerCase(), raw: body };
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (src[i + 1] === '!' || src[i + 1] === '?') { // CDATA / processing instruction / bogus comment
      const end = src.indexOf('>', i);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (src[i + 1] === '/') {
      const m = /^<\/([a-zA-Z][^\s>\/]*)[^>]*>?/.exec(src.slice(i, i + 200));
      if (!m) { addText('<'); i += 1; continue; }
      const name = m[1].toLowerCase();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].localName === name) { stack.length = k; break; }
      }
      i += m[0].length;
      continue;
    }
    // start tag: find the closing '>' while respecting quotes
    const nameM = /^<([a-zA-Z][^\s>\/]*)/.exec(src.slice(i, i + 100));
    if (!nameM) { addText('<'); i += 1; continue; }
    const name = nameM[1].toLowerCase();
    let j = i + nameM[0].length;
    let q = null;
    for (; j < src.length; j++) {
      const c = src[j];
      if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break;
    }
    let attrSrc = src.slice(i + nameM[0].length, j);
    const selfClose = /\/\s*$/.test(attrSrc);
    if (selfClose) attrSrc = attrSrc.replace(/\/\s*$/, '');
    i = j + 1;

    const closes = AUTO_CLOSE[name];
    if (closes) while (stack.length > 1 && closes.includes(top().localName)) stack.pop();

    const el = new Element(name, parseAttrs(attrSrc));
    el.parentNode = top();
    top().childNodes.push(el);

    if (VOID.has(name)) continue;
    if (selfClose && stack.some((e) => e.localName === 'svg' || e.localName === 'math')) continue;
    if (name === 'svg' && selfClose) continue;
    if (RAW_TEXT.has(name)) {
      const re = new RegExp(`</${name}\\s*>`, 'i');
      const rest = src.slice(i);
      const m = re.exec(rest);
      const body = m ? rest.slice(0, m.index) : rest;
      // <title>/<textarea> are RCDATA (entities decoded); <script>/<style> are raw.
      addRawText(el, name === 'title' || name === 'textarea' ? decodeEntities(body) : body);
      i += m ? m.index + m[0].length : rest.length;
      continue;
    }
    stack.push(el);
  }

  const doc = new Document(root, doctype);
  const all = queryAll(root, '*');
  doc.documentElement = all.find((e) => e.localName === 'html') || root;
  doc.head = all.find((e) => e.localName === 'head') || doc.documentElement;
  doc.body = all.find((e) => e.localName === 'body') || doc.documentElement;
  return doc;
}

// ---- selector engine (subset) ----
function parseCompound(s) {
  const c = { tag: null, id: null, classes: [], attrs: [] };
  const re = /^(\*|[a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w:-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*(?:\s[iIsS])?)?\s*\]/y;
  let pos = 0;
  while (pos < s.length) {
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m || m[0] === '') throw new Error(`mini-dom: unsupported selector "${s}"`);
    if (m[1]) c.tag = m[1].toLowerCase();
    else if (m[2]) c.id = m[2];
    else if (m[3]) c.classes.push(m[3]);
    else if (m[4]) c.attrs.push({ name: m[4].toLowerCase(), op: m[5] || null, value: m[6] ?? m[7] ?? m[8] ?? '' });
    pos = re.lastIndex;
  }
  return c;
}

function parseSelector(sel) {
  return String(sel).split(',').map((part) => {
    const tokens = part.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean);
    const chain = [];
    let comb = ' ';
    for (const t of tokens) {
      if (t === '>') { comb = '>'; continue; }
      chain.push({ comb, c: parseCompound(t) });
      comb = ' ';
    }
    return chain;
  }).filter((ch) => ch.length);
}

function matchCompound(el, c) {
  if (c.tag && c.tag !== '*' && el.localName !== c.tag) return false;
  if (c.id && el.getAttribute('id') !== c.id) return false;
  if (c.classes.length) {
    const have = (el.getAttribute('class') || '').split(/\s+/);
    if (!c.classes.every((k) => have.includes(k))) return false;
  }
  for (const a of c.attrs) {
    const v = el.getAttribute(a.name);
    if (v === null) return false;
    if (!a.op) continue;
    const lv = v.toLowerCase(); const want = a.value.toLowerCase();
    if (a.op === '=' && lv !== want) return false;
    if (a.op === '~=' && !lv.split(/\s+/).includes(want)) return false;
    if (a.op === '^=' && !lv.startsWith(want)) return false;
    if (a.op === '$=' && !lv.endsWith(want)) return false;
    if (a.op === '*=' && !lv.includes(want)) return false;
    if (a.op === '|=' && !(lv === want || lv.startsWith(`${want}-`))) return false;
  }
  return true;
}

function matchChain(el, chain, idx) {
  const { comb, c } = chain[idx];
  if (!matchCompound(el, c)) return false;
  if (idx === 0) return true;
  let p = el.parentNode;
  if (comb === '>') return !!p && p.nodeType === 1 && matchChain(p, chain, idx - 1);
  while (p && p.nodeType === 1) { if (matchChain(p, chain, idx - 1)) return true; p = p.parentNode; }
  return false;
}

function queryAll(scope, sel) {
  const chains = parseSelector(sel);
  const out = [];
  const walk = (node) => {
    for (const ch of node.childNodes) {
      if (ch.nodeType !== 1) continue;
      if (chains.some((chain) => matchChain(ch, chain, chain.length - 1))) out.push(ch);
      walk(ch);
    }
  };
  walk(scope);
  return out;
}
