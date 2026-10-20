// כניסה עם Google: אימות אסימון הזהות, זרימת הדפדפן (PKCE + כתובת מקומית), וערוצי ה-IPC — קישור, כניסה ומדיניות
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const GS = require('../shell/google-signin');

const CLIENT_ID = '1234567890-abcdefghijk.apps.googleusercontent.com';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const NOW = Date.parse('2026-10-16T09:00:00Z');

function token(claims = {}, { header = {}, key = privateKey } = {}) {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT', ...header }));
  const t = Math.floor(NOW / 1000);
  const p = b64u(JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1001', email: 'Moshe@Example.org',
    email_verified: true, name: 'משה כהן', iat: t, exp: t + 3600, nonce: 'n1', ...claims }));
  return `${h}.${p}.${b64u(crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), key))}`;
}
const verify = (tok, o = {}) => GS.verifyIdToken(tok, { clientId: CLIENT_ID, nonce: 'n1', now: NOW, keys: [JWK], ...o });

test('אסימון תקין מאומת, והדוא"ל מנורמל', async () => {
  const r = await verify(token());
  assert.deepEqual(r, { sub: '1001', email: 'moshe@example.org', name: 'משה כהן' });
});

test('אסימון פגום או לא שייך — נדחה', async () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  await assert.rejects(verify(token({}, { key: other })), /חתימת Google אינה תקינה/);
  await assert.rejects(verify(token({ aud: '999-x.apps.googleusercontent.com' })), /לא הונפק לתוכנה הזו/);
  await assert.rejects(verify(token({ iss: 'https://evil.example' })), /המנפיק אינו Google/);
  await assert.rejects(verify(token({ nonce: 'other' })), /אינה שייכת לבקשה/);
  await assert.rejects(verify(token({ exp: Math.floor(NOW / 1000) - 3600 })), /תוקף הכניסה פג/);
  await assert.rejects(verify(token({ email_verified: false })), /לא אומתה/);
  await assert.rejects(verify(token({}, { header: { alg: 'none' } })), /אינה חתומה כנדרש/);
  await assert.rejects(verify(token({}, { header: { kid: 'missing' } })), /מפתח החתימה/);
  // שינוי בתוכן אחרי החתימה
  const [h, , sig] = token().split('.');
  const forged = b64u(JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'admin', exp: 9e9, iat: 1, nonce: 'n1' }));
  await assert.rejects(verify(`${h}.${forged}.${sig}`), /חתימת Google אינה תקינה/);
  await assert.rejects(verify('abc'), /אינה תקינה/);
});

test('מפתח שהתחלף אצל Google — נטען מחדש פעם אחת', async () => {
  GS._resetCache();
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, json: async () => ({ keys: calls === 1 ? [] : [JWK] }) }; };
  const r = await GS.verifyIdToken(token(), { clientId: CLIENT_ID, nonce: 'n1', now: NOW, fetchImpl });
  assert.equal(r.sub, '1001');
  assert.equal(calls, 2);
});

test('הגדרות לא תקינות נדחות', () => {
  assert.throws(() => GS.validateConfig({ clientId: 'abc' }), /מזהה הלקוח/);
  assert.throws(() => GS.validateConfig({ clientId: CLIENT_ID, clientSecret: 'a b"<' }), /סוד הלקוח/);
  assert.equal(GS.validateConfig({ clientId: ' ' + CLIENT_ID + ' ' }).clientId, CLIENT_ID);
});

