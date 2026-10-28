// Optional cross-site access (report page only). ONE optional permission set, requested once on a
// user click: webRequest (to watch the redirect chain of our own re-fetch) + http/https host access
// (so the report page can read other sites' responses without relying on their CORS headers).
// Install-time permissions are unchanged. Nothing here sends data anywhere except requests to the
// inspected URL, its links, images and declared sitemaps, without cookies.

import { assembleChain, requestIdFor } from '../lib/redirects.mjs';

export const OPTIONAL = { permissions: ['webRequest'], origins: ['http://*/*', 'https://*/*'] };

let granted = false;
const listeners = new Set();

/** Reads the current grant and follows later grants / revocations (chrome://extensions). */
export async function initHostAccess(onChange) {
  if (onChange) listeners.add(onChange);
  try { granted = await chrome.permissions.contains(OPTIONAL); } catch { granted = false; }
  const upd = async () => { try { granted = await chrome.permissions.contains(OPTIONAL); } catch { granted = false; } listeners.forEach((f) => f(granted)); };
  chrome.permissions.onAdded?.addListener(upd);
  chrome.permissions.onRemoved?.addListener(upd);
  return granted;
}
export const hasHostAccess = () => granted;

/** Must be called straight from a click handler (no await before it): permissions.request needs the user gesture. */
export async function requestHostAccess() {
  if (granted) return true;
  try { granted = await chrome.permissions.request(OPTIONAL); } catch { granted = false; }
  listeners.forEach((f) => f(granted));
  return granted;
}

/** fetch from the extension page (cross-origin readable once host access is granted). */
export const extensionFetch = (u, init) => fetch(u, init);

/**
 * Re-fetches url from this page while webRequest records the hops of that one request.
 * -> assembleChain() result, or { notRun: reason } when the permission or the API is missing.
 */
export async function traceRedirects(url, { maxHops = 10, timeoutMs = 15000 } = {}) {
  if (!granted) return { notRun: 'no-permission' };
  const wr = chrome.webRequest;
  if (!wr || !wr.onBeforeRedirect) return { notRun: 'api-unavailable' };
  const events = [];
  // No tabId filter: report.html lives in a tab, so its own requests carry that tab's id, not -1.
  // Our request is recognised by initiator (this extension's origin) + URL instead.
  const filter = { urls: OPTIONAL.origins };
  const self = location.origin;
  const mine = (d) => d.initiator === self;
  const L = {
    req: (d) => { if (mine(d)) events.push({ type: 'request', requestId: d.requestId, url: d.url }); },
    red: (d) => { if (mine(d)) events.push({ type: 'redirect', requestId: d.requestId, url: d.url, statusCode: d.statusCode, redirectUrl: d.redirectUrl }); },
    done: (d) => { if (mine(d)) events.push({ type: 'completed', requestId: d.requestId, url: d.url, statusCode: d.statusCode }); },
    err: (d) => { if (mine(d)) events.push({ type: 'error', requestId: d.requestId, url: d.url, error: d.error }); },
  };
  wr.onBeforeRequest.addListener(L.req, filter);
  wr.onBeforeRedirect.addListener(L.red, filter);
  wr.onCompleted.addListener(L.done, filter);
  wr.onErrorOccurred.addListener(L.err, filter);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: ctl.signal });
    try { await res.body?.cancel(); } catch { /* ignore */ }
    // onCompleted can arrive just after the fetch promise resolves.
    for (let i = 0; i < 20 && !events.some((e) => e.type === 'completed' || e.type === 'error'); i++) await new Promise((r) => setTimeout(r, 25));
  } catch (e) {
    events.push({ type: 'error', requestId: requestIdFor(events, url), url, error: e && e.name === 'AbortError' ? 'timeout' : String(e && e.message || e) });
  } finally {
    clearTimeout(timer);
    wr.onBeforeRequest.removeListener(L.req);
    wr.onBeforeRedirect.removeListener(L.red);
    wr.onCompleted.removeListener(L.done);
    wr.onErrorOccurred.removeListener(L.err);
  }
  const chain = assembleChain(events, url, { maxHops });
  if (!chain.observed) return { notRun: 'not-observed' };
  return chain;
}
