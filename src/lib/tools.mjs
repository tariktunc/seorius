// Outbound tool links for a page URL. Shared by the report Tools section and the popup Tools tab.
// Links only: nothing is requested until the user clicks one.

export function toolLinks(pageUrl) {
  const u = encodeURIComponent(pageUrl);
  let host = '';
  try { host = new URL(pageUrl).hostname; } catch { /* keep */ }
  return [
    ['Google Rich Results Test', `https://search.google.com/test/rich-results?url=${u}`],
    ['Schema Markup Validator', `https://validator.schema.org/#url=${u}`],
    ['PageSpeed Insights', `https://pagespeed.web.dev/analysis?url=${u}`],
    ['W3C HTML Validator', `https://validator.w3.org/nu/?doc=${u}`],
    ['W3C CSS Validator', `https://jigsaw.w3.org/css-validator/validator?uri=${u}`],
    ['Facebook Sharing Debugger', `https://developers.facebook.com/tools/debug/?q=${u}`],
    ['LinkedIn Post Inspector', `https://www.linkedin.com/post-inspector/inspect/${u}`],
    ['Wayback Machine', `https://web.archive.org/web/*/${pageUrl}`],
    ['Security Headers', `https://securityheaders.com/?q=${u}&followRedirects=on`],
    ['SSL Labs', `https://www.ssllabs.com/ssltest/analyze.html?d=${encodeURIComponent(host)}`],
    ['Google site:', `https://www.google.com/search?q=${encodeURIComponent(`site:${host}`)}`],
    ['Bing site:', `https://www.bing.com/search?q=${encodeURIComponent(`site:${host}`)}`],
  ];
}

/** Popup tabs in order, the locale key of each label, and the report section its "Details" link opens. */
export const POPUP_TABS = [
  { id: 'summary', label: 'tab_summary', section: 'pageinfo' },
  { id: 'headers', label: 'tab_headers', section: 'headings' },
  { id: 'images', label: 'tab_images', section: 'images' },
  { id: 'links', label: 'tab_links', section: 'links' },
  { id: 'social', label: 'tab_social', section: 'social' },
  { id: 'tools', label: 'tab_tools', section: 'tools' },
];

/** report.html URL path (relative to the extension root) that opens at a popup tab's section. */
export const reportPath = (tabId, popupTab) => {
  const t = POPUP_TABS.find((x) => x.id === popupTab);
  return `report.html?tab=${tabId}${t ? `#s-${t.section}` : ''}`;
};