// Google מדומה: "הדפדפן" מבצע את החזרה לכתובת המקומית, ונקודת האסימון מחזירה id_token חתום עם ה-nonce שבבקשה
function fakeGoogle({ claims = {}, tamperState = false, deny = false, certs } = {}) {
  const seen = {};
  const openBrowser = async (url) => {
    const u = new URL(url);
    assert.equal(u.origin + u.pathname, GS.AUTH_URL);
    Object.assign(seen, Object.fromEntries(u.searchParams));
    const back = new URL(seen.redirect_uri);
    assert.equal(back.hostname, '127.0.0.1');
    back.searchParams.set('state', tamperState ? 'wrong' : seen.state);
    if (deny) back.searchParams.set('error', 'access_denied'); else back.searchParams.set('code', 'code-1');
    const r = await fetch(back);
    seen.page = await r.text();
  };
  const fetchImpl = async (url, opts) => {
    if (url === GS.CERTS_URL) return certs ? certs() : { ok: true, json: async () => ({ keys: [JWK] }) };
    assert.equal(url, GS.TOKEN_URL);
    const body = new URLSearchParams(opts.body);
    seen.tokenBody = Object.fromEntries(body);
    // PKCE: ה-verifier שנשלח תואם ל-challenge שבבקשה
    const ch = b64u(crypto.createHash('sha256').update(body.get('code_verifier')).digest());
    assert.equal(ch, seen.code_challenge);
    return { ok: true, json: async () => ({ id_token: token({ nonce: seen.nonce, ...claims }) }) };
  };
  return { openBrowser, fetchImpl, seen };
}

test('זרימה מלאה: דפדפן ← כתובת מקומית ← החלפת קוד ← אימות', async () => {
  GS._resetCache();
  const g = fakeGoogle();
  const r = await GS.signIn({ clientId: CLIENT_ID, clientSecret: 'GOCSPX-abcdefghij' }, { ...g, loginHint: 'moshe@example.org', now: () => NOW });
  assert.equal(r.sub, '1001');
  assert.equal(g.seen.code_challenge_method, 'S256');
  assert.equal(g.seen.scope, 'openid email profile');
  assert.equal(g.seen.login_hint, 'moshe@example.org');
  assert.equal(g.seen.tokenBody.client_secret, 'GOCSPX-abcdefghij');
  assert.match(g.seen.page, /הכניסה הצליחה/);
});

test('state שגוי לא מתקבל; ביטול בדפדפן — שגיאה ברורה; בלי תשובה — פג זמן', async () => {
  GS._resetCache();
  const bad = fakeGoogle({ tamperState: true });
  await assert.rejects(GS.signIn({ clientId: CLIENT_ID }, { ...bad, now: () => NOW, waitMs: 300 }), /הזמן לכניסה/);
  assert.match(bad.seen.page, /אינה תואמת/);
  await assert.rejects(GS.signIn({ clientId: CLIENT_ID }, { ...fakeGoogle({ deny: true }), now: () => NOW }), /בוטלה/);
});

test('רגרסיה: מפתחות החתימה חסומים בסינון — הכניסה עוברת, כי האסימון הגיע ישירות מ-Google', async () => {
  const blocked = [
    () => { throw new TypeError('fetch failed'); },
    () => ({ ok: false, status: 418, json: async () => ({}) }),
    () => ({ ok: true, json: async () => { throw new SyntaxError('דף חסימה'); } }),
  ];
  for (const certs of blocked) {
    GS._resetCache();
    const r = await GS.signIn({ clientId: CLIENT_ID }, { ...fakeGoogle({ certs }), now: () => NOW });
    assert.equal(r.sub, '1001');
  }
  // שאר הבדיקות נשארות גם בלי המפתחות
  GS._resetCache();
  await assert.rejects(GS.signIn({ clientId: CLIENT_ID }, { ...fakeGoogle({ certs: blocked[0], claims: { aud: 'other' } }), now: () => NOW }), /לא הונפק לתוכנה/);
  GS._resetCache();
  await assert.rejects(GS.signIn({ clientId: CLIENT_ID }, { ...fakeGoogle({ certs: blocked[0], claims: { exp: 1 } }), now: () => NOW }), /תוקף/);
  // מפתחות שהתקבלו — החתימה נבדקת: אסימון בחתימה זרה נדחה
  GS._resetCache();
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const forged = { ...other.publicKey.export({ format: 'jwk' }), kid: 'k1' };
  await assert.rejects(GS.signIn({ clientId: CLIENT_ID }, { ...fakeGoogle({ certs: () => ({ ok: true, json: async () => ({ keys: [forged] }) }) }), now: () => NOW }), /חתימת Google/);
});

