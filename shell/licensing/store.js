// מצב הרישוי של ההתקנה: רישיון, הודעות סטטוס, מערכות בת שהונפקו, ומפתח הצומת (docs/LICENSING-DESIGN.md).
// האחסון מוזרק (adapter) כדי שאותו קוד ירוץ בשולחן העבודה (קבצים + DPAPI) ובאנדרואיד (localStorage של ה-WebView).
// המצב נשמר מחוץ למסד הנתונים, ולכן שחזור גיבוי ישן אינו מוחק השבתה. אין קריאה לרשת (כלל 6).
const L = require('./license');
const ACT = require('./activation');
const S = require('./status');
const CK = require('./checkin');
const { FEATURES: ALL_FEATURES } = require('./offer');

const CACHE_MS = 60 * 1000;
const LASTSEEN_WRITE_MS = 10 * 60 * 1000;
// תקרת הודעות לכל מנפיק (חוץ מהשורש) — מנפיק אחד, גם המערכת עצמה, לא חוסם הודעות של אחרים
const MAX_NOTICES = 2000;
const READ_ERROR = 'לא ניתן לקרוא כרגע את קובץ הרישוי (ייתכן שתוכנה אחרת, למשל אנטי-וירוס, תופסת אותו) — נסו שוב בעוד רגע';
// code — כדי שהסנכרון לא יאשר לשרת הודעה שנכשלה רק בגלל קובץ תפוס (sync.js, receive)
const READ_ERROR_CODE = 'license-read-error';
const readError = () => Object.assign(new Error(READ_ERROR), { code: READ_ERROR_CODE });
// שומר שנכתב בגרסה הזו (guard.syncV). בלעדיו — שומר מגרסה קודמת: זמן הסנכרון בקובץ הגלוי מועבר אליו פעם אחת
const GUARD_SYNC_V = 1;
// זמן סנכרון שאינו חתום (מהשומר, או מהקובץ הגלוי בהעברה מגרסה קודמת) נחשב עד התאריך הזה בלבד (סקירת אבטחה
// 24.10.2026, ממצא 1). מכאן והלאה "החיבור האחרון לשרת" — רק מהתשובה החתומה של השרת שנשמרה (CK.storedCheckinTime).
// שחזור עותק ישן של license-key.bin (שומר בלי syncV) ועריכת license.json כבר לא מקדמים את החיבור אחרי התאריך הזה
const LEGACY_SYNC_CUTOFF = Date.UTC(2026, 9, 24);
const PKG_LICENSE = 'supersuite-license';
const PKG_REQUEST = 'supersuite-license-request';
const PKG_NOTICES = 'supersuite-license-notices';
const PKG_APPROVAL_REQUEST = 'supersuite-approval-request';
const PKG_APPROVAL = 'supersuite-approval';
// תקופת ניסיון (PLAN.md 4.2): התקנה בלי רישיון — הכול פתוח ל-30 יום, ואחר כך קריאה, ייצוא וגיבוי בלבד
const TRIAL_DAYS = 30;
const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;
const TRIAL_WARN_DAYS = 7;

