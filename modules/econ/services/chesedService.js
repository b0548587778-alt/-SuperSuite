// Chesed Service — חסד וחלוקות: נזקקים, מתנדבים וסבבי חלוקה.
// נשמר באוסף chesed במסד המרכזי — ולכן נכנס אוטומטית לגיבוי המוצפן הקיים.
// פרטי נזקק חסוי מוסתרים בשכבה הזו (לא רק במסך) למי שאינו מורשה לראותם.
const crypto = require('crypto');
const C = require('../core/chesed');

class ChesedService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    if (db) this.db = db;
  }

  async _load() {
    const data = await this.db.load();
    const c = data.chesed && typeof data.chesed === 'object' ? data.chesed : {};
    data.chesed = {
      beneficiaries: Array.isArray(c.beneficiaries) ? c.beneficiaries : [],
      volunteers: Array.isArray(c.volunteers) ? c.volunteers : [],
      rounds: Array.isArray(c.rounds) ? c.rounds : []
    };
    return data;
  }

  _round(data, roundId) {
    const i = data.chesed.rounds.findIndex(r => r.id === roundId);
    if (i < 0) throw new Error('סבב החלוקה לא נמצא');
    return i;
  }

  async getOverview(canSeeConfidential) {
    const { chesed } = await this._load();
    return {
      canSeeConfidential: !!canSeeConfidential,
      beneficiaries: chesed.beneficiaries
        .map(b => C.maskBeneficiary(b, canSeeConfidential))
        .sort((a, b) => (b.active !== false) - (a.active !== false) || a.familyName.localeCompare(b.familyName, 'he')),
      volunteers: [...chesed.volunteers].sort((a, b) => (b.active !== false) - (a.active !== false) || a.name.localeCompare(b.name, 'he')),
      rounds: [...chesed.rounds]
        .sort((a, b) => (a.status === 'closed') - (b.status === 'closed') || b.date.localeCompare(a.date))
        .map(r => ({ ...r, summary: C.roundSummary(r) }))
    };
  }

  async addBeneficiary(input, canSeeConfidential) {
    const data = await this._load();
    if (data.chesed.beneficiaries.length >= C.MAX_BENEFICIARIES) throw new Error('הגעת למספר המקסימלי של נזקקים');
    const clean = C.validateBeneficiary(input);
    if (clean.idNumber && data.chesed.beneficiaries.some(b => b.idNumber === clean.idNumber)) throw new Error('כבר קיים נזקק עם מספר זהות זה');
    const b = { id: crypto.randomUUID(), ...clean, createdAt: new Date().toISOString() };
    data.chesed.beneficiaries.push(b);
    await this.db.save(data);
    return C.maskBeneficiary(b, canSeeConfidential);
  }

  // עדכון נזקק חסוי — רק למורשה: מי שרואה פרטים מוסתרים לא יכול לדרוס אותם בשדות ריקים
  async updateBeneficiary(id, input, canSeeConfidential) {
    const data = await this._load();
    const i = data.chesed.beneficiaries.findIndex(b => b.id === id);
    if (i < 0) throw new Error('הנזקק לא נמצא');
    const cur = data.chesed.beneficiaries[i];
    if (cur.tier === 'confidential' && !canSeeConfidential) throw new Error('אין הרשאה לערוך נזקק חסוי');
    const clean = C.validateBeneficiary({ ...cur, ...input }, cur);
    if (clean.idNumber && data.chesed.beneficiaries.some(b => b.id !== id && b.idNumber === clean.idNumber)) throw new Error('כבר קיים נזקק עם מספר זהות זה');
    data.chesed.beneficiaries[i] = { ...cur, ...clean, updatedAt: new Date().toISOString() };
    await this.db.save(data);
    return C.maskBeneficiary(data.chesed.beneficiaries[i], canSeeConfidential);
  }

  // נזקק שכבר שויך לסבב אינו נמחק (ההיסטוריה נשמרת) — מסמנים אותו כלא פעיל
  async deleteBeneficiary(id) {
    const data = await this._load();
    if (!data.chesed.beneficiaries.some(b => b.id === id)) throw new Error('הנזקק לא נמצא');
    if (data.chesed.rounds.some(r => (r.allocations || []).some(a => a.beneficiaryId === id))) {
      throw new Error('הנזקק משויך לסבב חלוקה — במקום מחיקה יש לסמן אותו כלא פעיל');
    }
    data.chesed.beneficiaries = data.chesed.beneficiaries.filter(b => b.id !== id);
    await this.db.save(data);
    return true;
  }

  async addVolunteer(input) {
    const data = await this._load();
    if (data.chesed.volunteers.length >= C.MAX_VOLUNTEERS) throw new Error('הגעת למספר המקסימלי של מתנדבים');
    const v = { id: crypto.randomUUID(), ...C.validateVolunteer(input), createdAt: new Date().toISOString() };
    data.chesed.volunteers.push(v);
    await this.db.save(data);
    return v;
  }

  async updateVolunteer(id, input) {
    const data = await this._load();
    const i = data.chesed.volunteers.findIndex(v => v.id === id);
    if (i < 0) throw new Error('המתנדב לא נמצא');
    data.chesed.volunteers[i] = { ...data.chesed.volunteers[i], ...C.validateVolunteer({ ...data.chesed.volunteers[i], ...input }), updatedAt: new Date().toISOString() };
    await this.db.save(data);
    return data.chesed.volunteers[i];
  }

  async deleteVolunteer(id) {
    const data = await this._load();
    if (!data.chesed.volunteers.some(v => v.id === id)) throw new Error('המתנדב לא נמצא');
    if (data.chesed.rounds.some(r => r.status !== 'closed' && (r.allocations || []).some(a => a.volunteerId === id))) {
      throw new Error('המתנדב משובץ בסבב פתוח — יש לבטל את השיבוץ קודם');
    }
    data.chesed.volunteers = data.chesed.volunteers.filter(v => v.id !== id);
    await this.db.save(data);
    return true;
  }

  async addRound(input) {
    const data = await this._load();
    if (data.chesed.rounds.length >= C.MAX_ROUNDS) throw new Error('הגעת למספר המקסימלי של סבבי חלוקה');
    const r = { id: crypto.randomUUID(), ...C.validateRound(input), status: 'open', allocations: [], createdAt: new Date().toISOString() };
    data.chesed.rounds.push(r);
    await this.db.save(data);
    return r;
  }

  async allocateRound(roundId) {
    const data = await this._load();
    const i = this._round(data, roundId);
    const { round, added } = C.allocate(data.chesed.rounds[i], data.chesed.beneficiaries);
    data.chesed.rounds[i] = round;
    await this.db.save(data);
    return { added, summary: C.roundSummary(round) };
  }

  async assignVolunteer(roundId, beneficiaryId, volunteerId) {
    const data = await this._load();
    const i = this._round(data, roundId);
    let volunteer = null;
    if (volunteerId) {
      volunteer = data.chesed.volunteers.find(v => v.id === volunteerId);
      if (!volunteer) throw new Error('המתנדב לא נמצא');
    }
    data.chesed.rounds[i] = C.assignVolunteer(data.chesed.rounds[i], beneficiaryId, volunteer);
    await this.db.save(data);
    return true;
  }

  async markDelivered(roundId, beneficiaryId, delivered, date) {
    const data = await this._load();
    const i = this._round(data, roundId);
    data.chesed.rounds[i] = C.markDelivered(data.chesed.rounds[i], beneficiaryId, delivered, date);
    await this.db.save(data);
    return C.roundSummary(data.chesed.rounds[i]);
  }

  async closeRound(roundId) {
    const data = await this._load();
    const i = this._round(data, roundId);
    if (data.chesed.rounds[i].status === 'closed') throw new Error('הסבב כבר סגור');
    data.chesed.rounds[i] = { ...data.chesed.rounds[i], status: 'closed', closedAt: new Date().toISOString() };
    await this.db.save(data);
    return data.chesed.rounds[i];
  }

  // סבב שכבר נרשמה בו מסירה אינו נמחק — סוגרים אותו
  async deleteRound(roundId) {
    const data = await this._load();
    const i = this._round(data, roundId);
    if ((data.chesed.rounds[i].allocations || []).some(a => a.delivered)) throw new Error('בסבב נרשמו מסירות — במקום מחיקה יש לסגור אותו');
    data.chesed.rounds.splice(i, 1);
    await this.db.save(data);
    return true;
  }

  async getExportData(kind, canSeeConfidential, roundId) {
    const { chesed } = await this._load();
    return C.exportTable(kind, chesed, canSeeConfidential, roundId);
  }
}

module.exports = { ChesedService: new ChesedService() };
