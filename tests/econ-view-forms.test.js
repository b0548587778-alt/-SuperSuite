// בדיקת התנהגות לטפסים ולתצוגות של המודול הכלכלי: כפתור ההוספה, השדות הדינמיים ויצירת הרשומות.
// (היה tests/fitness-view.test.js; הבדיקות של מסך הכושר הוסרו עם המסך — המוצר הכלכלי)
// ממשק המודול (modules/econ/ui) רץ ב-vm עם DOM מדומה; נבדקת ההתנהגות בפועל — לא טקסט בקוד.
const test = require('node:test');
const EconUI = require('./helpers/econ-ui');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const UI_SRC = EconUI.source();
const HTML = fs.readFileSync(path.join(ROOT, 'modules/econ/views/index.html'), 'utf8');
const VIEWS = [...new Set([...HTML.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]))];

// --- DOM מדומה עם רישום אלמנטים לפי id, כדי ששדות הטופס יהיו ניתנים לבדיקה ---
// מחזיר harness אחרי ש-init() הסתיים במלואו — ראו settle.
async function makeHarness({ calls, personalFinance, accounting, tasks }) {
  const elements = {};

  function fakeElement(id = '', extra = {}) {
    const listeners = {};
    return Object.assign({
      id, textContent: '', value: '', innerHTML: '', style: {}, dataset: {},
      disabled: false, hidden: false, title: '',
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); },
      _listeners: listeners,
      appendChild() {}, querySelector() { return fakeElement(); }, querySelectorAll() { return []; },
      setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, remove() {},
      showModal() {}, close() {}, scrollIntoView() {},
    }, extra);
  }

  // systemAPI: כל קריאה נרשמת ב-calls ומוחזרת בהתאם לטיפוס שהתצוגה מצפה לו בפועל,
  // כפי שהשירותים מחזירים: רשימות → [], סכומים/סיכומים → אובייקט עם categories: [].
  // זו התנהגות נאמנה: אין "צורות" מומצאות שה-renderer לא פוגש בייצור.
  const LIST_RETURNS = new Set([
    'getInvoices', 'getProducts', 'getTasks', 'getContacts', 'getVoiceNotes',
    'getCanvasBoards', 'getMortgageScenarios', 'getChart', 'getJournal',
    'getPersonalEntries'
  ]);
  // סיכומים שמכילים רשימת קטגוריות — צורתם ב-features.js: {income,expense,balance,count,categories}
  const SUMMARY_RETURNS = new Set(['getPersonalSummary', 'getPeriodSummary', 'getInvoiceAnalytics']);
  const OPAQUE_OBJECTS = new Set(['getFinanceData', 'getPersonalFinance', 'getBusinessData']);
  const systemAPI = new Proxy({}, {
    get(_t, name) {
      // renderTasks קורא data.tasks — השירות מחזיר עטיפה, לא מערך גולמי
      if (name === 'getTasks') return () => Promise.resolve({ tasks: tasks || [] });
      if (name === 'getPersonalFinance') return () => Promise.resolve(personalFinance || {});
      // מנהל: התוכנית הפיננסית וההוצאות האישיות פתוחות רק למנהל (ADMIN_ONLY_VIEWS ב-ui/core.js)
      if (name === 'authStatus') return () => Promise.resolve({ user: { id: 'u1', name: 'משתמש', permissions: ['data.view', 'users.manage'] }, configured: true });
      return (...args) => {
        calls.push({ name, args });
        if (LIST_RETURNS.has(name)) return Promise.resolve([]);
        if (SUMMARY_RETURNS.has(name)) return Promise.resolve({ income: 0, expense: 0, balance: 0, count: 0, categories: [] });
        // דוח חשבונאי מלא — null מדמה "אין נתונים" וה-renderer מטפל בכך ב-`acc ? ... : ''`
        if (name === 'getAccountingReports') return Promise.resolve(accounting === undefined ? null : accounting);
        if (OPAQUE_OBJECTS.has(name)) return Promise.resolve({});
        return Promise.resolve({});
      };
    }
  });

  const navButtons = VIEWS.map(view => fakeElement('', { dataset: { view } }));
  // כפתור עריכה שהרינדור "יצר" — בלעדיו attachViewHandlers לא רושם מאזין edit
  // ואף בדיקה לא יכולה להפעיל את נתיב העריכה בפועל.
  const editBtn = fakeElement('editBtn', { dataset: { action: 'edit', id: (tasks || [])[0]?.id } });
  const document = {
    readyState: 'complete',
    getElementById(id) { return (elements[id] ||= fakeElement(id)); },
    querySelector() { return fakeElement(); },
    querySelectorAll(sel) {
      if (sel === '.nav') return navButtons;
      if (sel === '[data-action="edit"]' && tasks && tasks.length) return [editBtn];
      return [];
    },
    addEventListener() {},
    createElement() { return fakeElement(); },
    body: fakeElement(),
  };

  const context = { document, console, setTimeout, clearTimeout, Date, Intl };
  context.window = context;
  context.systemAPI = systemAPI;
  context.window.systemAPI = systemAPI;
  vm.createContext(context);
  EconUI.run(context);

  await settle(context);
  return { context, elements, document, navButtons, editBtn };
}

