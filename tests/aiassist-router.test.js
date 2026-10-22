// עוזר „שאל את התוכנה” — בחירת המנוע (shell/ai/router.js).
// הפונקציה טהורה: בלי Electron, בלי רשת ובלי מודל. הברירה בטוחה — ספק ← כללים.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const router = require(path.join(ROOT, 'shell/ai/router'));
const R = require(path.join(ROOT, 'shell/ai/rules'));

const cloudReady = { local: { mode: 'ready' }, cloud: { eligible: true, ready: true } };
const cloudOn = { engine: 'cloud-when-available', consent: { cloud: true } };

test('ברירת מחדל — מקומי בלבד, הסתרת מזהים, בלי הסכמה', () => {
  assert.deepEqual(router.normalizePrefs(null), { engine: 'local-only', conceal: true, consent: false });
  assert.deepEqual(router.normalizePrefs({ engine: 'משהו אחר', conceal: null }), { engine: 'local-only', conceal: true, consent: false });
  assert.equal(router.normalizePrefs({ consent: { cloud: 'yes' } }).consent, false, 'הסכמה רק עם true מפורש');
});

test('„מקומי בלבד” — גם עם רישיון ענן מוכן, לא בוחרים ענן', () => {
  assert.equal(router.choose({ task: 'ask', prefs: { engine: 'local-only', consent: { cloud: true } }, status: cloudReady }), 'local');
});

test('ענן ייבחר רק עם בחירת „ענן כשאפשר”, הסכמה, זכאות ומוכנות — כולם יחד', () => {
  assert.equal(router.choose({ task: 'ask', prefs: cloudOn, status: cloudReady }), 'cloud');
  // חסרה הסכמה
  assert.equal(router.choose({ task: 'ask', prefs: { engine: 'cloud-when-available', consent: { cloud: false } }, status: cloudReady }), 'local');
  // אין רישיון ענן
  assert.equal(router.choose({ task: 'ask', prefs: cloudOn, status: { local: { mode: 'ready' }, cloud: { eligible: false, ready: true } } }), 'local');
  // הספק לא מוכן — עדיין לא שולחים דבר לרשת
  assert.equal(router.choose({ task: 'ask', prefs: cloudOn, status: { local: { mode: 'ready' }, cloud: { eligible: true, ready: 'yes' } } }), 'local');
});

test('בלי מודל מקומי — נופלים למנוע הכללים, לא לענן', () => {
  assert.equal(router.choose({ task: 'ask', prefs: { engine: 'local-only' }, status: { local: { mode: 'unavailable' }, cloud: cloudReady.cloud } }), 'rules');
  assert.equal(router.choose({ task: 'ask', prefs: cloudOn, status: { local: { mode: 'unavailable' }, cloud: { eligible: true, ready: false } } }), 'rules');
  assert.equal(router.choose({ task: 'ask' }), 'rules', 'בלי מצב בכלל');
});

test('מצב מקומי „מצומצם” עדיין נחשב מקומי', () => {
  assert.equal(router.choose({ task: 'ask', prefs: {}, status: { local: { mode: 'degraded' } } }), 'local');
});

test('משימות הסבר וכללי תמיד במנוע הכללים — גם עם ענן מוכן', () => {
  assert.equal(router.choose({ task: 'explain', prefs: cloudOn, status: cloudReady }), 'rules');
  assert.equal(router.choose({ task: 'rules', prefs: cloudOn, status: cloudReady }), 'rules');
});

test('תוויות המנוע בעברית', () => {
  assert.equal(router.engineLabel('cloud'), 'ענן (בהסכמה)');
  assert.equal(router.engineLabel('local'), 'מקומי');
  assert.equal(router.engineLabel('rules'), 'כללי המערכת');
  assert.equal(router.engineLabel(undefined), 'כללי המערכת');
});

test('המנוע טהור — אין בו קריאת קובץ או רשת', () => {
  const src = fs.readFileSync(path.join(ROOT, 'shell/ai/router.js'), 'utf8');
  for (const word of ['require(', 'fetch(', 'XMLHttpRequest', 'http://', 'https://']) {
    assert.ok(!src.includes(word), 'router.js לא צריך להכיל: ' + word);
  }
});

test('קצה לקצה בלי רשת: בחירת ענן ← מנוע הכללים עונה בכל זאת', () => {
  const engine = router.choose({ task: 'ask', prefs: {}, status: { local: { mode: 'ready' } } });
  assert.equal(engine, 'local');
  // בשלב 1 אין מודל מקומי בפועל — השירות מחזיר תשובת כללים. כאן נבדק שהכלל זמין גם כשהוא הדרך היחידה
  const a = R.runRules('כמה גבייתי החודש?', { today: '2026-10-22', opened: { acct: false } });
  assert.match(a.text, /חשבונות/);
});
