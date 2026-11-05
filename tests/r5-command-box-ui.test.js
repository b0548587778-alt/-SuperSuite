// "מה תרצה לעשות?" (סבב 5) — התיבה במסך הבית (shell.js ב-vm): אישור לפני כל פתיחה, "לא" לא עושה כלום,
// הצעות במקום שגיאה, סינון לפי הרשאה, נגישות (תווית, הסבר, אזור חי), דיבור רק דרך מערכת ההפעלה,
// ושאלת יארצייט במנוע הכללים. וגם: זיהוי הדיבור של הדפדפן (שולח קול לרשת) הוסר מהשמאות
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HTML = read('shell/shell.html');

function el(id) {
  const attrs = {};
  return {
    id, _l: {}, attrs, hidden: false, open: false, textContent: '', value: '', innerHTML: '', style: {}, dataset: {}, disabled: false,
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, toggle(c, on) { if (on === undefined ? !this.set.has(c) : on) this.set.add(c); else this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    focus() { el.focused = this; }, blur() {}, select() {},
    addEventListener(ev, fn) { this._l[ev] = fn; }, appendChild() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    showModal() { this.open = true; }, close() { this.open = false; },
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; },
  };
}
const flush = () => new Promise(r => setImmediate(r));

function loadShell({ access = null, android = false, admin = true } = {}) {
  const elements = {};
  const calls = { start: [], ask: [], open: [], backup: 0 };
  const shellAPI = {
    getCalendar: async () => ({ shabbatMode: false }), switchTo: async () => true, goHome: async () => {},
    open: async (id, view) => { calls.open.push([id, view]); return true; },
    isLoggedIn: async () => true, isAdmin: async () => admin, getBackupTarget: async () => '',
    onActive() {}, onCmd() {}, onActiveView() {}, getHomeSummary: async () => null,
    aiAsk: async (q) => { calls.ask.push(q); return { text: 'תשובה מהנתונים', engineLabel: 'כללי המערכת' }; },
    taskAccess: async () => access,
    startTask: async (id, prefill) => { calls.start.push([id, prefill]); return { ok: true }; },
    backupAll: async () => { calls.backup++; return { ok: false }; },
  };
  const document = {
    getElementById(id) { return (elements[id] ||= el(id)); },
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => el('x'),
    body: el('body'), documentElement: el('html'),
  };
  const context = { document, console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, Intl, Date, Math,
    matchMedia: () => ({ matches: false }), localStorage: { getItem: () => null, setItem() {} } };
  context.window = context; context.shellAPI = shellAPI; context.HTMLElement = function () {};
  if (android) context.__ssBuildInfo = { version: 'x' };
  vm.createContext(context);
  for (const f of ['shell/hebcal.js', 'shell/catalog.js', 'shell/display.js', 'shell/simple-mode.js', 'shell/tasks.js', 'shell/intents.js', 'shell/ss-dialog.js', 'shell/shell.js']) {
    vm.runInContext(read(f), context, { filename: f });
  }
  const $ = (id) => document.getElementById(id);
  const submit = async (q) => { $('askQ').value = q; await $('askForm').onsubmit({ preventDefault() {} }); await flush(); };
  // לחיצה בתוך התשובה: מחקים closest לפי מאפיין data
  const clickOut = async (attr, value = '') => {
    const target = { closest: (sel) => (sel === `[${attr}]` ? { dataset: { cmdOpt: value } } : null) };
    await $('askOut')._l.click({ target }); await flush();
  };
  return { $, calls, submit, clickOut, ctx: context };
}

