// סנכרון רישוי מרחוק דרך שרת הממסר — החלק שקובע מה נשלח למי ומה עושים עם מה שמגיע.
// שתי תיבות: של המערכת (לפי מזהה המפתח שלה), ושל מנהל-העל (לפי מזהה מפתח השורש) כשמצב מנהל-העל פתוח.
// מה שמגיע נקלט רק אחרי אימות החתימות המקומי (install / importNotices / issueChild) — השרת אינו מהימן.
const L = require('./license');
const { createRemote, mailboxOf, randomNonce } = require('./remote');
const CK = require('./checkin');
const M = require('./messages');
const OF = require('./offer');
const PR = require('./products');
const SU = require('./signup');
const PK = require('./prekeys');
const { PKG_REQUEST, PKG_APPROVAL_REQUEST, READ_ERROR_CODE, ACTIVATION_REQUIRED, PARENT_CHANGE_CODE } = require('./store');

// תקלה רגעית בקריאה (תיבת ההודעות או קובץ הרישוי תפוסים) — ההודעה לא מאושרת לשרת ותתקבל שוב בסנכרון הבא.
// אישור הנפקה שנחסם בתנאי ההפעלה (ACTIVATION_REQUIRED) — נשאר בשרת עד שהמערכת פעילה (אושר ושולם עליו)
// prekeys-unavailable — קובץ המפתחות הזמניים לא נקרא; ההודעה תפוענח בסנכרון הבא (סקירה 2.11.2026, f84)
const keepOnServer = (e) => !!(e && (e.code === 'chat-unavailable' || e.code === READ_ERROR_CODE || e.code === ACTIVATION_REQUIRED || e.code === 'prekeys-unavailable'));

// בקשת רישיון ממערכת בת חדשה: נשמרים רק השדות הדרושים, בגוף שנבנה מחדש — לא הגוף כמו שהגיע. גופים ענקיים
// ממאות בקשות ניפחו את קובץ הרישוי, שנקרא בכל ערוץ מוגן (בדיקת קוד 23.10.2026, ממצא 30)
const MAX_REQUEST_BODY = 4096;
function compactRequest(body) {
  if (typeof body !== 'string' || body.length > MAX_REQUEST_BODY) throw new Error('בקשה לא תקינה');
  let req;
  try { req = JSON.parse(body); } catch { throw new Error('בקשה לא תקינה'); }
  if (!req || req.type !== PKG_REQUEST) throw new Error('בקשה לא תקינה');
  let keyId;
  try { keyId = L.keyId(req.publicKey); } catch { throw new Error('בקשה לא תקינה'); }
  if (req.keyId !== keyId) throw new Error('בקשה לא תקינה');
  const name = String(req.name == null ? '' : req.name).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
  const product = PR.isProduct(req.product) ? req.product : undefined;
  return { keyId, name, body: JSON.stringify({ type: PKG_REQUEST, v: 1, name, publicKey: L.publicOf(req.publicKey), keyId, product }) };
}
// רשומה ברשימת הבקשות הממתינות (גם רשומה ישנה שנשמרה עם הגוף המקורי) — או null כשאינה תקינה
function pendingEntry(p, fallbackAt) {
  try {
    const c = compactRequest(p && p.body);
    return { keyId: c.keyId, name: c.name, at: Number.isSafeInteger(p.at) ? p.at : fallbackAt, body: c.body };
  } catch { return null; }
}

// עדכוני סטטוס למערכות הבת (סקירת אבטחה 24.10.2026, ממצא 2): נשלחים רק כשהחבילה השתנתה. למערכת פעילה — גם פעם
// ב-30 יום (הודעה שלא נקראה 60 יום נמחקת בשרת); אחרי מסירה שלא אושרה בחתימה — ניסיון חוזר אחרי שעה. בכל סנכרון
// עד MAX_CHILD_PUSH מערכות (כל אחת בבקשה משלה) — השאר בסנכרון הבא, בלי לעבור את מכסת הבקשות בשרת
const CHILD_RESEND_MS = 30 * 24 * 60 * 60 * 1000;
const CHILD_RETRY_MS = 60 * 60 * 1000;
const MAX_CHILD_PUSH = 20;
// מנהל-העל: עדכוני סטטוס בחלקים של עד 50 נמענים לבקשה (התקרה של השרת)
const PUSH_BATCH = 50;

// אישור חיבור בקובץ (offlineRequest / offlineRelay / offlineImport)
const OFFLINE_REQ = 'supersuite-offline-checkin-request';
const OFFLINE_RES = 'supersuite-offline-checkin-response';
const OFFLINE_OP = 'offlineFetch';
const OFFLINE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

