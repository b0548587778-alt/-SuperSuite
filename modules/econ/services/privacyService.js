// Privacy Service — מיפוי מאגרים ומזעור נזקקים לא פעילים (למנהל בלבד). המזעור רץ רק על רשימה שאושרה,
// ונבדק מחדש בשרת: מזהה שאינו עומד בתנאי התקופה ברגע הביצוע — לא ימוזער.
const PR = require('../core/privacy');

class PrivacyService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    if (db) this.db = db;
  }

  async getMap(users) {
    const data = await this.db.load();
    const counts = {};
    for (const u of users || []) if (u.active !== false) counts[u.role] = (counts[u.role] || 0) + 1;
    return { ...PR.dataMap(data, counts), checklist: PR.INCIDENT_CHECKLIST };
  }

  async retentionPreview(years, today) {
    const data = await this.db.load();
    const t = today || new Date().toISOString().slice(0, 10);
    return { cutoff: PR.retentionCutoff(t, years), rows: PR.retentionCandidates(data.chesed || {}, t, years) };
  }

  async minimize(ids, years, today) {
    const data = await this.db.load();
    const t = today || new Date().toISOString().slice(0, 10);
    const allowed = new Set(PR.retentionCandidates(data.chesed || {}, t, years).map(x => x.id));
    const wanted = new Set(Array.isArray(ids) ? ids.map(String) : []);
    if (!wanted.size) throw new Error('לא נבחרו רשומות למזעור');
    const at = new Date().toISOString();
    let done = 0;
    data.chesed.beneficiaries = data.chesed.beneficiaries.map(b => {
      if (!wanted.has(b.id) || !allowed.has(b.id)) return b;
      done += 1;
      return PR.minimize(b, at);
    });
    if (done) await this.db.save(data);
    return { minimized: done, skipped: wanted.size - done };
  }
}

module.exports = { PrivacyService: new PrivacyService() };