test('נגישות: תווית גלויה, הסבר עם 3 דוגמאות (aria-describedby), תשובות באזור חי, "בצע" במילה, ומיקרופון עם שם', () => {
  assert.match(HTML, /<label for="askQ" class="ask-title" id="askTitle">מה תרצה לעשות\?<\/label>/);
  assert.match(HTML, /<form class="ask" id="askForm" aria-labelledby="askTitle"/);
  assert.match(HTML, /<input id="askQ"[^>]*aria-describedby="askHint"/);
  const hint = /<p class="ask-hint" id="askHint">([^<]+)<\/p>/.exec(HTML)[1];
  assert.equal((hint.match(/„/g) || []).length, 3, 'שלוש דוגמאות');
  assert.match(HTML, /id="askOut" role="status" aria-live="polite"/);
  assert.match(HTML, /<button type="submit" class="ask-go" id="askGo"[^>]*>.*<span class="ask-go-t">בצע<\/span><\/button>/);
  assert.match(HTML, /<button type="button" class="ask-mic" id="askMic" aria-label="לדבר במקום להקליד" aria-expanded="false" aria-controls="askVoice"/);
  // מסך צר / טקסט גדול: הכפתורים יורדים לשורה, השדה לא נמחץ
  assert.match(HTML, /\.ask\{flex-wrap:wrap\}/);
  assert.match(HTML, /\.ask input\{flex:1 1 12em\}/);
  // התיבה בראש מסך הבית — מוצגת גם במצב פשוט (לא ss-advanced)
  assert.doesNotMatch(/<form class="ask"[^>]*>/.exec(HTML)[0], /ss-advanced/);
  assert.ok(HTML.indexOf('id="askForm"') < HTML.indexOf('id="simpleSec"'));
});

test('בקשה ← אישור עם הפרטים שזוהו; שום דבר לא נפתח ולא נשמר לפני "כן"', async () => {
  const s = loadShell();
  await flush();
  await s.submit('תרשום תרומה ממשה כהן 500 שקל');
  const out = s.$('askOut').innerHTML;
  assert.match(out, /רישום תרומה/);
  assert.match(out, /<dt>שם<\/dt><dd>משה כהן<\/dd>/);
  assert.match(out, /<dt>סכום<\/dt><dd>₪500\.00<\/dd>/);
  assert.match(out, /שום דבר עוד לא נשמר/);
  assert.match(out, /data-cmd-yes>כן, לפתוח את הטופס</);
  assert.match(out, /data-cmd-no>לא, לתקן</);
  assert.deepEqual(s.calls.start, [], 'לא נפתח לפני אישור');
  assert.deepEqual(s.calls.ask, [], 'בקשה אינה שאלה לעוזר');
  // "לא" — סוגר ומחזיר לתיבה, בלי לפתוח
  await s.clickOut('data-cmd-no');
  assert.deepEqual(s.calls.start, []);
  assert.equal(s.$('askOut').hidden, true);
  // שוב, והפעם "כן" — נפתח בדיוק מה שהוצג
  await s.submit('תרשום תרומה ממשה כהן 500 שקל');
  await s.clickOut('data-cmd-yes');
  assert.deepEqual(JSON.parse(JSON.stringify(s.calls.start)), [['donation', { name: 'משה כהן', amount: '500' }]]);
  // "כן" שני (לחיצה כפולה) לא פותח שוב
  await s.clickOut('data-cmd-yes');
  assert.equal(s.calls.start.length, 1);
});

test('שאלה ← העוזר (shellCall ← ai:run); לא הובן ← עד 3 הצעות "התכוונת ל...?", בלי שגיאה', async () => {
  const s = loadShell();
  await flush();
  await s.submit('כמה נכנס החודש?');
  assert.deepEqual(s.calls.ask, ['כמה נכנס החודש?']);
  assert.match(s.$('askOut').innerHTML, /תשובה מהנתונים/);
  await s.submit('asdfgh');
  const out = s.$('askOut').innerHTML;
  assert.match(out, /התכוונת ל\.\.\.\?/);
  assert.doesNotMatch(out, /שגיאה|error/i);
  const n = (out.match(/data-cmd-opt=/g) || []).length;
  assert.ok(n >= 1 && n <= 3, String(n));
  // בחירה בהצעה של משימה ← שוב אישור (לא פתיחה ישירה)
  await s.clickOut('data-cmd-opt', '0');
  assert.match(s.$('askOut').innerHTML, /data-cmd-yes/);
  assert.deepEqual(s.calls.start, []);
  // דו-משמעות
  await s.submit('הלוואה למשה 1000');
  assert.match(s.$('askOut').innerHTML, /לתת הלוואה מהגמ&quot;ח/);
  assert.match(s.$('askOut').innerHTML, /לרשום החזר הלוואה/);
});

