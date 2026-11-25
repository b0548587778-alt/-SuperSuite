// ליבת מנהל-העל (Owner): מפתח שורש, הנפקה ללקוחות, אישור מערכות בת, השבתה/החזרה/סיום ונעילה גלובלית.
// משותפת לכלי שורת הפקודה (tools/licensing/owner.js) ולמסך "רישוי ומערכות" בתוכנה — בשולחן העבודה ובאנדרואיד.
// האחסון מוזרק: { read(name): string|null, write(name, text) }. מפתח השורש נשמר מוצפן בסיסמה (פורמט SSBK1:,
// כמו הגיבוי), ונפתח לזיכרון בלבד עד נעילה. ראו docs/LICENSING-DESIGN.md.
const crypto = require('crypto');
const L = require('./license');
const ACT = require('./activation');
const S = require('./status');
const BK = require('../../modules/econ/core/backupCrypto');
const { PKG_LICENSE, PKG_REQUEST, PKG_NOTICES, PKG_APPROVAL_REQUEST, PKG_APPROVAL } = require('./store');
const OF = require('./offer');
const P = require('./products');
const SH = require('./shamir');
const C = require('./crypto-lite');
const CK = require('./checkin');
const AR = require('../../modules/econ/core/atRest');
const CC = require('./owner-cardcom');

// כל קבצי מצב מנהל-העל — לגיבוי מלא (המפתח עצמו נשאר מוצפן בסיסמה גם בתוך הגיבוי)
const OWNER_FILES = ['root.key', 'root.pub.json', 'registry.json', 'notices.json', 'inbox.json', 'releases.json', 'offer.json', 'signups.json', 'payment-provider.json'];
const OWNER_BACKUP_TYPE = 'supersuite-owner-backup';
const SU = require('./signup');

const MIN_PASS = 12;
// קבצים עם פרטי לקוחות (ממצא 26): רשימת הלקוחות, הודעות הסטטוס, תיבת הבקשות וההרשמות (ת"ז, טלפון, דוא"ל, חתימה).
// מוצפנים במפתח שנגזר ממפתח השורש עצמו (HKDF על המפתח הפרטי) — נפתחים רק במצב פתוח, ובכל מחשב שיש בו את
// התיקייה והסיסמה: גיבוי של התיקייה לכונן חיצוני, כלי שורת הפקודה ואנדרואיד — בלי תלות במפתח המסד (DPAPI) של
// המחשב הזה. ההצעה, הגרסאות והמפתח הציבורי ציבוריים ממילא; root.key מוצפן בסיסמה בעצמו.
// payment-provider.json — פרטי המסוף של Cardcom לאימות תשלומי הרשמה (owner-cardcom.js); לעולם לא גלוי בדיסק
const SEALED_OWNER_FILES = ['registry.json', 'notices.json', 'inbox.json', 'signups.json', 'payment-provider.json'];
const OWNER_SEAL_PREFIX = 'SSOW1:';
const OWNER_SEAL_INFO = 'SuperSuite owner files v1';

// הצפנה במפתח השורש: AES-256-GCM של core/atRest.js, עם תחילית משלו (SSOW1: ולא SSDB1: של המסד)
function ownerFileCipher(privateJwk) {
  // nosemgrep: javascript.node-crypto.security.create-de-cipher-no-iv.create-de-cipher-no-iv -- AR.createCipher של הפרויקט (AES-256-GCM עם IV אקראי לכל הצפנה), לא crypto.createCipher הישן
  const inner = AR.createCipher(Buffer.from(C.hkdfSha256(C.b64uDecode(privateJwk.d), new Uint8Array(0), C.utf8(OWNER_SEAL_INFO), 32)));
  return {
    seal: (text) => OWNER_SEAL_PREFIX + inner.seal(text).slice(AR.PREFIX.length),
    open(text, name) {
      try { return inner.open(AR.PREFIX + text.slice(OWNER_SEAL_PREFIX.length)); } catch {
        throw new Error('הקובץ ' + name + ' של מנהל-העל אינו נפתח במפתח השורש הזה (פגום, או ממפתח אחר) — אפשר לשחזר מגיבוי מלא של מנהל-העל');
      }
    },
  };
}
const signupInvalid = (message) => Object.assign(new Error(message), { code: 'signup-invalid' });
// הרשמה לפי הצעה שכבר הוחלפה (ממצא 31): חינם נמסרת מיד בשרת — סטייה קטנה בין השעונים בלבד;
// בתשלום — תשלום שנפתח לפני ההחלפה נשמר בשרת עד 30 יום (PAYMENT_KEEP_MS ב-server/license-relay.js)
const FREE_OFFER_SLACK_MS = 60 * 60 * 1000;
const PAID_OFFER_SLACK_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_SIGNUPS = 1000;

