// Seorius' own audit findings, for the checks page-inspect-core.mjs does not do. Same severity
// vocabulary as the engine (fail/warn/info/not-run) so audit.mjs can map both the same way.
// Each finding carries msgKey + params, rendered through the UI's locale files.

import { urlIssues } from './urlquality.mjs';
import { linkSummary } from './links.mjs';

const f = (check, severity, msgKey, params = {}) => ({ id: `SEORIUS-${check.toUpperCase()}`, check, severity, msgKey, params });

export function extraFindings(s, rules) {
  const out = [];
  const net = s.network || {};
  const page = net.page;

  // http status of the re-fetch
  if (!page || page.error) out.push(f('http-status', 'not-run', 'f_status_notrun', { error: page?.error || 'no request' }));
  else {
    if (page.status >= 400) out.push(f('http-status', 'fail', 'f_status_error', { status: page.status }));
    else if (page.status >= 300) out.push(f('http-status', 'warn', 'f_status_redirect', { status: page.status }));
    if (page.redirected) out.push(f('http-status', 'warn', 'f_redirect_chain', { from: s.url, to: page.finalUrl }));
  }

  // https
  if (/^http:/i.test(s.url)) out.push(f('https', 'warn', 'f_http_page'));

  // robots.txt
  const rb = net.robots;
  if (!rb || rb.error) out.push(f('robots-txt', 'not-run', 'f_robots_notrun', { error: rb?.error || 'no request' }));
  else if (rb.status === 404 || rb.status === 410) out.push(f('robots-txt', 'info', 'f_robots_missing', { status: rb.status }));
  else if (rb.status >= 500) out.push(f('robots-txt', 'warn', 'f_robots_5xx', { status: rb.status }));
  else if (rb.status >= 400) out.push(f('robots-txt', 'info', 'f_robots_4xx', { status: rb.status }));
  else if (rb.verdicts) {
    const g = rb.verdicts.find((v) => v.token === 'googlebot');
    if (g && !g.allowed) out.push(f('robots-txt', 'fail', 'f_robots_blocked_google', { rule: `${g.rule.type}: ${g.rule.path}` }));
    const others = rb.verdicts.filter((v) => v.token !== 'googlebot' && !v.allowed).map((v) => v.agent);
    if (others.length) out.push(f('robots-txt', 'info', 'f_robots_blocked_others', { agents: others.join(', ') }));
    if (rb.parsed?.errors?.length) out.push(f('robots-txt', 'info', 'f_robots_syntax', { n: rb.parsed.errors.length }));
  }

  // sitemap
  // Sitemaps declared on another host are read only when the user starts that check from the report
  // (optional host permission); their results arrive as net.sitemapCrossOrigin.
  const sm = net.sitemap;
  const xo = (net.sitemapCrossOrigin || []).filter((r) => r.ok);
  const xoListed = xo.some((r) => r.listed === true);
  const xoUnchecked = (sm?.skippedCrossOrigin || []).filter((u) => !xo.some((r) => r.url === u)).length;
  if (!sm) out.push(f('sitemap', 'not-run', 'f_sitemap_notrun', { error: 'no request' }));
  else if (!sm.found && !xo.length) out.push(f('sitemap', sm.checked ? 'info' : 'not-run', sm.checked ? 'f_sitemap_none' : 'f_sitemap_notrun', { error: sm.error || '', tried: (sm.tried || []).join(', ') }));
  else if (!sm.found) { if (!xoListed) out.push(f('sitemap', 'info', 'f_sitemap_xo_not_listed', { n: xo.length })); }
  else {
    if (sm.declaredInRobots === false) out.push(f('sitemap', 'info', 'f_sitemap_undeclared'));
    if (xoListed) { /* listed in a sitemap on another host */ }
    else if (sm.listed === false) out.push(f('sitemap', 'info', sm.complete ? 'f_sitemap_not_listed' : 'f_sitemap_not_listed_partial', { checked: sm.checkedFiles, total: sm.childTotal }));
    else if (sm.listed === null) out.push(f('sitemap', 'not-run', 'f_sitemap_listing_notrun'));
  }
  if (sm && xoUnchecked) out.push(f('sitemap', 'not-run', 'f_sitemap_crossorigin', { n: xoUnchecked }));

  // frames
  if (s.iframes?.length) out.push(f('frames', 'info', 'f_frames', { n: s.iframes.length }));

  // raw vs rendered
  if (!s.rawVsRendered) out.push(f('raw-rendered', 'not-run', 'f_raw_notrun'));
  else {
    const diff = s.rawVsRendered.filter((r) => r.state !== 'same' && !['wordCount', 'linkCount', 'imageCount'].includes(r.field));
    if (diff.length) out.push(f('raw-rendered', 'info', 'f_raw_diff', { n: diff.length, fields: diff.map((d) => d.field).join(', ') }));
  }

  // hreflang absent: not a defect, but not a "pass" either
  if (!(s.engine.hreflang || []).length) out.push(f('hreflang', 'info', 'f_hreflang_none'));

  // url quality
  if (s.urlMetrics) for (const i of urlIssues(s.urlMetrics, rules.urlQuality)) out.push(f('url-quality', 'info', `f_${i.key}`, i.params));

  // internal links bands (unique internal URLs)
  if (s.linkGroups) {
    const ls = linkSummary(s.linkGroups);
    if (ls.internal < rules.internalLinks.min) out.push(f('internal-links', 'info', 'f_internal_few', { n: ls.internal, min: rules.internalLinks.min }));
    if (ls.internal > rules.internalLinks.max) out.push(f('internal-links', 'info', 'f_internal_many', { n: ls.internal, max: rules.internalLinks.max }));
    const nfInt = s.linkGroups.filter((g) => g.type === 'internal' && g.nofollow > 0).length;
    if (nfInt) out.push(f('internal-links', 'info', 'f_internal_nofollow', { n: nfInt }));
  }

  // image sizing (rendered vs natural, known bytes)
  if (s.images) {
    const big = s.images.filter((i) => i.oversized).length;
    if (big) out.push(f('image-sizing', 'info', 'f_img_render', { n: big, ratio: rules.images.oversizedRenderRatio }));
    const heavy = s.images.filter((i) => i.bytes && i.bytes >= rules.images.oversizedBytes).length;
    if (heavy) out.push(f('image-sizing', 'info', 'f_img_bytes', { n: heavy, kb: Math.round(rules.images.oversizedBytes / 1024) }));
  }

  // meta keywords
  if (s.pageInfo?.keywords !== null && s.pageInfo?.keywords !== undefined) out.push(f('meta-keywords', 'info', 'f_meta_keywords'));

  // favicon
  if (s.pageInfo && !s.pageInfo.hasIconLink) out.push(f('favicon', 'info', 'f_favicon_none'));

  // media queries
  const mq = s.mediaQueries;
  if (!mq) out.push(f('media-queries', 'not-run', 'f_mq_notrun'));
  else if (mq.count === 0 && mq.unreadableSheets > 0) out.push(f('media-queries', 'not-run', 'f_mq_unreadable', { n: mq.unreadableSheets }));
  else if (mq.count === 0) out.push(f('media-queries', 'info', 'f_mq_none'));

  return out;
}
