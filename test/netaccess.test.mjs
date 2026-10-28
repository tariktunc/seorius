// Redirect chain assembly (G2) and probe path selection / extension-side probes (G3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assembleChain, requestIdFor } from '../src/lib/redirects.mjs';
import { splitProbeTargets, checkLinksWith, measureImagesWith, checkSitemapsWith } from '../src/lib/probe.mjs';
import { extraFindings } from '../src/lib/extras.mjs';

const P = 'https://www.example.com/page';

test('redirect chain: hops in order with status codes, other requests ignored', () => {
  const ev = [
    { type: 'request', requestId: '9', url: 'https://other.com/' },
    { type: 'request', requestId: '1', url: 'http://example.com/page' },
    { type: 'redirect', requestId: '9', url: 'https://other.com/', statusCode: 302, redirectUrl: 'https://other.com/x' },
    { type: 'redirect', requestId: '1', url: 'http://example.com/page', statusCode: 301, redirectUrl: 'https://example.com/page' },
    { type: 'redirect', requestId: '1', url: 'https://example.com/page', statusCode: 308, redirectUrl: 'https://www.example.com/page' },
    { type: 'completed', requestId: '9', url: 'https://other.com/x', statusCode: 404 },
    { type: 'completed', requestId: '1', url: 'https://www.example.com/page', statusCode: 200 },
  ];
  assert.equal(requestIdFor(ev, 'http://example.com/page#frag'), '1');
  const c = assembleChain(ev, 'http://example.com/page');
  assert.deepEqual(c.hops.map((h) => [h.url, h.status]), [['http://example.com/page', 301], ['https://example.com/page', 308], ['https://www.example.com/page', 200]]);
  assert.equal(c.hops[0].location, 'https://example.com/page');
  assert.equal(c.finalUrl, 'https://www.example.com/page');
  assert.equal(c.finalStatus, 200);
  assert.ok(c.complete && !c.truncated && !c.loop && !c.error);
});

test('redirect chain: no redirect, loop, cap, error, not observed, no end event', () => {
  const one = assembleChain([{ type: 'request', requestId: 'a', url: P }, { type: 'completed', requestId: 'a', url: P, statusCode: 200 }], P);
  assert.equal(one.hops.length, 1); assert.ok(one.complete);

  const loop = [{ type: 'request', requestId: 'l', url: 'https://a.com/1' }];
  for (let i = 0; i < 4; i++) loop.push({ type: 'redirect', requestId: 'l', url: `https://a.com/${(i % 2) + 1}`, statusCode: 302, redirectUrl: `https://a.com/${((i + 1) % 2) + 1}` });
  const lc = assembleChain(loop, 'https://a.com/1');
  assert.ok(lc.loop); assert.ok(!lc.complete); assert.equal(lc.hops.length, 3);

  const long = [{ type: 'request', requestId: 'c', url: 'https://a.com/0' }];
  for (let i = 0; i < 15; i++) long.push({ type: 'redirect', requestId: 'c', url: `https://a.com/${i}`, statusCode: 301, redirectUrl: `https://a.com/${i + 1}` });
  const cc = assembleChain(long, 'https://a.com/0', { maxHops: 10 });
  assert.equal(cc.hops.length, 10); assert.ok(cc.truncated && !cc.complete);

  const err = assembleChain([{ type: 'request', requestId: 'e', url: P }, { type: 'redirect', requestId: 'e', url: P, statusCode: 301, redirectUrl: 'https://x.invalid/' }, { type: 'error', requestId: 'e', url: 'https://x.invalid/', error: 'net::ERR_NAME_NOT_RESOLVED' }], P);
  assert.equal(err.error, 'net::ERR_NAME_NOT_RESOLVED'); assert.equal(err.hops.length, 2); assert.ok(!err.complete);

  const none = assembleChain([{ type: 'request', requestId: 'z', url: 'https://other.com/' }], P);
  assert.ok(!none.observed); assert.equal(none.hops.length, 0);

  const open = assembleChain([{ type: 'request', requestId: 'o', url: P }, { type: 'redirect', requestId: 'o', url: P, statusCode: 302, redirectUrl: 'https://b.com/' }], P);
  assert.ok(open.observed && !open.complete && !open.truncated && !open.error);
});

