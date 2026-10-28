// Release check for dist/: exact permission set, no host access keys, and a list of every
// http(s) URL that appears in the built files (for manual review). Exit 1 on a permission defect.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const m = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'));
const problems = [];
if (JSON.stringify(m.permissions) !== JSON.stringify(['activeTab', 'scripting', 'storage'])) problems.push(`permissions are ${JSON.stringify(m.permissions)}`);
for (const k of ['host_permissions', 'optional_permissions', 'optional_host_permissions', 'content_scripts', 'externally_connectable', 'web_accessible_resources', 'background']) if (k in m) problems.push(`manifest has ${k}`);

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
console.log(JSON.stringify({ permissions: m.permissions, problems, urls: [...urls].sort().map(([u, files]) => ({ url: u, files: [...files] })) }, null, 2));
process.exit(problems.length ? 1 : 0);
