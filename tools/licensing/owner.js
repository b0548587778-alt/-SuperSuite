#!/usr/bin/env node
// כלי שורת פקודה למנהל-העל (Owner) — אותה ליבה כמו מסך "רישוי ומערכות" בתוכנה (shell/licensing/owner-core.js).
// אופליין מלא. ראו docs/LICENSING-DESIGN.md.
//
// תיקיית העבודה (--dir, ברירת מחדל ./owner-data): root.key (מוצפן בסיסמה), root.pub.json, registry.json, notices.json.
// הסיסמה נקראת מהמשתנה SS_OWNER_PASSPHRASE (לא משורת הפקודה — כדי שלא תישמר בהיסטוריה).
//
//   node tools/licensing/owner.js init
//   node tools/licensing/owner.js pubkey
//   node tools/licensing/owner.js install-root      הוספת המפתח הציבורי ל-shell/licensing/root-keys.js (בלי סיסמה)
//   node tools/licensing/owner.js install-root --key <קובץ>   אותו דבר, מהקובץ ששמר הכפתור "שמירת המפתח הציבורי לקובץ"
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
//   node tools/licensing/owner.js relay-cert --relay-pub relay-key.pub.json [--url https://...] [--months 24] --out relay-cert.json
//        תעודה למפתח של שרת הרישוי, לכתובת אחת (בדיקה חתומה — shell/licensing/checkin.js; docs/LICENSING-ACTIVATION.md, שלב 7).
//        בלי --url — הכתובת המובנית (default-relay.js). מפתח מנהל-העל של התוכנה: --dir "%APPDATA%\super-suite\owner"
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('../../shell/licensing/status');
const { createOwnerCore, dirStorage } = require('../../shell/licensing/owner-core');
const L = require('../../shell/licensing/license');
const { DEFAULT_RELAY_URL } = require('../../shell/licensing/default-relay');

const ROOT_KEYS_FILE = path.join(__dirname, '..', '..', 'shell', 'licensing', 'root-keys.js');

// root-keys.js עם המפתח הציבורי הנוסף. מפתחות קיימים נשמרים (החלפת מפתח בלי לפסול רישיונות), ומפתח קיים לא נוסף פעמיים.
// מפתח ציבורי בלבד: JWK עם d (מפתח פרטי) נדחה — כדי שלא ייארז בטעות בתוכנה שנשלחת ללקוחות
function rootKeysSource(existing, publicJwk) {
  if (!publicJwk || typeof publicJwk !== 'object') throw new Error('המפתח הציבורי אינו תקין');
  if ('d' in publicJwk) throw new Error('זה מפתח פרטי! לקובץ נכנס רק המפתח הציבורי (root.pub.json)');
  const id = L.keyId(publicJwk);
  const keys = Array.isArray(existing) ? existing : [];
  const added = !keys.some(k => L.keyId(k) === id);
  const all = added ? [...keys, { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x }] : keys;
  const text = [
    '// מפתחות השורש (Owner) המהימנים — מפתחות ציבוריים בלבד, בפורמט JWK.',
    '// ריק = התקנה בלי רישוי: הכול פתוח. נוסף ב: node tools/licensing/owner.js install-root',
    '// יותר ממפתח אחד מאפשר החלפת מפתח בלי לפסול רישיונות קיימים.',
    'module.exports = [',
    ...all.map(k => '  ' + JSON.stringify(k) + ', // ' + L.keyId(k)),
    '];',
    '',
  ].join('\n');
  return { text, added, keyId: id, count: all.length };
}

