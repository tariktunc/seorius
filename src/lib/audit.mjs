// Audit model: maps engine findings (pass/info/warn/fail/not-run) and Seorius' own findings onto
// the product severity model error / warning / notice / pass / not-run, grouped Technical /
// Content / Mobile / Social. A check is "pass" only when it ran and produced no finding;
// a check whose only finding is not-run stays "not-run" and is never counted as a pass.

import { RULE_IDS } from '../engine/finding-schema.mjs';

export const SEVERITY_MAP = { fail: 'error', warn: 'warning', info: 'notice', 'not-run': 'not-run', pass: 'pass' };
export const RANK = { error: 4, warning: 3, notice: 2, 'not-run': 1, pass: 0 };

export const CHECKS = [
  ['http-status', 'technical'], ['https', 'technical'], ['robots', 'technical'], ['canonical', 'technical'],
  ['consistency', 'technical'], ['robots-txt', 'technical'], ['sitemap', 'technical'], ['charset', 'technical'],
  ['doctype', 'technical'], ['hreflang', 'technical'], ['structured-data', 'technical'], ['mixed-content', 'technical'],
  ['hsts', 'technical'], ['tracking', 'technical'], ['frames', 'technical'], ['raw-rendered', 'technical'],
  ['title', 'content'], ['description', 'content'], ['h1', 'content'], ['outline', 'content'], ['lang', 'content'],
  ['images', 'content'], ['image-sizing', 'content'], ['links', 'content'], ['internal-links', 'content'],
  ['content', 'content'], ['keywords', 'content'], ['meta-keywords', 'content'], ['url-quality', 'content'], ['favicon', 'content'],
  ['viewport', 'mobile'], ['media-queries', 'mobile'],
  ['open-graph', 'social'], ['twitter-card', 'social'],
].map(([key, group]) => ({ key, group }));

export const GROUPS = ['technical', 'content', 'mobile', 'social'];

const ID_TO_KEY = Object.fromEntries(Object.entries(RULE_IDS.HEALTH).map(([raw, id]) => [id, raw.replace(/^PI /, '')]));

/** Normalise an engine finding or a Seorius finding to {check, severity, message|msgKey, params, fix_hint}. */
export function normaliseFinding(f) {
  const check = f.check || ID_TO_KEY[f.id] || 'other';
  return { id: f.id, check, severity: SEVERITY_MAP[f.severity] || f.severity, message: f.message || null, msgKey: f.msgKey || null, params: f.params || null, fix_hint: f.fix_hint || null, source: f.msgKey ? 'seorius' : 'engine' };
}

export function buildAudit(engineFindings, extraFindings) {
  const all = [...engineFindings, ...extraFindings].map(normaliseFinding);
  const checks = CHECKS.map((c) => {
    const fs = all.filter((f) => f.check === c.key).sort((a, b) => RANK[b.severity] - RANK[a.severity]);
    const status = fs.length ? fs[0].severity : 'pass';
    return { ...c, status, findings: fs };
  });
  const counts = { error: 0, warning: 0, notice: 0, 'not-run': 0, pass: 0 };
  for (const f of all) if (f.severity in counts) counts[f.severity]++;
  counts.pass = checks.filter((c) => c.status === 'pass').length;
  const attention = all.filter((f) => f.severity === 'error' || f.severity === 'warning').sort((a, b) => RANK[b.severity] - RANK[a.severity]).slice(0, 5);
  return { checks, counts, attention, findings: all };
}
