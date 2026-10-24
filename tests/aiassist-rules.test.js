// עוזר „שאל את התוכנה” — מנוע הכללים, מסכת המזהים וגזירת הטווח בממשק.
// מנוע הכללים טהור (בלי מסד ובלי רשת); כל שימוש בנתונים חייב להיחסם כשהתחום סגור (ctx.opened).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const R = require(path.join(ROOT, 'shell/ai/rules'));
const { redact } = require(path.join(ROOT, 'shell/ai/redact'));

const TODAY = '2026-10-22';

// הקשר פתוח לגמרי, בצורה שהשירותים מחזירים: סכומים בשקלים, יתרה בחשבונית.
// כמו getInvoices האמיתי: balance = הסכום פחות זיכויים — תשלום לא מקטין אותו, רק מעביר את status ל-'paid' (ממצא 45)
function fullCtx() {
  return {
    today: TODAY,
    opened: { acct: true, npo: true, shamai: true, trainer: true },
    summary: { income: 10000, expenses: 4000, balance: 6000, count: 2, categories: [] },
    invoices: [
      { number: 11, customer: 'משפחת כהן', total: 600, balance: 600, date: '2026-10-05', status: 'open' },
      { number: 12, customer: 'משפחת לוי', total: 500, balance: 500, date: '2026-10-09', status: 'paid' },
    ],
    npo: { year: 2026, donors: [{ name: 'משפחת כהן', count: 2, total: 400 }, { name: 'תורם בעילום שם', count: 1, total: 200 }] },
    shamai: { label: 'צמיד זהב 14 קראט', valueAg: 350000, confidence: 80, factors: [{ name: 'משקל', bp: 120 }], warnings: ['המחירים ממקור שהוזן ידנית'] },
    trainer: { alerts: [{ title: 'מנוי מסתיים', detail: 'דוד לוי — 3 ימים', tone: 'red' }], clients: 12 },
  };
}
const closedCtx = () => ({ today: TODAY, opened: { acct: false, npo: false, shamai: false, trainer: false } });
// שני סימנים בתשובה: שם של אדם מהנתונים, וסכום שלא היה מגיע מ„אין הרשאה”
const leaks = (text) => text.includes('כהן') || text.includes('לוי');

test('שאלה ריקה — מבקשים לכתוב שאלה', () => {
  assert.match(R.runRules('   ', fullCtx()).text, /כתבו שאלה/);
});

test('„מי לא שילם?” — רק היתרה הפתוחה, באגורות', () => {
  const a = R.runRules('מי לא שילם?', fullCtx());
  assert.equal(a.data.kind, 'unpaid');
  assert.equal(a.data.count, 1);
  assert.equal(a.data.totalAg, 60000);
  assert.ok(a.text.includes('משפחת כהן'));
  assert.ok(!a.text.includes('משפחת לוי'), 'חשבונית ששולמה אינה רשומה כפתוחה');
});

test('„כמה גבייתי החודש?” — הכנסות התקופה בתצוגה של שקלים', () => {
  const a = R.runRules('כמה גבייתי החודש?', fullCtx());
  assert.match(a.text, /10,000\.00/);
  assert.match(a.text, /אוקטובר 2026/);
});

test('כל תחומי הנתונים סגורים — התשובה מסבירה שאין הרשאה ואינה מחזירה נתונים', () => {
  for (const q of ['כמה גבייתי החודש?', 'מי לא שילם?', 'אילו תורמים תרמו השנה?', 'מה הערכת השווי האחרונה?', 'איזה מתאמנים דורשים תשומת לב?']) {
    const a = R.runRules(q, closedCtx());
    assert.equal(a.data, undefined, q);
    assert.match(a.text, /הרשאה|רישיון|פתוח/, q);
    assert.ok(!leaks(a.text), 'נתוני אדם לא דולפים: ' + q);
  }
});

test('תחום סגור לא מפריע לתחום פתוח — עמותה סגורה, חשבונאות פתוחה', () => {
  const ctx = fullCtx();
  ctx.opened.npo = false;
  assert.equal(R.runRules('אילו תורמים תרמו השנה?', ctx).data, undefined);
  assert.match(R.runRules('כמה גבייתי החודש?', ctx).text, /10,000\.00/);
});

