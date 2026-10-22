// עוזר „שאל את התוכנה” — רישוי: כל ערוץ ai:* דורש את התחום 'ai', והענן (ai.cloud) נעול בלי רישיון.
// השכבה הטהורה (gate.js) וגם הזרימה האמיתית דרך ipc.js — כמו בלחיצות במסך.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const G = require(path.join(ROOT, 'shell/licensing/gate'));
const L = require(path.join(ROOT, 'shell/licensing/license'));
const { createLicenseStore } = require(path.join(ROOT, 'shell/licensing/store'));
const { createOwnerCore } = require(path.join(ROOT, 'shell/licensing/owner-core'));

// stub של Electron, כמו ב-ipc-guard.test.js
const handlers = {};
const Module = require('module');
Module._resolveFilename_orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub__.js' : Module._resolveFilename_orig.call(this, req, ...rest); };
require.cache['/__electron_stub__.js'] = { id: '/__electron_stub__.js', filename: '/__electron_stub__.js', loaded: true, exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } } } };
const ipc = require(path.join(ROOT, 'modules/econ/ipc'));
const ev = (id) => ({ sender: { id } });
// היום לפי שעון הרישיון (העוזר משתמש ב-clockNow של initEcon)
const localDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const T0 = Date.UTC(2026, 9, 1);
const DAY = L.DAY_MS;
const PASS = 'menahel-al-pass-2026';
const one = (init = null) => { let v = init; return { read: () => v, write: (t) => { v = t; } }; };
const mem = () => { const m = new Map(); return { read: (n) => (m.has(n) ? m.get(n) : null), write: (n, t) => { m.set(n, t); } }; };
const limits = { maxChildren: 2, maxUsers: 10, maxStorageMb: 1000, maxDepth: 2 };
const licensed = (features, status = 'active') => ({ mode: 'licensed', status, features, reasons: [] });
let TMP_DIR = null;
let TENANT_N = 0;

// ---------- השער הטהור ----------
test('featuresForChannel: כל ערוץ ai:* שייך לתחום "ai" בלבד — לא ל-econ', () => {
  for (const ch of ['ai:status', 'ai:prefs:get', 'ai:prefs:save', 'ai:consent', 'ai:run', 'ai:explain', 'ai:modules', 'ai:sample', 'ai:context', 'ai:open']) {
    assert.deepEqual(G.featuresForChannel(ch), ['ai'], ch);
  }
  // תת-תחום מוכר — גם התחום הראשי וגם תת-התחום, כמו כל ערוץ כלכלי
  assert.deepEqual(G.featuresForChannel('acct:getInvoices'), ['econ', 'econ.accounting']);
  assert.deepEqual(G.featuresForChannel('npo:getOverview'), ['econ', 'econ.npo']);
});

test('checkChannel: רישיון בלי "ai" — העוזר סגור; עם "ai" — פתוח גם בלי econ', () => {
  const msg = 'התחום הזה אינו כלול ברישיון של המערכת';
  const econOnly = licensed(['econ', 'econ.accounting', 'econ.npo', 'shamai', 'trainer']);
  assert.equal(G.checkChannel(econOnly, 'ai:run', 'data.edit'), msg);
  assert.equal(G.checkChannel(econOnly, 'ai:status', 'data.view'), msg);
  assert.equal(G.checkChannel(econOnly, 'acct:getInvoices', 'data.view'), null, 'התחום האחר ממשיך לעבוד');

  const aiOnly = licensed(['ai']);
  assert.equal(G.checkChannel(aiOnly, 'ai:run', 'data.edit'), null);
  assert.equal(G.checkChannel(aiOnly, 'ai:status', 'data.view'), null);
  assert.equal(G.checkChannel(aiOnly, 'acct:getInvoices', 'data.view'), msg, '"ai" אינו פותח חשבונאות');
});

test('checkChannel: בלי רישיון — פתוח; בסטטוס קריאה-בלבד — שאלה (כתיבה) נחסמת בהודעה, קריאה מותרת', () => {
  assert.equal(G.checkChannel({ mode: 'unlicensed' }, 'ai:run', 'data.edit'), null);
  for (const status of ['pending_payment', 'suspended', 'trial_ended']) {
    const st = licensed(['ai', 'ai.cloud'], status);
    const denied = G.checkChannel(st, 'ai:run', 'data.edit');
    assert.equal(typeof denied, 'string', status + ': הכתיבה נחסמת');
    assert.ok(denied.length > 0, status + ': עם הודעה בעברית');
    assert.equal(G.checkChannel(st, 'ai:status', 'data.view'), null, status + ': קריאה מותרת');
    assert.equal(G.checkChannel(st, 'ai:modules', 'data.export'), null, status + ': ייצוא מותר');
  }
  assert.equal(G.checkChannel(licensed(['ai'], 'locked'), 'ai:status', 'data.view'), 'המערכת נעולה');
});