test('בלי ערוץ ישיר מ-Google — מפתחות חסומים הם שגיאה ברורה בעברית, לא "שגיאה פנימית"', async () => {
  GS._resetCache();
  const fetchImpl = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(GS.verifyIdToken(token(), { clientId: CLIENT_ID, nonce: 'n1', now: NOW, fetchImpl }), /מפתחות האימות של Google/);
});

// ---------- ערוצי IPC ----------
const handlers = {};
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_g__.js' : origResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_g__.js'] = { id: '/__electron_stub_g__.js', filename: '/__electron_stub_g__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } } } };
const ipc = require('../modules/econ/ipc');
const ev = (id) => ({ sender: { id } });

test('IPC: קישור, כניסה עם Google, מדיניות והרשאות', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-google-'));
  let identity = { sub: 'g-1', email: 'moshe@example.org', name: 'משה' };
  let release = null;     // כשמוגדר — הכניסה "ממתינה בדפדפן" עד שמשחררים
  const hints = [];
  await ipc.initEcon(dir, { googleSignIn: async (cfg, o) => {
    hints.push(o.loginHint);
    assert.equal(cfg.clientId, CLIENT_ID);
    if (release) await new Promise(r => { release = r; });
    return identity;
  }, googleClient: { clientId: '', clientSecret: '' } });   // בלי מזהה מובנה — לא תלוי בתוכן shell/google-client.js

  // לפני הפעלה — אין כניסה עם Google
  assert.deepEqual((await handlers['auth:status'](ev(1))).google, { enabled: false });
  await assert.rejects(handlers['auth:google-login'](ev(1)), /לא הופעלה/);

  await handlers['auth:setup'](ev(1), 'admin_1', 'a-very-long-pass-2026');
  await handlers['auth:login'](ev(1), 'admin_1', 'a-very-long-pass-2026');
  await assert.rejects(handlers['settings:saveGoogle'](ev(1), { enabled: true, clientId: 'bad' }), /מזהה הלקוח/);
  const saved = await handlers['settings:saveGoogle'](ev(1), { enabled: true, clientId: CLIENT_ID, clientSecret: 'GOCSPX-abcdefghij', onlineRequiresGoogle: true });
  assert.equal(saved.hasSecret, true);
  assert.equal('clientSecret' in saved, false);
  assert.equal((await handlers['settings:getGoogle'](ev(1))).clientSecret, undefined);
  assert.equal((await handlers['auth:status'](ev(9))).google.enabled, true);

  // חשבון לא מקושר — לא נכנס
  await assert.rejects(handlers['auth:google-login'](ev(2)), /לא מקושר/);
  // ערוץ ציבורי: קישור דורש כניסה
  await assert.rejects(handlers['auth:google-link'](ev(2)), /נדרשת כניסה/);

  // מדיניות ההודעות: כניסה בסיסמה — ההודעות חסומות
  await assert.rejects(handlers['chat:overview'](ev(1), '', 'all'), /רק אחרי כניסה עם Google/);

  const link = await handlers['auth:google-link'](ev(1));
  assert.equal(link.email, 'moshe@example.org');
  // קישור מחדש: הדפדפן מקבל את החשבון המקושר כהצעה
  await handlers['auth:google-link'](ev(1));
  assert.equal(hints.at(-1), 'moshe@example.org');
  assert.equal((await handlers['users:list'](ev(1)))[0].google, 'moshe@example.org');

  // כניסה עם Google בחלון אחר
  const u = await handlers['auth:google-login'](ev(3));
  assert.equal(u.username, 'admin_1');
  const st = await handlers['auth:google-status'](ev(3));
  assert.equal(st.via, 'google');
  assert.equal(st.link.email, 'moshe@example.org');
  await assert.doesNotReject(async () => {
    try { await handlers['chat:overview'](ev(3), '', 'all'); }
    catch (e) { if (/כניסה עם Google/.test(e.message)) throw e; }
  });

  // אותו חשבון Google לא יכול להיות מקושר לשני משתמשים
  await handlers['users:create'](ev(1), { username: 'editor_1', password: 'another-strong-pass-1', role: 'editor' });
  await handlers['auth:login'](ev(4), 'editor_1', 'another-strong-pass-1');
  await assert.rejects(handlers['auth:google-link'](ev(4)), /כבר מקושר למשתמש אחר/);
  // עורך לא משנה את הגדרות Google
  await assert.rejects(handlers['settings:saveGoogle'](ev(4), { enabled: false }), /אין הרשאה/);
  await assert.rejects(handlers['settings:getGoogle'](ev(4)), /אין הרשאה/);

  // משתמש חסום לא נכנס גם עם Google
  identity = { sub: 'g-2', email: 'aharon@example.org' };
  await handlers['auth:google-link'](ev(4));
  const editorId = (await handlers['users:list'](ev(1))).find(x => x.username === 'editor_1').id;
  await handlers['users:update'](ev(1), editorId, { active: false });
  await assert.rejects(handlers['auth:google-login'](ev(5)), /חסום/);

  // ההמתנה לדפדפן לא תוקעת את שאר התוכנה; ובינתיים אין כניסה שנייה במקביל
  identity = { sub: 'g-1', email: 'moshe@example.org' };
  release = true;
  const pending = handlers['auth:google-login'](ev(6));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(typeof release, 'function');
  const users = await Promise.race([handlers['users:list'](ev(1)), new Promise((_, rej) => setTimeout(() => rej(new Error('נתקע')), 2000))]);
  assert.ok(users.length >= 2);
  await assert.rejects(handlers['auth:google-login'](ev(7)), /כבר פתוחה/);
  const r = release; release = null; r();
  assert.equal((await pending).username, 'admin_1');

  // ביטול קישור — אין יותר כניסה עם החשבון
  await handlers['auth:google-unlink'](ev(1));
  await assert.rejects(handlers['auth:google-login'](ev(8)), /לא מקושר/);

  // כיבוי — גם המדיניות נכבית, וההגדרה נשמרת (נטענת מחדש באתחול)
  await handlers['settings:saveGoogle'](ev(1), { enabled: false, clientId: CLIENT_ID });
  const after = await handlers['settings:getGoogle'](ev(1));
  assert.equal(after.enabled, false);
  assert.equal(after.onlineRequiresGoogle, false);
  assert.equal(after.hasSecret, true);
});

