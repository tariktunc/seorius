// Engine findings in the UI language: every message code the engine can emit has an en and tr text
// (and a fix text where the engine gives a fix hint), the placeholders match the params the engine
// passes, and rendering leaves no {placeholder} behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHtml } from './helpers/mini-dom.mjs';
import { inspectDocument } from '../src/engine/page-inspect-core.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const RULES = JSON.parse(read('../src/engine/on-page-rules.json'));
const L = { en: JSON.parse(read('../src/_locales/en/messages.json')), tr: JSON.parse(read('../src/_locales/tr/messages.json')) };

// code -> [param names, has fix hint]. Kept by hand on purpose: the source scan below fails when the
// engine gains or loses a code, so this list (and the locale files) must be updated with it.
const CODES = {
  title_missing: [[], 1], title_empty: [[], 1], title_multiple: [['n'], 1], title_short: [['n', 'min', 'max'], 1], title_long: [['n', 'min', 'max'], 1],
  desc_missing: [[], 1], desc_empty: [[], 1], desc_multiple: [['n'], 1], desc_short: [['n', 'min', 'max'], 0], desc_long: [['n', 'min', 'max'], 0],
  robots_noindex_meta: [[], 1], robots_noindex_header: [[], 1], robots_noindex_both: [[], 1], robots_nofollow: [[], 0], robots_xrt_notrun: [[], 0],
  canonical_missing: [[], 1], canonical_multiple: [['n'], 1], canonical_empty: [[], 0], canonical_relative: [['href'], 1], canonical_other: [['url'], 0], canonical_slash: [[], 0], canonical_notrun: [[], 0], canonical_http: [[], 0],
  consistency_noindex_canonical: [[], 1], consistency_noindex_self: [[], 0], consistency_header_only: [[], 1],
  lang_missing: [[], 1], lang_malformed: [['lang'], 0],
  viewport_missing: [[], 1], viewport_width: [['width'], 0], viewport_width_unset: [[], 0], viewport_zoom: [['content'], 1],
  charset_missing: [[], 1], charset_not_utf8: [['charset'], 0], charset_mismatch: [['meta', 'header'], 0], charset_late: [['bytes'], 0],
  doctype_missing: [[], 1], doctype_notrun: [[], 0],
  hreflang_malformed: [['values'], 0], hreflang_relative: [['n'], 0], hreflang_duplicate: [['values'], 0], hreflang_no_default: [[], 0], hreflang_no_self: [[], 0], hreflang_notrun: [[], 0],
  h1_missing: [[], 1], h1_multiple: [['n'], 1], h1_empty: [[], 0], outline_skip: [['skips'], 0], outline_empty: [['n'], 0],
  images_alt_missing: [['n', 'total'], 1], images_alt_empty: [['n'], 0], images_no_dims: [['n', 'total'], 0],
  links_empty_anchor: [['n'], 1], links_javascript: [['n'], 0], links_placeholder: [['n'], 0], links_notrun: [[], 0],
  og_missing: [['fields'], 1], og_image_relative: [[], 0], og_url_differs: [['url'], 0], twitter_missing: [['fields'], 0],
  sd_parse_error: [['n', 'errors'], 1], sd_http_context: [[], 0], sd_none: [[], 0],
  tracking_ua: [[], 1], tracking_none: [[], 0],
  content_thin: [['n', 'min'], 0], content_ratio_notrun: [[], 0], content_ratio_low: [['ratio', 'min'], 0], keywords_density: [['max', 'words'], 0],
  mixed_active: [['n', 'urls'], 1], mixed_passive: [['n', 'urls'], 1], mixed_http_page: [[], 0], mixed_notrun: [[], 0],
  hsts_notrun: [[], 0], hsts_http_page: [[], 0], hsts_missing: [[], 1], hsts_short: [['maxAge', 'min'], 0], hsts_no_maxage: [['min'], 0], hsts_no_subdomains: [[], 0],
};

// Same substitution as src/ui/common.js t(), but a missing param is left visible so the test sees it.
const render = (lang, key, params) => L[lang][key].message.replace(/\{(\w+)\}/g, (m, p) => (params[p] !== undefined && params[p] !== null ? String(params[p]) : m));
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

