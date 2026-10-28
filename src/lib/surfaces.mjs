// The engine runs twice: on the live DOM (rendered) and on the raw HTML response. Most checks are
// read from the live DOM, but three are properties of the SOURCE bytes and are taken from the raw
// run so the numerator and denominator come from one surface:
//   doctype      (quirks mode is decided by the source)
//   charset      (the 1024-byte rule is about the source)
//   text/HTML ratio (raw visible text / raw HTML length)
// Without a raw run the live values stay, and the ratio is live text / live outerHTML.

const SOURCE_IDS = new Set(['HEALTH-INSPECT-DOCTYPE', 'HEALTH-INSPECT-CHARSET']);
const isRatio = (f) => f.id === 'HEALTH-INSPECT-CONTENT' && /text\/html ratio/i.test(f.message || '');

export function mergeSurfaces(live, raw) {
  if (!raw) return { ...live, surfaces: { default: 'rendered-dom', doctype: 'rendered-dom', charset: 'rendered-dom', textHtmlRatio: 'rendered-dom' } };
  const findings = [
    ...live.findings.filter((f) => !SOURCE_IDS.has(f.id) && !isRatio(f)),
    ...raw.findings.filter((f) => SOURCE_IDS.has(f.id) || isRatio(f)),
  ];
  return {
    ...live,
    doctype: raw.doctype,
    charset: { ...live.charset, meta: raw.charset.meta },
    content: { ...live.content, htmlChars: raw.content.htmlChars, rawTextChars: raw.content.textChars, textHtmlRatioPercent: raw.content.textHtmlRatioPercent },
    findings,
    surfaces: { default: 'rendered-dom', doctype: 'raw-html', charset: 'raw-html', textHtmlRatio: 'raw-html' },
  };
}