test('הרשאה: משימה שאינה מותרת למשתמש לא מוצעת ולא נפתחת; גיבוי — רק למנהל, ודרך חלון הסיסמה', async () => {
  const s = loadShell({ access: ['contact'] });
  await flush(); await flush();
  await s.submit('תרשום תרומה ממשה 500 שקל');
  assert.match(s.$('askOut').innerHTML, /אינה כלולה ברישיון או בהרשאה/);
  assert.doesNotMatch(s.$('askOut').innerHTML, /data-cmd-yes/);
  await s.submit('הלוואה למשה 1000');
  assert.doesNotMatch(s.$('askOut').innerHTML, /data-cmd-opt="0">לתת הלוואה/);
  assert.deepEqual(s.calls.start, []);
  const a = loadShell({ access: ['backup'] });
  await flush(); await flush();
  await a.submit('תגבה את הנתונים');
  assert.match(a.$('askOut').innerHTML, /data-cmd-yes>כן, לגבות</);
  assert.deepEqual(a.calls.start, [], 'גיבוי אינו טופס במודול');
});

test('דיבור: הכפתור מציג הוראות להכתבה של מערכת ההפעלה ומחזיר את המיקוד לתיבה; באנדרואיד — המיקרופון במקלדת', async () => {
  assert.match(HTML, /Win\+H/);
  assert.match(HTML, /סמל המיקרופון במקלדת/);
  const s = loadShell();
  await flush();
  s.$('askVoice').hidden = true;
  s.$('askMic').onclick();
  assert.equal(s.$('askVoice').hidden, false);
  assert.equal(s.$('askMic').getAttribute('aria-expanded'), 'true');
  assert.equal(el.focused, s.$('askQ'));
  const and = loadShell({ android: true });
  await flush();
  assert.equal(and.$('voiceWin').hidden, true);
  assert.equal(and.$('voiceAndroid').hidden, false);
});

test('אפס רשת: אין זיהוי דיבור של הדפדפן בשום קוד שנארז (שולח את הקול לשרת חיצוני)', () => {
  const skip = new Set(['node_modules', '.git', 'build', 'tests', 'dist', 'docs', '.claude']);
  const bad = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|html)$/.test(e.name) && /SpeechRecognition/.test(fs.readFileSync(p, 'utf8'))) bad.push(path.relative(ROOT, p));
    }
  };
  for (const d of ['shell', 'modules', 'android/web']) walk(path.join(ROOT, d));
  for (const f of ['main.js']) if (/SpeechRecognition/.test(read(f))) bad.push(f);
  assert.deepEqual(bad, []);
  assert.match(read('modules/shamai/src/misc.js'), /function setupVoiceInput\(\) \{\}/);
});

test('יארצייט: "מתי היארצייט של…" נענה מרשימת ההנצחות (שם, תאריך עברי ולועזי), תחום סגור — הודעה', () => {
  const R = require('../shell/ai/rules');
  const memorials = [
    { name: 'אברהם כהן', parentName: 'בן יצחק', date: '2026-11-20', hebrew: 'ט׳ כסלו', uncertain: false, daysLeft: 15 },
    { name: 'שרה לוי', parentName: '', date: '2026-11-06', hebrew: 'כ״ה חשון', uncertain: false, daysLeft: 1 },
  ];
  const ctx = { today: '2026-11-05', opened: { npo: true, acct: true }, memorials };
  assert.equal(R.detectDomain('מתי היארצייט של אברהם כהן?'), 'memorial');
  const a = R.runRules('מתי היארצייט של אברהם כהן?', ctx);
  assert.match(a.text, /היארצייט של אברהם כהן בן יצחק חל בט׳ כסלו \(20\.11\.2026\), בעוד 15 ימים/);
  assert.match(R.runRules('מתי היארצייט של שרה', ctx).text, /שרה לוי.*מחר/);
  assert.match(R.runRules('מתי היארצייט של משה?', ctx).text, /לא מצאתי[\s\S]*שרה לוי[\s\S]*אברהם כהן/);
  assert.match(R.runRules('מתי היארצייט של משה?', { ...ctx, opened: { npo: false } }).text, /רק כשתחום העמותה פתוח/);
  // „מי חייב לי כסף?” — חשבוניות פתוחות
  assert.equal(R.detectIntent('מי חייב לי כסף?'), 'unpaid');
  assert.equal(R.detectDomain('כמה תרמו השנה?'), 'npo');
  // ipc.js: רשימת ההנצחות נטענת רק לשאלת יארצייט, בלי טלפון ואיש קשר
  const ipc = read('modules/econ/ipc.js');
  assert.match(ipc, /memorials: domain === 'memorial'/);
  const block = /if \(opts\.memorials\) \{[\s\S]*?\n {6}\}/.exec(ipc)[0];
  assert.doesNotMatch(block, /contactPhone|contactName/);
});
