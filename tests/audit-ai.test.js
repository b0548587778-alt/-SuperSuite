// בדיקות רגרסיה — עוזר ה-AI (בדיקת קוד 23.10.2026, ממצאים 45–48 והנמוכים של העוזר).
// 45: „מי לא שילם?” — חשבונית ששולמה (status 'paid', היתרה לא קטנה בתשלום) לא נספרת.
// 46: „תרומות השנה” ומכתב התודה — רק התרומות של אותה שנה, לא סכום כל השנים.
// 47: „החודש שעבר” — עד היום האחרון שלו בלבד; ספירת החשבוניות לפי הטווח, לא לפי חודשים שלמים.
// 48: טקסט חופשי של המודל — רק עם קריאה מוצלחת לכלי וציטוט ממנה; מספרים במילים נדחים; שאלה כללית ← תשובה קבועה.
// נמוכים: כפתור „פתיחת המסך הרלוונטי”, מקור נתונים לשמאות ולאימונים, וניקוי ההקשר ביציאה.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const R = require(path.join(ROOT, 'shell/ai/rules'));
const T = require(path.join(ROOT, 'shell/ai/tools'));
const MC = require(path.join(ROOT, 'shell/ai/module-context'));
const { checkGrounded, numberWords } = require(path.join(ROOT, 'shell/ai/grounding'));
const { createAI } = require(path.join(ROOT, 'shell/ai'));
const { createLocalEngine } = require(path.join(ROOT, 'shell/ai/engines/local-llm'));
const { createMockFork, fakeStore } = require('./helpers/mock-llm');

// stub של Electron, כמו ב-aiassist-gate.test.js
const handlers = {};
const Module = require('module');
Module._resolveFilename_auditAi = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_audit_ai__.js' : Module._resolveFilename_auditAi.call(this, req, ...rest); };
require.cache['/__electron_stub_audit_ai__.js'] = { id: '/__electron_stub_audit_ai__.js', filename: '/__electron_stub_audit_ai__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) } } };
const ipc = require(path.join(ROOT, 'modules/econ/ipc'));
const ev = (id) => ({ sender: { id } });

const TODAY = '2026-10-22';
const LICENSED = { mode: 'licensed', status: 'active', features: ['ai', 'ai.local'] };

// תיקייה זמנית אחת לכל הקובץ — נמחקת בסוף (אחרי סגירת המסד, אחרת Windows לא נותן למחוק)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-audit-ai-'));
let dirN = 0;
const newDir = () => path.join(TMP, 'd' + (++dirN));
test.after(() => {
  closeDb();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 3 });
});

// תאריכים מקומיים — כמו localDay ב-ipc.js (לא toISOString)
const pad = (n) => String(n).padStart(2, '0');
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shiftDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); return dayOf(new Date(y, m - 1, d + n)); };
// חותמת זמן ב-10:00 מקומי של אותו יום (כמו completedAt של אימון שבוצע)
const atTen = (day) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, 10).getTime(); };

const closeDb = () => { try { const db = ipc.getDb(); if (db && db.db) db.db.close(); } catch { /* כבר סגור */ } };
// מקור שנכשל נרשם ביומן התקלות — כאן בלי פלט
const logged = [];
ipc.setErrorLogger((scope, e) => logged.push([scope, e && e.message]));

async function freshEcon(opts = {}) {
  closeDb(); // המסד הקודם נסגר — אחרת Windows לא נותן למחוק את התיקייה בסוף
  await ipc.initEcon(newDir(), { relayUrl: '', ...opts });
  await handlers['auth:setup'](ev(1), 'menahel', 'menahel-pass-long-1');
  await handlers['auth:login'](ev(1), 'menahel', 'menahel-pass-long-1');
  // בלי רשומות הדוגמה של מסד חדש — רק מה שהבדיקה יוצרת
  const data = await ipc.getDb().load();
  data.journal = []; data.invoices = []; data.salesDocs = [];
  await ipc.getDb().save(data);
}

