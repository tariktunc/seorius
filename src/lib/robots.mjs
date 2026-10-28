// robots.txt parser and matcher written from RFC 9309.
//   - groups start with one or more user-agent lines; consecutive user-agent lines share a group
//   - a crawler obeys the group(s) whose product token equals its own (case-insensitive); all such
//     groups are merged; if none match, the "*" group(s); if none exist, everything is allowed
//   - longest matching path wins; on a tie, allow wins; "*" matches any sequence, "$" ends the path
//   - /robots.txt itself is always allowed

export const AGENTS = [
  { token: 'googlebot', label: 'Googlebot' },
  { token: 'bingbot', label: 'Bingbot' },
  { token: '*', label: '* (all others)' },
  { token: 'gptbot', label: 'GPTBot (OpenAI)' },
  { token: 'oai-searchbot', label: 'OAI-SearchBot' },
  { token: 'claudebot', label: 'ClaudeBot' },
  { token: 'perplexitybot', label: 'PerplexityBot' },
  { token: 'google-extended', label: 'Google-Extended' },
  { token: 'ccbot', label: 'CCBot' },
];

export function parseRobots(text) {
  const groups = []; const sitemaps = []; const errors = [];
  let cur = null; let lastWasAgent = false;
  String(text || '').split(/\r\n|\r|\n/).forEach((line, idx) => {
    const clean = line.replace(/#.*$/, '').trim();
    if (!clean) return;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(clean);
    if (!m) { errors.push({ line: idx + 1, kind: 'unparsable' }); return; }
    const key = m[1].toLowerCase(); const val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      return;
    }
    if (key === 'sitemap') { sitemaps.push(val); return; } // not group-bound
    lastWasAgent = false;
    if (key === 'allow' || key === 'disallow') {
      if (!cur) { errors.push({ line: idx + 1, kind: 'rule-before-user-agent' }); return; }
      cur.rules.push({ type: key, path: val });
      return;
    }
    // crawl-delay, host, clean-param...: kept as unknown-but-valid; not errors
  });
  return { groups, sitemaps, errors };
}

export function groupsFor(parsed, token) {
  const t = token.toLowerCase();
  if (t !== '*') {
    const exact = parsed.groups.filter((g) => g.agents.includes(t));
    if (exact.length) return { matched: t, rules: exact.flatMap((g) => g.rules) };
  }
  const star = parsed.groups.filter((g) => g.agents.includes('*'));
  if (star.length) return { matched: '*', rules: star.flatMap((g) => g.rules) };
  return { matched: null, rules: [] };
}

function patternToRegExp(path) {
  let p = path; let anchored = false;
  if (p.endsWith('$')) { anchored = true; p = p.slice(0, -1); }
  const body = p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

// Normalise percent-encoding so "/a%2fb" and "/a%2Fb" compare equal; unreserved escapes decoded.
function normPath(s) {
  return s.replace(/%([0-9a-f]{2})/gi, (all, hex) => {
    const c = String.fromCharCode(parseInt(hex, 16));
    return /[A-Za-z0-9\-._~]/.test(c) ? c : `%${hex.toUpperCase()}`;
  });
}

/** @returns {{allowed:boolean, rule:object|null}} */
export function isAllowed(rules, pathWithQuery) {
  const path = normPath(pathWithQuery || '/');
  if (path === '/robots.txt') return { allowed: true, rule: null };
  let best = null;
  for (const r of rules) {
    if (r.path === '') continue; // empty disallow = allow everything; empty allow = no-op
    const rp = normPath(r.path);
    if (!patternToRegExp(rp).test(path)) continue;
    const len = rp.length;
    if (!best || len > best.len || (len === best.len && r.type === 'allow' && best.rule.type !== 'allow')) best = { len, rule: r };
  }
  return { allowed: !best || best.rule.type === 'allow', rule: best ? best.rule : null };
}

/** Verdict for every agent in AGENTS for one URL. */
export function verdicts(parsed, url) {
  let path = '/';
  try { const u = new URL(url); path = u.pathname + u.search; } catch { /* keep / */ }
  return AGENTS.map((a) => {
    const g = groupsFor(parsed, a.token);
    const v = isAllowed(g.rules, path);
    return { agent: a.label, token: a.token, group: g.matched, allowed: v.allowed, rule: v.rule };
  });
}
