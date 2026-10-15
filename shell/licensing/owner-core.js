// ליבת מנהל-העל (Owner): מפתח שורש, הנפקה ללקוחות, אישור מערכות בת, השבתה/החזרה/סיום ונעילה גלובלית.
// משותפת לכלי שורת הפקודה (tools/licensing/owner.js) ולמסך "רישוי ומערכות" בתוכנה — בשולחן העבודה ובאנדרואיד.
// האחסון מוזרק: { read(name): string|null, write(name, text) }. מפתח השורש נשמר מוצפן בסיסמה (פורמט SSBK1:,
// כמו הגיבוי), ונפתח לזיכרון בלבד עד נעילה. ראו docs/LICENSING-DESIGN.md.
const crypto = require('crypto');
const L = require('./license');
const S = require('./status');
const BK = require('../../modules/econ/core/backupCrypto');
const { PKG_LICENSE, PKG_REQUEST, PKG_NOTICES, PKG_APPROVAL_REQUEST, PKG_APPROVAL } = require('./store');

const MIN_PASS = 12;
const MONTH_MS = 30 * L.DAY_MS;

function createOwnerCore({ storage, clock = Date.now }) {
  let key = null; // המפתח הפרטי — בזיכרון בלבד, אחרי פתיחה בסיסמה

  const readJson = (n, def) => { const t = storage.read(n); return t == null ? def : JSON.parse(t); };
  const writeJson = (n, v) => storage.write(n, JSON.stringify(v, null, 2));
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
    writeJson('registry.json', { tenants: [], approvals: [] });
    writeJson('notices.json', []);
    key = k.privateJwk;
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
    return { keyId: L.keyId(k) };
  }
  const lock = () => { key = null; };
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

  // ---------- לקוחות (רמה 1): למנהל-העל אין מכסה ----------
  function issue(opts) {
    const req = parse(opts.request, PKG_REQUEST, 'הקובץ אינו בקשת רישיון');
    const reg = registry();
    const id = L.keyId(req.publicKey);
    const existing = reg.tenants.find(t => t.id === id);
    const slot = existing ? existing.slot : reg.tenants.reduce((m, t) => Math.max(m, t.slot), 0) + 1;
    const now = clock();
    const months = Number.isSafeInteger(opts.months) && opts.months > 0 ? opts.months : 12;
    const lic = L.issueLicense(issuer(), {
      name: opts.name || req.name, publicKey: req.publicKey, slot,
      features: opts.features, limits: opts.limits,
      issuedAt: now, expiresAt: now + months * MONTH_MS, graceDays: opts.graceDays,
    });
    reg.tenants = [...reg.tenants.filter(t => t.id !== id), { id, slot, name: lic.payload.name, license: lic, issuedAt: now }];
    writeJson('registry.json', reg);
    return { id, slot, name: lic.payload.name, renewal: !!existing,
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
      return { id: t.id, slot: t.slot, name: t.name, status: st.status, expiresAt: t.license.payload.expiresAt,
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
    return { tenants, globalHolds };
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
      const existing = registry().tenants.find(t => t.id === id);
      return { kind: 'license', id, name: pkg.name, renewal: !!existing,
        current: existing ? { features: existing.license.payload.features, limits: existing.license.payload.limits } : null };
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
      { id: approval.payload.id, parentId: parent.id, parentName: parent.name, childId, slot, name: approval.payload.name, approvedAt: now }];
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
  function addToInbox(msg) {
    const list = inbox();
    if (list.some(m => m.id === msg.id)) return false;
    let summary;
    try { summary = openRequest(msg.body); } catch (e) { summary = { kind: 'invalid', error: e.message }; }
    writeJson('inbox.json', [...list, { id: msg.id, from: msg.from, at: msg.at, body: msg.body, summary }].slice(-200));
    return true;
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

  return { MIN_PASS, isInitialized, init, unlock, lock, isUnlocked, pubkey, issue, notice, list, openRequest, review, approve, approvals, revoke, noticesPackage,
    inbox, addToInbox, takeFromInbox, peekInbox, rootSigner, recipients };
}

// אחסון בתיקייה (שולחן העבודה וכלי שורת הפקודה). fs/path מוזרקים
function dirStorage(fs, path, dir) {
  return {
    read(n) { try { return fs.readFileSync(path.join(dir, n), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    write(n, text) { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, n); fs.writeFileSync(f + '.tmp', text); fs.renameSync(f + '.tmp', f); },
  };
}

// אנדרואיד: localStorage של המעטפת, עם תחילית
function prefixedWebStorage(ls, prefix) {
  return { read: (n) => ls.getItem(prefix + n), write: (n, text) => ls.setItem(prefix + n, text) };
}

module.exports = { createOwnerCore, dirStorage, prefixedWebStorage, MIN_PASS };
