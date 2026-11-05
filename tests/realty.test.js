// נדל"ן ותיווך (שלב 4): נכסים, לקוחות, התאמה, עסקאות לפי שלבים, רישוי, ופרטיות (מזעור וזכות עיון).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const R = require('../modules/econ/core/realty');
const PR = require('../modules/econ/core/privacy');
const PD = require('../modules/econ/core/privacyDocs');
const LG = require('../shell/licensing/gate');

const VALID_ID = '000000018';

// ---------- נכסים ולקוחות ----------

test('נכס: עיר ומחיר חובה, סכום באגורות, ערכים לא מוכרים ← ברירת מחדל; עדכון בלי מחיר שומר את הקודם', () => {
  assert.throws(() => R.validateProperty({ asking: 100 }), /העיר/);
  assert.throws(() => R.validateProperty({ city: 'בני ברק' }), /המחיר המבוקש/);
  assert.throws(() => R.validateProperty({ city: 'בני ברק', asking: -1 }), /המחיר המבוקש/);
  assert.throws(() => R.validateProperty({ city: 'בני ברק', asking: 1, exclusiveUntil: '2026-02-31x' }), /בלעדיות/);
  const p = R.validateProperty({ city: 'בני ברק', neighborhood: 'רמת אהרן', asking: 2150000.5, rooms: 4.4, type: 'zzz', listing: 'rent' });
  assert.equal(p.askingAg, 215000050);
  assert.equal(p.rooms, 4.5, 'חצאי חדרים');
  assert.equal(p.type, 'apartment');
  assert.equal(p.listing, 'rent');
  const upd = R.validateProperty({ status: 'negotiation' }, p);
  assert.equal(upd.askingAg, 215000050);
  assert.equal(upd.status, 'negotiation');
  const v = R.propertyView({ ...p, id: 'x' });
  assert.equal(v.asking, 2150000.5);
  assert.match(v.title, /דירה · 4.5 חד׳ · רמת אהרן, בני ברק/);
});

test('לקוח: ת"ז נבדקת בספרת ביקורת, דרישות רק לקונה/שוכר, תקציב ותחום חדרים תקינים', () => {
  assert.throws(() => R.validateClient({ role: 'buyer' }), /שם/);
  assert.throws(() => R.validateClient({ name: 'משפחת כהן', idNumber: '123456789' }), /ספרת ביקורת/);
  assert.throws(() => R.validateClient({ name: 'א', role: 'buyer', minRooms: 5, maxRooms: 3 }), /חדרים/);
  assert.throws(() => R.validateClient({ name: 'א', role: 'buyer', budgetMin: 3000000, budgetMax: 2000000 }), /תקציב/);
  const b = R.validateClient({ name: 'משפחת כהן', role: 'buyer', idNumber: VALID_ID, areas: 'בני ברק, אלעד', types: 'apartment,zzz', budgetMax: 2500000, needsMortgage: 'yes' });
  assert.deepEqual(b.areas, ['בני ברק', 'אלעד']);
  assert.deepEqual(b.types, ['apartment']);
  assert.equal(b.budgetMaxAg, 250000000);
  assert.equal(b.needsMortgage, true);
  const s = R.validateClient({ name: 'משפחת לוי', role: 'seller', areas: 'x', budgetMax: 1 });
  assert.equal(s.areas, undefined, 'למוכר אין דרישות חיפוש');
  assert.equal(R.clientView({ ...b, id: 'c' }).budgetMax, 2500000);
});

// ---------- התאמה ----------

const prop = (over) => ({ id: over.id || 'p', ...R.validateProperty({ city: 'בני ברק', neighborhood: 'רמת אהרן', rooms: 4, asking: 2400000, ...over }) });
const buyer = (over) => ({ id: over.id || 'b', ...R.validateClient({ name: 'משפחת כהן', role: 'buyer', areas: 'בני ברק', minRooms: 4, maxRooms: 5, budgetMax: 2500000, ...over }) });

test('התאמה: סוג עסקה, נכס סגור ותקציב מעל 5% — פוסלים; אזור/חדרים/סוג — מורידים ציון', () => {
  const b = buyer({});
  assert.equal(R.matchScore(b, prop({})).score, 100);
  assert.equal(R.matchScore(b, prop({ listing: 'rent' })), null, 'קונה לא מותאם להשכרה');
  assert.equal(R.matchScore(b, prop({ status: 'sold' })), null);
  assert.equal(R.matchScore(b, prop({ asking: 2700000 })), null, 'מעל התקציב ביותר מ-5%');
  const over = R.matchScore(b, prop({ asking: 2600000 }));
  assert.equal(over.score, 85);
  assert.ok(over.misses.includes('מעט מעל התקציב'));
  assert.equal(R.matchScore(b, prop({ city: 'אלעד', neighborhood: '' })).score, 60);
  assert.equal(R.matchScore(b, prop({ rooms: 3 })).score, 80);
  assert.equal(R.matchScore({ ...b, active: false }, prop({})), null, 'לקוח לא פעיל');
  assert.equal(R.matchScore(R.validateClient({ name: 'מוכר', role: 'seller' }), prop({})), null);
  // שוכר ← נכס להשכרה; גרשיים/מקף באזור לא מפריעים
  const t = { id: 't', ...R.validateClient({ name: 'שוכר', role: 'tenant', areas: 'רמת-אהרן' }) };
  assert.equal(R.matchScore(t, prop({ listing: 'rent', asking: 6500 })).score, 100);
});

