// הקטלוג האחיד (shell/catalog.js): כל תצוגה של המודול הכלכלי נגישה מהסרגל האחיד, ואין פריטים יתומים.
// בנוסף: ה-preload של המודול הכלכלי שומר בקשת ניווט שהגיעה לפני שהממשק נרשם.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const CAT = require(path.join(ROOT, 'shell/catalog'));
const HTML = fs.readFileSync(path.join(ROOT, 'modules/econ/views/index.html'), 'utf8');
const NAV_VIEWS = [...new Set([...HTML.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]))];

test('כל תצוגות המודול הכלכלי מופיעות בקטלוג, ולהפך', () => {
  assert.deepEqual([...CAT.ECON_VIEWS].sort(), [...NAV_VIEWS].sort());
});

test('מפתחות הקטלוג ייחודיים, וכל פריט שייך למודול מוכר', () => {
  const keys = CAT.ITEMS.map(it => it.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const it of CAT.ITEMS) {
    assert.ok(['econ', 'shamai', 'trainer', 'tools'].includes(it.mod), it.key);
    assert.ok(!it.view || it.mod === 'econ', 'תצוגה פנימית רק במודול הכלכלי: ' + it.key);
    assert.match(it.name, /[֐-׿]/, 'שם בעברית: ' + it.key);
  }
});

test('כל מודול נגיש מהקטלוג', () => {
  for (const mod of ['econ', 'shamai', 'trainer', 'tools']) {
    assert.ok(CAT.ITEMS.some(it => it.mod === mod), mod);
  }
});

function loadEconPreload() {
  const exposed = {};
  const listeners = {};
  const calls = [];
  const electron = {
    contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } },
    ipcRenderer: {
      invoke: (ch, ...args) => { calls.push([ch, ...args]); return Promise.resolve(true); },
      on: (ch, fn) => { listeners[ch] = fn; },
    },
  };
  const src = fs.readFileSync(path.join(ROOT, 'modules/econ/preload.js'), 'utf8');
  vm.runInNewContext(src, { require: () => electron, module: { exports: {} }, console });
  return { api: exposed.systemAPI, listeners, calls };
}

test('preload כלכלי: בקשת ניווט שהגיעה לפני הרישום נמסרת ברישום', () => {
  const { api, listeners } = loadEconPreload();
  listeners['econ:goto']({}, 'tasks');
  const got = [];
  api.onGoto(v => got.push(v));
  assert.deepEqual(got, ['tasks']);
  listeners['econ:goto']({}, 'contacts');
  assert.deepEqual(got, ['tasks', 'contacts']);
  listeners['econ:goto']({}, { evil: 1 });
  assert.deepEqual(got, ['tasks', 'contacts'], 'ערך שאינו מחרוזת נפסל');
});

test('preload כלכלי: דיווח התצוגה עובר בערוץ shell:econ-view', async () => {
  const { api, calls } = loadEconPreload();
  await api.reportView('tasks');
  assert.deepEqual(calls.at(-1), ['shell:econ-view', 'tasks']);
});

test('סנכרון אוטומטי: מסך חדש בסרגל הפנימי שלא נוסף לקטלוג מזוהה כ"נוספו לאחרונה"', () => {
  const html = '<button class="nav" data-view="dashboard">⌂ <span>לוח בקרה</span></button>' +
    '<button class="nav" data-view="new-screen">🌟 <span>מסך חדש לגמרי</span></button>' +
    '<button class="nav" data-view="new-screen">🌟 <span>כפול</span></button>';
  const extras = CAT.extrasFromHtml(html);
  assert.equal(extras.length, 1, 'מסך קיים וכפילות לא נספרים');
  assert.deepEqual([extras[0].key, extras[0].name, extras[0].icon, extras[0].group], ['econ:new-screen', 'מסך חדש לגמרי', '🌟', 'new']);
});

test('סנכרון אוטומטי: בסרגל הפנימי הנוכחי אין מסכים שחסרים בקטלוג', () => {
  assert.deepEqual(CAT.extrasFromHtml(HTML).map(x => x.view), []);
});

test('כל קובץ בדיקה בתיקיית tests רץ ב-npm test', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const files = fs.readdirSync(path.join(ROOT, 'tests')).filter(f => f.endsWith('.test.js'));
  const script = pkg.scripts.test;
  const covered = f => script.includes('tests/' + f) || /tests\/\*\.test\.js/.test(script);
  assert.deepEqual(files.filter(f => !covered(f)), [], 'קבצי בדיקה שלא רצים');
});
