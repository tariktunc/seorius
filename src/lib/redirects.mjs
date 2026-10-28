// Redirect chain, hop by hop. The report page re-fetches the inspected URL itself while a
// chrome.webRequest listener records what the browser saw; this module turns those recorded events
// into a chain. Pure: the browser glue (src/ui/hostaccess.js) only feeds it events.
//
// event: { type: 'request' | 'redirect' | 'completed' | 'error', requestId, url, statusCode?, redirectUrl?, error? }
//   request    onBeforeRequest   (used only to find the requestId of our fetch)
//   redirect   onBeforeRedirect  (url answered statusCode and pointed to redirectUrl)
//   completed  onCompleted       (url answered statusCode, end of chain)
//   error      onErrorOccurred   (url failed, end of chain)

const norm = (u) => { try { const x = new URL(u); x.hash = ''; return x.toString(); } catch { return String(u); } };

/** Picks the requestId of the first request for startUrl; other requests are ignored. */
export function requestIdFor(events, startUrl) {
  const want = norm(startUrl);
  const e = events.find((x) => x.type === 'request' && norm(x.url) === want);
  return e ? e.requestId : null;
}

/**
 * -> { hops: [{url, status, location?}], finalUrl, finalStatus, complete, truncated, loop, error }
 * complete: the chain ended in a response (completed). Not complete = error, cap reached or no end
 * event seen (timeout); the caller then says so instead of presenting a partial chain as the whole.
 */
export function assembleChain(events, startUrl, { maxHops = 10 } = {}) {
  const id = requestIdFor(events, startUrl);
  const out = { hops: [], finalUrl: null, finalStatus: null, complete: false, truncated: false, loop: false, error: null, observed: id !== null };
  if (id === null) return out;
  const seen = new Set();
  for (const e of events) {
    if (e.requestId !== id || e.type === 'request') continue;
    if (out.hops.length >= maxHops) { out.truncated = true; break; }
    if (e.type === 'redirect') {
      const key = norm(e.url);
      if (seen.has(key)) out.loop = true;
      seen.add(key);
      out.hops.push({ url: e.url, status: e.statusCode ?? null, location: e.redirectUrl ?? null });
      if (out.loop) break;
    } else if (e.type === 'completed') {
      out.hops.push({ url: e.url, status: e.statusCode ?? null });
      out.finalUrl = e.url; out.finalStatus = e.statusCode ?? null; out.complete = true;
      break;
    } else if (e.type === 'error') {
      out.hops.push({ url: e.url, status: null, error: e.error || 'error' });
      out.error = e.error || 'error';
      break;
    }
  }
  return out;
}
