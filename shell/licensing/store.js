// מצב הרישוי של ההתקנה: רישיון, הודעות סטטוס, מערכות בת שהונפקו, ומפתח הצומת (docs/LICENSING-DESIGN.md).
// האחסון מוזרק (adapter) כדי שאותו קוד ירוץ בשולחן העבודה (קבצים + DPAPI) ובאנדרואיד (localStorage של ה-WebView).
// המצב נשמר מחוץ למסד הנתונים, ולכן שחזור גיבוי ישן אינו מוחק השבתה. אין קריאה לרשת (כלל 6).
const L = require('./license');
const S = require('./status');

const CACHE_MS = 60 * 1000;
const LASTSEEN_WRITE_MS = 10 * 60 * 1000;
const MAX_NOTICES = 2000;
const PKG_LICENSE = 'supersuite-license';
const PKG_REQUEST = 'supersuite-license-request';
const PKG_NOTICES = 'supersuite-license-notices';
const PKG_APPROVAL_REQUEST = 'supersuite-approval-request';
const PKG_APPROVAL = 'supersuite-approval';
const MONTH_MS = 30 * L.DAY_MS;

// storage / secret: { read(): string|null, write(text) }. secret מחזיק את המפתח הפרטי של הצומת — חייב להיות מוצפן/פרטי.
// rootKeys ריק = התקנה בלי רישוי: הכול פתוח, כמו לפני שלב הרישוי
function createLicenseStore({ storage, secret, rootKeys = [], clock = Date.now }) {
  let cached = null;
  let cachedAt = -Infinity;

  function load() {
    let raw;
    try { raw = storage.read(); } catch { return { corrupt: true }; }
    if (raw == null) return null;
    try {
      const d = JSON.parse(raw);
      return d && typeof d === 'object' ? d : { corrupt: true };
    } catch { return { corrupt: true }; }
  }
  const blank = () => ({ chain: null, notices: [], children: [], lastSeen: 0 });

  // הקובץ המוצפן (DPAPI) מחזיק את מפתח הצומת וגם "שומר" (סקירת אבטחה 10.2026, ממצא 7): מזהי כל הודעות
  // הסטטוס שנקלטו והזמן המאוחר ביותר שנצפה. קובץ הרישוי עצמו גלוי — מחיקת השבתה ממנו או איפוס lastSeen
  // מתגלים מול השומר. גרסה 1 (ישנה): המפתח בלבד, בלי שומר — השומר נבנה מהמצב הנוכחי בקריאה הראשונה
  function readSecret() {
    const raw = secret.read();
    if (!raw) return null;
    const o = JSON.parse(raw);
    const v2 = o && o.v === 2;
    const key = v2 ? o.key : o;
    L.keyId(key); // תקינות
    const g = v2 && o.guard && typeof o.guard === 'object' ? o.guard : null;
    const guard = g ? { lastSeen: Number.isSafeInteger(g.lastSeen) ? g.lastSeen : 0, notices: Array.isArray(g.notices) ? g.notices.filter(x => typeof x === 'string') : [] } : null;
    return { key, guard };
  }
  const writeSecret = (key, guard) => secret.write(JSON.stringify({ v: 2, key, guard: guard || { lastSeen: 0, notices: [] } }));

  // עדכון השומר אחרי כל שמירה: איחוד מזהי ההודעות, והזמן — רק קדימה. רק הודעות שקובעות את המצב של
  // המערכת הזו (לכולם / לשרשרת שלה) — לא הודעות שהיא הוציאה למערכות הבת שלה
  function guardFrom(d, prev) {
    const ids = new Set(prev ? prev.notices : []);
    const chainIds = new Set((Array.isArray(d.chain) ? d.chain : []).map(l => l && l.payload && l.payload.id));
    for (const n of d.notices || []) {
      const p = n && n.payload;
      if (p && typeof p.id === 'string' && (p.target === S.ALL || chainIds.has(p.target))) ids.add(p.id);
    }
    return { lastSeen: Math.max(prev ? prev.lastSeen : 0, Number.isSafeInteger(d.lastSeen) ? d.lastSeen : 0), notices: [...ids] };
  }
  function syncGuard(d) {
    const sec = readSecret();
    if (sec) writeSecret(sec.key, guardFrom(d, sec.guard));
  }
  const save = (d) => { storage.write(JSON.stringify(d)); cached = null; syncGuard(d); };

  function nodeKey(create) {
    const sec = readSecret();
    if (sec) return sec.key;
    if (!create) return null;
    const { privateJwk } = L.generateKeyPair();
    writeSecret(privateJwk, null);
    return privateJwk;
  }

  const lockedState = (reason) => ({ mode: 'licensed', status: 'locked', features: [], limits: {}, reasons: [{ kind: 'locked', reason }] });

  function compute() {
    if (!rootKeys.length) return { mode: 'unlicensed' };
    const d = load();
    if (!d || !Array.isArray(d.chain)) return lockedState(d && d.corrupt ? 'קובץ הרישיון פגום' : 'לא הותקן רישיון למערכת');
    // רישיון מותקן תמיד יחד עם מפתח הצומת שלו (install בודק). בלי המפתח — הקובץ הועתק או שהשומר נמחק
    let sec;
    try { sec = readSecret(); } catch { return lockedState('לא ניתן לקרוא את מפתח המערכת (הצפנת המערכת אינה זמינה או שהקובץ פגום)'); }
    const leaf = d.chain[d.chain.length - 1];
    if (!sec || !leaf || !leaf.payload || L.keyId(sec.key) !== leaf.payload.id) return lockedState('מפתח המערכת חסר או אינו תואם לרישיון — יש לפנות לספק הרישיון');
    if (!sec.guard) { // התקנה מגרסה קודמת: השומר נבנה פעם אחת מהמצב הנוכחי
      sec.guard = guardFrom(d, null);
      try { writeSecret(sec.key, sec.guard); } catch { /* ינוסה שוב בפעם הבאה */ }
    }
    const have = new Set((d.notices || []).map(n => n && n.payload && n.payload.id));
    const missing = sec.guard.notices.filter(id => !have.has(id)).length;
    if (missing) return lockedState(`קובץ הרישוי שונה מחוץ לתוכנה: חסרות ${missing} הודעות סטטוס. יש לייבא שוב את קובץ ההודעות מהספק (או לסנכרן)`);
    const lastSeen = Math.max(Number.isSafeInteger(d.lastSeen) ? d.lastSeen : 0, sec.guard.lastSeen);
    const r = S.effectiveStatus({ chain: d.chain, notices: d.notices || [], rootKeys, now: clock(), lastSeen });
    // הזמן המאוחר ביותר שנצפה נשמר — הגנה מהחזרת שעון גם בין הפעלות (בקובץ ובשומר)
    if (r.seenAt && r.seenAt > lastSeen + LASTSEEN_WRITE_MS) {
      try { storage.write(JSON.stringify({ ...d, lastSeen: r.seenAt })); } catch { /* לא קריטי */ }
      try { writeSecret(sec.key, { ...sec.guard, lastSeen: r.seenAt }); } catch { /* לא קריטי */ }
    }
    return { mode: 'licensed', ...r, features: r.features || [], limits: r.limits || {} };
  }

  function current() {
    const t = clock();
    if (!cached || t - cachedAt > CACHE_MS || t < cachedAt) { cached = compute(); cachedAt = t; }
    return cached;
  }

  // הודעות: איחוד לפי מזהה, אף פעם לא מחיקה (כך שאי אפשר "לשכוח" השבתה)
  function mergeNotices(existing, incoming) {
    const byId = new Map(existing.map(n => [n.payload.id, n]));
    let added = 0;
    for (const n of incoming || []) {
      const p = n && n.payload;
      if (!p || typeof p.id !== 'string' || typeof n.sig !== 'string' || byId.has(p.id)) continue;
      byId.set(p.id, { payload: p, sig: n.sig });
      added++;
    }
    if (byId.size > MAX_NOTICES) throw new Error('יותר מדי הודעות סטטוס');
    return { notices: [...byId.values()], added };
  }

  function parsePackage(text, type) {
    let pkg;
    try { pkg = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('הקובץ אינו קובץ רישוי תקין'); }
    if (!pkg || pkg.type !== type) throw new Error('הקובץ אינו מהסוג המצופה');
    return pkg;
  }

  // ---------- בקשת רישיון: המפתח הפרטי נוצר כאן ולא יוצא מהמכשיר ----------
  function request(name) {
    const key = nodeKey(true);
    const pub = L.publicOf(key);
    return { type: PKG_REQUEST, v: 1, name: String(name || '').trim().slice(0, 80), publicKey: pub, keyId: L.keyId(pub) };
  }

  // ---------- התקנת רישיון (חדש או חידוש) ----------
  function install(text) {
    if (!rootKeys.length) throw new Error('ההתקנה הזו אינה מוגדרת לרישוי');
    const pkg = parsePackage(text, PKG_LICENSE);
    const leaf = L.verifyChain(pkg.chain, rootKeys);
    const key = nodeKey(false);
    // הרישיון קשור למפתח של המכשיר הזה: העתקת קובץ רישיון להתקנה אחרת לא תעבוד
    if (!key || L.keyId(key) !== leaf.id) throw new Error('הרישיון הונפק למכשיר אחר. יש להפיק בקשת רישיון מהמכשיר הזה');
    const d = load();
    const base = d && !d.corrupt ? { ...blank(), ...d } : blank();
    const { notices } = mergeNotices(base.notices, pkg.notices);
    save({ ...base, chain: pkg.chain, notices });
    return { nodeId: leaf.id, name: leaf.name, expiresAt: leaf.expiresAt };
  }

  function importNotices(text) {
    const pkg = parsePackage(text, PKG_NOTICES);
    const d = load();
    if (!d || d.corrupt) throw new Error('לא הותקן רישיון למערכת');
    const { notices, added } = mergeNotices(d.notices || [], pkg.notices);
    save({ ...d, notices });
    return { added };
  }

  // ---------- הנפקת מערכות בת ----------
  function issuerContext() {
    const st = current();
    if (st.mode !== 'licensed') throw new Error('ההתקנה הזו אינה מוגדרת לרישוי');
    if (st.status !== 'active') throw new Error('לא ניתן להנפיק מערכות כשהמערכת אינה פעילה');
    const d = load();
    const key = nodeKey(false);
    const own = d.chain[d.chain.length - 1];
    if (!key || L.keyId(key) !== own.payload.id) throw new Error('מפתח המערכת חסר או אינו תואם לרישיון');
    return { d, key, own };
  }

  // שלב א: בקשת אישור ממנהל-העל. התנאים נבדקים כבר כאן מול הרישיון של המערכת;
  // המשבצת והחתימה הסופית נקבעות אצל מנהל-העל (הוא גם סופר את המכסה)
  function requestChildApproval(input) {
    const { d, own } = issuerContext();
    const req = parsePackage(input.request, PKG_REQUEST);
    const now = Math.max(clock(), d.lastSeen || 0);
    const months = Number.isSafeInteger(input.months) && input.months > 0 ? input.months : 12;
    const child = {
      publicKey: req.publicKey, name: String(input.name || req.name || '').trim().slice(0, 80),
      features: input.features, limits: input.limits,
      expiresAt: Math.min(now + months * MONTH_MS, own.payload.expiresAt),
      graceDays: input.graceDays == null ? 7 : input.graceDays,
    };
    const childId = L.keyId(child.publicKey);
    const problem = L.checkTerms(own.payload, child);
    if (problem) throw new Error(problem);
    return { childId, package: JSON.stringify({ type: PKG_APPROVAL_REQUEST, v: 1, parentChain: d.chain, child }) };
  }

  // שלב ב: הנפקה לפי אישור חתום של מנהל-העל — בדיוק בתנאים שאושרו
  function issueChild(input) {
    const { d, key, own } = issuerContext();
    const pkg = parsePackage(input.approval, PKG_APPROVAL);
    const a = pkg.approval && pkg.approval.payload;
    if (!a || a.parentId !== own.payload.id) throw new Error('האישור אינו מיועד למערכת הזו');
    const now = Math.max(clock(), d.lastSeen || 0);
    const lic = L.issueLicense({ privateJwk: key, license: own }, {
      name: a.name, publicKey: a.childPublicKey, slot: a.slot, features: a.features, limits: a.limits,
      issuedAt: now, expiresAt: a.expiresAt, graceDays: a.graceDays, approval: pkg.approval,
    }, { rootKeys });
    const childId = lic.payload.id;
    const slot = a.slot;
    const children = d.children || [];
    const entry = { id: childId, slot, name: lic.payload.name, license: lic, issuedAt: now };
    save({ ...d, children: [...children.filter(c => c.id !== childId), entry] });
    return { child: summarizeChild(entry, d), package: licensePackage([...d.chain, lic], d.notices) };
  }

  // הודעה על מערכת בת: השבתה / שחרור / סיום. נשמרת כאן ונמסרת לה בקובץ (או בסנכרון)
  function noticeForChild(input) {
    const { d, key, own } = issuerContext();
    const child = (d.children || []).find(c => c.id === input.childId);
    if (!child) throw new Error('מערכת הבת לא נמצאה');
    const n = S.createNotice({ privateJwk: key, license: own }, {
      type: input.type, target: child.id, kind: input.kind, source: 'parent',
      holdId: input.holdId, reason: input.reason, issuedAt: Math.max(clock(), d.lastSeen || 0),
    });
    if (input.type === 'release') {
      const h = (d.notices || []).find(x => x.payload.id === input.holdId);
      if (!h || h.payload.target !== child.id || h.payload.issuer !== own.payload.id) throw new Error('ההשבתה הזו לא הוטלה על ידי מערכת זו');
    }
    const { notices } = mergeNotices(d.notices || [], [n]);
    save({ ...d, notices });
    return { notice: n.payload, package: noticesPackage(notices, [...d.chain.map(l => l.payload.id), child.id]) };
  }

  function summarizeChild(c, d) {
    const st = S.effectiveStatus({ chain: [...d.chain, c.license], notices: d.notices || [], rootKeys, now: Math.max(clock(), d.lastSeen || 0) });
    const openHolds = st.reasons.filter(r => r.holdId && r.node === c.id).map(r => ({ holdId: r.holdId, kind: r.kind, reason: r.reason }));
    return { id: c.id, slot: c.slot, name: c.name, status: st.status, expiresAt: c.license.payload.expiresAt,
      features: c.license.payload.features, limits: c.license.payload.limits, holds: openHolds };
  }

  function listChildren() {
    const d = load();
    if (!d || !Array.isArray(d.chain)) return [];
    return (d.children || []).map(c => summarizeChild(c, d)).sort((a, b) => a.slot - b.slot);
  }

  // חבילה לקובץ: הודעות שנוגעות לשרשרת בלבד, כדי לא לחשוף מידע על מערכות אחרות
  function relevant(notices, ids) {
    const set = new Set(ids);
    return (notices || []).filter(n => n.payload.target === S.ALL || set.has(n.payload.target));
  }
  const licensePackage = (chain, notices) => JSON.stringify({ type: PKG_LICENSE, v: 1, chain, notices: relevant(notices, chain.map(l => l.payload.id)) });
  const noticesPackage = (notices, ids) => JSON.stringify({ type: PKG_NOTICES, v: 1, notices: relevant(notices, ids) });

  // לסנכרון מרחוק: המפתח הפרטי (לחתימת בקשות לשרת), והמזהים שהמערכת אחראית להעביר אליהם הודעות
  const syncKey = (create) => nodeKey(create);
  function syncInfo() {
    const d = load();
    if (!d || !Array.isArray(d.chain)) return { nodeId: null, children: [] };
    const own = d.chain[d.chain.length - 1].payload;
    return { nodeId: own.id, chainIds: d.chain.map(l => l.payload.id), chain: d.chain,
      children: (d.children || []).map(c => ({ id: c.id, name: c.name, publicKey: c.license.payload.publicKey })) };
  }
  // חבילת הודעות למערכת בת (שלה ושל השרשרת מעליה) — להעברה הלאה של השבתה מלמעלה
  function noticesForChild(childId) {
    const d = load();
    if (!d || !Array.isArray(d.chain)) return null;
    return noticesPackage(d.notices || [], [...d.chain.map(l => l.payload.id), childId]);
  }
  // הגדרות סנכרון (כתובת שרת) — נשמרות עם מצב הרישוי, מחוץ למסד הנתונים
  function getRemoteSettings() { const d = load(); return (d && !d.corrupt && d.remote) || {}; }
  function setRemoteSettings(r) {
    const d = load();
    const base = d && !d.corrupt ? { ...blank(), ...d } : blank();
    save({ ...base, remote: { ...(base.remote || {}), ...r } });
  }

  return { current, invalidate() { cached = null; }, request, install, importNotices, requestChildApproval, issueChild, noticeForChild, listChildren,
    syncKey, syncInfo, noticesForChild, getRemoteSettings, setRemoteSettings };
}