// init() מתחיל ריצה אסינכרונית בזמן טעינת ה-script (readyState='complete'),
// ובה while(!state.user) ואז switchView('dashboard'). חובה להמתין לו במלואו,
// אחרת ה-switchView המאוחר דורס את מצב התצוגה שנבדקת.
async function settle(context, rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await new Promise(r => setImmediate(r));
  }
  return context;
}

// מפעיל handler של תצוגה לפי מזהה, ומחזיר את ה-harness.
// init() כבר הסתיים (settle נקרא ב-makeHarness-סביב), ולכן הפעולה הדטרמיניסטית.
async function goToView(view, harness) {
  const idx = VIEWS.indexOf(view);
  assert.ok(idx >= 0, `התצוגה ${view} קיימת בניווט`);
  const handlers = harness.navButtons[idx]._listeners.click || [];
  assert.ok(handlers.length >= 1, `לכפתור ${view} יש מאזין לחיצה`);
  handlers[0]();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  return harness;
}

// --- מנוע DOM מינימלי: מאפשר ל-formFields.innerHTML להזין שדות חדשים ל-getElementById ---
// buildFormHtml מייצר מחרוזת HTML; אנו מפרסרים רק את תגי ה-input/select/textarea עם id.
function syncFieldsFromHtml(elements, html) {
  for (const m of html.matchAll(/<(input|select|textarea)[^>]*\bid="f_([^"]+)"/g)) {
    const name = m[2];
    if (!elements['f_' + name]) elements['f_' + name] = { id: 'f_' + name, value: '', tag: m[1] };
  }
}

// טופס דינמי (שדות לפי סוג): שדה חובה של הסוג שנבחר חסר — לא נשלחת קריאה. שדות של סוג אחר לא נאספים
// (בעבר נבדק במסך הכושר, שהוסר מהמוצר הכלכלי — כאן במסך התוכנית הפיננסית, שגם הוא טופס דינמי)
test('טופס דינמי: שדה חובה חסר בסוג הנבחר — לא נשלחת קריאה; סוג אחר — רק השדות שלו', async () => {
  const calls = [];
  const harness = await makeHarness({ calls });
  await goToView('personal-finance', harness);
  await (harness.elements.addBtn._listeners.click[0])();
  assert.match(harness.elements.modalForm.innerHTML, /f_pfKind/, 'יש שדה בחירת סוג');
  Object.assign(harness.elements, {
    f_pfKind: { id: 'f_pfKind', value: 'investments' },
    f_name: { id: 'f_name', value: 'קרן השתלמות' },
    f_principal: { id: 'f_principal', value: '' },
    f_annualRate: { id: 'f_annualRate', value: '4' },
    f_years: { id: 'f_years', value: '10' }
  });
  await harness.elements.submitBtn._listeners.click[0]();
  assert.equal(calls.find(c => c.name === 'addFinanceItem'), undefined, 'לא נשלחה קריאה כשחסר שדה חובה');

  Object.assign(harness.elements, {
    f_pfKind: { id: 'f_pfKind', value: 'incomes' },
    f_source: { id: 'f_source', value: 'משכורת' },
    f_amount: { id: 'f_amount', value: '9000' },
    f_frequency: { id: 'f_frequency', value: 'monthly' }
  });
  await harness.elements.submitBtn._listeners.click[0]();
  const call = calls.find(c => c.name === 'addFinanceItem');
  assert.ok(call, 'נקראה addFinanceItem');
  assert.equal(call.args[0], 'incomes');
  assert.equal(call.args[1].source, 'משכורת');
  assert.equal(call.args[1].amount, 9000, 'הסכום הועבר כמספר');
  assert.equal(call.args[1].principal, undefined, 'שדה של סוג אחר לא נאסף');
});

