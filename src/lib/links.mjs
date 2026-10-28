// Link classification, grouping and the broken-link check safety policy (MODEL.md section 3).
// Pure functions; the injected inspector feeds them link descriptors read from the DOM.

const bareHost = (h) => String(h || '').toLowerCase().replace(/^www\./, '');

/**
 * internal   same host, www and apex treated as one site (scheme and port ignored)
 * subdomain  a sub-host of the page host ("same site, other host"); no public-suffix list is used,
 *            so only hosts ending in "." + page host are recognised
 * external   anything else on http(s)
 * other      mailto:, tel:, javascript:, fragment-only, empty, unparsable
 */
export function classifyLink(rawHref, resolvedHref, pageUrl) {
  const raw = String(rawHref ?? '').trim();
  if (raw === '' || raw === '#') return 'placeholder';
  if (raw.startsWith('#')) return 'fragment';
  if (/^mailto:/i.test(raw)) return 'mailto';
  if (/^tel:/i.test(raw)) return 'tel';
  if (/^javascript:/i.test(raw)) return 'javascript';
  let u; let p;
  try { u = new URL(resolvedHref || raw, pageUrl); p = new URL(pageUrl); } catch { return 'invalid'; }
  if (!/^https?:$/.test(u.protocol)) return 'other-scheme';
  const a = bareHost(u.hostname); const b = bareHost(p.hostname);
  if (a === b) return 'internal';
  if (a.endsWith(`.${b}`)) return 'subdomain';
  return 'external';
}

export function relFlags(rel) {
  const t = String(rel || '').toLowerCase().split(/\s+/).filter(Boolean);
  return { nofollow: t.includes('nofollow'), sponsored: t.includes('sponsored'), ugc: t.includes('ugc'), noopener: t.includes('noopener'), noreferrer: t.includes('noreferrer'), tokens: t };
}

/** Group link descriptors {raw, href, text, anchorType, rel} by URL (hash removed). */
export function groupLinks(descs, pageUrl, cap = 2000) {
  const map = new Map();
  for (const d of descs) {
    const type = classifyLink(d.raw, d.href, pageUrl);
    let key = d.href || d.raw;
    if (['internal', 'subdomain', 'external'].includes(type)) { try { const u = new URL(d.href); u.hash = ''; key = u.toString(); } catch { /* keep */ } }
    let g = map.get(key);
    if (!g) {
      if (map.size >= cap) continue;
      g = { url: key, type, count: 0, anchors: [], anchorTypes: [], nofollow: 0, sponsored: 0, ugc: 0, follow: 0, rels: [] };
      map.set(key, g);
    }
    g.count++;
    const text = d.text || '';
    if (!g.anchors.includes(text) && g.anchors.length < 8) g.anchors.push(text);
    if (!g.anchorTypes.includes(d.anchorType)) g.anchorTypes.push(d.anchorType);
    const f = relFlags(d.rel);
    if (f.nofollow) g.nofollow++; else g.follow++;
    if (f.sponsored) g.sponsored++;
    if (f.ugc) g.ugc++;
    for (const t of f.tokens) if (!g.rels.includes(t)) g.rels.push(t);
  }
  return [...map.values()];
}

export function linkSummary(groups) {
  const s = { urls: groups.length, occurrences: 0, internal: 0, subdomain: 0, external: 0, other: 0, follow: 0, nofollow: 0, sponsored: 0, ugc: 0, emptyAnchor: 0 };
  for (const g of groups) {
    s.occurrences += g.count;
    if (g.type === 'internal') s.internal++; else if (g.type === 'subdomain') s.subdomain++; else if (g.type === 'external') s.external++; else s.other++;
    s.follow += g.follow; s.nofollow += g.nofollow; s.sponsored += g.sponsored; s.ugc += g.ugc;
    if (g.anchorTypes.includes('empty')) s.emptyAnchor++;
  }
  return s;
}

// ---- broken-link check safety policy ----

const ACTION_RE = /(^|[\/_.?&=-])(log-?out|sign-?out|log-?off|delete|remove|destroy|unsubscribe|add-?to-?cart|cart\/(add|remove|update|clear)|empty-?cart|checkout|purge|flush|wp-admin|wp-login|admin-ajax|action=)([\/_.?&=-]|$)/i;
const TOKEN_PARAM_RE = /[?&](nonce|_wpnonce|token|csrf|csrf_token|auth|session|sid|key)=/i;
const LOGIN_RE = /(^|\/)(login|log-in|signin|sign-in|auth|sso|account\/login|wp-login\.php)(\/|\.|\?|$)/i;

export function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h === '0.0.0.0') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
    const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (v4) return isPrivateHost(v4[1]);
  }
  return false;
}

/**
 * Returns a skip reason, or null when the URL may be probed.
 * Private hosts are allowed only when they are the inspected page's own origin (a developer
 * inspecting localhost); a public page never makes us probe an internal host.
 */
export function skipReason(url, pageUrl) {
  let u; let p;
  try { u = new URL(url); p = new URL(pageUrl); } catch { return 'invalid-url'; }
  if (!/^https?:$/.test(u.protocol)) return 'non-http';
  if (u.username || u.password) return 'credentials-in-url';
  if (isPrivateHost(u.hostname) && u.origin !== p.origin) return 'private-address';
  if (ACTION_RE.test(u.pathname + u.search) || TOKEN_PARAM_RE.test(u.search)) return 'action-url';
  return null;
}

export const looksLikeLogin = (url) => { try { const u = new URL(url); return LOGIN_RE.test(u.pathname); } catch { return false; } };

/**
 * Map a probe outcome to a link status.
 * probe: { status, redirected, finalUrl, challenge, error, crossOrigin }
 * statuses: ok | redirected | login-required | could-not-check | broken | not-checked
 */
export function interpretProbe(probe, requestedUrl) {
  if (probe.error) return probe.crossOrigin ? { status: 'not-checked', reason: 'cross-origin-unreadable' } : { status: 'could-not-check', reason: 'network-error' };
  const s = probe.status;
  if (probe.challenge) return { status: 'could-not-check', reason: 'bot-challenge', http: s };
  if (s === 401 || s === 403 || s === 429) return { status: 'could-not-check', reason: `http-${s}`, http: s };
  if (probe.redirected && probe.finalUrl && looksLikeLogin(probe.finalUrl) && !looksLikeLogin(requestedUrl)) return { status: 'login-required', http: s, finalUrl: probe.finalUrl };
  if (s >= 200 && s < 400) return probe.redirected ? { status: 'redirected', http: s, finalUrl: probe.finalUrl } : { status: 'ok', http: s };
  if (s >= 400) return { status: 'broken', http: s };
  return { status: 'could-not-check', reason: 'no-status', http: s };
}
