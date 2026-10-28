// Build: bundle the injected inspector, the Google results script and the three UI pages with esbuild, copy static files,
// and draw the toolbar icons (own artwork, generated here so no binary is checked in).
import { build } from 'esbuild';
import { mkdir, rm, cp, writeFile, readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'icons'), { recursive: true });

await build({
  entryPoints: {
    inspector: path.join(src, 'inspector/inspector.js'),
    popup: path.join(src, 'ui/popup.js'),
    report: path.join(src, 'ui/report.js'),
    options: path.join(src, 'ui/options.js'),
    serp: path.join(src, 'serp/serp.js'),
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: ['chrome116'],
  minify: false,
  legalComments: 'inline',
  logLevel: 'warning',
  plugins: [{
    // The Google results script cannot load locale files (it makes no requests at all), so its
    // serp_* strings are bundled in: { en: {...}, tr: {...} }.
    name: 'serp-messages',
    setup(b) {
      b.onResolve({ filter: /^seorius:serp-messages$/ }, () => ({ path: 'serp-messages', namespace: 'seorius' }));
      b.onLoad({ filter: /.*/, namespace: 'seorius' }, async () => {
        const out = {};
        for (const l of ['en', 'tr']) {
          const j = JSON.parse(await readFile(path.join(src, `_locales/${l}/messages.json`), 'utf8'));
          out[l] = Object.fromEntries(Object.entries(j).filter(([k]) => k.startsWith('serp_')).map(([k, v]) => [k, v.message]));
        }
        return { contents: JSON.stringify(out), loader: 'json' };
      });
    },
  }, {
    // Rules files ship without their "$comment" / "evidence" documentation blocks: the code
    // reads only the values, and the source URLs inside the evidence notes are not needed at runtime.
    name: 'rules-values-only',
    setup(b) {
      b.onLoad({ filter: /[\\/]src[\\/]engine[\\/][^\\/]+-rules\.json$/ }, async (args) => {
        const j = JSON.parse(await readFile(args.path, 'utf8'));
        delete j.$comment; delete j.evidence;
        return { contents: JSON.stringify(j), loader: 'json' };
      });
    },
  }],
});

for (const f of ['manifest.json', 'ui/popup.html', 'ui/report.html', 'ui/options.html', 'ui/style.css', 'serp/serp.css']) await cp(path.join(src, f), path.join(dist, path.basename(f)));
await cp(path.join(src, '_locales'), path.join(dist, '_locales'), { recursive: true });
await cp(path.join(root, 'LICENSE'), path.join(dist, 'LICENSE'));

// Locale files must be valid JSON and carry the same keys.
const en = JSON.parse(await readFile(path.join(src, '_locales/en/messages.json'), 'utf8'));
const tr = JSON.parse(await readFile(path.join(src, '_locales/tr/messages.json'), 'utf8'));
const missing = [...Object.keys(en).filter((k) => !(k in tr)).map((k) => `tr:${k}`), ...Object.keys(tr).filter((k) => !(k in en)).map((k) => `en:${k}`)];
if (missing.length) { console.error('Locale key mismatch:', missing.join(', ')); process.exit(1); }

// ---- icons: logo C (S + Sirius star), rasterised here so no binary is checked in ----
function crc32(buf) {
  let c; const table = crc32.t || (crc32.t = Array.from({ length: 256 }, (_, n) => { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }));
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// Logo (src/icons/logo.svg, 128-unit box): navy disc, white "S" stroke, mint four-point star (Sirius).
function cubic(p0, p1, p2, p3, n = 24) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n; const m = 1 - t;
    out.push([m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0], m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1]]);
  }
  return out;
}
function poly(start, segs) {
  const pts = [start]; let cur = start;
  for (const [a, b, c] of segs) { pts.push(...cubic(cur, a, b, c)); cur = c; }
  return pts;
}
const S_PATH = poly([84, 40], [[[78, 32], [68, 29], [58, 29]], [[44, 29], [34, 37], [34, 49]], [[34, 61], [45, 65], [58, 68]], [[72, 71], [82, 75], [82, 87]], [[82, 98], [72, 104], [60, 104]], [[48, 104], [40, 99], [35, 91]]]);
const S_HALF_WIDTH = 5.5;
function starPath(cx, cy, r, k) {
  const i = r * k;
  return poly([cx, cy - r], [
    [[cx + i * 0.6, cy - i * 1.2], [cx + i * 1.2, cy - i * 0.6], [cx + r, cy]],
    [[cx + i * 1.2, cy + i * 0.6], [cx + i * 0.6, cy + i * 1.2], [cx, cy + r]],
    [[cx - i * 0.6, cy + i * 1.2], [cx - i * 1.2, cy + i * 0.6], [cx - r, cy]],
    [[cx - i * 1.2, cy - i * 0.6], [cx - i * 0.6, cy - i * 1.2], [cx, cy - r]],
  ]);
}
const STAR = starPath(94, 30, 16, 0.22);
function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax; const dy = by - ay; const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function inside(px, py, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]; const [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function logoColor(x, y) {
  if (Math.hypot(x - 64, y - 64) > 64) return null;
  if (inside(x, y, STAR)) return [127, 216, 200];
  for (let i = 1; i < S_PATH.length; i++) if (segDist(x, y, S_PATH[i - 1], S_PATH[i]) <= S_HALF_WIDTH) return [255, 255, 255];
  return [16, 36, 58];
}
function png(size) {
  const S = size <= 32 ? 8 : 4; const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let a = 0; const sum = [0, 0, 0];
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const c = logoColor(((x + (sx + 0.5) / S) / size) * 128, ((y + (sy + 0.5) / S) / size) * 128);
        if (!c) continue;
        a++; sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      if (a) { raw[o] = Math.round(sum[0] / a); raw[o + 1] = Math.round(sum[1] / a); raw[o + 2] = Math.round(sum[2] / a); }
      raw[o + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const n of [16, 32, 48, 128]) await writeFile(path.join(dist, 'icons', `icon${n}.png`), png(n));

console.log('dist/ built');