// ================= 45 =================
test('45: „מי לא שילם?” — חשבונית ששולמה (balance לא קטן בתשלום) אינה פתוחה; כמו התרחיש בדוח', () => {
  const ctx = { today: TODAY, opened: { acct: true }, summary: { income: 0, expenses: 0 },
    invoices: [
      { number: 1, customer: 'משפחת כהן', total: 1180, balance: 1180, status: 'paid', date: '2026-10-02' },
      { number: 2, customer: 'משפחת לוי', total: 590, balance: 590, status: 'open', date: '2026-10-03' },
      { number: 3, customer: 'משפחת ברגר', total: 300, balance: 300, status: 'cancelled', date: '2026-10-04' },
      { number: 4, customer: 'משפחת גרין', total: 400, balance: 0, status: 'open', date: '2026-10-05' }, // זוכתה במלואה
    ] };
  const a = R.runRules('מי לא שילם?', ctx);
  assert.equal(a.data.count, 1);
  assert.equal(a.data.totalAg, 59000);
  assert.ok(!a.text.includes('משפחת כהן'), 'ששולמה — לא ברשימה');
  assert.ok(!a.text.includes('1,770'), 'לא הסכום של שתיהן');
  // אותה פונקציה — גם הכלי של המודל וגם הסיכום הכללי
  const tool = T.callTool('unpaid_invoices', {}, ctx);
  assert.equal(tool.count, 1);
  assert.equal(tool.total, R.nis(59000));
  assert.match(R.runRules('מה המצב?', ctx).text, /1 חשבוניות פתוחות/);
});

test('45: דרך ipc — חשבונית ששולמה ב-acct:recordPayment לא מופיעה ב„מי לא שילם?”', async () => {
  await freshEcon();
  const paid = await handlers['acct:createInvoice'](ev(1), { customer: 'משפחת כהן', items: [{ unitPrice: 1000 }] });
  await handlers['acct:createInvoice'](ev(1), { customer: 'משפחת לוי', items: [{ unitPrice: 500 }] });
  await handlers['acct:recordPayment'](ev(1), paid.id, {});
  const a = await handlers['ai:run'](ev(1), 'מי לא שילם?');
  assert.equal(a.data.count, 1);
  assert.equal(a.data.totalAg, 59000, '590 ₪ בלבד — לא 1,770');
  assert.ok(!a.text.includes('משפחת כהן'));
});

// ================= 46 =================
test('46: donor_record ו-donors_summary — השנה שבהקשר, והתשובה מציגה את אותה שנה', () => {
  const ctx = { today: TODAY, opened: { npo: true }, npo: { year: 2025, donors: [{ name: 'משפחת פרידמן', count: 1, total: 1000 }], names: ['משפחת פרידמן', 'משפחת גולד'] } };
  assert.equal(T.callTool('donor_record', { name: 'פרידמן' }, ctx).year, '2025');
  assert.equal(T.callTool('donors_summary', {}, ctx).year, '2025');
  assert.match(R.runRules('אילו תורמים תרמו שנה שעברה?', ctx).text, /בשנת 2025/);
  // חיפוש Ctrl+K — בכל השנים
  assert.deepEqual(T.callTool('search_records', { text: 'גולד' }, ctx).records.map(r => r.name), ['משפחת גולד']);
  assert.equal(R.donorYear('תרומות שנה שעברה', TODAY), 2025);
  assert.equal(R.donorYear('תרומות 2024', TODAY), 2024);
  assert.equal(R.donorYear('תרומות 2031', TODAY), 2026, 'שנה עתידית — השנה הנוכחית');
  assert.equal(R.donorYear('אילו תורמים תרמו השנה?', TODAY), 2026);
  // סקירה לממצא 46: סכום בצורת 20XX אינו שנה
  assert.equal(R.donorYear('מי תרם מעל 2000 שקל?', TODAY), 2026);
  assert.equal(R.donorYear('מי תרם יותר מ-2018 ש"ח?', TODAY), 2026);
  assert.equal(R.donorYear('תרומות של 2020 ₪ ומעלה', TODAY), 2026);
  assert.equal(R.donorYear('תרומות בסך 2019', TODAY), 2026);
  assert.equal(R.donorYear('תרומות בשנת 2024', TODAY), 2024);
  assert.equal(R.donorYear('תרומות ב-2023', TODAY), 2023);
  assert.equal(R.donorYear('תרומות בשנת 2005', TODAY), 2005, 'שנה מפורשת — גם ישנה');
  assert.equal(R.donorYear('תרומות 2000', TODAY), 2026, 'מספר בלי הקשר — רק ב-15 השנים האחרונות');
  assert.equal(R.donorYear('מי תרם מעל 2000 שקל בשנת 2025?', TODAY), 2025, 'הסכום מדולג, השנה נמצאת');
});

test('46 (סקירה): דרך ipc — „אילו תורמים תרמו מעל 2000 שקל?” שואלת על השנה הנוכחית, לא על שנת 2000', async () => {
  await freshEcon();
  const y = new Date().getFullYear();
  await handlers['npo:saveSettings'](ev(1), { orgName: 'עמותת חסד ואמת' });
  await handlers['npo:addDonation'](ev(1), { donorName: 'ר׳ אברהם פרידמן', amount: 2500, date: `${y}-01-01`, method: 'cash' });
  const a = await handlers['ai:run'](ev(1), 'אילו תורמים תרמו מעל 2000 שקל?');
  assert.equal(a.data.year, y);
  assert.equal(a.data.totalAg, 250000);
  assert.ok(!a.text.includes('בשנת 2000'));
});

