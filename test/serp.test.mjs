import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHtml } from './helpers/mini-dom.mjs';
import { classifySerp, serpPage, unwrapUrl, isAdHref, domainMatches, serpCsv, aioCsv, serpFileName, SERP_MATCHES, SERP_HOSTS, FEATURES, SERP_CSV_HEADER } from '../src/lib/serp.mjs';
import { POPUP_TABS, reportPath, toolLinks } from '../src/lib/tools.mjs';
import { mergeSettings } from '../src/lib/settings.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const P1 = classifySerp(parseHtml(read('./fixtures/serp-page1.html')), 'https://www.google.com/search?q=kahve+makinesi&hl=en');
const P2 = classifySerp(parseHtml(read('./fixtures/serp-page2.html')), 'https://www.google.com.tr/search?q=kahve+makinesi&start=10');

test('serpPage: Google web search only, vertical tabs skipped, start offset read', () => {
  assert.equal(serpPage('https://www.google.com/search?q=a').skip, false);
  assert.equal(serpPage('https://www.google.com.tr/search?q=a&start=20').start, 20);
  assert.equal(serpPage('https://www.google.com/search?q=a&udm=14').skip, false, 'udm=14 is the plain Web filter');
  for (const v of ['tbm=isch', 'tbm=vid', 'tbm=shop', 'tbm=nws', 'tbm=bks', 'tbm=fin', 'udm=2', 'udm=7', 'udm=28']) assert.equal(serpPage(`https://www.google.com/search?q=a&${v}`).skip, true, v);
  assert.equal(serpPage('https://www.google.com/maps?q=a').skip, true);
  assert.equal(serpPage('https://www.bing.com/search?q=a').skip, true);
  assert.equal(serpPage('https://google.com.evil.example/search?q=a').skip, true);
});

test('organic positions 1..N on page 1, in page order, ads and features excluded', () => {
  assert.deepEqual(P1.organic.map((o) => o.position), [1, 2, 3, 4, 5]);
  assert.deepEqual(P1.organic.map((o) => o.domain), ['alpha.example', 'bravo.example', 'charlie.example', 'delta.example', 'shop.myshop.example']);
  const urls = P1.organic.map((o) => o.url);
  for (const bad of ['shop-one', 'shop-two', 'shop-three', 'answers.example', 'youtube.com', 'news-one', 'kp.example', 'guide.example']) assert.ok(!urls.some((u) => u.includes(bad)), bad);
});

test('page 2 (start=10) numbers from 11', () => {
  assert.deepEqual(P2.organic.map((o) => o.position), [11, 12, 13]);
  assert.equal(P2.organic[2].url, 'https://golf.example/c', '/url?url= unwrapped');
});

test('dedupe by final URL and /url?q= unwrap', () => {
  assert.equal(P1.organic.filter((o) => o.domain === 'charlie.example').length, 1);
  assert.equal(P1.organic[2].url, 'https://charlie.example/kahve-makinesi');
  assert.equal(unwrapUrl('/url?q=https://x.example/a%3Fb&sa=U', 'https://www.google.com/search?q=z'), 'https://x.example/a?b');
  assert.equal(unwrapUrl('https://x.example/a#frag', 'https://www.google.com/'), 'https://x.example/a');
  assert.equal(unwrapUrl('javascript:void(0)', 'https://www.google.com/'), null);
});

test('ads labelled separately: top and bottom, own counter, never in organic numbering', () => {
  assert.deepEqual(P1.ads.map((a) => [a.n, a.slot, a.domain]), [[1, 'top', 'shop-one.example'], [2, 'top', 'shop-two.example'], [3, 'bottom', 'shop-three.example']]);
  assert.deepEqual(P2.ads.map((a) => [a.n, a.slot, a.domain]), [[1, 'bottom', 'hotel.example']]);
  assert.ok(isAdHref('https://www.googleadservices.com/pagead/aclk?sa=L'));
  assert.ok(isAdHref('/aclk?sa=l&ai=x'));
  assert.ok(!isAdHref('https://alpha.example/aclk-guide'));
});

test('each SERP feature is detected on its fixture block', () => {
  const kinds = (r) => r.features.map((f) => f.kind).sort();
  assert.deepEqual(kinds(P1), [...FEATURES].sort());
  const cls = Object.fromEntries(P1.features.map((f) => [f.kind, f.el.getAttribute('class')]));
  assert.equal(cls.paa, 'box paa'); assert.equal(cls.local_pack, 'box local'); assert.equal(cls.video, 'box videos');
  assert.equal(cls.images, 'box images'); assert.equal(cls.top_stories, 'box news'); assert.equal(cls.ai_overview, 'aio');
  assert.deepEqual(P1.organic[0].features, ['featured_snippet']);
  assert.deepEqual(P1.organic[1].features, ['sitelinks']);
  assert.equal(P1.organic[1].sitelinks.length, 3);
  assert.deepEqual(kinds(P2), []);
});

test('AI Overview sources: distinct cited pages', () => {
  assert.deepEqual(P1.aiOverview.sources.map((s) => s.domain), ['guide.example', 'wiki.example']);
  assert.equal(P2.aiOverview, null);
});

