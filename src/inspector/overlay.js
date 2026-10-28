// On-demand page overlays: headings, links, images. Each kind adds one <style> element and
// data-seorius-* attributes; switching it off removes both, leaving the page as it was.

const ATTR = { headings: 'data-seorius-h', links: 'data-seorius-l', images: 'data-seorius-i' };
const styleId = (k) => `seorius-overlay-${k}`;
const safeColor = (c, d) => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : d);

function css(kind, color) {
  const a = ATTR[kind];
  if (kind === 'headings') {
    return `[${a}]{outline:2px solid ${color}!important;outline-offset:2px!important}
[${a}]::before{content:attr(${a});display:inline-block;background:${color};color:#fff;font:600 14px/1.5 system-ui,sans-serif;padding:0 5px;margin-right:6px;border-radius:3px;vertical-align:middle;letter-spacing:0;text-transform:none}
[${a}][data-seorius-hidden]::before{content:attr(${a}) " (hidden)"}`;
  }
  if (kind === 'links') {
    return `[${a}~="nofollow"]{outline:2px dashed ${color}!important;outline-offset:1px!important}
[${a}~="sponsored"],[${a}~="ugc"]{outline:2px dotted ${color}!important;outline-offset:1px!important}
[${a}~="empty"]{outline:3px solid ${color}!important;outline-offset:1px!important;background:rgba(255,0,0,.12)!important}
[${a}~="nofollow"]::after{content:"nofollow";font:600 14px/1.4 system-ui,sans-serif;background:${color};color:#fff;padding:0 3px;margin-left:3px;border-radius:3px}`;
  }
  return `img[${a}="missing"]{outline:3px solid ${color}!important;outline-offset:-3px!important}
img[${a}="empty"]{outline:3px dashed ${color}!important;outline-offset:-3px!important}`;
}

function apply(kind) {
  const a = ATTR[kind];
  let n = 0;
  if (kind === 'headings') {
    document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
      h.setAttribute(a, h.localName.toUpperCase());
      if (typeof h.checkVisibility === 'function' && !h.checkVisibility({ checkVisibilityCSS: true })) h.setAttribute('data-seorius-hidden', '');
      n++;
    });
  } else if (kind === 'links') {
    document.querySelectorAll('a[href]').forEach((el) => {
      const rel = String(el.getAttribute('rel') || '').toLowerCase().split(/\s+/);
      const marks = ['nofollow', 'sponsored', 'ugc'].filter((t) => rel.includes(t));
      const named = (el.textContent || '').trim() || el.querySelector('img[alt]:not([alt=""])') || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('aria-labelledby');
      if (!named) marks.push('empty');
      if (marks.length) { el.setAttribute(a, marks.join(' ')); n++; }
    });
  } else {
    document.querySelectorAll('img').forEach((el) => {
      const alt = el.getAttribute('alt');
      if (alt === null) { el.setAttribute(a, 'missing'); n++; } else if (!alt.trim()) { el.setAttribute(a, 'empty'); n++; }
    });
  }
  return n;
}

function clear(kind) {
  document.getElementById(styleId(kind))?.remove();
  document.querySelectorAll(`[${ATTR[kind]}]`).forEach((el) => el.removeAttribute(ATTR[kind]));
  if (kind === 'headings') document.querySelectorAll('[data-seorius-hidden]').forEach((el) => el.removeAttribute('data-seorius-hidden'));
}

const DEFAULTS = { headings: '#7c3aed', links: '#dc2626', images: '#ea580c' };

export function overlay(kind, on, colors = {}) {
  if (!ATTR[kind]) return { kind, on: false, marked: 0 };
  clear(kind);
  if (!on) return { kind, on: false, marked: 0 };
  const st = document.createElement('style');
  st.id = styleId(kind);
  st.textContent = css(kind, safeColor(colors[kind], DEFAULTS[kind]));
  (document.head || document.documentElement).appendChild(st);
  return { kind, on: true, marked: apply(kind) };
}

export function overlayState() {
  return Object.fromEntries(Object.keys(ATTR).map((k) => [k, !!document.getElementById(styleId(k))]));
}