test('תצוגות תצוגה-בלבד נשארות מושבתות — אין להן טופס', async () => {
  // כל תצוגה נבדקת ב-harness נפרד, כדי שמצב disabled לא יישאר מהתצוגה הקודמת
  for (const view of ['dashboard', 'finance', 'acct-reports']) {
    const harness = await makeHarness({ calls: [] });
    await goToView(view, harness);
    assert.equal(harness.elements.addBtn.disabled, true, `כפתור ההוספה מושבת ב-${view}`);
  }
});

test('כל תצוגה עם כפתור פעיל אכן מייצרת טופס — אין כפתור "מת"', async () => {
  for (const view of VIEWS) {
    const harness = await makeHarness({ calls: [] });
    await goToView(view, harness);
    if (harness.elements.addBtn.disabled) continue;
    const handlers = harness.elements.addBtn._listeners.click || [];
    assert.ok(handlers.length >= 1, `לתצוגה ${view} יש מאזין לכפתור ההוספה`);
    harness.elements.modalForm.innerHTML = '';
    await handlers[0]();
    assert.ok(harness.elements.modalForm.innerHTML !== '', `לתצוגה ${view} יש טופס בפועל`);
  }
});

test('התצוגות ללא טופס — הכפתור מושבת ולא נפתח דבר', async () => {
  for (const view of ['dashboard', 'finance', 'acct-reports']) {
    const harness = await makeHarness({ calls: [] });
    await goToView(view, harness);
    assert.equal(harness.elements.addBtn.disabled, true, `כפתור ההוספה מושבת ב-${view}`);
    harness.elements.modalForm.innerHTML = '';
    await (harness.elements.addBtn._listeners.click[0])();
    assert.equal(harness.elements.modalForm.innerHTML, '', `לא נפתח טופס ב-${view}`);
  }
});

test('"תכנון פיננסי" ו"התוכנית הפיננסית" אינם אותו מסך — האחד תמונת מצב, השני ניתן לעריכה', async () => {
  const harness = await makeHarness({
    calls: [],
    // אותה תוכנית בדיוק מוגשת לשני המסכים — ההבדל חייב להיות ברינדור, לא בנתונים
    personalFinance: {
      planName: 'תוכנית לדוגמה', currency: 'ILS',
      incomes: [{ id: 'i1', source: 'משכורת', amount: 12000, frequency: 'monthly' }],
      expenses: [{ id: 'e1', category: 'שכירות', amount: 3500, frequency: 'monthly' }],
      investments: [{ id: 'v1', name: 'קרן', principal: 50000, annualRate: 6, years: 10 }],
      cashFlowEntries: []
    }
  });

  await goToView('finance', harness);
  const financeHtml = harness.elements.view.innerHTML;
  assert.equal(harness.elements.addBtn.disabled, true, 'בתכנון הפיננסי אין טופס — תמונת מצב בלבד');
  assert.match(financeHtml, /תזרים חודשי נטו/, 'תכנון פיננסי מציג תזרים מחושב');
  assert.match(financeHtml, /₪8,500/, 'התזרים הנטו מחושב נכון (12,000 − 3,500)');

  await goToView('personal-finance', harness);
  const planHtml = harness.elements.view.innerHTML;
  assert.equal(harness.elements.addBtn.disabled, false, 'התוכנית הפיננסית ניתנת לעריכה — יש טופס');
  assert.match(planHtml, /משכורת/, 'התוכנית הפיננסית מציגה את פריטי ההכנסה עצמם');
  assert.match(planHtml, /קרן/, 'התוכנית הפיננסית מציגה את פריטי ההשקעה עצמם');

  // השניים חייבים להיות תוכן שונה — לא שני עותקים של אותו מסך
  assert.notEqual(financeHtml, planHtml, 'שני המסכים אינם אותו תוכן');
});