test('classifier never throws on odd input', () => {
  assert.equal(classifySerp(parseHtml(''), 'https://www.google.com/search?q=a').organic.length, 0);
  assert.equal(classifySerp(parseHtml('<div id="rso"><a><h3>x</h3></a></div>'), 'https://www.google.com/search?q=a').organic.length, 0);
  assert.equal(classifySerp(parseHtml('<p>x</p>'), 'not a url').skip, true);
});

test('SERP CSV: columns, BOM, formula escaping, order', () => {
  const csv = serpCsv(P1);
  assert.ok(csv.startsWith('﻿type,position,title,url,domain,displayed_url,features\r\n'));
  assert.deepEqual(SERP_CSV_HEADER, ['type', 'position', 'title', 'url', 'domain', 'displayed_url', 'features']);
  const lines = csv.slice(1).trim().split('\r\n');
  assert.equal(lines.length, 1 + 3 + 5);
  assert.deepEqual(lines.slice(1).map((l) => l.split(',')[0]), ['ad', 'ad', 'organic', 'organic', 'organic', 'organic', 'organic', 'ad']);
  assert.ok(lines.includes('organic,4,"\'=Coffee machine buying guide, ""2026""",https://delta.example/guide,delta.example,https://delta.example › guide,'), 'formula cell escaped and quoted');
  const a = aioCsv([{ title: '+cmd', url: 'https://e.example/', domain: 'e.example' }, { title: '@x', url: 'https://f.example/', domain: 'f.example' }]);
  assert.equal(a, "﻿#,title,url,domain\r\n1,'+cmd,https://e.example/,e.example\r\n2,'@x,https://f.example/,f.example\r\n");
  assert.equal(serpFileName('kahve makinesi'), 'kahve makinesi - seorius-serp.csv');
  assert.equal(serpFileName('a/b:c?'), 'a b c - seorius-serp.csv');
  assert.equal(serpFileName(''), 'serp - seorius-serp.csv');
});

test('my-domain match: exact or subdomain', () => {
  assert.ok(domainMatches('shop.myshop.example', 'myshop.example'));
  assert.ok(domainMatches('myshop.example', 'https://www.myshop.example/'));
  assert.ok(!domainMatches('notmyshop.example', 'myshop.example'));
  assert.ok(!domainMatches('myshop.example', ''));
});

test('manifest content script = SERP_MATCHES only, Google /search paths, no host permissions', () => {
  const m = JSON.parse(read('../src/manifest.json'));
  assert.deepEqual(m.permissions, ['activeTab', 'scripting', 'storage']);
  assert.ok(!('host_permissions' in m) && !('web_accessible_resources' in m) && !('background' in m));
  assert.equal(m.content_scripts.length, 1);
  assert.deepEqual(m.content_scripts[0].matches, SERP_MATCHES);
  assert.deepEqual(m.content_scripts[0].js, ['serp.js']);
  assert.ok(!m.content_scripts[0].all_frames && !m.content_scripts[0].include_globs);
  for (const u of SERP_MATCHES) assert.match(u, /^https:\/\/www\.google\.[a-z.]+\/search\*$/);
  for (const h of ['www.google.com', 'www.google.com.tr', 'www.google.co.uk', 'www.google.de', 'www.google.co.nz']) assert.ok(SERP_HOSTS.includes(h), h);
});

test('popup tabs: six tabs in order, each mapped to a report section that exists', () => {
  assert.deepEqual(POPUP_TABS.map((x) => x.id), ['summary', 'headers', 'images', 'links', 'social', 'tools']);
  const report = read('../src/ui/report.js');
  const sections = JSON.parse(/const SECTIONS = (\[[^\]]+\])/.exec(report)[1].replace(/'/g, '"'));
  for (const tb of POPUP_TABS) assert.ok(sections.includes(tb.section), tb.section);
  assert.equal(reportPath(7, 'headers'), 'report.html?tab=7#s-headings');
  assert.equal(reportPath(7, null), 'report.html?tab=7');
  const en = JSON.parse(read('../src/_locales/en/messages.json')); const tr = JSON.parse(read('../src/_locales/tr/messages.json'));
  assert.deepEqual(POPUP_TABS.map((x) => en[x.label].message), ['Summary', 'Headers', 'Images', 'Links', 'Social', 'Tools']);
  assert.deepEqual(POPUP_TABS.map((x) => tr[x.label].message), ['Özet', 'Başlıklar', 'Görseller', 'Bağlantılar', 'Sosyal', 'Araçlar']);
  assert.equal(toolLinks('https://e.example/a').length, 12);
});

test('SERP script strings exist in both locales and settings default on', () => {
  const src = read('../src/serp/serp.js');
  const used = new Set([...src.matchAll(/\bt\('(serp_[a-z_]+)'/g)].map((m) => m[1]));
  for (const k of FEATURES) used.add(`serp_feat_${k}`);
  for (const k of ['numbers', 'ads', 'features']) used.add(`serp_toggle_${k}`);
  const en = JSON.parse(read('../src/_locales/en/messages.json')); const tr = JSON.parse(read('../src/_locales/tr/messages.json'));
  assert.deepEqual([...used].filter((k) => !(k in en) || !(k in tr)), []);
  assert.deepEqual(mergeSettings({}).serp, { enabled: true, numbers: true, ads: true, features: true, myDomain: '', collapsed: false });
  assert.equal(mergeSettings({ serp: { ads: false } }).serp.numbers, true);
});