test('עמותה פתוחה — סיכום תורמים, והשם שהוחלף בשרת נשמר כמו שהוא', () => {
  const a = R.runRules('אילו תורמים תרמו השנה?', fullCtx());
  assert.equal(a.data.kind, 'donors');
  assert.equal(a.data.count, 3);
  assert.equal(a.data.totalAg, 60000);
  assert.match(a.text, /₪600\.00/);
  assert.ok(a.text.includes('תורם בעילום שם'));
});

test('שמאות — ההערכה האחרונה עם הגורמים והאזהרות, כולל „אינה ייעוץ”', () => {
  const a = R.runRules('מה הערכת השווי האחרונה?', fullCtx());
  assert.equal(a.data.kind, 'shamai');
  assert.match(a.text, /3,500\.00/);
  assert.match(a.text, /\+1\.2%/);
  assert.match(a.text, /אינה ייעוץ מקצועי/);
});

test('אימונים — מונה את המתאמנים שדורשים טיפול', () => {
  const a = R.runRules('איזה מתאמנים דורשים תשומת לב?', fullCtx());
  assert.equal(a.data.kind, 'trainer');
  assert.equal(a.data.urgent, 1);
});

test('שמאות בלי הערכה בזיכרון — אומרים זאת בפשטות, בלי להמציא מספר', () => {
  const ctx = fullCtx();
  delete ctx.shamai;
  const a = R.runRules('מה הערכת השווי האחרונה?', ctx);
  assert.equal(a.data, undefined);
  assert.match(a.text, /תיק שמאות/);
});

test('„איך מוציאים חשבונית?” — מדריך, בלי נתוני המשתמש', () => {
  const a = R.runRules('איך מוציאים חשבונית?', fullCtx());
  assert.equal(a.data, undefined);
  assert.match(a.text, /מסך „חשבוניות”/);
  assert.ok(!leaks(a.text));
});

test('resolveRange — גבולות החודש הקודם, השנה שעברה ומתחילת השנה', () => {
  // הגבול כוללני — היום האחרון של ספטמבר, לא ה-1 באוקטובר (ממצא 47)
  assert.deepEqual(R.resolveRange('כמה גבייתי החודש שעבר', TODAY), { from: '2026-09-01', to: '2026-09-30', label: 'ספטמבר 2026' });
  assert.deepEqual(R.resolveRange('הכנסות אשתקד', TODAY), { from: '2025-01-01', to: '2025-12-31', label: 'שנת 2025' });
  assert.equal(R.resolveRange('הכנסות מתחילת השנה', TODAY).from, '2026-01-01');
  assert.equal(R.resolveRange('כמה גבייתי', TODAY).label, 'אוקטובר 2026');
});

test('redact — מסתיר דוא״ל, ת״ז, טלפון ונתיבים, ומחזיר ספירות בלבד', () => {
  const out = redact('ישראל israel@example.co.il, ת"ז 987.654.321, ת"ז 987 654 321, טלפון 050-1234567, קובץ C:\\Users\\bunim\\a.txt');
  assert.ok(!out.text.includes('israel@example.co.il'));
  assert.ok(!out.text.includes('987.654.321'));
  assert.ok(!out.text.includes('987 654 321'));
  assert.ok(!out.text.includes('987654321'));
  assert.ok(!out.text.includes('050-1234567'));
  assert.ok(!out.text.includes('bunim'));
  assert.equal(out.hits.email, 1);
  assert.equal(out.hits.id, 2);
  assert.equal(out.hits.phone, 1);
  assert.equal(out.hits.path, 1);
});

test('redact — תאריך וסכום באגורות אינם נחשבים לת״ז; 10 ספרות אינן ת״ז', () => {
  assert.equal(redact('חשבונית מתאריך 2026.10.05').hits.id, 0);
  assert.equal(redact('נשאר לשלם 123456789.').hits.id, 0, 'סכום עם נקודה בסוף משפט');
  assert.equal(redact('מספר 012-345-6789').hits.id, 0, '10 ספרות');
});

