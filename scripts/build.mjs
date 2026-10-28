// Build: bundle the injected inspector and the three UI pages with esbuild, copy static files,
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
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: ['chrome116'],
  minify: false,
  legalComments: 'inline',
  logLevel: 'warning',
  plugins: [{
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

for (const f of ['manifest.json', 'ui/popup.html', 'ui/report.html', 'ui/options.html', 'ui/style.css']) await cp(path.join(src, f), path.join(dist, path.basename(f)));
await cp(path.join(src, '_locales'), path.join(dist, '_locales'), { recursive: true });
await cp(path.join(root, 'LICENSE'), path.join(dist, 'LICENSE'));

// Locale files must be valid JSON and carry the same keys.
const en = JSON.parse(await readFile(path.join(src, '_locales/en/messages.json'), 'utf8'));
const tr = JSON.parse(await readFile(path.join(src, '_locales/tr/messages.json'), 'utf8'));
const missing = [...Object.keys(en).filter((k) => !(k in tr)).map((k) => `tr:${k}`), ...Object.keys(tr).filter((k) => !(k in en)).map((k) => `en:${k}`)];
if (missing.length) { console.error('Locale key mismatch:', missing.join(', ')); process.exit(1); }

// ---- icons: teal rounded square with a white magnifier ----
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
function png(size) {
  const S = 4; const raw = Buffer.alloc(size * (size * 4 + 1));
  const bg = [15, 107, 92];
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let a = 0; let w = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const u = (x + (sx + 0.5) / S) / size; const v = (y + (sy + 0.5) / S) / size;
        // rounded square, radius 0.2
        const r = 0.2; const dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0); const dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
        if (dx * dx + dy * dy > r * r) continue;
        a++;
        // magnifier ring centre (0.44,0.44) radius 0.22 thickness 0.075; handle to (0.76,0.76)
        const d = Math.hypot(u - 0.44, v - 0.44);
        const ring = Math.abs(d - 0.2) < 0.06;
        const t = Math.max(0, Math.min(1, ((u - 0.58) + (v - 0.58)) / (2 * 0.2)));
        const px = 0.58 + t * 0.2; const hd = Math.hypot(u - px, v - px);
        const handle = hd < 0.07;
        if (ring || handle) w++;
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const wf = a ? w / a : 0;
      raw[o] = Math.round(bg[0] + (255 - bg[0]) * wf); raw[o + 1] = Math.round(bg[1] + (255 - bg[1]) * wf); raw[o + 2] = Math.round(bg[2] + (255 - bg[2]) * wf);
      raw[o + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const n of [16, 32, 48, 128]) await writeFile(path.join(dist, 'icons', `icon${n}.png`), png(n));

console.log('dist/ built');
