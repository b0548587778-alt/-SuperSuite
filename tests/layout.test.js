// מיקום תצוגת המודול: בממשק Windows בעברית Electron מודד את x מהימין.
// באג: ב-Windows בעברית המודול כיסה את הסרגל ולא הייתה דרך לחזור למסך הבית.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { isRtlLocale, viewBounds } = require('../shell/layout');

test('זיהוי שפת ממשק מימין לשמאל', () => {
  for (const l of ['he', 'he-IL', 'iw', 'yi', 'ar', 'ar-SA', 'fa-IR', 'he_IL']) assert.equal(isRtlLocale(l), true, l);
  for (const l of ['en-US', 'en', 'ru', 'fr-FR', 'hu', '', null, undefined, 'xx-bad!']) assert.equal(isRtlLocale(l), false, String(l));
});

test('המודול לא מכסה את הסרגל: בממשק עברי x מוזז ברוחב הסרגל', () => {
  assert.deepEqual(viewBounds(1350, 681, 264, 'en-US'), { x: 0, y: 0, width: 1086, height: 681 });
  assert.deepEqual(viewBounds(1350, 681, 264, 'he'), { x: 264, y: 0, width: 1086, height: 681 });
  assert.equal(viewBounds(200, 100, 264, 'he').width, 0, 'חלון צר מהסרגל — רוחב אפס ולא שלילי');
});

test('main.js ממקם את התצוגות לפי שפת הממשק', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(src, /Layout\.viewBounds\(w, h, SIDEBAR, app\.getLocale\(\)\)/);
  assert.doesNotMatch(src, /\{ x: 0, y: 0, width: Math\.max\(0, w - SIDEBAR\)/);
});