test('46: דרך ipc — תורם שנתן בשנה שעברה ובשנה הזו: „השנה” = רק השנה, ו„שנה שעברה” = רק אז', async () => {
  await freshEcon();
  const y = new Date().getFullYear();
  await handlers['npo:saveSettings'](ev(1), { orgName: 'עמותת חסד ואמת' });
  await handlers['npo:addDonation'](ev(1), { donorName: 'ר׳ אברהם פרידמן', amount: 1000, date: `${y - 1}-06-15`, method: 'cash' });
  await handlers['npo:addDonation'](ev(1), { donorName: 'ר׳ אברהם פרידמן', amount: 180, date: `${y}-01-01`, method: 'cash' });
  const now = await handlers['ai:run'](ev(1), 'אילו תורמים תרמו השנה?');
  assert.equal(now.data.totalAg, 18000, 'רק 180 ₪ של השנה');
  assert.equal(now.data.year, y);
  assert.ok(!now.text.includes('1,180'), 'לא סכום שתי השנים');
  const last = await handlers['ai:run'](ev(1), 'אילו תורמים תרמו שנה שעברה?');
  assert.equal(last.data.totalAg, 100000);
  assert.equal(last.data.year, y - 1);
  // השירות עצמו: donors (כל השנים, למסך) ו-yearDonors (השנה בלבד)
  const ov = await handlers['npo:getOverview'](ev(1), y);
  assert.equal(ov.donors[0].total, 1180);
  assert.equal(ov.yearDonors[0].total, 180);
});

// ================= 47 =================
test('47: „החודש שעבר” — עד היום האחרון שלו, ו„12 חודשים” אינו „2 חודשים”', () => {
  assert.equal(R.resolveRange('כמה גבייתי החודש שעבר?', '2026-03-05').to, '2026-02-28');
  assert.equal(R.resolveRange('כמה גבייתי החודש שעבר?', '2024-03-05').to, '2024-02-29', 'שנה מעוברת');
  assert.deepEqual(R.resolveRange('הכנסות החודש הקודם', '2026-01-10'), { from: '2025-12-01', to: '2025-12-31', label: 'דצמבר 2025' });
  const y = R.resolveRange('הכנסות 12 חודשים', TODAY);
  assert.equal(y.label, '12 החודשים האחרונים');
  assert.equal(y.from, '2025-11-01');
});

test('47: מספר החשבוניות בתשובה — לפי תאריך החשבונית בתוך הטווח, לא כל החודש הנוכחי', () => {
  const ctx = { today: TODAY, opened: { acct: true }, summary: { income: 100, expenses: 0 },
    invoices: [
      { number: 1, date: '2026-09-10', status: 'open', balance: 1 },
      { number: 2, date: '2026-09-30', status: 'paid', balance: 1 },
      { number: 3, date: '2026-10-01', status: 'open', balance: 1 },
      { number: 4, date: '2026-10-05', status: 'open', balance: 1 },
      { number: 5, date: '2026-09-12', status: 'cancelled', balance: 1 },
    ],
    // הניתוח החודשי שהקוד הישן ספר ממנו — היה מחזיר 4 (ספטמבר + כל אוקטובר)
    analytics: { monthly: [{ month: '2026-09', count: 2 }, { month: '2026-10', count: 2 }] } };
  assert.match(R.runRules('כמה גבייתי החודש שעבר?', ctx).text, /הונפקו 2 חשבוניות/);
  assert.match(R.runRules('כמה גבייתי החודש?', ctx).text, /הונפקו 2 חשבוניות/);
});

test('47: דרך ipc — הכנסה ב-1 לחודש הנוכחי אינה נספרת בחודש שעבר, גם כשהממשק שולח את הגבול הישן', async () => {
  await freshEcon();
  const today = dayOf(new Date());
  const first = today.slice(0, 8) + '01';
  const prevLast = shiftDays(first, -1);
  const prevFirst = prevLast.slice(0, 8) + '01';
  for (const [amount, date] of [[100, first], [900, prevLast]]) {
    await handlers['acct:createEntry'](ev(1), { date, description: 'הכנסות',
      lines: [{ account: '1000', debit: amount, credit: 0 }, { account: '4000', debit: 0, credit: amount }] });
  }
  for (const to of [first, prevLast]) {
    const a = await handlers['ai:run'](ev(1), 'כמה גבייתי החודש שעבר?', { range: { from: prevFirst, to, label: 'החודש שעבר' } });
    assert.match(a.text, /₪900\.00/, 'גבול ' + to);
    assert.ok(!/₪1,000\.00/.test(a.text), 'ההכנסה של ה-1 בחודש הנוכחי לא נכללת (גבול ' + to + ')');
  }
});