test('התאמה: ממוין לפי ציון, עם סף ומגבלה, משני הכיוונים', () => {
  const props = [prop({ id: 'a', rooms: 3 }), prop({ id: 'b' }), prop({ id: 'c', city: 'אלעד', neighborhood: '' }), prop({ id: 'd', status: 'sold' })];
  const res = R.matchesForClient(buyer({}), props);
  assert.deepEqual(res.map(x => x.property.id), ['b', 'a', 'c']);
  assert.deepEqual(R.matchesForClient(buyer({}), props, { minScore: 80 }).map(x => x.property.id), ['b', 'a']);
  const back = R.matchesForProperty(props[1], [buyer({ id: 'x' }), buyer({ id: 'y', areas: 'ירושלים' })]);
  assert.deepEqual(back.map(x => x.client.id), ['x', 'y']);
});

// ---------- עסקאות ----------

test('עסקה: נכס וקונה חובה, הקונה והמוכר שונים, מחיר ברירת מחדל = המבוקש, מועדים, היסטוריית שלבים', () => {
  const properties = [prop({ id: 'p1', ownerClientId: 's1' })];
  const clients = [buyer({ id: 'b1' }), { id: 's1', ...R.validateClient({ name: 'משפחת לוי', role: 'seller' }) }];
  const ctx = { properties, clients };
  assert.throws(() => R.validateDeal({}, {}, ctx), /נכס/);
  assert.throws(() => R.validateDeal({ propertyId: 'p1' }, {}, ctx), /קונה/);
  assert.throws(() => R.validateDeal({ propertyId: 'p1', buyerClientId: 's1' }, {}, ctx), /אותו לקוח/);
  assert.throws(() => R.validateDeal({ propertyId: 'p1', buyerClientId: 'b1', milestones: [{ label: 'בדיקה', date: 'x' }] }, {}, ctx), /תאריך/);
  const d = R.validateDeal({ propertyId: 'p1', buyerClientId: 'b1', milestones: [{ label: 'אישור עקרוני', date: '2026-11-01', mortgage: true }] }, {}, ctx);
  assert.equal(d.sellerClientId, 's1', 'המוכר — הבעלים הרשום בנכס');
  assert.equal(d.priceAg, 240000000);
  assert.equal(d.stage, 'viewing');
  let rec = R.withDealStage({}, d, 'u1', '2026-10-01T08:00:00Z');
  rec = R.withDealStage(rec, { ...rec, stage: 'viewing' }, 'u1', '2026-10-02T08:00:00Z');
  rec = R.withDealStage(rec, { ...rec, stage: 'memo' }, 'u1', '2026-10-05T08:00:00Z');
  assert.deepEqual(rec.stageHistory.map(h => h.stage), ['viewing', 'memo']);
  const lost = R.validateDeal({ stage: 'negotiation', lostReason: 'x' }, d, ctx);
  assert.equal(lost.lostReason, '', 'סיבה רק לעסקה שבוטלה');
  assert.equal(lost.priceAg, 240000000, 'עדכון בלי מחיר שומר את הקודם');
});

test('עסקה: סטטוס הנכס אחרי שלב, מועדים קרובים ולוח עמודות', () => {
  const p = prop({ id: 'p1' });
  assert.equal(R.propertyStatusAfter({ stage: 'memo' }, p), 'negotiation');
  assert.equal(R.propertyStatusAfter({ stage: 'closed' }, p), 'sold');
  assert.equal(R.propertyStatusAfter({ stage: 'closed' }, { ...p, listing: 'rent' }), 'rented');
  assert.equal(R.propertyStatusAfter({ stage: 'viewing' }, p), 'available');
  const deals = [
    { id: 'd1', stage: 'memo', propertyId: 'p1', dependsOnMortgage: true, signDate: '2026-10-25', milestones: [{ label: 'אישור עקרוני', date: '2026-10-18', mortgage: true }, { label: 'שמאי', date: '2026-12-30' }] },
    { id: 'd2', stage: 'closed', propertyId: 'p1', signDate: '2026-10-21', milestones: [] }
  ];
  const up = R.upcoming(deals, '2026-10-20');
  assert.deepEqual(up.map(u => u.label), ['אישור עקרוני', 'חתימה']);
  assert.equal(up[0].overdue, true);
  assert.equal(up[1].mortgage, true, 'חתימה בעסקה שתלויה במשכנתא');
  const board = R.dealBoard(deals, { properties: [p], clients: [] });
  assert.equal(board.find(c => c.stage === 'memo').cards.length, 1);
  assert.equal(board.find(c => c.stage === 'closed').closed, true);
});

