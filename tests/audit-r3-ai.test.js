// עוזר ה-AI — תיקונים מסקירת הקוד 2.11.2026 (docs/CODE-AUDIT-2026-11-02.md, "עוזר ה-AI"):
// „סעיף 46” במכתב, בדיקת העיגון (חלקי תאריך, מספרי חשבוניות, סכום של ישות אחרת), תשובה במסך הבית אחרי יציאה,
// שאלה בזמן התקנת מודל, הסתרת טלפון וכרטיס, כפתור אימות, 5 לקוחות חוזרים, ותשובה שמחזירה למסך העוזר.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const R = require(path.join(ROOT, 'shell/ai/rules'));
const T = require(path.join(ROOT, 'shell/ai/tools'));
const L = require(path.join(ROOT, 'shell/licensing/license'));
const MP = require(path.join(ROOT, 'shell/ai/model-pack'));
const { checkGrounded } = require(path.join(ROOT, 'shell/ai/grounding'));
const { redact } = require(path.join(ROOT, 'shell/ai/redact'));
const { createAI } = require(path.join(ROOT, 'shell/ai'));
const { createLocalEngine } = require(path.join(ROOT, 'shell/ai/engines/local-llm'));
const { createMockFork, fakeStore } = require('./helpers/mock-llm');

// stub של Electron, כמו ב-audit-ai.test.js
const handlers = {};
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_audit_r3_ai__.js' : origResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_audit_r3_ai__.js'] = { id: '/__electron_stub_audit_r3_ai__.js', filename: '/__electron_stub_audit_r3_ai__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) } } };
const ipc = require(path.join(ROOT, 'modules/econ/ipc'));
const ev = (id) => ({ sender: { id } });
ipc.setErrorLogger(() => {});

const LICENSED = { mode: 'licensed', status: 'active', features: ['ai', 'ai.local'] };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-audit-r3-ai-'));
let dirN = 0;
const newDir = () => path.join(TMP, 'd' + (++dirN));
const closeDb = () => { try { const db = ipc.getDb(); if (db && db.db) db.db.close(); } catch { /* כבר סגור */ } };
test.after(() => { closeDb(); fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 3 }); });

function aiWith(script, extra = {}) {
  const fork = createMockFork(script);
  const engine = createLocalEngine({ modelStore: fakeStore(), fork, hasRuntime: () => true });
  const ai = createAI({ userDataPath: newDir(), getBackupKey: () => null, licenseState: () => LICENSED, localEngine: engine, ...extra });
  return { ai, engine, fork };
}
const npoCtx = () => ({ today: '2026-10-22', opened: { npo: true }, npo: { year: '2026', donors: [{ name: 'משפחת גולדברג', count: 2, total: 3600 }] } });

test('מכתב AI עם „סעיף 46” — נדחה (אין לכלים נתוני זכאות), וההנחיה כבר לא מתירה אותו', async () => {
  const { ai, engine } = aiWith(() => ({ calls: [{ name: 'donor_record', args: { name: 'גולדברג' } }],
    answer: 'בס״ד\nתודה ל{{donor_record.matches.0.name}} על תרומה בסך {{donor_record.matches.0.total}}. התרומה מוכרת לפי סעיף 46.' }));
  await engine.refresh();
  const r = await ai.run('נסח מכתב תודה למשפחת גולדברג', npoCtx());
  assert.equal(r.engine, 'rules');
  assert.equal(r.fallback, 'ungrounded');
  assert.doesNotMatch(r.text, /46/);
  // אותו מכתב בלי סעיף 46 — עובר
  const ok = aiWith(() => ({ calls: [{ name: 'donor_record', args: { name: 'גולדברג' } }],
    answer: 'בס״ד\nתודה ל{{donor_record.matches.0.name}} על תרומה בסך {{donor_record.matches.0.total}}.' }));
  await ok.engine.refresh();
  assert.equal((await ok.ai.run('נסח מכתב תודה למשפחת גולדברג', npoCtx())).engine, 'local');
  const src = fs.readFileSync(path.join(ROOT, 'shell/ai/index.js'), 'utf8');
  assert.doesNotMatch(src.match(/const TASK_PROMPT = \{[\s\S]*?\n\};/)[0], /46/);
  ai.dispose(); ok.ai.dispose();
});