// keyFile: קובץ המפתח הציבורי ששמר מסך הרישוי (במקום root.pub.json בתיקיית העבודה)
function installRoot(dir, file = ROOT_KEYS_FILE, keyFile = null) {
  let pub;
  const src = keyFile || path.join(dir, 'root.pub.json');
  try { pub = JSON.parse(fs.readFileSync(src, 'utf8')); }
  catch { throw new Error(keyFile ? 'לא ניתן לקרוא את קובץ המפתח ' + keyFile : 'לא נמצא root.pub.json בתיקייה ' + dir + ' — יש להריץ קודם init'); }
  delete require.cache[require.resolve(file)];
  const r = rootKeysSource(require(file), pub);
  if (r.added) fs.writeFileSync(file, r.text);
  return r;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else out._.push(argv[i]);
  }
  return out;
}

// מעטפת תואמת לגרסה הקודמת: פותחת את המפתח בסיסמה לפי הצורך. רשימת הלקוחות וההודעות מוצפנות במפתח השורש
// (owner-core.js, ממצא 26) — ולכן גם הצגה דורשת את הסיסמה
function createOwner({ dir, passphrase, clock = Date.now }) {
  const core = createOwnerCore({ storage: dirStorage(fs, path, dir), clock });
  const unlocked = (fn) => (...args) => { if (!core.isUnlocked()) core.unlock(passphrase); return fn(...args); };
  return {
    init: () => core.init(passphrase),
    pubkey: unlocked(core.pubkey),
    issue: unlocked(core.issue),
    notice: unlocked(core.notice),
    list: unlocked(() => core.list().tenants),
    noticesPackage: unlocked(core.noticesPackage),
    review: unlocked(core.review),
    approve: unlocked(core.approve),
    approvals: unlocked(core.approvals),
    revoke: unlocked(core.revoke),
    relayCert: unlocked(core.relayCert),
  };
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
      console.log('השלב הבא — הוספת המפתח הציבורי לתוכנה: node tools/licensing/owner.js install-root');
      console.log('חשוב: גבו את התיקייה ואת הסיסמה. בלי מפתח השורש אי אפשר לחדש רישיונות.');
      return;
    }
    case 'pubkey': return console.log(JSON.stringify(owner.pubkey()));
    case 'install-root': {
      const r = installRoot(path.resolve(a.dir || 'owner-data'), undefined, a.key ? path.resolve(String(a.key)) : null);
      console.log(r.added ? `המפתח ${r.keyId} נוסף ל-root-keys.js (${r.count} מפתחות). מהבנייה הבאה — הרישוי פעיל.` : `המפתח ${r.keyId} כבר קיים ב-root-keys.js — לא שונה דבר`);
      return;
    }
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
    case 'list': return console.table(owner.list().map(t => ({ id: t.id, slot: t.slot, name: t.name, status: t.status,
      expiresAt: new Date(t.expiresAt).toLocaleDateString('he-IL'), features: t.features.join(','),
      children: t.children.filter(c => !c.revoked).length, holds: t.holds.map(h => `${h.holdId}:${h.kind}`).join(' ') })));
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
    case 'relay-cert': {
      if (!a['relay-pub']) throw new Error('חסר --relay-pub (הקובץ relay-key.pub.json מהשרת)');
      // הכתובת שהתוכנות פונות אליה — ברירת המחדל: הכתובת המובנית (shell/licensing/default-relay.js)
      const r = owner.relayCert(fs.readFileSync(String(a['relay-pub']), 'utf8'), { origin: typeof a.url === 'string' ? a.url : DEFAULT_RELAY_URL,
        months: a.months ? Number(a.months) : 24 });
      console.log(`נוצרה תעודה למפתח השרת ${r.relayId}, לכתובת ${r.origin}, בתוקף עד ${new Date(r.expiresAt).toLocaleDateString('he-IL')}`);
      return out(r.text);
    }
    default:
      console.log('פקודות: init | pubkey | install-root | issue | list | hold | release | terminate | kill | notices | review | approve | approvals | revoke | relay-cert (פירוט בראש הקובץ)');
  }
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (e) { console.error('שגיאה: ' + e.message); process.exitCode = 1; }
}

module.exports = { createOwner, main, rootKeysSource, installRoot };
