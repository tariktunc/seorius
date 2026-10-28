import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHtml } from './helpers/mini-dom.mjs';
import { inspectDocument } from '../src/engine/page-inspect-core.mjs';
import { buildAudit, normaliseFinding, CHECKS } from '../src/lib/audit.mjs';
import { extraFindings } from '../src/lib/extras.mjs';
import { PAGE } from './fixtures.mjs';

const RULES = JSON.parse(readFileSync(new URL('../src/engine/on-page-rules.json', import.meta.url)));
const SRULES = JSON.parse(readFileSync(new URL('../src/engine/seorius-rules.json', import.meta.url)));
const URL_ = 'https://www.example.com/cicek';

test('engine runs on a document and returns the observed shape', () => {
  const r = inspectDocument(parseHtml(PAGE), { rules: RULES, url: URL_, headers: { 'content-type': 'text/html; charset=utf-8', 'strict-transport-security': 'max-age=63072000' }, rawHtml: PAGE, surface: 'raw-html' });
  for (const k of ['title', 'metaDescription', 'robots', 'canonical', 'lang', 'headings', 'images', 'links', 'openGraph', 'structuredData', 'tracking', 'content', 'keywords', 'hsts', 'findings', 'summary']) assert.ok(k in r, k);
  assert.equal(r.title.text, 'İstanbul Çiçek Teslimatı | Örnek');
  assert.equal(r.metaDescription.count, 2);
  assert.equal(r.canonical.relation, 'self');
  assert.deepEqual(r.structuredData.jsonLdTypes.sort(), ['Organization', 'WebPage']);
  assert.equal(r.structuredData.jsonLdErrors.length, 1);
  assert.ok(r.tracking.some((t) => t.id === 'ga4'));
  for (const f of r.findings) {
    assert.ok(!f.id.includes('UNREGISTERED'), f.id);
    assert.ok(['fail', 'warn', 'info', 'not-run'].includes(f.severity));
  }
});

test('engine without url/headers reports not-run, never pass', () => {
  const r = inspectDocument(parseHtml(PAGE), { rules: RULES });
  const nr = r.findings.filter((f) => f.severity === 'not-run').map((f) => f.id);
  assert.ok(nr.includes('HEALTH-INSPECT-HSTS'));
  assert.ok(nr.includes('HEALTH-INSPECT-MIXED-CONTENT'));
  const audit = buildAudit(r.findings, []);
  assert.equal(audit.checks.find((c) => c.key === 'hsts').status, 'not-run');
  assert.equal(audit.checks.find((c) => c.key === 'mixed-content').status, 'not-run');
});

test('severity mapping and audit statuses', () => {
  assert.equal(normaliseFinding({ id: 'HEALTH-INSPECT-TITLE', severity: 'fail', message: 'x' }).severity, 'error');
  assert.equal(normaliseFinding({ id: 'HEALTH-INSPECT-TITLE', severity: 'warn', message: 'x' }).check, 'title');
  assert.equal(normaliseFinding({ id: 'HEALTH-INSPECT-TITLE', severity: 'info', message: 'x' }).severity, 'notice');
  const r = inspectDocument(parseHtml(PAGE), { rules: RULES, url: URL_, headers: { 'content-type': 'text/html; charset=utf-8' }, rawHtml: PAGE });
  const a = buildAudit(r.findings, []);
  assert.equal(a.checks.length, CHECKS.length);
  assert.equal(a.checks.find((c) => c.key === 'structured-data').status, 'error');
  assert.equal(a.checks.find((c) => c.key === 'description').status, 'warning');
  assert.equal(a.checks.find((c) => c.key === 'doctype').status, 'pass');
  assert.ok(a.attention.length <= 5 && a.attention.every((f) => ['error', 'warning'].includes(f.severity)));
  assert.equal(a.counts.error + a.counts.warning + a.counts.notice + a.counts['not-run'], a.findings.length);
});

test('extra findings: missing network data is not-run', () => {
  const r = inspectDocument(parseHtml(PAGE), { rules: RULES, url: URL_ });
  const ex = extraFindings({ url: URL_, engine: r, network: { page: { error: 'timeout' }, robots: { error: 'x' }, sitemap: null }, iframes: [{}], rawVsRendered: null, mediaQueries: null }, SRULES);
  const by = (c) => ex.filter((f) => f.check === c).map((f) => f.severity);
  assert.deepEqual(by('http-status'), ['not-run']);
  assert.deepEqual(by('robots-txt'), ['not-run']);
  assert.deepEqual(by('sitemap'), ['not-run']);
  assert.deepEqual(by('raw-rendered'), ['not-run']);
  assert.deepEqual(by('frames'), ['info']);
  const a = buildAudit([], ex);
  assert.equal(a.checks.find((c) => c.key === 'http-status').status, 'not-run');
});

test('extra findings: robots block for Googlebot is an error', () => {
  const r = inspectDocument(parseHtml(PAGE), { rules: RULES, url: URL_ });
  const ex = extraFindings({ url: URL_, engine: r, network: { page: { status: 200 }, robots: { status: 200, parsed: { errors: [] }, verdicts: [{ token: 'googlebot', agent: 'Googlebot', allowed: false, rule: { type: 'disallow', path: '/' } }] }, sitemap: { found: true, listed: true, declaredInRobots: true } } }, SRULES);
  assert.ok(ex.some((f) => f.check === 'robots-txt' && f.severity === 'fail'));
  assert.equal(buildAudit([], ex).checks.find((c) => c.key === 'sitemap').status, 'pass');
});

test('surface merge: doctype, charset and ratio come from the raw run', async () => {
  const { mergeSurfaces } = await import('../src/lib/surfaces.mjs');
  const rendered = PAGE.replace('<!doctype html>', '').replace('<p>', '<p>' + 'extra words '.repeat(400));
  const live = inspectDocument(parseHtml(rendered), { rules: RULES, url: URL_ });
  const raw = inspectDocument(parseHtml(PAGE), { rules: RULES, url: URL_, rawHtml: PAGE });
  assert.notEqual(live.doctype, 'html5');
  const m = mergeSurfaces(live, raw);
  assert.equal(m.doctype, 'html5');
  assert.ok(!m.findings.some((f) => f.id === 'HEALTH-INSPECT-DOCTYPE'));
  assert.equal(m.content.textHtmlRatioPercent, raw.content.textHtmlRatioPercent);
  assert.equal(m.content.wordCount, live.content.wordCount);
  assert.equal(mergeSurfaces(live, null).surfaces.textHtmlRatio, 'rendered-dom');
});
