// נדל"ן ותיווך (שלב 7): תזרים פרויקט ליזם — עלויות לפי חודשים, גבייה לפי לוח תשלומים, יתרה מצטברת,
// שיא הגירעון, רווח ואחוז רווח. הסכומים בבדיקות לדוגמה בלבד.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const P = require('../modules/econ/core/devProject');

const base = (over = {}) => ({
  name: 'בניין ברחוב הרב קוק', startMonth: '2027-01', months: 6, planText: '50, 0\n50, 2',
  costs: [{ category: 'land', amount: 1000000, from: 1, spread: 1 }, { category: 'build', amount: 900000, from: 2, spread: 3 }],
  sales: [{ label: 'דירה', units: 2, price: 1200000, month: 3 }],
  ...over
});

test('לוח תשלומים: אחוז וחודשים, כותרת מדולגת, חייב להסתכם ב-100%', () => {
  assert.deepEqual(P.parsePlan('אחוז, חודשים\n20%, 0\n80, 12'), [{ bp: 2000, after: 0 }, { bp: 8000, after: 12 }]);
  assert.throws(() => P.parsePlan('20, 0\n70, 12'), /90% — צריך 100%/);
  assert.throws(() => P.parsePlan(''), /ריק/);
  assert.throws(() => P.parsePlan('20 0'), /שורה 1/);
  assert.equal(P.planText([{ bp: 3333, after: 0 }, { bp: 6667, after: 5 }]), '33.33, 0\n66.67, 5');
});

test('חלוקה שווה ותשלומים: סכום האגורות נשמר בדיוק', () => {
  assert.deepEqual(P.spreadEven(100, 3), [33, 33, 34]);
  const ins = P.installments(100001, [{ bp: 3333, after: 0 }, { bp: 3333, after: 1 }, { bp: 3334, after: 2 }]);
  assert.equal(ins.reduce((s, x) => s + x.ag, 0), 100001);
  assert.equal(P.monthLabel('2027-11', 3), '2028-02');
});

test('תזרים: עלויות פרוסות, גבייה לפי לוח, יתרה, שיא גירעון, רווח ואחוז רווח', () => {
  const r = P.cashflow(base());
  assert.equal(r.horizon, 6);
  assert.deepEqual(r.rows.map(m => m.cost), [1000000, 300000, 300000, 300000, 0, 0]);
  // שתי דירות × 1.2 מיליון: 50% בחודש 3, 50% בחודש 5
  assert.deepEqual(r.rows.map(m => m.income), [0, 0, 1200000, 0, 1200000, 0]);
  assert.deepEqual(r.rows.map(m => m.balance), [-1000000, -1300000, -400000, -700000, 500000, 500000]);
  assert.equal(r.peakDeficit, 1300000);
  assert.equal(r.peakMonth, '2027-02');
  assert.equal(r.breakEvenMonth, '2027-05');
  assert.equal(r.profit, 500000);
  assert.equal(r.totalCost, 1900000);
  assert.equal(r.profitOnCostPct, 26.32);
  assert.equal(r.profitOnRevenuePct, 20.83);
  assert.deepEqual(r.costByCategory.map(c => [c.label, c.amount]), [['קרקע', 1000000], ['בנייה', 900000]]);
  assert.equal(r.rows.reduce((s, m) => s + m.costAg, 0), r.directCostAg);
});

test('ריבית על גירעון, הון עצמי וחוסר מימון; גבייה אחרי סוף הפרויקט מאריכה את הטבלה', () => {
  const r = P.cashflow(base({ deficitRate: 12, equity: 1000000 }));
  // 12% לשנה = 1% לחודש על היתרה השלילית
  assert.equal(r.rows[0].interest, 10000);
  assert.equal(r.rows[0].balance, -1010000);
  assert.ok(r.interest > 0);
  assert.equal(r.totalCost, 1900000 + r.interest);
  assert.equal(r.fundingGap, r.peakDeficit - 1000000);
  assert.ok(r.warnings.some(w => /מימון נוסף/.test(w)));

  const late = P.cashflow(base({ planText: '10, 0\n90, 8' }));
  assert.equal(late.horizon, 11);
  assert.ok(late.warnings.some(w => /הטבלה הוארכה/.test(w)));
  assert.equal(late.revenue, 2400000);
});