// legacyCipher() — הצופן של המסד (core/atRest.js), רק לקריאת קבצים שהוצפנו בו בגרסת ביניים (SSDB1:); הם מומרים במקום
// maxSignups — תקרת רשימת ההרשמות (בבדיקות — קטנה)
function createOwnerCore({ storage, clock = Date.now, legacyCipher = null, maxSignups = MAX_SIGNUPS }) {
  let key = null; // המפתח הפרטי — בזיכרון בלבד, אחרי פתיחה בסיסמה
  let fileCipher = null; // נגזר מהמפתח; מתאפס בנעילה

  const isSealedName = (n) => SEALED_OWNER_FILES.includes(n);
  const cipher = () => {
    const k = rootKey();
    if (!fileCipher || fileCipher.d !== k.d) fileCipher = { d: k.d, ...ownerFileCipher(k) };
    return fileCipher;
  };
  // קריאה: נתוני לקוחות — רק במצב פתוח (גם כשהקובץ עוד גלוי). קובץ ישן — גלוי, או מוצפן במפתח המסד — מומר במקום:
  // נתוני לקוחות למפתח השורש, השאר לטקסט גלוי. קובץ שלא נפתח — שגיאה בעברית, לעולם לא "ריק"
  function readText(n) {
    const sealed = isSealedName(n);
    if (sealed) rootKey();
    const t = storage.read(n);
    if (t == null) return null;
    if (t.startsWith(OWNER_SEAL_PREFIX)) return cipher().open(t, n);
    let plain = t;
    if (AR.isSealed(t)) {
      const c = legacyCipher ? legacyCipher() : null;
      if (!c || !c.enabled) throw new Error('הקובץ ' + n + ' של מנהל-העל הוצפן במפתח של המחשב הזה, והמפתח אינו זמין — אפשר לשחזר מגיבוי מלא של מנהל-העל או בקוד השחזור 🔑');
      try { plain = c.open(t); } catch { throw new Error('הקובץ ' + n + ' של מנהל-העל הוצפן במחשב או בחשבון אחר — אפשר לשחזר מגיבוי מלא של מנהל-העל'); }
    }
    if (sealed || plain !== t) {
      try { storage.write(n, sealed ? cipher().seal(plain) : plain); } catch { /* ההמרה תנוסה שוב בקריאה הבאה */ }
    }
    return plain;
  }
  const readJson = (n, def) => { const t = readText(n); return t == null ? def : JSON.parse(t); };
  const writeJson = (n, v) => { const text = JSON.stringify(v, null, 2); storage.write(n, isSealedName(n) ? cipher().seal(text) : text); };
  // אחרי פתיחה: כל הקבצים מוצפנים מיד במפתח השורש (וקבצים מגרסת הביניים מומרים) — לא רק כשנקראים.
  // קובץ שלא נפתח נשאר כמו שהוא, והשגיאה מוצגת כשהוא נקרא
  function migrate() {
    for (const n of [...OWNER_FILES, 'recovery.json']) {
      if (n === 'root.key') continue;
      try { readText(n); } catch { /* ראו למעלה */ }
    }
  }
  const registry = () => ({ tenants: [], approvals: [], ...readJson('registry.json', {}) });
  const allNotices = () => readJson('notices.json', []);

  function checkPass(passphrase) {
    if (typeof passphrase !== 'string' || passphrase.length < MIN_PASS) throw new Error(`סיסמת מנהל-העל חייבת להכיל לפחות ${MIN_PASS} תווים`);
    return passphrase;
  }
  const isInitialized = () => storage.read('root.key') != null;
  function rootKey() {
    if (!key) throw new Error(isInitialized() ? 'יש לפתוח את מצב מנהל-העל בסיסמה' : 'מצב מנהל-העל לא הוגדר');
    return key;
  }
  const issuer = () => ({ privateJwk: rootKey() });

  function init(passphrase) {
    checkPass(passphrase);
    if (isInitialized()) throw new Error('כבר קיים מפתח שורש — לא נדרס');
    const k = L.generateKeyPair();
    storage.write('root.key', BK.encryptBackup(JSON.stringify(k.privateJwk), passphrase));
    writeJson('root.pub.json', k.publicJwk);
    key = k.privateJwk; // לפני הרישום — הוא מוצפן במפתח הזה
    writeJson('registry.json', { tenants: [], approvals: [] });
    writeJson('notices.json', []);
    migrate();
    return { keyId: k.keyId, publicKey: k.publicJwk };
  }

  function unlock(passphrase) {
    const enc = storage.read('root.key');
    if (enc == null) throw new Error('מצב מנהל-העל לא הוגדר');
    let k;
    try { k = JSON.parse(BK.decryptBackup(enc, checkPass(passphrase))); } catch (e) {
      throw new Error(/לפחות/.test(e.message) ? e.message : 'הסיסמה שגויה או שקובץ המפתח פגום');
    }
    L.keyId(k);
    key = k;
    migrate();
    return { keyId: L.keyId(k) };
  }
  const lock = () => { key = null; fileCipher = null; };

  // ---------- שמירה על המפתח: החלפת סיסמה, קודי שחזור, גיבוי מלא ----------
  function changePassphrase(oldPass, newPass) {
    checkPass(newPass);
    if (oldPass === newPass) throw new Error('הסיסמה החדשה זהה לישנה');
    unlock(oldPass);
    storage.write('root.key', BK.encryptBackup(JSON.stringify(rootKey()), newPass));
    return { keyId: L.keyId(rootKey()) };
  }

  // אישור חוזר בסיסמה לפעולה שחושפת את המפתח עצמו — גם כשמצב מנהל-העל כבר פתוח (בדיקת קוד 23.10.2026, ממצא 4)
  function confirmPass(passphrase) {
    const cur = rootKey();
    let k;
    try { k = JSON.parse(BK.decryptBackup(storage.read('root.key'), checkPass(passphrase))); } catch (e) {
      throw new Error(/לפחות/.test(e.message) ? e.message : 'הסיסמה שגויה');
    }
    if (!k || k.d !== cur.d) throw new Error('הסיסמה שגויה');
  }

  // קודי שחזור (Shamir): n קודים, כל k מהם משחזרים את המפתח; פחות מ-k אינם מגלים דבר.
  // מומלץ: 5 קודים, 3 לשחזור — אצל אנשים שונים / במקומות שונים (כספת, עו"ד, בן משפחה).
  // שני קודים ומעלה = המפתח עצמו, ולכן רק עם הסיסמה — גם כשהמצב פתוח
  function recoveryCodes(passphrase, n = 5, k = 3) {
    if (typeof passphrase !== 'string') throw new Error('יצירת קודי שחזור דורשת את סיסמת מנהל-העל');
    confirmPass(passphrase);
    const seed = C.b64uDecode(rootKey().d);
    const r = SH.splitToCodes(seed, n, k);
    writeJson('recovery.json', { setId: r.setId, n, k, createdAt: clock() });
    return { ...r, n, k };
  }
  const recoveryInfo = () => readJson('recovery.json', null);

  // שחזור מקודים — גם במחשב חדש. אם כבר יש מפתח ציבורי — חייב להתאים לו
  function recoverFromCodes(codes, newPass) {
    checkPass(newPass);
    const seed = SH.combineCodes(Array.isArray(codes) ? codes : []);
    const x = C.b64uEncode(C.ed25519.getPublicKey(seed));
    const priv = { kty: 'OKP', crv: 'Ed25519', d: C.b64uEncode(seed), x };
    const existing = readJson('root.pub.json', null);
    if (existing && existing.x !== x) throw new Error('הקודים שייכים למפתח אחר מזה של המחשב הזה');
    storage.write('root.key', BK.encryptBackup(JSON.stringify(priv), newPass));
    key = priv;
    if (!existing) {
      writeJson('root.pub.json', L.publicOf(priv));
      if (!storage.read('registry.json')) writeJson('registry.json', { tenants: [], approvals: [] });
      if (!storage.read('notices.json')) writeJson('notices.json', []);
    }
    migrate();
    return { keyId: L.keyId(priv), restoredRegistry: !!existing };
  }

  // גיבוי מלא של מצב מנהל-העל (לקוחות, אישורים, הודעות, הצעה, הרשמות, גרסאות) — מוצפן בסיסמה
  // v2: נתוני הלקוחות בגיבוי מוצפנים במפתח השורש (כמו בתיקייה) — נפתחים אחרי השחזור בסיסמת מנהל-העל, בכל מחשב.
  // קובץ שלא נקרא — הגיבוי נכשל בגלוי (לא גיבוי חלקי)
  function exportBackup(passphrase) {
    rootKey(); // רק כשפתוח
    const files = {};
    for (const n of OWNER_FILES) {
      const t = n === 'root.key' ? storage.read(n) : readText(n);
      if (t != null) files[n] = isSealedName(n) ? cipher().seal(t) : t;
    }
    return BK.encryptBackup(JSON.stringify({ type: OWNER_BACKUP_TYPE, v: 2, at: clock(), keyId: L.keyId(pubkey()),
      tenants: registry().tenants.length, files }), passphrase);
  }
  function importBackup(text, passphrase) {
    let d;
    try { d = JSON.parse(BK.decryptBackup(String(text), passphrase)); } catch { throw new Error('הסיסמה שגויה או שקובץ הגיבוי פגום'); }
    if (!d || d.type !== OWNER_BACKUP_TYPE || !d.files || !d.files['root.key']) throw new Error('הקובץ אינו גיבוי של מנהל-העל');
    const existing = readJson('root.pub.json', null);
    const incoming = JSON.parse(d.files['root.pub.json']);
    if (existing && existing.x !== incoming.x) throw new Error('הגיבוי שייך למפתח אחר מזה של המחשב הזה');
    for (const n of OWNER_FILES) if (typeof d.files[n] === 'string') storage.write(n, d.files[n]);
    lock();
    // גיבוי ישן (v1) — רשימת הלקוחות גלויה בתוכו
    let tenants = Number.isSafeInteger(d.tenants) ? d.tenants : null;
    if (tenants === null) { try { tenants = (JSON.parse(d.files['registry.json'] || '{}').tenants || []).length; } catch { tenants = null; } }
    return { keyId: d.keyId, at: d.at, tenants };
  }
  const isUnlocked = () => !!key;

  // המפתח הציבורי נשמר גלוי, כדי להציג אותו גם בלי לפתוח
  function pubkey() {
    const p = readJson('root.pub.json', null);
    if (p) return p;
    return L.publicOf(rootKey());
  }

  function parse(text, type, msg) {
    let pkg;
    try { pkg = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error(msg); }
    if (!pkg || pkg.type !== type) throw new Error(msg);
    return pkg;
  }

  // ---------- מוצרים (מרכז הרישוי — products.js) ----------
  // המוצר של לקוח: נרשם בהנפקה; לקוח מלפני מרכז הרישוי — לפי התחומים
  const tenantProduct = (t) => (P.isProduct(t.product) ? t.product : P.productOfFeatures(t.license.payload.features));
  // המוצר שבבקשה (תוכנה שמציינת אותו — שיר סטודיו, וגרסאות חדשות); בלי שדה — לא ידוע (null), מנהל-העל בוחר
  const requestProduct = (req) => (req && P.isProduct(req.product) ? req.product : null);
  // חבילות ששולמו: הרשמה לתכנית שמכסה כמה מוצרים — ממנה מונפק רישיון לכל מוצר בחבילה, פעם אחת לכל מוצר, בלי תשלום נוסף
  const bundlesOf = (reg) => (Array.isArray(reg.bundles) ? reg.bundles : []);
  function bundleSummary(b) {
    return { id: b.id, customer: b.customer, planName: b.planName, scope: b.scope, scopeName: P.scopeName(b.scope), products: [...b.products],
      issued: { ...b.issued }, months: b.months, createdAt: b.createdAt, pending: b.products.filter(pid => !b.issued[pid]) };
  }
  // חבילות שאפשר להנפיק מהן למוצר הזה: המוצר בחבילה ועוד לא הונפק לו (או שהונפק לאותה מערכת — חידוש)
  const bundlesFor = (reg, product, id) => bundlesOf(reg)
    .filter(b => b.products.includes(product) && (!b.issued[product] || b.issued[product] === id)).map(bundleSummary);

  // ---------- לקוחות (רמה 1): למנהל-העל אין מכסה ----------
  // opts.product — המוצר (אחרת: מהבקשה, מהלקוח הקיים, או לפי התחומים). התחומים חייבים להיות של המוצר הזה.
  // opts.bundleId — הנפקה לפי חבילה ששולמה: התחומים, המכסות והתקופה מהחבילה (לא מהקלט)
  function issue(opts) {
    const req = parse(opts.request, PKG_REQUEST, 'הקובץ אינו בקשת רישיון');
    const reg = registry();
    const id = L.keyId(req.publicKey);
    const existing = reg.tenants.find(t => t.id === id);
    const fromReq = requestProduct(req);
    const product = opts.product != null ? opts.product : (fromReq || (existing ? tenantProduct(existing) : P.productOfFeatures(opts.features)));
    if (!P.isProduct(product)) throw new Error('המוצר אינו מוכר');
    if (fromReq && fromReq !== product) throw new Error(`הבקשה נשלחה מ${P.productName(fromReq)} — אי אפשר להנפיק לה רישיון של ${P.productName(product)}`);
    let terms = { features: opts.features, limits: opts.limits, months: opts.months, graceDays: opts.graceDays };
    let bundle = null;
    if (opts.bundleId != null) {
      bundle = bundlesOf(reg).find(b => b.id === opts.bundleId);
      if (!bundle) throw new Error('החבילה לא נמצאה');
      if (!bundle.products.includes(product)) throw new Error(`${P.productName(product)} אינו חלק מהחבילה הזו`);
      if (bundle.issued[product] && bundle.issued[product] !== id) throw new Error(`מהחבילה הזו כבר הונפק רישיון ל${P.productName(product)}`);
      terms = { features: bundle.features[product], limits: bundle.limits, months: bundle.months, graceDays: opts.graceDays };
    }
    const problem = P.checkFeatures(product, terms.features);
    if (problem) throw new Error(problem);
    const slot = existing ? existing.slot : reg.tenants.reduce((m, t) => Math.max(m, t.slot), 0) + 1;
    const now = clock();
    // שנה לפחות (ACT.termMs) — מערכת עם רישיון קצר משנה לא נפתחת (shell/licensing/activation.js)
    const termMs = ACT.termMs(terms.months == null ? 12 : terms.months);
    const lic = L.issueLicense(issuer(), {
      name: opts.name || req.name, publicKey: req.publicKey, slot,
      features: terms.features, limits: terms.limits,
      issuedAt: now, expiresAt: now + termMs, graceDays: terms.graceDays,
    });
    const bundleId = bundle ? bundle.id : (existing && existing.bundleId) || null;
    reg.tenants = [...reg.tenants.filter(t => t.id !== id), { id, slot, name: lic.payload.name, product, license: lic, issuedAt: now,
      ...(bundleId ? { bundleId } : {}) }];
    if (bundle) reg.bundles = bundlesOf(reg).map(b => (b.id === bundle.id ? { ...b, issued: { ...b.issued, [product]: id } } : b));
    writeJson('registry.json', reg);
    return { id, slot, name: lic.payload.name, product, renewal: !!existing, ...(bundle ? { bundleId: bundle.id } : {}),
      package: JSON.stringify({ type: PKG_LICENSE, v: 1, chain: [lic], notices: noticesFor([id]) }) };
  }

  function noticesFor(ids) {
    const set = new Set(ids);
    return allNotices().filter(n => n.payload.target === S.ALL || set.has(n.payload.target));
  }

  function notice(input) {
    if (input.type === 'release') {
      const h = allNotices().find(x => x.payload.id === input.holdId);
      if (!h || h.payload.type !== 'hold' || h.payload.target !== input.target) throw new Error('ההשבתה לשחרור לא נמצאה על היעד הזה');
    }
    const n = S.createNotice(issuer(), { source: 'owner', ...input, issuedAt: clock() });
    writeJson('notices.json', [...allNotices(), n]);
    return n.payload;
  }

  // מצב כל לקוח ומערכת בת לפי ההודעות של מנהל-העל
  function list() {
    const reg = registry();
    const notices = allNotices();
    const rootKeys = [pubkey()];
    const now = clock();
    const holdsOf = (st, id) => st.reasons.filter(r => r.holdId && r.node === id).map(r => ({ holdId: r.holdId, kind: r.kind, reason: r.reason }));
    const tenants = reg.tenants.map(t => {
      const st = S.effectiveStatus({ chain: [t.license], notices, rootKeys, now });
      return { id: t.id, slot: t.slot, name: t.name, product: tenantProduct(t), bundleId: t.bundleId || null, status: st.status, expiresAt: t.license.payload.expiresAt,
        features: t.license.payload.features, limits: t.license.payload.limits, holds: holdsOf(st, t.id),
        children: reg.approvals.filter(a => a.parentId === t.id).map(a => ({
          id: a.childId, slot: a.slot, name: a.name, approvedAt: a.approvedAt, revoked: !!a.revoked,
          terminated: notices.some(n => n.payload.type === 'terminate' && n.payload.target === a.childId),
          holds: notices.filter(n => n.payload.type === 'hold' && n.payload.target === a.childId && n.payload.issuer === S.ROOT
            && !notices.some(r => r.payload.type === 'release' && r.payload.holdId === n.payload.id))
            .map(n => ({ holdId: n.payload.id, kind: n.payload.kind, reason: n.payload.reason })),
        })).sort((x, y) => x.slot - y.slot) };
    }).sort((a, b) => a.slot - b.slot);
    const globalHolds = notices.filter(n => n.payload.target === S.ALL && n.payload.type === 'hold'
      && !notices.some(r => r.payload.type === 'release' && r.payload.holdId === n.payload.id))
      .map(n => ({ holdId: n.payload.id, kind: n.payload.kind, reason: n.payload.reason }));
    return { tenants, globalHolds, bundles: bundlesOf(reg).map(bundleSummary), products: P.catalog() };
  }

  // ---------- תעודה למפתח של שרת הרישוי (בדיקה חתומה — checkin.js, ממצא 27) ----------
  // relayPub — המפתח הציבורי שהשרת יצר (relay-key.pub.json); origin — כתובת השרת שהתוכנות פונות אליה (התעודה
  // תקפה רק לה: שרת בכתובת אחרת שמעביר בקשות לשרת האמיתי לא מאושר). התעודה מועתקת לשרת (relay-cert.json)
  // allowLocal — מצב בדיקה מפורש בלבד (תעודה לשרת על 127.0.0.1 בבדיקות); כלי שורת הפקודה לא מעביר אותו
  function relayCert(relayPub, { origin, months = 24, allowLocal = false } = {}) {
    let pub = relayPub;
    if (typeof pub === 'string') { try { pub = JSON.parse(pub); } catch { throw new Error('קובץ המפתח של השרת אינו תקין'); } }
    const text = CK.createRelayCert(rootKey(), pub, { origin, issuedAt: clock(), months, allowLocal });
    const p = CK.verifyRelayCert(text, [pubkey()], clock(), { allowLocal });
    return { text, relayId: p.relayId, origin: p.origin, expiresAt: p.expiresAt };
  }

  // ---------- מערכות בת: לקוח מבקש, מנהל-העל מאשר וסופר את המכסה ----------
  function readApprovalRequest(text) {
    const pkg = parse(text, PKG_APPROVAL_REQUEST, 'הקובץ אינו בקשת אישור למערכת בת');
    if (!pkg.child) throw new Error('הקובץ אינו בקשת אישור למערכת בת');
    const parent = L.verifyChain(pkg.parentChain, [pubkey()]);
    return { parent, child: pkg.child, childId: L.keyId(pkg.child.publicKey) };
  }
  const activeApprovals = (reg, parentId) => reg.approvals.filter(x => x.parentId === parentId && !x.revoked);

  // פתיחת קובץ שהגיע מלקוח: בקשת רישיון (לקוח חדש/חידוש) או בקשת אישור למערכת בת
  function openRequest(text) {
    let pkg;
    try { pkg = JSON.parse(text); } catch { throw new Error('הקובץ אינו קובץ רישוי תקין'); }
    if (pkg && pkg.type === PKG_REQUEST) {
      const id = L.keyId(pkg.publicKey);
      const reg = registry();
      const existing = reg.tenants.find(t => t.id === id);
      // product — מהבקשה (קבוע); בלי — הצעה (productGuess) מהלקוח הקיים, ומנהל-העל בוחר
      const product = requestProduct(pkg);
      const productGuess = product || (existing ? tenantProduct(existing) : P.DEFAULT_PRODUCT);
      const bundles = P.PRODUCTS.map(x => x.id).filter(pid => !product || pid === product)
        .flatMap(pid => bundlesFor(reg, pid, id).map(b => ({ ...b, forProduct: pid })));
      return { kind: 'license', id, name: pkg.name, renewal: !!existing, product, productGuess, bundles,
        current: existing ? { features: existing.license.payload.features, limits: existing.license.payload.limits, product: tenantProduct(existing) } : null };
    }
    if (pkg && pkg.type === PKG_APPROVAL_REQUEST) return { kind: 'approval', ...review({ request: text }) };
    throw new Error('הקובץ אינו בקשה של לקוח');
  }

  function review(opts) {
    const { parent, child, childId } = readApprovalRequest(opts.request);
    const used = activeApprovals(registry(), parent.id);
    const renewal = used.some(x => x.childId === childId);
    return { parentId: parent.id, parentName: parent.name, childId, name: child.name, features: child.features, limits: child.limits,
      expiresAt: child.expiresAt, renewal, quota: { used: used.length, max: parent.limits.maxChildren },
      problem: L.checkTerms(parent, child) || (!renewal && used.length >= parent.limits.maxChildren ? 'המכסה של הלקוח מלאה' : null) };
  }

  function approve(opts) {
    const { parent, child, childId } = readApprovalRequest(opts.request);
    const reg = registry();
    const used = activeApprovals(reg, parent.id);
    const prev = used.find(x => x.childId === childId);
    let slot = prev && prev.slot;
    if (!slot) {
      const taken = new Set(used.map(x => x.slot));
      for (let i = 1; i <= parent.limits.maxChildren; i++) if (!taken.has(i)) { slot = i; break; }
      if (!slot) throw new Error(`המכסה של "${parent.name}" מלאה: עד ${parent.limits.maxChildren} מערכות בת`);
    }
    const problem = L.checkTerms(parent, { ...child, slot });
    if (problem) throw new Error(problem);
    const now = clock();
    const approval = L.createApproval(rootKey(), {
      id: crypto.randomUUID(), parentId: parent.id, childPublicKey: child.publicKey, depth: parent.depth + 1, slot,
      name: child.name, features: child.features, limits: child.limits, expiresAt: child.expiresAt, graceDays: child.graceDays, approvedAt: now,
    });
    reg.approvals = [...reg.approvals.filter(x => x !== prev),
      { id: approval.payload.id, parentId: parent.id, parentName: parent.name, childId, childPublicKey: approval.payload.childPublicKey, slot, name: approval.payload.name, approvedAt: now }];
    writeJson('registry.json', reg);
    return { childId, slot, name: approval.payload.name, parentName: parent.name, package: JSON.stringify({ type: PKG_APPROVAL, v: 1, approval }) };
  }

  // דחיית בקשה — אין מה לשמור; נרשמת ביומן הביקורת של התוכנה
  function approvals() {
    return registry().approvals
      .map(({ id, parentId, parentName, childId, slot, name, approvedAt, revoked }) => ({ id, parentId, parentName, childId, slot, name, approvedAt, revoked: !!revoked }));
  }

  // ביטול אישור: הודעת סיום למערכת הבת, והמשבצת מתפנה
  function revoke({ childId, reason }) {
    const reg = registry();
    const a = reg.approvals.find(x => x.childId === childId && !x.revoked);
    if (!a) throw new Error('לא נמצא אישור פעיל למערכת הזו');
    const n = notice({ type: 'terminate', target: childId, reason });
    a.revoked = true;
    writeJson('registry.json', reg);
    return n;
  }

  // חבילת הודעות ללקוח: שלו ושל כל מערכות הבת שלו (כדי שיעביר הלאה)
  function noticesPackage(target) {
    const kids = registry().approvals.filter(a => a.parentId === target).map(a => a.childId);
    return JSON.stringify({ type: PKG_NOTICES, v: 1, notices: noticesFor([target, ...kids]) });
  }

  // לסנכרון מרחוק: בקשות שהגיעו מהשרת ממתינות כאן להחלטה (אישור/דחייה בכפתור)
  const inbox = () => readJson('inbox.json', []);
  // מי אמור לשלוח את הבקשה (from בשרת = מזהה המפתח שחתם על הפנייה): בקשת רישיון — המערכת עצמה (המפתח שבבקשה);
  // בקשת אישור למערכת בת — ההורה (קצה השרשרת). אחרת מישהו יכול להעביר בקשה של אחר ולקבל את התשובה במקומו
  function senderOf(text) {
    const pkg = JSON.parse(text);
    if (pkg && pkg.type === PKG_REQUEST) return L.keyId(pkg.publicKey);
    if (pkg && pkg.type === PKG_APPROVAL_REQUEST) return readApprovalRequest(text).parent.id;
    return null;
  }
  const WRONG_SENDER = 'הבקשה לא נשלחה מהמערכת שביקשה אותה — אפשר רק לדחות אותה';
  function addToInbox(msg) {
    const list = inbox();
    if (list.some(m => m.id === msg.id)) return false;
    let summary;
    try {
      summary = openRequest(msg.body);
      if (senderOf(msg.body) !== msg.from) summary = { kind: 'invalid', error: WRONG_SENDER };
    } catch (e) { summary = { kind: 'invalid', error: e.message }; }
    writeJson('inbox.json', [...list, { id: msg.id, from: msg.from, at: msg.at, body: msg.body, summary }].slice(-200));
    return true;
  }
  // בקשה להנפקה / לאישור — נבדקת שוב שהשולח הוא מי שביקש (גם בקשות שנשמרו לפני הבדיקה)
  function inboxRequest(id) {
    const m = peekInbox(id);
    let from = null;
    try { from = senderOf(m.body); } catch { /* בקשה פגומה */ }
    if (!from || from !== m.from) throw new Error(WRONG_SENDER);
    return m;
  }
  function takeFromInbox(id) {
    const list = inbox();
    const m = list.find(x => x.id === id);
    if (!m) throw new Error('הבקשה לא נמצאה');
    writeJson('inbox.json', list.filter(x => x.id !== id));
    return m;
  }
  const peekInbox = (id) => { const m = inbox().find(x => x.id === id); if (!m) throw new Error('הבקשה לא נמצאה'); return m; };
  const rootSigner = () => rootKey();
  // כל הלקוחות ומערכות הבת שאושרו — למי לשלוח עדכוני סטטוס
  function recipients() {
    const reg = registry();
    return [...reg.tenants.map(t => t.id), ...reg.approvals.filter(a => !a.revoked).map(a => a.childId)];
  }

  // אנשי הקשר של מנהל-העל: כל הלקוחות, ומערכות הבת שאושרו (עם מפתח ציבורי)
  function contacts() {
    const reg = registry();
    return [
      ...reg.tenants.map(t => ({ id: t.id, name: t.name, publicKey: t.license.payload.publicKey, role: 'tenant' })),
      ...reg.approvals.filter(a => !a.revoked && a.childPublicKey).map(a => ({ id: a.childId, name: a.name + ' (' + a.parentName + ')', publicKey: a.childPublicKey, role: 'child' })),
    ];
  }

  // ---------- הרשמה: הצעה (תכניות + תקנון) והרשמות שהתקבלו ----------
  // published — מתי כל הצעה פורסמה בשרת ({ issuedAt, at }), לבדיקת הרשמות לפי הצעה ישנה (ממצא 31)
  // הצעה ראשית אחת (master) ← הצעה חתומה לכל מוצר שיש לו תכנית (texts), כולן באותו issuedAt.
  // text — ההצעה של SuperSuite (כמו בגרסה הקודמת)
  function setOffer(input) {
    const master = OF.cleanMaster(input);
    const issuedAt = clock();
    const texts = {};
    for (const [pid, part] of Object.entries(OF.splitMaster(master))) texts[pid] = OF.createOffer(rootKey(), part, { issuedAt, product: pid });
    const prev = readJson('offer.json', null);
    writeJson('offer.json', { v: 2, master, texts, text: texts[P.THIS_PRODUCT] || null, issuedAt,
      published: (prev && Array.isArray(prev.published)) ? prev.published : [] });
    return offer();
  }
  // { master, issuedAt, texts, offers: { <מוצר>: הצעה מאומתת }, text / offer — של SuperSuite (או null) }
  function offer() {
    const o = readJson('offer.json', null);
    if (!o) return null;
    const texts = o.texts && typeof o.texts === 'object' ? o.texts : (o.text ? { [P.THIS_PRODUCT]: o.text } : {});
    const offers = {};
    for (const [pid, text] of Object.entries(texts)) {
      if (!P.isProduct(pid) || typeof text !== 'string') continue;
      try { offers[pid] = OF.verifyOffer(text, [pubkey()], { expectProduct: pid }); } catch { /* הצעה פגומה — לא מוצגת ולא מתפרסמת */ }
    }
    const pids = Object.keys(offers);
    if (!pids.length) return null;
    const issuedAt = offers[pids[0]].issuedAt;
    let master = null;
    try { master = o.master ? OF.cleanMaster(o.master) : OF.masterFromOffer(offers[pids[0]]); } catch { master = null; }
    const own = offers[P.THIS_PRODUCT] || null;
    return { master, issuedAt, texts: Object.fromEntries(pids.map(pid => [pid, texts[pid]])), offers,
      text: own ? texts[P.THIS_PRODUCT] : null, offer: own };
  }
  // אחרי פרסום מוצלח בשרת (sync.js → ownerPublishOffer). issuedAt — ההצעה שנשלחה בפועל: בזמן שהפרסום רץ ברשת
  // אולי כבר נשמרה הצעה חדשה, שעוד לא פורסמה. בלי issuedAt — ההצעה הנוכחית
  function offerPublished(issuedAt, at = clock()) {
    const o = readJson('offer.json', null);
    let id = issuedAt;
    if (!Number.isSafeInteger(id)) { const cur = offer(); id = cur ? cur.issuedAt : null; }
    if (!o || !Number.isSafeInteger(id)) return;
    const list = (Array.isArray(o.published) ? o.published : []).filter(x => x && x.issuedAt !== id);
    writeJson('offer.json', { ...o, published: [...list, { issuedAt: id, at }].slice(-50) });
  }
  // האם ההצעה הזו הייתה המפורסמת בזמן t: עד שפורסמה אחריה הצעה אחרת (+ slack). הצעה שלא נרשם פרסום שלה — לא
  // (למשל הצעה שנשמרה ועוד לא פורסמה); רק כשאין רישום פרסומים בכלל (התקנה מלפני הבדיקה) — ההצעה הנוכחית
  function offerLiveAt(issuedAt, t, slack) {
    const o = readJson('offer.json', null) || {};
    const list = (Array.isArray(o.published) ? o.published : []).filter(x => x && Number.isSafeInteger(x.at)).sort((a, b) => a.at - b.at);
    const i = list.findIndex(x => x.issuedAt === issuedAt);
    if (i < 0) {
      if (list.length) return false;
      const cur = offer();
      return !!cur && cur.issuedAt === issuedAt;
    }
    const next = list[i + 1];
    return !next || t <= next.at + slack;
  }
  // הרשמה שנמסרה מהשרת (אחרי תשלום, או חינם): נבדקת ונשמרת. ההנפקה — בלחיצה.
  // at — זמן המסירה בשרת. הרשמה לפי הצעה שאינה המפורסמת (תכנית זולה או חינמית מהעבר — ממצא 31) נשמרת לבדיקה
  // ("review") ולא מונפקת בלחיצה — גם חינם: השרת מוחק אותה אחרי הקליטה, ודחייה הייתה מאבדת הרשמה אמיתית שלא נרשם
  // לה פרסום (התקנה מלפני הבדיקה, או הצעה שנשמרה בזמן הפרסום). הרשמה לא תקינה — signup-invalid
  function addSignup(deliveryText, { at } = {}) {
    let d;
    try { d = JSON.parse(deliveryText); } catch { throw signupInvalid('הרשמה פגומה'); }
    let v;
    try { v = SU.verifySignup(d.signup, [pubkey()]); } catch (e) { throw signupInvalid(e.message); }
    const list = readJson('signups.json', []);
    if (list.some(x => x.id === v.body.id)) return { added: false, id: v.body.id };
    const paid = v.plan.priceAgorot > 0;
    if (paid && !(d.payment && d.payment.amountAgorot === v.plan.priceAgorot)) throw signupInvalid('הרשמה בתשלום ללא אישור תשלום');
    const when = Number.isSafeInteger(at) ? at : clock();
    const live = offerLiveAt(v.offer.issuedAt, when, paid ? PAID_OFFER_SLACK_MS : FREE_OFFER_SLACK_MS);
    const problem = paid ? 'ההרשמה נעשתה לפי הצעה שכבר הוחלפה — יש לבדוק את התשלום ואת התכנית לפני הנפקה'
      : 'ההרשמה לתכנית החינמית נעשתה לפי הצעה שאינה המפורסמת — יש לבדוק את התכנית לפני הנפקה';
    writeJson('signups.json', trimSignups([...list, { id: v.body.id, keyId: v.body.keyId, customer: v.body.customer, product: v.product, planId: v.plan.id, planName: v.plan.name,
      ...(v.plan.bundle ? { bundle: { scope: v.plan.bundle.scope, products: [...v.plan.bundle.products] } } : {}),
      priceAgorot: v.plan.priceAgorot, months: v.plan.months, terms: v.body.terms, signedAt: v.body.signedAt, payment: d.payment || null,
      receivedAt: clock(), status: live ? 'new' : 'review', ...(live ? {} : { problem }),
      signup: d.signup }]));
    return { added: true, id: v.body.id, review: !live };
  }
  // תקרת הרשימה — נחתכות רק הרשמות שכבר הונפקו, הוותיקות קודם. הרשמה שלא טופלה (גם בתשלום) לא נמחקת לעולם
  // (סקירת קוד 2.11.2026: קודם נחתכו בשקט 1,000 האחרונות, כולל הרשמות בתשלום שלא טופלו)
  function trimSignups(list) {
    let extra = list.length - maxSignups;
    if (extra <= 0) return list;
    return list.filter(x => !(extra > 0 && x.status === 'issued' && extra-- > 0));
  }
  const signups = () => readJson('signups.json', []);
  function signupOf(id) { const x = signups().find(y => y.id === id); if (!x) throw new Error('ההרשמה לא נמצאה'); return x; }
  // הנפקת רישיון לפי ההרשמה: תחומים, מכסות ותקופה — מהתכנית ששולמה
  // force — אחרי בדיקה ידנית של הרשמה שסומנה "review"
  function issueSignup(id, { force = false } = {}) {
    const x = signupOf(id);
    if (x.status === 'review' && !force) throw new Error(x.problem || 'ההרשמה ממתינה לבדיקה');
    const v = SU.verifySignup(x.signup, [pubkey()]);
    // חבילה (תכנית שמכסה כמה מוצרים): נרשמת לפני ההנפקה, וההנפקה הראשונה — למוצר שממנו נרשמו — היא חלק ממנה.
    // שאר המוצרים — כשתגיע בקשה מהם ("לפי חבילה"), בלי תשלום נוסף
    let bundleId = null;
    if (v.plan.bundle) {
      const b = v.plan.bundle;
      const reg = registry();
      if (!bundlesOf(reg).some(y => y.id === x.id)) {
        reg.bundles = [...bundlesOf(reg), { id: x.id, customer: x.customer.org, planId: v.plan.id, planName: v.plan.name, scope: b.scope,
          products: [...b.products], features: JSON.parse(JSON.stringify(b.features)), limits: { ...v.plan.limits }, months: v.plan.months,
          issued: {}, createdAt: clock() }];
        writeJson('registry.json', reg);
      }
      bundleId = x.id;
    }
    const r = issue({ request: v.request, name: x.customer.org, product: v.product,
      ...(bundleId ? { bundleId } : { features: v.plan.features, limits: v.plan.limits, months: v.plan.months }) });
    writeJson('signups.json', signups().map(y => (y.id === id ? { ...y, status: 'issued', issuedAt: clock(), tenantId: r.id } : y)));
    return { ...r, keyId: x.keyId };
  }
  // ---------- אימות תשלום מול Cardcom (החלטת הבעלים 5.11.2026) ----------
  // פרטי המסוף — מוצפנים במפתח השורש; שם ה-API לא יוצא למסך (רק "מוגדר" ומספר המסוף)
  function setCardcomCredentials(input) {
    const c = CC.normalizeCardcomCredentials(input);
    writeJson('payment-provider.json', { cardcom: { ...c, savedAt: clock() } });
    return paymentProviderInfo();
  }
  function clearCardcomCredentials() {
    writeJson('payment-provider.json', {});
    return paymentProviderInfo();
  }
  // לשימוש התהליך הראשי בלבד (הפנייה ל-Cardcom); null — לא הוגדר
  function cardcomCredentials() {
    const c = (readJson('payment-provider.json', {}) || {}).cardcom;
    try { return c ? CC.normalizeCardcomCredentials(c) : null; } catch { return null; }
  }
  function paymentProviderInfo() {
    const c = cardcomCredentials();
    return { cardcom: c ? { configured: true, terminal: c.terminal } : { configured: false } };
  }
  // תוצאת האימות נשמרת בהרשמה (בקובץ המוצפן). עסקה שכבר אימתה הרשמה אחרת — לא מאמתת שוב (שרת שנפרץ ושולח
  // את אותה עסקה אמיתית לשתי הרשמות)
  function setSignupPaymentCheck(id, check) {
    const x = signupOf(id);
    const c = { status: CC.CHECK_STATUSES.includes(check && check.status) ? check.status : 'unavailable',
      message: String((check && check.message) || '').slice(0, 300), at: clock(),
      lowProfileId: String((check && check.lowProfileId) || ''), tranzactionId: String((check && check.tranzactionId) || ''),
      ...(check && Number.isSafeInteger(check.amountAgorot) ? { amountAgorot: check.amountAgorot } : {}) };
    // בדיקה חוזרת שנכשלה ברשת לא מבטלת אימות קודם
    if (c.status === 'unavailable' && x.paymentCheck && x.paymentCheck.status === 'verified') return x.paymentCheck;
    if (c.status === 'verified') {
      const lp = c.lowProfileId.toLowerCase();
      const reused = signups().some(y => y.id !== id && y.paymentCheck && y.paymentCheck.status === 'verified'
        && String(y.paymentCheck.lowProfileId || '').toLowerCase() === lp);
      if (reused || !x.payment || c.amountAgorot !== x.payment.amountAgorot) {
        Object.assign(c, { status: 'mismatch', message: reused ? 'העסקה ב-Cardcom כבר אימתה הרשמה אחרת — אין להנפיק' : 'הסכום שאומת אינו הסכום שבהרשמה — אין להנפיק' });
      }
    }
    writeJson('signups.json', signups().map(y => (y.id === id ? { ...y, paymentCheck: c } : y)));
    return c;
  }
  function setSignupInvoice(id, invoice) {
    signupOf(id);
    writeJson('signups.json', signups().map(y => (y.id === id ? { ...y, invoice } : y)));
  }
  function signedDocument(id) {
    const x = signupOf(id);
    const v = SU.verifySignup(x.signup, [pubkey()]);
    return { html: SU.signedDocumentHtml(v), name: 'תקנון-חתום-' + x.customer.org };
  }

  // גרסאות ששוחררו (תעודות חתומות) — לשליחה חוזרת ולתצוגה
  function releases() { return readJson('releases.json', []); }
  function addRelease(text, payload) {
    const list = releases().filter(r => !(r.version === payload.version && r.platform === payload.platform));
    writeJson('releases.json', [...list, { version: payload.version, platform: payload.platform, fileName: payload.fileName, size: payload.size,
      url: payload.url, notes: payload.notes, issuedAt: payload.issuedAt, text }].slice(-50));
  }

  return { MIN_PASS, changePassphrase, recoveryCodes, recoveryInfo, recoverFromCodes, exportBackup, importBackup, contacts, releases, addRelease, setOffer, offer, offerPublished, addSignup, signups, issueSignup, signedDocument, setSignupInvoice, setCardcomCredentials, clearCardcomCredentials, cardcomCredentials, paymentProviderInfo, setSignupPaymentCheck, isInitialized, init, unlock, lock, isUnlocked, pubkey, issue, notice, list, openRequest, review, approve, approvals, revoke, noticesPackage,
    inbox, addToInbox, takeFromInbox, peekInbox, inboxRequest, rootSigner, recipients, relayCert };
}

