#!/usr/bin/env node
// כלי מנהל-העל (Owner): מפתח שורש, הנפקת רישיונות ללקוחות, השבתה/החזרה/סיום ונעילה גלובלית.
// רץ במחשב של מנהל-העל בלבד — לא נארז בתוכנה. אופליין מלא. ראו docs/LICENSING-DESIGN.md.
//
// תיקיית העבודה (--dir, ברירת מחדל ./owner-data):
//   root.key       מפתח השורש הפרטי, מוצפן בסיסמה (AES-256-GCM + scrypt, אותו פורמט כמו הגיבוי)
//   registry.json  הלקוחות שהונפקו (משבצות, רישיונות)
//   notices.json   כל הודעות הסטטוס שנחתמו
// הסיסמה נקראת מהמשתנה SS_OWNER_PASSPHRASE (לא משורת הפקודה — כדי שלא תישמר בהיסטוריה).
//
//   node tools/licensing/owner.js init
//   node tools/licensing/owner.js pubkey
//   node tools/licensing/owner.js issue --request req.json --features econ,econ.npo,tools --max-children 3 \
//        --max-users 10 --max-storage 5000 --max-depth 2 --months 12 [--grace 7] [--name "..."] --out lic.sslic
//   node tools/licensing/owner.js list
//   node tools/licensing/owner.js hold --target <id> --kind suspended|locked|pending_payment --reason "..."
//   node tools/licensing/owner.js release --target <id> --hold <holdId> --reason "..."
//   node tools/licensing/owner.js terminate --target <id> --reason "..."
//   node tools/licensing/owner.js kill --reason "..."          נעילה גלובלית של כל המערכות
//   node tools/licensing/owner.js notices --target <id> --out notices.sslic
//   node tools/licensing/owner.js review --request approval-request.sslic     הצגת בקשה של לקוח למערכת בת
//   node tools/licensing/owner.js approve --request approval-request.sslic --out approval.sslic
//   node tools/licensing/owner.js approvals                                    כל מערכות הבת שאושרו
//   node tools/licensing/owner.js revoke --child <id> --reason "..."          ביטול אישור: מסיים את מערכת הבת ומפנה משבצת
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const L = require('../../shell/licensing/license');
const S = require('../../shell/licensing/status');
const BK = require('../../modules/econ/core/backupCrypto');
const { PKG_LICENSE, PKG_REQUEST, PKG_NOTICES, PKG_APPROVAL_REQUEST, PKG_APPROVAL } = require('../../shell/licensing/store');

const MIN_PASS = 12;
const MONTH_MS = 30 * L.DAY_MS;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else out._.push(argv[i]);
  }
  return out;
}