test('featureOpen אינו מספיק לזכאות ענן — "ai" לבדו לא נותן ai.cloud', () => {
  // featureOpen נופל ל-'econ' כשאין תחום מתאים; לכן הוא לא בדיקה של זכאות ענן
  assert.equal(G.featureOpen(licensed(['ai']), 'ai.cloud'), false, 'בלי "econ" אין נפילה');
  assert.equal(G.featureOpen(licensed(['econ']), 'ai.cloud'), true, 'נפילה ל-econ — בכוונה');
  const st = licensed(['ai']);
  assert.equal(G.featureOpen(st, 'ai'), true);
  assert.equal((st.features || []).includes('ai.cloud'), false, 'לכן ipc בודק את הרשימה מפורשות');
});

// ---------- הזרימה האמיתית דרך ipc ----------
const setupAdmin = async (id) => {
  await handlers['auth:setup'](ev(id), 'menahel_' + id, 'a-very-long-pass-2026');
  await handlers['auth:login'](ev(id), 'menahel_' + id, 'a-very-long-pass-2026');
};

// מנהל-העל מנפיק רישיון, והלקוח מתקין אותו דרך ה-API של המחסן עצמו —
// כך מפתח הצומת והשומר המוצפן נשמרים יחד עם הרישיון, כמו בהתקנה אמיתית
async function issuedTenant(features) {
  const ownerStorage = mem();
  const { publicKey } = createOwnerCore({ storage: ownerStorage, clock: () => T0 }).init(PASS);
  const rootKeys = [publicKey];
  const tenantStorage = one();
  const tenantSecret = one();
  const tenant = createLicenseStore({ storage: tenantStorage, secret: tenantSecret, rootKeys, clock: () => T0 + DAY });
  const pre = createOwnerCore({ storage: ownerStorage, clock: () => T0 });
  pre.unlock(PASS);
  tenant.install(pre.issue({ request: tenant.request('רשת בית יעקב'), name: 'רשת בית יעקב', features, limits, months: 12 }).package);
  // תנאי ההפעלה נקבעים מהחיבור האחרון לשרת — כמו בסנכרון אמיתי. בלי זה withActivation נועל.
  // הכתיבה דרך ה-API של המחסן בלבד (save) — כמו שהמחסן עצמו עושה אחרי סנכרון
  tenant.setRemoteSettings({ lastSync: T0, lastGoogle: T0 });

  // תיקייה זמנית אחת לכל הבדיקות (initEcon מחליף את אותו שירות בכל קריאה) — נמחקת בסוף, כמו ב-run-tests.js
  if (!TMP_DIR) { TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-ai-gate-')); test.after(() => { // לסגור את המסד קודם — אחרת Windows לא נותן למחוק את התיקייה (EPERM)
    try { const db = ipc.getDb(); if (db && db.db) db.db.close(); } catch { /* כבר סגור */ }
    fs.rmSync(TMP_DIR, { recursive: true, force: true, maxRetries: 3 });
  }); }
  const dir = path.join(TMP_DIR, 'tenant-' + (++TENANT_N));
  // relayUrl ריק — אין פנייה לשרת אמיתי. אותו storage ואותו secret של המחסן שממנו נוצר הרישיון
  await ipc.initEcon(dir, { rootKeys, clock: () => T0 + DAY, licenseStorage: tenantStorage, licenseSecret: tenantSecret, relayUrl: '' });
  return { dir, tenant };
}

test('ipc: רישיון בלי "ai" — העוזר סגור בהודעת רישיון, שאר התחומים נגישים', async () => {
  await issuedTenant(['econ', 'econ.accounting', 'econ.npo']);
  await setupAdmin(5);

  const msg = /אינו כלול ברישיון/;
  await assert.rejects(handlers['ai:status'](ev(5)), msg);
  await assert.rejects(handlers['ai:run'](ev(5), 'כמה גבייתי החודש?'), msg);
  await assert.rejects(handlers['ai:consent'](ev(5), true), msg);
  // התחום הכלכלי עצמו ממשיך לעבוד
  assert.ok(Array.isArray(await handlers['acct:getInvoices'](ev(5))));
});

