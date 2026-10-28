// Settings defaults and merge. Pure (no chrome.*, no fetch) so the Google results script can share it.

export const DEFAULT_SETTINGS = {
  lang: 'auto',
  fontSize: 16,
  overlayColors: { headings: '#7c3aed', links: '#dc2626', images: '#ea580c' },
  stopWords: '',
  whitelist: '',
  auditGroups: { technical: true, content: true, mobile: true, social: true },
  columns: {
    links: { url: true, count: true, anchors: true, anchorType: true, rel: true, type: true, status: true },
    images: { src: true, alt: true, title: true, dims: true, natural: true, rendered: true, bytes: true, format: true },
  },
  // Google search results overlay (src/serp/serp.js).
  serp: { enabled: true, numbers: true, ads: true, features: true, myDomain: '', collapsed: false },
};

const merge = (d, s) => {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return s === undefined ? d : s;
  const o = { ...d };
  for (const k of Object.keys(s)) o[k] = d && typeof d[k] === 'object' && !Array.isArray(d[k]) ? merge(d[k], s[k]) : s[k];
  return o;
};
export const mergeSettings = (s) => merge(DEFAULT_SETTINGS, s || {});

export const FONT_SIZES = [14, 16, 18, 20];
/** User text size in px; never below 14. */
export const fontPx = (s) => (FONT_SIZES.includes(Number(s && s.fontSize)) ? Number(s.fontSize) : DEFAULT_SETTINGS.fontSize);
