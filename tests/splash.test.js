// מסך הפתיחה (PLAN.md 7.2): לעולם לא נשאר תקוע, ונסגר לפני כל חלון הודעה
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Splash = require('../shell/splash');

const ROOT = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

function fakeWin() {
  return { destroyed: false, isDestroyed() { return this.destroyed; }, destroy() { this.destroyed = true; } };
}

test('מסך הפתיחה נסגר כשהחלון הראשי מוכן', () => {
  const w = fakeWin();
  const sp = Splash.createSplash({ open: () => w, setTimer: () => 1, clearTimer: () => {} });
  assert.equal(sp.isOpen(), true);
  sp.close();
  assert.equal(w.destroyed, true);
  assert.equal(sp.isOpen(), false);
  sp.close(); // סגירה כפולה — בלי שגיאה
});

test('מסך הפתיחה נסגר מעצמו גם אם הטעינה נכשלה ואף אחד לא סגר אותו', () => {
  const w = fakeWin();
  let fire = null, ms = 0;
  Splash.createSplash({ open: () => w, setTimer: (fn, t) => { fire = fn; ms = t; return 1; }, clearTimer: () => {} });
  assert.equal(ms, Splash.MAX_MS);
  assert.ok(Splash.MAX_MS <= 30 * 1000, 'לא יותר מחצי דקה');
  fire();
  assert.equal(w.destroyed, true);
});

test('כשל ביצירת מסך הפתיחה לא עוצר את העלייה', () => {
  const sp = Splash.createSplash({ open: () => { throw new Error('x'); }, setTimer: () => 1, clearTimer: () => {} });
  assert.equal(sp.isOpen(), false);
  sp.close();
});

test('סגירה מבטלת את הטיימר', () => {
  let cleared = 0;
  const sp = Splash.createSplash({ open: fakeWin, setTimer: () => 7, clearTimer: (t) => { if (t === 7) cleared++; } });
  sp.close();
  assert.equal(cleared, 1);
});

test('main.js: מסך הפתיחה נסגר עם טעינת המעטפת, לפני קוד השחזור ולפני הודעות שגיאה בעלייה', () => {
  assert.match(main, /if \(!smoke\) openSplash\(\);/);
  assert.match(main, /win\.webContents\.once\('did-finish-load', closeSplash\)/);
  assert.match(main, /win\.webContents\.once\('did-fail-load', closeSplash\)/);
  assert.match(main, /function promptRecoveryCode\(\{ message \}\) \{\s*closeSplash\(\);/);
  // כל חלון הודעה בזמן העלייה (לפני createWindow) — אחרי closeSplash
  const boot = main.slice(main.indexOf('app.whenReady()'), main.indexOf('  createWindow();\n') > 0 ? main.indexOf('  createWindow();\n') : main.indexOf('  createWindow();\r\n'));
  const idx = (re) => [...boot.matchAll(re)].map(m => m.index);
  for (const at of idx(/dialog\.show(MessageBox|ErrorBox)\(/g)) {
    const before = boot.slice(Math.max(0, at - 400), at);
    assert.match(before, /closeSplash\(\)/, 'חלון הודעה בלי סגירת מסך הפתיחה לפניו');
  }
  // חלונות ההודעה של העלייה עוברים ב-bootDialog — הוא סוגר את מסך הפתיחה בעצמו
  assert.match(main, /async function bootDialog\(opts\) \{\s*closeSplash\(\);/);
});

test('splash.html: בלי סקריפט, עם CSP, בעברית ובצבעי שפת העיצוב', () => {
  const html = fs.readFileSync(path.join(ROOT, 'shell', 'splash.html'), 'utf8');
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /dir="rtl"/);
  assert.match(html, /design-tokens\.css/);
  assert.doesNotMatch(html.replace(/rgba\([^)]*\)/g, ''), /#[0-9a-f]{3,8}\b/i);
});