test('redact — מספר ארוך (חשבון בנק / אסמכתה) נכלל ב-hits.longNum, לא ב-id', () => {
  const out = redact('חשבון 12345678 ואסמכתה 1234567890');
  assert.equal(out.hits.longNum, 2);
  assert.equal(out.hits.id, 0, 'המספר הארוך לא נספר כת״ז');
  assert.ok(!out.text.includes('12345678'));
  assert.ok(!out.text.includes('1234567890'));
});

// --- הממשק: גזירת הטווח מהשאלה נעשית במחשב, לפי תאריך מקומי (לא UTC) ---
function loadAiUi() {
  const src = fs.readFileSync(path.join(ROOT, 'modules/econ/ui/ai.js'), 'utf8');
  const ctx = vm.createContext({ console, Date, String, Object });
  vm.runInContext(src + '\n;globalThis.__ai = { aiUiRange, AI_OPEN_IDS, aiUi, renderAi };', ctx, { filename: 'modules/econ/ui/ai.js' });
  return ctx.__ai;
}

test('rangeAgrees — רמז מהממשק מתקבל רק כשהוא מסכים עם השאלה', () => {
  const now = R.resolveRange('כמה גבייתי החודש?', TODAY);
  assert.equal(R.rangeAgrees({ from: '2026-10-01', to: TODAY, label: 'החודש' }, now), true, 'החודש הזה');
  const prev = R.resolveRange('כמה גבייתי החודש שעבר?', TODAY);
  // הממשק שולח את היום האחרון של החודש שעבר — אותו טווח בדיוק
  assert.equal(R.rangeAgrees({ from: '2026-09-01', to: '2026-09-30', label: 'החודש שעבר' }, prev), true);
  // „עד 1.10” כוללני — כבר כולל את ה-1 באוקטובר, ולכן אינו אותו טווח (ממצא 47)
  assert.equal(R.rangeAgrees({ from: '2026-09-01', to: '2026-10-01', label: 'החודש שעבר' }, prev), false);
  // שאלה על החודש, טווח אחר לגמרי מהממשק — השאלה קובעת
  assert.equal(R.rangeAgrees({ from: '2025-01-01', to: '2025-12-31', label: 'שנה' }, now), false);
  // שאלה על „החודש שעבר”, הממשק שלח את החודש הזה
  assert.equal(R.rangeAgrees({ from: '2026-10-01', to: TODAY, label: 'החודש' }, prev), false);
  // „N החודשים האחרונים” — חייב התאמה מדויקת
  const multi = R.resolveRange('כמה גבייתי 3 חודשים?', TODAY);
  assert.equal(R.rangeAgrees({ from: '2026-08-01', to: TODAY, label: 'x' }, multi), true);
  assert.equal(R.rangeAgrees({ from: '2026-10-01', to: TODAY, label: 'x' }, multi), false);
  // קלט פגום — לא מתקבל
  assert.equal(R.rangeAgrees({ from: '2026-13-01', to: TODAY }, now), false);
  assert.equal(R.rangeAgrees({ from: '', to: '' }, now), false);
  assert.equal(R.rangeAgrees(null, now), false);
});

test('aiUiRange — „החודש שעבר” הוא החודש הקלנדרי הקודם, וגבול הסיום כוללני (היום האחרון שלו)', () => {
  const ai = loadAiUi();
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  const r = ai.aiUiRange('כמה גבייתי החודש שעבר?');
  assert.equal(r.from, `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-01`);
  // inRange כוללני משני הקצוות — „עד 1 לחודש הזה” כלל גם את הכנסות ה-1 בחודש הזה (ממצא 47)
  assert.equal(r.to, `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`);
  assert.equal(ai.aiUiRange('כמה גבייתי'), null);
});

