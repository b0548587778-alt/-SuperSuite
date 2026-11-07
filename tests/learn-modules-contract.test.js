// SuperSuite לימוד — החוזה של מודולי הלימוד (english, math, school; CLAUDE.md, "מודולי הלימוד — החוזה"):
// דף סטטי ב-modules/<id>/index.html כמו ארגז הכלים, נשען על שפת העיצוב, ספריית הרכיבים, רשת הביטחון וחלון ההודעות
// של המעטפת, ושומר רק ב-localStorage במפתחות בתחילית '<id>:' (מחסן מוצפן, גיבוי ושחזור). והרישום שלו בכל רשימה.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const LEARN = require('./helpers/learn-modules');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

for (const id of LEARN.LEARN_MODS) {
  test(`${id}: index.html קיים, בעברית ומימין לשמאל, עם CSP מחמיר`, () => {
    assert.ok(LEARN.exists(id), `modules/${id}/index.html חסר`);
    const html = read(`modules/${id}/index.html`);
    assert.match(html, /<html lang="he" dir="rtl"[ >]/);
    const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
    assert.ok(csp, 'חסר CSP');
    assert.match(csp[1], /script-src 'self'/);
    assert.doesNotMatch(csp[1], /unsafe-eval/);
    assert.doesNotMatch(csp[1].match(/script-src[^;]*/)[0], /unsafe-inline/);
    for (const tag of html.match(/<script\b[^>]*>/g) || []) assert.match(tag, /\ssrc="[^"]+"/, 'סקריפט inline: ' + tag);
    assert.doesNotMatch(html, /(src|href)="(https?:)?\/\//, 'אין משאב חיצוני');
  });

  test(`${id}: נטען מהמעטפת — שפת העיצוב, ספריית הרכיבים, רשת הביטחון (ראשונה) וחלון ההודעות`, () => {
    if (!LEARN.exists(id)) assert.fail(`modules/${id}/index.html חסר`);
    const html = read(`modules/${id}/index.html`);
    const tokens = html.indexOf('href="/design-tokens.css"');
    const kit = html.indexOf('href="/ui-kit.css"');
    assert.ok(tokens > 0, '/design-tokens.css');
    assert.ok(kit > tokens, '/ui-kit.css אחרי שפת העיצוב');
    assert.ok(!/<style[\s>]|rel="stylesheet" href="(?!\/design-tokens)/.test(html.slice(0, tokens)), 'שפת העיצוב לפני כל סגנון אחר');
    assert.equal(html.indexOf('<script'), html.indexOf('<script src="/screen-guard.js"'), 'רשת הביטחון לפני כל סקריפט אחר');
    assert.match(html, /<script src="\/ss-dialog\.js"><\/script>/);
  });

  test(`${id}: בלי רשת, בלי חלונות הדפדפן, ואחסון רק ב-localStorage בתחילית '${id}:'`, () => {
    if (!LEARN.exists(id)) assert.fail(`modules/${id}/index.html חסר`);
    const bad = [];
    for (const f of LEARN.moduleFiles(id, /\.(js|html)$/)) {
      const src = stripComments(read(f));
      if (/\bfetch\s*\(|new\s+XMLHttpRequest|new\s+WebSocket\s*\(|navigator\.sendBeacon|new\s+EventSource\s*\(/.test(src)) bad.push(f + ': רשת');
      if (/\bindexedDB\b|\bopenDatabase\s*\(|document\.cookie/.test(src)) bad.push(f + ': אחסון שאינו localStorage (לא מוצפן ולא בגיבוי)');
      for (const m of src.matchAll(/(^|[^.\w])(alert|confirm|prompt)\(/g)) bad.push(`${f}: ${m[2]}(`);
      if (/\bwindow\.open\s*\(/.test(src)) bad.push(f + ': window.open');
      for (const m of src.matchAll(/localStorage\s*\.\s*(?:getItem|setItem|removeItem)\(\s*(['"`])([^'"`$]*)\1/g)) {
        if (!m[2].startsWith(id + ':')) bad.push(`${f}: מפתח localStorage בלי התחילית — "${m[2]}"`);
      }
    }
    assert.deepEqual(bad, []);
  });
}

test('רישום: כל מודול לימוד רשום בכל רשימה של מודולים', () => {
  const main = read('main.js');
  const mods = JSON.parse(main.match(/const MODS = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  const lsMods = JSON.parse(main.match(/const LS_MODS = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  const Catalog = require('../shell/catalog');
  const SecureStore = require('../shell/secure-store');
  const LG = require('../shell/licensing/gate');
  const OFFER = require('../shell/licensing/offer');
  const { MODULE_NAMES } = require('../shell/crash');
  const { LOCKED_MODS } = require('../shell/login-gate');
  const preload = read('shell/secure-ls-preload.js');
  const shellHtml = read('shell/shell.html');
  for (const id of LEARN.LEARN_MODS) {
    assert.ok(mods.includes(id) && lsMods.includes(id), 'MODS / LS_MODS: ' + id);
    assert.ok(main.includes(`${id}: 'app://${id}/index.html'`), 'ENTRY: ' + id);
    assert.equal(Catalog.ITEMS.filter(it => it.mod === id).length, 1, 'קטלוג: ' + id);
    assert.ok(SecureStore.MODULES.includes(id), 'מחסן מוצפן: ' + id);
    assert.ok(preload.includes(`'${id}': '${id}'`), 'secure-ls-preload: ' + id);
    assert.equal(LG.MODULE_FEATURES[id], id, 'שער הרישוי: ' + id);
    assert.ok(OFFER.FEATURES.includes(id), 'התחומים המוצעים: ' + id);
    assert.match(MODULE_NAMES[id] || '', /[֐-׿]/, 'שם בדוח תקלה: ' + id);
    assert.ok(shellHtml.includes(`<option value="${id}">`), 'גיבוי של מודול בודד: ' + id);
  }
  // ניהול מוסד — נתונים אישיים: רק אחרי כניסה. אנגלית וחשבון — פתוחים
  assert.ok(LOCKED_MODS.includes('school'));
  assert.ok(!LOCKED_MODS.includes('english') && !LOCKED_MODS.includes('math'));
  // SuperSuite המלאה: מודולי הלימוד לצד השמאות והתחומים הכלכליים (אנדרואיד — לא בשלב הזה, החלטת הבעלים)
  assert.ok(mods.includes('shamai') && OFFER.FEATURES.includes('shamai'));
});