// אחסון בתיקייה (שולחן העבודה וכלי שורת הפקודה). fs/path מוזרקים.
// כתיבה עמידה: קובץ זמני + fsync + החלפה — הפסקת חשמל לא משאירה את מפתח השורש או את הרישום חצויים
function dirStorage(fs, path, dir) {
  return {
    read(n) { try { return fs.readFileSync(path.join(dir, n), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    write(n, text) {
      fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, n);
      const tmp = f + '.tmp';
      if (typeof fs.openSync === 'function' && typeof fs.fsyncSync === 'function') {
        const fd = fs.openSync(tmp, 'w');
        try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      } else {
        fs.writeFileSync(tmp, text);
      }
      fs.renameSync(tmp, f);
    },
  };
}

// אנדרואיד: localStorage של המעטפת, עם תחילית
function prefixedWebStorage(ls, prefix) {
  return { read: (n) => ls.getItem(prefix + n), write: (n, text) => ls.setItem(prefix + n, text) };
}

// אישור התשלום בהרשמה מגיע מהשרת בלי חתימה (סקירת קוד 2.11.2026) — שרת שנפרץ יכול "לאשר" תשלום שלא התקבל.
// חתימה של השרת לא עוזרת (המפתח שלו נמצא עליו), ולכן לפני חשבונית והנפקה בתשלום — מנהל-העל מאשר במפורש
// שבדק את התשלום אצל חברת הסליקה. null — אין צורך באישור (חינם, כבר אושר, או כבר יש חשבונית)
// כשמוגדרים פרטי Cardcom (verifyConfigured) — האימות במחשב של מנהל-העל מול Cardcom (owner-cardcom.js, החלטת הבעלים
// 5.11.2026): אומת ← null; לא שולם / לא תואם ← חסום (גם עם אישור ידני); לא נבדק עדיין ← PAYMENT_UNVERIFIED (המסך מאמת);
// לא ניתן לאמת (רשת, הרשמה ישנה) ← חוזרים לאישור הידני, עם הסיבה
const PAYMENT_UNCONFIRMED = 'payment-unconfirmed';
const PAYMENT_UNVERIFIED = 'payment-unverified';
const PAYMENT_REJECTED = 'payment-rejected';
function signupPaymentCode(x, opts = {}) {
  const { paymentConfirmed = false, verifyConfigured = false } = opts;
  if (!x || !x.payment || !(x.payment.amountAgorot > 0) || x.invoice) return null;
  const c = x.paymentCheck && typeof x.paymentCheck === 'object' ? x.paymentCheck : null;
  if (c && c.status === 'verified' && c.amountAgorot === x.payment.amountAgorot) return null;
  if (c && (c.status === 'mismatch' || c.status === 'unpaid')) {
    return { code: PAYMENT_REJECTED, message: 'התשלום לא אומת מול Cardcom: ' + String(c.message || '') + ' — אפשר לבדוק שוב אחרי בירור' };
  }
  if (verifyConfigured && !c) return { code: PAYMENT_UNVERIFIED, message: 'נדרש אימות מול Cardcom לפני הנפקה וחשבונית' };
  if (paymentConfirmed === true) return null;
  const ref = x.payment.providerRef ? ` (אסמכתה ${String(x.payment.providerRef)})` : '';
  const why = c && c.status === 'unavailable' && c.message ? `האימות מול Cardcom לא הושלם (${String(c.message)}). ` : '';
  return { code: PAYMENT_UNCONFIRMED,
    message: `נדרש אימות התשלום: ${why}יש לוודא במערכת חברת הסליקה שהתקבל תשלום של ₪${(x.payment.amountAgorot / 100).toLocaleString('he-IL')}${ref} לפני הנפקה וחשבונית` };
}
function signupPaymentProblem(x, opts) {
  const r = signupPaymentCode(x, opts);
  return r ? r.message : null;
}

module.exports = { signupPaymentProblem, signupPaymentCode, PAYMENT_UNCONFIRMED, PAYMENT_UNVERIFIED, PAYMENT_REJECTED, createOwnerCore, dirStorage, prefixedWebStorage, MIN_PASS, SEALED_OWNER_FILES, OWNER_SEAL_PREFIX };
