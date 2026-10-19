// מתאמנים במאגר האנשים (PLAN.md 6.4): קריאה בלבד מהמחסן המוצפן של מודול האימונים, רק כשהמודול ברישיון,
// בלי מידע רפואי, שיוך לפי שם (אין ת.ז במודול), וחשבון פתוח לפי המנוי.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const P = require('../modules/econ/core/people');
const TP = require('../modules/econ/core/trainerPayments');
const G = require('../shell/licensing/gate');

const ROOT = path.join(__dirname, '..');
const J = (v) => JSON.stringify(v);
// כמו localStorage של מודול האימונים (src/lib/db.js → K)
const ITEMS = {
  'clients:index': J(['c1', 'c2', '../x', 'c3']),
  'client:c1': J({ id: 'c1', name: 'משה לוי', phone: '050-1111111', createdAt: '2026-03-01T08:00:00Z', medical: ['back'], notes: 'רגיש' }),
  'memberships:c1': J([
    { id: 'm1', name: 'כרטיסייה 10', start: '2026-09-01', end: '2026-12-31', priceAg: 50000, payments: [{ id: 'p1', amountAg: 20000, date: '2026-09-01' }] },
    { id: 'm0', name: 'חודשי', start: '2026-01-01', end: '2026-01-31', priceAg: 30000, payments: [], cancelledAt: '2026-01-10' }
  ]),
  'client:c2': J({ id: 'c2', name: 'אליהו שפירא' }),
  'client:c3': 'לא JSON',
};
const lic = (features) => ({ mode: 'licensed', status: 'active', features: ['econ', ...features], limits: {}, reasons: [] });

test('readClients: שם, טלפון ומנויים — בלי מידע רפואי והערות; רשומה פגומה מדולגת', () => {
  const cs = TP.readClients(ITEMS, '2026-10-19');
  assert.deepEqual(cs.map(c => c.name), ['משה לוי', 'אליהו שפירא']);
  const c = cs[0];
  assert.equal(c.phone, '050-1111111');
  assert.equal(c.since, '2026-03-01');
  assert.ok(!('medical' in c) && !('notes' in c), 'לא יוצא מידע רפואי');
  assert.ok(!JSON.stringify(cs).includes('רגיש'));
  const m1 = c.memberships.find(m => m.id === 'm1');
  assert.deepEqual([m1.active, m1.paidAg, m1.dueAg], [true, 20000, 30000]);
  const m0 = c.memberships.find(m => m.id === 'm0');
  assert.deepEqual([m0.active, m0.cancelled], [false, true]);
  assert.deepEqual(TP.readClients(null), []);
  assert.deepEqual(TP.readClients({ 'clients:index': 'x' }), []);
});

test('במאגר: מתאמן מצטרף לאותו אדם לפי שם, עם חוב פתוח (מנוי מבוטל לא נספר)', () => {
  const data = {
    npo: { donations: [{ id: 'd1', donorName: 'משה לוי', donorId: '000000018', amount: 180, date: '2026-09-01', status: 'active', receipt: { number: 1 } }] },
    trainerClients: TP.readClients(ITEMS, '2026-10-19')
  };
  const r = P.search(data, '', {});
  const moshe = r.rows.find(x => x.name === 'משה לוי');
  assert.deepEqual(moshe.roles.sort(), ['donor', 'trainee']);
  assert.equal(moshe.traineeActive, true);
  assert.ok(r.rows.some(x => x.name === 'אליהו שפירא' && x.nameOnly));
  const c = P.card(data, moshe.key, {});
  assert.equal(c.trainee.length, 1);
  assert.equal(c.trainee[0].dueAg, 30000);
  assert.equal(c.trainee[0].byName, true, 'אין ת.ז במודול — מסומן "לפי שם"');
  assert.match(c.roleLabels.join(), /מתאמן/);
});

test('רישוי: המתאמנים נכללים רק כשמודול האימונים ברישיון', () => {
  assert.ok(G.peopleSources(lic(['trainer'])).includes('trainer'));
  assert.ok(!G.peopleSources(lic(['econ.npo'])).includes('trainer'));
  const data = { trainerClients: TP.readClients(ITEMS, '2026-10-19') };
  assert.equal(P.search(data, '', { sources: ['npo'] }).total, 0);
  assert.equal(P.search(data, '', { sources: ['trainer'] }).total, 2);
  assert.equal(G.checkChannel(lic(['trainer']), 'people:search', 'data.view'), null, 'רישיון אימונים לבד פותח את המאגר');
});

test('ipc.js: המתאמנים מגיעים רק דרך trainerSource (main.js בודק רישיון ומחסן), וכשל לא מפיל את המאגר', () => {
  const ipc = fs.readFileSync(path.join(ROOT, 'modules/econ/ipc.js'), 'utf8');
  const body = ipc.slice(ipc.indexOf('const peopleTrainerClients'), ipc.indexOf("handle('dashboard:getMorningBrief'"));
  assert.match(body, /if \(!trainerSource \|\| \(sources && !sources\.includes\('trainer'\)\)\) return \[\];/);
  assert.match(body, /try \{ return TP\.readClients\(trainerSource\(event\.sender\.id\)/);
  assert.match(body, /catch \{ return \[\]; \}/);
  assert.match(body, /peopleService\.search\(query, canSeeConfidential\(event\), sources, peopleTrainerClients\(event, sources\)\)/);
  assert.match(body, /peopleService\.getCard\(key, canSeeConfidential\(event\), sources, peopleTrainerClients\(event, sources\)\)/);
});

test('זכות עיון ולוח הבוקר לא הושפעו: מתאמנים בלי ת.ז לא נכנסים לדוח לפי ת.ז', () => {
  const PD = require('../modules/econ/core/privacyDocs');
  const data = { npo: { donations: [] }, trainerClients: TP.readClients(ITEMS, '2026-10-19') };
  const r = PD.subjectReport(data, '000000018', {});
  assert.equal(r.count, 0);
});