// ================= 48 =================
test('48: checkGrounded — מספרים במילים נדחים; „שמאות” ו„חשבונית אחת” אינם מספרים', () => {
  assert.equal(checkGrounded('נכנסו כחמשת אלפים שקלים', []).ok, false);
  assert.equal(checkGrounded('בסך מאה ושמונים', []).ok, false);
  assert.equal(checkGrounded('נותרו שבעה שקלים', []).ok, false, 'מספר קטן ליד מטבע');
  assert.equal(checkGrounded('צמיחה של עשרה אחוזים', []).ok, false);
  assert.equal(checkGrounded('מיליון שקלים', []).ok, false);
  assert.equal(checkGrounded('הכנסת מיליון החודש', []).ok, false, 'מספר מדויק בלי יחידה — עדיין נדחה');
  assert.equal(checkGrounded('יש לך עשרים חשבוניות פתוחות', []).ok, false, 'ספירה מומצאת במילים');
  assert.deepEqual(numberWords('תיק השמאות, חשבונית אחת ושני לקוחות'), [], 'בלי מטבע — מותר; ש אינה תחילית');
  assert.equal(checkGrounded('פתחו את מסך השמאות', []).ok, true);
});

// סקירה לממצא 48: שמות וצירופים קבועים אינם מספרים — אחרת מכתב תודה נופל לכללים
test('48 (סקירה): שם מהכלי עם מילת מספר, ו„אלפי תודות” במכתב — עוברים; סכום במילים עדיין נדחה', () => {
  const ev1 = [{ matches: [{ name: 'ישיבת מאה שערים', total: '₪1,800.00' }, { name: 'משה אלפי', total: '₪360.00' }], year: '2026' }];
  assert.equal(checkGrounded('כדאי להתקשר לישיבת מאה שערים — ₪1,800.00', ev1, { evidence: ev1 }).ok, true);
  const letter = 'בס״ד\nלכבוד משה אלפי הי״ו,\nאלפי תודות על תרומתך בסך ₪360.00 — עשרות שנים של נתינה. ובאלפי ברכות, '
    + 'תזכה לאריכות ימים עד מאה ועשרים שנה.\nמיליון תודות,\nהנהלת העמותה';
  const r = checkGrounded(letter, ev1, { evidence: ev1 });
  assert.deepEqual(r.invented, []);
  assert.equal(r.ok, true);
  // צירוף קבוע — רק בלי הקשר של סכום
  assert.deepEqual(numberWords('אלפי שקלים'), ['אלפי']);
  assert.deepEqual(numberWords('תרמת כאלפי שקלים'), ['כאלפי']);
  assert.deepEqual(numberWords('סכום של אלפי'), ['אלפי']);
  assert.deepEqual(numberWords('שלוש מאות'), ['שלוש מאות'], 'כמות כללית עם מילת מספר נוספת');
  assert.deepEqual(numberWords('מאה ועשרים שקלים'), ['מאה ועשרים']);
  assert.deepEqual(numberWords('חוב של מאה'), ['מאה']);
  // השם מוסתר רק כשהוא הגיע מכלי, ורק כשם שלם — „אלפי שקלים” באותה תשובה עדיין נדחה
  assert.deepEqual(checkGrounded('משה אלפי תרם אלפי שקלים, ₪360.00', ev1, { evidence: ev1 }).invented, ['אלפי']);
  assert.deepEqual(checkGrounded('ישיבת מאה שקלים, ₪1,800.00', ev1, { evidence: ev1 }).invented, ['מאה'], 'לא השם שהכלי החזיר');
});

// סקירה לממצא 48: ציטוט = ערך מהכלי כמילה שלמה, לא חלק ממילה
test('48 (סקירה): ציטוט שם — מילה שלמה בלבד; שם קצר בן מילה אחת אינו ציטוט', () => {
  const ev1 = [{ top: [{ customer: 'אור' }] }];
  const r = checkGrounded('האור והחושך — סיפור', ev1, { evidence: ev1 });
  assert.equal(r.ok, false);
  assert.equal(r.cited, false);
  const ev2 = [{ top: [{ customer: 'גולדברג' }, { customer: 'ישיבת אור התורה' }] }];
  assert.equal(checkGrounded('האורחים של גולדברגר', ev2, { evidence: ev2 }).cited, false, 'חלק ממילה');
  assert.equal(checkGrounded('תודה לגולדברג', ev2, { evidence: ev2 }).cited, true, 'תחילית מותרת');
  assert.equal(checkGrounded('כדאי להתחיל בישיבת אור התורה.', ev2, { evidence: ev2 }).cited, true, 'שם בן כמה מילים');
  assert.equal(checkGrounded('בישיבת אור התורהחדשה', ev2, { evidence: ev2 }).cited, false);
});

