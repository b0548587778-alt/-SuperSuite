'use strict';
// רגרסיה לסקירת הקוד (23.10.2026) — שרת הרישוי: האזנה רק ל-localhost, תשלום מאוחר, ומפתחות זמניים בקובץ לכל מערכת
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../shell/licensing/license');
const PK = require('../shell/licensing/prekeys');
const { createCardcomProvider } = require('../server/payments/cardcom-provider');
const { createRelay } = require('../server/license-relay');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-review-relay-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const newDir = () => fs.mkdtempSync(path.join(tmp, 'r-'));

let seq = 0;
const signed = (k, op, payload, ts = Date.now()) => {
  const req = { pub: L.publicOf(k.privateJwk), ts, nonce: 'review-nonce-' + (++seq) + '-abcdef', op, payload };
  req.sig = L.signObject({ pub: req.pub, ts: req.ts, nonce: req.nonce, op, payload }, k.privateJwk);
  return req;
};

test('שירות systemd בלי Docker: מאזין ל-127.0.0.1 בלבד (מאחורי Caddy), כמו השירות ב-server/deploy', () => {
  for (const f of ['deploy/relay/supersuite-relay.service', 'server/deploy/supersuite-relay.service']) {
    const unit = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const exec = unit.split(/\r?\n/).find(l => l.startsWith('ExecStart='));
    assert.match(exec, /--host 127\.0\.0\.1/, f);
  }
});

const ENV = { SS_CARDCOM_TERMINAL: '1000', SS_CARDCOM_API_NAME: 'test-api-name' };
const LP = '11111111-2222-3333-4444-555555555555';
const DAY = 24 * 60 * 60 * 1000;

test('תשלום שהושלם אחרי שפג (יותר מ-24 שעות) — הרישיון עדיין נמסר', async () => {
  const dir = newDir();
  let result = () => ({ ResponseCode: 0, TerminalNumber: 1000, LowProfileId: LP, ReturnValue: 'pay-1',
    TranzactionInfo: { ResponseCode: 0, TranzactionId: 1, Amount: 1200, CoinId: 1, IsRefund: false } });
  const fetchImpl = async (url, opts) => ({ ok: true, json: async () => result(JSON.parse(opts.body)) });
  const provider = createCardcomProvider({ publicUrl: 'https://lic.example.org', env: ENV, fetchImpl });
  const relay = createRelay({ dataDir: dir, billing: { rootKeys: [L.generateKeyPair().publicJwk], provider } });
  const old = { id: 'pay-1', keyId: 'k', signupId: 's', amountAgorot: 120000, checkoutId: LP, status: 'expired', createdAt: Date.now() - 2 * DAY, signup: '{}' };
  fs.writeFileSync(path.join(dir, 'payments.json'), JSON.stringify([old]));
  const raw = { rawBody: JSON.stringify({ LowProfileId: LP }), headers: {} };
  const status = () => JSON.parse(fs.readFileSync(path.join(dir, 'payments.json'), 'utf8'))[0].status;
  assert.deepEqual(await relay.webhook(raw), { ok: true });
  assert.equal(status(), 'paid', 'תשלום שפג ושולם — לא "התשלום לא נמצא"');
  assert.deepEqual(await relay.webhook(raw), { ok: true, duplicate: true });
});

test('מפתח זמני: מזהה ארוך (ריפוד) נדחה; כל מערכת בקובץ משלה; קובץ ישן מפוצל', () => {
  const dir = newDir();
  const a = L.generateKeyPair(), b = L.generateKeyPair();
  // קובץ ישן מגרסה קודמת — נקרא ומפוצל בבקשה הראשונה
  const legacyBundle = PK.createPrekeyStore({ storage: { read: () => null, write: () => {} } }).bundle(b.privateJwk);
  fs.writeFileSync(path.join(dir, 'prekeys.json'), JSON.stringify({ [b.keyId]: legacyBundle }));
  const relay = createRelay({ dataDir: dir });
  assert.deepEqual(relay.handle(signed(a, 'getPrekey', { id: b.keyId })).bundle, legacyBundle);
  assert.ok(!fs.existsSync(path.join(dir, 'prekeys.json')));

  const bundle = PK.createPrekeyStore({ storage: { read: () => null, write: () => {} } }).bundle(a.privateJwk);
  const { sig, ...p } = bundle;
  const padded = { ...p, id: 'x'.repeat(600) };
  assert.throws(() => relay.handle(signed(a, 'setPrekey', { bundle: { ...padded, sig: L.signObject(padded, a.privateJwk) } })), /לא תקין/);
  assert.equal(relay.handle(signed(a, 'setPrekey', { bundle })).ok, true);
  assert.ok(fs.existsSync(path.join(dir, 'prekeys', a.keyId + '.json')));
  assert.deepEqual(relay.handle(signed(b, 'getPrekey', { id: a.keyId })).bundle, bundle);
});