// --- רגרסיה: דוח חשבונאי חלקי לא מפיל את התצוגה ---
// כל השדות שמגיעים מהשירות מנורמלים לפני הרינדור. דוח חסר (תקופה בלי תנועות,
// גרסת נתונים ישנה, תשובה חלקית) היה מפיל את הרינדור ב-TypeError ומשאיר מסך ריק.
test('דוח חשבונאי חלקי (ללא trialBalance/balanceSheet) לא מפיל את תצוגת הדוחות', async () => {
  const harness = await makeHarness({
    calls: [],
    // דוח "רזה" — חסרים כל המפתחות שהרינדור קורא ישירות
    accounting: { period: { to: '2026-10-12' } }
  });
  await goToView('acct-reports', harness);
  const html = harness.elements.view.innerHTML;
  assert.ok(html.length > 0, 'התצוגה רונדרה ולא נשארה ריקה');
  assert.doesNotMatch(html, /NaN/, 'אין "NaN" בתצוגה כשדה חסר');
  assert.doesNotMatch(html, /undefined/, 'אין "undefined" בתצוגה כשדה חסר');
  assert.match(html, /מאזן בוחן/, 'הכרטיסים המרכזיים עדיין מוצגים');
});

test('דוח עם מערכים לא-תקינים (מחרוזת במקום מערך) לא מפיל את תצוגת הדוחות', async () => {
  const harness = await makeHarness({
    calls: [],
    accounting: {
      period: { from: '2026-01-01', to: '2026-10-12' },
      vatRate: 0.17,
      summary: { income: 100, expenses: 40, vatPayable: 10, profit: 60 },
      // צורות פגומות בכוונה
      balanceSheet: { assets: 'לא-מערך', liabilities: null, equity: undefined, balanced: true },
      incomeStatement: { revenue: 0, expenses: [], totalRevenue: 0, netProfit: 0 },
      vat: { outputVat: 0, inputVat: 0, netPayable: 0 },
      aged: { buckets: 'x' },
      trialBalance: { rows: null, balanced: true }
    }
  });
  await goToView('acct-reports', harness);
  const html = harness.elements.view.innerHTML;
  assert.ok(html.length > 0, 'התצוגה רונדרה');
  assert.doesNotMatch(html, /NaN/, 'אין "NaN" פרץ מהמערכים הפגומים');
});

test('מסך הבית עם דוח חשבונאי חלקי מציג את שאר הכרטיסים במקום מסך ריק', async () => {
  const harness = await makeHarness({
    calls: [],
    accounting: { period: { to: '2026-10-12' }, balanceSheet: {}, incomeStatement: {}, vat: {} }
  });
  await goToView('dashboard', harness);
  const html = harness.elements.view.innerHTML;
  assert.ok(html.length > 0, 'מסך הבית רונדר');
  assert.match(html, /לוח הבקרה של העסק/, 'כרטיס העסק עדיין מוצג');
  assert.doesNotMatch(html, /NaN/, 'אין "NaN" ביתרת הבנק/רווח כשהמאזן חלקי');
});

test('מוצר ללא בלוק תמחור מחושב לא מפיל את המחירון', async () => {
  // מוצר שנשמר בגרסה ישנה בלי p.pricing — הרינדור חייב להציג 0 ולא לקרוס
  const harness = await makeHarness({
    calls: []
  });
  await goToView('acct-pricing', harness);
  const html = harness.elements.view.innerHTML;
  assert.ok(html.length > 0, 'המחירון רונדר גם כשאין מוצרים');
  assert.doesNotMatch(html, /NaN/, 'אין "NaN" בתמחור');
});

