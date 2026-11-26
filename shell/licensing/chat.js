// תיבת ההודעות המקומית של מערכת (או של מנהל-העל): שיחות לפי איש קשר, סטטוס מסירה וקריאה, חיפוש,
// וכלי עסק בסגנון "וואטסאפ ביזנס": תגובה לציטוט, עריכה ומחיקה, כוכב, נעיצה/ארכיון/השתקה, תוויות והערות פנימיות,
// פרופיל עסקי, תשובות מהירות, הודעת פתיחה והודעת היעדרות, רשימות תפוצה וקבצים מצורפים.
// בדרך ההודעות מוצפנות מקצה לקצה (messages.js); במחשב — מוצפנות בדיסק (chat-storage.js, ממצא 26).
// אחסון מוזרק: { read(): string|null, write(text), setAside?(), legacy?(), dropLegacy?(text), setAsideLegacy?() }.
// פורמט ישן (מערך הודעות) נקרא כמו שהוא. גיבוי ושחזור — exportMailbox / restoreMailbox / mailboxFromBackup (למטה).
const MAX_STORED = 5000;
const MAX_SUBJECT = 120;
const MAX_TEXT = 4000;
const FLUSH_MS = 300;                            // שינויים נאספים ונכתבים יחד
const FLUSH_RETRY_MS = 30 * 1000;                // כתיבה שנכשלה — ניסיון חוזר
const EDIT_WINDOW_MS = 15 * 60 * 1000;           // עריכת הודעה שנשלחה — עד רבע שעה
const DELETE_ALL_WINDOW_MS = 48 * 60 * 60 * 1000; // מחיקה אצל כולם — עד יומיים
const CLOCK_SLACK_MS = 5 * 60 * 1000;             // הפרש שעונים בין המחשבים
const MAX_PINNED = 3;
const AWAY_REPEAT_MS = 12 * 60 * 60 * 1000;       // הודעת היעדרות — פעם ב-12 שעות לכל שיחה
const LABEL_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#64748b'];
const DEFAULT_LABELS = [
  { id: 'new', name: 'לקוח חדש', color: '#2563eb' },
  { id: 'pay', name: 'ממתין לתשלום', color: '#d97706' },
  { id: 'paid', name: 'שולם', color: '#16a34a' },
  { id: 'todo', name: 'לטיפול', color: '#dc2626' },
  { id: 'done', name: 'הושלם', color: '#64748b' },
];
// שעות פעילות: לפי ימי השבוע (0 = ראשון). null = סגור
const DEFAULT_HOURS = [
  { open: '09:00', close: '17:00' }, { open: '09:00', close: '17:00' }, { open: '09:00', close: '17:00' },
  { open: '09:00', close: '17:00' }, { open: '09:00', close: '17:00' }, { open: '09:00', close: '12:00' }, null,
];
const DEFAULT_SETTINGS = {
  profile: { name: '', about: '', address: '', phone: '', email: '', website: '' },
  hours: DEFAULT_HOURS,
  quickReplies: [],
  labels: DEFAULT_LABELS,
  greeting: { enabled: false, text: 'שלום וברכה! תודה שפניתם אלינו. נחזור אליכם בהקדם.', quietDays: 14 },
  away: { enabled: false, text: 'תודה על פנייתכם. אנו מחוץ לשעות הפעילות ונחזור אליכם ביום העבודה הבא.', always: false },
  lists: [],
  autoFetch: false,
};

const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const oneLine = (s, max) => clean(s, max).replace(/\s+/g, ' ');
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const UNAVAILABLE = 'תיבת ההודעות אינה זמינה כרגע (הקובץ לא נקרא). שום הודעה לא נמחקה — נסו שוב בעוד רגע';
function chatError(code, message) { const e = new Error(message); e.code = code; return e; }

// הודעה שמורה (מקובץ ישן, או שנשמרה לפני תיקון ממצא 49) — שדות התצוגה תמיד בצורה הנכונה,
// כדי שהודעה אחת עם text שאינו מחרוזת לא תפיל את מסך ההודעות והחיפוש
function normalizeStored(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const mid = typeof m.mid === 'string' || typeof m.mid === 'number' ? String(m.mid) : '';
  if (!mid) return null;
  const o = { ...m, mid, peer: String(m.peer == null ? '' : m.peer),
    subject: typeof m.subject === 'string' ? m.subject : clean(m.subject, MAX_SUBJECT),
    text: typeof m.text === 'string' ? m.text : clean(m.text, MAX_TEXT),
    sentAt: Number.isFinite(m.sentAt) ? m.sentAt : Number.isFinite(m.receivedAt) ? m.receivedAt : 0 };
  if (o.att != null) {
    o.att = typeof o.att === 'object' ? { ...o.att, name: typeof o.att.name === 'string' && o.att.name ? o.att.name : 'קובץ',
      type: String(o.att.type || ''), data: typeof o.att.data === 'string' ? o.att.data : null } : null;
  }
  if (o.replyTo != null && typeof o.replyTo !== 'string') delete o.replyTo;
  return o;
}

