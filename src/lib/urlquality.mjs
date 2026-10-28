// URL quality metrics and advisory findings (thresholds: seorius-rules.json urlQuality, TREND).

export function urlMetrics(url) {
  const u = new URL(url);
  const noScheme = url.replace(/^[a-z]+:\/\//i, '').replace(/#.*$/, '');
  const segments = u.pathname.split('/').filter(Boolean);
  const params = [...u.searchParams.keys()];
  return {
    length: [...noScheme].length,
    queryParams: params.length,
    queryLength: u.search.replace(/^\?/, '').length,
    percentEscapes: (noScheme.match(/%[0-9a-f]{2}/gi) || []).length,
    pathSegments: segments.length,
    longestUnhyphenatedSegment: segments.filter((s) => !s.includes('-')).reduce((m, s) => Math.max(m, [...decodeSafe(s)].length), 0),
    hasUppercase: /[A-Z]/.test(u.pathname),
    hasUnderscore: u.pathname.includes('_'),
  };
}

function decodeSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

/** @returns {Array<{key:string, params:object}>} notice-level issues */
export function urlIssues(m, r) {
  const out = [];
  if (m.length > r.maxLength) out.push({ key: 'url_long', params: { n: m.length, max: r.maxLength } });
  if (m.queryParams > r.maxQueryParams) out.push({ key: 'url_params', params: { n: m.queryParams, max: r.maxQueryParams } });
  if (m.queryLength > r.maxQueryLength) out.push({ key: 'url_query_long', params: { n: m.queryLength, max: r.maxQueryLength } });
  if (m.percentEscapes > r.maxPercentEscapes) out.push({ key: 'url_escapes', params: { n: m.percentEscapes, max: r.maxPercentEscapes } });
  if (m.pathSegments > r.maxPathSegments) out.push({ key: 'url_depth', params: { n: m.pathSegments, max: r.maxPathSegments } });
  if (m.longestUnhyphenatedSegment > r.maxSegmentLengthWithoutHyphen) out.push({ key: 'url_segment', params: { n: m.longestUnhyphenatedSegment, max: r.maxSegmentLengthWithoutHyphen } });
  return out;
}
