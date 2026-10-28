// Release check for dist/: exact permission set, no host access keys, exactly one content script
// (serp.js + serp.css on the Google web-search paths in src/lib/serp.mjs SERP_MATCHES and nothing
// else), no network API in the Google results bundle, and a list of every http(s) URL that appears
// in the built files (for manual review). Exit 1 on any defect.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SERP_MATCHES } from '../src/lib/serp.mjs';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const m = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'));
const problems = [];
if (JSON.stringify(m.permissions) !== JSON.stringify(['activeTab', 'scripting', 'storage'])) problems.push(`permissions are ${JSON.stringify(m.permissions)}`);
for (const k of ['host_permissions', 'optional_permissions', 'optional_host_permissions', 'externally_connectable', 'web_accessible_resources', 'background']) if (k in m) problems.push(`manifest has ${k}`);

// Content scripts: exactly the Google results script, only on Google web-search paths.
const cs = m.content_scripts || [];
if (cs.length !== 1) problems.push(`content_scripts has ${cs.length} entries (expected 1)`);
for (const c of cs) {
  const allowed = ['matches', 'js', 'css', 'run_at'];
  for (const k of Object.keys(c)) if (!allowed.includes(k)) problems.push(`content_scripts has ${k}`);
  if (JSON.stringify(c.js) !== JSON.stringify(['serp.js'])) problems.push(`content_scripts js is ${JSON.stringify(c.js)}`);
  if (c.css && JSON.stringify(c.css) !== JSON.stringify(['serp.css'])) problems.push(`content_scripts css is ${JSON.stringify(c.css)}`);
  if (JSON.stringify(c.matches) !== JSON.stringify(SERP_MATCHES)) problems.push('content_scripts matches differ from SERP_MATCHES');
  for (const u of c.matches || []) if (!/^https:\/\/www\.google\.[a-z]{2,3}(\.[a-z]{2})?\/search\*$/.test(u)) problems.push(`content_scripts match not a Google search path: ${u}`);
}

// The Google results bundle must not contain any network API.
const serpJs = await readFile(path.join(dist, 'serp.js'), 'utf8').catch(() => '');
if (!serpJs) problems.push('serp.js missing');
const net = ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'importScripts', 'new Image(', 'navigator.connection'].filter((w) => serpJs.includes(w));
if (net.length) problems.push(`serp.js contains network API: ${net.join(', ')}`);

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else if (/\.(js|html|css|json)$/.test(e.name)) out.push(p);
  }
  return out;
}
const urls = new Map();
for (const f of await walk(dist)) {
  const s = await readFile(f, 'utf8');
  for (const u of s.match(/https?:\/\/[^\s"'`)<>\\]+/g) || []) {
    const k = u.replace(/[.,;]+$/, '');
    if (!urls.has(k)) urls.set(k, new Set());
    urls.get(k).add(path.relative(dist, f).replace(/\\/g, '/'));
  }
}
console.log(JSON.stringify({ permissions: m.permissions, content_scripts_matches: (m.content_scripts || []).flatMap((c) => c.matches || []).length, serp_network_api: net, problems, urls: [...urls].sort().map(([u, files]) => ({ url: u, files: [...files] })) }, null, 2));
process.exit(problems.length ? 1 : 0);
