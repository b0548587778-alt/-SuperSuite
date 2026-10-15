// תיבת ההודעות המקומית של מערכת (או של מנהל-העל): שיחות לפי איש קשר, סטטוס מסירה וקריאה, חיפוש.
// ההודעות נשמרות פתוחות מקומית (כמו שאר נתוני המערכת) ומוצפנות רק בדרך — ראו messages.js.
// אחסון מוזרק: { read(): string|null, write(text) }.
const MAX_STORED = 5000;

function createChatStore({ storage, clock = Date.now }) {
  const load = () => { try { const t = storage.read(); const d = t ? JSON.parse(t) : null; return Array.isArray(d) ? d : []; } catch { return []; } };
  const save = (list) => storage.write(JSON.stringify(list.slice(-MAX_STORED)));

  function addOutgoing({ mid, peer, subject, text, sentAt }) {
    save([...load(), { mid, peer, dir: 'out', subject, text, sentAt, status: 'sent' }]);
  }
  // הודעה נכנסת — פעם אחת בלבד לכל מזהה
  function addIncoming({ mid, peer, subject, text, sentAt }) {
    const list = load();
    if (list.some(m => m.mid === mid && m.dir === 'in')) return false;
    save([...list, { mid, peer, dir: 'in', subject, text, sentAt, receivedAt: clock(), read: false }]);
    return true;
  }
  function setStatus(mids, status) {
    const set = new Set(mids);
    save(load().map(m => (m.dir === 'out' && set.has(m.mid) && m.status !== 'read' ? { ...m, status } : m)));
  }
  // סימון כנקרא — מחזיר את מזהי ההודעות כדי לשלוח אישור קריאה לשולח
  function markRead(peer) {
    const ids = [];
    save(load().map(m => { if (m.dir === 'in' && m.peer === peer && !m.read) { ids.push(m.mid); return { ...m, read: true }; } return m; }));
    return ids;
  }

  function conversations(contacts) {
    const list = load();
    return contacts.map(c => {
      const msgs = list.filter(m => m.peer === c.id);
      const last = msgs[msgs.length - 1];
      return { ...c, unread: msgs.filter(m => m.dir === 'in' && !m.read).length,
        last: last ? { text: last.text.slice(0, 80), at: last.sentAt, dir: last.dir } : null };
    }).sort((a, b) => ((b.last && b.last.at) || 0) - ((a.last && a.last.at) || 0));
  }
  const thread = (peer) => load().filter(m => m.peer === peer).sort((a, b) => a.sentAt - b.sentAt);
  function search(q) {
    const s = String(q || '').trim();
    if (!s) return [];
    return load().filter(m => m.text.includes(s) || (m.subject || '').includes(s)).slice(-100).reverse();
  }
  const unreadTotal = () => load().filter(m => m.dir === 'in' && !m.read).length;

  return { addOutgoing, addIncoming, setStatus, markRead, conversations, thread, search, unreadTotal };
}

module.exports = { createChatStore };
