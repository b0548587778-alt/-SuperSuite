// בדיקות התנהגות ל-shell/shell.js: הסקריפט רץ ב-vm עם DOM ו-shellAPI מדומים,
// ובודקים מה הוא עושה כשהמשתמש נכנס למודול הכלכלי (ולא את הטקסט של הקובץ).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'shell', 'shell.js'), 'utf8');
const CATALOG_SRC = fs.readFileSync(path.join(__dirname, '..', 'shell', 'catalog.js'), 'utf8');
const HEBCAL_SRC = fs.readFileSync(path.join(__dirname, '..', 'shell', 'hebcal.js'), 'utf8');

function fakeElement() {
  const l = {};
  return {
    _l: l, hidden: false, focus() {}, blur() {}, select() {},
    textContent: '', value: '', innerHTML: '', style: {}, dataset: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(ev, fn) { l[ev] = fn; }, appendChild() {}, querySelector() { return fakeElement(); },
    querySelectorAll() { return []; }, showModal() {}, close() {}, setAttribute() {},
  };
}

// שעון קבוע לבדיקה: Date שבו "עכשיו" הוא nowMs (רק בתוך ה-vm)
function fixedDate(nowMs) {
  return class extends Date {
    constructor(...a) { if (a.length) super(...a); else super(nowMs); }
    static now() { return nowMs; }
  };
}

// opts.now — "עכשיו" בתוך המעטפת (ברירת המחדל: השעון האמיתי)
function load(overrides = {}, opts = {}) {
  const elements = {};
  const listeners = { active: null, cmd: null, activeView: null };
  const calls = { getBackupTarget: 0, isLoggedIn: 0, open: [], overlay: [] };
  let loggedIn = false;
  let target = '/backups/east';
  const shellAPI = {
    // מצב שבת כבוי כברירת מחדל: בלי זה, בשבת וביום טוב (מצב שבת דלוק כברירת מחדל ב-hebcal) מסך המנוחה
    // מסתיר את המודול, והבדיקות שסופרות את setOverlay נכשלו לפי היום בשבוע. מצב שבת עצמו נבדק עם שעון קבוע
    getCalendar: async () => ({ shabbatMode: false }),
    switchTo: async () => true,
    backupAll: async () => ({ ok: false }),
    restoreAll: async () => ({ ok: false }),
    isLoggedIn: async () => { calls.isLoggedIn++; return loggedIn; },
    getBackupTarget: async () => { calls.getBackupTarget++; return target; },
    pickBackupTarget: async () => null,
    goHome: async () => {},
    open: async (id, view) => { calls.open.push([id, view]); return true; },
    setOverlay: async (on) => { calls.overlay.push(on); return true; },
    onActiveView: (cb) => { listeners.activeView = cb; },
    quit: async () => {},
    onActive: (cb) => { listeners.active = cb; },
    onCmd: (cb) => { listeners.cmd = cb; },
    ...overrides,
  };
  const document = {
    getElementById(id) { return (elements[id] ||= fakeElement()); },
    querySelector() { return fakeElement(); },
    querySelectorAll() { return []; },
    addEventListener() {},
    createElement() { return fakeElement(); },
    body: fakeElement(),
  };
  const context = { document, window: {}, console, confirm: () => true, alert() {}, prompt: () => null, setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval() {}, Intl, Date: opts.now == null ? Date : fixedDate(opts.now), Math,
    localStorage: { getItem: () => null, setItem() {} } };
  context.window = context;
  context.shellAPI = shellAPI;
  context.window.shellAPI = shellAPI;
  context.HTMLElement = function () {};
  vm.createContext(context);
  vm.runInContext(HEBCAL_SRC, context, { filename: 'hebcal.js' });
  vm.runInContext(CATALOG_SRC, context, { filename: 'catalog.js' });
  vm.runInContext(SRC, context, { filename: 'shell.js' });
  return {
    ctx: context, calls, elements,
    setLoggedIn(v) { loggedIn = v; },
    emitActive(id) { listeners.active && listeners.active(id); },
    emitCmd(cmd) { listeners.cmd && listeners.cmd(cmd); },
  };
}

const flush = () => new Promise(r => setImmediate(r));

test('יעד הגיבוי לא מבוקש לפני כניסה למודול הכלכלי', async () => {
  const s = load();
  s.emitActive('econ');
  await flush();
  assert.equal(s.calls.getBackupTarget, 0, 'לא מבקשים יעד בלי כניסה');
  assert.equal(s.calls.isLoggedIn, 1, 'בודקים בשקט אם יש כניסה');
});

test('אחרי כניסה, מעבר למודול הכלכלי מציג את יעד הגיבוי', async () => {
  const s = load();
  s.setLoggedIn(true);
  s.emitActive('econ');
  await flush();
  assert.equal(s.calls.getBackupTarget, 1);
  assert.equal(s.elements.tgInfo.textContent, 'גיבוי אוטומטי ליעד: /backups/east');
});