test('בדיקת קלט: עלות שחורגת מהפרויקט, חודש מכירה, סוג חסר, שם וחודש התחלה', () => {
  assert.throws(() => P.cashflow(base({ costs: [{ category: 'build', amount: 1, from: 5, spread: 3 }] })), /אחרי סוף הפרויקט/);
  assert.throws(() => P.cashflow(base({ sales: [{ price: 1, month: 7 }] })), /חודש המכירה/);
  assert.throws(() => P.cashflow(base({ costs: [{ category: 'x', amount: 1, from: 1 }] })), /יש לבחור סוג/);
  assert.throws(() => P.cashflow(base({ name: '' })), /שם/);
  assert.throws(() => P.cashflow(base({ startMonth: '2027-13' })), /חודש ההתחלה/);
  // שורות ריקות לגמרי מדולגות (כמו בטופס עם שורה שלא מולאה)
  const r = P.cashflow(base({ sales: [{ label: '', price: '' }], costs: [] }));
  assert.ok(r.warnings.some(w => /לא הוזנו מכירות/.test(w)));
  assert.ok(r.warnings.some(w => /לא הוזנו עלויות/.test(w)));
});

test('הפסד מסומן; רשומה שמורה בשקלים ובלי שדות זרים', () => {
  const r = P.cashflow(base({ sales: [{ units: 1, price: 1000000, month: 3 }] }));
  assert.ok(r.profit < 0);
  assert.ok(r.warnings.some(w => /בהפסד/.test(w)));
  assert.ok(r.warnings.some(w => /עדיין שלילית/.test(w)));
  const rec = P.projectRecord({ ...base(), junk: 'x' });
  assert.equal(rec.junk, undefined);
  assert.equal(rec.planText, '50, 0\n50, 2');
  assert.equal(rec.costs[0].amount, 1000000);
  assert.equal(rec.costs[0].label, 'קרקע');
});

// ---------- IPC ----------

const handlers = {};
Module._resolveFilename_orig_dev = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_dev__.js' : Module._resolveFilename_orig_dev.call(this, req, ...rest); };
require.cache['/__electron_stub_dev__.js'] = {
  id: '/__electron_stub_dev__.js', filename: '/__electron_stub_dev__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true }) } }
};
const ipc = require('../modules/econ/ipc');
const ev = (id) => ({ sender: { id } });

test('IPC: חישוב, שמירה, עדכון, סקירה ומחיקה של פרויקט; עורך לא מוחק', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-dev-'));
  await ipc.initEcon(dir, { relayUrl: '' });
  await handlers['auth:setup'](ev(97), 'menahel', 'menahel-strong-pass-1');
  await handlers['auth:login'](ev(97), 'menahel', 'menahel-strong-pass-1');
  await handlers['users:create'](ev(97), { username: 'orech', password: 'orech-strong-pass-1', role: 'editor' });
  await handlers['auth:login'](ev(98), 'orech', 'orech-strong-pass-1');

  const r = await handlers['rlty:calcProject'](ev(98), base());
  assert.equal(r.profit, 500000);
  const p = await handlers['rlty:saveProject'](ev(98), '', base());
  assert.ok(p.id);
  const u = await handlers['rlty:saveProject'](ev(98), p.id, { ...base(), name: 'שם חדש' });
  assert.equal(u.id, p.id);
  assert.equal(u.name, 'שם חדש');
  await assert.rejects(handlers['rlty:saveProject'](ev(98), 'nope', base()), /לא נמצא/);
  const ov = await handlers['rlty:getOverview'](ev(98));
  assert.equal(ov.projects.length, 1);
  assert.equal(ov.costCategories.land, 'קרקע');
  await assert.rejects(handlers['rlty:deleteProject'](ev(98), p.id), /הרשאה/);
  await handlers['rlty:deleteProject'](ev(97), p.id);
  assert.equal((await handlers['rlty:getOverview'](ev(97))).projects.length, 0);
});

test('המסך: לשונית "תזרים יזם", גרף, ערוצים ב-preload והרשאות', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ui', 'realty.js'), 'utf8');
  for (const s of ["['project', 'תזרים יזם']", 'rltyPCalc', 'rltyBalanceChart', 'data-rlty-project-del', 'project: rltyProjectSchema']) assert.ok(ui.includes(s), s);
  assert.doesNotMatch(ui, /\b(alert|confirm|prompt)\(/);
  assert.doesNotMatch(ui, /#[0-9a-fA-F]{3,6}\b/);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'preload.js'), 'utf8');
  for (const ch of ['calcProject', 'saveProject', 'deleteProject']) assert.ok(preload.includes(`'rlty:${ch}'`), ch);
  assert.equal(ipc.permissionFor('rlty:calcProject'), 'data.view');
  assert.equal(ipc.permissionFor('rlty:saveProject'), 'data.edit');
  assert.equal(ipc.permissionFor('rlty:deleteProject'), 'data.delete');
});