test('הרשאות: הגדרות Google למנהל בלבד, וכניסה עם Google היא הערוץ הציבורי היחיד שנוסף', () => {
  assert.equal(ipc.permissionFor('settings:getGoogle'), 'users.manage');
  assert.equal(ipc.permissionFor('settings:saveGoogle'), 'users.manage');
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ipc.js'), 'utf8');
  const pub = src.match(/const PUBLIC_CHANNELS = new Set\(\[([^\]]*)\]\)/)[1];
  assert.deepEqual(pub.match(/'[^']+'/g), ["'auth:status'", "'auth:setup'", "'auth:login'", "'auth:logout'", "'auth:google-login'"]);
});

test('יצירת המנהל הראשון מחברת אותו מיד (רגרסיה: הממשק נראה מחובר בלי פגישה בשרת)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-setup-'));
  await ipc.initEcon(dir);
  await handlers['auth:setup'](ev(77), 'first_admin', 'a-very-long-pass-2026');
  const st = await handlers['auth:status'](ev(77));
  assert.equal(st.user && st.user.username, 'first_admin');
  await assert.doesNotReject(handlers['users:list'](ev(77)));
  await assert.rejects(handlers['auth:setup'](ev(78), 'second', 'a-very-long-pass-2026'), /כבר קיים מנהל/);
  assert.equal((await handlers['auth:status'](ev(78))).user, null, 'ניסיון כושל לא פותח פגישה');
});