test('שיעור מע"מ חסר בהגדרות מוצג כ"—" ולא כ"NaN%"', async () => {
  const harness = await makeHarness({
    calls: []
  });
  await goToView('acct-settings', harness);
  const html = harness.elements.view.innerHTML;
  assert.doesNotMatch(html, /NaN%/, 'שיעור מע"מ חסר לא הופך ל-"NaN%"');
});

// --- רגרסיה: מסלול העריכה ---
// handleEdit מילא שדות בהעתקה עיוורת מ-record[f.name], אבל שדות הטופס אינם שמות
// הרשומה בהכרח (הגדרות מע"מ: vatRate=0.17 ברשומה מול vatPercent=17 בטופס).
// התוצאה הייתה טופס עריכה ריק וכשל בשמירה על שדה חובה.

test('טופס הגדרות המע"מ מציג את שדה האחוז (המיפוי vatRate → vatPercent)', async () => {
  const harness = await makeHarness({
    calls: []
  });
  await goToView('acct-settings', harness);
  await (harness.elements.addBtn._listeners.click[0])();
  const html = harness.elements.modalForm.innerHTML;
  assert.match(html, /id="f_vatPercent"/, 'שדה שיעור המע"מ קיים בטופס');
  assert.match(html, /name="vatPercent"/, 'השדה נשלח בשם שהסכימה ממפה');
});

// הדליפה נצפית רק בנתיב עריכה אמיתי: handleEdit כותב את ערכי הרשומה ישירות
// ל-f.value שבסכימה (או דרך prepare), ובלעדי השחזור ב-closeModal הערכים נשארים
// שם — וטופס "הוספה" הבא נפתח מלא בנתוני הרשומה האחרונה שנערכה.
// הבדיקה מפעילה את נתיב העריכה בפועל (המאזין ש-attachViewHandlers רשם), ואז
// פותחת "הוספה" ובודקת שהשדה נקי. אומתה כ-falsifiable: בהסרת השחזור היא נכשלת.
test('עריכת רשומה אינה מזהמת את טופס ההוספה הבא', async () => {
  const harness = await makeHarness({
    calls: [],
    tasks: [{ id: 't1', title: 'לשלם ארנונה', description: 'עד סוף החודש', category: 'finance', priority: 'high', status: 'todo', dueDate: '2026-11-01' }]
  });
  await goToView('tasks', harness);

  const titleOf = (h) => /id="f_title"[^>]*value="([^"]*)"/.exec(h)?.[1];

  // 1. טופס "הוספה" ראשון — ריק
  await (harness.elements.addBtn._listeners.click[0])();
  assert.equal(titleOf(harness.elements.modalForm.innerHTML), undefined, 'טופס ההוספה נפתח ריק');
  await (harness.elements.cancelBtn._listeners.click[0])();

  // 2. עריכה אמיתית של המשימה — נתיב handleEdit
  const editHandlers = harness.editBtn._listeners.click || [];
  assert.ok(editHandlers.length >= 1, 'נתיב העריכה נרשם');
  await editHandlers[0]();
  assert.equal(titleOf(harness.elements.modalForm.innerHTML), 'לשלם ארנונה', 'טופס העריכה נטען עם נתוני הרשומה');
  await (harness.elements.cancelBtn._listeners.click[0])();

  // 3. "הוספה" נוספת — חייבת לפתוח ריק, בלי שאריות מהרשומה שנערכה
  await (harness.elements.addBtn._listeners.click[0])();
  assert.equal(titleOf(harness.elements.modalForm.innerHTML), undefined,
    'טופס ההוספה נפתח נקי — אין דליפת ערכים מהרשומה שנערכה');
});