test('engine source codes == the CODES list (no code without locale text)', () => {
  const src = read('../src/engine/page-inspect-core.mjs');
  const found = new Set();
  for (const line of src.split('\n').filter((l) => /\badd\('[a-z0-9-]+', /.test(l))) {
    const head = line.slice(line.indexOf('add('));
    for (const m of head.matchAll(/'([a-z][a-z0-9]*_[a-z0-9_]+)'/g)) found.add(m[1]);
    if (head.includes('`robots_noindex_${')) ['meta', 'header', 'both'].forEach((x) => found.add(`robots_noindex_${x}`));
  }
  assert.deepEqual([...found].sort(), Object.keys(CODES).sort());
  assert.equal(found.size, 79);
});

test('every engine code has en + tr text (and fix text), placeholders = engine params', () => {
  for (const [code, [params, fix]] of Object.entries(CODES)) {
    for (const lang of ['en', 'tr']) {
      const k = `e_${code}`;
      assert.ok(L[lang][k], `${lang}:${k}`);
      assert.deepEqual([...new Set(placeholders(L[lang][k].message))].sort(), [...params].sort(), `${lang}:${k} placeholders`);
      if (fix) { assert.ok(L[lang][`${k}_fix`], `${lang}:${k}_fix`); for (const p of placeholders(L[lang][`${k}_fix`].message)) assert.ok(params.includes(p), `${lang}:${k}_fix {${p}}`); }
      else assert.ok(!L[lang][`${k}_fix`], `${lang}:${k}_fix is unused`);
    }
    assert.notEqual(L.tr[`e_${code}`].message, L.en[`e_${code}`].message, `tr e_${code} is not translated`);
  }
});

// Pages built to make the engine emit (nearly) every code.
const pad = (n) => `<!-- ${'x'.repeat(n)} -->`;
const many = Array.from({ length: 120 }, () => 'çiçek').join(' ');
const CASES = [
  // A: almost nothing declared, http page with headers
  { html: '<html><head><meta name="description" content=""></head><body><p>az metin</p></body></html>', url: 'http://example.com/a', headers: { 'content-type': 'text/html' }, raw: true },
  // B: everything duplicated / malformed, https with weak HSTS
  { html: `<!doctype html><html lang="tr_TR"><head>${pad(1100)}<meta charset="latin1"><title>A</title><title>B</title>
    <meta name="description" content="kısa"><meta name="description" content="iki">
    <meta name="robots" content="noindex, nofollow">
    <link rel="canonical" href="/other"><link rel="canonical" href="https://example.com/x">
    <meta name="viewport" content="width=500, user-scalable=no">
    <link rel="alternate" hreflang="tr_TR" href="/tr"><link rel="alternate" hreflang="en" href="https://e.com/en"><link rel="alternate" hreflang="en" href="https://e.com/en2">
    <meta property="og:title" content="t"><meta property="og:image" content="/i.jpg"><meta property="og:url" content="https://elsewhere.com/">
    <script type="application/ld+json">{"@context":"http://schema.org","@type":"Thing"}</script><script type="application/ld+json">{bad</script>
    <script src="https://www.google-analytics.com/analytics.js"></script><script src="http://cdn.example.com/a.js"></script>
    </head><body><h1>Bir</h1><h1></h1><h3>Atlama</h3><h4></h4>
    <img src="http://example.com/a.jpg"><img src="b.jpg" alt=""><a href="/x"></a><a href="javascript:void(0)">js</a><a href="#">boş</a>
    <p>${many}</p>${'<div></div>'.repeat(4000)}</body></html>`, url: 'https://example.com/b', headers: { 'content-type': 'text/html; charset=utf-8', 'strict-transport-security': 'max-age=100' }, raw: true },
  // C: empty values, header-only noindex with a self canonical, http canonical, HSTS without max-age
  { html: `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title></title><meta name="description" content="${'u'.repeat(400)}">
    <link rel="canonical" href="http://example.com/c/"><meta name="viewport" content="initial-scale=1"></head><body><h1>Başlık ${'çok uzun başlık '.repeat(10)}</h1></body></html>`,
    url: 'https://example.com/c', headers: { 'x-robots-tag': 'noindex', 'strict-transport-security': 'includeSubDomains' }, raw: true },
  { html: '<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Uzun başlık uzun başlık uzun başlık uzun başlık uzun başlık uzun başlık uzun</title><link rel="canonical" href=""></head><body></body></html>', url: 'https://example.com/d', headers: { 'content-type': 'text/html' }, raw: true },
  // E: noindex in meta and header + self canonical
  { html: '<!doctype html><html lang="tr"><head><meta name="robots" content="noindex"><link rel="canonical" href="https://example.com/e"></head><body></body></html>', url: 'https://example.com/e', headers: { 'x-robots-tag': 'noindex' }, raw: true },
  { html: '<html><head><link rel="canonical" href="https://example.com/g/"></head><body></body></html>', url: 'https://example.com/g' },
  { html: '<html><head><link rel="canonical" href="https://example.com/f"><link rel="alternate" hreflang="tr" href="https://example.com/f"></head><body><a href="https://x.org/">x</a></body></html>' },
];

test('rendered engine findings: known code, params match, no leftover {placeholder} in en or tr', () => {
  const seen = new Set();
  for (const c of CASES) {
    const r = inspectDocument(parseHtml(c.html), { rules: RULES, url: c.url, headers: c.headers, rawHtml: c.raw ? c.html : null });
    for (const f of r.findings) {
      const code = f.msgKey.replace(/^e_/, '');
      assert.ok(code in CODES, f.msgKey);
      assert.ok(f.message, 'English message kept as fallback');
      assert.deepEqual(Object.keys(f.params).sort(), [...CODES[code][0]].sort(), `${code} params`);
      assert.equal(!!f.fixKey, !!CODES[code][1], `${code} fixKey`);
      assert.equal(!!f.fixKey, !!f.fix_hint, `${code} fixKey follows fix_hint`);
      for (const lang of ['en', 'tr']) {
        assert.doesNotMatch(render(lang, f.msgKey, f.params), /\{\w+\}/, `${lang}:${f.msgKey}`);
        if (f.fixKey) assert.doesNotMatch(render(lang, f.fixKey, f.params), /\{\w+\}/, `${lang}:${f.fixKey}`);
      }
      seen.add(code);
    }
  }
  const missed = Object.keys(CODES).filter((k) => !seen.has(k));
  assert.deepEqual(missed, [], 'every code exercised by the cases above');
});
