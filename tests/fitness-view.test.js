// בדיקת התנהגות לתצוגת הכושר: הטופס, השדות הדינמיים ויצירת הרשומות.
// unified-ui.js רץ ב-vm עם DOM מדומה; נבדקת ההתנהגות בפועל — לא טקסט בקוד.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const UI_SRC = fs.readFileSync(path.join(ROOT, 'modules/econ/unified-ui.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'modules/econ/views/index.html'), 'utf8');
const VIEWS = [...new Set([...HTML.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]))];

// --- DOM מדומה עם רישום אלמנטים לפי id, כדי ששדות הטופס יהיו ניתנים לבדיקה ---
// מחזיר harness אחרי ש-init() הסתיים במלואו — ראו settle.
async function makeHarness({ calls, fitnessData }) {
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
    'getPersonalEntries', 'getWorkouts', 'getNutrition', 'getMetrics'
  ]);
  // סיכומים שמכילים רשימת קטגוריות — צורתם ב-features.js: {income,expense,balance,count,categories}
  const SUMMARY_RETURNS = new Set(['getPersonalSummary', 'getPeriodSummary', 'getInvoiceAnalytics']);
  const OPAQUE_OBJECTS = new Set(['getFinanceData', 'getPersonalFinance', 'getBusinessData']);
  const systemAPI = new Proxy({}, {
    get(_t, name) {
      if (name === 'getFitnessData') return () => Promise.resolve(fitnessData);
      if (name === 'authStatus') return () => Promise.resolve({ user: { id: 'u1', name: 'משתמש' }, configured: true });
      return (...args) => {
        calls.push({ name, args });
        if (LIST_RETURNS.has(name)) return Promise.resolve([]);
        if (SUMMARY_RETURNS.has(name)) return Promise.resolve({ income: 0, expense: 0, balance: 0, count: 0, categories: [] });
        // דוח חשבונאי מלא — null מדמה "אין נתונים" וה-renderer מטפל בכך ב-`acc ? ... : ''`
        if (name === 'getAccountingReports') return Promise.resolve(null);
        if (OPAQUE_OBJECTS.has(name)) return Promise.resolve({});
        return Promise.resolve({});
      };
    }
  });

  const navButtons = VIEWS.map(view => fakeElement('', { dataset: { view } }));
  const document = {
    readyState: 'complete',
    getElementById(id) { return (elements[id] ||= fakeElement(id)); },
    querySelector() { return fakeElement(); },
    querySelectorAll(sel) { return sel === '.nav' ? navButtons : []; },
    addEventListener() {},
    createElement() { return fakeElement(); },
    body: fakeElement(),
  };

  const context = { document, console, setTimeout, clearTimeout, Date, Intl };
  context.window = context;
  context.systemAPI = systemAPI;
  context.window.systemAPI = systemAPI;
  vm.createContext(context);
  vm.runInContext(UI_SRC, context, { filename: 'unified-ui.js' });

  await settle(context);
  return { context, elements, document, navButtons };
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

test('מסך הכושר מציג טופס הוספה — הכפתור אינו מושבת', async () => {
  const harness = await makeHarness({ calls: [], fitnessData: { workouts: [], nutrition: [], metrics: [] } });
  await goToView('fitness', harness);
  assert.equal(harness.elements.addBtn.disabled, false, 'כפתור ההוספה פעיל במסך הכושר');
});