function createOwner({ dir, passphrase, clock = Date.now }) {
  const file = (n) => path.join(dir, n);
  const readJson = (n, def) => (fs.existsSync(file(n)) ? JSON.parse(fs.readFileSync(file(n), 'utf8')) : def);
  const writeJson = (n, v) => { const t = file(n) + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, file(n)); };

  function needPass() {
    if (typeof passphrase !== 'string' || passphrase.length < MIN_PASS) throw new Error(`יש להגדיר SS_OWNER_PASSPHRASE באורך ${MIN_PASS} תווים לפחות`);
    return passphrase;
  }
  function rootKey() {
    if (!fs.existsSync(file('root.key'))) throw new Error('אין מפתח שורש. יש להריץ init');
    try { return JSON.parse(BK.decryptBackup(fs.readFileSync(file('root.key'), 'utf8'), needPass())); }
    catch { throw new Error('הסיסמה שגויה או שקובץ המפתח פגום'); }
  }
  const issuer = () => ({ privateJwk: rootKey() });

  function init() {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file('root.key'))) throw new Error('כבר קיים מפתח שורש בתיקייה הזו — לא נדרס');
    const k = L.generateKeyPair();
    fs.writeFileSync(file('root.key'), BK.encryptBackup(JSON.stringify(k.privateJwk), needPass()));
    writeJson('registry.json', { tenants: [], approvals: [] });
    writeJson('notices.json', []);
    return { keyId: k.keyId, publicKey: k.publicJwk };
  }

  function pubkey() { const k = rootKey(); return L.publicOf(k); }

  function issue(opts) {
    const req = typeof opts.request === 'string' ? JSON.parse(opts.request) : opts.request;
    if (!req || req.type !== PKG_REQUEST) throw new Error('קובץ הבקשה אינו בקשת רישיון');
    const reg = readJson('registry.json', { tenants: [] });
    const id = L.keyId(req.publicKey);
    const existing = reg.tenants.find(t => t.id === id);
    // למנהל-העל אין מכסה: משבצת חדשה לכל לקוח, ושמירה על המשבצת בחידוש
    const slot = existing ? existing.slot : reg.tenants.reduce((m, t) => Math.max(m, t.slot), 0) + 1;
    const now = clock();
    const lic = L.issueLicense(issuer(), {
      name: opts.name || req.name, publicKey: req.publicKey, slot,
      features: opts.features, limits: opts.limits,
      issuedAt: now, expiresAt: now + (opts.months || 12) * MONTH_MS, graceDays: opts.graceDays,
    });
    reg.tenants = [...reg.tenants.filter(t => t.id !== id), { id, slot, name: lic.payload.name, license: lic, issuedAt: now }];
    writeJson('registry.json', reg);
    return { id, slot, package: JSON.stringify({ type: PKG_LICENSE, v: 1, chain: [lic], notices: noticesFor([id]) }) };
  }

  function noticesFor(ids) {
    const set = new Set(ids);
    return readJson('notices.json', []).filter(n => n.payload.target === S.ALL || set.has(n.payload.target));
  }

  function notice(input) {
    const n = S.createNotice(issuer(), { ...input, issuedAt: clock() });
    if (input.type === 'release') {
      const h = readJson('notices.json', []).find(x => x.payload.id === input.holdId);
      if (!h || h.payload.type !== 'hold' || h.payload.target !== input.target) throw new Error('ההשבתה לשחרור לא נמצאה על היעד הזה');
    }
    writeJson('notices.json', [...readJson('notices.json', []), n]);
    return n.payload;
  }

  // מצב כל לקוח לפי ההודעות של מנהל-העל (מה שהלקוח יראה אחרי שיקבל אותן)
  function list() {
    const reg = readJson('registry.json', { tenants: [] });
    const notices = readJson('notices.json', []);
    const rootKeys = [pubkey()];
    return reg.tenants.map(t => {
      const st = S.effectiveStatus({ chain: [t.license], notices, rootKeys, now: clock() });
      return { id: t.id, slot: t.slot, name: t.name, status: st.status, expiresAt: t.license.payload.expiresAt,
        features: t.license.payload.features, limits: t.license.payload.limits,
        holds: st.reasons.filter(r => r.holdId).map(r => ({ holdId: r.holdId, kind: r.kind, node: r.node, reason: r.reason })) };
    }).sort((a, b) => a.slot - b.slot);
  }

  // ---------- אישור מערכות בת: לקוח מבקש, מנהל-העל מאשר (וסופר את המכסה) ----------
  function readApprovalRequest(text) {
    let pkg;
    try { pkg = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('הקובץ אינו בקשת אישור תקינה'); }
    if (!pkg || pkg.type !== PKG_APPROVAL_REQUEST || !pkg.child) throw new Error('הקובץ אינו בקשת אישור למערכת בת');
    const parent = L.verifyChain(pkg.parentChain, [pubkey()]);
    return { parent, child: pkg.child, childId: L.keyId(pkg.child.publicKey) };
  }

  function activeApprovals(reg, parentId) {
    return (reg.approvals || []).filter(x => x.parentId === parentId && !x.revoked);
  }

  // תצוגה לפני אישור: מי מבקש, מה, והאם יש מקום במכסה
  function review(opts) {
    const { parent, child, childId } = readApprovalRequest(opts.request);
    const reg = readJson('registry.json', { tenants: [], approvals: [] });
    const used = activeApprovals(reg, parent.id);
    const renewal = used.some(x => x.childId === childId);
    return { parentId: parent.id, parentName: parent.name, childId, name: child.name, features: child.features, limits: child.limits,
      expiresAt: child.expiresAt, renewal, quota: { used: used.length, max: parent.limits.maxChildren },
      problem: L.checkTerms(parent, child) || (!renewal && used.length >= parent.limits.maxChildren ? 'המכסה של הלקוח מלאה' : null) };
  }

  function approve(opts) {
    const { parent, child, childId } = readApprovalRequest(opts.request);
    const reg = readJson('registry.json', { tenants: [], approvals: [] });
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
    reg.approvals = [...(reg.approvals || []).filter(x => x !== prev),
      { id: approval.payload.id, parentId: parent.id, parentName: parent.name, childId, slot, name: approval.payload.name, approvedAt: now }];
    writeJson('registry.json', reg);
    return { childId, slot, package: JSON.stringify({ type: PKG_APPROVAL, v: 1, approval }) };
  }

  function approvals() {
    return (readJson('registry.json', { tenants: [], approvals: [] }).approvals || [])
      .map(({ id, parentId, parentName, childId, slot, name, approvedAt, revoked }) => ({ id, parentId, parentName, childId, slot, name, approvedAt, revoked: !!revoked }));
  }

  // ביטול אישור: הודעת סיום למערכת הבת, והמשבצת מתפנה
  function revoke({ childId, reason }) {
    const reg = readJson('registry.json', { tenants: [], approvals: [] });
    const a = (reg.approvals || []).find(x => x.childId === childId && !x.revoked);
    if (!a) throw new Error('לא נמצא אישור פעיל למערכת הזו');
    const n = notice({ type: 'terminate', target: childId, reason });
    a.revoked = true;
    writeJson('registry.json', reg);
    return n;
  }

  const noticesPackage = (target) => JSON.stringify({ type: PKG_NOTICES, v: 1, notices: noticesFor([target]) });

  return { init, pubkey, issue, notice, list, noticesPackage, review, approve, approvals, revoke };
}