test('48: checkGrounded — מספר קטן מומצא נדחה (רק מספור רשימה מותר); evidence דורש ציטוט', () => {
  assert.equal(checkGrounded('יש 7 חשבוניות פתוחות', [{ count: 3 }]).ok, false);
  assert.equal(checkGrounded('יש 3 חשבוניות פתוחות', [{ count: 3 }]).ok, true);
  assert.equal(checkGrounded('1. ראשון\n2) שני', []).ok, true);
  const ev1 = [{ total: '₪18,000.00', top: [{ customer: 'משה כהן' }], note: 'לפני מע"מ' }];
  assert.equal(checkGrounded('הנה סיפור נחמד', ev1, { evidence: ev1 }).ok, false, 'בלי ספרות ובלי ציטוט — נדחה');
  assert.equal(checkGrounded('הנה סיפור נחמד', ev1, { evidence: ev1 }).cited, false);
  assert.equal(checkGrounded('כדאי להתחיל אצל משה כהן', ev1, { evidence: ev1 }).ok, true, 'ציטוט שם');
  assert.equal(checkGrounded('נותרו ₪18,000.00 לגבייה', ev1, { evidence: ev1 }).ok, true, 'ציטוט סכום');
  assert.equal(checkGrounded('הסכום לפני מע"מ', ev1, { evidence: ev1 }).ok, false, 'הערה אינה ציטוט');
  assert.equal(checkGrounded('בשנת 2026 הכול טוב', ['2026-10-22', { year: '2026' }], { evidence: [{ year: '2026' }] }).ok, false, 'השנה מהתאריך אינה ציטוט');
  assert.equal(checkGrounded('משהו', [], { evidence: [] }).ok, false, 'בלי כלי מוצלח — אין מקור');
});

// העוזר כולו מול מודל מדומה
function aiWith(script) {
  const fork = createMockFork(script);
  const engine = createLocalEngine({ modelStore: fakeStore(), fork, hasRuntime: () => true });
  const ai = createAI({ userDataPath: newDir(), getBackupKey: () => null, licenseState: () => LICENSED, localEngine: engine });
  return { ai, engine };
}
const fullCtx = () => ({ today: TODAY, opened: { acct: true, npo: true },
  range: { from: '2026-10-01', to: TODAY, label: 'אוקטובר 2026' },
  summary: { income: 48250, expenses: 12780.5, vatPayable: 6384.51, cashAfterVat: 29084.99 },
  invoices: [{ number: 1041, customer: 'ישיבת אור התורה', date: '2026-10-08', balance: 12000, status: 'open' }] });

test('48: שאלה כללית בלי כלי — התשובה הקבועה, והטקסט של המודל לא מגיע', async () => {
  const { ai, engine } = aiWith(() => ({ calls: [], answer: 'לדעתי כדאי לקרוא עיתון.' }));
  await engine.refresh();
  const r = await ai.run('מה דעתך על החדשות?', fullCtx());
  assert.equal(r.engine, 'rules');
  assert.equal(r.fallback, 'off-topic');
  assert.equal(r.text, R.OFF_TOPIC);
  assert.ok(!r.text.includes('עיתון'));
  ai.dispose();
});

// סקירה לממצא 48: שאלה כללית עם כלי מוצלח שלא צוטט — התשובה הקבועה, לא סיכום הכנסות שלא נשאל עליו
test('48: כלי מוצלח אבל תשובה שאינה מצטטת ממנו — שאלה כללית מקבלת את התשובה הקבועה', async () => {
  const { ai, engine } = aiWith(() => ({ calls: [{ name: 'period_summary' }], answer: 'הנה סיפור קצר על חתול חמוד.' }));
  await engine.refresh();
  const r = await ai.run('ספר לי משהו', fullCtx());
  assert.equal(r.engine, 'rules');
  assert.equal(r.fallback, 'off-topic');
  assert.equal(r.text, R.OFF_TOPIC);
  assert.ok(!r.text.includes('חתול'));
  assert.ok(!r.text.includes('48,250'), 'לא הסיכום הכללי');
  ai.dispose();
});

test('48: ניסוח מכתב בלי ציטוט — נדחה ועונים מהכללים (no-tools), לא התשובה הקבועה', async () => {
  const { ai, engine } = aiWith(() => ({ calls: [{ name: 'period_summary' }], answer: 'בס״ד\nתודה רבה על הכול, האור והחושך.' }));
  await engine.refresh();
  const r = await ai.run('נסח מכתב תודה לתורמים', fullCtx());
  assert.equal(r.engine, 'rules');
  assert.equal(r.fallback, 'no-tools');
  assert.ok(!r.text.includes('האור והחושך'));
  ai.dispose();
});