test('AI_OPEN_IDS — יעדים רק מהמסכים המוכרים לממשק, ואותם יעדים שהשרת מאשר', () => {
  const ai = loadAiUi();
  const titles = econViewTitles();
  const serverTargets = assertServerTargets();
  for (const [kind, view] of Object.entries(ai.AI_OPEN_IDS)) {
    // המסך נפתח בממשק הכלכלי, או מודול האימונים / השמאות (נפתחים ב-openModule, לא ב-switchView)
    const inShell = Object.prototype.hasOwnProperty.call(titles, view) || view === 'trainer' || view === 'shamai';
    assert.ok(inShell, `${kind} ← ${view}: מסך מוכר בממשק`);
    assert.ok(serverTargets.has(view), `${kind} ← ${view}: היעד מאושר ב-ai:open`);
  }
  assert.equal(ai.AI_OPEN_IDS.trainer, 'trainer');
  assert.equal(ai.AI_OPEN_IDS.shamai, 'shamai', 'הערכת השווי מתיק השמאות — פותחים את מודול השמאות');
  assert.equal(ai.AI_OPEN_IDS.donors, 'npo');
  assert.equal(ai.AI_OPEN_IDS.unpaid, 'acct-invoices');
});

// כותרות המסכים — טווח השמות של ui/*.js (הדפוס של tests/fitness-view.test.js)
function econViewTitles() {
  const src = fs.readFileSync(path.join(ROOT, 'modules/econ/ui/core.js'), 'utf8');
  const m = src.match(/const viewTitles = \{[\s\S]*?\n\};/);
  assert.ok(m, 'viewTitles נמצא ב-core.js');
  const ctx = vm.createContext({});
  vm.runInContext(m[0] + '\n;globalThis.__t = viewTitles;', ctx);
  return ctx.__t;
}

// רשימת היעדים בשרת — קבועה ומפורשת, בלי ניווט חופשי
function assertServerTargets() {
  const src = fs.readFileSync(path.join(ROOT, 'modules/econ/ipc.js'), 'utf8');
  const m = src.match(/const AI_VIEW_TARGETS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, 'AI_VIEW_TARGETS נמצא ב-ipc.js');
  return new Set(m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean));
}

// --- מסך „שאל את התוכנה” שנפתח בפועל: הכפתור „שאל” חייב להיות מחובר, אחרת המסך ריק מפעולה ---
// הטקסט של renderAi לבדו לא מספיק — כאן בודקים שהלחיצה מגיעה ל-ai:run
test('renderAi + attachAiHandlers — הכפתור „שאל” קורא ל-aiRun עם הטווח שנגזר מהשאלה', async () => {
  const status = {
    engine: 'local', prefs: { conceal: true, engine: 'local-only' },
    cloud: { licensed: false, ready: false, consented: false },
    opened: { acct: true, npo: false, shamai: false, trainer: false },
  };
  const calls = [];
  const sampleButton = fakeEl({ dataset: { aiSample: 'מי לא שילם?' } });
  const view = fakeEl({
    querySelector(sel) {
      if (sel === '#aiAsk') return view.btn;
      if (sel === '#aiQuestion') return view.box;
      if (sel === '#aiExplain') return null;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '[data-ai-sample]') return [sampleButton];
      if (sel === '[data-ai-open]') return [];
      return [];
    },
  });
  view.btn = fakeEl({ textContent: 'שאל' });
  view.box = fakeEl({ value: 'כמה גבייתי החודש?' });
  const systemAPI = {
    aiRun: (q, extra) => { calls.push({ q, extra }); return Promise.resolve({ text: 'הכנסות', engine: 'rules', data: { kind: 'income' } }); },
  };
  // esc הוא עזר מהממשק (core.js) — כאן צדוד קטן שמסמן את מה שצריך להבריח
  const ctx = vm.createContext({ console, Date, String, Object, Promise, esc: (v) => String(v ?? '') });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'modules/econ/ui/ai.js'), 'utf8') +
    '\n;globalThis.__ai = { renderAi, attachAiHandlers, aiUi };', ctx, { filename: 'modules/econ/ui/ai.js' });
  const ai = ctx.__ai;

  const html = ai.renderAi({ status, samples: ['מי לא שילם?'] });
  assert.match(html, /id="aiAsk"/, 'כפתור השאלה קיים במסך');
  assert.match(html, /data-ai-sample=/, 'שאלות לדוגמה מוצגות');

  // הסביבה של הממשק: switchView ו-showError מגיעים מ-core.js; כאן רק רושמים אותם
  const switched = [];
  ctx.window = ctx;
  ctx.systemAPI = systemAPI;
  ctx.window.systemAPI = systemAPI;
  ctx.switchView = (v) => switched.push(v);
  ctx.showError = (m) => { throw new Error('לא אמור להופיע: ' + m); };
  // attachAiHandlers מוגדר בקובץ הזה, וקורא לפונקציות של הממשק — מפעילים בתוך אותו הקשר
  vm.runInContext('__attach = (root) => attachAiHandlers(root);', ctx);
  ctx.__attach(view);
  assert.equal(view.btn._listeners.click.length, 1, 'לכפתור „שאל” יש מאזין');

  await view.btn._listeners.click[0]();
  assert.equal(calls.length, 1, 'aiRun נקרא פעם אחת');
  assert.equal(calls[0].q, 'כמה גבייתי החודש?');
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].extra, 'range'), false, 'שאלה על „החודש” — בלי רמז טווח (הכללים גוזרים אותה)');
  assert.equal(ai.aiUi.answer.text, 'הכנסות', 'התשובה נשמרה להצגה');
  assert.deepEqual(switched, ['ai'], 'המסך מתרענן אחרי התשובה');
});