function cleanHours(hours) {
  if (!Array.isArray(hours) || hours.length !== 7) throw new Error('שעות הפעילות אינן תקינות');
  return hours.map((h) => {
    if (!h) return null;
    if (!TIME_RE.test(String(h.open)) || !TIME_RE.test(String(h.close))) throw new Error('שעה לא תקינה — יש לכתוב בצורה 09:00');
    if (minutes(h.close) <= minutes(h.open)) throw new Error('שעת הסגירה חייבת להיות אחרי שעת הפתיחה');
    return { open: h.open, close: h.close };
  });
}

// האם העסק פתוח ברגע נתון (לפי השעון המקומי של המחשב)
function isOpenAt(hours, at) {
  const d = new Date(at);
  const h = (hours || [])[d.getDay()];
  if (!h) return false;
  const m = d.getHours() * 60 + d.getMinutes();
  return m >= minutes(h.open) && m < minutes(h.close);
}

function cleanProfile(p) {
  const v = p || {};
  const email = oneLine(v.email, 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('כתובת הדוא"ל אינה תקינה');
  const website = oneLine(v.website, 200);
  if (website && !/^https:\/\/[^\s]+$/.test(website)) throw new Error('כתובת האתר חייבת להתחיל ב-https://');
  return { name: oneLine(v.name, 80), about: clean(v.about, 500), address: oneLine(v.address, 200),
    phone: oneLine(v.phone, 30).replace(/[^\d+\-() ]/g, ''), email, website };
}

// הגדרות שמגיעות מהמשתמש — נבדקות כאן ולא רק בממשק
function cleanSettings(input, prev) {
  const s = { ...prev, ...(input || {}) };
  const out = { autoFetch: !!s.autoFetch };
  out.profile = cleanProfile(s.profile);
  out.hours = cleanHours(s.hours);
  const seen = new Set();
  out.quickReplies = (Array.isArray(s.quickReplies) ? s.quickReplies : []).slice(0, 50).map((q) => {
    const shortcut = oneLine(q && q.shortcut, 24).replace(/^\//, '');
    const text = clean(q && q.text, 4000);
    if (!/^[\p{L}\p{N}_-]+$/u.test(shortcut)) throw new Error('קיצור לתשובה מהירה: אותיות, ספרות, _ או - בלבד, בלי רווחים');
    if (!text) throw new Error('תשובה מהירה "/' + shortcut + '" ריקה');
    if (seen.has(shortcut)) throw new Error('הקיצור "/' + shortcut + '" מופיע פעמיים');
    seen.add(shortcut);
    return { shortcut, text };
  });
  const labelIds = new Set();
  out.labels = (Array.isArray(s.labels) ? s.labels : []).slice(0, 20).map((l) => {
    const name = oneLine(l && l.name, 30);
    if (!name) throw new Error('לתווית חייב להיות שם');
    const id = /^[A-Za-z0-9_-]{1,24}$/.test(String(l.id || '')) ? l.id : newId();
    labelIds.add(id);
    return { id, name, color: LABEL_COLORS.includes(l.color) ? l.color : LABEL_COLORS[0] };
  });
  const g = s.greeting || {};
  out.greeting = { enabled: !!g.enabled, text: clean(g.text, 4000), quietDays: Math.min(90, Math.max(1, Math.round(Number(g.quietDays) || 14))) };
  if (out.greeting.enabled && !out.greeting.text) throw new Error('הודעת הפתיחה ריקה');
  const a = s.away || {};
  out.away = { enabled: !!a.enabled, text: clean(a.text, 4000), always: !!a.always };
  if (out.away.enabled && !out.away.text) throw new Error('הודעת ההיעדרות ריקה');
  out.lists = (Array.isArray(s.lists) ? s.lists : []).slice(0, 20).map((l) => {
    const name = oneLine(l && l.name, 40);
    if (!name) throw new Error('לרשימת תפוצה חייב להיות שם');
    const members = [...new Set((Array.isArray(l.members) ? l.members : []).map(String).filter(id => /^[A-Za-z0-9_-]{22}$/.test(id)))].slice(0, 256);
    return { id: /^[A-Za-z0-9_-]{1,24}$/.test(String(l.id || '')) ? l.id : newId(), name, members };
  });
  return { settings: out, labelIds };
}

// הטיימר לא מחזיק את התהליך בחיים: ביציאה מהתוכנה הכתיבה נעשית ב-flush (main.js → flushChat)
function laterTimer(fn, ms) {
  const t = setTimeout(fn, ms);
  if (t && typeof t.unref === 'function') t.unref();
  return t;
}

// מיזוג תיבה נוספת (קובץ גלוי שנשאר ליד המוצפן) לתוך התיבה: הודעות שאין בה (לפי כיוון ומזהה) מתווספות,
// וכך גם נתוני שיחה (תוויות, הערה) של אנשי קשר שאין להם. ההגדרות — של התיבה. מחזיר כמה פריטים נוספו
const orderOf = (m) => (Number.isFinite(m.receivedAt) ? m.receivedAt : m.sentAt) || 0;
function mergeMailbox(d, extra) {
  const ex = Array.isArray(extra) ? { messages: extra } : extra;
  const have = new Set(d.messages.map(m => m.dir + ':' + m.mid));
  let added = 0;
  for (const raw of Array.isArray(ex.messages) ? ex.messages : []) {
    const m = normalizeStored(raw);
    if (!m || have.has(m.dir + ':' + m.mid)) continue;
    have.add(m.dir + ':' + m.mid);
    d.messages.push(m);
    added++;
  }
  if (added) d.messages.sort((a, b) => orderOf(a) - orderOf(b)); // מיון יציב — הסדר הקיים נשמר
  const meta = ex.meta && typeof ex.meta === 'object' && !Array.isArray(ex.meta) ? ex.meta : {};
  for (const [peer, mt] of Object.entries(meta)) {
    if (peer in d.meta || !mt || typeof mt !== 'object' || Array.isArray(mt)) continue; // in — גם __proto__ לא נכתב
    d.meta[peer] = mt;
    added++;
  }
  return added;
}

/* ---------- גיבוי ושחזור (החלטת הבעלים: התיבה בגיבוי המלא ובשחזור המלא — main.js / main-android.js) ----------
   בגיבוי: כל התיבה של המערכת — הודעות, נתוני שיחה (תוויות, הערות פנימיות, נעיצה, ארכיון, השתקה) והגדרות העסק
   (פרופיל, שעות, תשובות מהירות, תוויות, הודעות פתיחה והיעדרות, רשימות תפוצה). תוכן הקבצים המצורפים — עד
   BACKUP_ATTACHMENT_CHARS, החדשים קודם: 14 גיבויים אוטומטיים עם עד 40MB קבצים בכל אחד היו ממלאים את כונן הגיבוי.
   קובץ שמעבר לזה — רק השם, הסוג והגודל (att.omitted). */
const BACKUP_ATTACHMENT_CHARS = 8 * 1024 * 1024; // תווי base64 — כ-6MB של קבצים
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const msgKey = (m) => m.dir + ':' + m.mid;
function backupError(detail) {
  return chatError('chat-backup-invalid', 'נתוני ההודעות בקובץ הגיבוי אינם תקינים' + (detail ? ` (${detail})` : ''));
}
// הגדרות מקובץ גיבוי: כל חלק נבדק כמו בשמירה מהמסך (cleanSettings); חלק שלא עובר את הבדיקה — ברירת המחדל שלו,
// ולא כישלון של כל השחזור (הגדרה שנשמרה בגרסה ישנה, לפני שנוספה בדיקה, לא תעצור שחזור של גיבוי אמיתי)
function settingsFromBackup(raw) {
  let out = cleanSettings({}, DEFAULT_SETTINGS).settings;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    try { out = { ...out, [key]: cleanSettings({ [key]: raw[key] }, out).settings[key] }; } catch { /* ברירת המחדל של החלק הזה */ }
  }
  return out;
}
// נתוני שיחה מקובץ גיבוי — רק השדות שהתיבה מכירה, ותוויות שקיימות בהגדרות
function metaFromBackup(raw, labelIds) {
  const out = {};
  for (const [peer, mt] of Object.entries(raw)) {
    if (!peer || peer.length > 128 || UNSAFE_KEYS.has(peer) || !isPlain(mt)) continue;
    const o = { labels: [...new Set((Array.isArray(mt.labels) ? mt.labels : []).map(String))].filter(id => labelIds.has(id)) };
    for (const f of ['pinned', 'archived', 'muted', 'markedUnread']) if (mt[f] === true) o[f] = true;
    if (o.archived) delete o.pinned;
    if (typeof mt.note === 'string' && mt.note) o.note = clean(mt.note, 2000);
    if (isPlain(mt.profile)) {
      try { o.profile = { ...cleanProfile(mt.profile), receivedAt: Number.isFinite(mt.profile.receivedAt) ? mt.profile.receivedAt : 0 }; } catch { /* בלי הפרופיל */ }
    }
    if (isPlain(mt.lastAuto) && Number.isFinite(mt.lastAuto.away)) o.lastAuto = { away: mt.lastAuto.away };
    out[peer] = o;
  }
  return out;
}
// הודעה מקובץ גיבוי: כמו הודעה שנקראה מהדיסק (normalizeStored), עם כיוון תקין ואורכים מוגבלים. לא תקינה ← מדולגת
function messageFromBackup(raw) {
  const m = normalizeStored(raw);
  if (!m || (m.dir !== 'in' && m.dir !== 'out') || m.mid.length > 64 || !m.peer || m.peer.length > 128) return null;
  const o = { ...m, subject: m.subject.slice(0, MAX_SUBJECT), text: m.text.slice(0, MAX_TEXT) };
  if (o.att && !o.att.data) o.att = { ...o.att, data: null };
  return o;
}
// התיבה מקובץ גיבוי (קלט חיצוני — גם קובץ JSON ישן וגלוי) — נבדקת לפני שנוגעים בדבר. מבנה לא תקין ← שגיאה
// בעברית (והשחזור כולו לא מתחיל); הודעה בודדת לא תקינה או כפולה ← מדולגת, כמו בקריאה מהדיסק
function mailboxFromBackup(raw) {
  if (Array.isArray(raw)) raw = { messages: raw }; // פורמט ישן של התיבה
  if (!isPlain(raw)) throw backupError();
  if (raw.messages != null && !Array.isArray(raw.messages)) throw backupError('רשימת ההודעות');
  if (raw.meta != null && !isPlain(raw.meta)) throw backupError('נתוני השיחות');
  if (raw.settings != null && !isPlain(raw.settings)) throw backupError('הגדרות העסק');
  const seen = new Set();
  const messages = [];
  for (const r of (raw.messages || []).slice(-MAX_STORED)) {
    const m = messageFromBackup(r);
    if (!m || seen.has(msgKey(m))) continue;
    seen.add(msgKey(m));
    messages.push(m);
  }
  const settings = settingsFromBackup(raw.settings || {});
  return { v: 2, messages, meta: metaFromBackup(raw.meta || {}, new Set(settings.labels.map(l => l.id))), settings };
}

// schedule(fn, ms) — טיימר לכתיבה המאוחרת (מוזרק בבדיקות); onError(scope, e) — יומן תקלות.
// writeDelayMs: 0 — כל שינוי נכתב מיד (אנדרואיד: אין שם יציאה מסודרת שבה אפשר לכתוב את מה שממתין, והכתיבה ל-localStorage זולה)
// maxStoredChars — תקציב לגודל התיבה כולה (תווים ב-JSON). באנדרואיד התיבות חולקות את מכסת ה-localStorage עם קובץ
// הרישוי ומפתח המערכת; תיבה מלאה חסמה את שמירת הסנכרון והמערכת ננעלה (סקירה 2.11.2026, ממצא f78)
function createChatStore({ storage, clock = Date.now, maxAttachmentBytes = 40 * 1024 * 1024, schedule = laterTimer, onError = () => {}, writeDelayMs = FLUSH_MS, maxStoredChars = Infinity }) {
  // ממצא 51: התיבה נקראת מהדיסק פעם אחת ונשמרת בזיכרון; שינויים נאספים ונכתבים בכתיבה אחת אחרי FLUSH_MS,
  // או מיד ב-flush() (לפני אישור לשרת שההודעות התקבלו, וביציאה). קודם כל פעולה קראה וכתבה את כל הקובץ עם fsync
  let cache = null;
  let dirty = false;
  let timer = null;

  // ממצא 50: קריאה שנכשלה לא הופכת לתיבה ריקה — שהייתה נשמרת מעל הקובץ האמיתי ומוחקת את כל ההיסטוריה.
  //   שגיאת קריאה (קובץ תפוס) ← שגיאה, בלי מטמון ובלי כתיבה; ננסה שוב בפעולה הבאה.
  //   קובץ פגום (JSON שבור, הצפנה שלא נפתחת, מפתח שאבד) ← מועבר הצידה (לא נמחק) ונקרא שוב: עותק גלוי שנשאר
  //   לידו (אולי העותק הקריא היחיד של ההיסטוריה) נקרא ומומר; אין — תיבה חדשה. אחסון בלי setAside — לא דורסים
  function readMailbox() {
    for (let attempt = 0; attempt < 3; attempt++) {
      let text = null;
      let damaged = false;
      try { text = storage.read(); }
      catch (e) {
        if (!e || e.code !== 'chat-damaged') { onError('chat-read', e); throw chatError('chat-unavailable', UNAVAILABLE); }
        onError('chat-damaged', e);
        damaged = true;
      }
      let d = null;
      if (!damaged && text) {
        try { d = JSON.parse(text); } catch { damaged = true; }
        if (d !== null && typeof d !== 'object') damaged = true;
      }
      if (!damaged) return d;
      try {
        if (typeof storage.setAside !== 'function') throw new Error('storage cannot set aside a damaged mailbox');
        storage.setAside();
      } catch (e) { onError('chat-damaged', e); throw chatError('chat-unavailable', UNAVAILABLE); }
      onError('chat-damaged', new Error('damaged mailbox set aside'));
    }
    return null;
  }
  function load() {
    if (cache) return cache;
    let d = readMailbox();
    if (Array.isArray(d)) d = { messages: d }; // פורמט ישן
    d = d && typeof d === 'object' ? d : {};
    const settings = d.settings && typeof d.settings === 'object' && !Array.isArray(d.settings) ? d.settings : {};
    cache = { messages: (Array.isArray(d.messages) ? d.messages : []).map(normalizeStored).filter(Boolean),
      meta: d.meta && typeof d.meta === 'object' && !Array.isArray(d.meta) ? d.meta : {},
      settings: { ...DEFAULT_SETTINGS, ...settings } };
    adoptLegacy();
    return cache;
  }
  // קובץ גלוי שנשאר ליד המוצפן (chat-storage.js → legacy): ממוזג לתיבה, נכתב, ורק אז נמחק.
  // כשל בכתיבה — הקובץ נשאר, וימוזג שוב (בלי כפילות) בעלייה הבאה
  function adoptLegacy() {
    if (typeof storage.legacy !== 'function') return;
    let text;
    try { text = storage.legacy(); } catch (e) { onError('chat-legacy', e); return; }
    if (text == null) return;
    let extra;
    try { extra = JSON.parse(text); } catch { extra = null; }
    if (!extra || typeof extra !== 'object') {
      try { if (typeof storage.setAsideLegacy === 'function') storage.setAsideLegacy(); } catch (e) { onError('chat-legacy', e); }
      return;
    }
    const added = mergeMailbox(cache, extra);
    if (added) {
      onError('chat-legacy', new Error(`merged ${added} item(s) from a plain messages file left beside the encrypted one`));
      dirty = true;
      try { flush(); } catch (e) { onError('chat-write', e); return; }
    }
    if (typeof storage.dropLegacy === 'function') storage.dropLegacy(text);
  }
  // קבצים מצורפים ישנים נמחקים מהמחשב כשעוברים את התקרה (ההודעה עצמה נשארת)
  function trim(d) {
    const messages = d.messages.length > MAX_STORED ? d.messages.slice(-MAX_STORED) : d.messages;
    let total = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const att = messages[i].att;
      if (!att || !att.data) continue;
      total += att.data.length;
      if (total > maxAttachmentBytes) messages[i] = { ...messages[i], att: { ...att, data: null, expired: true } };
    }
    d.messages = messages;
    if (Number.isFinite(maxStoredChars)) fitBudget(d);
  }
  // מעבר לתקציב: קודם הקבצים המצורפים הישנים (ההודעה נשארת), ואחר כך ההודעות הישנות ביותר
  function fitBudget(d) {
    const size = () => JSON.stringify({ v: 2, messages: d.messages, meta: d.meta, settings: d.settings }).length;
    let over = size() - maxStoredChars;
    if (over <= 0) return;
    for (let i = 0; i < d.messages.length && over > 0; i++) {
      const att = d.messages[i].att;
      if (!att || !att.data) continue;
      over -= att.data.length;
      d.messages[i] = { ...d.messages[i], att: { ...att, data: null, expired: true } };
    }
    let drop = 0;
    while (over > 0 && drop < d.messages.length) over -= JSON.stringify(d.messages[drop++]).length + 1;
    if (drop) d.messages = d.messages.slice(drop);
  }
  // כתיבה מיידית של מה שהשתנה. כשל ← נזרק, והשינויים נשארים בזיכרון לניסיון חוזר
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dirty || !cache) return false;
    trim(cache);
    try { storage.write(JSON.stringify({ v: 2, messages: cache.messages, meta: cache.meta, settings: cache.settings })); }
    catch (e) { changed(FLUSH_RETRY_MS); throw e; }
    dirty = false;
    return true;
  }
  function changed(delay = writeDelayMs) {
    dirty = true;
    if (delay <= 0) { try { flush(); } catch (e) { onError('chat-write', e); } return; } // כשל — flush מתזמן ניסיון חוזר
    if (timer) return;
    timer = schedule(() => {
      timer = null;
      try { flush(); } catch (e) { onError('chat-write', e); }
    }, delay);
  }
  const update = (fn) => { const d = load(); const r = fn(d); changed(); return r; };
  const metaOf = (d, peer) => (d.meta[peer] = { labels: [], ...(d.meta[peer] || {}) });
  const copy = (v) => JSON.parse(JSON.stringify(v));

  // השדות נבדקים גם כאן (ולא רק ב-messages.js) — מה שנכנס לתיבה תמיד בצורה שהמסך יודע להציג
  const pick = (m) => {
    const o = { mid: String(m.mid), peer: String(m.peer), subject: clean(m.subject, MAX_SUBJECT), text: clean(m.text, MAX_TEXT),
      sentAt: Number.isFinite(m.sentAt) ? m.sentAt : clock() };
    if (typeof m.replyTo === 'string' && m.replyTo) o.replyTo = m.replyTo;
    if (m.forwarded) o.forwarded = true;
    if (m.auto === 'greeting' || m.auto === 'away') o.auto = m.auto;
    if (m.bc) o.bc = true;
    if (m.att) o.att = { name: String(m.att.name || 'קובץ'), type: String(m.att.type || ''), size: m.att.size, data: typeof m.att.data === 'string' ? m.att.data : null };
    return o;
  };
  // מועד ההגעה של הודעה נכנסת: לפי שרת הממסר כשהזמן סביר (לא בעתיד), אחרת השעון שלנו. השולח לא קובע אותו
  // (בניגוד ל-sentAt), ולכן חלון העריכה והמחיקה מרחוק נבדק גם לפיו
  const arrival = (relayAt, now) => (Number.isFinite(relayAt) && relayAt > 0 && relayAt <= now + CLOCK_SLACK_MS ? Math.min(relayAt, now) : now);
  function inRemoteWindow(m, at, relayAt, windowMs) {
    const limit = windowMs + CLOCK_SLACK_MS;
    const base = Number.isFinite(m.arrivedAt) ? m.arrivedAt : m.receivedAt; // הודעה מלפני התיקון — זמן הקבלה אצלנו
    return Number.isFinite(at) && at - m.sentAt <= limit && Number.isFinite(base) && arrival(relayAt, clock()) - base <= limit;
  }
  function addOutgoing(m) {
    update(d => { d.messages.push({ ...pick(m), dir: 'out', status: 'sent' }); });
  }
  // הודעה נכנסת — פעם אחת בלבד לכל מזהה. relayAt — מועד ההגעה לשרת הממסר
  function addIncoming(m) {
    return update((d) => {
      if (d.messages.some(x => x.mid === String(m.mid) && x.dir === 'in')) return false;
      const now = clock();
      d.messages.push({ ...pick(m), dir: 'in', receivedAt: now, arrivedAt: arrival(m.relayAt, now), read: false });
      if (d.meta[m.peer] && d.meta[m.peer].archived && !d.meta[m.peer].muted) d.meta[m.peer].archived = false; // הודעה חדשה מוציאה מהארכיון
      return true;
    });
  }
  // peer — אישור קריאה מאיש קשר חל רק על הודעות שנשלחו אליו
  function setStatus(mids, status, peer) {
    const set = new Set(mids);
    update(d => { d.messages = d.messages.map(m => (m.dir === 'out' && set.has(m.mid) && m.status !== 'read' && (peer == null || m.peer === peer) ? { ...m, status } : m)); });
  }
  // סימון כנקרא — מחזיר את מזהי ההודעות כדי לשלוח אישור קריאה לשולח
  function markRead(peer) {
    const ids = [];
    update((d) => {
      d.messages = d.messages.map((m) => { if (m.dir === 'in' && m.peer === peer && !m.read) { ids.push(m.mid); return { ...m, read: true }; } return m; });
      if (d.meta[peer]) d.meta[peer].markedUnread = false;
    });
    return ids;
  }
  // עותק — מי שקורא לא משנה בטעות את התיבה שבזיכרון
  const get = (mid) => { const m = load().messages.find(x => x.mid === mid); return m ? { ...m } : null; };

  // ---------- עריכה ומחיקה ----------
  // עריכה שלי: רק הודעה יוצאת, שלא נמחקה, בתוך חלון הזמן. מחזיר את ההודעה לפני העריכה (לשליחה לנמען)
  function canEdit(m, at) { return !!m && m.dir === 'out' && !m.deleted && !m.auto && at - m.sentAt <= EDIT_WINDOW_MS; }
  function canDeleteForAll(m, at) { return !!m && m.dir === 'out' && !m.deleted && at - m.sentAt <= DELETE_ALL_WINDOW_MS; }
  function editOwn(mid, text, at = clock()) {
    const t = clean(text, 4000);
    if (!t) throw new Error('ההודעה ריקה');
    return update((d) => {
      const m = d.messages.find(x => x.mid === mid && x.dir === 'out');
      if (!canEdit(m, at)) throw new Error('אפשר לערוך הודעה ששלחתם בתוך 15 דקות בלבד');
      if (!m.text && m.att) throw new Error('אי אפשר לערוך קובץ מצורף');
      m.text = t; m.editedAt = at;
      return { peer: m.peer, mid };
    });
  }
  function deleteOwnForAll(mid, at = clock()) {
    return update((d) => {
      const m = d.messages.find(x => x.mid === mid && x.dir === 'out');
      if (!canDeleteForAll(m, at)) throw new Error('אפשר למחוק אצל כולם הודעה ששלחתם ביומיים האחרונים בלבד');
      Object.assign(m, { deleted: true, text: '', subject: '', att: null, starred: false });
      return { peer: m.peer, mid };
    });
  }
  // עריכה/מחיקה שהגיעה מאיש הקשר: רק להודעה שהוא עצמו שלח, ורק בחלון הזמן (עם מרווח לשעונים).
  // החלון נבדק גם לפי הזמנים שהשולח כתב (at, sentAt) וגם לפי מועדי ההגעה — כדי שלא יוכל לערוך או למחוק
  // הודעה ישנה בזמנים מזויפים. relayAt — מועד ההגעה של העריכה/המחיקה לשרת הממסר
  function applyRemoteEdit(peer, target, text, at, relayAt) {
    return update((d) => {
      const m = d.messages.find(x => x.mid === target && x.dir === 'in' && x.peer === peer);
      if (!m || m.deleted || !inRemoteWindow(m, at, relayAt, EDIT_WINDOW_MS)) return false;
      const t = clean(text, MAX_TEXT);
      if (!t) return false;
      m.text = t; m.editedAt = at;
      return true;
    });
  }
  function applyRemoteDelete(peer, target, at = clock(), relayAt) {
    return update((d) => {
      const m = d.messages.find(x => x.mid === target && x.dir === 'in' && x.peer === peer);
      if (!m || m.deleted || !inRemoteWindow(m, at, relayAt, DELETE_ALL_WINDOW_MS)) return false;
      Object.assign(m, { deleted: true, text: '', subject: '', att: null, starred: false });
      return true;
    });
  }
  function deleteForMe(mids) {
    const set = new Set((Array.isArray(mids) ? mids : [mids]).map(String));
    return update((d) => { const n = d.messages.length; d.messages = d.messages.filter(m => !set.has(m.mid)); return n - d.messages.length; });
  }
  function star(mid, on) {
    return update((d) => {
      const m = d.messages.find(x => x.mid === mid);
      if (!m || m.deleted) throw new Error('ההודעה לא נמצאה');
      m.starred = !!on;
      return true;
    });
  }
  const starred = () => load().messages.filter(m => m.starred).reverse().map(stripData);

  // ---------- שיחות ----------
  function setMeta(peer, patch = {}) {
    return update((d) => {
      const meta = metaOf(d, peer);
      if ('pinned' in patch) {
        if (patch.pinned && !meta.pinned && Object.values(d.meta).filter(x => x.pinned).length >= MAX_PINNED) throw new Error('אפשר לנעוץ עד 3 שיחות');
        meta.pinned = !!patch.pinned;
      }
      if ('archived' in patch) { meta.archived = !!patch.archived; if (meta.archived) meta.pinned = false; }
      if ('muted' in patch) meta.muted = !!patch.muted;
      if ('markedUnread' in patch) meta.markedUnread = !!patch.markedUnread;
      if ('labels' in patch) {
        const known = new Set(d.settings.labels.map(l => l.id));
        meta.labels = [...new Set((Array.isArray(patch.labels) ? patch.labels : []).map(String))].filter(id => known.has(id));
      }
      if ('note' in patch) meta.note = clean(patch.note, 2000); // הערה פנימית — לא נשלחת
      return copy(meta);
    });
  }
  const meta = (peer) => copy({ labels: [], ...(load().meta[peer] || {}) });
  function setPeerProfile(peer, profile) {
    let p;
    try { p = cleanProfile(profile); } catch { return false; }
    update(d => { metaOf(d, peer).profile = { ...p, receivedAt: clock() }; });
    return true;
  }

  const preview = (m) => (m.deleted ? '🚫 ההודעה נמחקה' : m.att && !m.text ? '📎 ' + m.att.name : String(m.text || '').slice(0, 80));
  // filter: 'all' | 'unread' | 'archived' | 'label:<id>'
  function conversations(contacts, filter = 'all') {
    const d = load();
    const list = contacts.map((c) => {
      const msgs = d.messages.filter(m => m.peer === c.id);
      const last = msgs[msgs.length - 1];
      const mt = { labels: [], ...(d.meta[c.id] || {}) };
      return { ...c, unread: msgs.filter(m => m.dir === 'in' && !m.read).length, markedUnread: !!mt.markedUnread,
        pinned: !!mt.pinned, archived: !!mt.archived, muted: !!mt.muted, labels: mt.labels, hasNote: !!mt.note,
        last: last ? { text: preview(last), at: last.sentAt, dir: last.dir } : null };
    });
    const shown = list.filter((c) => {
      if (filter === 'archived') return c.archived;
      if (c.archived) return false;
      if (filter === 'unread') return c.unread > 0 || c.markedUnread;
      if (String(filter).startsWith('label:')) return c.labels.includes(String(filter).slice(6));
      return true;
    });
    const at = c => (c.last && c.last.at) || 0;
    return shown.sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || at(b) - at(a));
  }
  // ההודעות בשיחה — בלי תוכן הקבצים (נטען בנפרד לפי בקשה), תמונות קטנות מוצגות ישירות
  const stripData = (m) => (m.att && m.att.data && !String(m.att.type).startsWith('image/') ? { ...m, att: { ...m.att, data: null, available: true } }
    : m.att ? { ...m, att: { ...m.att, available: !!m.att.data } } : { ...m });
  const thread = (peer) => load().messages.filter(m => m.peer === peer).sort((a, b) => a.sentAt - b.sentAt).map(stripData);
  function attachment(mid) {
    const m = get(mid);
    if (!m || !m.att || !m.att.data) throw new Error('הקובץ אינו זמין עוד במחשב הזה');
    return { name: m.att.name, type: m.att.type, data: m.att.data };
  }
  function search(q) {
    const s = String(q || '').trim();
    if (!s) return [];
    return load().messages.filter(m => !m.deleted && (String(m.text || '').includes(s) || String(m.subject || '').includes(s) || (m.att && String(m.att.name || '').includes(s))))
      .slice(-100).reverse().map(stripData);
  }
  // מונה כללי (בסרגל): בלי שיחות מושתקות ובארכיון
  function unreadTotal() {
    const d = load();
    const quiet = (p) => d.meta[p] && (d.meta[p].muted || d.meta[p].archived);
    return d.messages.filter(m => m.dir === 'in' && !m.read && !quiet(m.peer)).length;
  }

  // ---------- הגדרות העסק ----------
  const settings = () => copy(load().settings);
  function saveSettings(input) {
    return update((d) => {
      const { settings: s, labelIds } = cleanSettings(input, d.settings);
      d.settings = s;
      // תווית שנמחקה — יורדת מהשיחות
      for (const m of Object.values(d.meta)) m.labels = (m.labels || []).filter(id => labelIds.has(id));
      return copy(s);
    });
  }

  // תשובות אוטומטיות להודעה נכנסת חדשה. לא עונים להודעה אוטומטית (כדי ששתי מערכות לא יענו זו לזו בלולאה)
  function autoReplies(peer, incoming, at = clock()) {
    if (!incoming || incoming.auto) return [];
    return update((d) => {
      const s = d.settings;
      const out = [];
      const meta = metaOf(d, peer);
      const prev = d.messages.filter(m => m.peer === peer && m.mid !== incoming.mid);
      const lastActivity = prev.length ? Math.max(...prev.map(m => m.sentAt || 0)) : 0;
      if (s.greeting.enabled && s.greeting.text && (!lastActivity || at - lastActivity > s.greeting.quietDays * 24 * 3600 * 1000)) {
        out.push({ auto: 'greeting', text: s.greeting.text });
      }
      const closed = s.away.always || !isOpenAt(s.hours, at);
      const lastAway = (meta.lastAuto && meta.lastAuto.away) || 0;
      if (s.away.enabled && s.away.text && closed && at - lastAway > AWAY_REPEAT_MS) {
        out.push({ auto: 'away', text: s.away.text });
        meta.lastAuto = { ...(meta.lastAuto || {}), away: at };
      }
      return out;
    });
  }

  // ---------- גיבוי ושחזור ----------
  // עותק של כל התיבה לגיבוי, או למצב שלפני שחזור (attachmentChars: Infinity — עם כל הקבצים). מה שעוד בזיכרון
  // נכתב קודם (flush), אבל העותק נלקח מהזיכרון — הוא העדכני גם כשהכתיבה נכשלה. תיבה שלא נקראה ← נזרק (chat-unavailable):
  // הגיבוי נכשל במקום להישמר בלי ההודעות
  function exportMailbox({ attachmentChars = Infinity } = {}) {
    const d = load();
    try { flush(); } catch (e) { onError('chat-write', e); }
    let budget = attachmentChars;
    const messages = d.messages.slice();
    for (let i = messages.length - 1; i >= 0; i--) {
      const att = messages[i].att;
      if (!att || typeof att.data !== 'string' || !att.data) continue;
      if (att.data.length <= budget) { budget -= att.data.length; continue; }
      messages[i] = { ...messages[i], att: { ...att, data: null, omitted: true } };
    }
    return copy({ v: 2, messages, meta: d.meta, settings: d.settings });
  }
  // שחזור: data — תיבה שנבדקה (mailboxFromBackup), או עותק של exportMailbox (החזרה למצב שלפני שחזור שנכשל).
  // התיבה מהגיבוי מחליפה את הנוכחית, אבל הודעות שיש רק כאן (התקבלו או נשלחו אחרי הגיבוי) נשמרות: השרת כבר מחק
  // אותן ואין דרך לקבל אותן שוב. כך גם נתוני שיחה של אנשי קשר שאינם בגיבוי. קובץ שתוכנו לא נכלל בגיבוי (omitted) —
  // התוכן מהתיבה הנוכחית, אם הוא עוד בה. except — תיבה שממנה לא שומרים דבר (בהחזרה: מה שהגיע מהגיבוי).
  // המיזוג מול התיבה שבזיכרון ברגע השחזור — הודעה שהתקבלה בין צילום המצב לשחזור לא הולכת לאיבוד.
  // נכתב מיד; כשל בכתיבה נזרק
  function restoreMailbox(data, { except } = {}) {
    if (!isPlain(data) || !Array.isArray(data.messages)) throw backupError();
    const live = load();
    const next = copy({ messages: data.messages, meta: isPlain(data.meta) ? data.meta : {}, settings: isPlain(data.settings) ? data.settings : {} });
    const skipKeys = new Set(except && Array.isArray(except.messages) ? except.messages.map(msgKey) : []);
    const skipPeers = new Set(except && isPlain(except.meta) ? Object.keys(except.meta) : []);
    const liveByKey = new Map(live.messages.map(m => [msgKey(m), m]));
    const messages = next.messages.map((m) => {
      if (!m.att || m.att.data || !m.att.omitted) return m;
      const l = liveByKey.get(msgKey(m));
      if (!l || !l.att || !l.att.data) return m;
      const { omitted, ...att } = m.att;
      return { ...m, att: { ...att, data: l.att.data } };
    });
    const have = new Set(messages.map(msgKey));
    let kept = 0;
    for (const m of live.messages) {
      const k = msgKey(m);
      if (have.has(k) || skipKeys.has(k)) continue;
      have.add(k);
      messages.push(m);
      kept++;
    }
    if (kept) messages.sort((a, b) => orderOf(a) - orderOf(b)); // מיון יציב — הסדר של הגיבוי נשמר
    const settings = { ...DEFAULT_SETTINGS, ...next.settings };
    const labelIds = new Set((Array.isArray(settings.labels) ? settings.labels : []).map(l => l && l.id));
    for (const [peer, mt] of Object.entries(live.meta)) {
      if (peer in next.meta || skipPeers.has(peer) || !isPlain(mt)) continue; // in — גם __proto__ לא נכתב
      next.meta[peer] = { ...mt, labels: (Array.isArray(mt.labels) ? mt.labels : []).filter(id => labelIds.has(id)) };
    }
    cache = { messages, meta: next.meta, settings };
    dirty = true;
    flush();
    return { messages: messages.length, kept };
  }

  return { addOutgoing, addIncoming, setStatus, markRead, get, editOwn, deleteOwnForAll, applyRemoteEdit, applyRemoteDelete, deleteForMe,
    star, starred, setMeta, meta, setPeerProfile, conversations, thread, attachment, search, unreadTotal, settings, saveSettings, autoReplies,
    canEdit, canDeleteForAll, flush, exportMailbox, restoreMailbox };
}

module.exports = { createChatStore, isOpenAt, mailboxFromBackup, BACKUP_ATTACHMENT_CHARS, LABEL_COLORS, EDIT_WINDOW_MS, DELETE_ALL_WINDOW_MS, MAX_PINNED };
