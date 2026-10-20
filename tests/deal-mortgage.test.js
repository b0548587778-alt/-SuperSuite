// נדל"ן ותיווך (שלב 8): משכנתא כחלק מהעסקה — "פתח תיק משכנתא" יוצר תיק ייעוץ מקושר, מצב בשני הצדדים,
// התראה כשהחתימה קרובה; פרטיות (זכות עיון, מזעור) ונתוני דוגמה לנדל"ן; עמוד במדריך.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const DM = require('../modules/econ/core/dealMortgage');
const PR = require('../modules/econ/core/privacy');
const PD = require('../modules/econ/core/privacyDocs');
const SD = require('../modules/econ/core/sampleData');
const DP = require('../modules/econ/core/devProject');

const TODAY = '2026-10-20';
const deal = (over = {}) => ({ id: 'd1', stage: 'negotiation', priceAg: 250000000, dependsOnMortgage: true, signDate: '2026-10-25', ...over });

test('קלט לתיק מעסקה: שם וטלפון הקונה, שווי = מחיר העסקה; סכום חובה ולא מעל המחיר; בלי שכירות', () => {
  const buyer = { name: 'מנחם גולדשטיין', phone: '050-1111111' };
  const x = DM.caseInput(deal(), { listing: 'sale', type: 'apartment', rooms: 4, city: 'בני ברק' }, buyer, { requestedAmount: 1500000 });
  assert.equal(x.name, 'מנחם גולדשטיין');
  assert.equal(x.propertyValue, 2500000);
  assert.match(x.notes, /נפתח מעסקת תיווך/);
  assert.throws(() => DM.caseInput(deal(), null, buyer, {}), /סכום המשכנתא/);
  assert.throws(() => DM.caseInput(deal(), null, buyer, { requestedAmount: 3000000 }), /גדול ממחיר/);
  assert.throws(() => DM.caseInput(deal(), { listing: 'rent' }, buyer, { requestedAmount: 1 }), /שכירות/);
  assert.throws(() => DM.caseInput(deal(), null, null, { requestedAmount: 1 }), /קונה/);
});

test('התראה: חתימה בעוד פחות משבועיים ומשכנתא לא אושרה; אחרי אישור סופי — בלי התראה', () => {
  assert.match(DM.alertFor(deal(), null, TODAY), /בעוד 5 ימים.*אין תיק משכנתא מקושר/);
  assert.equal(DM.alertFor(deal({ signDate: '2026-12-01' }), null, TODAY), '', 'רחוק — בלי התראה');
  assert.equal(DM.alertFor(deal({ dependsOnMortgage: false }), null, TODAY), '');
  assert.equal(DM.alertFor(deal({ stage: 'closed' }), null, TODAY), '');
  assert.match(DM.alertFor(deal({ signDate: '2026-10-18' }), null, TODAY), /הייתה אמורה/);
  const sub = { id: 'c1', status: 'submitted', approvals: [] };
  assert.match(DM.statusForDeal({ ...deal(), mortgageCaseId: 'c1' }, sub, TODAY).alert, /בשלב "הוגש לבנקים"/);
  assert.equal(DM.statusForDeal({ ...deal(), mortgageCaseId: 'c1' }, { ...sub, status: 'final' }, TODAY).alert, '');
  assert.match(DM.statusForDeal({ ...deal(), mortgageCaseId: 'c1' }, { ...sub, status: 'lost' }, TODAY).alert, /לא התקדם/);
  assert.deepEqual(DM.statusForDeal({ ...deal(), mortgageCaseId: 'gone' }, null, TODAY), { linked: true, missing: true, label: 'התיק המקושר נמחק' });
});

test('האישור שנבחר מוצג בעסקה; העסקה מוצגת בתיק', () => {
  const c = { id: 'c1', status: 'principle', realtyDealId: 'd1', chosenApprovalId: 'a1', approvals: [{ id: 'a1', lender: 'בנק לדוגמה', validUntil: '2026-10-01', feesAg: 0 }] };
  const st = DM.statusForDeal({ ...deal(), mortgageCaseId: 'c1' }, c, TODAY);
  assert.deepEqual(st.chosen, { lender: 'בנק לדוגמה', validUntil: '2026-10-01', expired: true });
  const r = DM.dealForCase(c, [deal()], [{ id: 'p', type: 'apartment', city: 'בני ברק' }], TODAY);
  assert.equal(r.stageLabel, 'משא ומתן');
  assert.match(r.alert, /אישורים עקרוניים/);
  assert.equal(DM.dealForCase(c, [], [], TODAY).label, 'העסקה המקושרת נמחקה');
});

