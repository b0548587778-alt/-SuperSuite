// תיבת ההודעות המקומית של מערכת (או של מנהל-העל): שיחות לפי איש קשר, סטטוס מסירה וקריאה, חיפוש,
// וכלי עסק בסגנון "וואטסאפ ביזנס": תגובה לציטוט, עריכה ומחיקה, כוכב, נעיצה/ארכיון/השתקה, תוויות והערות פנימיות,
// פרופיל עסקי, תשובות מהירות, הודעת פתיחה והודעת היעדרות, רשימות תפוצה וקבצים מצורפים.
// ההודעות נשמרות פתוחות מקומית (כמו שאר נתוני המערכת) ומוצפנות רק בדרך — ראו messages.js.
// אחסון מוזרק: { read(): string|null, write(text) }. פורמט ישן (מערך הודעות) נקרא כמו שהוא.
const MAX_STORED = 5000;
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

function createChatStore({ storage, clock = Date.now, maxAttachmentBytes = 40 * 1024 * 1024 }) {
  function load() {
    let d = null;
    try { const t = storage.read(); d = t ? JSON.parse(t) : null; } catch { d = null; }
    if (Array.isArray(d)) d = { messages: d }; // פורמט ישן
    d = d && typeof d === 'object' ? d : {};
    return { messages: Array.isArray(d.messages) ? d.messages : [], meta: d.meta && typeof d.meta === 'object' ? d.meta : {},
      settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) } };
  }
  // קבצים מצורפים ישנים נמחקים מהמחשב כשעוברים את התקרה (ההודעה עצמה נשארת)
  function save(d) {
    const messages = d.messages.slice(-MAX_STORED);
    let total = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const att = messages[i].att;
      if (!att || !att.data) continue;
      total += att.data.length;
      if (total > maxAttachmentBytes) messages[i] = { ...messages[i], att: { ...att, data: null, expired: true } };
    }
    storage.write(JSON.stringify({ v: 2, messages, meta: d.meta, settings: d.settings }));
  }
  const update = (fn) => { const d = load(); const r = fn(d); save(d); return r; };
  const metaOf = (d, peer) => (d.meta[peer] = { labels: [], ...(d.meta[peer] || {}) });

  const pick = (m) => {
    const o = { mid: m.mid, peer: m.peer, subject: m.subject || '', text: m.text || '', sentAt: m.sentAt };
    if (m.replyTo) o.replyTo = m.replyTo;
    if (m.forwarded) o.forwarded = true;
    if (m.auto) o.auto = m.auto;
    if (m.bc) o.bc = m.bc;
    if (m.att) o.att = { name: m.att.name, type: m.att.type, size: m.att.size, data: m.att.data };
    return o;
  };
  function addOutgoing(m) {
    update(d => { d.messages.push({ ...pick(m), dir: 'out', status: 'sent' }); });
  }
  // הודעה נכנסת — פעם אחת בלבד לכל מזהה
  function addIncoming(m) {
    return update((d) => {
      if (d.messages.some(x => x.mid === m.mid && x.dir === 'in')) return false;
      d.messages.push({ ...pick(m), dir: 'in', receivedAt: clock(), read: false });
      if (d.meta[m.peer] && d.meta[m.peer].archived && !d.meta[m.peer].muted) d.meta[m.peer].archived = false; // הודעה חדשה מוציאה מהארכיון
      return true;
    });
  }
  function setStatus(mids, status) {
    const set = new Set(mids);
    update(d => { d.messages = d.messages.map(m => (m.dir === 'out' && set.has(m.mid) && m.status !== 'read' ? { ...m, status } : m)); });
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
  const get = (mid) => load().messages.find(m => m.mid === mid) || null;

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
  // עריכה/מחיקה שהגיעה מאיש הקשר: רק להודעה שהוא עצמו שלח, ועריכה רק בחלון הזמן (עם מרווח לשעונים)
  function applyRemoteEdit(peer, target, text, at) {
    return update((d) => {
      const m = d.messages.find(x => x.mid === target && x.dir === 'in' && x.peer === peer);
      if (!m || m.deleted || !(at - m.sentAt <= EDIT_WINDOW_MS + CLOCK_SLACK_MS)) return false;
      const t = clean(text, 4000);
      if (!t) return false;
      m.text = t; m.editedAt = at;
      return true;
    });
  }
  function applyRemoteDelete(peer, target) {
    return update((d) => {
      const m = d.messages.find(x => x.mid === target && x.dir === 'in' && x.peer === peer);
      if (!m || m.deleted) return false;
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
      return { ...meta };
    });
  }
  const meta = (peer) => ({ labels: [], ...(load().meta[peer] || {}) });
  function setPeerProfile(peer, profile) {
    let p;
    try { p = cleanProfile(profile); } catch { return false; }
    update(d => { metaOf(d, peer).profile = { ...p, receivedAt: clock() }; });
    return true;
  }

  const preview = (m) => (m.deleted ? '🚫 ההודעה נמחקה' : m.att && !m.text ? '📎 ' + m.att.name : (m.text || '').slice(0, 80));
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
    : m.att ? { ...m, att: { ...m.att, available: !!m.att.data } } : m);
  const thread = (peer) => load().messages.filter(m => m.peer === peer).sort((a, b) => a.sentAt - b.sentAt).map(stripData);
  function attachment(mid) {
    const m = get(mid);
    if (!m || !m.att || !m.att.data) throw new Error('הקובץ אינו זמין עוד במחשב הזה');
    return { name: m.att.name, type: m.att.type, data: m.att.data };
  }
  function search(q) {
    const s = String(q || '').trim();
    if (!s) return [];
    return load().messages.filter(m => !m.deleted && ((m.text || '').includes(s) || (m.subject || '').includes(s) || (m.att && m.att.name.includes(s))))
      .slice(-100).reverse().map(stripData);
  }
  // מונה כללי (בסרגל): בלי שיחות מושתקות ובארכיון
  function unreadTotal() {
    const d = load();
    const quiet = (p) => d.meta[p] && (d.meta[p].muted || d.meta[p].archived);
    return d.messages.filter(m => m.dir === 'in' && !m.read && !quiet(m.peer)).length;
  }

  // ---------- הגדרות העסק ----------
  const settings = () => load().settings;
  function saveSettings(input) {
    return update((d) => {
      const { settings: s, labelIds } = cleanSettings(input, d.settings);
      d.settings = s;
      // תווית שנמחקה — יורדת מהשיחות
      for (const m of Object.values(d.meta)) m.labels = (m.labels || []).filter(id => labelIds.has(id));
      return s;
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

  return { addOutgoing, addIncoming, setStatus, markRead, get, editOwn, deleteOwnForAll, applyRemoteEdit, applyRemoteDelete, deleteForMe,
    star, starred, setMeta, meta, setPeerProfile, conversations, thread, attachment, search, unreadTotal, settings, saveSettings, autoReplies,
    canEdit, canDeleteForAll };
}

module.exports = { createChatStore, isOpenAt, LABEL_COLORS, EDIT_WINDOW_MS, DELETE_ALL_WINDOW_MS, MAX_PINNED };
