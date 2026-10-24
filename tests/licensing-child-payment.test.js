// כל מערכת משלמת להורה שלה: בקשת אישור לרישיון של מערכת בת (בקובץ או דרך השרת) — רק אחרי תשלום שנתי
// שנרשם במסך הגבייה של ההורה. תשלום משמש לבקשה אחת בלבד — חידוש דורש תשלום חדש.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../shell/licensing/license');
const P = require('../modules/econ/core/collect');
const { markActivated } = require('./helpers/activation');

const DAY = 86400000;
const T0 = Date.UTC(2026, 9, 1);

const handlers = {};
// חלון השמירה של קובץ בקשת האישור: saveTo = null ← המשתמש ביטל
const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-pay-save-'));
test.after(() => fs.rmSync(saveDir, { recursive: true, force: true }));
let saveTo = null;
// נקרא בזמן שחלון השמירה פתוח (החלון רץ מחוץ לתור — בדיקת קוד 23.10.2026, ממצא 39)
let onSave = null;
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_pay__.js' : origResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_pay__.js'] = { id: '/__electron_stub_pay__.js', filename: '/__electron_stub_pay__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    dialog: { showSaveDialog: async () => {
      if (onSave) await onSave();
      return saveTo ? { canceled: false, filePath: saveTo } : { canceled: true };
    } } } };
const ipc = require('../modules/econ/ipc');
const ev = { sender: { id: 41 } };

function childRequest(name) {
  const k = L.generateKeyPair();
  return { type: 'supersuite-license-request', v: 1, name, publicKey: k.publicJwk, keyId: L.keyId(k.publicJwk) };
}

async function parentSystem() {
  const root = L.generateKeyPair();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-pay-'));
  const now = T0 + DAY;
  let secret = null;
  await ipc.initEcon(dir, { rootKeys: [root.publicJwk], clock: () => now, licenseSecret: { read: () => secret, write: (t) => { secret = t; } } });
  await handlers['auth:setup'](ev, 'menahel_pay', 'a-very-long-pass-2026');
  // המערכת מבקשת רישיון, ומקבלת רישיון שנתי עם מכסה למערכות בת
  const req = JSON.parse(await handlers['license:getRequest'](ev, 'קהילת אור'));
  const lic = L.issueLicense({ privateJwk: root.privateJwk }, { name: 'קהילת אור', publicKey: req.publicKey, slot: 1,
    features: ['econ', 'tools'], limits: { maxChildren: 3, maxUsers: 5, maxStorageMb: 1000, maxDepth: 3 },
    issuedAt: T0, expiresAt: T0 + 3 * 365 * DAY, graceDays: 7 });
  await handlers['license:install'](ev, JSON.stringify({ type: 'supersuite-license', v: 1, chain: [lic], notices: [] }));
  // המפתח נוצר כאן (בקשת הרישיון) — הזמן נרשם גם בשומר, כמו בסנכרון אמיתי (ממצא 28)
  markActivated(dir, now, { read: () => secret, write: (t) => { secret = t; } });
  ipc.invalidateLicense();
  return { dir, now };
}

const terms = { features: ['econ'], limits: { maxUsers: 2, maxChildren: 0, maxStorageMb: 100, maxDepth: 1 } };

test('דרישת תשלום על רישיון: קוד מערכת ותקופה של שנה לפחות', () => {
  const settings = P.normalizeSettings({});
  assert.throws(() => P.createRequest({ kind: 'license', targetId: 'קצר', amount: 100, payerName: 'סניף' }, settings, 0), /קוד מערכת הבת/);
  assert.throws(() => P.createRequest({ kind: 'license', targetId: 'A'.repeat(22), months: 6, amount: 100, payerName: 'סניף' }, settings, 0), /12–60/);
  const { req } = P.createRequest({ kind: 'license', targetId: 'A'.repeat(22), amount: 100, payerName: 'סניף' }, settings, 0);
  assert.deepEqual(req.target, { kind: 'license', id: 'A'.repeat(22), months: 12 });
});

test('ipc: בקשת אישור למערכת בת נחסמת עד שהתשלום מתקבל, ומשמשת פעם אחת בלבד', async () => {
  const { now } = await parentSystem();
  const req = childRequest('סניף בית שמש');
  const text = JSON.stringify(req);

  // בלי דרישת תשלום — חסום
  await assert.rejects(handlers['license:requestChildApproval'](ev, { request: text, ...terms }), /דרישת תשלום על הרישיון השנתי/);
  // דרישת רישיון לא נוצרת ממסך הגבייה הכללי
  await assert.rejects(handlers['collect:createRequest'](ev, { kind: 'license', targetId: req.keyId, amount: 100, payerName: 'x' }), /ממסך הרישוי/);

  const pay = await handlers['license:childPaymentRequest'](ev, { request: text, amount: 1200, months: 24 });
  assert.equal(pay.kind, 'license');
  assert.equal(pay.amountAg, 120000);
  assert.equal(pay.target.id, req.keyId);
  assert.match(pay.description, /סניף בית שמש/);
  // דרישה פתוחה כפולה — נחסמת
  await assert.rejects(handlers['license:childPaymentRequest'](ev, { request: text, amount: 1200 }), /כבר קיימת דרישה פתוחה/);
  await assert.rejects(handlers['license:requestChildApproval'](ev, { request: text, ...terms }), new RegExp(`${pay.ref} עדיין ממתינה לתשלום`));

  await handlers['collect:markPaid'](ev, pay.id, { date: '2026-10-02', txId: 'T-77' });
  const st = await handlers['license:childPaymentStatus'](ev, req.keyId);
  assert.equal(st.ready, true);

  // ביטול חלון השמירה — התשלום לא נוצל (בדיקת קוד 23.10.2026: תשלום אבד כשהקובץ לא נשמר)
  saveTo = null;
  const cancelled = await handlers['license:requestChildApproval'](ev, { request: text, ...terms });
  assert.equal(cancelled.saved, false);
  assert.equal((await handlers['license:childPaymentStatus'](ev, req.keyId)).ready, true, 'התשלום נשאר זמין');

  // התנאים מהטופס, התוקף — לפי מה ששולם (גם אם בטופס ביקשו אחרת)
  saveTo = path.join(saveDir, 'request.sslic');
  const r = await handlers['license:requestChildApproval'](ev, { request: text, ...terms, months: 60 });
  assert.equal(r.saved, true);
  assert.equal(fs.readFileSync(saveTo, 'utf8'), r.package, 'קובץ הבקשה נשמר בערוץ עצמו');
  const child = JSON.parse(r.package).child;
  assert.equal(child.expiresAt - now, 730 * DAY);

  // התשלום נוצל — חידוש/בקשה נוספת דורשים תשלום חדש
  assert.equal(await handlers['license:childPaymentStatus'](ev, req.keyId), null);
  await assert.rejects(handlers['license:requestChildApproval'](ev, { request: text, ...terms }), /דרישת תשלום על הרישיון השנתי/);
  const overview = await handlers['collect:getOverview'](ev);
  const used = overview.requests.find(x => x.id === pay.id);
  assert.equal(used.usedFor.childId, req.keyId);
  assert.ok(used.usedAt);
});

