// Shared UI helpers: settings, locale loading, DOM builder, tab injection.
// Page data is always inserted as text (textContent / attributes), never as HTML.

import { DEFAULT_SETTINGS, mergeSettings, FONT_SIZES, fontPx } from '../lib/settings.mjs';

export { DEFAULT_SETTINGS, mergeSettings, FONT_SIZES };

export async function loadSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return mergeSettings(settings);
}
/** Applies the user text size (px) to the page; never below 14px. */
export function applyFontSize(s) {
  const px = fontPx(s);
  document.documentElement.style.setProperty('--fs', `${px}px`);
}
export async function saveSettings(s) { await chrome.storage.sync.set({ settings: s }); }

let MSG = {};
export function resolveLang(s) {
  if (s.lang === 'tr' || s.lang === 'en') return s.lang;
  return String(chrome.i18n.getUILanguage() || 'en').toLowerCase().startsWith('tr') ? 'tr' : 'en';
}
export async function loadLocale(lang) {
  const res = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`));
  const json = await res.json();
  MSG = Object.fromEntries(Object.entries(json).map(([k, v]) => [k, v.message]));
  document.documentElement.lang = lang;
  return lang;
}
export function t(key, params = {}) {
  const m = MSG[key];
  if (m === undefined) return key;
  return m.replace(/\{(\w+)\}/g, (_, p) => (params[p] !== undefined && params[p] !== null ? String(params[p]) : ''));
}
export const has = (key) => key in MSG;

/** el('div', {class:'x', onclick}, 'text', child) */
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach((n) => { n.title = t(n.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((n) => { n.placeholder = t(n.dataset.i18nPlaceholder); });
}

export const SEV_ORDER = ['error', 'warning', 'notice', 'not-run', 'pass'];
export function sevBadge(sev) { return el('span', { class: `sev sev-${sev}` }, t(`sev_${sev.replace('-', '_')}`)); }

// Engine and Seorius findings both carry msgKey + params; the English message / fix_hint stay as
// the fallback (and in the JSON export).
export function findingText(f) {
  if (f.msgKey && has(f.msgKey)) return t(f.msgKey, f.params || {});
  return f.message || '';
}
export function fixText(f) {
  if (f.fixKey && has(f.fixKey)) return t(f.fixKey, f.params || {});
  return f.fix_hint || '';
}

export function checkName(key) { return t(`check_${key.replace(/-/g, '_')}`); }

export const isInspectable = (url) => /^https?:\/\//i.test(url || '');

// ---- tab access (activeTab grant) ----

async function ensureInspector(tabId) {
  const [probe] = await chrome.scripting.executeScript({ target: { tabId }, func: () => !!globalThis.__seorius });
  if (!probe || !probe.result) await chrome.scripting.executeScript({ target: { tabId }, files: ['inspector.js'] });
}

export async function callInTab(tabId, method, ...args) {
  await ensureInspector(tabId);
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: (m, a) => globalThis.__seorius[m](...a), args: [method, args] });
  if (!r) throw new Error('no result');
  return r.result;
}

export async function scanTab(tabId, settings) {
  const result = await callInTab(tabId, 'scan', { stopWords: settings.stopWords, whitelist: settings.whitelist });
  try { await chrome.storage.session.set({ [`scan:${tabId}`]: result }); } catch { /* quota: report still has the in-memory copy */ }
  return result;
}

export async function storedScan(tabId) {
  const k = `scan:${tabId}`;
  const o = await chrome.storage.session.get(k);
  return o[k] || null;
}

/** Calls onChange(href) when the inspected tab's URL changes while this page is open. */
export async function watchTab(tabId, onChange) {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'seorius-watch' || !port.sender?.tab || port.sender.tab.id !== tabId) return;
    port.onMessage.addListener((m) => { if (m && m.type === 'url-changed') onChange(m.href); });
  });
  try { await callInTab(tabId, 'watch'); } catch { /* grant lost: rescan will report it */ }
}

export function errorText(e) {
  const m = String(e && e.message || e);
  if (/Cannot access|permission|No tab with id|Missing host permission|cannot be scripted|activeTab/i.test(m)) return t('err_no_access');
  return `${t('err_generic')} ${m}`;
}

export function download(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const fmtBytes = (n) => (n === null || n === undefined ? '—' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
export const short = (s, n = 80) => { const x = String(s ?? ''); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
