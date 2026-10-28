import { loadSettings, applyFontSize, saveSettings, mergeSettings, DEFAULT_SETTINGS, resolveLang, loadLocale, applyI18n, t, el, download } from './common.js';

const $ = (id) => document.getElementById(id);
let s;

const COL_LABELS = {
  links: { url: 'URL', count: 'col_count', anchors: 'col_anchors', anchorType: 'col_anchor_type', rel: 'rel', type: 'col_type', status: 'col_status' },
  images: { src: 'src', alt: 'alt', title: 'title', dims: 'col_dims_attr', natural: 'col_natural', rendered: 'col_rendered', bytes: 'col_bytes', format: 'col_format' },
};
const lbl = (k) => (/^col_/.test(k) ? t(k) : k);

function fill() {
  $('lang').value = s.lang;
  $('font-size').value = String(s.fontSize);
  for (const k of ['headings', 'links', 'images']) $(`c-${k}`).value = s.overlayColors[k];
  $('stopWords').value = s.stopWords;
  $('whitelist').value = s.whitelist;
  $('groups').replaceChildren(...['technical', 'content', 'mobile', 'social'].map((g) => el('label', {}, el('input', { type: 'checkbox', checked: s.auditGroups[g], onchange: (e) => { s.auditGroups[g] = e.target.checked; save(); } }), ' ', t(`grp_${g}`))));
  $('columns').replaceChildren(...Object.entries(COL_LABELS).map(([table, cols]) => el('fieldset', {}, el('legend', {}, t(`sec_${table}`)),
    Object.entries(cols).map(([k, l]) => el('label', {}, el('input', { type: 'checkbox', checked: s.columns[table][k], onchange: (e) => { s.columns[table][k] = e.target.checked; save(); } }), ' ', lbl(l))))));
}

let timer;
async function save() {
  await saveSettings(s);
  $('saved').textContent = t('opt_saved');
  clearTimeout(timer); timer = setTimeout(() => { $('saved').textContent = ''; }, 1500);
}

async function relocalise() { await loadLocale(resolveLang(s)); applyI18n(); fill(); }

(async function main() {
  s = await loadSettings();
  applyFontSize(s);
  await relocalise();
  $('font-size').addEventListener('change', async (e) => { s.fontSize = Number(e.target.value); applyFontSize(s); await save(); });
  $('lang').addEventListener('change', async (e) => { s.lang = e.target.value; await save(); relocalise(); });
  for (const k of ['headings', 'links', 'images']) $(`c-${k}`).addEventListener('change', (e) => { s.overlayColors[k] = e.target.value; save(); });
  for (const k of ['stopWords', 'whitelist']) $(k).addEventListener('input', (e) => { s[k] = e.target.value.slice(0, 20000); save(); });
  $('export').addEventListener('click', () => download('seorius-settings.json', JSON.stringify(s, null, 2), 'application/json'));
  $('reset').addEventListener('click', async () => { s = structuredClone(DEFAULT_SETTINGS); await save(); relocalise(); });
  $('import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
      // keep only known keys
      const clean = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).filter((k) => k in parsed).map((k) => [k, parsed[k]]));
      s = mergeSettings(clean);
      await save(); relocalise();
    } catch (err) { $('saved').textContent = `${t('opt_import_error')} ${err.message}`; }
    e.target.value = '';
  });
})();
