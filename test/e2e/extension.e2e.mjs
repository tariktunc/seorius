// End-to-end check in a real Chromium: the optional cross-site path (src/ui/hostaccess.js +
// src/lib/probe.mjs) running inside an extension page. Run with `npm run test:e2e` after `npm run build`.
//
// Two local servers stand in for "the inspected site" and "another site"; Chromium maps the
// hostnames site-a.test / site-b.test to 127.0.0.1 (--host-resolver-rules), so the private-address
// skip rule does not apply and the requests are genuinely cross-origin. site-b sends no CORS headers.
//
// The test copy of dist/ moves the optional permissions into "permissions" / "host_permissions":
// a permission prompt cannot be clicked in automation, and the code path after the grant is the
// same either way (chrome.permissions.contains is true). A test page bundles the real modules.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const serve = () => new Promise((ok) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => ok(s)); });

let a; let b; let ctx; let page; let dir; let A; let B;

before(async () => {
  a = await serve();
  b = await serve();
  A = `http://site-a.test:${a.address().port}`;
  B = `http://site-b.test:${b.address().port}`;
  // site-a: 301 -> 302 -> 200 (the inspected page), plus a redirect loop.
  a.on('request', (req, res) => {
    const p = req.url;
    if (p === '/start') { res.writeHead(301, { location: '/step' }); res.end(); }
    else if (p === '/step') { res.writeHead(302, { location: `${B}/landing` }); res.end(); }
    else if (p === '/loop1') { res.writeHead(302, { location: '/loop2' }); res.end(); }
    else if (p === '/loop2') { res.writeHead(302, { location: '/loop1' }); res.end(); }
    else { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>a</title>'); }
  });
  // site-b: no CORS headers at all.
  b.on('request', (req, res) => {
    const p = req.url;
    if (p === '/landing' || p === '/ok') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>b</title>'); }
    else if (p === '/img.png') { const body = Buffer.alloc(1234); res.writeHead(200, { 'content-type': 'image/png', 'content-length': body.length }); res.end(req.method === 'HEAD' ? undefined : body); }
    else if (p === '/moved') { res.writeHead(301, { location: '/ok' }); res.end(); }
    else if (p === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); res.end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${A}/page</loc></url><url><loc>${B}/x</loc></url></urlset>`); }
    else { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('missing'); }
  });

  dir = await mkdtemp(path.join(tmpdir(), 'seorius-e2e-'));
  const ext = path.join(dir, 'ext');
  await cp(path.join(root, 'dist'), ext, { recursive: true });
  const m = JSON.parse(await readFile(path.join(ext, 'manifest.json'), 'utf8'));
  m.permissions = [...m.permissions, ...(m.optional_permissions || [])];
  m.host_permissions = m.optional_host_permissions;
  delete m.optional_permissions; delete m.optional_host_permissions;
  await writeFile(path.join(ext, 'manifest.json'), JSON.stringify(m, null, 2));
  await writeFile(path.join(dir, 'entry.js'), [
    `import * as H from ${JSON.stringify(path.join(root, 'src/ui/hostaccess.js').replace(/\\/g, '/'))};`,
    `import * as P from ${JSON.stringify(path.join(root, 'src/lib/probe.mjs').replace(/\\/g, '/'))};`,
    'globalThis.__t = { H, P };',
  ].join('\n'));
  await build({ entryPoints: [path.join(dir, 'entry.js')], outfile: path.join(ext, 'e2e.js'), bundle: true, format: 'iife', target: ['chrome116'], logLevel: 'warning' });
  await writeFile(path.join(ext, 'e2e.html'), '<!doctype html><meta charset="utf-8"><script src="e2e.js"></script>');

  ctx = await chromium.launchPersistentContext(path.join(dir, 'profile'), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP site-a.test 127.0.0.1, MAP site-b.test 127.0.0.1'],
  });
  // No service worker: find the extension id from the profile.
  let id = null;
  for (let i = 0; i < 40 && !id; i++) {
    try {
      const prefs = JSON.parse(await readFile(path.join(dir, 'profile', 'Default', 'Secure Preferences'), 'utf8'));
      const s = prefs.extensions?.settings || {};
      id = Object.keys(s).find((k) => s[k].path && path.resolve(s[k].path) === path.resolve(ext)) || null;
    } catch { /* not written yet */ }
    if (!id) await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(id, 'extension id not found in the test profile');
  page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/e2e.html`);
  await page.waitForFunction(() => !!globalThis.__t);
});

after(async () => {
  await ctx?.close();
  a?.close(); b?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

test('host access is reported as granted', async () => {
  assert.equal(await page.evaluate(() => globalThis.__t.H.initHostAccess()), true);
});

test('redirect chain: every hop with its status, across origins', async () => {
  const r = await page.evaluate((u) => globalThis.__t.H.traceRedirects(u), `${A}/start`);
  assert.equal(r.notRun, undefined, `not run: ${r.notRun}`);
  assert.deepEqual(r.hops.map((h) => [h.url, h.status]), [[`${A}/start`, 301], [`${A}/step`, 302], [`${B}/landing`, 200]]);
  assert.equal(r.complete, true);
  assert.equal(r.finalUrl, `${B}/landing`);
});

test('redirect loop is detected and stops', async () => {
  const r = await page.evaluate((u) => globalThis.__t.H.traceRedirects(u, { timeoutMs: 8000 }), `${A}/loop1`);
  assert.equal(r.notRun, undefined, `not run: ${r.notRun}`);
  assert.equal(r.complete, false);
  assert.ok(r.loop || r.error || r.truncated, JSON.stringify(r));
});

test('cross-site link check reads a site without CORS headers', async () => {
  const rows = await page.evaluate(({ A, B }) => globalThis.__t.P.checkLinksWith([`${B}/ok`, `${B}/missing`, `${B}/moved`], { fetchImpl: globalThis.__t.H.extensionFetch, pageUrl: `${A}/page`, timeoutMs: 5000, concurrency: 3, corsBound: false }), { A, B });
  const by = Object.fromEntries(rows.map((r) => [r.url.split('/').pop(), r]));
  assert.equal(by.ok.status, 'ok');
  assert.equal(by.missing.status, 'broken');
  assert.equal(by.moved.status, 'redirected');
});

test('without host access a page cannot read the other site (CORS)', async () => {
  // Page path: a plain CORS-mode fetch from site-a's own page.
  const p2 = await ctx.newPage();
  await p2.goto(`${A}/page`);
  const err = await p2.evaluate(async (u) => { try { await fetch(u, { mode: 'cors', credentials: 'omit' }); return null; } catch (e) { return String(e); } }, `${B}/missing`);
  await p2.close();
  assert.ok(err, 'cross-origin read without CORS headers should fail in a page');
});

test('cross-site image size and sitemap are read', async () => {
  const [img] = await page.evaluate(({ A, B }) => globalThis.__t.P.measureImagesWith([`${B}/img.png`], { fetchImpl: globalThis.__t.H.extensionFetch, pageUrl: `${A}/page`, timeoutMs: 5000, concurrency: 1, corsBound: false }), { A, B });
  assert.equal(img.bytes, 1234);
  const [sm] = await page.evaluate(({ A, B }) => globalThis.__t.P.checkSitemapsWith([`${B}/sitemap.xml`], { fetchImpl: globalThis.__t.H.extensionFetch, pageUrl: `${A}/page`, timeoutMs: 5000, maxBytes: 1e6, urlCap: 1000, childCap: 3 }), { A, B });
  assert.equal(sm.ok, true);
  assert.equal(sm.urlCount, 2);
  assert.equal(sm.listed, true);
});
