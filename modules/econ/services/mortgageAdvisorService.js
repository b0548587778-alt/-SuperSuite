// Mortgage Advisor Service - תיקי לקוחות, הצעות בנקים, השוואה, עמלת ייעוץ ומסמכים.
// נשמר באוסף mortgageAdvisor במסד המרכזי — ולכן נכנס אוטומטית לגיבוי המוצפן הקיים.
const crypto = require('crypto');
const M = require('../core/mortgageAdvisor');

const MAX_CLIENTS = 5000;
const MAX_OFFERS = 20000;

class MortgageAdvisorService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    if (db) this.db = db;
  }

  async _load() {
    const data = await this.db.load();
    const ma = data.mortgageAdvisor && typeof data.mortgageAdvisor === 'object' ? data.mortgageAdvisor : {};
    // רשומות ישנות בשקלים מומרות לאגורות כאן, ונשמרות כך בשמירה הבאה
    data.mortgageAdvisor = {
      ...ma,
      clients: (Array.isArray(ma.clients) ? ma.clients : []).map(M.clientStored),
      offers: (Array.isArray(ma.offers) ? ma.offers : []).map(M.offerStored)
    };
    return data;
  }

  _vatRate(data) {
    const r = Number(data.settings && data.settings.vatRate);
    return Number.isFinite(r) && r >= 0 && r < 1 ? r : 0.18;
  }

  async getOverview() {
    const data = await this._load();
    const { clients, offers } = data.mortgageAdvisor;
    const vat = this._vatRate(data);
    return {
      clients: clients.map(c => {
        const own = offers.filter(o => o.clientId === c.id);
        return {
          ...M.clientView(c),
          ltv: M.ltv(c),
          fee: M.advisoryFee(c, vat),
          docs: M.docsProgress(c),
          offers: own.map(o => ({ ...o, summary: M.offerSummary(o), yearly: M.yearlySchedule(o) })),
          comparison: M.compareOffers(own)
        };
      }).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))),
      statuses: M.CLIENT_STATUSES,
      tracks: M.TRACKS
    };
  }

  async createClient(input) {
    const data = await this._load();
    if (data.mortgageAdvisor.clients.length >= MAX_CLIENTS) throw new Error('הגעת למספר המקסימלי של תיקים');
    const client = { id: crypto.randomUUID(), ...M.validateClient(input), docs: [], createdAt: new Date().toISOString() };
    data.mortgageAdvisor.clients.push(client);
    await this.db.save(data);
    return M.clientView(client);
  }

  // הקלט מהמסך בשקלים, ולכן ממזגים אותו עם התצוגה של הרשומה (לא עם הצורה השמורה)
  async updateClient(clientId, input) {
    const data = await this._load();
    const i = data.mortgageAdvisor.clients.findIndex(c => c.id === clientId);
    if (i < 0) throw new Error('התיק לא נמצא');
    const cur = data.mortgageAdvisor.clients[i];
    data.mortgageAdvisor.clients[i] = M.clientStored({ ...cur, ...M.validateClient({ ...M.clientView(cur), ...input }), updatedAt: new Date().toISOString() });
    await this.db.save(data);
    return M.clientView(data.mortgageAdvisor.clients[i]);
  }

  // מחיקת תיק מוחקת גם את ההצעות שלו — אחרת נשארות הצעות יתומות שאינן מוצגות בשום מקום
  async deleteClient(clientId) {
    const data = await this._load();
    const before = data.mortgageAdvisor.clients.length;
    data.mortgageAdvisor.clients = data.mortgageAdvisor.clients.filter(c => c.id !== clientId);
    if (data.mortgageAdvisor.clients.length === before) throw new Error('התיק לא נמצא');
    data.mortgageAdvisor.offers = data.mortgageAdvisor.offers.filter(o => o.clientId !== clientId);
    await this.db.save(data);
    return true;
  }

  async toggleDoc(clientId, key) {
    const data = await this._load();
    const c = data.mortgageAdvisor.clients.find(x => x.id === clientId);
    if (!c) throw new Error('התיק לא נמצא');
    c.docs = M.toggleDoc(c, key);
    c.updatedAt = new Date().toISOString();
    await this.db.save(data);
    return M.docsProgress(c);
  }

  async addOffer(input) {
    const data = await this._load();
    if (data.mortgageAdvisor.offers.length >= MAX_OFFERS) throw new Error('הגעת למספר המקסימלי של הצעות');
    const offer = { id: crypto.randomUUID(), ...M.validateOffer(input, data.mortgageAdvisor.clients), createdAt: new Date().toISOString() };
    data.mortgageAdvisor.offers.push(offer);
    await this.db.save(data);
    return { ...offer, summary: M.offerSummary(offer) };
  }

  async deleteOffer(offerId) {
    const data = await this._load();
    const before = data.mortgageAdvisor.offers.length;
    data.mortgageAdvisor.offers = data.mortgageAdvisor.offers.filter(o => o.id !== offerId);
    if (data.mortgageAdvisor.offers.length === before) throw new Error('ההצעה לא נמצאה');
    await this.db.save(data);
    return true;
  }

  // מחשבון בלי שמירה: מסלולים → סיכום ולוח שנתי
  async calcTracks(input) {
    const tracks = (Array.isArray(input && input.tracks) ? input.tracks : M.tracksFromForm(input || {})).map(M.validateTrack);
    if (tracks.length === 0) throw new Error('יש להזין לפחות מסלול אחד');
    const offer = { tracks, cpi: Number(input.cpi) || 0 };
    return { summary: M.offerSummary(offer), yearly: M.yearlySchedule(offer) };
  }

  async getScheduleExport(offerId) {
    const { mortgageAdvisor } = await this._load();
    const o = mortgageAdvisor.offers.find(x => x.id === offerId);
    if (!o) throw new Error('ההצעה לא נמצאה');
    const c = mortgageAdvisor.clients.find(x => x.id === o.clientId);
    return M.scheduleTable(o, c && c.name);
  }
}

module.exports = { MortgageAdvisorService: new MortgageAdvisorService() };