test('עיגון: חלקי תאריך אינם מספר מותר — „14 חשבוניות” כשיש 3 נדחה; התאריך השלם והשנה מותרים', () => {
  const tool = { count: 3, total: '₪5,000.00', top: [{ customer: 'ישיבת אור התורה', invoice: '1041', date: '2026-10-14', balance: '₪2,000.00' }] };
  const bad = checkGrounded('יש 14 חשבוניות פתוחות בסך ₪5,000.00', ['מי לא שילם?', '2026-10-22', tool], { evidence: [tool] });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.invented, ['14']);
  const day = checkGrounded('יש 22 חשבוניות בסך ₪5,000.00', ['מי לא שילם?', '2026-10-22', tool], { evidence: [tool] });
  assert.equal(day.ok, false, 'היום מתאריך היום אינו ספירה');
  assert.equal(checkGrounded('יש 3 חשבוניות פתוחות בסך ₪5,000.00 (נכון ל-2026-10-22, השנה 2026)', ['מי לא שילם?', '2026-10-22', tool], { evidence: [tool] }).ok, true);
  assert.equal(checkGrounded('החשבונית מ-14.10.2026 על ₪2,000.00', ['q', tool], { evidence: [tool] }).ok, true);
  assert.equal(checkGrounded('החשבונית מ-2026-10-14 על ₪2,000.00', ['q', tool], { evidence: [tool] }).ok, true);
});

test('עיגון: מספר חשבונית מותר רק כמספר מסמך, לא כספירה או סכום', () => {
  const tool = { count: 3, total: '₪5,000.00', top: [{ customer: 'ישיבת אור התורה', invoice: '1041', date: '2026-10-08', balance: '₪2,000.00' }] };
  assert.equal(checkGrounded('חשבונית 1041 של ישיבת אור התורה — ₪2,000.00', ['q', tool], { evidence: [tool] }).ok, true);
  assert.deepEqual(checkGrounded('חשבונית מס׳ 1041 פתוחה', ['q', tool], { evidence: [tool] }).invented, []);
  const bad = checkGrounded('יש 1041 חשבוניות פתוחות בסך ₪5,000.00', ['q', tool], { evidence: [tool] });
  assert.equal(bad.ok, false);
});

test('עיגון: סכום של תורם אחר ליד שם של תורם נדחה; הסכום שלו ושל הסיכום — מותרים', () => {
  const tool = { year: '2026', donations: 5, donors: 2, total: '₪1,400.00',
    top: [{ name: 'משפחת גולדברג', donations: 3, total: '₪500.00' }, { name: 'משפחת שטרן', donations: 2, total: '₪900.00' }] };
  const src = ['מי תרם השנה?', '2026-10-22', tool];
  assert.equal(checkGrounded('משפחת גולדברג תרמה השנה ₪900.00', src, { evidence: [tool] }).ok, false);
  assert.equal(checkGrounded('משפחת גולדברג תרמה השנה ₪500.00', src, { evidence: [tool] }).ok, true);
  assert.equal(checkGrounded('משפחת גולדברג תרמה ₪500.00, ומשפחת שטרן ₪900.00. בסך הכול ₪1,400.00', src, { evidence: [tool] }).ok, true);
  assert.equal(checkGrounded('• משפחת גולדברג — ₪500.00\n• משפחת שטרן — ₪900.00', src, { evidence: [tool] }).ok, true);
  assert.equal(checkGrounded('• משפחת גולדברג — ₪900.00\n• משפחת שטרן — ₪500.00', src, { evidence: [tool] }).ok, false);
});

test('שאלה בזמן התקנת מודל — לא נטען המודל (הישן); מצב „installing”, ותשובה מהכללים', async () => {
  const root = L.generateKeyPair();
  const src = fs.mkdtempSync(path.join(TMP, 'usb-'));
  const buf = Buffer.concat([Buffer.from('GGUF', 'latin1'), crypto.randomBytes(4092)]);
  const file = path.join(src, 'dictalm.gguf');
  fs.writeFileSync(file, buf);
  const manifest = MP.createModelManifest(root.privateJwk, { id: 'dictalm-3.0-1.7b-instruct-q4km', name: 'DictaLM', fileName: 'dictalm.gguf',
    sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length, license: 'Apache-2.0', quant: 'Q4_K_M', contextSize: 4096 });
  const { ai, engine, fork } = aiWith(() => ({ calls: [], answer: 'x' }), { rootKeys: [root.publicJwk] });
  await engine.refresh();
  assert.equal(ai.status().local.mode, 'ready');
  const installing = ai.model.install(manifest, file);
  assert.equal(ai.status().local.mode, 'installing');
  const r = await ai.run('נסח מכתב תודה למשפחת גולדברג', npoCtx());
  assert.equal(r.engine, 'rules');
  assert.equal(fork.forks.length, 0, 'המודל לא נטען בזמן ההתקנה');
  await installing;
  assert.notEqual(ai.status().local.mode, 'installing');
  ai.dispose();
});

test('מנוע מקומי: טעינה שהתחילה לפני עצירה (התקנה) לא טוענת את המודל אחריה', async () => {
  let release;
  const store = { current: () => new Promise((r) => { release = () => r(fakeStore().current()); }) };
  const fork = createMockFork(() => ({ calls: [], answer: 'x' }));
  const engine = createLocalEngine({ modelStore: store, fork, hasRuntime: () => true });
  const loading = engine.ensureLoaded();
  engine.stop();
  release();
  await assert.rejects(loading);
  await new Promise((r) => setImmediate(r));
  assert.equal(fork.forks.length, 0);
  assert.equal(engine.status().error, null, 'לא נרשמת שגיאת טעינה');
});