// storage / secret: { read(): string|null, write(text) }. secret מחזיק את המפתח הפרטי של הצומת — חייב להיות מוצפן/פרטי.
// rootKeys ריק = התקנה בלי רישוי: הכול פתוח, כמו לפני שלב הרישוי
// defaultUrl: כתובת השרת כשלא נשמרה כתובת. כתובת ריקה שנשמרה = החיבור לשרת כבוי
// onMark(mark): סימון בלתי תלוי בקבצי הרישוי ({ trialStart, hadLicense }) — נשמר מחוץ להם (במסד הנתונים, ipc.js)
// ונטען בחזרה ב-setMark. בלי onMark (בדיקות, אנדרואיד בלי מסד) — רק הקובץ והשומר
// markStorage ({ read, write }): עותק נוסף של אותו סימון מחוץ למסד (קובץ קטן בתיקיית הנתונים) — מחיקת המסד לבדו לא מספיקה
function createLicenseStore({ storage, secret, rootKeys = [], clock = Date.now, defaultUrl = '', onMark = null, markStorage = null }) {
  let cached = null;
  let cachedAt = -Infinity;

  // שגיאת קריאה (למשל EBUSY) — readError: הקובץ לא נדרס ולא מסומן "פגום" לצמיתות (בדיקת קוד 23.10.2026, ממצא 35)
  function load() {
    let raw;
    try { raw = storage.read(); } catch { return { corrupt: true, readError: true }; }
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
    const hashes = g && g.hashes && typeof g.hashes === 'object' ? Object.fromEntries(Object.entries(g.hashes).filter(([, h]) => typeof h === 'string')) : {};
    const guard = g ? { lastSeen: Number.isSafeInteger(g.lastSeen) ? g.lastSeen : 0, notices: Array.isArray(g.notices) ? g.notices.filter(x => typeof x === 'string') : [],
      hashes,
      ...(Number.isSafeInteger(g.trialStart) && g.trialStart > 0 ? { trialStart: g.trialStart } : {}), ...(g.hadLicense === true ? { hadLicense: true } : {}),
      ...(Number.isSafeInteger(g.lastSync) && g.lastSync > 0 ? { lastSync: g.lastSync } : {}),
      ...(g.syncV === GUARD_SYNC_V ? { syncV: GUARD_SYNC_V } : {}) } : null;
    return { key, guard };
  }
  // טביעת אצבע של הודעה: שינוי של תו אחד בהודעה (שמבטל את החתימה, וכך "מעלים" השעיה) מתגלה מול השומר
  const noticeHash = (n) => L.sha256Hex(L.canonical({ payload: n.payload, sig: n.sig }));
  // זמן הסנכרון שבקובץ הגלוי (לא מאוחר מ"עכשיו" ומהתאריך הקבוע LEGACY_SYNC_CUTOFF) — רק להעברה משומר של גרסה
  // קודמת. null — הקובץ תפוס כרגע. בלי התקרה הקבועה, שחזור עותק ישן של קובץ המפתח + עריכת הקובץ הגלוי נתנו כל זמן
  function fileLastSync() {
    const d = load();
    if (d && d.readError) return null;
    const v = d && !d.corrupt && d.remote ? Number(d.remote.lastSync) : 0;
    return Number.isSafeInteger(v) && v > 0 ? Math.min(v, clock(), legacyCap()) : 0;
  }
  // בלי רישוי (אין מפתח שורש) — כמו קודם, בלי תקרה
  function legacyCap() { return rootKeys.length ? LEGACY_SYNC_CUTOFF : Infinity; }
  // כל כתיבה של השומר מסמנת אותו (syncV). שומר בלי הסימון בא מגרסה קודמת: בכתיבה הראשונה שלו בגרסה הזו — וזו
  // ההזדמנות היחידה — הזמן שבקובץ מועבר אליו. כך רישיון שהותקן עכשיו ועוד לא סונכרן לא "מתחדש" בעריכת הקובץ
  // (בדיקת קוד 23.10.2026, ממצא 28). guard ריק (מפתח חדש, nodeKey) — חדש, בלי העברה
  function writeSecret(key, guard) {
    let g = guard || { lastSeen: 0, notices: [], syncV: GUARD_SYNC_V };
    if (g.syncV !== GUARD_SYNC_V) {
      const at = g.lastSync ? 0 : fileLastSync();
      // קובץ תפוס — נכתב בלי הסימון, וההעברה תיעשה בכתיבה הבאה (לא מאבדים את הזמן של הגרסה הקודמת)
      if (at !== null) g = { ...g, ...(at ? { lastSync: at } : {}), syncV: GUARD_SYNC_V };
    }
    secret.write(JSON.stringify({ v: 2, key, guard: g }));
    return g;
  }

  // עדכון השומר אחרי כל שמירה: איחוד מזהי ההודעות, והזמן — רק קדימה. רק הודעות שקובעות את המצב של
  // המערכת הזו (לכולם / לשרשרת שלה) — לא הודעות שהיא הוציאה למערכות הבת שלה
  // lastSync — רק מסנכרון אמיתי (setRemoteSettings), לא מהקובץ הגלוי: עריכת הקובץ לא "מחדשת" את החיבור לשרת
  function guardFrom(d, prev, { lastSync } = {}) {
    const ids = new Set(prev ? prev.notices : []);
    // טביעה נרשמת פעם אחת, כשההודעה נקלטת — ולא מתעדכנת מהקובץ אחר כך
    const hashes = { ...((prev && prev.hashes) || {}) };
    const chainIds = new Set((Array.isArray(d.chain) ? d.chain : []).map(l => l && l.payload && l.payload.id));
    let ctx = null; // נבנה רק כשיש הודעה חדשה לבדוק
    for (const n of d.notices || []) {
      const p = n && n.payload;
      if (p && typeof p.id === 'string' && (p.target === S.ALL || chainIds.has(p.target))) {
        if (!ids.has(p.id)) {
          // הודעה שלא אומתה בחתימה לא נרשמת בשומר (ממצא 5) — אחרת זבל שנכתב לקובץ "ננעל" בו לתמיד
          if (!ctx) ctx = noticeContext(d.chain, []);
          if (!noticeSigned(n, ctx)) continue;
          ids.add(p.id);
        }
        if (!hashes[p.id]) hashes[p.id] = noticeHash(n);
      }
    }
    const syncAt = Math.max((prev && prev.lastSync) || 0, Number.isSafeInteger(lastSync) ? lastSync : 0);
    // תחילת הניסיון: המוקדמת מבין השומר והקובץ — מחיקה או שינוי של הקובץ לא מאריכים אותו. תאריך עתידי בקובץ — לא נקלט
    const fromFile = Number.isSafeInteger(d.trialStart) && d.trialStart <= clock() ? d.trialStart : 0;
    const starts = [prev && prev.trialStart, fromFile].filter(x => Number.isSafeInteger(x) && x > 0);
    return { lastSeen: Math.max(prev ? prev.lastSeen : 0, Number.isSafeInteger(d.lastSeen) ? d.lastSeen : 0), notices: [...ids], hashes,
      ...(starts.length ? { trialStart: Math.min(...starts) } : {}),
      ...(syncAt > 0 ? { lastSync: syncAt } : {}),
      ...(prev && prev.syncV === GUARD_SYNC_V ? { syncV: GUARD_SYNC_V } : {}),
      // הותקן כאן רישיון פעם — מחיקת הקובץ לא מחזירה לתקופת ניסיון
      ...((prev && prev.hadLicense) || Array.isArray(d.chain) ? { hadLicense: true } : {}) };
  }
  function syncGuard(d, opts) {
    const sec = readSecret();
    if (sec) writeSecret(sec.key, guardFrom(d, sec.guard, opts));
  }

  // ---------- אימות הודעות סטטוס לפני קליטה (בדיקת קוד 23.10.2026, ממצא 5) ----------
  // הודעה נקלטת, ונרשמת בשומר, רק בחתימה תקינה של מי שרשאי להוציא אותה: מפתח השורש, או צומת בשרשרת
  // הרישיונות המאומתת של המערכת. ורק כשהיא נוגעת למערכת: לכולם (מהשורש בלבד), לצומת בשרשרת, או למערכת בת
  // שהמערכת הנפיקה. בלי זה אפשר היה למלא את הרשימה ב-2000 הודעות זבל, ואז השעיה אמיתית כבר לא נכנסה
  function noticeContext(chain, children) {
    const keys = new Map();
    let verified = false;
    try { L.verifyChain(chain, rootKeys); verified = true; } catch { /* בלי שרשרת מאומתת — רק הודעות של השורש */ }
    if (verified) for (const l of chain) keys.set(l.payload.id, l.payload.publicKey);
    const targets = new Set(keys.keys());
    for (const c of Array.isArray(children) ? children : []) if (c && typeof c.id === 'string') targets.add(c.id);
    return { keys, targets };
  }
  function noticeShape(n) {
    const p = n && n.payload;
    return !!(p && typeof p === 'object' && typeof p.id === 'string' && p.id && typeof n.sig === 'string');
  }
  function noticeSigned(n, ctx) {
    if (!noticeShape(n)) return false;
    const p = n.payload;
    if (p.target === S.ALL ? p.issuer !== S.ROOT : !ctx.targets.has(p.target)) return false;
    const signers = p.issuer === S.ROOT ? rootKeys : (ctx.keys.has(p.issuer) ? [ctx.keys.get(p.issuer)] : []);
    return signers.some(k => L.verifyObject(p, n.sig, k));
  }
  const save = (d, opts) => { storage.write(JSON.stringify(d)); cached = null; syncGuard(d, opts); };

  function nodeKey(create) {
    const sec = readSecret();
    if (sec) return sec.key;
    if (!create) return null;
    const { privateJwk } = L.generateKeyPair();
    writeSecret(privateJwk, null);
    return privateJwk;
  }

  const lockedState = (reason) => ({ mode: 'licensed', status: 'locked', features: [], limits: {}, reasons: [{ kind: 'locked', reason }] });

  // סימון שלישי, בלתי תלוי בקבצי הרישוי (בדיקת קוד 23.10.2026, ממצא 29): תחילת הניסיון והאם הותקן כאן רישיון.
  // נשמר במסד הנתונים (onMark / setMark ב-ipc.js), בקובץ נוסף מחוץ למסד (markStorage) ובכל גיבוי (importMark
  // בשחזור) — מחיקת license.json ו-license-key.bin לא נותנת ניסיון חדש, גם לא אחרי מחיקת המסד או שחזור גיבוי
  // להתקנה נקייה. תחילת הניסיון — רק אחורה; "הותקן רישיון" — לא מתבטל
  // ערך מבחוץ: תאריך עתידי — מתעלמים (הזמן נספר ממנו, וערך כמו 2100 היה נותן ניסיון קבוע). רק בקליטה: מה שכבר
  // נקלט לא נמחק אחר כך בגלל שעון שהוחזר אחורה
  function cleanMark(m) {
    const o = m && typeof m === 'object' ? m : {};
    const t = Number(o.trialStart);
    return { ...(Number.isSafeInteger(t) && t > 0 && t <= clock() ? { trialStart: t } : {}), ...(o.hadLicense === true ? { hadLicense: true } : {}) };
  }
  function mergeMark(a, b) {
    const starts = [a.trialStart, b.trialStart].filter(x => Number.isSafeInteger(x) && x > 0);
    return { ...(starts.length ? { trialStart: Math.min(...starts) } : {}), ...(a.hadLicense === true || b.hadLicense === true ? { hadLicense: true } : {}) };
  }
  const sameMark = (a, b) => a.trialStart === b.trialStart && !!a.hadLicense === !!b.hadLicense;
  function readMarkFile() {
    if (!markStorage) return {};
    try { const raw = markStorage.read(); return raw ? cleanMark(JSON.parse(raw)) : {}; } catch { return {}; }
  }
  let fileMark = readMarkFile();
  let mark = { ...fileMark };
  // db=false — המסד כבר מכיל את הסימון (בעלייה); הקובץ נכתב רק כשחסר בו משהו
  function persistMark({ db = true } = {}) {
    if (markStorage && !sameMark(fileMark, mark)) {
      try { markStorage.write(JSON.stringify(mark)); fileMark = { ...mark }; } catch { /* לא קריטי — ינוסה בשינוי הבא */ }
    }
    if (db && typeof onMark === 'function') { try { onMark({ ...mark }); } catch { /* לא קריטי — ינוסה בשינוי הבא */ } }
  }
  function noteMark(m) {
    const next = mergeMark(mark, cleanMark(m));
    if (sameMark(next, mark)) return;
    mark = next;
    cached = null;
    persistMark();
  }
  // מהמסד בעלייה: איחוד עם מה שכבר ידוע כאן, וכתיבה חזרה כשבמסד (או בקובץ) חסר משהו
  function setMark(m) {
    const stored = cleanMark(m);
    mark = mergeMark(mark, stored);
    cached = null;
    persistMark({ db: !sameMark(mark, stored) });
  }

  // ניסיון: מתחיל בפעם הראשונה שהמצב מחושב בלי רישיון, ונשמר בשומר המוצפן ובקובץ.
  // הזמן נספר מול הזמן המאוחר ביותר שנצפה — החזרת שעון לא מאריכה. בלי הצפנת Windows: רק בקובץ
  function trialState(d) {
    const now = clock();
    let sec = null;
    // קובץ המפתח קיים ולא נקרא — נעול, ולא תקופת ניסיון חדשה: אחרת השחתת הקובץ ומחיקת קובץ הרישוי
    // החזירו כל התקנה לניסיון של 30 יום, שוב ושוב (בדיקת קוד 23.10.2026)
    try { sec = readSecret(); } catch { return lockedState('לא ניתן לקרוא את מפתח המערכת (הצפנת המערכת אינה זמינה או שהקובץ פגום) — יש לפנות לספק הרישיון'); }
    if (sec && sec.guard && sec.guard.hadLicense) { noteMark({ hadLicense: true }); return lockedState('קובץ הרישוי חסר — יש להתקין שוב את קובץ הרישיון מהספק'); }
    if (mark.hadLicense) return lockedState('קובץ הרישוי חסר — יש להתקין שוב את קובץ הרישיון מהספק');
    if (!sec) { try { nodeKey(true); sec = readSecret(); } catch { sec = null; } }
    // תאריך עתידי (עריכה ידנית) — לא נחשב: הניסיון נספר ממנו, וערך רחוק היה נותן ניסיון קבוע
    const fromFile = d && Number.isSafeInteger(d.trialStart) && d.trialStart > 0 && d.trialStart <= now ? d.trialStart : 0;
    const fromGuard = sec && sec.guard && sec.guard.trialStart && sec.guard.trialStart <= now ? sec.guard.trialStart : 0;
    const known = [fromFile, fromGuard, mark.trialStart || 0].filter(Boolean);
    const start = known.length ? Math.min(...known) : now;
    noteMark({ trialStart: start });
    const seen = Math.max(now, start, d && Number.isSafeInteger(d.lastSeen) ? d.lastSeen : 0, sec && sec.guard ? sec.guard.lastSeen : 0);
    // רישום (פעם ראשונה, או השלמה של מקום חסר)
    const base = d || blank();
    if (base.trialStart !== start || (base.lastSeen || 0) + LASTSEEN_WRITE_MS < seen) {
      try { storage.write(JSON.stringify({ ...base, trialStart: start, lastSeen: Math.max(base.lastSeen || 0, seen) })); } catch { /* לא קריטי */ }
    }
    if (sec && (fromGuard !== start || (sec.guard ? sec.guard.lastSeen : 0) + LASTSEEN_WRITE_MS < seen)) {
      const g = sec.guard || { lastSeen: 0, notices: [] };
      try { writeSecret(sec.key, { ...g, trialStart: start, lastSeen: Math.max(g.lastSeen || 0, seen) }); } catch { /* לא קריטי */ }
    }
    const endsAt = start + TRIAL_MS;
    const daysLeft = Math.max(0, Math.ceil((endsAt - seen) / (24 * 60 * 60 * 1000)));
    const trial = { startedAt: start, endsAt, daysLeft, warn: daysLeft <= TRIAL_WARN_DAYS, guarded: !!sec };
    if (seen < endsAt) return { mode: 'licensed', status: 'active', trial, features: [...ALL_FEATURES], limits: {}, reasons: [] };
    return { mode: 'licensed', status: 'trial_ended', trial, features: [...ALL_FEATURES], limits: {},
      reasons: [{ kind: 'trial_ended', reason: `תקופת הניסיון (${TRIAL_DAYS} יום) הסתיימה` }] };
  }

  function compute() {
    if (!rootKeys.length) return { mode: 'unlicensed' };
    let d = load();
    // שגיאת קריאה רגעית — נעול רק עד הקריאה הבאה (לא נשמר במטמון)
    if (d && d.readError) return { ...lockedState(READ_ERROR), transient: true };
    if (d && d.corrupt) {
      // קובץ פגום מועבר הצידה (לא נמחק), וממשיכים כאילו הוא חסר: תחילת הניסיון, "הותקן רישיון" ומזהי ההודעות
      // שמורים בשומר ובסימון — הניסיון ממשיך מהתאריך המקורי, ואחרי רישיון — נעול עד התקנה מחדש (ממצא 35).
      // בלי אפשרות להעביר הצידה — נעול, כמו קודם (הקובץ לא נדרס)
      if (!tryAside()) return lockedState('קובץ הרישוי פגום');
      d = null;
    }
    if (!d || !Array.isArray(d.chain)) return trialState(d);
    // רישיון מותקן תמיד יחד עם מפתח הצומת שלו (install בודק). בלי המפתח — הקובץ הועתק או שהשומר נמחק
    let sec;
    try { sec = readSecret(); } catch { return lockedState('לא ניתן לקרוא את מפתח המערכת (הצפנת המערכת אינה זמינה או שהקובץ פגום)'); }
    const leaf = d.chain[d.chain.length - 1];
    if (!sec || !leaf || !leaf.payload || L.keyId(sec.key) !== leaf.payload.id) return lockedState('מפתח המערכת חסר או אינו תואם לרישיון — יש לפנות לספק הרישיון');
    noteMark({ hadLicense: true });
    if (!sec.guard) { // התקנה מגרסה קודמת: השומר נבנה פעם אחת מהמצב הנוכחי
      sec.guard = guardFrom(d, null);
      try { sec.guard = writeSecret(sec.key, sec.guard); } catch { /* ינוסה שוב בפעם הבאה */ }
    } else if (!sec.guard.hadLicense) { // שומר מלפני 4.2: סימון שהותקן רישיון (מחיקת הקובץ לא תחזיר לניסיון)
      sec.guard = { ...sec.guard, hadLicense: true };
      try { sec.guard = writeSecret(sec.key, sec.guard); } catch { /* ינוסה שוב בפעם הבאה */ }
    }
    const have = new Map((d.notices || []).filter(n => n && n.payload).map(n => [n.payload.id, n]));
    const missing = sec.guard.notices.filter(id => !have.has(id)).length;
    if (missing) return lockedState(`קובץ הרישוי שונה מחוץ לתוכנה: חסרות ${missing} הודעות סטטוס. יש לייבא שוב את קובץ ההודעות מהספק (או לסנכרן)`);
    // הודעה ששונתה: החתימה נפסלת וההודעה נזרקת בשקט — כך "נעלמה" השעיה. מול הטביעה בשומר — נעול
    const altered = sec.guard.notices.filter(id => sec.guard.hashes[id] && noticeHash(have.get(id)) !== sec.guard.hashes[id]).length;
    if (altered) return lockedState(`קובץ הרישוי שונה מחוץ לתוכנה: ${altered} הודעות סטטוס שונו. יש לייבא שוב את קובץ ההודעות מהספק (או לסנכרן)`);
    // שומר מגרסה קודמת, בלי טביעות — נרשמות עכשיו
    if (sec.guard.notices.some(id => !sec.guard.hashes[id])) {
      sec.guard = guardFrom(d, sec.guard);
      try { sec.guard = writeSecret(sec.key, sec.guard); } catch { /* ינוסה שוב בפעם הבאה */ }
    }
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
    const r = cached;
    if (r.transient) cached = null;
    return r;
  }

  // הודעות: איחוד לפי מזהה, אף פעם לא מחיקה (כך שאי אפשר "לשכוח" השבתה). נקלטות רק הודעות חתומות
  // שנוגעות למערכת (noticeSigned, ממצא 5). תקרה לכל מנפיק חוץ מהשורש: הצפה של מנפיק אחד לא חוסמת השעיה
  // של מנהל-העל או של ההורה. ctx — noticeContext של השרשרת ומערכות הבת
  function mergeNotices(existing, incoming, ctx) {
    const list = (existing || []).filter(n => n && n.payload && typeof n.payload.id === 'string');
    const byId = new Map(list.map(n => [n.payload.id, n]));
    const counts = new Map();
    for (const n of list) counts.set(n.payload.issuer, (counts.get(n.payload.issuer) || 0) + 1);
    const recounted = new Set();
    const issuerFull = (issuer) => {
      if (issuer === S.ROOT || (counts.get(issuer) || 0) < MAX_NOTICES) return false;
      // ספירה מחדש של הקיימות החתומות בלבד — זבל שנכתב לקובץ ידנית לא "תופס" את המכסה של מנפיק
      if (!recounted.has(issuer)) {
        recounted.add(issuer);
        counts.set(issuer, [...byId.values()].filter(x => x.payload.issuer === issuer && noticeSigned(x, ctx)).length);
      }
      return counts.get(issuer) >= MAX_NOTICES;
    };
    let added = 0;
    let rejected = 0;
    let full = 0;
    for (const n of incoming || []) {
      if (!noticeShape(n)) { rejected++; continue; }
      const p = n.payload;
      const old = byId.get(p.id);
      // אותה הודעה בדיוק כבר קיימת (קורה בכל סנכרון) — בלי בדיקת חתימה חוזרת
      if (old && old.sig === n.sig && L.canonical(old.payload) === L.canonical(p)) continue;
      if (!noticeSigned(n, ctx)) { rejected++; continue; }
      if (old && noticeSigned(old, ctx)) continue;
      if (!old && issuerFull(p.issuer)) { full++; continue; }
      // חדשה, או במקום רשומה לא חתומה באותו מזהה
      byId.set(p.id, { payload: p, sig: n.sig });
      if (!old) counts.set(p.issuer, (counts.get(p.issuer) || 0) + 1);
      added++;
    }
    return { notices: [...byId.values()], added, rejected, full };
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
    // קובץ שלא נקרא לא נדרס (ממצא 35). קובץ פגום — מועבר הצידה (לא נמחק), ואז הרישיון מותקן מחדש
    if (d && d.readError) throw readError();
    if (d && d.corrupt) setAside();
    const base = d && !d.corrupt ? { ...blank(), ...d } : blank();
    // רישיון ישן מהמותקן נדחה: התקנה חוזרת של קובץ ישן החזירה תחומים שהוסרו בחידוש, ושרת הממסר (לא מהימן)
    // יכול היה לשלוח שוב רישיון ישן ולקצר רישיון שחודש (בדיקת קוד 23.10.2026)
    const cur = Array.isArray(base.chain) && base.chain.length ? base.chain[base.chain.length - 1].payload : null;
    if (cur && cur.id === leaf.id && Number(leaf.issuedAt) < Number(cur.issuedAt)) throw new Error('הרישיון בקובץ ישן מהרישיון המותקן — יש להתקין את הרישיון העדכני מהספק');
    const { notices } = mergeNotices(base.notices, pkg.notices, noticeContext(pkg.chain, base.children));
    save({ ...base, chain: pkg.chain, notices });
    return { nodeId: leaf.id, name: leaf.name, expiresAt: leaf.expiresAt };
  }
  // העברת קובץ הרישוי הפגום הצידה. אחסון בלי אפשרות כזו — לא דורסים
  function setAside() {
    if (!tryAside()) throw new Error('קובץ הרישוי פגום — יש לפנות לספק הרישיון');
  }
  function tryAside() {
    if (typeof storage.aside !== 'function') return false;
    try { storage.aside(); } catch { return false; }
    cached = null;
    return true;
  }

  function importNotices(text) {
    const pkg = parsePackage(text, PKG_NOTICES);
    const d = load();
    if (d && d.readError) throw readError();
    if (!d || d.corrupt) throw new Error('לא הותקן רישיון למערכת');
    const { notices, added, rejected } = mergeNotices(d.notices || [], pkg.notices, noticeContext(d.chain, d.children));
    if (added) save({ ...d, notices });
    return { added, rejected };
  }

  // ---------- הנפקת מערכות בת ----------
  function issuerContext() {
    const st = current();
    // קובץ תפוס — שגיאה רגעית עם קוד: אישור ששולם עליו לא יאושר לשרת ולא יאבד (sync.js, receive)
    if (st.transient) throw readError();
    if (st.mode !== 'licensed') throw new Error('ההתקנה הזו אינה מוגדרת לרישוי');
    if (st.status !== 'active') throw new Error('לא ניתן להנפיק מערכות כשהמערכת אינה פעילה');
    if (st.trial) throw new Error('לא ניתן להנפיק מערכות בתקופת ניסיון — יש להתקין רישיון');
    const d = load();
    if (d && d.readError) throw readError();
    if (!d || d.corrupt || !Array.isArray(d.chain)) throw new Error('לא הותקן רישיון למערכת');
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
    const termMs = ACT.termMs(input.months == null ? 12 : input.months);
    const child = {
      publicKey: req.publicKey, name: String(input.name || req.name || '').trim().slice(0, 80),
      features: input.features, limits: input.limits,
      expiresAt: Math.min(now + termMs, own.payload.expiresAt),
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
    const { notices, added, full } = mergeNotices(d.notices || [], [n], noticeContext(d.chain, d.children));
    if (full) throw new Error('יותר מדי הודעות סטטוס שהמערכת הזו הוציאה — יש לפנות לספק הרישיון');
    if (!added) throw new Error('לא ניתן לרשום את הודעת הסטטוס');
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
    // קובץ תפוס — שגיאה רגעית, לא "אין אנשי קשר": אחרת הודעה שהגיעה נדחתה ("איש הקשר אינו מוכר") ואושרה לשרת
    if (d && d.readError) throw readError();
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
  function getRemoteSettings() {
    const d = load();
    // קובץ שלא נקרא — שגיאה, לא {}: הקוראים כותבים חזרה (למשל רשימת הבקשות הממתינות), ורשימה ריקה הייתה
    // מוחקת את מה שבקובץ ברגע שהקריאה חזרה לעבוד (ממצא 35)
    if (d && d.readError) throw readError();
    const r = (d && !d.corrupt && d.remote) || {};
    return r.url === undefined && defaultUrl ? { ...r, url: defaultUrl } : r;
  }
  function setRemoteSettings(r) {
    const d = load();
    // קובץ שלא נקרא לא נדרס בגרסה ריקה (ממצא 35): שרשרת הרישיון ורשימת מערכות הבת היו אובדות.
    // קובץ פגום — מועבר הצידה (לא נמחק), כמו ב-compute; בלי אפשרות כזו — לא דורסים
    if (d && d.readError) throw readError();
    if (d && d.corrupt && !tryAside()) throw new Error('קובץ הרישוי פגום — ההגדרות לא נשמרו, כדי לא לדרוס אותו. יש להתקין שוב את קובץ הרישיון מהספק');
    const base = d && !d.corrupt ? { ...blank(), ...d } : blank();
    const { checkin, ...rest } = r || {};
    const remote = { ...(base.remote || {}), ...rest };
    // התשובה החתומה של השרת (sync.js, אחרי אימות) — נשמרת רק כשהיא תקינה למערכת הזו וחדשה מהשמורה
    if (checkin !== undefined) {
      const fresh = proofOf(checkin);
      const cur = proofOf(remote.checkin);
      if (fresh && (!cur || fresh.at > cur.at)) remote.checkin = checkin;
    }
    save({ ...base, remote }, { lastSync: r && r.lastSync });
  }
  // אימות מחדש של תשובה חתומה שמורה (CK.storedCheckinTime) — לתיבה של המערכת הזו. התוצאה במטמון לפי החתימות
  // (בדיקה זהה נותנת תוצאה זהה; "לא אחרי עכשיו" — נבדק מול השעון בכל קריאה)
  let proofMemo = { key: null, value: null };
  function proofOf(att, box = null) {
    if (!rootKeys.length || !att || typeof att !== 'object' || !att.checkin) return null;
    if (!box) {
      try { const key = nodeKey(false); if (!key) return null; box = L.keyId(key); } catch { return null; }
    }
    let memoKey;
    try { memoKey = box + '\n' + JSON.stringify(att); } catch { return null; }
    // השעון נבדק כאן ולא במטמון: חתימה "מהעתיד" (שעון שהוחזר אחורה) לא נחשבת עד שהזמן מגיע אליה
    let v = proofMemo.key === memoKey ? proofMemo.value : CK.storedCheckinTime(att, { rootKeys, box, now: Infinity });
    proofMemo = { key: memoKey, value: v };
    if (v && v.at > clock() + CK.CHECKIN_SKEW_MS) v = null;
    return v;
  }
  // הבדיקה החתומה האחרונה שנשמרה: { at, certExpiresAt } או null (למסך הרישוי — תפוגת התעודה של השרת)
  function syncProof(box = null) {
    const d = load();
    if (!d || d.corrupt || d.readError || !d.remote) return null;
    const v = proofOf(d.remote.checkin, box);
    return v ? { at: v.at, certExpiresAt: v.certExpiresAt } : null;
  }
  // זמן הסנכרון האחרון לתנאי ההפעלה. בקובץ הגלוי כל אחד יכול היה לכתוב "היום" פעם בחודש ולהישאר מנותק לתמיד
  // (בדיקת קוד 23.10.2026, ממצאים 27-28). עם רישוי (מפתח שורש): הזמן שבתשובה החתומה האחרונה של השרת, אחרי אימות
  // מחדש (proofOf) — ומהשומר המוצפן רק זמן שאינו מאוחר מ-LEGACY_SYNC_CUTOFF (העברה מגרסה קודמת; סקירת אבטחה
  // 24.10.2026, ממצא 1: שחזור עותק ישן של קובץ המפתח העביר אליו כל זמן שנכתב בקובץ הגלוי). בלי רישוי — כמו קודם.
  // הקובץ הגלוי נקרא רק בשומר מגרסה קודמת (בלי syncV): הערך מועבר לשומר פעם אחת, והסימון נכתב גם כשאין מה להעביר
  function lastSyncTime() {
    let sec = null;
    try { sec = readSecret(); } catch { return 0; }
    if (!sec) return 0;
    let guardAt;
    if (sec.guard && sec.guard.syncV === GUARD_SYNC_V) guardAt = sec.guard.lastSync || 0;
    else {
      let guard = sec.guard;
      if (!guard) { const d = load(); guard = guardFrom(d && !d.corrupt && !d.readError ? d : blank(), null); }
      try { guardAt = writeSecret(sec.key, guard).lastSync || 0; } catch { guardAt = 0; }
    }
    if (!rootKeys.length) return guardAt;
    let signed = null;
    try { signed = syncProof(L.keyId(sec.key)); } catch { signed = null; }
    return Math.max(Math.min(guardAt, LEGACY_SYNC_CUTOFF), signed ? signed.at : 0);
  }

  // תנאי ההפעלה (activation.js): הרישיון של המערכת, וזמן הכניסה האחרונה עם Google
  function leafPayload() {
    const d = load();
    return d && Array.isArray(d.chain) && d.chain.length ? d.chain[d.chain.length - 1].payload : null;
  }
  // הזמן נשמר רק קדימה — אי אפשר לחדש כניסה ישנה בהחזרת שעון
  function markGoogleSignIn(at = clock()) {
    try {
      const r = getRemoteSettings();
      if (!(Number(r.lastGoogle) >= at)) setRemoteSettings({ lastGoogle: at });
    } catch (e) {
      // קובץ תפוס — מדלגים (Google אינו תנאי הפעלה; הכניסה הבאה תרשום)
      if (!(e && e.code === READ_ERROR_CODE)) throw e;
    }
  }
  // סימון מגיבוי ששוחזר — רק מחמיר: תחילת ניסיון מוקדמת יותר, "הותקן רישיון". גיבוי ישן לא מאריך דבר
  const importMark = (m) => noteMark(m);

  return { current, invalidate() { cached = null; }, leafPayload, lastSyncTime, syncProof: () => syncProof(), markGoogleSignIn, request, install, importNotices, requestChildApproval, issueChild, noticeForChild, listChildren,
    syncKey, syncInfo, noticesForChild, getRemoteSettings, setRemoteSettings, setMark, importMark, mark: () => ({ ...mark }) };
}

// חותמת זמן מקומית לשם קובץ (לא UTC — CLAUDE.md, "תאריכים ושעות למשתמש")
function localStamp(t = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`;
}

// כתיבה אטומית: קובץ זמני, fsync (כשקיים — לא בתחליף של אנדרואיד) והחלפה. כתיבה ישירה שנקטעה
// (הפסקת חשמל) השאירה את העותק היחיד של מפתח המערכת חתוך — והמערכת ננעלה לצמיתות (בדיקת קוד 23.10.2026)
function durableWrite(fs, file, body) {
  const tmp = file + '.tmp';
  if (typeof fs.openSync === 'function' && typeof fs.fsyncSync === 'function') {
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, body); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } else {
    fs.writeFileSync(tmp, body);
  }
  fs.renameSync(tmp, file);
}

// אחסון בקבצים (שולחן העבודה). fs מוזרק כדי לא לתלות את הקוד באנדרואיד
function fileStorage(fs, file) {
  return {
    read() { try { return fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    write(text) { durableWrite(fs, file, text); },
    // קובץ פגום — מועבר הצידה ולא נמחק (כמו ב-shell/sync/service.js)
    aside() { const to = `${file}.unreadable-${localStamp()}`; fs.renameSync(file, to); return to; },
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
      durableWrite(fs, file, safeStorage.encryptString(text));
    },
  };
}

// אנדרואיד: localStorage של חלון המעטפת — אחסון פרטי של האפליקציה, לא נגיש לאפליקציות אחרות
function webStorage(ls, key) {
  return { read: () => ls.getItem(key), write: (text) => ls.setItem(key, text),
    aside() { const to = `${key}.unreadable-${localStamp()}`; ls.setItem(to, ls.getItem(key) || ''); ls.removeItem(key); return to; } };
}

module.exports = { TRIAL_DAYS, READ_ERROR_CODE, LEGACY_SYNC_CUTOFF, createLicenseStore, fileStorage, encryptedFileSecret, webStorage, CACHE_MS, PKG_LICENSE, PKG_REQUEST, PKG_NOTICES, PKG_APPROVAL_REQUEST, PKG_APPROVAL };
