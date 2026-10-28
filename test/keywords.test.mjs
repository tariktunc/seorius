import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, keywordTable, parseWordList, lowerFor } from '../src/lib/keywords.mjs';

test('Turkish casing applies only when lang is tr', () => {
  assert.equal(lowerFor('tr')('İSTANBUL ISPARTA'), 'istanbul ısparta');
  assert.equal(lowerFor('en')('ISTANBUL'), 'istanbul');
  assert.deepEqual(tokenize("Ali'nin çiçek-bahçesi, 2026!", 'tr'), ["ali'nin", 'çiçek-bahçesi', '2026']);
});

test('phrases 1-4, stop words, min count, density and prominence', () => {
  const toks = tokenize('çiçek teslimatı ve çiçek teslimatı için hızlı çiçek teslimatı bugün', 'tr');
  const k = keywordTable(toks, { maxN: 4, minCount: 2 });
  assert.equal(k.totalTokens, 10);
  const u = k.byLength[1].find((r) => r.phrase === 'çiçek');
  assert.equal(u.count, 3);
  assert.equal(u.densityPercent, 30);
  assert.ok(!k.byLength[1].some((r) => r.phrase === 've' || r.phrase === 'için'));
  const b = k.byLength[2].find((r) => r.phrase === 'çiçek teslimatı');
  assert.equal(b.count, 3);
  assert.equal(b.densityPercent, 60);
  assert.ok(!k.byLength[2].some((r) => r.phrase.startsWith('teslimatı ve')));
  const p = keywordTable(['a1', 'xx', 'xx', 'yy'], { minTokenLength: 1, minCount: 1 });
  assert.equal(p.byLength[1].find((r) => r.phrase === 'a1').prominence, 100);
});

test('user stop list and whitelist', () => {
  const toks = tokenize('kampanya kampanya ve ve ve', 'tr');
  assert.equal(keywordTable(toks, { userStop: parseWordList('kampanya') }).byLength[1].length, 0);
  const w = keywordTable(toks, { whitelist: parseWordList('ve') }).byLength[1];
  assert.ok(w.some((r) => r.phrase === 've' && r.count === 3));
});