test('ipc: חלון השמירה של בקשת האישור מחוץ לתור; בקשה שנייה נחסמת; תשלום שנוצל בינתיים — בלי קובץ (ממצא 39)', async () => {
  await parentSystem();
  const req = childRequest('סניף ביתר');
  const text = JSON.stringify(req);
  const pay = await handlers['license:childPaymentRequest'](ev, { request: text, amount: 1200 });
  await handlers['collect:markPaid'](ev, pay.id, {});
  saveTo = path.join(saveDir, 'busy.sslic');
  let ran = false;
  onSave = async () => {
    // התור פנוי: ערוץ אחר עונה בזמן שהחלון פתוח (בתוך התור זה היה נתקע עד סגירת החלון)
    const ov = await handlers['collect:getOverview'](ev);
    assert.ok(ov.requests.some(x => x.id === pay.id));
    // בקשה נוספת על אותו תשלום — בקובץ או דרך השרת — נחסמת עד שהראשונה מסתיימת
    await assert.rejects(handlers['license:requestChildApproval'](ev, { request: text, ...terms }), /כבר מתבצעת/);
    await assert.rejects(handlers['license:remoteForwardChild'](ev, { keyId: req.keyId, ...terms }), /כבר מתבצעת/);
    ran = true;
  };
  try {
    const r = await handlers['license:requestChildApproval'](ev, { request: text, ...terms });
    assert.equal(r.saved, true);
    assert.ok(ran);
    assert.equal(fs.readFileSync(saveTo, 'utf8'), r.package);
  } finally { onSave = null; }

  // התשלום נוצל בזמן שהחלון היה פתוח — הבקשה נכשלת, בלי קובץ
  const req2 = childRequest('סניף מודיעין');
  const text2 = JSON.stringify(req2);
  const pay2 = await handlers['license:childPaymentRequest'](ev, { request: text2, amount: 1200 });
  await handlers['collect:markPaid'](ev, pay2.id, {});
  const usedFile = path.join(saveDir, 'used.sslic');
  saveTo = usedFile;
  onSave = async () => {
    const db = ipc.getDb();
    const data = await db.load();
    const r = data.payments.requests.find(x => x.id === pay2.id);
    r.usedAt = new Date().toISOString();
    r.usedFor = { childId: 'אחר' };
    await db.save(data);
  };
  try {
    await assert.rejects(handlers['license:requestChildApproval'](ev, { request: text2, ...terms }), /דרישת תשלום/);
  } finally { onSave = null; saveTo = null; }
  assert.equal(fs.existsSync(usedFile), false, 'בלי קובץ בקשה');
});

test('ipc: בקשה ממערכת בת דרך השרת — מצב התשלום מוצג ליד הבקשה', async () => {
  const { dir } = await parentSystem();
  const req = childRequest('סניף אלעד');
  const file = path.join(dir, 'license.json');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  d.remote = { ...d.remote, pendingChildRequests: [{ keyId: req.keyId, name: req.name, at: T0, body: JSON.stringify(req) }] };
  fs.writeFileSync(file, JSON.stringify(d));
  ipc.invalidateLicense();

  let remote = await handlers['license:getRemote'](ev);
  assert.equal(remote.pending[0].payment, null);
  // השליחה לאישור חסומה לפני תשלום (ולא פונה לשרת בכלל)
  await assert.rejects(handlers['license:remoteForwardChild'](ev, { keyId: req.keyId, ...terms }), /דרישת תשלום/);

  const pay = await handlers['license:childPaymentRequest'](ev, { keyId: req.keyId, amount: 600 });
  assert.equal(pay.payerName, 'סניף אלעד', 'השם נלקח מהבקשה שהגיעה');
  remote = await handlers['license:getRemote'](ev);
  assert.equal(remote.pending[0].payment.ref, pay.ref);
  assert.equal(remote.pending[0].payment.ready, false);
  await handlers['collect:markPaid'](ev, pay.id, {});
  remote = await handlers['license:getRemote'](ev);
  assert.equal(remote.pending[0].payment.ready, true);
});
