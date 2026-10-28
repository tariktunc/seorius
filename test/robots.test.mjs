import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, groupsFor, isAllowed, verdicts } from '../src/lib/robots.mjs';

const TXT = `# comment
User-agent: *
Disallow: /private
Allow: /private/public
Disallow: /*.pdf$
Disallow: /search?

User-agent: Googlebot
User-agent: bingbot
Disallow: /nogoogle

Sitemap: https://www.example.com/sitemap.xml
`;

test('groups, shared user-agent lines, sitemaps', () => {
  const p = parseRobots(TXT);
  assert.equal(p.groups.length, 2);
  assert.deepEqual(p.groups[1].agents, ['googlebot', 'bingbot']);
  assert.deepEqual(p.sitemaps, ['https://www.example.com/sitemap.xml']);
  assert.equal(groupsFor(p, 'Googlebot').matched, 'googlebot');
  assert.equal(groupsFor(p, 'gptbot').matched, '*');
});

test('longest match, allow on tie, wildcards and $', () => {
  const rules = groupsFor(parseRobots(TXT), '*').rules;
  assert.equal(isAllowed(rules, '/private/x').allowed, false);
  assert.equal(isAllowed(rules, '/private/public/x').allowed, true);
  assert.equal(isAllowed(rules, '/a/b.pdf').allowed, false);
  assert.equal(isAllowed(rules, '/a/b.pdf?x=1').allowed, true);
  assert.equal(isAllowed(rules, '/search?q=a').allowed, false);
  assert.equal(isAllowed(rules, '/robots.txt').allowed, true);
  assert.equal(isAllowed([{ type: 'allow', path: '/p' }, { type: 'disallow', path: '/p' }], '/p').allowed, true);
  assert.equal(isAllowed([{ type: 'disallow', path: '' }], '/x').allowed, true);
});

test('Googlebot uses only its own group', () => {
  const v = verdicts(parseRobots(TXT), 'https://www.example.com/private/x');
  assert.equal(v.find((x) => x.token === 'googlebot').allowed, true);
  assert.equal(v.find((x) => x.token === '*').allowed, false);
  assert.equal(parseRobots('Disallow: /x').errors[0].kind, 'rule-before-user-agent');
  assert.equal(verdicts(parseRobots(''), 'https://a.b/x')[0].allowed, true);
});