test('probe path: without the grant everything stays in the page; with it cross-origin goes to the extension', () => {
  const urls = ['https://www.example.com/a', 'https://example.com/b', 'https://other.org/c', 'http://www.example.com/d'];
  assert.deepEqual(splitProbeTargets(urls, P, false), { inPage: urls, fromExtension: [] });
  assert.deepEqual(splitProbeTargets(urls, P, true), { inPage: ['https://www.example.com/a'], fromExtension: ['https://example.com/b', 'https://other.org/c', 'http://www.example.com/d'] });
});

// Fake fetch: records calls, answers from a table { url: {status, method?, throws?, redirectedTo?, headers?} }.
function fakeFetch(table) {
  const calls = []; let inFlight = 0; let maxInFlight = 0;
  const fn = async (url, init) => {
    calls.push({ url, ...init });
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 2));
    inFlight--;
    const row = typeof table === 'function' ? table(url, init) : table[url];
    if (!row || row.throws) throw new TypeError('Failed to fetch');
    const status = typeof row.status === 'function' ? row.status(init.method) : row.status;
    const h = new Map(Object.entries(row.headers || {}));
    return { status, ok: status >= 200 && status < 300, redirected: !!row.redirectedTo, url: row.redirectedTo || url, headers: { get: (n) => h.get(n) ?? null }, text: async () => row.body || '' };
  };
  fn.calls = calls; fn.max = () => maxInFlight;
  return fn;
}

test('extension path (corsBound false): readable cross-origin results, same safety policy, no credentials', async () => {
  const f = fakeFetch({
    'https://other.org/ok': { status: 200 },
    'https://other.org/gone': { status: 404 },
    'https://other.org/head-refused': { status: (m) => (m === 'HEAD' ? 405 : 200) },
    'https://other.org/old': { status: 200, redirectedTo: 'https://other.org/login?next=/old' },
    'https://other.org/forbidden': { status: 403 },
    'https://other.org/down': { throws: true },
  });
  const urls = ['https://other.org/ok', 'https://other.org/gone', 'https://other.org/head-refused', 'https://other.org/old', 'https://other.org/forbidden', 'https://other.org/down', 'https://other.org/logout', 'http://10.0.0.1/x'];
  const r = Object.fromEntries((await checkLinksWith(urls, { fetchImpl: f, pageUrl: P, timeoutMs: 1000, concurrency: 2, corsBound: false })).map((x) => [x.url, x]));
  assert.equal(r['https://other.org/ok'].status, 'ok');
  assert.equal(r['https://other.org/gone'].status, 'broken');
  assert.equal(r['https://other.org/head-refused'].status, 'ok');
  assert.equal(r['https://other.org/old'].status, 'login-required');
  assert.equal(r['https://other.org/forbidden'].status, 'could-not-check');
  assert.deepEqual([r['https://other.org/down'].status, r['https://other.org/down'].reason], ['could-not-check', 'network-error']);
  assert.deepEqual([r['https://other.org/logout'].status, r['https://other.org/logout'].reason], ['skipped', 'action-url']);
  assert.equal(r['http://10.0.0.1/x'].reason, 'private-address');
  assert.ok(!f.calls.some((c) => /logout|10\.0\.0\.1/.test(c.url)), 'skipped URLs are never requested');
  assert.ok(f.calls.every((c) => c.credentials === 'omit'));
  assert.deepEqual(f.calls.filter((c) => c.url === 'https://other.org/head-refused').map((c) => c.method), ['HEAD', 'GET']);
  assert.ok(f.max() <= 2, `concurrency ${f.max()}`);
});