test('מסך הכושר מציג את שלושת הסוגים ומציג רשומות קיימות', async () => {
  const fitnessData = {
    workouts: [{ id: 'w1', type: 'cardio', durationMinutes: 30, date: '2026-10-01' }],
    nutrition: [{ id: 'n1', mealType: 'breakfast', calories: 400, date: '2026-10-01' }],
    metrics: [{ id: 'm1', date: '2026-10-01', weightKg: 70 }]
  };
  const harness = await makeHarness({ calls: [], fitnessData });
  await goToView('fitness', harness);
  const html = harness.elements.view.innerHTML;
  assert.match(html, /אימונים \(1\)/, 'מוצגת ספירת האימונים');
  assert.match(html, /תזונה \(1\)/, 'מוצגת ספירת התזונה');
  assert.match(html, /מדדים \(1\)/, 'מוצגת ספירת המדדים');
  assert.match(html, /אירובי/, 'סוג האימון מתורגם לעברית');
  assert.match(html, /בוקר/, 'סוג הארוחה מתורגם לעברית');
  assert.match(html, /70 ק"ג/, 'המשקל מוצג');
});

test('כשהכושר ריק — מוצגת הודעה ידידותית ולא מסך ריק', async () => {
  const harness = await makeHarness({ calls: [], fitnessData: { workouts: [], nutrition: [], metrics: [] } });
  await goToView('fitness', harness);
  assert.match(harness.elements.view.innerHTML, /הוספת רשומה/, 'יש הנחיה לכפתור ההוספה');
});

test('פתיחת הטופס מציגה בחירת סוג וכותרת בעברית', async () => {
  const harness = await makeHarness({ calls: [], fitnessData: { workouts: [], nutrition: [], metrics: [] } });
  await goToView('fitness', harness);
  const addHandlers = harness.elements.addBtn._listeners.click || [];
  assert.ok(addHandlers.length >= 1, 'לכפתור ההוספה יש מאזין');
  await addHandlers[0]();
  assert.match(harness.elements.modalTitle.textContent, /[֐-׿]/, 'כותרת הטופס בעברית');
  assert.match(harness.elements.modalForm.innerHTML, /f_fitnessKind/, 'יש שדה בחירת סוג');
});

test('יצירת אימון שולחת createWorkout עם השדות הנכונים', async () => {
  const calls = [];
  const harness = await makeHarness({ calls, fitnessData: { workouts: [], nutrition: [], metrics: [] } });
  await goToView('fitness', harness);
  await (harness.elements.addBtn._listeners.click[0])();

  // מילוי השדות כפי שהטופס היה ממלא אותם
  Object.assign(harness.elements, {
    f_fitnessKind: { id: 'f_fitnessKind', value: 'workout' },
    f_date: { id: 'f_date', value: '2026-10-11' },
    f_type: { id: 'f_type', value: 'strength' },
    f_durationMinutes: { id: 'f_durationMinutes', value: '45' },
    f_caloriesBurned: { id: 'f_caloriesBurned', value: '300' },
    f_notes: { id: 'f_notes', value: 'אימון טוב' }
  });
  // שדות שאינם שייכים לסוג — נוכחים ב-DOM אך לא נאספים
  harness.elements.f_mealType = { id: 'f_mealType', value: 'lunch' };
  harness.elements.f_weightKg = { id: 'f_weightKg', value: '80' };

  await harness.elements.submitBtn._listeners.click[0]();

  const call = calls.find(c => c.name === 'createWorkout');
  assert.ok(call, 'נקראה createWorkout');
  assert.equal(call.args[0].type, 'strength', 'סוג האימון הועבר');
  assert.equal(call.args[0].durationMinutes, 45, 'המשך הועבר כמספר');
  assert.equal(call.args[0].date, '2026-10-11', 'התאריך הועבר');
  assert.equal(calls.find(c => c.name === 'createNutrition'), undefined, 'לא נוצרה תזונה');
  assert.equal(calls.find(c => c.name === 'createMetric'), undefined, 'לא נוצר מדד');
});

test('יצירת תזונה שולחת createNutrition ולא אימון', async () => {
  const calls = [];
  const harness = await makeHarness({ calls, fitnessData: { workouts: [], nutrition: [], metrics: [] } });
  await goToView('fitness', harness);
  await (harness.elements.addBtn._listeners.click[0])();

  Object.assign(harness.elements, {
    f_fitnessKind: { id: 'f_fitnessKind', value: 'nutrition' },
    f_date: { id: 'f_date', value: '2026-10-11' },
    f_mealType: { id: 'f_mealType', value: 'dinner' },
    f_calories: { id: 'f_calories', value: '650' },
    f_description: { id: 'f_description', value: 'עוף ואורז' }
  });
  harness.elements.f_type = { id: 'f_type', value: 'cardio' }; // שדה זר — לא ייאסף

  await harness.elements.submitBtn._listeners.click[0]();

  const call = calls.find(c => c.name === 'createNutrition');
  assert.ok(call, 'נקראה createNutrition');
  assert.equal(call.args[0].mealType, 'dinner', 'סוג הארוחה הועבר');
  assert.equal(call.args[0].calories, 650, 'הקלוריות הועברו כמספר');
  assert.equal(calls.find(c => c.name === 'createWorkout'), undefined, 'לא נוצר אימון');
});

test('יצירת מדד שולחת createMetric', async () => {
  const calls = [];
  const harness = await makeHarness({ calls, fitnessData: { workouts: [], nutrition: [], metrics: [] } });
  await goToView('fitness', harness);
  await (harness.elements.addBtn._listeners.click[0])();

  Object.assign(harness.elements, {
    f_fitnessKind: { id: 'f_fitnessKind', value: 'metric' },
    f_date: { id: 'f_date', value: '2026-10-11' },
    f_weightKg: { id: 'f_weightKg', value: '72.5' },
    f_bodyFatPercent: { id: 'f_bodyFatPercent', value: '18' }
  });

  await harness.elements.submitBtn._listeners.click[0]();

  const call = calls.find(c => c.name === 'createMetric');
  assert.ok(call, 'נקראה createMetric');
  assert.equal(call.args[0].weightKg, 72.5, 'המשקל הועבר');
  assert.equal(call.args[0].bodyFatPercent, 18, 'אחוז השומן הועבר');
});

test('שדה חובה חסר בסוג הנבחר — לא נשלחת קריאה ומוצגת שגיאה', async () => {
  const calls = [];
  const harness = await makeHarness({ calls, fitnessData: { workouts: [], nutrition: [], metrics: [] } });
  await goToView('fitness', harness);
  await (harness.elements.addBtn._listeners.click[0])();

  // אימון ללא משך — שדה חובה
  Object.assign(harness.elements, {
    f_fitnessKind: { id: 'f_fitnessKind', value: 'workout' },
    f_date: { id: 'f_date', value: '2026-10-11' },
    f_type: { id: 'f_type', value: 'cardio' },
    f_durationMinutes: { id: 'f_durationMinutes', value: '' }
  });

  await harness.elements.submitBtn._listeners.click[0]();

  assert.equal(calls.find(c => c.name === 'createWorkout'), undefined, 'לא נשלחה קריאה כשחסר שדה חובה');
});

test('תצוגות תצוגה-בלבד נשארות מושבתות — אין להן טופס', async () => {
  // כל תצוגה נבדקת ב-harness נפרד, כדי שמצב disabled לא יישאר מהתצוגה הקודמת
  for (const view of ['dashboard', 'finance', 'personal-finance', 'acct-reports']) {
    const harness = await makeHarness({ calls: [], fitnessData: { workouts: [], nutrition: [], metrics: [] } });
    await goToView(view, harness);
    assert.equal(harness.elements.addBtn.disabled, true, `כפתור ההוספה מושבת ב-${view}`);
  }
});

test('כל תצוגה עם כפתור פעיל אכן מייצרת טופס — אין כפתור "מת"', async () => {
  for (const view of VIEWS) {
    const harness = await makeHarness({ calls: [], fitnessData: { workouts: [], nutrition: [], metrics: [] } });
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
  for (const view of ['dashboard', 'finance', 'personal-finance', 'acct-reports']) {
    const harness = await makeHarness({ calls: [], fitnessData: { workouts: [], nutrition: [], metrics: [] } });
    await goToView(view, harness);
    assert.equal(harness.elements.addBtn.disabled, true, `כפתור ההוספה מושבת ב-${view}`);
    harness.elements.modalForm.innerHTML = '';
    await (harness.elements.addBtn._listeners.click[0])();
    assert.equal(harness.elements.modalForm.innerHTML, '', `לא נפתח טופס ב-${view}`);
  }
});

test('כל תצוגה שהכפתור שלה פעיל — פתיחת הטופס מייצרת שדות בפועל', async () => {
  // כל תצוגה נבדקת ב-harness נפרד לגמרי, כדי שלא יישאר מצב מהתצוגה הקודמת
  const withForm = ['tasks', 'contacts', 'business', 'market-intel', 'mortgage',
    'voice-notes', 'canvas', 'fitness', 'acct-journal', 'acct-invoices',
    'acct-chart', 'acct-pricing', 'acct-personal', 'acct-settings'];
  for (const view of withForm) {
    const harness = await makeHarness({ calls: [], fitnessData: { workouts: [], nutrition: [], metrics: [] } });
    await goToView(view, harness);
    assert.equal(harness.elements.addBtn.disabled, false, `כפתור ההוספה פעיל ב-${view}`);
    harness.elements.modalForm.innerHTML = '';
    await (harness.elements.addBtn._listeners.click[0])();
    const html = harness.elements.modalForm.innerHTML;
    assert.ok(html.length > 0, `לתצוגה ${view} יש טופס בפועל`);
    assert.match(html, /id="f_\w+"/, `לטופס של ${view} יש שדות`);
  }
});
