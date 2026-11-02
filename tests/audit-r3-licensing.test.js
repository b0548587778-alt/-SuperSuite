// סקירת קוד 2.11.2026 — רישוי (docs/CODE-AUDIT-2026-11-02.md)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../shell/licensing/license');
const ACT = require('../shell/licensing/activation');
const { createLicenseStore } = require('../shell/licensing/store');
const { createOwner } = require('../tools/licensing/owner');

const DAY = L.DAY_MS;
const T0 = Date.UTC(2026, 9, 1);
const mem = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
const dirs = [];
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

// ממצא 1: מערכת בת שהונפקה חודש אחרי ההורה — תקופתה נחתכת בתוקף של ההורה (335 יום), ועדיין פעילה
test('ממצא 1: מערכת בת שהונפקה חודש אחרי חידוש ההורה — פעילה, לא "נדרש רישיון שנתי"', () => {
  let now = T0;
  const clock = () => now;
  const owner = createOwner({ dir: tmp('ss-owner-'), passphrase: 'ohr-hachaim-owner-2026', clock });
  owner.init();
  const install = () => createLicenseStore({ storage: mem(), secret: mem(), rootKeys: [owner.pubkey()], clock });
  const tenant = install();
  tenant.install(owner.issue({ request: tenant.request('רשת'), features: ['econ'], limits: { maxChildren: 2, maxUsers: 10, maxStorageMb: 1000, maxDepth: 2 } }).package);
  now = T0 + 30 * DAY;
  const child = install();
  const req = tenant.requestChildApproval({ request: child.request('סניף'), features: ['econ'], limits: { maxChildren: 0, maxUsers: 3, maxStorageMb: 100, maxDepth: 2 }, months: 12 });
  child.install(tenant.issueChild({ approval: owner.approve({ request: req.package }).package }).package);
  const chain = child.chainPayloads();
  const leaf = chain[chain.length - 1];
  assert.ok(leaf.expiresAt - leaf.issuedAt < 363 * DAY, 'התקופה של הבת אכן קצרה משנה (נחתכה בתוקף של ההורה)');
  const act = ACT.evaluate({ state: child.current(), leaf, chain, lastSync: now, now });
  assert.equal(act.steps[0].ok, true, act.steps[0].reason);
  assert.equal(act.ok, true);
});

test('ממצא 1: רישיון עלה קצר שלא נחתך בתוקף ההורה — עדיין "נדרש רישיון שנתי"', () => {
  const parent = { issuedAt: T0, expiresAt: T0 + 365 * DAY };
  const shortLeaf = { issuedAt: T0 + 30 * DAY, expiresAt: T0 + 200 * DAY };
  const act = ACT.evaluate({ state: { mode: 'licensed', status: 'active' }, leaf: shortLeaf, chain: [parent, shortLeaf], lastSync: T0 + 30 * DAY, now: T0 + 30 * DAY });
  assert.equal(act.steps[0].ok, false);
  // וגם הורה קצר (שבעצמו לא שנתי) לא מכשיר את הבת
  const shortParent = { issuedAt: T0, expiresAt: T0 + 100 * DAY };
  const leaf = { issuedAt: T0 + 10 * DAY, expiresAt: T0 + 100 * DAY };
  assert.equal(ACT.evaluate({ state: { mode: 'licensed', status: 'active' }, leaf, chain: [shortParent, leaf], lastSync: T0 + 10 * DAY, now: T0 + 10 * DAY }).steps[0].ok, false);
});

test('ממצא 1: ה-IPC מעביר את השרשרת לבדיקת ההפעלה', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ipc.js'), 'utf8');
  assert.match(src, /ACT\.evaluate\(\{ state: s, leaf, chain,/);
});
