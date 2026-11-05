// סקירת קוד 2.11.2026 — מסמכי תקנות הפרטיות לפי מצב ההצפנה בפועל, ורואה החשבון כבעל גישה
const test = require('node:test');
const assert = require('node:assert/strict');
const PR = require('../modules/econ/core/privacy');
const PD = require('../modules/econ/core/privacyDocs');
const { PrivacyService } = require('../modules/econ/services/privacyService');

const data = { npo: { donations: [{ id: 'd1' }] } };
const docs = async (atRestStatus) => {
  const svc = new PrivacyService.constructor({ atRestStatus, load: async () => structuredClone(data) });
  const users = [{ role: 'admin', active: true }, { role: 'accountant', active: true }];
  return { def: await svc.definitionHtml(users), proc: await svc.procedureHtml(users) };
};

test('מסמכי תקנות 2/4: מסד לא מוצפן (בלי DPAPI / אנדרואיד) — לא נכתב "מסד מוצפן"', async () => {
  const { def, proc } = await docs('plain-no-dpapi');
  assert.doesNotMatch(def, /מסד נתונים מוצפן/);
  assert.doesNotMatch(proc, /במסד מוצפן/);
  assert.match(proc, /המסד במכשיר הזה אינו מוצפן/);
  assert.match(def, /לא מוצפן במכשיר הזה/);
});

test('מסמכי תקנות 2/4: מסד מוצפן — הנוסח הקיים נשאר', async () => {
  const { def, proc } = await docs('encrypted');
  assert.match(def, /מסד נתונים מוצפן/);
  assert.match(proc, /במסד מוצפן/);
});

test('מפת המאגרים: רואה החשבון מופיע בין בעלי הגישה', () => {
  const rows = PR.dataMap(data).rows;
  assert.ok(rows.length);
  assert.ok(rows.filter(r => /כל המשתמשים/.test(r.access)).every(r => /רואה חשבון/.test(r.access)));
  assert.match(PD.renderDefinitionHtml(PR.dataMap(data, { admin: 1 }), PR.suggestLevel(PR.dataMap(data)), {}, '2026-11-02'), /רואה חשבון/);
});