test('ipc: רישיון עם "ai" בלבד — העוזר עובד, ולא נפתחים תחומים אחרים', async () => {
  await issuedTenant(['ai']);
  await setupAdmin(6);

  const st = await handlers['ai:status'](ev(6));
  assert.ok(st && st.local, 'סטטוס העוזר מוחזר');
  assert.equal(st.cloud.licensed, false, 'בלי ai.cloud אין זכאות לענן');
  assert.equal(st.cloud.eligible, false);
  assert.equal(st.cloud.ready, false);

  const a = await handlers['ai:run'](ev(6), 'כמה גבייתי החודש?');
  assert.equal(a.engine, 'rules');
  // „ai” לבדו אינו פותח חשבונאות — התשובה מוסרת זאת במפורש, ולא ממציאה נתונים
  assert.match(a.text, /חשבונאות.*(רישיון|הרשאה)/);
  assert.equal(a.data, undefined, 'בלי תחום חשבונאות אין נתונים בתשובה');
  // שאלת מדריך אינה תלויה בתחום — נענית במלואה
  assert.match((await handlers['ai:run'](ev(6), 'איך מוציאים חשבונית?')).text, /מסך „חשבוניות”/);
  await assert.rejects(handlers['acct:getInvoices'](ev(6)), /אינו כלול ברישיון/);
});

test('ipc: ai.cloud נעול בלי רישיון — גם אם בחרו „ענן כשאפשר” והסכימו', async () => {
  await issuedTenant(['ai']);
  await setupAdmin(7);

  await assert.rejects(handlers['ai:consent'](ev(7), true), /אינו כלול ברישיון של המערכת/);
  const st = await handlers['ai:status'](ev(7));
  assert.equal(st.cloud.licensed, false);
  assert.equal(st.cloud.consented, false, 'ההסכמה לא נשמרה');

  // בחירת המנוע הענני אינה מוציאה מהמקומי
  await handlers['ai:prefs:save'](ev(7), { engine: 'cloud-when-available' });
  const a = await handlers['ai:run'](ev(7), 'מי לא שילם?');
  assert.equal(a.engine, 'rules', 'בלי זכאות — תשובת כללים מקומית');
  // בשלב 1 אין מודל מקומי ואין ענן — הבחירה נופלת למנוע הכללים
  assert.equal(a.requested, 'rules');
});

test('ipc: תקופת ניסיון שהסתיימה — קריאה מותרת, שאלה (כתיבה) נחסמת', async () => {
  const root = L.generateKeyPair();
  if (!TMP_DIR) { TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-ai-gate-')); test.after(() => { // לסגור את המסד קודם — אחרת Windows לא נותן למחוק את התיקייה (EPERM)
    try { const db = ipc.getDb(); if (db && db.db) db.db.close(); } catch { /* כבר סגור */ }
    fs.rmSync(TMP_DIR, { recursive: true, force: true, maxRetries: 3 });
  }); }
  const dir = path.join(TMP_DIR, 'trial');
  await ipc.initEcon(dir, {
    rootKeys: [root.publicJwk], clock: () => T0, relayUrl: '',
    licenseStorage: one(JSON.stringify({ chain: null, notices: [], children: [], lastSeen: 0, trialStart: T0 - 40 * DAY })),
    licenseSecret: one(),
  });
  await setupAdmin(8);

  const st = await handlers['ai:status'](ev(8));
  assert.equal(st.cloud.licensed, false);
  await assert.rejects(handlers['ai:run'](ev(8), 'כמה גבייתי החודש?'), /תקופת הניסיון הסתיימה|אינה פעילה|מושבתת/);
});

// ---------- "ai.cloud" בהצעות ובמסך הרישוי: תכונה חייבת להיות בכל שלושת המקומות ----------
test('"ai" ו-"ai.cloud" מופיעים בכל מפת תכונות — בהצעה ובלשונית הרישוי, בשני העותקים', () => {
  const O = require(path.join(ROOT, 'shell/licensing/offer'));
  assert.ok(O.FEATURES.includes('ai'), 'offer.FEATURES כולל "ai"');
  assert.ok(O.FEATURES.includes('ai.cloud'), 'offer.FEATURES כולל "ai.cloud" — אחרת ההצעה מסננת אותו');

  // אותה רשימה צריכה להופיע גם ב-modules/econ ובעותק של אנדרואיד (שניהם נכתבו מאותו מקור)
  const files = [path.join(ROOT, 'modules/econ/ui/licensing.js'), path.join(ROOT, 'android/build/assets/www/econ/ui/licensing.js')];
  const texts = files.filter(f => fs.existsSync(f)).map(f => fs.readFileSync(f, 'utf8'));
  assert.ok(texts.length >= 1, 'נמצא לפחות עותק אחד של מסך הרישוי');
  for (const src of texts) {
    for (const f of ['ai', 'ai.cloud']) assert.ok(src.includes(`'${f}'`), `LIC_FEATURES כולל ${f}`);
  }
  if (texts.length === 2) assert.equal(texts[0], texts[1], 'שני עותקי licensing.js זהים');
});