function limitsFrom(a) {
  const n = (k) => { const v = Number(a[k]); if (!Number.isSafeInteger(v) || v < 0) throw new Error(`חסר או לא תקין: --${k}`); return v; };
  return { maxChildren: n('max-children'), maxUsers: n('max-users'), maxStorageMb: n('max-storage'), maxDepth: n('max-depth') };
}

function main(argv) {
  const a = parseArgs(argv);
  const cmd = a._[0];
  const owner = createOwner({ dir: path.resolve(a.dir || 'owner-data'), passphrase: process.env.SS_OWNER_PASSPHRASE });
  const out = (text) => { if (a.out) { fs.writeFileSync(a.out, text); console.log('נשמר: ' + a.out); } else console.log(text); };
  switch (cmd) {
    case 'init': {
      const r = owner.init();
      console.log('נוצר מפתח שורש ' + r.keyId);
      console.log('יש להוסיף ל-shell/licensing/root-keys.js:\n' + JSON.stringify(r.publicKey));
      console.log('חשוב: גבו את התיקייה ואת הסיסמה. בלי מפתח השורש אי אפשר לחדש רישיונות.');
      return;
    }
    case 'pubkey': return console.log(JSON.stringify(owner.pubkey()));
    case 'issue': {
      if (!a.request) throw new Error('חסר --request');
      const r = owner.issue({
        request: fs.readFileSync(a.request, 'utf8'), name: a.name,
        features: String(a.features || '').split(',').map(s => s.trim()).filter(Boolean),
        limits: limitsFrom(a), months: a.months ? Number(a.months) : 12, graceDays: a.grace != null ? Number(a.grace) : undefined,
      });
      console.log(`הונפק רישיון ללקוח ${r.id} (משבצת ${r.slot})`);
      return out(r.package);
    }
    case 'list': return console.table(owner.list().map(t => ({ ...t, expiresAt: new Date(t.expiresAt).toLocaleDateString('he-IL'),
      features: t.features.join(','), holds: t.holds.map(h => `${h.holdId}:${h.kind}`).join(' ') })));
    case 'hold': return console.log(owner.notice({ type: 'hold', target: a.target, kind: a.kind, source: a.source || 'owner', reason: a.reason }));
    case 'release': return console.log(owner.notice({ type: 'release', target: a.target, holdId: a.hold, reason: a.reason }));
    case 'terminate': return console.log(owner.notice({ type: 'terminate', target: a.target, reason: a.reason }));
    case 'kill': return console.log(owner.notice({ type: 'hold', target: S.ALL, kind: 'locked', source: 'owner', reason: a.reason }));
    case 'review': if (!a.request) throw new Error('חסר --request'); return console.log(owner.review({ request: fs.readFileSync(a.request, 'utf8') }));
    case 'approve': {
      if (!a.request) throw new Error('חסר --request');
      const r = owner.approve({ request: fs.readFileSync(a.request, 'utf8') });
      console.log(`אושרה מערכת בת ${r.childId} (משבצת ${r.slot})`);
      return out(r.package);
    }
    case 'approvals': return console.table(owner.approvals());
    case 'revoke': return console.log(owner.revoke({ childId: a.child, reason: a.reason }));
    case 'notices': if (!a.target) throw new Error('חסר --target'); return out(owner.noticesPackage(a.target));
    default:
      console.log('פקודות: init | pubkey | issue | list | hold | release | terminate | kill | notices | review | approve | approvals | revoke (פירוט בראש הקובץ)');
  }
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (e) { console.error('שגיאה: ' + e.message); process.exitCode = 1; }
}

module.exports = { createOwner, main };
