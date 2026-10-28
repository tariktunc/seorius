// Keyword density: 1- to N-word phrases, Turkish-correct casing, TR + EN stop words, user stop
// list and whitelist, prominence column. Pure (no DOM), unit-tested.
//
// Definitions (shown in the UI help):
//   token       a run of letters/digits (\p{L}\p{N}) with inner apostrophe or hyphen.
//   density     count * phraseWords / totalTokens * 100 (occurrences per "slot" of that length).
//   prominence  mean over occurrences of (1 - position / totalTokens) * 100; 100 = at the very
//               start of the text, 0 = at the very end. Our own definition.

import { fold } from '../engine/aio-lib.mjs';

// Own lists, written for Seorius. Stored lower-case; compared through fold() so dotted/dotless
// and accented variants match.
const TR = `acaba ama ancak artık aslında az bana bazı belki ben beni benim beri bile bir birçok biri
birkaç birşey biz bize bizi bizim bu buna bunda bundan bunlar bunları bunların bunu bunun burada
böyle çok çünkü da daha dahi de defa değil diğer diye dolayı dolayısıyla eğer en fakat gibi göre
hangi hatta hem hep hepsi her herhangi herkes hiç hiçbir için ile ise işte kadar kendi kendine
ki kim kimse mı mi mu mü nasıl ne neden nerede nereye niçin niye o olan olarak oldu olduğu
olduğunu olmak olması olsa olur on ona onlar onları onların onu onun orada öyle pek rağmen sadece
sanki sen siz size sizi sizin şey şimdi şu şuna şunda şundan şunu tüm üzere var ve veya ya yani
yine yok zaten olan olup eden ettiği gibi bile değin dek yerine ayrıca ise mıdır midir`;
const EN = `a about above after again against all am an and any are as at be because been before being
below between both but by can could did do does doing down during each few for from further had has
have having he her here hers herself him himself his how i if in into is it its itself just me more
most my myself no nor not now of off on once only or other our ours ourselves out over own same she
should so some such than that the their theirs them themselves then there these they this those
through to too under until up very was we were what when where which while who whom why will with
would you your yours yourself yourselves also may might must shall us via per`;

export const STOPWORDS_TR = new Set(TR.split(/\s+/).filter(Boolean).map(fold));
export const STOPWORDS_EN = new Set(EN.split(/\s+/).filter(Boolean).map(fold));

const WORD_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

/** Lower-case with Turkish rules when the page language is Turkish. */
export function lowerFor(lang) {
  const tr = !!lang && /^tr\b/i.test(lang);
  return (s) => (tr ? s.replace(/İ/g, 'i').replace(/I/g, 'ı') : s).toLowerCase();
}

export function tokenize(text, lang) {
  const lower = lowerFor(lang);
  return (String(text || '').match(WORD_RE) || []).map(lower);
}

export function parseWordList(s) {
  return new Set(String(s || '').split(/[\n,;]+/).map((w) => fold(w.trim())).filter(Boolean));
}

/**
 * @param {string[]} tokens  output of tokenize()
 * @param {object} o  { maxN, minCount, topRows, minTokenLength, userStop:Set, whitelist:Set }
 */
export function keywordTable(tokens, o = {}) {
  const maxN = o.maxN ?? 4; const minCount = o.minCount ?? 2; const topRows = o.topRows ?? 30;
  const minLen = o.minTokenLength ?? 3;
  const userStop = o.userStop || new Set(); const whitelist = o.whitelist || new Set();
  const total = tokens.length;
  const folded = tokens.map(fold);
  const isStop = (f) => !whitelist.has(f) && (STOPWORDS_TR.has(f) || STOPWORDS_EN.has(f) || userStop.has(f));
  const isNum = (t) => /^\d+([.,]\d+)?$/.test(t);
  const weak = (i) => isStop(folded[i]) || isNum(tokens[i]) || ([...tokens[i]].length < minLen && !whitelist.has(folded[i]));
  const out = {};
  for (let n = 1; n <= maxN; n++) {
    const map = new Map();
    for (let i = 0; i + n <= total; i++) {
      if (n === 1 ? weak(i) : (weak(i) || weak(i + n - 1))) continue; // phrases must start and end on a content word
      const key = folded.slice(i, i + n).join(' ');
      let e = map.get(key);
      if (!e) { e = { phrase: tokens.slice(i, i + n).join(' '), count: 0, posSum: 0 }; map.set(key, e); }
      e.count++; e.posSum += i;
    }
    out[n] = [...map.values()].filter((e) => e.count >= minCount)
      .sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase))
      .slice(0, topRows)
      .map((e) => ({
        phrase: e.phrase,
        count: e.count,
        densityPercent: total ? Math.round(((e.count * n) / total) * 1000) / 10 : 0,
        prominence: total ? Math.round((1 - e.posSum / e.count / total) * 100) : 0,
      }));
  }
  return { totalTokens: total, byLength: out };
}
