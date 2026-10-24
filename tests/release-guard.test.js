// הפעלת הרישוי (PLAN.md 4.5, חלק א'): חסימת גרסה להפצה בלי מפתח שורש, וכל הזרימה מקצה לקצה —
// על עותק זמני של root-keys.js. הקובץ האמיתי לא נוגעים בו (הרישוי כבוי עד החלטת הבעלים).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../shell/licensing/license');
const { releaseProblems } = require('../tools/release-check');
const { createOwner, rootKeysSource } = require('../tools/licensing/owner');
const { createLicenseStore } = require('../shell/licensing/store');

const ROOT = path.join(__dirname, '..');
const DAY = L.DAY_MS;
const T0 = Date.UTC(2026, 9, 18);
const PASS = 'ohr-hachaim-owner-2026';
const URL_OK = 'https://164-90-184-16.sslip.io';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const mem = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
const limits = { maxChildren: 0, maxUsers: 10, maxStorageMb: 1000, maxDepth: 1 };

function newOwner(clock = () => T0) {
  const o = createOwner({ dir: tmp('ss-rel-owner-'), passphrase: PASS, clock });
  o.init();
  return o;
}

test('בדיקת הפצה: root-keys.js ריק — לא מוכן, עם הפניה למדריך', () => {
  const p = releaseProblems([], URL_OK);
  assert.equal(p.length, 1);
  assert.match(p[0], /root-keys\.js ריק/);
  assert.match(p[0], /LICENSING-ACTIVATION\.md/);
  assert.ok(fs.existsSync(path.join(ROOT, 'docs', 'LICENSING-ACTIVATION.md')), 'המדריך קיים');
});

test('בדיקת הפצה: מפתח פרטי או פגום נדחה; כתובת שרת חסרה או http נדחית', () => {
  const kp = L.generateKeyPair();
  assert.match(releaseProblems([kp.privateJwk], URL_OK)[0], /מפתח פרטי/);
  assert.match(releaseProblems([{ kty: 'OKP' }], URL_OK)[0], /אינו מפתח ציבורי תקין/);
  assert.match(releaseProblems([null], URL_OK)[0], /אינו תקין/);
  assert.match(releaseProblems([kp.publicJwk], '')[0], /שרת הרישוי/);
  assert.match(releaseProblems([kp.publicJwk], 'http://x.example')[0], /https/);
  assert.deepEqual(releaseProblems([kp.publicJwk], URL_OK), []);
});

test('בדיקת הפצה: מפתח שנוצר בכלי הבעלים ונכתב ב-install-root — מוכן', () => {
  const owner = newOwner();
  const file = path.join(tmp('ss-rel-keys-'), 'root-keys.js');
  fs.writeFileSync(file, rootKeysSource([], owner.pubkey()).text);
  const keys = require(file);
  assert.equal(keys.length, 1);
  assert.ok(!('d' in keys[0]));
  assert.deepEqual(releaseProblems(keys, URL_OK), []);
});

test('CI: "גרסה להפצה" היא בחירה ידנית (וגם כל פרסום), והבדיקה רצה רק בהן — לפני הבנייה', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'build.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(yml, /workflow_dispatch:\n\s+inputs:\n\s+release:\n[\s\S]*?type: boolean\n\s+default: false/);
  const build = yml.slice(yml.indexOf('\n  build:'), yml.indexOf('\n  report:'));
  const i = build.indexOf('- name: Release check');
  assert.ok(i > 0);
  // גם בתגית v* ובהפעלה עם publish — מתקין לציבור לא יוצא בלי הבדיקה (בדיקת קוד 23.10.2026, ממצא 33).
  // שאר הבנייה הרגילה (דחיפה ל-master) לא נחסמת כשהרישוי כבוי — tests/audit-ci-tools-tests.test.js
  assert.match(build.slice(i, i + 200), /if: \$\{\{ inputs\.release \|\| inputs\.publish \|\| startsWith\(github\.ref, 'refs\/tags\/v'\) \}\}/);
  assert.match(build.slice(i, i + 300), /node tools\/release-check\.js/);
  assert.ok(i < build.indexOf('- name: Build'), 'לפני electron-builder');
  // לא תלויה בחבילות — ראשונה, ונכשלת בתוך שניות ולא אחרי ההתקנות והבדיקות
  assert.ok(i < build.indexOf('- name: npm install'), 'לפני ההתקנות');
});