// ---------- הזרימה האמיתית: "ai.cloud" לבדו, נעילה, טווח, העדפות ויעדים ----------
test('ipc: "ai.cloud" פותח את העוזר אך לא תחום אחר; "locked" נועל את ai:status', async () => {
  await issuedTenant(['ai', 'ai.cloud']);
  await setupAdmin(9);
  const st = await handlers['ai:status'](ev(9));
  assert.equal(st.cloud.licensed, true, 'הזכאות זוהתה');
  assert.equal(st.cloud.ready, false, 'בשלב 1 אין ענן מוכן');
  await assert.rejects(handlers['acct:getInvoices'](ev(9)), /אינו כלול ברישיון/);

  // ai.cloud לבדו — satisfies משלים ל-'ai' בשער, כדי שלא יתקבל רישיון ענן שאינו עובד בכלליות
  assert.equal(G.checkChannel(licensed(['ai.cloud']), 'ai:run', 'data.edit'), null);
  assert.equal(G.checkChannel(licensed(['ai.cloud']), 'ai:status', 'data.view'), null);
  assert.equal(G.checkChannel(licensed(['ai.cloud']), 'acct:getInvoices', 'data.view'), 'התחום הזה אינו כלול ברישיון של המערכת');
  // נעילה — גם קריאה נחסמת
  assert.equal(G.checkChannel(licensed(['ai', 'ai.cloud'], 'locked'), 'ai:status', 'data.view'), 'המערכת נעולה');
});

test('ipc: טווח מהממשק שמתנגש עם השאלה — השאלה קובעת (אין עקיפת טווח)', async () => {
  await issuedTenant(['econ', 'econ.accounting', 'ai']);
  await setupAdmin(10);
  // רשומת הכנסה בחודש שעבר ורשומה בחודש הזה — "החודש" חייב לחזור על החודש הזה בלבד
  // תאריכים לפי שעון הרישיון (T0) — העוזר גוזר את "היום" מהשעון הזה, לא מתאריך המחשב
  const today = localDay(T0 + DAY);
  const thisMonth = today.slice(0, 8) + '02';
  const [y, m] = today.slice(0, 7).split('-').map(Number);
  const prevMonth = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}-02`;
  // הכתיבה דרך המנוע הקיים (createEntry) — כמו שהמסך כותב. היומן של הלקוח החדש מכיל רשומות דוגמה ישיבות,
  // והן מוחלפות ברשומות הכנסה מוכרות; אחרת הסכום של "החודש" לא יהיה מוכר
  const data = await ipc.getDb().load();
  data.journal = [];
  await ipc.getDb().save(data);
  for (const [amount, date] of [[100, thisMonth], [900, prevMonth]]) {
    await handlers['acct:createEntry'](ev(10), {
      date, description: 'הכנסות',
      lines: [{ account: '1000', debit: amount, credit: 0 }, { account: '4000', debit: 0, credit: amount }] });
  }
  // הממשק מבקש "השנה שעברה" בעוד שהשאלה שואלת על החודש הזה
  const a = await handlers['ai:run'](ev(10), 'כמה גבייתי החודש?', { range: { from: '2025-01-01', to: '2025-12-31', label: 'שנה' } });
  assert.match(a.text, /₪100\.00/, 'נספרת רק ההכנסה של החודש הזה');
  assert.ok(!/₪1,000\.00|₪900\.00/.test(a.text), 'ההכנסה של חודש שעבר אינה נכללת');
});

test('ipc: העדפות — מעגל שמירה וקריאה דרך ai:prefs:get, והסתרת מזהים נשארת ברירת מחדל', async () => {
  await issuedTenant(['ai']);
  await setupAdmin(11);
  const before = await handlers['ai:prefs:get'](ev(11));
  assert.equal(before.conceal, true, 'ברירת מחדל — מזהים מוסתרים');
  assert.equal(before.engine, 'local-only');

  await handlers['ai:prefs:save'](ev(11), { conceal: false });
  const after = await handlers['ai:prefs:get'](ev(11));
  assert.equal(after.conceal, false, 'ההעדפה נשמרה');

  // קלט לא מהימן — ערך אגנוסטי אינו נשמר
  await handlers['ai:prefs:save'](ev(11), { engine: 'ectoplasm' });
  assert.equal((await handlers['ai:prefs:get'](ev(11))).engine, 'local-only');
});

test('ipc: ai:open — רק יעד מהרשימה הסגורה', async () => {
  await issuedTenant(['econ', 'ai']);
  await setupAdmin(12);
  await assert.rejects(handlers['ai:open'](ev(12), 'arbitrary-view'), /המסך המבוקש אינו מוכר/);
  await assert.rejects(handlers['ai:open'](ev(12), ''), /המסך המבוקש אינו מוכר/);
  assert.deepEqual(await handlers['ai:open'](ev(12), 'acct-invoices'), { view: 'acct-invoices' });
});

