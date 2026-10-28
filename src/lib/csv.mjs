// RFC 4180 CSV writer. Cells starting with = + - @ are prefixed with ' so spreadsheet apps do not
// run them as formulas (CSV injection guard).

const cell = (v) => {
  let s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(' | ') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(header, rows) {
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function fileStamp(url, date = new Date()) {
  let host = 'page';
  try { host = new URL(url).hostname; } catch { /* keep */ }
  const d = date.toISOString().slice(0, 10);
  return `seorius-${host}-${d}`;
}
