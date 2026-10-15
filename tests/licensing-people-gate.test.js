// רגרסיה (סקירת אבטחה 10.2026, ממצא 6): מאגר האנשים לא חושף תחומים שאינם ברישיון
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../shell/licensing/gate');
const P = require('../modules/econ/core/people');

const lic = (features) => ({ mode: 'licensed', status: 'active', features: ['econ', ...features], limits: {}, reasons: [] });

const data = {
  npo: { donations: [{ id: 'd1', donorName: 'אברהם כהן', donorId: '', date: '2026-09-01', amount: 180 }] },
  gemach: { loans: [{ id: 'l1', borrowerName: 'יצחק לוי', amount: 1000, issueDate: '2026-01-01', status: 'active', payments: [], schedule: [] }] },
  chesed: { beneficiaries: [{ id: 'b1', familyName: 'משפחת פרידמן', headName: 'יעקב פרידמן', tier: 'regular' }] },
};
const names = (opts) => P.search(data, '', opts).rows.map(r => r.name).sort();

test('בלי רישוי: כל התחומים', () => {
  assert.equal(G.peopleSources({ mode: 'unlicensed' }), null);
  assert.equal(names({}).length, 3);
});

test('רישיון בלי אף תחום מקור: people:* נחסם', () => {
  assert.match(G.checkChannel(lic([]), 'people:search', 'data.view'), /אינו כלול ברישיון/);
  assert.deepEqual(G.peopleSources(lic([])), []);
});

test('רישיון עמותה בלבד: people:* פתוח, אבל רק תורמים — בלי לווים ונזקקים', () => {
  const st = lic(['econ.npo']);
  assert.equal(G.checkChannel(st, 'people:search', 'data.view'), null);
  assert.deepEqual(G.peopleSources(st), ['npo']);
  assert.deepEqual(names({ sources: G.peopleSources(st) }), ['אברהם כהן']);
  assert.throws(() => P.card(data, P.search(data, 'יצחק', {}).rows[0].key, { sources: ['npo'] }), /לא נמצא/);
});

test('תחומים אחרים לא הושפעו', () => {
  assert.match(G.checkChannel(lic(['econ.npo']), 'chesed:getOverview', 'data.view'), /אינו כלול/);
  assert.equal(G.checkChannel(lic(['econ.npo']), 'tasks:get', 'data.view'), null);
});