test('מעבר למודול אחר לא מפעיל את הרענון', async () => {
  const s = load();
  s.setLoggedIn(true);
  s.emitActive('shamai');
  await flush();
  assert.equal(s.calls.isLoggedIn, 0);
  assert.equal(s.calls.getBackupTarget, 0);
});

test('אחרי שהיעד הוצג פעם אחת, לא מבקשים אותו שוב', async () => {
  const s = load();
  s.setLoggedIn(true);
  s.emitActive('econ');
  await flush();
  s.emitActive('econ');
  await flush();
  assert.equal(s.calls.getBackupTarget, 1);
});

test('אם אין יעד מוגדר, מוצג טקסט ברירת המחדל', async () => {
  const s = load({ getBackupTarget: async () => '' });
  s.setLoggedIn(true);
  s.emitActive('econ');
  await flush();
  assert.equal(s.elements.tgInfo.textContent, 'גיבוי אוטומטי: תיקיית המסמכים');
});

test('לחיצה על פריט בסרגל פותחת את המודול והתצוגה המתאימים', () => {
  const s = load();
  s.elements.nav.onclick({ target: { closest: () => ({ dataset: { key: 'econ:acct-invoices' } }) } });
  assert.deepEqual(s.calls.open.at(-1), ['econ', 'acct-invoices']);
  s.elements.nav.onclick({ target: { closest: () => ({ dataset: { key: 'shamai' } }) } });
  assert.deepEqual(s.calls.open.at(-1), ['shamai', null]);
  s.elements.nav.onclick({ target: { closest: () => ({ dataset: { key: 'evil' } }) } });
  assert.equal(s.calls.open.length, 2, 'מפתח לא מוכר לא פותח דבר');
});

test('חיפוש מסנן את הסרגל לפי שם הפריט', () => {
  const s = load();
  s.elements.q.value = 'חשבוניות';
  s.elements.q._l.input();
  const html = s.elements.nav.innerHTML;
  assert.match(html, /data-key="econ:acct-invoices"/);
  assert.doesNotMatch(html, /data-key="trainer/);
  s.elements.q.value = 'אין-כזה-דבר';
  s.elements.q._l.input();
  assert.match(s.elements.nav.innerHTML, /לא נמצא/);
});

test('מסך הבית מציג את כל התחומים ואת כל הפריטים', () => {
  const s = load();
  const html = s.elements.groups.innerHTML;
  for (const it of s.ctx.SUITE_CATALOG.ITEMS) assert.ok(html.includes('data-key="' + it.key + '"'), it.key);
});

test('דיאלוג המדריך מסתיר את המודול הפעיל ומחזיר אותו בסגירה', () => {
  const s = load();
  s.emitCmd('help');
  assert.deepEqual(s.calls.overlay, [true]);
  s.elements.guideOk.onclick();
  assert.deepEqual(s.calls.overlay, [true, false]);
});

// בדיקת קוד 23.10.2026: הבדיקה שלמעלה נכשלה בכל שבת ויום טוב (שעון אמיתי + מצב שבת דלוק כברירת מחדל).
// שבת קודש, 24.10.2026 בצהריים לפי שעון ישראל — שעון קבוע, כך שהתוצאה לא תלויה ביום שבו רצות הבדיקות
const SHABBAT_NOON = Date.UTC(2026, 9, 24, 9, 0);
const WEEKDAY_NOON = Date.UTC(2026, 9, 21, 9, 0); // יום רביעי, י׳ בחשוון

test('בשבת, כשמצב שבת כבוי: דיאלוג המדריך מסתיר את המודול ומחזיר אותו — כמו ביום חול', async () => {
  const s = load({}, { now: SHABBAT_NOON });
  await flush();
  s.emitCmd('help');
  assert.deepEqual(s.calls.overlay, [true]);
  s.elements.guideOk.onclick();
  assert.deepEqual(s.calls.overlay, [true, false]);
});

test('בשבת, כשמצב שבת דלוק: מסך המנוחה מכסה את המודול, וסגירת דיאלוג לא מחזירה אותו', async () => {
  const s = load({ getCalendar: async () => ({ shabbatMode: true }) }, { now: SHABBAT_NOON });
  await flush();
  assert.deepEqual(s.calls.overlay, [true], 'מסך המנוחה');
  s.emitCmd('help');
  s.elements.guideOk.onclick();
  assert.deepEqual(s.calls.overlay, [true, true], 'המודול נשאר מוסתר');
});

test('ביום חול, כשמצב שבת דלוק: אין מסך מנוחה', async () => {
  const s = load({ getCalendar: async () => ({ shabbatMode: true }) }, { now: WEEKDAY_NOON });
  await flush();
  assert.deepEqual(s.calls.overlay, []);
});
