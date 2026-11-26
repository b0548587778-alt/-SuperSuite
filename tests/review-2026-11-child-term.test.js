'use strict';
// רגרסיה לסקירת הקוד מ-2.11.2026, נושא 2 (ממצא f2) — מערכת בת שהונפקה באיחור (התוקף מוגבל לתוקף ההורה)
// לא ננעלת בתנאי ההפעלה "רישיון שנתי". החלטת הבעלים: פטור כשהתוקף שלה הוא בדיוק התוקף של הרישיון שמעליה
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-child-term-'));
test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* run-tests מנקה */ } });
const mem = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
const tenantLimits = { maxChildren: 2, maxUsers: 10, maxStorageMb: 1000, maxDepth: 3 };
const childLimits = { maxChildren: 1, maxUsers: 3, maxStorageMb: 100, maxDepth: 3 };

function world() {
  let now = T0;
  const clock = () => now;
  const owner = createOwner({ dir: fs.mkdtempSync(path.join(tmp, 'o-')), passphrase: 'ohr-hachaim-owner-2026', clock });
  owner.init();
  const rootKeys = [owner.pubkey()];
  const store = () => createLicenseStore({ storage: mem(), secret: mem(), rootKeys, clock });
  const tenant = store();
  tenant.install(owner.issue({ request: tenant.request('רשת'), features: ['econ', 'shamai'], limits: tenantLimits, months: 12 }).package);
  const issueChild = (parent, name, limits, months = 12) => {
    const child = store();
    const req = parent.requestChildApproval({ request: child.request(name), features: ['econ', 'shamai'], limits, months });
    child.install(parent.issueChild({ approval: owner.approve({ request: req.package }).package }).package);
    return child;
  };
  return { setNow: (t) => { now = t; }, clock, tenant, issueChild };
}
const evalFor = (s, now) => ACT.evaluate({ state: s.current(), leaf: s.leafPayload(), chain: s.chainPayloads(), lastSync: now, now });

test('f2: מערכת בת שהונפקה 31 יום אחרי ההורה (תוקף 334 יום, מוגבל להורה) — לא ננעלת', () => {
  const w = world();
  w.setNow(T0 + 31 * DAY);
  const child = w.issueChild(w.tenant, 'סניף', childLimits);
  const leaf = child.leafPayload();
  assert.ok(leaf.expiresAt - leaf.issuedAt < 363 * DAY, 'התרחיש: תוקף קצר משנה');
  const act = evalFor(child, T0 + 31 * DAY);
  assert.equal(act.ok, true, JSON.stringify(act.steps));
  // גם דור שלישי (נכד) שמוגבל באותה צורה
  w.setNow(T0 + 60 * DAY);
  const grand = w.issueChild(child, 'כיתה', { ...childLimits, maxChildren: 0 });
  assert.equal(evalFor(grand, T0 + 60 * DAY).ok, true);
});

test('f2: רישיון קצר שאינו מוגבל להורה — עדיין נעול (התנאי לא בוטל)', () => {
  const short = { id: 'a', issuedAt: T0, expiresAt: T0 + 200 * DAY };
  const parent = { id: 'p', issuedAt: T0, expiresAt: T0 + 365 * DAY };
  const state = { mode: 'licensed', status: 'active' };
  assert.equal(ACT.evaluate({ state, leaf: short, chain: [parent, short], lastSync: T0, now: T0 }).ok, false);
  // מוגבל להורה שגם הוא קצר (ולא מוגבל לאף אחד) — נעול
  const p2 = { id: 'p', issuedAt: T0, expiresAt: T0 + 200 * DAY };
  const c2 = { id: 'c', issuedAt: T0 + DAY, expiresAt: T0 + 200 * DAY };
  assert.equal(ACT.evaluate({ state, leaf: c2, chain: [p2, c2], lastSync: T0, now: T0 + DAY }).ok, false);
  // בלי שרשרת (קריאה ישנה) — כמו קודם
  assert.equal(ACT.evaluate({ state, leaf: short, lastSync: T0, now: T0 }).ok, false);
});
