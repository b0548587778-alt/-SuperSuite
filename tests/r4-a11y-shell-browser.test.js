// נגישות, סבב 4 — בדיקה בדפדפן Chromium אמיתי (בלי ממשק): המעטפת, ארגז הכלים, השמאות, המדריך והצהרת הנגישות.
// לכל מסך: לכל פקד יש שם נגיש, מטרות לחיצה 24×24 לפחות (44 במצב פשוט), בלי גלילה לרוחב (גם ב-320 פיקסלים),
// בלי מזהים כפולים ובלי שגיאות JavaScript; ועבודה במקלדת בלבד — חלון "♿ נגישות", השאלה בהפעלה הראשונה ובועת "?".
// בלי דפדפן במחשב (למשל ב-Windows ב-CI) — הבדיקות מדולגות; הבדיקות בלי דפדפן — ב-tests/r4-a11y-shell.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const C = require('./helpers/chrome-cdp');
const { shellMock, AUDIT } = require('./helpers/a11y-page');

const ROOT = path.join(__dirname, '..');
const BIN = C.find();
const SKIP = BIN ? false : 'אין דפדפן Chromium במחשב';
const fileUrl = (rel) => 'file://' + path.join(ROOT, rel).split(path.sep).join('/');
// מאפייני data-ss-* במודול (במחשב — display-preload.js, באנדרואיד — frame.js)
const setAttrs = (a) => `document.addEventListener('DOMContentLoaded', () => { for (const [k, v] of Object.entries(${JSON.stringify(a)})) document.documentElement.setAttribute(k, v); });`;
// בועות העזרה נטענות במודול מה-preload; כאן — אותו תג
const ADD_HELP = "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('script'); s.src = '/ss-help.js'; s.setAttribute('data-ss-help-loader', ''); document.head.appendChild(s); });";

let browser = null;
test.before(async () => { if (BIN) browser = await C.launch(BIN); });
test.after(async () => { if (browser) await browser.close(); });

async function open(url, opts) {
  const p = await C.page(browser.port, url, opts);
  await C.wait(500);
  return p;
}
async function audit(p, minTarget = 24) {
  return JSON.parse(await p.js(`JSON.stringify(window.__a11yAudit(document, { minTarget: ${minTarget} }))`));
}
function assertClean(r, where) {
  assert.deepEqual(r.unnamed, [], where + ': פקד בלי שם נגיש');
  assert.deepEqual(r.small, [], where + ': מטרת לחיצה קטנה מדי');
  assert.equal(r.hScroll, false, where + ': גלילה לרוחב');
  assert.deepEqual(r.imgs, [], where + ': תמונה בלי alt');
  assert.deepEqual(r.dupIds, [], where + ': מזהה כפול');
  assert.ok(r.count > 0, where + ': אין פקדים — המסך לא נטען');
}

test('דפדפן — המעטפת: רגיל, מצב פשוט וטקסט ענק — שמות, גודל מטרה, בלי גלילה לרוחב ובלי שגיאות', { skip: SKIP }, async () => {
  const cases = [
    ['רגיל', {}, 1280, 24],
    ['מצב פשוט', { simple: 'on' }, 1280, 44],
    ['פשוט, ענק וכפתורים גדולים', { simple: 'on', text: 'xxl', targets: 'large' }, 1024, 44],
    ['ניגודיות גבוהה וכהה', { contrast: 'high', theme: 'dark', font: 'readable', links: 'underline' }, 1280, 24],
  ];
  for (const [name, display, width, min] of cases) {
    const p = await open(fileUrl('shell/shell.html'), { initScript: shellMock({ display }) + AUDIT, width });
    try {
      assertClean(await audit(p, min), 'מעטפת / ' + name);
      assert.deepEqual(p.errors, [], name);
      const simple = await p.js('document.documentElement.getAttribute("data-ss-simple")');
      assert.equal(simple, display.simple === 'on' ? 'on' : 'off');
      // המשימות (תפריט "כמו ברכב") גלויות בכל מצב; המדדים — רק ברגיל
      const shown = await p.js('[".task", "#kpis", "#simpleSec"].map(s => { const e = document.querySelector(s); return !!e && e.getBoundingClientRect().height > 0; }).join(",")');
      assert.equal(shown, display.simple === 'on' ? 'true,false,true' : 'true,true,true', name);
    } finally { await p.close(); }
  }
});

