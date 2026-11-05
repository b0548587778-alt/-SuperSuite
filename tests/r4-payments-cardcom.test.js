// אימות תשלום הרשמה במחשב של מנהל-העל — ישירות מול Cardcom (GetLpResult), החלטת הבעלים 5.11.2026.
// אישור התשלום שמגיע משרת הרישוי אינו חתום; פרטי המסוף נשמרים מוצפנים במפתח השורש ולא נשלחים לשרת.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-r4-cardcom-'));
let seq = 0;
const mk = (name) => { const d = path.join(tmp, name + '-' + (++seq)); fs.mkdirSync(d, { recursive: true }); return d; };

const handlers = {};
const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_r4_cardcom__.js' : resolve.call(this, req, ...rest); };
require.cache['/__electron_stub_r4_cardcom__.js'] = { id: '/__electron_stub_r4_cardcom__.js', filename: '/__electron_stub_r4_cardcom__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) } } };

const CC = require('../shell/licensing/owner-cardcom');
const OC = require('../shell/licensing/owner-core');
const ipc = require('../modules/econ/ipc');

test.after(() => {
  try { ipc.getDb().db.close(); } catch { /* כבר סגור */ }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const LP = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const API = 'SecretApiName-XYZ987';
const CREDS = { terminal: 1000123, apiName: API };
const PAYMENT = { id: 'pay-1', checkoutId: LP, amountAgorot: 49900, providerRef: '777001', provider: 'cardcom' };
// תשובת GetLpResult (API v11) — עסקה מוצלחת; over משנה שדות
const lpResult = (over = {}, tOver = {}) => ({ ResponseCode: 0, Description: 'OK', TerminalNumber: 1000123, LowProfileId: LP, ReturnValue: 'pay-1',
  TranzactionInfo: { ResponseCode: 0, TranzactionId: 777001, Amount: 499, CoinId: 1, IsRefund: false, ...tOver }, ...over });
const okFetch = (body, calls = []) => async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => body }; };

/* ---------- הבדיקה עצמה (טהורה, fetch מדומה) ---------- */

test('Cardcom: עסקה מוצלחת בסכום ובמזהים התואמים — אומת; הפנייה ל-GetLpResult עם פרטי המסוף', async () => {
  const calls = [];
  const r = await CC.verifyCardcomPayment({ creds: CREDS, payment: PAYMENT, fetchImpl: okFetch(lpResult(), calls) });
  assert.equal(r.status, 'verified');
  assert.equal(r.amountAgorot, 49900);
  assert.equal(r.tranzactionId, '777001');
  assert.match(r.message, /אומת מול Cardcom/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { TerminalNumber: 1000123, ApiName: API, LowProfileId: LP });
  assert.ok(calls[0].init.signal, 'זמן קצוב');
});

test('Cardcom: סכום שונה — לא תואם (גם בעיגול של אגורה)', async () => {
  const r = await CC.verifyCardcomPayment({ creds: CREDS, payment: PAYMENT, fetchImpl: okFetch(lpResult({}, { Amount: 4.99 })) });
  assert.equal(r.status, 'mismatch');
  assert.match(r.message, /לפי Cardcom שולמו .*4\.99.* ולא .*499\.00/);
  const r2 = await CC.verifyCardcomPayment({ creds: CREDS, payment: PAYMENT, fetchImpl: okFetch(lpResult({}, { Amount: 498.99 })) });
  assert.equal(r2.status, 'mismatch');
});

test('Cardcom: לא שולם / זיכוי — לא שולם; עסקה של תשלום אחר, מסוף אחר, מטבע זר או אסמכתה אחרת — לא תואם', async () => {
  const st = async (o, t) => (await CC.verifyCardcomPayment({ creds: CREDS, payment: PAYMENT, fetchImpl: okFetch(lpResult(o, t)) })).status;
  assert.equal(await st({}, { ResponseCode: 33 }), 'unpaid');
  assert.equal(await st({ TranzactionInfo: null }), 'unpaid');
  assert.equal(await st({}, { IsRefund: true }), 'unpaid');
  assert.equal(await st({ ReturnValue: 'pay-other' }), 'mismatch');
  assert.equal(await st({ TerminalNumber: 999 }), 'mismatch');
  assert.equal(await st({ LowProfileId: '00000000-0000-4000-8000-000000000000' }), 'mismatch');
  assert.equal(await st({}, { CoinId: 2 }), 'mismatch');
  assert.equal(await st({}, { TranzactionId: 1 }), 'mismatch');
});

test('Cardcom: רשת / שגיאה / הרשמה ישנה בלי מזהה עסקה — "לא נבדק" (חזרה לאישור ידני) עם הסבר בעברית', async () => {
  const down = await CC.verifyCardcomPayment({ creds: CREDS, payment: PAYMENT, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  assert.equal(down.status, 'unavailable');
  assert.match(down.message, /אין חיבור לשרת Cardcom/);
  const http = await CC.verifyCardcomPayment({ creds: CREDS, payment: PAYMENT, fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  assert.equal(http.status, 'unavailable');
  const bad = await CC.verifyCardcomPayment({ creds: CREDS, payment: PAYMENT, fetchImpl: okFetch({ ResponseCode: 5, Description: 'Invalid ApiName' }) });
  assert.equal(bad.status, 'unavailable');
  assert.match(bad.message, /Invalid ApiName.*פרטי המסוף/);
  let called = 0;
  const old = await CC.verifyCardcomPayment({ creds: CREDS, payment: { ...PAYMENT, checkoutId: undefined }, fetchImpl: async () => { called++; return null; } });
  assert.equal(old.status, 'unavailable');
  assert.match(old.message, /אין מזהה עסקה/);
  assert.equal(called, 0, 'בלי מזהה — בלי פנייה');
  for (const m of [down, http, bad, old]) assert.match(m.message, /[א-ת]/);
});

test('פרטי המסוף: קלט לא תקין נדחה בעברית', () => {
  assert.throws(() => CC.normalizeCardcomCredentials({ terminal: 'abc', apiName: 'x' }), /מספר המסוף/);
  assert.throws(() => CC.normalizeCardcomCredentials({ terminal: '1000', apiName: '' }), /שם ה-API/);
  assert.throws(() => CC.normalizeCardcomCredentials({ terminal: '1000', apiName: 'a\nb' }), /שם ה-API/);
  assert.deepEqual(CC.normalizeCardcomCredentials({ terminal: ' 1000 ', apiName: ' n ' }), { terminal: 1000, apiName: 'n' });
});

/* ---------- ההחלטה לפני הנפקה ---------- */

test('signupPaymentCode: אומת ← מותר; לא תואם / לא שולם ← חסום גם עם אישור ידני; מוגדר ולא נבדק ← אימות; לא נבדק ← ידני', () => {
  const x = { payment: PAYMENT };
  assert.equal(OC.signupPaymentCode({ ...x, paymentCheck: { status: 'verified', amountAgorot: 49900 } }, { verifyConfigured: true }), null);
  const rej = OC.signupPaymentCode({ ...x, paymentCheck: { status: 'mismatch', message: 'הסכום שונה' } }, { paymentConfirmed: true });
  assert.equal(rej.code, OC.PAYMENT_REJECTED);
  assert.match(rej.message, /התשלום לא אומת מול Cardcom: הסכום שונה/);
  assert.equal(OC.signupPaymentCode({ ...x, paymentCheck: { status: 'unpaid' } }, { paymentConfirmed: true }).code, OC.PAYMENT_REJECTED);
  assert.equal(OC.signupPaymentCode(x, { verifyConfigured: true, paymentConfirmed: true }).code, OC.PAYMENT_UNVERIFIED, 'מוגדר — אישור ידני לא עוקף בדיקה שלא נעשתה');
  const un = OC.signupPaymentCode({ ...x, paymentCheck: { status: 'unavailable', message: 'אין חיבור לשרת Cardcom' } }, { verifyConfigured: true });
  assert.equal(un.code, OC.PAYMENT_UNCONFIRMED);
  assert.match(un.message, /נדרש אימות התשלום: האימות מול Cardcom לא הושלם \(אין חיבור/);
  assert.equal(OC.signupPaymentCode({ ...x, paymentCheck: { status: 'unavailable' } }, { verifyConfigured: true, paymentConfirmed: true }), null);
  // בלי פרטי Cardcom — כמו קודם
  assert.equal(OC.signupPaymentCode(x).code, OC.PAYMENT_UNCONFIRMED);
  assert.equal(OC.signupPaymentCode(x, { paymentConfirmed: true }), null);
  // "אומת" בסכום אחר מהתשלום — לא נחשב
  assert.equal(OC.signupPaymentCode({ ...x, paymentCheck: { status: 'verified', amountAgorot: 100 } }, { verifyConfigured: true, paymentConfirmed: true }), null,
    'אומת בסכום אחר ← לא "אומת"; עם פרטים ובדיקה קיימת — חוזר לאישור הידני');
});

/* ---------- אחסון: מוצפן במפתח השורש, לא גלוי בדיסק ---------- */

const PASS = 'menahel-al-cardcom-2026';
const filesText = (dir) => fs.readdirSync(dir).map(n => fs.readFileSync(path.join(dir, n), 'utf8')).join('\n');

test('פרטי המסוף: מוצפנים בדיסק (SSOW1), שם ה-API לא יוצא במצב, נכללים בגיבוי המלא, ונקראים רק כשפתוח', () => {
  const dir = mk('owner');
  const o = OC.createOwnerCore({ storage: OC.dirStorage(fs, path, dir) });
  o.init(PASS);
  assert.deepEqual(o.paymentProviderInfo(), { cardcom: { configured: false } });
  const info = o.setCardcomCredentials({ terminal: '1000123', apiName: API });
  assert.deepEqual(info, { cardcom: { configured: true, terminal: 1000123 } });
  assert.ok(OC.SEALED_OWNER_FILES.includes('payment-provider.json'));
  const raw = fs.readFileSync(path.join(dir, 'payment-provider.json'), 'utf8');
  assert.ok(raw.startsWith(OC.OWNER_SEAL_PREFIX));
  assert.ok(!filesText(dir).includes(API), 'שם ה-API לא גלוי באף קובץ');
  assert.ok(!filesText(dir).includes('1000123'), 'גם מספר המסוף לא גלוי');
  assert.deepEqual(o.cardcomCredentials(), CREDS);
  const backup = o.exportBackup('backup-pass-12345');
  o.lock();
  assert.throws(() => o.cardcomCredentials(), /לפתוח את מצב מנהל-העל/);
  // שחזור במחשב אחר
  const dir2 = mk('owner2');
  const o2 = OC.createOwnerCore({ storage: OC.dirStorage(fs, path, dir2) });
  o2.importBackup(backup, 'backup-pass-12345');
  assert.ok(!filesText(dir2).includes(API));
  o2.unlock(PASS);
  assert.deepEqual(o2.cardcomCredentials(), CREDS);
  o2.clearCardcomCredentials();
  assert.equal(o2.cardcomCredentials(), null);
});

test('תוצאת האימות בהרשמה: עסקה שאימתה הרשמה אחרת לא מאמתת שוב; בדיקה שנכשלה ברשת לא מבטלת אימות', () => {
  const dir = mk('owner-checks');
  const st = OC.dirStorage(fs, path, dir);
  const o = OC.createOwnerCore({ storage: st });
  o.init(PASS);
  st.write('signups.json', JSON.stringify([{ id: 'a', customer: { org: 'א' }, payment: PAYMENT, status: 'new' },
    { id: 'b', customer: { org: 'ב' }, payment: { ...PAYMENT, id: 'pay-2' }, status: 'new' }]));
  const ok = { status: 'verified', message: 'אומת', lowProfileId: LP, tranzactionId: '777001', amountAgorot: 49900 };
  assert.equal(o.setSignupPaymentCheck('a', ok).status, 'verified');
  const b = o.setSignupPaymentCheck('b', ok);
  assert.equal(b.status, 'mismatch');
  assert.match(b.message, /כבר אימתה הרשמה אחרת/);
  assert.equal(o.setSignupPaymentCheck('a', { status: 'unavailable', message: 'אין חיבור' }).status, 'verified');
  assert.equal(o.signups().find(x => x.id === 'a').paymentCheck.status, 'verified');
  assert.ok(fs.readFileSync(path.join(dir, 'signups.json'), 'utf8').startsWith(OC.OWNER_SEAL_PREFIX));
});

/* ---------- דרך ipc.js האמיתי (handleNet, fetchImpl מדומה) ---------- */

const ev = (id) => ({ sender: { id } });
let net = { mode: 'ok', body: lpResult(), calls: [] };
const fetchImpl = async (url, init) => {
  net.calls.push({ url, init });
  if (net.mode === 'down') throw new Error('ENOTFOUND');
  return { ok: true, status: 200, json: async () => net.body };
};
let ownerDir;
test.before(async () => {
  ownerDir = mk('ipc-owner');
  await ipc.initEcon(mk('econ'), { rootKeys: [], relayUrl: '', fetchImpl, ownerStorage: OC.dirStorage(fs, path, ownerDir) });
  await handlers['auth:setup'](ev(1), 'menahel', 'menahel-strong-pass-1');
  await handlers['auth:login'](ev(1), 'menahel', 'menahel-strong-pass-1');
  await handlers['owner:init'](ev(1), PASS);
  await handlers['owner:unlock'](ev(1), PASS);
  // הרשמות כפי שנמסרו מהשרת (הקובץ הגלוי מוצפן בקריאה הראשונה)
  const base = { keyId: 'k', customer: { org: 'ישיבה', contact: 'משה', phone: '050-0000000', taxId: '' }, planId: 'pro', planName: 'מוסדות', months: 12, status: 'new', receivedAt: 1 };
  fs.writeFileSync(path.join(ownerDir, 'signups.json'), JSON.stringify([
    { ...base, id: 's-ok', payment: PAYMENT },
    { ...base, id: 's-amt', payment: { ...PAYMENT, id: 'pay-amt', checkoutId: '11111111-2222-4333-8444-555555555555' } },
    { ...base, id: 's-net', payment: { ...PAYMENT, id: 'pay-net', checkoutId: '66666666-2222-4333-8444-555555555555' } },
    { ...base, id: 's-unpaid', payment: { ...PAYMENT, id: 'pay-unpaid', checkoutId: '77777777-2222-4333-8444-555555555555' } },
  ]));
});

test('IPC: בלי פרטי Cardcom — אימות נדחה בהסבר, וההנפקה דורשת אישור ידני כמו קודם', async () => {
  await assert.rejects(handlers['owner:verifySignupPayment'](ev(1), 's-ok'), /לא הוגדרו פרטי המסוף של Cardcom/);
  await assert.rejects(handlers['owner:signupIssue'](ev(1), 's-ok'), /נדרש אימות התשלום: יש לוודא/);
  assert.equal(net.calls.length, 0);
});

test('IPC: הגדרת פרטי המסוף — שם ה-API לא חוזר למסך ולא נשמר גלוי; הרשאה של מנהל-העל בלבד', async () => {
  const r = await handlers['owner:setCardcomCredentials'](ev(1), { terminal: '1000123', apiName: API });
  assert.deepEqual(r, { cardcom: { configured: true, terminal: 1000123 } });
  assert.deepEqual(await handlers['owner:getPaymentProvider'](ev(1)), r);
  assert.ok(!JSON.stringify(await handlers['owner:signups'](ev(1))).includes(API));
  assert.ok(!filesText(ownerDir).includes(API), 'לא גלוי בתיקיית מנהל-העל');
  await assert.rejects(handlers['owner:getPaymentProvider'](ev(9)), /כניסה/);
  assert.equal(ipc.permissionFor('owner:setCardcomCredentials'), 'users.manage');
  assert.equal(ipc.permissionFor('owner:verifySignupPayment'), 'users.manage');
});

test('IPC: מוגדר — הנפקה בלי בדיקה נחסמת ("נדרש אימות מול Cardcom"), גם עם אישור ידני', async () => {
  await assert.rejects(handlers['owner:signupIssue'](ev(1), 's-ok', { paymentConfirmed: true }), /נדרש אימות מול Cardcom/);
});

test('IPC: התאמה — אומת, נשמר בהרשמה, וההנפקה עוברת את בדיקת התשלום', async () => {
  net = { mode: 'ok', body: lpResult(), calls: [] };
  const c = await handlers['owner:verifySignupPayment'](ev(1), 's-ok');
  assert.equal(c.status, 'verified');
  assert.equal(net.calls.length, 1);
  assert.equal(JSON.parse(net.calls[0].init.body).ApiName, API, 'שם ה-API נשלח רק ל-Cardcom');
  assert.equal(net.calls[0].url.startsWith('https://secure.cardcom.solutions/'), true);
  const s = (await handlers['owner:signups'](ev(1))).find(x => x.id === 's-ok');
  assert.equal(s.paymentCheck.status, 'verified');
  // ההנפקה ממשיכה (ונכשלת בהמשך — ההרשמה בבדיקה אינה חתומה), אבל לא על התשלום
  await assert.rejects(handlers['owner:signupIssue'](ev(1), 's-ok'), /הקובץ אינו הרשמה/);
});

test('IPC: סכום לא תואם — נחסם, גם עם אישור ידני', async () => {
  net = { mode: 'ok', body: lpResult({ LowProfileId: '11111111-2222-4333-8444-555555555555', ReturnValue: 'pay-amt' }, { Amount: 100 }), calls: [] };
  const c = await handlers['owner:verifySignupPayment'](ev(1), 's-amt');
  assert.equal(c.status, 'mismatch');
  await assert.rejects(handlers['owner:signupIssue'](ev(1), 's-amt', { paymentConfirmed: true }), /התשלום לא אומת מול Cardcom: לפי Cardcom שולמו/);
});

test('IPC: לא שולם — נחסם', async () => {
  net = { mode: 'ok', body: lpResult({ LowProfileId: '77777777-2222-4333-8444-555555555555', ReturnValue: 'pay-unpaid' }, { ResponseCode: 701 }), calls: [] };
  assert.equal((await handlers['owner:verifySignupPayment'](ev(1), 's-unpaid')).status, 'unpaid');
  await assert.rejects(handlers['owner:signupIssue'](ev(1), 's-unpaid', { paymentConfirmed: true }), /לפי Cardcom התשלום לא הושלם/);
});

test('IPC: תקלת רשת — "לא נבדק", וחזרה לאישור הידני עם הסבר בעברית', async () => {
  net = { mode: 'down', body: null, calls: [] };
  const c = await handlers['owner:verifySignupPayment'](ev(1), 's-net');
  assert.equal(c.status, 'unavailable');
  assert.match(c.message, /אין חיבור לשרת Cardcom/);
  await assert.rejects(handlers['owner:signupIssue'](ev(1), 's-net'), /נדרש אימות התשלום: האימות מול Cardcom לא הושלם \(אין חיבור לשרת Cardcom/);
  // אחרי אישור ידני — עובר את בדיקת התשלום (ונכשל בהמשך על ההרשמה הלא חתומה)
  await assert.rejects(handlers['owner:signupIssue'](ev(1), 's-net', { paymentConfirmed: true }), /הקובץ אינו הרשמה/);
  assert.ok(!filesText(ownerDir).includes(API), 'גם אחרי כל הבדיקות — לא גלוי בדיסק');
});

test('שרת הרישוי מוסר את מזהה דף התשלום (checkoutId) עם ההרשמה; הקובץ מאושר לרשת רק ל-Cardcom', () => {
  const relay = fs.readFileSync(path.join(__dirname, '..', 'server/license-relay.js'), 'utf8');
  assert.match(relay, /providerRef: ev\.providerRef, paidAt: at,[\s\S]{0,200}checkoutId: x\.checkoutId/);
  const nn = fs.readFileSync(path.join(__dirname, 'no-network.test.js'), 'utf8');
  assert.match(nn, /'shell\/licensing\/owner-cardcom\.js': \['secure\.cardcom\.solutions'\]/);
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules/econ/ipc.js'), 'utf8');
  assert.match(src, /handleNet\('owner:verifySignupPayment'/, 'ממתין לרשת — מחוץ לתור');
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'shell/licensing/owner-cardcom.js'), 'utf8'), /\bfetch\(/, 'רק fetchImpl מוזרק (net.fetch)');
});

test('מסך מנהל-העל: מצב פרטי המסוף, תוצאת האימות בשורה, כפתור בדיקה, ואימות לפני הנפקה כשמוגדר', () => {
  const vm = require('vm');
  const EconUI = require('./helpers/econ-ui');
  const context = { console, setTimeout, clearTimeout, Date, Intl, URLSearchParams, location: { search: '' },
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } } };
  context.window = context;
  vm.createContext(context);
  EconUI.run(context);
  const row = (id, over) => ({ id, receivedAt: 1, customer: { org: 'ישיבה', contact: 'משה', phone: '050' }, planName: 'מוסדות', status: 'new', payment: PAYMENT, ...over });
  context.__list = [row('a'), row('b', { paymentCheck: { status: 'verified', message: 'התשלום אומת' } }),
    row('c', { paymentCheck: { status: 'mismatch', message: 'לפי Cardcom שולמו ₪1.00' } }), row('d', { payment: null })];
  const on = vm.runInContext(`renderOwnerSignups(null, __list, null, { cardcom: { configured: true, terminal: 1000123 } })`, context);
  assert.match(on, /אימות תשלומים מול Cardcom: <b>מוגדר<\/b> \(מסוף <span dir="ltr">1000123<\/span>\)/);
  assert.match(on, /id="ownerCardcomClearBtn"/);
  assert.match(on, /data-owner-signup-issue="a" data-owner-verify-first="1"/);
  assert.match(on, /data-owner-signup-issue="b">/, 'אומת — בלי בדיקה חוזרת');
  assert.match(on, /data-owner-signup-issue="d">/, 'חינם — בלי בדיקה');
  assert.match(on, /data-owner-signup-verify="a"/);
  assert.match(on, /✔ אומת מול Cardcom/);
  assert.match(on, /✖ לא תואם[\s\S]*לפי Cardcom שולמו/);
  const off = vm.runInContext(`renderOwnerSignups(null, __list, null, { cardcom: { configured: false } })`, context);
  assert.match(off, /<b>לא מוגדר<\/b> — לפני הנפקה בתשלום יש לבדוק/);
  assert.doesNotMatch(off, /data-owner-verify-first|data-owner-signup-verify=/);
  const ui = fs.readFileSync(path.join(__dirname, '..', 'modules/econ/ui/licensing-actions.js'), 'utf8');
  assert.match(ui, /\/נדרש אימות מול Cardcom\/\.test\(m\)/);
  assert.match(ui, /name: 'apiName', label: 'שם API \(ApiName\)', type: 'password'/);
});
