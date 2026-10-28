// Minimal sitemap reader: root type, <loc> list (capped), and whether a URL is listed.
// Regex-based on purpose so it runs in Node tests and in the page without an XML parser;
// it reads <loc> values only and does not validate the XML.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENT[e]).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));

export function parseSitemap(xml, cap = 50000) {
  const s = String(xml || '');
  const head = s.slice(0, 4096);
  let type = 'unknown';
  if (/<(\w+:)?urlset[\s>]/i.test(head) || /<(\w+:)?urlset[\s>]/i.test(s)) type = 'urlset';
  else if (/<(\w+:)?sitemapindex[\s>]/i.test(s)) type = 'sitemapindex';
  const locs = []; let total = 0;
  const re = /<(?:\w+:)?loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/(?:\w+:)?loc>/gi;
  let m;
  while ((m = re.exec(s))) { total++; if (locs.length < cap) locs.push(decode(m[1].trim())); }
  return { type, total, locs, truncated: total > locs.length };
}

export function normForMatch(u) {
  try { const x = new URL(u); x.hash = ''; let t = x.toString(); if (x.pathname !== '/') t = t.replace(/\/(?=(\?|$))/, ''); return t.replace(/^http:/, 'https:').replace('://www.', '://'); } catch { return null; }
}

export function isListed(locs, pageUrl) {
  const want = normForMatch(pageUrl);
  return !!want && locs.some((l) => normForMatch(l) === want);
}