test('page path (corsBound true): an unreadable cross-origin response stays "not checked"', async () => {
  const f = fakeFetch({ 'https://www.example.com/a': { status: 200 } });
  const r = await checkLinksWith(['https://other.org/x', 'https://www.example.com/a'], { fetchImpl: f, pageUrl: P, timeoutMs: 1000, concurrency: 6, corsBound: true });
  assert.deepEqual([r[0].status, r[0].reason], ['not-checked', 'cross-origin-unreadable']);
  assert.equal(r[1].status, 'ok');
  const img = await measureImagesWith(['https://cdn.other.org/a.jpg'], { fetchImpl: f, pageUrl: P, timeoutMs: 1000, concurrency: 6, corsBound: true });
  assert.equal(img[0].reason, 'cross-origin-unreadable');
  const f2 = fakeFetch({ 'https://cdn.other.org/a.jpg': { status: 200, headers: { 'content-length': '2048' } } });
  const img2 = await measureImagesWith(['https://cdn.other.org/a.jpg'], { fetchImpl: f2, pageUrl: P, timeoutMs: 1000, concurrency: 6, corsBound: false });
  assert.deepEqual([img2[0].bytes, img2[0].source], [2048, 'content-length']);
});

test('cross-origin sitemaps: urlset and index, listing, skip policy', async () => {
  const f = fakeFetch({
    'https://cdn.other.com/sm.xml': { status: 200, body: '<urlset><url><loc>https://example.com/page</loc></url></urlset>' },
    'https://cdn.other.com/index.xml': { status: 200, body: '<sitemapindex><sitemap><loc>https://cdn.other.com/c1.xml</loc></sitemap></sitemapindex>' },
    'https://cdn.other.com/c1.xml': { status: 200, body: '<urlset><url><loc>https://example.com/else</loc></url></urlset>' },
    'https://cdn.other.com/404.xml': { status: 404 },
  });
  const r = await checkSitemapsWith(['https://cdn.other.com/sm.xml', 'https://cdn.other.com/index.xml', 'https://cdn.other.com/404.xml', 'http://192.168.0.1/sm.xml'], { fetchImpl: f, pageUrl: P, timeoutMs: 1000, maxBytes: 1e6, urlCap: 1000, childCap: 5 });
  assert.deepEqual(r.map((x) => [x.ok, x.listed ?? null]), [[true, true], [true, false], [false, null], [false, null]]);
  assert.equal(r[3].reason, 'private-address');
  assert.ok(f.calls.every((c) => c.credentials === 'omit'));
});

test('sitemap findings use cross-origin results once they exist', () => {
  const SR = JSON.parse(readFileSync(new URL('../src/engine/seorius-rules.json', import.meta.url)));
  const base = (net) => ({ url: P, engine: { hreflang: [] }, network: { page: { status: 200 }, robots: { status: 404 }, ...net } });
  const keys = (s) => extraFindings(s, SR).filter((x) => x.check === 'sitemap').map((x) => x.msgKey);
  const sm = { found: true, checked: true, listed: false, complete: true, declaredInRobots: true, skippedCrossOrigin: ['https://cdn.other.com/sm.xml'] };
  assert.deepEqual(keys(base({ sitemap: sm })), ['f_sitemap_not_listed', 'f_sitemap_crossorigin']);
  assert.deepEqual(keys(base({ sitemap: sm, sitemapCrossOrigin: [{ url: 'https://cdn.other.com/sm.xml', ok: true, listed: true }] })), []);
  const none = { found: false, checked: true, tried: [], skippedCrossOrigin: ['https://cdn.other.com/sm.xml'] };
  assert.deepEqual(keys(base({ sitemap: none })), ['f_sitemap_none', 'f_sitemap_crossorigin']);
  assert.deepEqual(keys(base({ sitemap: none, sitemapCrossOrigin: [{ url: 'https://cdn.other.com/sm.xml', ok: true, listed: false }] })), ['f_sitemap_xo_not_listed']);
});
