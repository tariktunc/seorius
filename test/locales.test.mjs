import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CHECKS } from '../src/lib/audit.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const en = JSON.parse(read('../src/_locales/en/messages.json'));
const tr = JSON.parse(read('../src/_locales/tr/messages.json'));

test('en and tr carry the same keys, non-empty', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(tr).sort());
  for (const [k, v] of Object.entries(tr)) assert.ok(v.message.length > 0, k);
});

test('Turkish strings use Turkish characters', () => {
  const all = Object.values(tr).map((v) => v.message).join(' ');
  for (const ch of ['ı', 'ş', 'ğ', 'ü', 'ö', 'ç', 'İ']) assert.ok(all.includes(ch), ch);
});

test('every statically used key exists', () => {
  const used = new Set();
  for (const f of readdirSync(new URL('../src/ui/', import.meta.url))) {
    const s = read(`../src/ui/${f}`);
    for (const m of s.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)) used.add(m[1]);
    for (const m of s.matchAll(/data-i18n(?:-[a-z]+)?="([A-Za-z0-9_]+)"/g)) used.add(m[1]);
  }
  for (const m of read('../src/lib/extras.mjs').matchAll(/'(f_[a-z0-9_]+)'/g)) used.add(m[1]);
  for (const m of read('../src/lib/urlquality.mjs').matchAll(/key: '([a-z_]+)'/g)) used.add(`f_${m[1]}`);
  for (const c of CHECKS) { used.add(`check_${c.key.replace(/-/g, '_')}`); used.add(`help_${c.key.replace(/-/g, '_')}`); }
  const missing = [...used].filter((k) => !(k in en));
  assert.deepEqual(missing, []);
});

test('manifest strings exist and description fits 132 chars', () => {
  for (const L of [en, tr]) { assert.ok(L.appName.message); assert.ok(L.appDesc.message.length <= 132); }
});

test('locale files have no duplicate keys', () => {
  for (const l of ['en', 'tr']) {
    const keys = [...read(`../src/_locales/${l}/messages.json`).matchAll(/^ {2}"([A-Za-z0-9_]+)": \{/gm)].map((m) => m[1]);
    assert.equal(new Set(keys).size, keys.length, l);
    assert.ok(keys.length > 100);
  }
});
