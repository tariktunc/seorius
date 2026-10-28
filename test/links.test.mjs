import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLink, groupLinks, linkSummary, skipReason, interpretProbe, isPrivateHost } from '../src/lib/links.mjs';

const P = 'https://www.example.com/page';
test('www and apex are one site; subdomain and substring hosts are not internal', () => {
  assert.equal(classifyLink('https://example.com/x', null, P), 'internal');
  assert.equal(classifyLink('http://www.example.com/x', null, P), 'internal');
  assert.equal(classifyLink('/x', 'https://www.example.com/x', P), 'internal');
  assert.equal(classifyLink('https://blog.example.com/', null, P), 'subdomain');
  assert.equal(classifyLink('https://other.com/?ref=example.com', null, P), 'external');
  assert.equal(classifyLink('https://notexample.com/', null, P), 'external');
  assert.equal(classifyLink('#top', null, P), 'fragment');
  assert.equal(classifyLink('mailto:a@b.c', null, P), 'mailto');
});

test('grouping by URL with counts, anchors and rel', () => {
  const g = groupLinks([
    { raw: '/a', href: 'https://www.example.com/a#x', text: 'A', anchorType: 'text', rel: '' },
    { raw: '/a', href: 'https://www.example.com/a', text: 'Other', anchorType: 'text', rel: 'nofollow' },
    { raw: 'https://x.org', href: 'https://x.org/', text: '', anchorType: 'empty', rel: 'sponsored' },
  ], P);
  assert.equal(g.length, 2);
  assert.equal(g[0].count, 2);
  assert.deepEqual(g[0].anchors, ['A', 'Other']);
  const s = linkSummary(g);
  assert.equal(s.internal, 1); assert.equal(s.external, 1); assert.equal(s.nofollow, 1); assert.equal(s.sponsored, 1); assert.equal(s.emptyAnchor, 1);
});

test('safety policy: skips action URLs, private hosts, non-http', () => {
  assert.equal(skipReason('https://www.example.com/logout', P), 'action-url');
  assert.equal(skipReason('https://www.example.com/cart/add?id=1', P), 'action-url');
  assert.equal(skipReason('https://www.example.com/p?_wpnonce=abc', P), 'action-url');
  assert.equal(skipReason('https://www.example.com/wp-admin/', P), 'action-url');
  assert.equal(skipReason('http://192.168.1.1/', P), 'private-address');
  assert.equal(skipReason('http://[::1]/', P), 'private-address');
  assert.equal(skipReason('ftp://x.org/', P), 'non-http');
  assert.equal(skipReason('https://www.example.com/blog/deleted-scenes-review', P), null);
  assert.equal(skipReason('http://localhost:3000/b', 'http://localhost:3000/a'), null);
  assert.ok(isPrivateHost('10.0.0.5') && isPrivateHost('172.20.1.1') && !isPrivateHost('172.32.0.1') && !isPrivateHost('8.8.8.8'));
});

test('status mapping: 401/403/429/challenge are never broken', () => {
  for (const s of [401, 403, 429]) assert.equal(interpretProbe({ status: s }, 'https://x.org/').status, 'could-not-check');
  assert.equal(interpretProbe({ status: 503, challenge: true }, 'https://x.org/').status, 'could-not-check');
  assert.equal(interpretProbe({ status: 404 }, 'https://x.org/').status, 'broken');
  assert.equal(interpretProbe({ status: 200, redirected: true, finalUrl: 'https://x.org/login?next=/a' }, 'https://x.org/a').status, 'login-required');
  assert.equal(interpretProbe({ status: 200, redirected: true, finalUrl: 'https://x.org/b' }, 'https://x.org/a').status, 'redirected');
  assert.equal(interpretProbe({ status: 200 }, 'https://x.org/a').status, 'ok');
  assert.equal(interpretProbe({ error: 'TypeError', crossOrigin: true }, 'https://x.org/a').status, 'not-checked');
  assert.equal(interpretProbe({ error: 'TypeError', crossOrigin: false }, 'https://x.org/a').status, 'could-not-check');
});
