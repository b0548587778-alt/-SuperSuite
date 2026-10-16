// ספק התשלום Cardcom (server/payments/cardcom-provider.js) מול שרת Cardcom מדומה — בלי רשת ובלי חיוב.
// עיקר הבדיקה: webhook לא חתום אינו מספיק — התשלום נקבע רק לפי GetLpResult מ-Cardcom.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCardcomProvider } = require('../server/payments/cardcom-provider');
const { createProvider } = require('../server/payments');
const { createRelay } = require('../server/license-relay');

const ENV = { SS_CARDCOM_TERMINAL: '1000', SS_CARDCOM_API_NAME: 'test-api-name' };
const LP = '11111111-2222-3333-4444-555555555555';

// Cardcom מדומה: שומר את הבקשות, ומחזיר תוצאה לפי מה שהבדיקה קבעה
function fakeCardcom(result) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, body });
    const json = url.endsWith('/LowProfile/Create')
      ? { ResponseCode: 0, Description: 'OK', LowProfileId: LP, Url: 'https://secure.cardcom.solutions/External/LowProfile.aspx?x=1' }
      : result(body);
    return { ok: true, json: async () => json };
  };
  return { calls, fetchImpl };
}
const paidResult = (amount = 1200) => () => ({ ResponseCode: 0, TerminalNumber: 1000, LowProfileId: LP, ReturnValue: 'pay-1',
  TranzactionInfo: { ResponseCode: 0, TranzactionId: 98765, Amount: amount, CoinId: 1, IsRefund: false } });

test('Cardcom: הגדרות חסרות או כתובת לא מאובטחת — לא עולה', () => {
  assert.throws(() => createCardcomProvider({ publicUrl: 'https://lic.example.org', env: {} }), /SS_CARDCOM_TERMINAL/);
  assert.throws(() => createCardcomProvider({ publicUrl: 'https://lic.example.org', env: { SS_CARDCOM_TERMINAL: '1000' } }), /SS_CARDCOM_API_NAME/);
  assert.throws(() => createCardcomProvider({ publicUrl: 'http://lic.example.org', env: ENV }), /https/);
  assert.equal(createProvider('cardcom', { publicUrl: 'https://lic.example.org', env: ENV, fetchImpl: async () => ({}) }).name, 'cardcom');
});

test('Cardcom: יצירת דף תשלום — סכום בשקלים, חשבונית ללקוח, וכתובות חזרה של השרת', async () => {
  const cc = fakeCardcom(paidResult());
  const p = createCardcomProvider({ publicUrl: 'https://lic.example.org/x', env: ENV, fetchImpl: cc.fetchImpl });
  const co = await p.createCheckout({ paymentId: 'pay-1', amountAgorot: 120000, description: 'רישיון שנתי — קהילת אור',
    customer: { org: 'קהילת אור', taxId: '580000000', email: 'office@example.org', phone: '0501234567' } });
  assert.equal(co.checkoutId, LP);
  const b = cc.calls[0].body;
  assert.equal(cc.calls[0].url, 'https://secure.cardcom.solutions/api/v11/LowProfile/Create');
  assert.equal(b.TerminalNumber, 1000);
  assert.equal(b.Amount, 1200);
  assert.equal(b.ReturnValue, 'pay-1');
  assert.equal(b.WebHookUrl, 'https://lic.example.org/pay/webhook');
  assert.equal(b.SuccessRedirectUrl, 'https://lic.example.org/pay/done');
  assert.equal(b.Document.Name, 'קהילת אור');
  assert.equal(b.Document.Products[0].UnitCost, 1200);
  await assert.rejects(p.createCheckout({ paymentId: 'x', amountAgorot: 12.5 }), /סכום/);
});