test('48: סכום במילים — נדחה (ungrounded); תשובה מבוססת עם ציטוט — עוברת', async () => {
  const bad = aiWith(() => ({ calls: [{ name: 'period_summary' }], answer: 'נכנסו לך כחמשת אלפים שקלים החודש.' }));
  await bad.engine.refresh();
  const r1 = await bad.ai.run('כמה נכנס לי לאחרונה?', fullCtx());
  assert.equal(r1.fallback, 'ungrounded');
  assert.ok(!r1.text.includes('חמשת אלפים'));
  bad.ai.dispose();
  const good = aiWith(() => ({ calls: [{ name: 'unpaid_invoices' }], answer: 'כדאי להתקשר קודם ל{{unpaid_invoices.top.0.customer}} — {{unpaid_invoices.top.0.balance}}.' }));
  await good.engine.refresh();
  const r2 = await good.ai.run('אצל מי כדאי להתקשר קודם?', fullCtx());
  assert.equal(r2.engine, 'local');
  assert.match(r2.text, /ישיבת אור התורה/);
  good.ai.dispose();
});

test('48: כלי שנכשל (error) אינו מקור — שאלה כללית מקבלת את התשובה הקבועה', async () => {
  const { ai, engine } = aiWith(() => ({ calls: [{ name: 'repeat_customers' }], answer: 'אין לי נתונים, אבל הנה עצה כללית.' }));
  await engine.refresh();
  const ctx = fullCtx();
  delete ctx.analytics; // repeat_customers ← { error }
  const r = await ai.run('תן לי עצה', ctx);
  assert.equal(r.fallback, 'off-topic');
  ai.dispose();
});

// ================= נמוכים: נתוני השמאות והאימונים =================
function trainerItems(today) {
  const d = (n) => shiftDays(today, n);
  const mem = (o) => ({ payments: [], uses: [], ...o });
  return {
    'clients:index': JSON.stringify(['c_1', 'c_2', 'c_3', 'c_4', 'c_5', 'c_bad', '../x']),
    'client:c_1': JSON.stringify({ id: 'c_1', name: 'יוסף כהן' }),
    'memberships:c_1': JSON.stringify([mem({ id: 'm_1', name: 'מנוי חודשי', start: d(-27), end: d(3), priceAg: 30000, payments: [{ id: 'p', amountAg: 30000 }] })]),
    'client:c_2': JSON.stringify({ id: 'c_2', name: 'שמעון לוי' }),
    'memberships:c_2': JSON.stringify([mem({ id: 'm_2', name: 'מנוי חודשי', start: d(-40), end: d(-5), priceAg: 50000, payments: [{ id: 'p', amountAg: 30000 }] })]),
    'client:c_3': JSON.stringify({ id: 'c_3', name: 'אהרן פרידמן' }),
    'memberships:c_3': JSON.stringify([mem({ id: 'm_3', name: 'כרטיסייה', sessions: 2, start: d(-20), uses: [{}, {}], priceAg: 0 })]),
    'client:c_4': JSON.stringify({ id: 'c_4', name: 'דוד שפירא' }),
    'memberships:c_4': JSON.stringify([mem({ id: 'm_4', name: 'מנוי שנתי', start: d(-100), priceAg: 0 })]),
    'sessions:c_4': JSON.stringify([{ completedAt: atTen(d(-20)) }]),
    'client:c_5': JSON.stringify({ id: 'c_5', name: 'בנימין גרין' }),
    'memberships:c_5': JSON.stringify([mem({ id: 'm_5', name: 'מנוי שנתי', start: d(-10), priceAg: 0 })]),
    'studio:schedule': JSON.stringify([{ date: d(-2), participants: [{ clientId: 'c_1', status: 'attended' }] }]),
    'client:c_bad': '{not json',
  };
}