test('זכות עיון: תיק משכנתא שנפתח מעסקה נמצא לפי הת"ז של הקונה; מזהים פנימיים לא מוצגים', () => {
  const data = {
    realty: { clients: [{ id: 'k', name: 'קונה', role: 'buyer', idNumber: '000000018' }], deals: [{ id: 'd1', buyerClientId: 'k', mortgageCaseId: 'c1' }], orders: [] },
    mortgageAdvisor: { clients: [{ id: 'c1', name: 'קונה', phone: '050', realtyDealId: 'd1', advisorId: 'u1' }] }
  };
  const r = PD.subjectReport(data, '000000018', { realty: true });
  const mc = r.sections.find(s => /תיק ייעוץ משכנתאות/.test(s.title));
  assert.ok(mc);
  assert.ok(!mc.fields.some(f => /realtyDealId|advisorId/.test(f.label)));
  assert.ok(!PD.subjectReport(data, '000000018', {}).sections.length, 'בלי רישיון נדל"ן — לא נבדק');
});

test('מזעור לקוח נדל"ן מוחק גם את כתובתו בהזמנות התיווך; מפת המאגרים כוללת הזמנות ועסקאות', () => {
  const old = '2020-01-01T00:00:00.000Z';
  const data = { realty: {
    clients: [{ id: 'k', name: 'ישן', role: 'seller', phone: '050', createdAt: old, updatedAt: old }, { id: 'n', name: 'אחר', role: 'seller', phone: '052', createdAt: old }],
    deals: [], orders: [{ id: 'o', clientId: 'k', clientAddress: 'רחוב הרב קוק 1' }, { id: 'o2', clientId: 'n', clientAddress: 'נשאר' }]
  } };
  const r = PR.applyRetention(data, 'realtyClients', ['k'], TODAY, 1, '2026-10-20T00:00:00.000Z');
  assert.equal(r.minimized, 1);
  assert.equal(data.realty.orders[0].clientAddress, '');
  assert.equal(data.realty.orders[1].clientAddress, 'נשאר');
  const map = PR.dataMap({ realty: data.realty }, {}).rows.map(x => x.area);
  assert.ok(map.includes('נדל"ן ותיווך — הזמנות שירותי תיווך'));
  assert.ok(map.includes('נדל"ן ותיווך — עסקאות'));
});

test('נתוני דוגמה לנדל"ן: נכס, שני לקוחות בלי ת"ז, עסקה תלויה במשכנתא ופרויקט; מחיקה רק שלהם', () => {
  let i = 0;
  const uuid = () => 'u' + (i++);
  const real = { id: 'real', name: 'לקוח אמיתי', role: 'buyer' };
  const data = { realty: { clients: [real] } };
  assert.deepEqual(SD.apply(data, ['realty'], { today: TODAY, uuid }), { realty: 5 });
  assert.equal(SD.counts(data).realty, 5);
  assert.ok(data.realty.clients.every(c => !c.idNumber));
  assert.equal(data.realty.deals[0].dependsOnMortgage, true);
  const cf = DP.cashflow(data.realty.projects[0]);
  assert.ok(cf.profit > 0);
  assert.equal(cf.horizon, 24, 'כל הגבייה בתוך הפרויקט');
  assert.deepEqual(SD.apply(data, ['realty'], { today: TODAY, uuid }), {}, 'לא מכפילים');
  SD.remove(data);
  assert.deepEqual(data.realty.clients, [real]);
  assert.equal(data.realty.projects.length + data.realty.deals.length + data.realty.properties.length, 0);
  assert.deepEqual(SD.availableKinds({ mode: 'licensed', features: ['econ.realestate'] }), ['realty']);
});