test('הסתרת מזהים: טלפונים בפורמטים נפוצים ומספרי כרטיס בקבוצות', () => {
  for (const t of ['077-1234567', '072 123 4567', '(02) 123-4567', '050-123-45-67', '050.123.4567', '+972-50-123-4567', '+972 3 123 4567', '08-9123456']) {
    const r = redact(`טלפון ${t} בבקשה`);
    assert.equal(r.text, 'טלפון [טלפון] בבקשה', t);
  }
  for (const t of ['4580 1234 5678 9012', '4580-1234-5678-9012', '3782 822463 10005', '6011 1234 5678 9012 345', '4580 1234 5678 9']) {
    const r = redact(`כרטיס ${t} תוקף`);
    assert.equal(r.text, 'כרטיס [כרטיס] תוקף', t);
    assert.equal(r.hits.card, 1);
  }
  // סכומים, תאריכים ושנים — נשארים
  for (const t of ['₪12,345,678.90', '2026-10-14', 'חשבונית מתאריך 2026.10.05', 'שנת 2026 ו-2027', '1,234.50', 'מספר 012-345-6789']) assert.equal(redact(t).text, t, t);
});

test('לקוחות חוזרים: כולם נספרים, 5 מוצגים ו„ועוד N”', () => {
  const repeat = Array.from({ length: 7 }, (_, i) => ({ customer: 'לקוח ' + (i + 1), count: 3, total: 100 }));
  const ctx = { today: '2026-10-22', opened: { acct: true }, analytics: { customers: 20, repeatShare: 0.35, repeatCustomers: repeat } };
  const a = R.runRules('מי הלקוחות החוזרים?', ctx);
  assert.match(a.text, /יש 7 לקוחות חוזרים/);
  assert.match(a.text, /ועוד 2 לקוחות חוזרים/);
  assert.ok(a.text.includes('לקוח 5') && !a.text.includes('לקוח 6'));
  assert.equal(a.data.repeatCount, 7);
  assert.equal(T.callTool('repeat_customers', {}, ctx).repeatCount, 7);
});

// ממשק העוזר (ui/ai.js) ב-vm
function loadAiUi(extra = {}) {
  const ctx = vm.createContext({ console, Date, String, Object, Promise, Number, esc: (v) => String(v ?? ''),
    state: { viewSeq: 1, currentView: 'ai' }, ...extra });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'modules/econ/ui/ai.js'), 'utf8') +
    '\n;globalThis.__ai = { renderAiModelCard, attachAiHandlers, aiUi };', ctx);
  ctx.window = ctx;
  return ctx;
}
function fakeEl(extra = {}) {
  const listeners = {};
  return Object.assign({ value: '', textContent: '', dataset: {}, disabled: false, addEventListener(e, fn) { (listeners[e] ||= []).push(fn); }, _l: listeners, focus() {} }, extra);
}

test('„קובץ המודל השתנה — נדרש אימות”: יש כפתור בדיקת תקינות', () => {
  const ctx = loadAiUi();
  const html = ctx.__ai.renderAiModelCard({ licensed: true, present: false, changed: true, mode: 'unavailable', error: 'קובץ המודל השתנה מאז ההתקנה — נדרש אימות' });
  assert.match(html, /id="aiModelVerify"/);
  assert.doesNotMatch(ctx.__ai.renderAiModelCard({ licensed: true, present: false, mode: 'unavailable' }), /aiModelVerify/);
  assert.match(ctx.__ai.renderAiModelCard({ licensed: true, present: true, mode: 'installing' }), /התקנה או הסרה מתבצעת/);
});

test('תשובה שהגיעה אחרי מעבר למסך אחר — לא מחזירה למסך העוזר', async () => {
  let answer;
  const switched = [];
  const ctx = loadAiUi({ switchView: (v) => switched.push(v), showError: () => {}, errMsg: (e) => String(e) });
  ctx.systemAPI = { aiRun: () => new Promise((r) => { answer = r; }) };
  const root = fakeEl({ querySelectorAll: () => [] });
  root.btn = fakeEl(); root.box = fakeEl({ value: 'מי לא שילם?' });
  root.querySelector = (s) => (s === '#aiAsk' ? root.btn : s === '#aiQuestion' ? root.box : null);
  ctx.__ai.attachAiHandlers(root);
  const pending = root.btn._l.click[0]();
  // המשתמש עבר למסך החשבוניות (ופתח שם טופס)
  ctx.state.viewSeq = 2; ctx.state.currentView = 'acct-invoices';
  answer({ text: 'תשובה' });
  await pending;
  assert.deepEqual(switched, []);
  assert.equal(ctx.__ai.aiUi.answer.text, 'תשובה', 'התשובה נשמרה לחזרה לעוזר');
  // נשאר במסך — מתרענן
  ctx.state.viewSeq = 3; ctx.state.currentView = 'ai';
  const p2 = root.btn._l.click[0]();
  answer({ text: 'שנייה' });
  await p2;
  assert.deepEqual(switched, ['ai']);
});