test('נמוך: trainerContext — מנוי שמסתיים, אין מנוי פעיל, יתרה, ולא התאמן; רשומה פגומה מדולגת', () => {
  const t = MC.trainerContext(trainerItems(TODAY), TODAY);
  assert.equal(t.clients, 5);
  const titles = t.alerts.map(a => a.title);
  assert.ok(titles.includes('יוסף כהן — מנוי חודשי עומד להסתיים'));
  assert.ok(titles.includes('שמעון לוי — אין מנוי פעיל'));
  assert.ok(titles.includes('שמעון לוי — יתרה לתשלום'));
  assert.ok(titles.includes('אהרן פרידמן — אין מנוי פעיל'));
  assert.ok(titles.includes('דוד שפירא — לא התאמן 20 ימים'));
  assert.ok(titles.includes('בנימין גרין — עדיין לא התאמן'));
  assert.ok(!titles.some(x => x.startsWith('יוסף כהן — לא התאמן')), 'התאמן לפני יומיים');
  assert.equal(t.alerts.find(a => a.title === 'שמעון לוי — יתרה לתשלום').detail, R.nis(20000));
  assert.equal(t.alerts[0].tone, 'red', 'הדחוף ראשון');
  assert.equal(MC.trainerContext(null, TODAY), null);
  assert.deepEqual(MC.trainerContext({ 'clients:index': '"x"' }, TODAY), { clients: 0, alerts: [] });
});

function shamaiItems() {
  const cases = [
    { id: 'a', no: 7, rev: 0, status: 'final', finalizedAt: '2026-10-10T08:00:00.000Z', reportDate: '2026-10-10', basis: 'replacement', currency: 'ILS',
      client: { name: 'ראובן ישראלי', idNumber: '123456782' }, items: [{}, {}], frozen: { totalAg: 1234500 } },
    { id: 'b', no: 9, rev: 1, status: 'final', finalizedAt: '2026-10-20T08:00:00.000Z', reportDate: '2026-10-20', basis: 'market', currency: 'USD',
      client: { name: 'שמעון ישראלי', idNumber: '987654324' }, items: [{}, {}, {}], frozen: { totalAg: 2500000 } },
    { id: 'c', no: 10, status: 'draft', created: '2026-10-21T08:00:00.000Z', client: { name: 'לוי' }, items: [] },
    { id: 'd', no: 11, status: 'final', frozen: { totalAg: 1.5 }, finalizedAt: '2026-10-22T08:00:00.000Z', client: {} }, // פגום
  ];
  return { 'shamai_v2_cases': JSON.stringify(cases) };
}

test('נמוך: shamaiContext — התיק האחרון שננעל, בלי שם הלקוח ובלי ת״ז', () => {
  const s = MC.shamaiContext(shamaiItems());
  assert.equal(s.valueAg, 2500000);
  assert.equal(s.label, 'תיק 9-1 מ-20.10.2026, 3 פריטים, שווי שוק');
  assert.equal(s.warnings.length, 2, 'מטבע זר + טיוטה חדשה יותר');
  const json = JSON.stringify(s);
  assert.ok(!json.includes('שמעון') && !json.includes('987654324'), 'בלי פרטי הלקוח');
  assert.equal(MC.shamaiContext({ 'shamai_v2_cases': JSON.stringify([{ status: 'draft', client: {} }]) }), null);
  assert.equal(MC.shamaiContext({}), null);
  const a = R.runRules('מה הערכת השווי האחרונה?', { today: TODAY, opened: { shamai: true }, shamai: s });
  assert.match(a.text, /₪25,000\.00/);
  assert.equal(a.data.kind, 'shamai');
});

test('נמוך: דרך ipc — שאלות השמאות והאימונים נענות מהמחסן של המודול, ושאלות הדוגמה מוצעות רק כשיש מקור', async () => {
  await freshEcon();
  const plain = await handlers['ai:sample'](ev(1));
  assert.ok(!plain.includes('מה הערכת השווי האחרונה?'), 'בלי מקור — לא מציעים');
  assert.ok(!plain.includes('איזה מתאמנים דורשים תשומת לב?'));

  const today = dayOf(new Date());
  const asked = [];
  await freshEcon({
    trainerData: (id) => { asked.push(['trainer', id]); return trainerItems(today); },
    shamaiData: (id) => { asked.push(['shamai', id]); return shamaiItems(); },
  });
  const samples = await handlers['ai:sample'](ev(1));
  assert.ok(samples.includes('מה הערכת השווי האחרונה?'));
  assert.ok(samples.includes('איזה מתאמנים דורשים תשומת לב?'));
  const t = await handlers['ai:run'](ev(1), 'איזה מתאמנים דורשים תשומת לב?');
  assert.equal(t.data.kind, 'trainer');
  assert.match(t.text, /שמעון לוי — אין מנוי פעיל/);
  const s = await handlers['ai:run'](ev(1), 'מה הערכת השווי האחרונה?');
  assert.equal(s.data.kind, 'shamai');
  assert.match(s.text, /₪25,000\.00/);
  assert.ok(asked.every(([, id]) => id === 1), 'המקור נקרא בשם החלון ששאל');
  // מקור שנכשל (מחסן נעול) — תשובה מסודרת, לא קריסה
  await freshEcon({ trainerData: () => { throw new Error('נתוני האימונים אינם זמינים'); } });
  assert.match((await handlers['ai:run'](ev(1), 'איזה מתאמנים דורשים תשומת לב?')).text, /אינם זמינים כרגע/);
  assert.ok(logged.some(([scope]) => scope === 'ai-module-context'), 'הכשל נרשם ביומן התקלות');
});

