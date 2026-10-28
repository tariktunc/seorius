// Vendored subset of WebForge site-builder/seo-uzman/aio/_aio-lib.mjs (2026-10-28): fold + STOPWORDS only.
/** Lowercase with Turkish folding, strip diacritics, collapse whitespace. */
export function fold(s) {
  return String(s ?? '')
    .replace(/İ/g, 'i').replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim();
}

export const STOPWORDS = new Set([
  // tr
  've', 'ile', 'bir', 'bu', 'su', 'o', 'da', 'de', 'mi', 'mu', 'ne', 'icin', 'gibi', 'en', 'cok',
  'daha', 'olan', 'olarak', 'ya', 'veya', 'ama', 'ki', 'her', 'hem', 'nasil', 'nedir', 'neden',
  'nerede', 'hangi', 'kac', 'mı', 'midir', 'var', 'yok', 'ise', 'kadar', 'sonra', 'once', 'bize',
  'siz', 'biz', 'sizin', 'bizim', 'tum', 'butun', 'diye', 'olur', 'oldugu', 'eden', 'the',
  // en
  'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'be', 'it', 'this',
  'that', 'with', 'as', 'at', 'by', 'from', 'what', 'how', 'why', 'where', 'which', 'who', 'do',
  'does', 'can', 'you', 'your', 'we', 'our', 'best', 'near', 'me',
]);