// אלמנט מדומה מינימלי — רק מה ש-attachAiHandlers נוגע בו
function fakeEl(extra = {}) {
  const listeners = {};
  return Object.assign({
    value: '', textContent: '', dataset: {}, disabled: false, hidden: true,
    addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); },
    _listeners: listeners,
    focus() {},
  }, extra);
}

// הכפתור „שאל” חייב להיות מחובר במסך ai — attachViewHandlers קורא ל-attachAiHandlers
test('attachViewHandlers — תצוגת ai מחברת את attachAiHandlers (גם הקריאה הזו בתוך הממשק)', async () => {
  // בלי הקריאה — המסך נפתח בלי שום מאזין, והלחיצה על „שאל” לא עושה דבר
  const calls = [];
  const root = fakeEl({});
  root.querySelector = (sel) => (sel === '#aiAsk' ? root.btn : sel === '#aiQuestion' ? root.box : null);
  root.querySelectorAll = () => [];
  root.btn = fakeEl({ textContent: 'שאל' });
  root.box = fakeEl({ value: 'מי לא שילם?' });
  const ctx = vm.createContext({
    console, Date, String, Object, Promise,
    esc: (v) => String(v ?? ''),
    showError: (m) => { throw new Error('לא אמור להופיע: ' + m); },
    showToast: () => {},
    errMsg: (e) => String(e && e.message ? e.message : e),
    viewTitles: { ai: 'שאל את התוכנה' },
    switchView: () => {},
    view: root,
    systemAPI: { aiRun: (q) => { calls.push(q); return Promise.resolve({ text: 'תשובה' }); } },
  });
  ctx.window = ctx;
  // אותה בקרה שיש ב-attachViewHandlers (forms.js) — שאר הענפים אינם נוגעים לתצוגת ai
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'modules/econ/ui/ai.js'), 'utf8') +
    "\n;globalThis.__attachView = (viewName) => { if (viewName === 'ai') attachAiHandlers(view); };", ctx, { filename: 'ai+forms' });
  ctx.__attachView('ai');
  assert.equal(root.btn._listeners.click.length, 1, 'המעבר לתצוגת ai חיבר את הכפתור');
  await root.btn._listeners.click[0]();
  assert.deepEqual(calls, ['מי לא שילם?'], 'הלחיצה הגיעה ל-ai:run');
});