test('מקצה לקצה: מפתח בתוכנה ← התקנה נקייה בניסיון ← רישיון ← פעיל', () => {
  let now = T0;
  const owner = newOwner(() => now);
  const file = path.join(tmp('ss-rel-keys-'), 'root-keys.js');
  fs.writeFileSync(file, rootKeysSource([], owner.pubkey()).text);
  const rootKeys = require(file);
  const store = createLicenseStore({ storage: mem(), secret: mem(), rootKeys, clock: () => now });
  const st = store.current();
  assert.equal(st.status, 'active');
  assert.equal(st.trial.daysLeft, 30, 'התקנה נקייה — ניסיון');
  now += 12 * DAY;
  const pkg = owner.issue({ request: store.request('קהילת אור החיים'), features: ['econ', 'econ.npo', 'tools'], limits, months: 12 }).package;
  store.install(pkg);
  store.invalidate();
  const after = store.current();
  assert.equal(after.status, 'active');
  assert.equal(after.trial, undefined);
  assert.deepEqual(after.features, ['econ', 'econ.npo', 'tools']);
});

test('מקצה לקצה: רישיון ממפתח אחר (מזויף) ורישיון למחשב אחר — נדחים, והמחשב נשאר בניסיון', () => {
  const owner = newOwner();
  const rootKeys = [owner.pubkey()];
  const store = createLicenseStore({ storage: mem(), secret: mem(), rootKeys, clock: () => T0 });
  const req = store.request('קהילת אור החיים');
  const forger = newOwner();
  assert.throws(() => store.install(forger.issue({ request: req, features: ['econ'], limits, months: 12 }).package));
  const other = createLicenseStore({ storage: mem(), secret: mem(), rootKeys, clock: () => T0 });
  const otherPkg = owner.issue({ request: other.request('מחשב אחר'), features: ['econ'], limits, months: 12 }).package;
  assert.throws(() => store.install(otherPkg), /למכשיר אחר/);
  assert.ok(store.current().trial);
});

test('מקצה לקצה: משתמש קיים שמעדכן לגרסה עם מפתח — מקבל 30 יום ניסיון, לא ננעל', () => {
  // מצב של גרסה בלי רישוי: אין קובץ רישוי ואין מפתח מכשיר
  const owner = newOwner();
  let now = T0;
  const store = createLicenseStore({ storage: mem(), secret: mem(), rootKeys: [owner.pubkey()], clock: () => now });
  assert.equal(store.current().status, 'active');
  now += 29 * DAY; store.invalidate();
  assert.equal(store.current().status, 'active');
  now += 2 * DAY; store.invalidate();
  assert.equal(store.current().status, 'trial_ended', 'בלי רישיון בתוך 30 יום — צפייה בלבד, לא מחיקה');
});

test('install-root --key: הקובץ ששמר מסך הרישוי נכנס; מפתח פרטי נדחה ולא נכתב', () => {
  const { installRoot } = require('../tools/licensing/owner');
  const dir = tmp('ss-rel-key-');
  const file = path.join(dir, 'root-keys.js');
  fs.writeFileSync(file, 'module.exports = [];\n');
  const owner = newOwner();
  const keyFile = path.join(dir, 'מפתח-ציבורי-מנהל-העל.json');
  fs.writeFileSync(keyFile, JSON.stringify(owner.pubkey()));
  const r = installRoot(dir, file, keyFile);
  assert.equal(r.added, true);
  delete require.cache[require.resolve(file)];
  assert.equal(require(file).length, 1);
  const priv = path.join(dir, 'private.json');
  fs.writeFileSync(priv, JSON.stringify(L.generateKeyPair().privateJwk));
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => installRoot(dir, file, priv), /מפתח פרטי/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.throws(() => installRoot(dir, file, path.join(dir, 'missing.json')), /לא ניתן לקרוא/);
});