// ---------- מזהה מובנה (PLAN.md 4.7) ----------
test('מזהה מובנה: התקנה נקייה — כניסה עם Google פעילה בלי שום הגדרה, והגדרות המנהל גוברות', async () => {
  const BUILT = { clientId: '555-builtinclient.apps.googleusercontent.com', clientSecret: 'GOCSPX-builtin1234' };
  const OWN = '777-orgclient.apps.googleusercontent.com';
  const seen = [];
  const signIn = async (cfg) => { seen.push(cfg); return { sub: 'g-b', email: 'yosef@example.org' }; };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-google-b-'));
  await ipc.initEcon(dir, { googleSignIn: signIn, googleClient: BUILT });

  // בלי שום הגדרה — פעיל
  assert.deepEqual((await handlers['auth:status'](ev(21))).google, { enabled: true });
  await handlers['auth:setup'](ev(21), 'admin_b', 'a-very-long-pass-2026');
  const cfg = await handlers['settings:getGoogle'](ev(21));
  assert.deepEqual(cfg, { enabled: true, clientId: '', hasSecret: false, onlineRequiresGoogle: false, builtIn: true, source: 'builtin' });
  assert.equal(JSON.stringify(cfg).includes(BUILT.clientSecret), false);
  await handlers['auth:google-link'](ev(21));
  assert.deepEqual(seen.at(-1), BUILT);

  // מזהה ריק בשמירה = המובנה (לא נדרש מזהה)
  const keep = await handlers['settings:saveGoogle'](ev(21), { enabled: true, clientId: '', onlineRequiresGoogle: true });
  assert.equal(keep.source, 'builtin');
  assert.equal(keep.onlineRequiresGoogle, true);
  // מזהה של הארגון מחליף את המובנה, והסוד המובנה לא עובר אליו
  const own = await handlers['settings:saveGoogle'](ev(21), { enabled: true, clientId: OWN });
  assert.equal(own.source, 'custom');
  assert.equal(own.clientId, OWN);
  assert.equal(own.hasSecret, false);
  await handlers['auth:google-link'](ev(21));
  assert.deepEqual(seen.at(-1), { clientId: OWN, clientSecret: '' });
  // חזרה למובנה
  await handlers['settings:saveGoogle'](ev(21), { enabled: true, clientId: '' });
  await handlers['auth:google-link'](ev(21));
  assert.deepEqual(seen.at(-1), BUILT);
  // כיבוי נשמר — גם אחרי עלייה מחדש
  await handlers['settings:saveGoogle'](ev(21), { enabled: false, clientId: '' });
  await ipc.initEcon(dir, { googleSignIn: signIn, googleClient: BUILT });
  assert.deepEqual((await handlers['auth:status'](ev(22))).google, { enabled: false });
  await assert.rejects(handlers['auth:google-login'](ev(22)), /לא הופעלה/);
});

test('מזהה מובנה ריק או פגום — כמו קודם: כבוי עד שהמנהל מגדיר מזהה', async () => {
  for (const googleClient of [{ clientId: '', clientSecret: '' }, { clientId: 'not-a-client-id' }]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-google-e-'));
    await ipc.initEcon(dir, { googleSignIn: async () => ({}), googleClient });
    assert.deepEqual((await handlers['auth:status'](ev(31))).google, { enabled: false });
    await handlers['auth:setup'](ev(31), 'admin_e', 'a-very-long-pass-2026');
    assert.equal((await handlers['settings:getGoogle'](ev(31))).builtIn, false);
    await assert.rejects(handlers['settings:saveGoogle'](ev(31), { enabled: true, clientId: '' }), /מזהה הלקוח/);
  }
});

test('הקובץ shell/google-client.js: מזהה ריק או תקין, בלי מזהה אמיתי בבדיקות', () => {
  const c = require('../shell/google-client');
  assert.deepEqual(Object.keys(c).sort(), ['clientId', 'clientSecret']);
  if (c.clientId) assert.doesNotThrow(() => GS.validateConfig(c));
  else assert.equal(c.clientSecret, '');
});