test('כרטיס המודל המקומי — לפי הרישיון והמצב; התקנה, בדיקה והסרה מגיעות לערוצים', async () => {
  const ctx = vm.createContext({ console, Date, String, Object, Promise, Number, esc: (v) => String(v ?? '') });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'modules/econ/ui/ai.js'), 'utf8') +
    '\n;globalThis.__ai = { renderAiModelCard, aiModelSize };', ctx, { filename: 'modules/econ/ui/ai.js' });
  const ai = ctx.__ai;
  const locked = ai.renderAiModelCard({ licensed: false, present: false, mode: 'locked' });
  assert.match(locked, /לא כלול ברישיון/);
  assert.doesNotMatch(locked, /id="aiModelInstall"/, 'בלי רישיון — אין כפתור התקנה');
  const empty = ai.renderAiModelCard({ licensed: true, present: false, mode: 'unavailable' });
  assert.match(empty, /id="aiModelInstall"/);
  assert.doesNotMatch(empty, /id="aiModelRemove"/, 'אין מה להסיר');
  const ready = ai.renderAiModelCard({ licensed: true, present: true, mode: 'ready', model: { id: 'dicta', name: 'דיקטה', size: 1.2 * 1024 ** 3, quant: 'Q4_K_M', license: 'Apache-2.0' } });
  assert.match(ready, /דיקטה · Q4_K_M · 1\.2 GB/);
  assert.match(ready, /id="aiModelRemove"/);
  assert.equal(ai.aiModelSize(300 * 1024 ** 2), '300 MB');

  const els = {};
  const btn = () => ({ disabled: false, textContent: '', _l: [], addEventListener(ev, fn) { this._l.push(fn); } });
  for (const id of ['aiModelInstall', 'aiModelVerify', 'aiModelRemove']) els[id] = btn();
  const calls = [];
  ctx.window = ctx;
  ctx.systemAPI = {
    aiModelInstall: async () => { calls.push('install'); return { id: 'dicta', name: 'דיקטה' }; },
    aiModelVerify: async () => { calls.push('verify'); return { present: true }; },
    aiModelRemove: async () => { calls.push('remove'); return { present: false }; },
  };
  const toasts = [];
  ctx.showToast = (m) => toasts.push(m);
  ctx.showError = (m) => { throw new Error('לא אמור להופיע: ' + m); };
  ctx.switchView = () => {};
  let confirmAnswer = false;
  ctx.askConfirm = async () => confirmAnswer;
  vm.runInContext('__attachModel = (root) => attachAiModelHandlers(root);', ctx);
  ctx.__attachModel({ querySelector: (sel) => els[sel.slice(1)] || null });
  await els.aiModelInstall._l[0]();
  await els.aiModelVerify._l[0]();
  await els.aiModelRemove._l[0]();
  assert.deepEqual(calls, ['install', 'verify'], 'הסרה בלי אישור — לא נשלחת');
  confirmAnswer = true;
  await els.aiModelRemove._l[0]();
  assert.deepEqual(calls, ['install', 'verify', 'remove']);
  assert.equal(els.aiModelRemove.disabled, false, 'הכפתור חוזר לפעול');
  assert.ok(toasts.some(t => t.includes('דיקטה')));

  // שגיאה בהתקנה: ההודעה מוצגת, והתווית הזמנית חוזרת למקור
  const errors = [];
  ctx.showError = (m) => errors.push(m);
  ctx.errMsg = (e) => e.message;
  ctx.systemAPI.aiModelInstall = async () => { throw new Error('החתימה אינה תקינה'); };
  els.aiModelInstall.textContent = 'התקנת מודל מקובץ';
  await els.aiModelInstall._l[0]();
  assert.deepEqual(errors, ['החתימה אינה תקינה']);
  assert.equal(els.aiModelInstall.textContent, 'התקנת מודל מקובץ', 'לא נשאר „מתקין…”');
  assert.equal(els.aiModelInstall.disabled, false);

  // הכרטיס מתרענן גם אחרי שגיאה (המודל הקודם כבר נעצר בשרת), ולא אחרי ביטול
  const switched = [];
  ctx.switchView = (v) => switched.push(v);
  await els.aiModelInstall._l[0]();
  assert.deepEqual(switched, ['ai'], 'אחרי התקנה שנכשלה — רענון');
  ctx.systemAPI.aiModelInstall = async () => ({ canceled: true });
  await els.aiModelInstall._l[0]();
  confirmAnswer = false;
  await els.aiModelRemove._l[0]();
  assert.deepEqual(switched, ['ai'], 'ביטול בחלון הבחירה או באישור — בלי רענון');
});