test('סיום קישור Google אחרי מעבר למסך אחר — לא מחזיר להגדרות', async () => {
  let done;
  const switched = [];
  const ctx = vm.createContext({ console, Promise, String, state: { viewSeq: 5, currentView: 'settings' },
    showToast() {}, showError() {}, errMsg: String, switchView: async (v) => { switched.push(v); } });
  ctx.window = ctx;
  ctx.systemAPI = { googleLink: () => new Promise((r) => { done = r; }) };
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'modules/econ/ui/settings.js'), 'utf8') + '\n;globalThis.__g = googleLinkFlow;', ctx);
  const p = ctx.__g();
  ctx.state.viewSeq = 6; ctx.state.currentView = 'acct-invoices';
  done({ email: 'a@b.c' });
  await p;
  assert.deepEqual(switched, []);
});

// מסך הבית של המעטפת (shell.js) ב-vm — כמו ב-shell-ui.test.js
function loadShell(shellAPI) {
  const elements = {};
  const fakeElement = () => ({ hidden: false, focus() {}, textContent: '', value: '', innerHTML: '', style: {}, dataset: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, addEventListener() {}, appendChild() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, showModal() {}, close() {}, setAttribute() {} });
  const document = { getElementById: (id) => (elements[id] ||= fakeElement()), querySelector: () => fakeElement(), querySelectorAll: () => [],
    addEventListener() {}, createElement: () => fakeElement(), body: fakeElement() };
  const api = { getCalendar: async () => ({ shabbatMode: false }), switchTo: async () => true, onActive() {}, onCmd() {}, onActiveView() {}, ...shellAPI };
  const context = { document, console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, Intl, Date, Math,
    localStorage: { getItem: () => null, setItem() {} }, confirm: () => true, alert() {}, prompt: () => null };
  context.window = context; context.shellAPI = api; context.HTMLElement = function () {};
  vm.createContext(context);
  for (const f of ['hebcal.js', 'catalog.js', 'shell.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'shell', f), 'utf8'), context, { filename: f });
  return { elements, context };
}
const flush = () => new Promise((r) => setImmediate(r));

test('מסך הבית: בסוף פגישה התשובה נמחקת, ותשובה איטית שהגיעה אחרי היציאה לא מוצגת', async () => {
  let onSession, reply;
  const s = loadShell({ aiAsk: () => new Promise((r) => { reply = r; }), onSession: (cb) => { onSession = cb; }, getHomeSummary: async () => null });
  assert.equal(typeof onSession, 'function', 'המעטפת נרשמת לשינויי כניסה');
  const el = (id) => s.context.document.getElementById(id);
  const askForm = el('askForm'), askQ = el('askQ'), askOut = el('askOut');
  askQ.value = 'מי לא שילם?';
  askForm.onsubmit({ preventDefault() {} });
  reply({ text: 'משפחת לוי — ₪590', engineLabel: 'כללי המערכת' });
  await flush();
  assert.match(askOut.innerHTML, /משפחת לוי/);
  onSession(false);
  assert.equal(askOut.innerHTML, '');
  assert.equal(askOut.hidden, true);
  // שאלה שנשלחה לפני היציאה ונענתה אחריה
  onSession(true);
  askForm.onsubmit({ preventDefault() {} });
  onSession(false);
  reply({ text: 'משפחת כהן — ₪1,180', engineLabel: 'כללי המערכת' });
  await flush();
  assert.doesNotMatch(askOut.innerHTML, /משפחת כהן/);
});

test('ipc: תשובה שהושלמה אחרי סוף הפגישה לא נמסרת', async () => {
  closeDb();
  await ipc.initEcon(newDir(), { relayUrl: '' });
  await handlers['auth:setup'](ev(1), 'menahel', 'menahel-pass-long-1');
  await handlers['auth:login'](ev(1), 'menahel', 'menahel-pass-long-1');
  assert.ok((await handlers['ai:run'](ev(1), 'מי לא שילם?')).text);
  // היציאה נכנסת לתור אחרי שלב ההכנה של השאלה — לפני שהתשובה נמסרת
  const asked = handlers['ai:run'](ev(1), 'מי לא שילם?');
  const out = handlers['auth:logout'](ev(1));
  await assert.rejects(asked, /נדרשת כניסה/);
  await out;
});