// אחסון בקבצים (שולחן העבודה). fs מוזרק כדי לא לתלות את הקוד באנדרואיד
function fileStorage(fs, file) {
  return {
    read() { try { return fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    write(text) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); },
  };
}

// מפתח פרטי בקובץ מוצפן ב-DPAPI (safeStorage). בלי הצפנת מערכת — אין מפתח (לעולם לא מפתח גלוי בדיסק)
function encryptedFileSecret(fs, file, safeStorage) {
  return {
    read() {
      if (!fs.existsSync(file)) return null;
      if (!safeStorage || !safeStorage.isEncryptionAvailable()) throw new Error('הצפנת המערכת אינה זמינה — לא ניתן לקרוא את מפתח המערכת');
      return safeStorage.decryptString(fs.readFileSync(file));
    },
    write(text) {
      if (!safeStorage || !safeStorage.isEncryptionAvailable()) throw new Error('הצפנת המערכת (DPAPI) אינה זמינה — לא ניתן לשמור את מפתח המערכת בבטחה');
      fs.mkdirSync(file.replace(/[\\/][^\\/]*$/, ''), { recursive: true }); // התיקייה (למשל owner/) אולי עוד לא קיימת
      fs.writeFileSync(file, safeStorage.encryptString(text));
    },
  };
}

// אנדרואיד: localStorage של חלון המעטפת — אחסון פרטי של האפליקציה, לא נגיש לאפליקציות אחרות
function webStorage(ls, key) {
  return { read: () => ls.getItem(key), write: (text) => ls.setItem(key, text) };
}

module.exports = { createLicenseStore, fileStorage, encryptedFileSecret, webStorage, CACHE_MS, PKG_LICENSE, PKG_REQUEST, PKG_NOTICES, PKG_APPROVAL_REQUEST, PKG_APPROVAL };