test('Cardcom: webhook — רק מזהה העסקה נלקח ממנו; התוצאה מ-GetLpResult', async () => {
  const cc = fakeCardcom(paidResult());
  const p = createCardcomProvider({ publicUrl: 'https://lic.example.org', env: ENV, fetchImpl: cc.fetchImpl });
  // ההודעה טוענת לסכום אחר — לא משנה: הסכום מ-Cardcom
  const ev = await p.parseWebhook({ rawBody: JSON.stringify({ LowProfileId: LP, TranzactionInfo: { Amount: 1 } }), headers: {} });
  assert.deepEqual({ ...ev }, { checkoutId: LP, status: 'paid', amountAgorot: 120000, providerRef: '98765', paymentId: 'pay-1' });
  assert.equal(cc.calls[0].url, 'https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult');
  assert.deepEqual(cc.calls[0].body, { TerminalNumber: 1000, ApiName: 'test-api-name', LowProfileId: LP });
  // גם בטופס
  assert.equal((await p.parseWebhook({ rawBody: 'lowprofilecode=' + LP })).status, 'paid');
  await assert.rejects(p.parseWebhook({ rawBody: '{"LowProfileId":"../evil"}' }), /מזהה עסקה/);
});

test('Cardcom: כרטיס שנדחה — ממתין (אפשר לנסות שוב); מסוף אחר או מטבע אחר — נדחה', async () => {
  const mk = (result) => createCardcomProvider({ publicUrl: 'https://lic.example.org', env: ENV, fetchImpl: fakeCardcom(result).fetchImpl });
  const raw = JSON.stringify({ LowProfileId: LP });
  assert.equal((await mk(() => ({ ResponseCode: 0, TerminalNumber: 1000, LowProfileId: LP, TranzactionInfo: { ResponseCode: 33 } })).parseWebhook({ rawBody: raw })).status, 'pending');
  assert.equal((await mk(() => ({ ResponseCode: 0, TerminalNumber: 1000, LowProfileId: LP, TranzactionInfo: null })).parseWebhook({ rawBody: raw })).status, 'pending');
  await assert.rejects(mk(() => ({ ResponseCode: 0, TerminalNumber: 2000, LowProfileId: LP, TranzactionInfo: { ResponseCode: 0, Amount: 1 } })).parseWebhook({ rawBody: raw }), /המסוף/);
  await assert.rejects(mk(() => ({ ResponseCode: 0, TerminalNumber: 1000, LowProfileId: LP, TranzactionInfo: { ResponseCode: 0, Amount: 1, CoinId: 2 } })).parseWebhook({ rawBody: raw }), /שקלים/);
  await assert.rejects(mk(() => ({ ResponseCode: 5, Description: 'not found' })).parseWebhook({ rawBody: raw }), /not found/);
});

test('שרת הרישוי עם Cardcom: תשלום נקלט רק אחרי אימות, סכום שונה נדחה, ניסיון כושל לא נועל', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-cc-'));
  let result = paidResult(1200);
  const provider = createCardcomProvider({ publicUrl: 'https://lic.example.org', env: ENV, fetchImpl: fakeCardcom((b) => result(b)).fetchImpl });
  const rootKeys = [require('../shell/licensing/license').generateKeyPair().publicJwk];
  const relay = createRelay({ dataDir: dir, billing: { rootKeys, provider } });
  const pending = { id: 'pay-1', keyId: 'k', signupId: 's', amountAgorot: 120000, checkoutId: LP, status: 'pending', createdAt: Date.now(),
    signup: '{}' };
  fs.writeFileSync(path.join(dir, 'payments.json'), JSON.stringify([pending]));
  const raw = { rawBody: JSON.stringify({ LowProfileId: LP }), headers: {} };
  const status = () => JSON.parse(fs.readFileSync(path.join(dir, 'payments.json'), 'utf8'))[0].status;

  result = () => ({ ResponseCode: 0, TerminalNumber: 1000, LowProfileId: LP, TranzactionInfo: { ResponseCode: 33 } });
  assert.deepEqual(await relay.webhook(raw), { ok: true, pending: true });
  assert.equal(status(), 'pending', 'כרטיס שנדחה לא נועל את התשלום');

  result = paidResult(1);
  await assert.rejects(relay.webhook(raw), /אינו תואם/);
  assert.equal(status(), 'pending');

  result = paidResult(1200);
  assert.deepEqual(await relay.webhook(raw), { ok: true });
  assert.equal(status(), 'paid');
  assert.deepEqual(await relay.webhook(raw), { ok: true, duplicate: true });
});
