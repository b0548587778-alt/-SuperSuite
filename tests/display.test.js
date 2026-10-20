// הגדרות תצוגה לכל התוכנה (PLAN.md 7.4): ערכה בהירה/כהה, צבע הדגשה, צפיפות, טקסט, פינות, ניגודיות ותנועה
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const D = require('../shell/display');
const TOKENS = read('shell/design-tokens.css');

test('sanitize: ערך לא מוכר ← ברירת המחדל; קלט לא אובייקט ← הכול ברירת מחדל', () => {
  assert.deepEqual(D.sanitize(null), D.DEFAULTS);
  assert.deepEqual(D.sanitize('dark'), D.DEFAULTS);
  const s = D.sanitize({ theme: 'dark', accent: 'red', density: 'compact', text: 'huge', shape: 'square', contrast: 'high', motion: 'reduced', extra: 'x' });
  assert.deepEqual(s, { theme: 'dark', accent: 'blue', density: 'compact', text: 'md', shape: 'square', contrast: 'high', motion: 'reduced' });
  assert.equal(Object.keys(s).length, D.KEYS.length);
});

test('ברירת המחדל = המראה הקיים (בהיר, כחול, רגיל)', () => {
  assert.deepEqual(D.DEFAULTS, { theme: 'light', accent: 'blue', density: 'comfortable', text: 'md', shape: 'rounded', contrast: 'normal', motion: 'normal' });
});

test('attrsFor: "לפי Windows" נפתר לפי המחשב; כל מאפיין data-ss-*', () => {
  assert.equal(D.attrsFor({ theme: 'system' }, true)['data-ss-theme'], 'dark');
  assert.equal(D.attrsFor({ theme: 'system' }, false)['data-ss-theme'], 'light');
  assert.equal(D.attrsFor({ theme: 'dark' }, false)['data-ss-theme'], 'dark');
  const a = D.attrsFor({}, false);
  assert.deepEqual(Object.keys(a).sort(), D.KEYS.map(k => 'data-ss-' + k).sort());
});

test('ערכות מוכנות: כל אחת נותנת הגדרות תקינות ושונות מהאחרות', () => {
  const seen = new Set();
  for (const p of D.PRESETS) {
    const s = D.applyPreset(p.id);
    assert.deepEqual(s, D.sanitize(s), p.id);
    for (const [k, v] of Object.entries(p.set)) assert.equal(s[k], v, `${p.id}.${k}`);
    const key = JSON.stringify(s);
    assert.ok(!seen.has(key), 'ערכה כפולה: ' + p.id);
    seen.add(key);
  }
  assert.equal(D.applyPreset('nope'), null);
  assert.deepEqual(D.applyPreset('classic'), D.DEFAULTS);
});

test('applyTo: רק מאפייני data-ss-* עם ערך פשוט', () => {
  const set = {};
  const doc = { documentElement: { setAttribute: (k, v) => { set[k] = v; } } };
  D.applyTo(doc, { 'data-ss-theme': 'dark', onclick: 'x', 'data-ss-accent': 'a"b', 'data-ss-text': 'lg' });
  assert.deepEqual(set, { 'data-ss-theme': 'dark', 'data-ss-text': 'lg' });
});

test('design-tokens.css: בלוק לכל ערך שאינו ברירת מחדל', () => {
  for (const k of D.KEYS) {
    for (const o of D.OPTIONS[k].slice(1)) {
      if (k === 'theme' && o.id === 'system') continue; // נפתר לבהיר/כהה
      assert.ok(TOKENS.includes(`[data-ss-${k}="${o.id}"]`), `חסר עיצוב ל-${k}=${o.id}`);
    }
  }
  for (const o of D.OPTIONS.accent.slice(1)) assert.ok(TOKENS.includes(`[data-ss-theme="dark"][data-ss-accent="${o.id}"]`), 'הדגשה בערכה הכהה: ' + o.id);
  for (const o of D.OPTIONS.accent) assert.match(TOKENS, new RegExp(`--ss-accent-${o.id}:\\s*#`), 'דוגמית: ' + o.id);
});