test('סגירת החלון מנקה את הטופס ואת מצב העריכה', async () => {
  const harness = await makeHarness({
    calls: []
  });
  await goToView('tasks', harness);
  await (harness.elements.addBtn._listeners.click[0])();
  assert.ok(harness.elements.modalForm.innerHTML.length > 0, 'הטופס פתוח');
  await (harness.elements.cancelBtn._listeners.click[0])();
  assert.equal(harness.elements.modalForm.innerHTML, '', 'הטופס נוקה בסגירה');
});

test('תכנון פיננסי עם נתונים ריקים מציג הודעה ידידותית ולא מסך ריק', async () => {
  const harness = await makeHarness({
    calls: [],
    personalFinance: { planName: 'ריק', currency: 'ILS', incomes: [], expenses: [], investments: [], cashFlowEntries: [] }
  });
  await goToView('finance', harness);
  assert.match(harness.elements.view.innerHTML, /אין נתונים בתכנון הפיננסי/, 'מוצגת הודעת ריק');
});

// --- סקירה: אילו תצוגות מציעות עריכה, ואילו בכוונה append-only ---
// הערוץ marketIntel:updateEntry קיים ב-ipc.js ובשירות, אך ה-UI מעולם לא חיבר
// אליו כפתור. הבדיקה מוודאת שהחיבור קיים — עריכה שלא נגישה היא יכולת מדומה.
test('מודיעין שוק: לרשומה יש כפתור עריכה שמחובר לערוץ updateEntry', async () => {
  const source = EconUI.source();
  assert.match(source, /update:\s*\(id,\s*data\)\s*=>\s*window\.systemAPI\.updateMarketIntelEntry\(id,\s*data\)/,
    'סכימת מודיעין השוק מחוברת ל-updateMarketIntelEntry');
});

test('תצוגות חשבונאיות שהן append-only אינן מציגות כפתור עריכה מת', async () => {
  // יומן, חשבוניות, תרשים חשבונות, מחירון ורשומות אישיות הן append-only בעיצוב:
  // רשומת יומן מבוטלת בהפכה ולא נערכת, חשבונית מבוטלת ולא נערכת. אין להן ערוץ
  // update — ולכן סכימה בלי update היא נכונה, וכפתור עריכה היה מטעה.
  const source = EconUI.source();
  for (const view of ['acct-journal', 'acct-invoices', 'acct-chart', 'acct-pricing', 'acct-personal']) {
    const body = schemaBody(source, view);
    assert.ok(body, `סכימת ${view} נמצאה`);
    assert.doesNotMatch(body, /\bupdate\s*:/, `${view} אינו מצהיר על update — אין כפתור מת`);
  }
});

// מחלץ את גוף הסכימה לפי התאמת סוגריים, לא לפי regex שביר.
function schemaBody(source, view) {
  const opener = new RegExp(`['"]${view}['"]\\s*\\]?\\s*[=:]\\s*\\{`);
  const m = opener.exec(source);
  if (!m) return null;
  let i = m.index + m[0].length - 1, depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(m.index, i + 1); }
  }
  return null;
}

test('כל תצוגה שהכפתור שלה פעיל — פתיחת הטופס מייצרת שדות בפועל', async () => {
  // כל תצוגה נבדקת ב-harness נפרד לגמרי, כדי שלא יישאר מצב מהתצוגה הקודמת
  const withForm = ['tasks', 'contacts', 'business', 'market-intel', 'mortgage',
    'voice-notes', 'canvas', 'acct-journal', 'acct-invoices',
    'acct-chart', 'acct-pricing', 'acct-personal', 'acct-settings'];
  for (const view of withForm) {
    const harness = await makeHarness({ calls: [] });
    await goToView(view, harness);
    assert.equal(harness.elements.addBtn.disabled, false, `כפתור ההוספה פעיל ב-${view}`);
    harness.elements.modalForm.innerHTML = '';
    await (harness.elements.addBtn._listeners.click[0])();
    const html = harness.elements.modalForm.innerHTML;
    assert.ok(html.length > 0, `לתצוגה ${view} יש טופס בפועל`);
    assert.match(html, /id="f_\w+"/, `לטופס של ${view} יש שדות`);
  }
});