// ---------- פרטיות ----------

test('פרטיות: מיפוי מאגר, מזעור לקוח לא פעיל בלי עסקה פתוחה, וזכות עיון רק כשהתחום פתוח', () => {
  const data = {
    realty: {
      clients: [
        { id: 'c1', name: 'משפחת כהן', role: 'buyer', idNumber: VALID_ID, phone: '050-0000000', areas: ['בני ברק'], budgetMaxAg: 1, updatedAt: '2023-01-01T00:00:00Z' },
        { id: 'c2', name: 'משפחת לוי', role: 'seller', phone: '052-0000000', updatedAt: '2023-01-01T00:00:00Z' },
        { id: 'c3', name: 'חדש', role: 'buyer', phone: '053', updatedAt: '2026-10-01T00:00:00Z' }
      ],
      properties: [], deals: [{ id: 'd', stage: 'memo', buyerClientId: 'x', sellerClientId: 'c2', updatedAt: '2023-01-01T00:00:00Z' }]
    }
  };
  assert.ok(PR.dataMap(data).rows.some(r => /נדל"ן/.test(r.area) && r.count === 3));
  assert.ok(PR.RETENTION_KINDS.realtyClients);
  const cand = PR.candidatesFor(data, 'realtyClients', '2026-10-20', 2);
  assert.deepEqual(cand.map(c => c.id), ['c1'], 'c2 בעסקה פתוחה, c3 עודכן לאחרונה');
  const r = PR.applyRetention(data, 'realtyClients', ['c1', 'c2'], '2026-10-20', 2, '2026-10-20T10:00:00Z');
  assert.deepEqual(r, { minimized: 1, skipped: 1 });
  const c1 = data.realty.clients[0];
  assert.equal(c1.idNumber, '');
  assert.equal(c1.phone, '');
  assert.equal(c1.areas, undefined);
  assert.equal(c1.name, 'משפחת כהן');
  assert.equal(data.realty.clients[1].phone, '052-0000000');

  const fresh = { realty: { clients: [{ id: 'c9', name: 'משפחת שפירא', role: 'buyer', idNumber: VALID_ID, phone: '054-1111111' }] } };
  const closed = PD.subjectReport(fresh, VALID_ID, { sources: [] });
  assert.equal(closed.count, 0, 'בלי רישיון לתחום — לא נכלל');
  const open = PD.subjectReport(fresh, VALID_ID, { sources: [], realty: true });
  assert.equal(open.count, 1);
  assert.ok(open.sections[0].fields.some(f => f.label === 'טלפון' && f.value === '054-1111111'));
  assert.ok(open.sections[0].fields.every(f => !/^[a-z]+[A-Z]/.test(f.label)), 'לכל שדה תווית בעברית');
});

test('רישוי: ערוצי rlty נעולים בלי econ.realestate ופתוחים איתו', () => {
  const without = { mode: 'licensed', status: 'active', features: ['econ', 'econ.mortgage-advisor'] };
  const withIt = { ...without, features: [...without.features, 'econ.realestate'] };
  assert.ok(LG.checkChannel(without, 'rlty:getOverview', 'data.view'));
  assert.equal(LG.checkChannel(withIt, 'rlty:createDeal', 'data.edit'), null);
});

// ---------- IPC ----------

const handlers = {};
Module._resolveFilename_orig_rlty = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_rlty__.js' : Module._resolveFilename_orig_rlty.call(this, req, ...rest); };
require.cache['/__electron_stub_rlty__.js'] = {
  id: '/__electron_stub_rlty__.js', filename: '/__electron_stub_rlty__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }) } }
};
const ipc = require('../modules/econ/ipc');
const ev = (id) => ({ sender: { id } });

test('IPC: נכס ← לקוחות ← התאמה ← עסקה ← סטטוס הנכס; מחיקות חסומות כשיש קשרים; צופה לא כותב', async () => {
  await ipc.initEcon(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-rlty-')), { relayUrl: '' });
  await handlers['auth:setup'](ev(91), 'menahel', 'menahel-strong-pass-1');
  await handlers['auth:login'](ev(91), 'menahel', 'menahel-strong-pass-1');
  await handlers['users:create'](ev(91), { username: 'tzofe', password: 'tzofe-strong-pass-1', role: 'viewer' });
  await handlers['auth:login'](ev(92), 'tzofe', 'tzofe-strong-pass-1');

  const seller = await handlers['rlty:createClient'](ev(91), { name: 'משפחת לוי', role: 'seller', phone: '052-0000000' });
  const p = await handlers['rlty:createProperty'](ev(91), { city: 'בני ברק', neighborhood: 'רמת אהרן', rooms: 4, asking: 2400000, ownerClientId: seller.id });
  assert.equal(p.asking, 2400000);
  await assert.rejects(handlers['rlty:createProperty'](ev(91), { city: 'א', asking: 1, ownerClientId: 'ghost' }), /הבעלים/);
  const b = await handlers['rlty:createClient'](ev(91), { name: 'משפחת כהן', role: 'buyer', areas: 'בני ברק', minRooms: 4, budgetMax: 2500000, needsMortgage: 'yes' });

  let ov = await handlers['rlty:getOverview'](ev(91));
  assert.equal(ov.properties[0].matchCount, 1);
  assert.equal(ov.clients.find(c => c.id === b.id).matchCount, 1);
  const m = await handlers['rlty:getMatches'](ev(91), 'client', b.id);
  assert.equal(m[0].property.id, p.id);
  assert.equal(m[0].score, 100);
  const back = await handlers['rlty:getMatches'](ev(91), 'property', p.id);
  assert.equal(back[0].client.name, 'משפחת כהן');

  const d = await handlers['rlty:createDeal'](ev(91), { propertyId: p.id, buyerClientId: b.id, stage: 'memo', price: 2350000, dependsOnMortgage: 'yes' });
  assert.equal(d.price, 2350000);
  assert.equal(d.sellerName, 'משפחת לוי');
  ov = await handlers['rlty:getOverview'](ev(91));
  assert.equal(ov.properties[0].status, 'negotiation');
  assert.equal(ov.properties[0].matchCount, 1, 'נכס במשא ומתן עדיין פתוח להתאמה');
  await handlers['rlty:updateDeal'](ev(91), d.id, { stage: 'closed' });
  ov = await handlers['rlty:getOverview'](ev(91));
  assert.equal(ov.properties[0].status, 'sold');
  assert.equal(ov.deals[0].stageHistory.length, 2);
  assert.equal(ov.board.find(c => c.stage === 'closed').cards.length, 1);

  await assert.rejects(handlers['rlty:deleteProperty'](ev(91), p.id), /עסקאות/);
  await assert.rejects(handlers['rlty:deleteClient'](ev(91), b.id), /עסקאות/);
  await assert.rejects(handlers['rlty:createClient'](ev(92), { name: 'x' }), /הרשאה/);
  assert.equal((await handlers['rlty:getOverview'](ev(92))).properties.length, 1, 'צופה רואה');
  await handlers['rlty:deleteDeal'](ev(91), d.id);
  await handlers['rlty:deleteProperty'](ev(91), p.id);
  await handlers['rlty:deleteClient'](ev(91), b.id);
  assert.equal((await handlers['rlty:getOverview'](ev(91))).properties.length, 0);
});

test('המסך: קטלוג, כפתור בסרגל, סקריפט לפני boot, ערוצים ב-preload, בלי alert/confirm', () => {
  const root = path.join(__dirname, '..');
  const catalog = require('../shell/catalog');
  // סקירת קוד 2.11.2026: catalog.DOMAINS לא קיים — הבדיקה הייתה קוד מת. הפריט בתחום "משכנתאות ונדל"ן"
  const item = catalog.ITEMS.find(i => i.mod === 'econ' && i.view === 'realty');
  assert.ok(item, 'פריט realty בקטלוג');
  assert.equal(item.group, 'realty');
  const html = fs.readFileSync(path.join(root, 'modules', 'econ', 'views', 'index.html'), 'utf8');
  assert.match(html, /data-view="realty"/);
  assert.ok(html.indexOf('ui/realty.js') > 0 && html.indexOf('ui/realty.js') < html.indexOf('ui/boot.js'));
  const preload = fs.readFileSync(path.join(root, 'modules', 'econ', 'preload.js'), 'utf8');
  for (const ch of ['getOverview', 'getMatches', 'createProperty', 'updateProperty', 'deleteProperty', 'createClient', 'updateClient', 'deleteClient', 'createDeal', 'updateDeal', 'deleteDeal']) assert.ok(preload.includes(`'rlty:${ch}'`), ch);
  const ui = fs.readFileSync(path.join(root, 'modules', 'econ', 'ui', 'realty.js'), 'utf8');
  assert.doesNotMatch(ui, /\b(alert|confirm|prompt)\(/);
  assert.doesNotMatch(ui, /#[0-9a-fA-F]{3,6}\b/);
  assert.equal(ipc.permissionFor('rlty:deleteDeal'), 'data.delete');
  assert.equal(ipc.permissionFor('rlty:getMatches'), 'data.view');
});