// ---- ניגודיות בערכה הכהה ובצבעי ההדגשה ----
function block(sel) {
  const i = TOKENS.indexOf(sel + ' {');
  assert.ok(i >= 0, 'חסר בלוק ' + sel);
  const body = TOKENS.slice(i, TOKENS.indexOf('}', i));
  return Object.fromEntries([...body.matchAll(/--ss-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map(m => [m[1], m[2]]));
}
const BASE = block(':root');
function lum(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
const pairsOk = (T, pairs) => pairs.filter(([a, b]) => { assert.ok(T[a] && T[b], 'חסר ' + a + '/' + b); return ratio(T[a], T[b]) < 4.5; })
  .map(([a, b]) => `${a} על ${b}: ${ratio(T[a], T[b]).toFixed(2)}`);

test('ערכה כהה: טקסט ורקעים — ניגודיות 4.5 לפחות', () => {
  const T = { ...BASE, ...block(':root[data-ss-theme="dark"]') };
  assert.deepEqual(pairsOk(T, [
    ['text', 'surface'], ['text', 'bg'], ['text-2', 'surface'], ['muted', 'surface'], ['muted', 'bg'], ['muted', 'surface-2'],
    ['faint', 'surface'], ['faint', 'bg'], ['navy-2', 'surface'], ['navy-2', 'bg'],
    ['primary', 'surface'], ['on-primary', 'primary'], ['on-primary', 'primary-dark'], ['surface', 'primary'],
    ['success-ink', 'success-soft'], ['warning-ink', 'warning-soft'], ['danger-ink', 'danger-soft'], ['info-ink', 'info-soft'],
    ['success', 'surface'], ['warning', 'surface'], ['danger', 'surface'], ['surface', 'danger'],
    ['on-dark', 'side-top'], ['ink-2', 'side-top'],
  ]), []);
});

test('צבעי הדגשה: כפתור ראשי קריא בבהיר ובכהה', () => {
  for (const o of D.OPTIONS.accent.slice(1)) {
    const light = { ...BASE, ...block(`:root[data-ss-accent="${o.id}"]`) };
    assert.deepEqual(pairsOk(light, [['on-primary', 'primary'], ['on-primary', 'primary-dark'], ['primary', 'surface'], ['primary', 'primary-soft']]), [], o.id);
    const dark = { ...BASE, ...block(':root[data-ss-theme="dark"]'), ...block(`:root[data-ss-theme="dark"][data-ss-accent="${o.id}"]`) };
    assert.deepEqual(pairsOk(dark, [['on-primary', 'primary'], ['surface', 'primary'], ['primary', 'surface'], ['text', 'primary-soft']]), [], o.id + ' (כהה)');
  }
});

test('ניגודיות גבוהה: טקסט משני חזק יותר מהרגיל', () => {
  const hi = { ...BASE, ...block(':root[data-ss-contrast="high"]') };
  assert.ok(ratio(hi.muted, BASE.surface) > ratio(BASE.muted, BASE.surface));
  const dhi = { ...BASE, ...block(':root[data-ss-theme="dark"]'), ...block(':root[data-ss-theme="dark"][data-ss-contrast="high"]') };
  assert.ok(ratio(dhi.muted, dhi.surface) >= 7, 'כהה + ניגודיות גבוהה');
});

test('main.js: ההגדרות נשמרות רק מהמעטפת, ה-preload נרשם לכל ה-session, ומודול משנה רק בהיר/כהה', () => {
  const main = read('main.js');
  assert.match(main, /registerPreloadScript\(\{ type: 'frame', filePath: path\.join\(__dirname, 'shell', 'display-preload\.js'\) \}\)/);
  const save = main.slice(main.indexOf("ipcMain.handle('shell:save-display'"), main.indexOf("ipcMain.handle('display:set-theme'"));
  assert.match(save, /canShellNavigate\(e\.sender\.id, win\.webContents\.id\)/);
  const setTheme = main.slice(main.indexOf("ipcMain.handle('display:set-theme'"));
  assert.match(setTheme.slice(0, 600), /\['light', 'dark'\]\.includes\(theme\)/);
  assert.match(main, /saveJson\(uiFile\(\), \{ \.\.\.ui, display: Display\.sanitize\(input\) \}\)/, 'מיזוג — לא דורס את הלוח העברי והזום');
  assert.match(main, /nativeTheme\.themeSource = displaySettings\(\)\.theme/);
});

test('display-preload: רק במסכים שלנו ובמסגרת העליונה; חשיפה אחת בלבד', () => {
  const p = read('shell/display-preload.js');
  assert.match(p, /location\.protocol === 'app:'/);
  assert.match(p, /window === window\.top/);
  assert.equal((p.match(/exposeInMainWorld\(/g) || []).length, 1);
  assert.doesNotMatch(p, /require\('(?!electron')/, 'preload בארגז חול — רק electron');
});

test('המעטפת: כפתור וחלון "תצוגה" עם כותרת נגישה, ו-display.js נטען לפני shell.js', () => {
  const html = read('shell/shell.html');
  assert.match(html, /<button id="ds" aria-label="תצוגה"/);
  assert.match(html, /<dialog id="dsDlg" class="ds-dlg" aria-labelledby="dsTitle">/);
  assert.ok(html.indexOf('src="display.js"') > 0 && html.indexOf('src="display.js"') < html.indexOf('src="shell.js"'));
  assert.match(read('shell/preload.js'), /saveDisplay: \(s\) => ipcRenderer\.invoke\('shell:save-display', s\)/);
  assert.match(read('android/build-apk.js'), /'display\.js', 'hebcal\.js'/);
});

test('סרגל הצד וכותרת מסך הבית נשארים כהים גם בערכה הכהה', () => {
  const html = read('shell/shell.html');
  assert.match(html, /\.side\{[^}]*linear-gradient\(180deg,var\(--ss-side-top\)/);
  assert.match(html, /\.brand b\{[^}]*color:var\(--ss-on-dark\)/);
  const dark = block(':root[data-ss-theme="dark"]');
  for (const k of ['side-top', 'on-dark', 'hero-end', 'navy-0', 'navy-1', 'ink', 'ink-2']) assert.ok(!(k in dark), 'הערכה הכהה לא משנה את ' + k);
});

test('שמאות: כפתור הערכה משנה את כל התוכנה, וערכת התוכנה גוברת על הבחירה השמורה', () => {
  const c = read('modules/shamai/src/contacts.js');
  assert.match(c, /window\.ssDisplay\.setTheme\(next\)/);
  assert.match(c, /const savedTheme = suiteTheme\(\) \|\| localStorage\.getItem\('shamai_theme'\)/);
  assert.match(c, /attributeFilter: \['data-ss-theme'\]/);
});