test('נמוך: ההקשר של ai:context מתנקה ביציאה — לא עובר למשתמש שנכנס אחריו באותו חלון', async () => {
  await freshEcon();
  const injected = { trainer: { alerts: [{ title: 'מתאמן מההקשר', detail: 'פרט', tone: 'red' }], clients: 1 } };
  // ביקורת: באותה פגישה — ההקשר משמש (אין מקור אחר במכשיר הזה)
  await handlers['ai:context'](ev(1), injected);
  assert.match((await handlers['ai:run'](ev(1), 'איזה מתאמנים דורשים תשומת לב?')).text, /מתאמן מההקשר/);
  // יציאה וכניסה מחדש — ההקשר שנשלח לפני היציאה לא נוצל
  await handlers['ai:context'](ev(1), injected);
  await handlers['auth:logout'](ev(1));
  await handlers['auth:login'](ev(1), 'menahel', 'menahel-pass-long-1');
  assert.ok(!(await handlers['ai:run'](ev(1), 'איזה מתאמנים דורשים תשומת לב?')).text.includes('מתאמן מההקשר'));
  // כניסה של משתמש אחר באותו חלון בלי יציאה (setSession מחליף פגישה) — גם אז לא
  await handlers['ai:context'](ev(1), injected);
  await handlers['auth:login'](ev(1), 'menahel', 'menahel-pass-long-1');
  assert.ok(!(await handlers['ai:run'](ev(1), 'איזה מתאמנים דורשים תשומת לב?')).text.includes('מתאמן מההקשר'));
});

// ================= נמוך: כפתור „פתיחת המסך הרלוונטי” =================
function loadUi(extra) {
  const ctx = vm.createContext({ console, Date, String, Object, Promise, Number, esc: (v) => String(v ?? ''), ...extra });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'modules/econ/ui/ai.js'), 'utf8') +
    '\n;globalThis.__ai = { renderAi, attachAiHandlers, aiUi };', ctx, { filename: 'modules/econ/ui/ai.js' });
  return ctx;
}

async function clickOpen(kind) {
  const calls = [];
  const errors = [];
  const ctx = loadUi({
    viewTitles: { 'acct-invoices': 'חשבוניות', 'acct-reports': 'דוחות', npo: 'עמותה' },
    switchView: (v) => calls.push(['switch', v]),
    showError: (m) => errors.push(m),
    errMsg: (e) => String(e && e.message),
  });
  ctx.systemAPI = { aiOpen: async (v) => { calls.push(['aiOpen', v]); return { view: v }; }, openModule: async (m) => { calls.push(['module', m]); } };
  ctx.__ai.aiUi.answer = { text: 'תשובה', engineLabel: 'כללי המערכת', data: { kind } };
  const html = ctx.__ai.renderAi({ status: { prefs: {}, opened: {} }, samples: [] });
  const m = html.match(/data-ai-open="([^"]*)"/);
  assert.ok(m, kind + ': הכפתור מוצג');
  const btn = { dataset: { aiOpen: m[1] }, _l: [], addEventListener(e, fn) { this._l.push(fn); } };
  const root = { querySelector: () => null, querySelectorAll: (sel) => (sel === '[data-ai-open]' ? [btn] : []) };
  ctx.__ai.attachAiHandlers(root);
  await btn._l[0]();
  return { calls, errors };
}

test('נמוך: „פתיחת המסך הרלוונטי” — עובד לכל סוג תשובה, לא רק לאימונים', async () => {
  for (const [kind, view] of [['unpaid', 'acct-invoices'], ['income', 'acct-reports'], ['donors', 'npo']]) {
    const r = await clickOpen(kind);
    assert.deepEqual(r.errors, [], kind);
    assert.deepEqual(r.calls, [['aiOpen', view], ['switch', view]], kind);
  }
  for (const mod of ['trainer', 'shamai']) {
    const r = await clickOpen(mod);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.calls, [['aiOpen', mod], ['module', mod]], mod + ': נפתח כמודול');
  }
});

test('נמוך: ai:open — מודול השמאות ברשימה הסגורה', async () => {
  await freshEcon();
  assert.deepEqual(await handlers['ai:open'](ev(1), 'shamai'), { view: 'shamai' });
  await assert.rejects(handlers['ai:open'](ev(1), 'acct-invoices-x'), /אינו מוכר/);
});
