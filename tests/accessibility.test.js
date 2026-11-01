// נגישות בסיסית (PLAN.md 7.3): ניגודיות צבעים, מיקוד במקלדת, ושמות לקורא מסך
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const TOKENS = read('shell/design-tokens.css');
// רק הבלוק הראשון (:root) — הערכה הכהה והגדרות התצוגה (7.4) נבדקות ב-tests/display.test.js
const T = Object.fromEntries([...TOKENS.slice(0, TOKENS.indexOf('}')).matchAll(/--ss-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map(m => [m[1], m[2]]));

// יחס ניגודיות לפי WCAG 2.1
function lum(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => { const x = lum(T[a]), y = lum(T[b]); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// טקסט רגיל ← 4.5 לפחות. זוג חדש של טקסט על רקע — להוסיף כאן
const TEXT_PAIRS = [
  ['text', 'surface'], ['text', 'bg'], ['text-2', 'surface'],
  ['muted', 'surface'], ['muted', 'bg'], ['muted', 'surface-2'], ['muted', 'primary-soft'],
  ['faint', 'surface'], ['faint', 'bg'], ['faint', 'surface-2'],
  ['ink', 'navy-1'], ['ink-2', 'navy-1'], ['ink-2', 'navy-2'], ['ink-3', 'navy-1'], ['ink-3', 'navy-0'],
  ['gold', 'navy-1'], ['gold-bright', 'navy-1'],
  ['primary', 'surface'], ['primary', 'primary-soft'], ['on-primary', 'primary'], ['on-primary', 'primary-dark'],
  ['success', 'surface'], ['success-ink', 'success-soft'], ['warning', 'surface'], ['warning-ink', 'warning-soft'],
  ['danger', 'surface'], ['danger-ink', 'danger-soft'], ['info', 'surface'], ['info-ink', 'info-soft'],
  ['dark-text', 'dark-bg'], ['dark-muted', 'dark-bg'], ['dark-muted', 'dark-surface'], ['dark-faint', 'dark-bg'], ['dark-gold', 'dark-bg'],
  // עוזר ה-AI (תיבת השאלה, הסיור) וכותרת מסך הבית
  ['violet', 'surface'], ['violet', 'violet-soft'], ['violet-ink', 'violet-soft'], ['ink-2', 'hero-end'],
];

test('ניגודיות: כל זוג טקסט ורקע בשפת העיצוב — 4.5 לפחות', () => {
  const bad = TEXT_PAIRS.filter(([a, b]) => {
    assert.ok(T[a] && T[b], 'משתנה חסר: ' + a + ' / ' + b);
    return ratio(a, b) < 4.5;
  }).map(([a, b]) => `${a} על ${b}: ${ratio(a, b).toFixed(2)}`);
  assert.deepEqual(bad, []);
});

test('ניגודיות: מסגרת המיקוד בולטת (3 לפחות) על הרקע הבהיר ועל הסרגל הכהה', () => {
  assert.match(TOKENS, /--ss-focus-ring: var\(--ss-primary\)/);
  assert.match(TOKENS, /--ss-focus-ring-dark: var\(--ss-gold-bright\)/);
  assert.ok(ratio('primary', 'surface') >= 3 && ratio('primary', 'bg') >= 3);
  assert.ok(ratio('gold-bright', 'navy-1') >= 3 && ratio('gold-bright', 'dark-bg') >= 3);
});

test('מקלדת: מסגרת מיקוד בכל מסך (focus-visible בקובץ שנטען ראשון), וזהובה על רקע כהה', () => {
  assert.match(TOKENS, /:focus-visible \{ outline: 3px solid var\(--ss-focus-ring\) !important;/);
  assert.match(TOKENS, /prefers-reduced-motion: reduce/);
  assert.match(read('shell/shell.html'), /\.side :focus-visible\{outline-color:var\(--ss-focus-ring-dark\) !important\}/);
});

// כפתור בלי טקסט עברי/אנגלי (רק אייקון) חייב aria-label
function unnamedButtons(html) {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter(([, attrs, inner]) => !/aria-label=/.test(attrs) && !/[֐-׿A-Za-z]{2,}/.test(inner.replace(/<[^>]+>/g, '')) && !/\bhidden\b/.test(attrs))
    .map(([, attrs, inner]) => inner.trim() + ' ' + attrs.trim());
}

test('קורא מסך: לכל כפתור אייקון במסכים הקבועים יש שם', () => {
  for (const f of ['shell/shell.html', 'modules/econ/views/index.html', 'modules/tools/index.html', 'shell/splash.html']) {
    assert.deepEqual(unnamedButtons(read(f)), [], f);
  }
});

// שדה בלי שם: אין aria-label, אין <label for>, ואינו עטוף ב-<label>. hidden / file / כפתורים — מדולגים
function unlabeledFields(html) {
  const forIds = new Set([...html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]));
  const out = [];
  for (const m of html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
    const a = m[2];
    if (/type="(hidden|button|submit|file)"/.test(a) || /\shidden(\s|$|=|\/)/.test(a)) continue;
    if (/aria-label(ledby)?="[^"]+"/.test(a)) continue;
    const id = (a.match(/\bid="([^"]+)"/) || [])[1];
    if (id && forIds.has(id)) continue;
    const before = html.slice(0, m.index);
    if (before.lastIndexOf('<label') > before.lastIndexOf('</label>')) continue;
    out.push(id || a.trim().slice(0, 50));
  }
  return out;
}

test('קורא מסך: לכל שדה בשמאות ובארגז הכלים יש שם, ואין מאפיין שבור (גרש כפול באמצע הערך)', () => {
  for (const f of ['modules/shamai/index.html', 'modules/tools/index.html']) {
    const html = read(f);
    assert.deepEqual(unlabeledFields(html), [], f);
    assert.doesNotMatch(html, /aria-label="[^"]*"[^\s>/]/, f);
    // כל label for מצביע על שדה שקיים
    for (const [, id] of html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)) assert.match(html, new RegExp(`id="${id}"`), `${f}: for="${id}"`);
  }
  // הבדיקה עצמה תופסת שדה בלי שם
  assert.deepEqual(unlabeledFields('<div><span>שם</span><input id="x"></div><label>א<input id="y"></label><label for="z">ב</label><input id="z">'), ['x']);
});

test('קורא מסך: לכל דיאלוג יש כותרת, וההודעות מוקראות', () => {
  const shell = read('shell/shell.html');
  for (const [, attrs] of shell.matchAll(/<dialog\b([^>]*)>/g)) assert.match(attrs, /aria-label(ledby)?=/, '<dialog' + attrs + '>');
  for (const [, id] of shell.matchAll(/<dialog[^>]*aria-labelledby="([^"]+)"/g)) assert.match(shell, new RegExp('id="' + id + '"'), 'כותרת קיימת: ' + id);
  const econ = read('modules/econ/views/index.html');
  assert.match(econ, /id="modal"[^>]*role="dialog"[^>]*aria-labelledby="modalTitle"/);
  assert.match(econ, /id="toastContainer" role="status" aria-live="polite"/);
  for (const f of ['shell/shell.html', 'modules/econ/views/index.html', 'modules/tools/index.html', 'modules/shamai/index.html']) {
    assert.match(read(f), /<html lang="he" dir="rtl"[ >]/, f);
  }
});

test('קורא מסך: דיאלוג שנבנה בקוד מקושר לכותרת שלו, וכפתורי אייקון מקבלים את ה-title כשם', () => {
  const dialogs = read('modules/econ/ui/dialogs.js');
  assert.match(dialogs, /card\.parentNode\.setAttribute\('aria-labelledby', h\.id\)/);
  const core = read('modules/econ/ui/core.js');
  assert.match(core, /labelIconButtons\(elements\.view\);/);

  // הרצה אמיתית של labelIconButtons על כפתורים מדומים
  const ctx = {};
  vm.createContext(ctx);
  const fn = core.slice(core.indexOf('function labelIconButtons'), core.indexOf('\n}', core.indexOf('function labelIconButtons')) + 2);
  vm.runInContext(fn, ctx);
  const btn = (text, title, label) => ({ textContent: text, attrs: { title, ...(label ? { 'aria-label': label } : {}) },
    getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; } });
  const icon = btn('🗑', 'מחיקה'), word = btn('הורד PDF', 'הורדה'), done = btn('✎', 'עריכה', 'קיים');
  ctx.labelIconButtons({ querySelectorAll: () => [icon, word] });
  assert.equal(icon.attrs['aria-label'], 'מחיקה');
  assert.equal(word.attrs['aria-label'], undefined, 'כפתור עם מילים — השם הוא הטקסט שלו');
  assert.equal(done.attrs['aria-label'], 'קיים');
});

test('הצהרת נגישות במדריך (F1): מקלדת, הגדלה, ופנייה על בעיה', () => {
  const shell = read('shell/shell.html');
  const guide = shell.slice(shell.indexOf('<dialog id="guide"'), shell.indexOf('</dialog>', shell.indexOf('<dialog id="guide"')));
  assert.match(guide, /<h4 id="a11y">נגישות<\/h4>/);
  assert.match(guide, /Tab/);
  assert.match(guide, /<kbd>Ctrl<\/kbd>\+<kbd>0<\/kbd>/);
  assert.match(guide, /הודעה לספק/);
  // הקיצורים שבהצהרה קיימים באמת
  assert.match(read('main.js'), /input\.control && \(input\.key === '=' \|\| input\.key === '\+'\)/);
});