test('רישוי: רק נדל"ן — עסקאות בלי מצב משכנתא ובלי פתיחת תיק; רק ייעוץ — תיקים בלי העסקה', async () => {
  const LG = require('../shell/licensing/gate');
  const lic = (f) => ({ mode: 'licensed', status: 'active', features: ['econ', f] });
  // הערוץ נבדק ברישיון הנדל"ן, ובנוסף ה-IPC בודק שייעוץ המשכנתאות פתוח (rltyMortgage)
  assert.equal(LG.checkChannel(lic('econ.realestate'), 'rlty:openMortgageCase', 'data.edit'), null);
  assert.ok(LG.checkChannel(lic('econ.realestate'), 'madv:getOverview', 'data.view'));
  assert.ok(LG.checkChannel(lic('econ.mortgage-advisor'), 'rlty:getOverview', 'data.view'));
  const ipcSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ipc.js'), 'utf8');
  assert.match(ipcSrc, /handle\('rlty:openMortgageCase'[\s\S]{0,120}if \(!rltyMortgage\(\)\) throw/);

  const { RealtyService: rs } = require('../modules/econ/services/realtyService');
  const { MortgageAdvisorService: ms } = require('../modules/econ/services/mortgageAdvisorService');
  const store = {
    realty: { properties: [{ id: 'p', city: 'א', listing: 'sale', askingAg: 100 }], clients: [{ id: 'b', name: 'ב', role: 'buyer' }],
      deals: [{ id: 'd', propertyId: 'p', buyerClientId: 'b', stage: 'negotiation', priceAg: 100, dependsOnMortgage: true, signDate: '2026-10-22', mortgageCaseId: 'c' }], orders: [] },
    mortgageAdvisor: { clients: [{ id: 'c', name: 'ב', status: 'lead', requestedAmountAg: 50, realtyDealId: 'd' }], offers: [] }
  };
  const db = { load: async () => JSON.parse(JSON.stringify(store)), save: async () => {} };
  await rs.initialize(db);
  await ms.initialize(db);
  assert.equal((await rs.getOverview(TODAY, { mortgage: false })).deals[0].mortgage, null, 'בלי ייעוץ ברישיון — בלי מצב משכנתא');
  assert.equal((await rs.getOverview(TODAY, { mortgage: true })).deals[0].mortgage.stageLabel, 'פנייה');
  assert.equal((await ms.getOverview(null, { realty: false })).clients[0].realtyDeal, null, 'בלי נדל"ן ברישיון — בלי העסקה');
  assert.equal((await ms.getOverview(null, { realty: true, today: TODAY })).clients[0].realtyDeal.dealId, 'd');
  // יועץ שרואה רק את שלו — תיק של יועץ אחר מוצג בלי פרטים
  store.mortgageAdvisor.settings = { ownOnly: true };
  store.mortgageAdvisor.clients[0].advisorId = 'other';
  const m = (await rs.getOverview(TODAY, { mortgage: true, actor: { id: 'me', isManager: false } })).deals[0].mortgage;
  assert.deepEqual(m, { linked: true, missing: true, label: 'תיק של יועץ אחר' });
});

test('מדריך: פרק משכנתאות ונדל"ן בתוכן העניינים', () => {
  const g = fs.readFileSync(path.join(__dirname, '..', 'shell', 'guide', 'index.html'), 'utf8');
  assert.match(g, /href="#realty"/);
  assert.match(g, /<h2 id="realty">6\. משכנתאות ונדל"ן<\/h2>/);
  for (const s of ['פתח תיק משכנתא', 'תזרים יזם', 'אין בתוכנה מדרגות מובנות']) assert.ok(g.includes(s), s);
});

// ---------- IPC ----------

const handlers = {};
Module._resolveFilename_orig_dm = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_dm__.js' : Module._resolveFilename_orig_dm.call(this, req, ...rest); };
require.cache['/__electron_stub_dm__.js'] = {
  id: '/__electron_stub_dm__.js', filename: '/__electron_stub_dm__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true }) } }
};
const ipc = require('../modules/econ/ipc');
const ev = (id) => ({ sender: { id } });

test('IPC: פתיחת תיק מעסקה, מצב בשני הצדדים, ניתוק, ומחיקה מנתקת את הצד השני', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-dm-'));
  await ipc.initEcon(dir, { relayUrl: '' });
  await handlers['auth:setup'](ev(61), 'menahel', 'menahel-strong-pass-1');
  await handlers['auth:login'](ev(61), 'menahel', 'menahel-strong-pass-1');

  const seller = await handlers['rlty:createClient'](ev(61), { name: 'משפחת לוי', role: 'seller' });
  const buyer = await handlers['rlty:createClient'](ev(61), { name: 'משפחת כהן', role: 'buyer', phone: '050-2222222' });
  const p = await handlers['rlty:createProperty'](ev(61), { city: 'בני ברק', rooms: 4, asking: 2400000, ownerClientId: seller.id });
  const d = await handlers['rlty:createDeal'](ev(61), { propertyId: p.id, buyerClientId: buyer.id, stage: 'negotiation', signDate: '2099-01-01' });

  let ov = await handlers['rlty:getOverview'](ev(61));
  assert.equal(ov.canMortgage, true);
  assert.equal(ov.deals[0].mortgage, null);

  const c = await handlers['rlty:openMortgageCase'](ev(61), d.id, { requestedAmount: 1200000 });
  assert.equal(c.name, 'משפחת כהן');
  assert.equal(c.phone, '050-2222222');
  assert.equal(c.propertyValue, 2400000);
  await assert.rejects(handlers['rlty:openMortgageCase'](ev(61), d.id, { requestedAmount: 1 }), /כבר יש תיק/);

  ov = await handlers['rlty:getOverview'](ev(61));
  assert.equal(ov.deals[0].dependsOnMortgage, true, 'קישור מסמן "תלוי במשכנתא"');
  assert.equal(ov.deals[0].mortgage.stageLabel, 'פנייה');
  let madv = await handlers['madv:getOverview'](ev(61));
  assert.equal(madv.clients[0].realtyDeal.dealId, d.id);

  await handlers['rlty:unlinkMortgageCase'](ev(61), d.id);
  madv = await handlers['madv:getOverview'](ev(61));
  assert.equal(madv.clients[0].realtyDeal, null);
  ov = await handlers['rlty:getOverview'](ev(61));
  assert.equal(ov.deals[0].mortgage.linked, false);

  // קישור מחדש דרך פתיחה, ואז מחיקת התיק — העסקה נשארת בלי קישור
  const c2 = await handlers['rlty:openMortgageCase'](ev(61), d.id, { requestedAmount: 1000000 });
  await handlers['madv:deleteClient'](ev(61), c2.id);
  ov = await handlers['rlty:getOverview'](ev(61));
  assert.equal(ov.deals[0].mortgage.linked, false);
  // ומחיקת עסקה מנתקת את התיק
  const c3 = await handlers['rlty:openMortgageCase'](ev(61), d.id, { requestedAmount: 1000000 });
  await handlers['rlty:deleteDeal'](ev(61), d.id);
  madv = await handlers['madv:getOverview'](ev(61));
  assert.equal(madv.clients.find(x => x.id === c3.id).realtyDeal, null);
});

test('המסך והערוצים: כפתור בעסקה, עסקה בתיק, preload והרשאות', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ui', 'realty.js'), 'utf8');
  for (const s of ['data-rlty-mtg-open', 'data-rlty-mtg-unlink', 'עסקאות שממתינות למשכנתא', 'openRealtyMortgageCase']) assert.ok(ui.includes(s), s);
  const madv = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ui', 'mortgage-advisor.js'), 'utf8');
  assert.ok(madv.includes('madvRealtyDealHtml(c.realtyDeal)'));
  const preload = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'preload.js'), 'utf8');
  for (const ch of ['openMortgageCase', 'unlinkMortgageCase']) assert.ok(preload.includes(`'rlty:${ch}'`), ch);
  assert.equal(ipc.permissionFor('rlty:openMortgageCase'), 'data.edit');
  assert.equal(ipc.permissionFor('rlty:unlinkMortgageCase'), 'data.edit');
});