// isRestTime(): בשבת וביום טוב (מצב שבת) — אין תשובות אוטומטיות
// allowLocalRelay — מצב בדיקה מפורש בלבד: תעודת שרת לכתובת מקומית (checkin.js, assertCertOrigin). התוכנה לא מעבירה אותו
function createLicenseSync({ store, owner, rootKeys, fetchImpl, clock, chat, ownerChat, updates, prekeys, ownerPrekeys, isRestTime = () => false, allowLocalRelay = false }) {
  const now = () => (clock ? clock() : Date.now());
  const remote = () => {
    const r = store.getRemoteSettings();
    if (!r.url) throw new Error('לא הוגדר שרת רישוי');
    return createRemote({ url: r.url, fetchImpl, clock });
  };
  // מנהל-העל: התיבה לפי מפתח השורש שמוגדר בתוכנה (הראשון), או המפתח של מנהל-העל במחשב הזה
  const ownerBox = () => {
    if (rootKeys && rootKeys.length) return mailboxOf(rootKeys[0]);
    if (owner && owner.isInitialized()) return mailboxOf(owner.pubkey());
    throw new Error('לא ידוע למי לשלוח: מפתח מנהל-העל אינו מוגדר בתוכנה');
  };
  // מי שרשאי לשלוח "דחייה" (ממצא 7): מנהל-העל — לפי מפתחות השורש שבתוכנה, ובלעדיהם המפתח של מנהל-העל במחשב הזה
  const ownerIds = () => {
    const ids = new Set();
    for (const k of rootKeys || []) { try { ids.add(mailboxOf(k)); } catch { /* מפתח פגום — מדולג */ } }
    if (!ids.size) { try { if (owner && owner.isInitialized()) ids.add(mailboxOf(owner.pubkey())); } catch { /* */ } }
    return ids;
  };

  // שליחה עם אישור מסירה חתום (checkin.js, ממצא 5). לכל הודעה: { ok, verified, error }. ok — השרת קיבל את הבקשה ולא
  // דיווח על כישלון בהודעה; verified — השרת אישר בחתימה שההודעה נשמרה בדיוק כך. בלי מפתח שורש — אין מה לאמת (כמו ok).
  // לא זורק: כישלון של שליחה אחת לא עוצר את האחרות ולא את האישור לשרת (ack) בסנכרון
  async function deliver(rm, signer, items) {
    const challenge = randomNonce();
    let r;
    try { r = await rm.send(signer, items, { receipt: challenge }); } catch (e) {
      return items.map(() => ({ ok: false, verified: false, error: e.message }));
    }
    const failed = new Map((Array.isArray(r.failed) ? r.failed : []).filter(f => f && typeof f.to === 'string')
      .map(f => [f.to, typeof f.error === 'string' && /[֐-׿]/.test(f.error) ? f.error.slice(0, 200) : 'השרת לא שמר את ההודעה']));
    const fail = (it, error) => ({ ok: !failed.has(it.to), verified: false, error: failed.get(it.to) || error });
    if (!rootKeys || !rootKeys.length) return items.map(it => (failed.has(it.to) ? fail(it) : { ok: true, verified: true, error: null }));
    let marks;
    try {
      marks = CK.verifySendReceipt(r, { rootKeys, box: mailboxOf(L.publicOf(signer)), challenge, origin: rm.origin, sent: items, now: now(), allowLocal: allowLocalRelay });
    } catch (e) { return items.map(it => fail(it, e.message)); }
    return items.map((it, i) => (marks[i] ? { ok: true, verified: true, error: null } : fail(it, 'השרת לא אישר בחתימה שההודעה נשמרה')));
  }

  // ---------- שליחה ממערכת ----------
  async function sendLicenseRequest(name) {
    const req = store.request(name);
    const key = store.syncKey(false);
    await remote().send(key, [{ to: ownerBox(), kind: 'license-request', body: JSON.stringify(req) }]);
    return { sent: true, keyId: req.keyId };
  }

  async function sendApprovalRequest(input) {
    if (typeof store.assertCanIssue === 'function') store.assertCanIssue(); // תנאי ההפעלה (סקירה 5.11.2026)
    const r = store.requestChildApproval(input);
    await remote().send(store.syncKey(false), [{ to: ownerBox(), kind: 'approval-request', body: r.package }]);
    return { sent: true, childId: r.childId };
  }

  // מערכת בת חדשה מבקשת רישיון מההורה (לא ממנהל-העל): ההורה ישלח בשמה בקשת אישור
  async function sendRequestToParent(name, parentId) {
    if (!/^[A-Za-z0-9_-]{22}$/.test(String(parentId || ''))) throw new Error('קוד המערכת המנפיקה אינו תקין');
    const req = store.request(name);
    await remote().send(store.syncKey(false), [{ to: parentId, kind: 'license-request', body: JSON.stringify(req) }]);
    return { sent: true, keyId: req.keyId };
  }

  // ---------- קבלה במערכת ----------
  // מטפל בכל מה שהגיע לתיבה של המערכת. בקשות רישיון ממערכות בת חדשות נשמרות לטיפול בכפתור
  async function receive() {
    const key = store.syncKey(false);
    if (!key) return { handled: 0, pending: [], errors: [] };
    const rm = remote();
    try { await publishPrekey(key, prekeys); } catch { /* ינוסה שוב בסנכרון הבא */ }
    // בדיקה חתומה (checkin.js, ממצא 27): אתגר אקראי, והשרת חותם עליו במפתח שמנהל-העל אישר
    const challenge = randomNonce();
    const { messages: msgs, attestation } = await rm.fetchMail(key, { challenge });
    const checkin = verifyCheckin(key, challenge, attestation, msgs, rm.origin);
    // החיבור המאומת נרשם לפני הטיפול בהודעות: אישור הנפקה שהגיע עכשיו נבדק מול תנאי ההפעלה (issuerContext) — ומערכת
    // שחזרה לחיבור אחרי 30 יום מנפיקה כבר בסנכרון הזה
    if (checkin.ok) store.setRemoteSettings({ lastSync: now(), checkinError: null, ...(checkin.att ? { checkin: checkin.att, certExpiresAt: checkin.certExpiresAt } : {}) });
    const done = [];
    const errors = [];
    const forward = [];
    let pending = (store.getRemoteSettings().pendingChildRequests || []).map(p => pendingEntry(p, now())).filter(Boolean);
    const autos = [];
    const owners = ownerIds();
    // רישיון ממערכת מנפיקה אחרת (ממצא f85) — לא מותקן בלי אישור המנהל, אבל גם לא אובד: נשמר מקומית וממתין
    // לאישור במסך הרישוי (license:install עם pending), וההודעה נמחקת מהשרת
    let heldLicense = null;
    for (const m of msgs) {
      try {
        if (m.kind === 'license') {
          try { store.install(m.body); } catch (e) {
            if (!e || e.code !== PARENT_CHANGE_CODE) throw e;
            heldLicense = { body: m.body, at: Number(m.at) || now(), name: String(e.name || '').slice(0, 200), expiresAt: Number(e.expiresAt) || null };
            errors.push('התקבל רישיון ממערכת מנפיקה אחרת — ממתין לאישור במסך הרישוי');
          }
        }
        else if (m.kind === 'notices') store.importNotices(m.body);
        else if (m.kind === 'approval') {
          // אישור ממנהל-העל: הנפקה אוטומטית, והרישיון נשלח ישר למערכת הבת. רק ממנהל-העל (ממצא f12) — משולח אחר
          // (שידור חוזר של אישור ישן שהועתק מרישיון) נמחק בלי הנפקה
          if (!owners.has(m.from)) { done.push(m.id); continue; }
          // תנאי ההפעלה (סקירה 5.11.2026) — מערכת בצפייה בלבד או נעולה לא מנפיקה; האישור נשאר בשרת (keepOnServer)
          if (typeof store.assertCanIssue === 'function') store.assertCanIssue();
          const r = store.issueChild({ approval: m.body });
          forward.push({ msgId: m.id, name: r.child.name, item: { to: r.child.id, kind: 'license', body: r.package } });
        } else if (m.kind === 'rejection') {
          // דחייה — רק ממנהל-העל (סקירת אבטחה 24.10.2026, ממצא 7). משולח אחר — נמחקת, והטקסט שלה לא מוצג למנהל
          if (owners.has(m.from)) {
            const j = JSON.parse(m.body);
            errors.push('הבקשה למערכת הבת "' + String(j.name || '').slice(0, 80) + '" נדחתה: ' + String(j.reason || '').slice(0, 500));
          }
        } else if (m.kind === 'update') {
          // תעודת גרסה — נבדקת בחתימה מול מפתח השורש; מה שאינו תקין נדחה
          if (updates) updates.offer(m.body);
        } else if (m.kind === 'message') {
          if (chat) receiveMessage(store.syncKey(false), m.body, myContacts(), chat, prekeys, autos, m.at);
        } else if (m.kind === 'license-request') {
          const req = pendingEntry({ body: m.body, at: m.at }, now());
          if (!req) throw new Error('בקשה לא תקינה');
          if (!pending.some(p => p.keyId === req.keyId)) pending = [...pending, req];
        }
        done.push(m.id);
      } catch (e) {
        errors.push(e.message);
        // הודעה פגומה לא תחסום את התיבה לנצח. תיבת ההודעות או קובץ הרישוי לא נקראו (קובץ תפוס) — ההודעה נשארת
        // בשרת לסנכרון הבא: השעיה, חידוש רישיון או אישור ששולם עליו לא נמחקים מהשרת בגלל תקלה רגעית (ממצא 35)
        if (!keepOnServer(e)) done.push(m.id);
      }
    }
    // "החיבור האחרון לשרת" (תנאי ההפעלה) — רק אחרי תשובה חתומה שאומתה. שרת שאינו של הספק לא מאריך. התשובה החתומה
    // עצמה נשמרת (checkin) — ממנה מחושב הזמן לתנאי ההפעלה (store.lastSyncTime, ממצא 1), ותפוגת התעודה למסך הרישוי
    store.setRemoteSettings({ pendingChildRequests: pending.slice(-100), ...(heldLicense ? { pendingLicense: heldLicense } : {}),
      ...(checkin.ok ? {} : { checkinError: checkin.error }) });
    // רישיונות שהונפקו לפי אישור — כל אחד בבקשה משלו: תיבה מלאה של נמען אחד לא חוסמת את האחרים ולא את האישור
    // לשרת (ממצא 2). מסירה שנכשלה — האישור נשאר בשרת, וההנפקה והשליחה ינוסו שוב בסנכרון הבא
    for (const f of forward) {
      const [r] = await deliver(rm, key, [f.item]);
      if (!r.ok) {
        errors.push('הרישיון למערכת הבת "' + f.name + '" לא נשלח: ' + r.error + ' — יישלח שוב בסנכרון הבא');
        const i = done.indexOf(f.msgId);
        if (i >= 0) done.splice(i, 1);
      } else if (!r.verified) errors.push('הרישיון למערכת הבת "' + f.name + '" נשלח, אבל השרת לא אישר בחתימה שנשמר: ' + r.error);
    }
    // עדכוני סטטוס למערכות הבת — כך השבתה מלמעלה מגיעה עד הסוף. רק כשהחבילה השתנתה (ממצא 2)
    try { await forwardChildNotices(rm, key, errors); } catch (e) { errors.push(e.message); }
    await rm.ack(key, ackList(msgs, savedBeforeAck(chat, msgs, done)));
    if (chat) await sendAutoReplies(key, myContacts(), chat, prekeys, autos);
    store.invalidate();
    return { handled: done.length, pending: pending.map(({ keyId, name, at }) => ({ keyId, name, at })), errors,
      checkin: { ok: checkin.ok, error: checkin.error || null, certExpiresAt: checkin.certExpiresAt || null } };
  }

  // עדכוני סטטוס למערכות הבת (ממצא 2): פעם, הורה שלח בכל סנכרון (כל 3 דקות) חבילה חדשה לכל מערכת בת — גם לכאלה
  // שבוטלו. אחרי כ-100 שלא נקראו השרת ענה 429, הסנכרון נעצר לפני האישור לשרת, וההודעות טופלו שוב ושוב.
  // עכשיו: רק כשהחבילה השתנתה (טביעה לכל מערכת בת בהגדרות הסנכרון), מערכת שהסתיימה מקבלת את הסיום פעם אחת,
  // וכל מערכת בבקשה משלה
  async function forwardChildNotices(rm, key, errors) {
    const children = store.listChildren();
    if (!children.length) return;
    const prev = store.getRemoteSettings().childNotices || {};
    const next = { ...prev };
    let changed = false;
    let pushed = 0;
    for (const c of children) {
      if (pushed >= MAX_CHILD_PUSH) break;
      const pkg = store.noticesForChild(c.id);
      if (!pkg) continue;
      const h = L.sha256Hex(pkg);
      const p = prev[c.id] && typeof prev[c.id] === 'object' ? prev[c.id] : null;
      const t = now();
      const age = p && Number.isSafeInteger(p.at) ? t - p.at : Infinity;
      const due = !p || p.h !== h || (!p.ok && age >= CHILD_RETRY_MS) || (c.status !== 'terminated' && age >= CHILD_RESEND_MS);
      if (!due) continue;
      pushed++;
      const [r] = await deliver(rm, key, [{ to: c.id, kind: 'notices', body: pkg }]);
      if (r.ok) { next[c.id] = { h, at: t, ok: r.verified }; changed = true; }
      if (!r.verified) errors.push('עדכון הסטטוס למערכת הבת "' + c.name + '": ' + r.error);
    }
    if (changed) store.setRemoteSettings({ childNotices: next });
  }
  function rememberChildPush(childId, pkg, verified) {
    try {
      const prev = store.getRemoteSettings().childNotices || {};
      store.setRemoteSettings({ childNotices: { ...prev, [childId]: { h: L.sha256Hex(pkg), at: now(), ok: !!verified } } });
    } catch { /* לא קריטי — בסנכרון הבא החבילה תישלח שוב */ }
  }

  // ---------- אישור בקובץ, למחשב בלי חיבור (סקירה 11.2026, f81) ----------
  // 1. המחשב שאין בו חיבור שומר "בקשת אישור" — בקשה למשיכת התיבה שלו, חתומה במפתח שלו, עם אתגר אקראי חדש.
  // 2. מחשב מחובר (כל התקנה שמוגדר בה אותו שרת) שולח אותה כמו שהיא לשרת, ושומר את התשובה החתומה לקובץ.
  //    הוא לא יכול לשנות אותה: היא חתומה במפתח השרת, על האתגר ועל התיבה של המחשב הראשון.
  // 3. המחשב הראשון טוען את הקובץ: אימות מלא (תעודה, חתימה, אתגר, תיבה, כתובת, וכל הודעה חתומה הגיעה כמו שהיא),
  //    קליטת הרישיון / עדכוני הסטטוס שבתיבה, ושמירת התשובה החתומה — ממנה נספר "החיבור האחרון לשרת".
  // ההודעות לא נמחקות בשרת (אין אישור קבלה מכאן) — הן ייקלטו שוב בסנכרון הבא עם חיבור. הודעות שדורשות שליחה
  // הלאה (אישור למערכת בת, הודעות צ'אט) נשארות לסנכרון עם חיבור.
  function offlineRequest() {
    const key = store.syncKey(false);
    if (!key) throw new Error('במחשב הזה עדיין אין רישיון מותקן — אין צורך באישור חיבור');
    const rm = remote();
    const challenge = randomNonce();
    const pub = L.publicOf(key);
    const ts = now();
    const nonce = randomNonce();
    const payload = { checkin: challenge };
    const sig = L.signObject({ pub, ts, nonce, op: OFFLINE_OP, payload }, key);
    store.setRemoteSettings({ offlineCheckin: { challenge, at: ts, origin: rm.origin } });
    return JSON.stringify({ type: OFFLINE_REQ, v: 1, origin: rm.origin, request: { pub, ts, nonce, op: OFFLINE_OP, payload, sig } });
  }
  async function offlineRelay(text) {
    let j;
    try { j = JSON.parse(String(text || '')); } catch { j = null; }
    const q = j && j.request;
    if (!j || j.type !== OFFLINE_REQ || j.v !== 1 || !q || q.op !== OFFLINE_OP || typeof q.sig !== 'string' || !q.payload || !CK.validChallenge(q.payload.checkin)) {
      throw new Error('הקובץ אינו בקשת אישור חיבור של SuperSuite');
    }
    let box;
    try { box = mailboxOf(q.pub); } catch { throw new Error('הקובץ אינו בקשת אישור חיבור של SuperSuite'); }
    const rm = remote();
    // הבקשה נשלחת רק לשרת שמוגדר במחשב הזה — קובץ לא קובע לאן התוכנה פונה
    if (j.origin !== rm.origin) throw new Error('הבקשה מיועדת לשרת רישוי אחר (' + String(j.origin).slice(0, 100) + ') — במחשב הזה מוגדר ' + rm.origin);
    const r = await rm.post({ pub: q.pub, ts: q.ts, nonce: q.nonce, op: OFFLINE_OP, payload: { checkin: q.payload.checkin }, sig: q.sig });
    if (!r.checkin || typeof r.relayCert !== 'string') throw new Error('שרת הרישוי לא החזיר אישור חתום — ייתכן שהשרת עוד לא עודכן. נסו שוב מאוחר יותר');
    return { box, text: JSON.stringify({ type: OFFLINE_RES, v: 1, origin: rm.origin, box, messages: Array.isArray(r.messages) ? r.messages : [],
      more: r.more === true, checkin: r.checkin, relayCert: r.relayCert }) };
  }
  function offlineImport(text) {
    let j;
    try { j = JSON.parse(String(text || '')); } catch { j = null; }
    if (!j || j.type !== OFFLINE_RES || j.v !== 1 || !Array.isArray(j.messages)) throw new Error('הקובץ אינו אישור חיבור של SuperSuite');
    const key = store.syncKey(false);
    if (!key) throw new Error('במחשב הזה עדיין אין רישיון מותקן');
    const box = mailboxOf(L.publicOf(key));
    if (j.box !== box) throw new Error('האישור שייך למחשב אחר');
    const pend = store.getRemoteSettings().offlineCheckin;
    if (!pend || typeof pend.challenge !== 'string') throw new Error('אין במחשב הזה בקשת אישור פתוחה — שמרו בקשה חדשה והעבירו אותה');
    const t = now();
    if (t - pend.at > OFFLINE_MAX_AGE_MS) throw new Error('בקשת האישור ישנה מדי (יותר מ-14 יום) — שמרו בקשה חדשה');
    if (j.more) throw new Error('יש בתיבה של המחשב הזה יותר מדי הודעות להעברה בקובץ — יש לחבר אותו לרשת לסנכרון אחד');
    const msgs = j.messages.filter(m => m && typeof m === 'object' && typeof m.id === 'string');
    let att = null, certExpiresAt = null, signedAt = null;
    if (rootKeys && rootKeys.length) {
      // האתגר חד-פעמי ונוצר כאן: התשובה נחתמה אחרי שהבקשה נוצרה ולא אחרי עכשיו
      const skewMs = Math.max(0, t - pend.at) + CK.CHECKIN_SKEW_MS;
      const v = CK.verifyCheckin({ checkin: j.checkin, cert: j.relayCert }, { rootKeys, box, challenge: pend.challenge, origin: pend.origin, now: t, skewMs, allowLocal: allowLocalRelay });
      if (v.at < pend.at - CK.CHECKIN_SKEW_MS || v.at > t + CK.CHECKIN_SKEW_MS) throw new Error('זמן האישור אינו תואם לבקשה — בדקו את התאריך והשעה במחשב');
      const got = new Map(msgs.map(m => [m.id, m]));
      if (!v.items.every(([id, digest]) => got.has(id) && CK.messageDigest(got.get(id)) === digest)) throw new Error('האישור חלקי או ששונה בדרך — לא נקלט');
      att = { checkin: j.checkin, cert: j.relayCert };
      certExpiresAt = v.certExpiresAt;
      signedAt = v.at;
    }
    const errors = [];
    let handled = 0, deferred = 0;
    let pending = (store.getRemoteSettings().pendingChildRequests || []).map(p => pendingEntry(p, t)).filter(Boolean);
    const owners = ownerIds();
    for (const m of msgs) {
      try {
        if (m.kind === 'license') store.install(m.body);
        else if (m.kind === 'notices') store.importNotices(m.body);
        else if (m.kind === 'update') { if (updates) updates.offer(m.body); }
        else if (m.kind === 'rejection') {
          if (owners.has(m.from)) {
            const r = JSON.parse(m.body);
            errors.push('הבקשה למערכת הבת "' + String(r.name || '').slice(0, 80) + '" נדחתה: ' + String(r.reason || '').slice(0, 500));
          }
        } else if (m.kind === 'license-request') {
          const req = pendingEntry({ body: m.body, at: m.at }, t);
          if (req && !pending.some(p => p.keyId === req.keyId)) pending = [...pending, req];
        } else { deferred++; continue; }
        handled++;
      } catch (e) { errors.push(e.message); }
    }
    store.setRemoteSettings({ offlineCheckin: null, pendingChildRequests: pending.slice(-100),
      ...(att ? { lastSync: signedAt, checkinError: null, checkin: att, certExpiresAt } : {}) });
    store.invalidate();
    return { handled, deferred, errors, at: signedAt };
  }

  // אימות התשובה החתומה. בלי מפתח שורש בתוכנה (התקנה בלי רישוי) אין מה לאמת — כמו קודם.
  // השרת חותם על כל ההודעות שבתיבה (מזהה + תמצית): כל אחת חייבת להגיע, בדיוק כמו שהיא. שרת ביניים שמחק מהתשובה
  // הודעת השבתה או סיום, או החליף את התוכנה שלה בתוכן ישן — החיבור לא מאריך את ההפעלה. קריאה שנעצרה באמצע
  // (FETCH_MAX_PAGES / תקלה בחלק מאוחר) — אותו דבר, עד הסנכרון הבא
  function verifyCheckin(key, challenge, attestation, msgs, origin) {
    if (!rootKeys || !rootKeys.length) return { ok: true };
    let v;
    try {
      v = CK.verifyCheckin(attestation, { rootKeys, box: mailboxOf(L.publicOf(key)), challenge, origin, now: now(), allowLocal: allowLocalRelay });
    } catch (e) { return { ok: false, error: e.message }; }
    const got = new Map(msgs.map(m => [m.id, m]));
    const intact = v.items.every(([id, digest]) => got.has(id) && CK.messageDigest(got.get(id)) === digest);
    return intact ? { ok: true, att: attestation, certExpiresAt: v.certExpiresAt }
      : { ok: false, error: 'התשובה משרת הרישוי חלקית או ששונתה בדרך — החיבור לא אומת. נסו לסנכרן שוב' };
  }
  // מזהים ← ההודעות עצמן, כדי שהמחיקה בשרת תישלח עם התמצית של מה שהתקבל (remote.ack)
  function ackList(msgs, ids) {
    const s = new Set(ids);
    return msgs.filter(m => s.has(m.id));
  }

  // הורה: בקשת רישיון שהגיעה ממערכת בת חדשה ← בקשת אישור למנהל-העל, בלחיצה
  async function forwardChildRequest(keyId, terms) {
    const pending = store.getRemoteSettings().pendingChildRequests || [];
    const p = pending.find(x => x.keyId === keyId);
    if (!p) throw new Error('הבקשה לא נמצאה');
    const r = await sendApprovalRequest({ request: p.body, ...terms });
    // הרשימה נקראת מחדש אחרי ההמתנה לרשת: בינתיים סנכרון ברקע אולי הוסיף בקשה חדשה, וכתיבת העותק
    // שנקרא לפני ההמתנה מחקה אותה (בדיקת קוד 23.10.2026)
    try {
      const latest = store.getRemoteSettings().pendingChildRequests || [];
      store.setRemoteSettings({ pendingChildRequests: latest.filter(x => x.keyId !== keyId) });
    } catch { /* הבקשה כבר נשלחה: התוצאה חוזרת בכל מקרה, כדי שהתשלום יירשם כמנוצל (ipc.js). הרשומה נשארת ברשימה ואפשר לבטל אותה */ }
    return r;
  }

  // קבלת הודעות הצ'אט בלבד — למשתמש שאינו מנהל (chat:refresh). רישיונות, הודעות סטטוס, אישורים ובקשות
  // ממערכות בת לא מטופלים ולא מאושרים: הם נשארים בתיבה לסנכרון של המנהל או לסנכרון האוטומטי
  // (בדיקת קוד 23.10.2026: צופה או רואה חשבון התקינו רישיון והנפיקו רישיון למערכת בת, בלי רישום ביומן)
  async function receiveMessages() {
    const key = store.syncKey(false);
    if (!key || !chat) return { handled: 0, pending: [], errors: [] };
    const rm = remote();
    try { await publishPrekey(key, prekeys); } catch { /* ינוסה שוב בסנכרון הבא */ }
    const msgs = (await rm.fetch(key)).filter(m => m && m.kind === 'message');
    const done = [];
    const errors = [];
    const autos = [];
    for (const m of msgs) {
      try { receiveMessage(key, m.body, myContacts(), chat, prekeys, autos, m.at); done.push(m.id); } catch (e) {
        errors.push(e.message);
        if (!keepOnServer(e)) done.push(m.id);
      }
    }
    await rm.ack(key, ackList(msgs, savedBeforeAck(chat, msgs, done)));
    await sendAutoReplies(key, myContacts(), chat, prekeys, autos);
    return { handled: done.length, pending: [], errors };
  }
  function dismissChildRequest(keyId) {
    const pending = store.getRemoteSettings().pendingChildRequests || [];
    store.setRemoteSettings({ pendingChildRequests: pending.filter(x => x.keyId !== keyId) });
    return true;
  }

  // הורה: עדכון סטטוס למערכת בת מיד אחרי השבתה/החזרה. עם רישוי — רק אישור מסירה חתום מהשרת נחשב הצלחה (ממצא 5):
  // שרת ביניים שמפיל את ההשבתה ועונה "נשלח" — המנהל רואה שגיאה
  async function pushToChild(childId, pkg) {
    const [r] = await deliver(remote(), store.syncKey(false), [{ to: childId, kind: 'notices', body: pkg }]);
    if (!r.ok) throw new Error(r.error);
    rememberChildPush(childId, pkg, r.verified);
    if (!r.verified) throw new Error('עדכון הסטטוס נשלח, אבל השרת לא אישר בחתימה שהוא נשמר אצל מערכת הבת: ' + r.error);
  }

  // ---------- מנהל-העל ----------
  async function ownerReceive() {
    const signer = owner.rootSigner();
    const rm = remote();
    try { await publishPrekey(signer, ownerPrekeys); } catch { /* ינוסה שוב */ }
    const msgs = await rm.fetch(signer);
    let added = 0;
    let messages = 0;
    let signups = 0;
    let signupsHeld = 0;
    let signupsRejected = 0;
    const autos = [];
    const keep = new Set();
    for (const m of msgs) {
      if (m.kind === 'license-request' || m.kind === 'approval-request') { if (owner.addToInbox(m)) added++; }
      else if (m.kind === 'signup' && m.from === 'relay') {
        // at — זמן המסירה בשרת: ההצעה שבהרשמה נבדקת מול מה שהיה מפורסם אז (ממצא 31)
        // הרשמה שלא נקלטה אצלנו (מפתח נעול, קובץ שלא נקרא, פורמט חדש) — נשארת בשרת לסבב הבא: הרשמה בתשלום שאושרה ונמחקה
        // אובדת. אבל מסירה שנפתחה והתוכן שלה אינו הרשמה תקינה (signup-invalid) — השרת בודק רק את החלק הגלוי, ומעטפה
        // מזויפת עוברת אותו; אילו נשארה, זבל היה ממלא לתמיד את המקום של הרשמות חינם (MAX_FREE_IN_BOX). היא נשמרת
        // בהסגר המקומי המוצפן (quarantineSignup) ורק אז מאושרת לשרת ונמחקת שם; כשל בהסגר — נשארת (סקירה 5.11.2026)
        // "שולם" — רק עם אישור חתום של השרת (f83); בלעדיו ההרשמה נשמרת לבדיקה (owner-core.js)
        try { if (owner.addSignup(m.body, { at: m.at, origin: rm.origin, requirePaymentProof: !!(rootKeys && rootKeys.length), allowLocal: allowLocalRelay }).added) signups++; } catch (e) {
          let drop = false;
          if (e && e.code === 'signup-invalid' && typeof owner.quarantineSignup === 'function') {
            try { drop = !!owner.quarantineSignup(m.body, { at: m.at, error: e.message }); } catch { drop = false; }
          }
          if (drop) signupsRejected++; else { keep.add(m.id); signupsHeld++; }
        }
      }
      else if (m.kind === 'message' && ownerChat) {
        try { if (receiveMessage(signer, m.body, owner.contacts(), ownerChat, ownerPrekeys, autos, m.at)) messages++; }
        catch (e) { if (e && e.code === 'chat-unavailable') keep.add(m.id); /* הודעה פגומה — מדולגת; תיבה שלא נקראה — נשארת בשרת */ }
      }
    }
    await rm.ack(signer, ackList(msgs, savedBeforeAck(ownerChat, msgs, msgs.map(m => m.id).filter(id => !keep.has(id)))));
    if (ownerChat) await sendAutoReplies(signer, owner.contacts(), ownerChat, ownerPrekeys, autos);
    return { added, messages, signups, ...(signupsHeld ? { signupsHeld } : {}), ...(signupsRejected ? { signupsRejected } : {}), inbox: owner.inbox().length };
  }

  // שליחת תוצאה לשולח: רישיון ללקוח, או אישור/דחייה ללקוח שביקש מערכת בת
  async function ownerReply(to, kind, body) {
    await remote().send(owner.rootSigner(), [{ to, kind, body }]);
  }

  // עדכוני סטטוס לכל הלקוחות ומערכות הבת (אחרי השבתה / החזרה / נעילה גלובלית). בשרת — מקום שמור להודעות של השורש
  // (אחת לכל תיבה, לא נמחקת באישור קבלה ולא פגה). לכל נמען בנפרד (ממצא 3): כישלון אצל נמען אחד (תיבה פגומה, חלק
  // שלא נשלח) לא עוצר את האחרים, ובסוף — דוח: מי לא קיבל ולמה. עם רישוי — רק אישור מסירה חתום נחשב הצלחה (ממצא 5)
  async function ownerPushNotices() {
    const rm = remote();
    const signer = owner.rootSigner();
    const reg = owner.list();
    const items = [];
    const names = new Map();
    for (const t of reg.tenants) {
      items.push({ to: t.id, kind: 'notices', body: owner.noticesPackage(t.id) });
      names.set(t.id, t.name);
      // כולל מערכות בת שבוטלו — כדי שהודעת הסיום תגיע אליהן
      for (const c of t.children) { items.push({ to: c.id, kind: 'notices', body: owner.noticesPackage(c.id) }); names.set(c.id, c.name); }
    }
    let sent = 0;
    const failed = [];
    for (let i = 0; i < items.length; i += PUSH_BATCH) {
      const batch = items.slice(i, i + PUSH_BATCH);
      const res = await deliver(rm, signer, batch);
      res.forEach((r, k) => {
        if (r.verified) sent++;
        else failed.push({ to: batch[k].to, name: String(names.get(batch[k].to) || ''), error: r.error });
      });
    }
    return { sent, total: items.length, failed };
  }

  // ---------- הרשמה ותשלום ----------
  // מנהל-העל: פרסום ההצעה (תכניות + תקנון) בשרת
  // הצעה לכל מוצר (מרכז הרישוי): SuperSuite קודם — שרת מגרסה קודמת מקבל רק אותה, ושאר המוצרים נכשלים שם בלי לעצור אותה.
  // published — המוצרים שפורסמו; failed — מוצר ושגיאה. שום מוצר לא פורסם ← השגיאה נזרקת
  async function ownerPublishOffer() {
    const o = owner.offer();
    if (!o) throw new Error('עדיין לא הוגדרו תכניות ותקנון');
    const order = Object.keys(o.texts).sort((a, b) => (a === PR.THIS_PRODUCT ? -1 : b === PR.THIS_PRODUCT ? 1 : 0));
    const published = [];
    const failed = [];
    for (const pid of order) {
      try { await remote().setOffer(owner.rootSigner(), o.texts[pid]); published.push(pid); } catch (e) {
        failed.push({ product: pid, name: PR.productName(pid), error: e, message: e.message });
      }
    }
    if (!published.length) throw failed[0].error;
    failed.forEach(f => { delete f.error; });
    // מתי כל הצעה פורסמה — לבדיקת הרשמות לפי הצעה ישנה (ממצא 31). נרשמת ההצעה שנשלחה, ולא מה שנשמר מקומית
    // בזמן שהפרסום רץ ברשת
    if (typeof owner.offerPublished === 'function') owner.offerPublished(o.issuedAt);
    return { ok: true, published, failed };
  }
  // מערכת חדשה: ההצעה מהשרת — נבדקת בחתימה מול מפתח השורש שבתוכנה, ורק הצעה של התוכנה הזו
  async function getOffer() {
    const text = await remote().getOffer(store.syncKey(true), PR.THIS_PRODUCT);
    return { text, offer: OF.verifyOffer(text, rootKeys, { expectProduct: PR.THIS_PRODUCT }) };
  }
  // הרשמה: חתימה על התקנון ויצירת תשלום. מחזיר קישור לדף התשלום המאובטח של הספק
  // לפני שליחת פרטי לקוח (ת"ז, טלפון, חתימה) ולפני שמירה או פתיחה של קישור תשלום: השרת מוכיח שהוא של הספק —
  // חתימה במפתח השרת על אתגר חדש, עם תעודה ממנהל-העל לכתובת הזו בדיוק (checkin.js). כתובת שעברה לבעלים אחרים
  // (sslip.io), או שרת שמעביר את הבקשות לשרת האמיתי — נדחים, והפרטים לא נשלחים. בלי מפתח שורש (בלי רישוי) — אין דרישה
  // needCaps — יכולות שהשרת חייב להכריז עליהן בתוך החתימה (f86: pay-proof). שרת ישן — הודעה ברורה, לא אמון שקט
  async function assertTrustedRelay(rm, key, what, needCaps = []) {
    if (!rootKeys || !rootKeys.length) return null;
    const challenge = randomNonce();
    let v;
    try {
      v = CK.verifyCheckin(await rm.hello(key, challenge), { rootKeys, box: mailboxOf(L.publicOf(key)), challenge, origin: rm.origin, purpose: 'hello', now: now(),
        allowLocal: allowLocalRelay });
    } catch (e) {
      throw new Error('שרת הרישוי לא אומת כשרת של הספק, ולכן ' + what + ': ' + e.message);
    }
    if (needCaps.some(c => !v.caps.includes(c))) throw new Error('שרת הרישוי בגרסה ישנה, שאינה חותמת על פרטי התשלום, ולכן ' + what + '. יש לפנות לספק התוכנה (השרת צריך עדכון)');
    return v;
  }
  // תשובת checkout / paymentStatus: עם מפתחות שורש — רק מה שבחתימת השרת על האתגר שנשלח (f86); בלי — התשובה כמו שהיא
  function paymentReply(r, rm, key, op, challenge) {
    if (!rootKeys || !rootKeys.length) return { paymentId: r.paymentId || null, status: r.free ? 'submitted' : r.status, url: r.url || null, free: !!r.free };
    return CK.verifyPaymentProof(r, { rootKeys, op, box: mailboxOf(L.publicOf(key)), challenge, origin: rm.origin, now: now(), allowLocal: allowLocalRelay });
  }
  async function signup({ offerText, planId, customer, signatureImage, scrolledToEnd, accepted }) {
    const key = store.syncKey(true);
    const su = SU.createSignup({ deviceJwk: key, offerText, rootKeys, planId, customer, signatureImage, scrolledToEnd, accepted, at: now() });
    const rm = remote();
    await assertTrustedRelay(rm, key, 'פרטי ההרשמה לא נשלחו', [CK.CAP_PAY_PROOF]);
    // החבילה המלאה (ת.ז, טלפון, תמונת החתימה) מוצפנת למנהל-העל — לשרת עובר בגלוי רק מה שהוא צריך (f89)
    const sealed = SU.sealSignup({ deviceJwk: key, signup: su, ownerPub: rootKeys[0] });
    const challenge = randomNonce();
    const p = paymentReply(await rm.checkout(key, { public: sealed.publicText, sealed: sealed.sealed }, { proof: challenge }), rm, key, 'checkout', challenge);
    const free = su.body.priceAgorot === 0;
    if (rootKeys && rootKeys.length) {
      // החתימה על התשובה הזו: חינם — "נמסר"; בתשלום — הסכום של התכנית שנחתמה, ודף תשלום של ספק הסליקה בלבד
      if (free !== p.free || (!free && p.amountAgorot !== su.body.priceAgorot)) throw new Error('תשובת שרת הרישוי אינה תואמת לתכנית שנבחרה — ההרשמה לא נשמרה');
      if (p.status === 'pending') CK.assertPaymentUrl(p.url, { relayOrigin: rm.origin });
    }
    const status = p.free ? 'submitted' : p.status;
    // origin — הכתובת שהקישור לתשלום הגיע ממנה (paymentUrl בודק אותה שוב לפני הפתיחה)
    store.setRemoteSettings({ signup: { id: su.id, paymentId: p.paymentId || null, status, url: p.url || null,
      origin: rm.origin, planName: su.body.planName, priceAgorot: su.body.priceAgorot, org: su.body.customer.org, at: now() } });
    return { id: su.id, free: !!p.free, status, url: p.url || null };
  }
  async function signupStatus() {
    const cur = store.getRemoteSettings().signup;
    if (!cur) return null;
    if (cur.paymentId && cur.status === 'pending') {
      const rm = remote();
      const key = store.syncKey(false);
      // התשובה חתומה על האתגר הזה (f86) — מצב וקישור רק מהחתימה, ורק לתשלום הזה
      const challenge = randomNonce();
      let r;
      try { r = paymentReply(await rm.paymentStatus(key, cur.paymentId, { proof: challenge }), rm, key, 'paymentStatus', challenge); }
      catch (e) { throw new Error('מצב התשלום לא נבדק: ' + e.message); }
      if (rootKeys && rootKeys.length) {
        if (r.paymentId !== cur.paymentId) throw new Error('מצב התשלום לא נבדק: תשובת השרת אינה של התשלום הזה');
        if (r.status === 'pending') CK.assertPaymentUrl(r.url, { relayOrigin: rm.origin });
      }
      const next = { ...cur, status: r.status === 'paid' ? 'submitted' : r.status, url: r.url || cur.url, origin: rm.origin };
      store.setRemoteSettings({ signup: next });
      return next;
    }
    return cur;
  }
  // הקישור לדף התשלום — רק אחרי הוכחה חתומה מאותה כתובת שהקישור הגיע ממנה (license:openPayment)
  async function paymentUrl() {
    const cur = store.getRemoteSettings().signup;
    if (!cur || !cur.url) throw new Error('אין תשלום פתוח');
    const rm = remote();
    if (rootKeys && rootKeys.length) {
      if (cur.origin !== rm.origin) throw new Error('הקישור לתשלום לא התקבל מכתובת השרת הנוכחית — לחצו "בדיקת מצב התשלום" ונסו שוב');
      await assertTrustedRelay(rm, store.syncKey(false), 'דף התשלום לא נפתח');
      // רק דף של ספק הסליקה (f86) — גם קישור שנשמר בגרסה קודמת, לפני החתימה על התשובה
      return CK.assertPaymentUrl(cur.url, { relayOrigin: rm.origin });
    }
    return cur.url;
  }

  // מנהל-העל: שליחת תעודת גרסה לכל המערכות (לקוחות ומערכות בת)
  async function ownerPublishUpdate(releaseText) {
    const rm = remote();
    const signer = owner.rootSigner();
    const items = owner.recipients().map(to => ({ to, kind: 'update', body: releaseText }));
    for (let i = 0; i < items.length; i += 50) await rm.send(signer, items.slice(i, i + 50));
    return { sent: items.length };
  }

  // ---------- הודעות ----------
  // אנשי הקשר של המערכת: ההורה, הילדים, ומנהל-העל — מתוך הרישיונות החתומים בלבד
  function myContacts() {
    const info = store.syncInfo();
    if (!info.nodeId) return [];
    return M.contactsOf({ chain: info.chain, children: info.children, rootKeys: rootKeys.slice(0, 1) });
  }
  // פענוח ושמירה. מחזיר true אם נוספה הודעה חדשה; תשובות אוטומטיות נאספות ל-autos ונשלחות אחרי הקבלה.
  // relayAt — מועד ההגעה לשרת הממסר (חלון העריכה והמחיקה מרחוק נבדק גם לפיו, לא רק לפי הזמן שהשולח כתב)
  function receiveMessage(myKey, body, contacts, box, pks, autos, relayAt) {
    const msg = M.open(myKey, body, contacts, { prekeyPriv: pks ? (id) => pks.privOf(id) : null });
    if (msg.kind === 'receipt') { box.setStatus(msg.mids, 'read', msg.from); return false; }
    if (msg.kind === 'edit') { box.applyRemoteEdit(msg.from, msg.target, msg.text, msg.sentAt, relayAt); return false; }
    if (msg.kind === 'delete') { box.applyRemoteDelete(msg.from, msg.target, msg.sentAt, relayAt); return false; }
    if (msg.kind === 'profile') { box.setPeerProfile(msg.from, msg.profile); return false; }
    const added = box.addIncoming({ mid: msg.mid, peer: msg.from, subject: msg.subject, text: msg.text, sentAt: msg.sentAt,
      replyTo: msg.replyTo, forwarded: msg.forwarded, auto: msg.auto, bc: msg.bc, att: msg.att, relayAt });
    if (added && autos && !isRestTime()) for (const r of box.autoReplies(msg.from, msg, now())) autos.push({ peer: msg.from, ...r });
    return added;
  }
  // אישור לשרת רק אחרי שההודעות נשמרו בדיסק (התיבה כותבת באיחור קצר — ממצא 51). כתיבה שנכשלה ←
  // הודעות הצ'אט לא מאושרות ויתקבלו שוב בסנכרון הבא (addIncoming לא מכפיל הודעה לפי מזהה)
  function savedBeforeAck(box, msgs, ids) {
    if (!box || typeof box.flush !== 'function') return ids;
    try { box.flush(); return ids; } catch {
      const chatIds = new Set(msgs.filter(m => m.kind === 'message').map(m => m.id));
      return ids.filter(id => !chatIds.has(id));
    }
  }
  async function sendAutoReplies(signer, contacts, box, pks, autos) {
    for (const a of autos) {
      try { await sendSealed(signer, contacts, box, a.peer, { text: a.text, auto: a.auto }, pks); } catch { /* לא קריטי */ }
    }
  }
  // פרסום המפתח הזמני שלי (כשהתחלף או עוד לא פורסם)
  async function publishPrekey(signer, pks) {
    if (!pks || !pks.needsPublish()) return false;
    const b = pks.bundle(signer);
    await remote().setPrekey(signer, b);
    pks.markPublished(b.id);
    return true;
  }
  // המפתח הזמני של איש קשר — מאומת בחתימה מול המפתח הקבוע שלו (מהרישיונות), לא מה שהשרת טוען
  async function peerPrekey(signer, peer) {
    try { return PK.verifyBundle(await remote().getPrekey(signer, peer.id), peer.publicKey, now()); } catch { return null; }
  }
  // שליחה מוצפנת. הודעת טקסט נשמרת בתיבה כיוצאת; עריכה/מחיקה/פרופיל — רק נשלחות
  async function sendSealed(signer, contacts, box, peerId, msg, pks) {
    const peer = contacts.find(c => c.id === peerId);
    if (!peer) throw new Error('איש הקשר אינו מוכר');
    const sentAt = now();
    try { await publishPrekey(signer, pks); } catch { /* לא חוסם שליחה */ }
    const prekey = await peerPrekey(signer, peer);
    const kind = msg.kind || 'text';
    const { mid, envelope } = M.seal(signer, peer.publicKey, { ...msg, kind, sentAt }, { prekey });
    await remote().send(signer, [{ to: peer.id, kind: 'message', body: envelope }]);
    if (kind === 'text') {
      box.addOutgoing({ mid, peer: peer.id, subject: M.cleanText(msg.subject, M.MAX_SUBJECT), text: M.cleanText(msg.text, M.MAX_TEXT), sentAt,
        replyTo: msg.replyTo, forwarded: msg.forwarded, auto: msg.auto, bc: msg.bc, att: msg.att ? M.cleanAttachment(msg.att) : null });
      box.setStatus([mid], 'delivered');
    }
    return { mid };
  }
  async function sendReceipt(signer, contacts, peerId, mids) {
    const peer = contacts.find(c => c.id === peerId);
    if (!peer || !mids.length) return;
    const { envelope } = M.seal(signer, peer.publicKey, { kind: 'receipt', mids, sentAt: now() }, { prekey: await peerPrekey(signer, peer) });
    await remote().send(signer, [{ to: peer.id, kind: 'message', body: envelope }]);
  }
  // פעולות הצ'אט — לתיבה של המערכת (asOwner=false) או של מנהל-העל
  function chatOps(asOwner) {
    const signer = () => (asOwner ? owner.rootSigner() : store.syncKey(false));
    const contacts = () => (asOwner ? owner.contacts() : myContacts());
    const box = asOwner ? ownerChat : chat;
    const pks = asOwner ? ownerPrekeys : prekeys;
    // שליחה ידנית — אף פעם לא מסומנת כאוטומטית
    const send = (peerId, msg) => sendSealed(signer(), contacts(), box, peerId, { ...msg, kind: 'text', auto: undefined }, pks);
    return {
      send,
      async markRead(peerId) {
        const ids = box.markRead(peerId);
        try { await sendReceipt(signer(), contacts(), peerId, ids); } catch { /* אישור קריאה אינו קריטי */ }
        return ids.length;
      },
      // עריכה: נבדקת מקומית (חלון זמן), נשלחת, ורק אז נשמרת
      async edit(mid, text) {
        const m = box.get(mid);
        if (!box.canEdit(m, now())) throw new Error('אפשר לערוך הודעה ששלחתם בתוך 15 דקות בלבד');
        if (!m.text && m.att) throw new Error('אי אפשר לערוך קובץ מצורף');
        await sendSealed(signer(), contacts(), box, m.peer, { kind: 'edit', target: mid, text }, pks);
        return box.editOwn(mid, text, now());
      },
      async deleteForAll(mid) {
        const m = box.get(mid);
        if (!box.canDeleteForAll(m, now())) throw new Error('אפשר למחוק אצל כולם הודעה ששלחתם ביומיים האחרונים בלבד');
        await sendSealed(signer(), contacts(), box, m.peer, { kind: 'delete', target: mid }, pks);
        return box.deleteOwnForAll(mid, now());
      },
      // העברה לאיש קשר אחר — הטקסט והקובץ, עם סימון "הועברה"
      forward(mid, peerId) {
        const m = box.get(mid);
        if (!m || m.deleted) throw new Error('ההודעה לא נמצאה');
        let att = null;
        if (m.att) {
          if (!m.att.data) throw new Error('הקובץ אינו זמין עוד במחשב הזה');
          att = { name: m.att.name, type: m.att.type, data: m.att.data };
        }
        return send(peerId, { subject: m.subject, text: m.text, att, forwarded: true });
      },
      // רשימת תפוצה: כל נמען מקבל הודעה נפרדת (לא קבוצה — הנמענים לא רואים זה את זה)
      async broadcast(listId, msg) {
        const list = box.settings().lists.find(l => l.id === listId);
        if (!list) throw new Error('רשימת התפוצה לא נמצאה');
        const known = new Map(contacts().map(c => [c.id, c]));
        const members = list.members.filter(id => known.has(id));
        if (!members.length) throw new Error('אין ברשימה אנשי קשר פעילים');
        const failed = [];
        let sent = 0;
        for (const id of members) {
          try { await send(id, { ...msg, replyTo: undefined, bc: true }); sent++; }
          catch (e) { failed.push({ name: known.get(id).name, error: e.message }); }
        }
        return { sent, failed, skipped: list.members.length - members.length };
      },
      // הפרופיל העסקי — נשלח לכל אנשי הקשר (מוצג אצלם בראש השיחה)
      async publishProfile() {
        const profile = box.settings().profile;
        let sent = 0;
        for (const c of contacts()) {
          try { await sendSealed(signer(), contacts(), box, c.id, { kind: 'profile', profile }, pks); sent++; } catch { /* ינוסה בפעם הבאה */ }
        }
        return { sent };
      },
      receive: () => (asOwner ? ownerReceive() : receive()),
    };
  }
  const chatSend = (peerId, msg) => chatOps(false).send(peerId, msg);
  const chatMarkRead = (peerId) => chatOps(false).markRead(peerId);
  const ownerChatSend = (peerId, msg) => chatOps(true).send(peerId, msg);
  const ownerChatMarkRead = (peerId) => chatOps(true).markRead(peerId);

  return { offlineRequest, offlineRelay, offlineImport, myContacts, chatOps, chatSend, chatMarkRead, ownerChatSend, ownerChatMarkRead, sendLicenseRequest, sendApprovalRequest, sendRequestToParent, receive, receiveMessages, forwardChildRequest, dismissChildRequest, pushToChild,
    ownerReceive, ownerReply, ownerPushNotices, ownerPublishUpdate, ownerPublishOffer, getOffer, signup, signupStatus, paymentUrl, ownerBox };
}

module.exports = { createLicenseSync, PKG_APPROVAL_REQUEST };