test('דפדפן — המעטפת במקלדת בלבד: Tab ראשון = "♿ נגישות", Enter פותח, מתג מודיע בהודעה חיה, Esc מחזיר את המיקוד', { skip: SKIP }, async () => {
  const p = await open(fileUrl('shell/shell.html'), { initScript: shellMock({}) + AUDIT });
  try {
    await p.key('Tab');
    assert.equal(await p.js('document.activeElement.id'), 'a11yBtn');
    // מסגרת מיקוד גלויה
    assert.equal(await p.js('getComputedStyle(document.activeElement).outlineStyle'), 'solid');
    await p.key('Enter');
    await C.wait(100);
    assert.equal(await p.js('document.getElementById("a11yDlg").open'), true);
    assert.equal(await p.js('document.activeElement.getAttribute("data-a11y")'), 'simple', 'המיקוד על המתג הראשון');
    assertClean(await audit(p), 'חלון הנגישות');
    await p.key('Enter');
    await C.wait(300);
    assert.equal(await p.js('document.documentElement.getAttribute("data-ss-simple")'), 'on');
    assert.equal(await p.js('document.activeElement.getAttribute("aria-checked")'), 'true', 'המיקוד נשאר על המתג');
    assert.equal(await p.js('document.getElementById("a11yLive").textContent'), 'מצב פשוט: פועל');
    assert.equal(await p.js('window.__calls.saveDisplay.at(-1).simple'), 'on', 'נשמר מיד');
    await p.key('Escape');
    await C.wait(100);
    assert.equal(await p.js('document.getElementById("a11yDlg").open'), false);
    assert.equal(await p.js('document.activeElement.id'), 'a11yBtn', 'המיקוד חזר לכפתור');
    assert.equal(await p.js('document.querySelectorAll(".task").length > 0'), true, 'מסך הבית עבר למצב פשוט');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('דפדפן — משתמש קיים רואה פעם אחת "המסך התחדש": המיקוד על "הבנתי", Enter סוגר, והמצב הפשוט נשאר', { skip: SKIP }, async () => {
  const p = await open(fileUrl('shell/shell.html'), { initScript: shellMock({ display: { simple: 'on' }, asked: true, baseSeen: false }) + AUDIT });
  try {
    assert.equal(await p.js('document.getElementById("a11yAsk").open'), true);
    assert.equal(await p.js('document.activeElement.id'), 'a11yAskYes');
    assertClean(await audit(p), 'ההודעה החד-פעמית');
    await p.key('Enter');
    await C.wait(300);
    assert.equal(await p.js('document.getElementById("a11yAsk").open'), false);
    assert.equal(await p.js('document.documentElement.getAttribute("data-ss-simple") + "/" + document.documentElement.getAttribute("data-ss-text")'), 'on/md');
    assert.equal(await p.js('localStorage.getItem("suite.simpleBaseSeen")'), 'ok');
  } finally { await p.close(); }
});

test('דפדפן — ארגז הכלים והשמאות: 320 פיקסלים, מצב פשוט וטקסט ענק — בלי גלילה לרוחב, 44 פיקסלים לכל מטרה', { skip: SKIP }, async () => {
  for (const mod of ['tools', 'shamai']) {
    const srv = await C.serve(ROOT, mod);
    try {
      const cases = [
        ['רגיל', {}, 1280, 24],
        ['מסך צר', {}, 320, 24],
        ['פשוט וענק', { 'data-ss-simple': 'on', 'data-ss-text': 'xxl' }, 1024, 44],
        ['ניגודיות וכהה', { 'data-ss-contrast': 'high', 'data-ss-theme': 'dark' }, 1280, 24],
      ];
      for (const [name, attrs, width, min] of cases) {
        const p = await open(srv.url + '/index.html', { initScript: setAttrs(attrs) + AUDIT, width });
        try {
          await C.wait(300);
          assertClean(await audit(p, min), mod + ' / ' + name);
          assert.deepEqual(p.errors, [], mod + ' / ' + name);
        } finally { await p.close(); }
      }
    } finally { await srv.close(); }
  }
});

test('דפדפן — בועת "?" (data-ss-help) במודול: גלויה תמיד, גדולה במצב פשוט, Enter פותח, Esc סוגר ומחזיר את המיקוד', { skip: SKIP }, async () => {
  const srv = await C.serve(ROOT, 'tools');
  const addEl = "document.addEventListener('DOMContentLoaded', () => { const b = document.createElement('label'); b.id = 'hx'; b.textContent = 'סכום'; b.setAttribute('data-ss-help', 'הסכום בשקלים, בלי מע\"מ'); document.body.prepend(b); });";
  try {
    // ברגיל — הכפתור גלוי, 24 לפחות
    let p = await open(srv.url + '/index.html', { initScript: addEl + ADD_HELP + AUDIT });
    try {
      assert.equal(await p.js('!!document.querySelector(".ss-help-btn")'), true, 'נוסף כפתור');
      assert.ok(await p.js('document.querySelector(".ss-help-btn").getBoundingClientRect().height') >= 24, 'גלוי גם בלי מצב פשוט');
      assert.equal(await p.js('document.getElementById(document.querySelector(".ss-help-btn").getAttribute("aria-controls")).getBoundingClientRect().height'), 0, 'הבועה סגורה');
    } finally { await p.close(); }
    p = await open(srv.url + '/index.html', { initScript: setAttrs({ 'data-ss-simple': 'on' }) + addEl + ADD_HELP + AUDIT });
    try {
      const btn = 'document.querySelector(".ss-help-btn")';
      assert.equal(await p.js(`${btn}.getAttribute("aria-label")`), 'הסבר: סכום');
      assert.ok(await p.js(`${btn}.getBoundingClientRect().height`) >= 44);
      await p.js(`${btn}.focus(), 1`);
      await p.key('Enter');
      await C.wait(100);
      assert.equal(await p.js(`${btn}.getAttribute("aria-expanded")`), 'true');
      const tip = 'document.getElementById(document.querySelector(".ss-help-btn").getAttribute("aria-controls"))';
      assert.equal(await p.js(`${tip}.textContent`), 'הסכום בשקלים, בלי מע"מ');
      assert.ok(await p.js(`${tip}.getBoundingClientRect().height`) > 0, 'הבועה גלויה');
      assert.equal(await p.js('document.getElementById("hx").getAttribute("aria-describedby")'), await p.js(`${btn}.getAttribute("aria-controls")`));
      await p.key('Escape');
      await C.wait(100);
      assert.equal(await p.js(`${btn}.getAttribute("aria-expanded")`), 'false');
      assert.equal(await p.js(`document.activeElement === ${btn}`), true);
      assert.deepEqual(p.errors, []);
    } finally { await p.close(); }
  } finally { await srv.close(); }
});

test('דפדפן — מדריך המשתמש והצהרת הנגישות: בלי גלילה לרוחב ב-320, שמות לכל קישור', { skip: SKIP }, async () => {
  for (const f of ['shell/guide/index.html', 'docs/website/accessibility.html', 'deploy/site/public/accessibility.html']) {
    for (const width of [1280, 320]) {
      const p = await open(fileUrl(f), { initScript: AUDIT, width });
      try {
        const r = await audit(p);
        assert.deepEqual(r.unnamed, [], f);
        assert.equal(r.hScroll, false, f + ' ' + width);
        assert.deepEqual(r.imgs, [], f);
        assert.deepEqual(r.dupIds, [], f);
        assert.equal(await p.js('document.documentElement.lang + "/" + document.documentElement.dir'), 'he/rtl', f);
        assert.equal(await p.js('document.querySelectorAll("h1").length'), 1, f + ': כותרת ראשית אחת');
      } finally { await p.close(); }
    }
  }
});
