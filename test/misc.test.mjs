import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSitemap, isListed } from '../src/lib/sitemap.mjs';
import { urlMetrics, urlIssues } from '../src/lib/urlquality.mjs';
import { toCsv, fileStamp } from '../src/lib/csv.mjs';
import { rawVsRendered, compareMatrix } from '../src/lib/compare.mjs';
import { flattenJsonLd, readJsonLd, readMicrodata, readRdfa } from '../src/lib/schema.mjs';
import { headDump, pageInfo, linkDescriptors, images, iframes, visibleText, formatOf } from '../src/lib/collect.mjs';
import { parseHtml } from './helpers/mini-dom.mjs';
import { PAGE } from './fixtures.mjs';

const SR = JSON.parse(readFileSync(new URL('../src/engine/seorius-rules.json', import.meta.url)));

test('sitemap parse and listing (www, slash, http variants match)', () => {
  const x = '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/a/</loc></url><url><loc><![CDATA[https://example.com/b?x=1&amp;y=2]]></loc></url></urlset>';
  const p = parseSitemap(x);
  assert.equal(p.type, 'urlset'); assert.equal(p.total, 2);
  assert.ok(isListed(p.locs, 'https://www.example.com/a'));
  assert.ok(!isListed(p.locs, 'https://www.example.com/c'));
  assert.equal(parseSitemap('<sitemapindex><sitemap><loc>https://e.com/s1.xml</loc></sitemap></sitemapindex>').type, 'sitemapindex');
  assert.equal(parseSitemap('<html></html>').type, 'unknown');
  assert.equal(parseSitemap(x, 1).truncated, true);
});

test('url quality', () => {
  const m = urlMetrics(`https://e.com/a/b_c/${'x'.repeat(45)}?a=1&b=2&c=3&d=4`);
  assert.equal(m.queryParams, 4); assert.equal(m.pathSegments, 3);
  const keys = urlIssues(m, SR.urlQuality).map((i) => i.key);
  assert.ok(keys.includes('url_params') && keys.includes('url_segment'));
  assert.deepEqual(urlIssues(urlMetrics('https://e.com/kisa-yol'), SR.urlQuality), []);
});

test('csv escaping and formula guard', () => {
  assert.equal(toCsv(['a', 'b'], [['x,y', '=SUM(1)'], ['"q"', ['p', 'q']]]), 'a,b\r\n"x,y",\'=SUM(1)\r\n"""q""",p | q\r\n');
  assert.match(fileStamp('https://www.e.com/x', new Date('2026-10-28T10:00:00Z')), /^seorius-www\.e\.com-2026-10-28$/);
});

test('raw vs rendered and compare matrix', () => {
  const raw = { title: { text: 'A' }, metaDescription: { text: null }, canonical: {}, robots: { entries: [] }, headings: { outline: [] }, openGraph: {}, content: { wordCount: 1 }, links: { total: 0 }, images: { total: 0 } };
  const ren = { ...raw, title: { text: 'B' }, metaDescription: { text: 'D' } };
  const rows = rawVsRendered(raw, ren);
  assert.equal(rows.find((r) => r.field === 'title').state, 'different');
  assert.equal(rows.find((r) => r.field === 'description').state, 'rendered-only');
  assert.equal(rows.find((r) => r.field === 'lang').state, 'same');
  const m = compareMatrix([{ url: 'a', status: 200, result: raw }, { url: 'b', error: 'cross-origin-unreadable' }]);
  assert.deepEqual(m.rows.find((r) => r.field === 'title').values, ['A', null]);
  assert.deepEqual(m.errors, [null, 'cross-origin-unreadable']);
});

test('schema readers: JSON-LD @graph, microdata tree, RDFa', () => {
  assert.deepEqual(flattenJsonLd({ '@graph': [{ '@type': 'A', x: { '@type': 'http://schema.org/B' } }] }).map((n) => n.types[0]), ['A', 'B']);
  const doc = parseHtml(PAGE);
  const jl = readJsonLd(doc);
  assert.equal(jl.length, 2); assert.ok(jl[1].error);
  const md = readMicrodata(doc);
  assert.equal(md.length, 1); assert.deepEqual(md[0].types, ['Product']);
  assert.equal(md[0].props.find((p) => p.name === 'offers').item.props[0].value, '10');
  assert.deepEqual(readRdfa(doc)[0].types, ['Person']);
});

test('collectors on a parsed document', () => {
  const doc = parseHtml(PAGE); const u = 'https://www.example.com/cicek';
  const hd = headDump(doc);
  assert.equal(hd.filter((r) => r.tag === 'meta' && r.duplicate).length, 2);
  const pi = pageInfo(doc, u, {});
  assert.equal(pi.keywordCount, 2); assert.ok(pi.hasIconLink);
  const ld = linkDescriptors(doc, u);
  assert.equal(ld[0].href, 'https://www.example.com/a');
  assert.equal(ld.find((l) => l.anchorType === 'image').text, '[img] logo');
  assert.ok(ld.some((l) => l.anchorType === 'empty'));
  const im = images(doc, u);
  assert.deepEqual(im.map((i) => i.altState), ['text', 'missing', 'empty']);
  assert.equal(im[1].src, 'https://www.example.com/no-alt.jpg');
  assert.equal(iframes(doc, u)[0].sameOrigin, false);
  assert.match(visibleText(doc.body), /İstanbul çiçek teslimatı/);
  assert.equal(formatOf('data:image/svg+xml;base64,xx'), 'svg');
  assert.equal(formatOf('https://e.com/a.JPEG?x'), 'jpg');
});
