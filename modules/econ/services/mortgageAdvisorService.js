// Mortgage Advisor Service - משרד ייעוץ משכנתאות: תיקים לפי יועץ, צנרת שלבים, הצעות בנקים, השוואה, עמלה ומסמכים.
// נשמר באוסף mortgageAdvisor במסד המרכזי — ולכן נכנס אוטומטית לגיבוי המוצפן הקיים.
// actor = { id, username, isManager } מגיע מה-IPC בכל פעולה. תיק שהמשתמש לא רשאי לראות — "לא נמצא".
const crypto = require('crypto');
const M = require('../core/mortgageAdvisor');

const MAX_CLIENTS = 5000;
const MAX_OFFERS = 20000;
const ADVISOR_ROLES = new Set(['admin', 'editor']);

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
      settings: M.normalizeSettings(ma.settings),
      clients: (Array.isArray(ma.clients) ? ma.clients : []).map(M.clientStored),
      offers: (Array.isArray(ma.offers) ? ma.offers : []).map(M.offerStored)
    };
    return data;
  }

  _vatRate(data) {
    const r = Number(data.settings && data.settings.vatRate);
    return Number.isFinite(r) && r >= 0 && r < 1 ? r : 0.18;
  }

  // יועצים = משתמשים פעילים שיכולים לערוך (מנהל / עורך). בלי מסד משתמשים (בדיקות) — רשימה ריקה
  async _advisors() {
    if (!this.db || typeof this.db.listUsers !== 'function') return [];
    const users = await this.db.listUsers();
    return users.filter(u => u.active && ADVISOR_ROLES.has(u.role)).map(u => ({ id: u.id, name: u.username }));
  }

  _visible(data, actor) {
    const { clients, settings } = data.mortgageAdvisor;
    return clients.filter(c => M.canSee(c, actor, settings));
  }

  _findClient(data, clientId, actor) {
    const c = data.mortgageAdvisor.clients.find(x => x.id === clientId);
    if (!c || !M.canSee(c, actor, data.mortgageAdvisor.settings)) throw new Error('התיק לא נמצא');
    return c;
  }

  async getOverview(actor) {
    const data = await this._load();
    const { offers, settings } = data.mortgageAdvisor;
    const clients = this._visible(data, actor);
    const vat = this._vatRate(data);
    const advisors = await this._advisors();
    const nameOf = (id) => (advisors.find(a => a.id === id) || {}).name || 'יועץ שאינו פעיל';
    return {
      me: actor ? { id: actor.id, isManager: !!actor.isManager } : { id: null, isManager: true },
      settings,
      advisors,
      board: M.pipelineBoard(clients, { settings, advisorName: nameOf }),
      clients: clients.map(c => {
        const own = offers.filter(o => o.clientId === c.id);
        return {
          ...M.clientView(c),
          advisorName: c.advisorId ? nameOf(c.advisorId) : '',
          daysInStage: M.daysInStage(c, Date.now()),
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

  async createClient(input, actor) {
    const data = await this._load();
    if (data.mortgageAdvisor.clients.length >= MAX_CLIENTS) throw new Error('הגעת למספר המקסימלי של תיקים');
    const ids = (await this._advisors()).map(a => a.id);
    // תיק חדש של יועץ — משויך אליו. מנהל בוחר (ברירת מחדל: עצמו)
    const requested = input && input.advisorId !== undefined && input.advisorId !== '' ? input.advisorId : (actor ? actor.id : '');
    const advisorId = M.resolveAdvisor(requested, '', actor, ids.concat(actor && actor.id ? [actor.id] : []));
    const now = new Date().toISOString();
    const base = { id: crypto.randomUUID(), ...M.validateClient(input), advisorId, docs: [], createdAt: now };
    const client = M.withStage({}, base, actor, now);
    data.mortgageAdvisor.clients.push(client);
    await this.db.save(data);
    return M.clientView(client);
  }

  // הקלט מהמסך בשקלים, ולכן ממזגים אותו עם התצוגה של הרשומה (לא עם הצורה השמורה)
  async updateClient(clientId, input, actor) {
    const data = await this._load();
    const cur = this._findClient(data, clientId, actor);
    const i = data.mortgageAdvisor.clients.indexOf(cur);
    const ids = (await this._advisors()).map(a => a.id);
    const advisorId = M.resolveAdvisor(input ? input.advisorId : undefined, cur.advisorId || '', actor, ids);
    const now = new Date().toISOString();
    const next = M.clientStored({ ...cur, ...M.validateClient({ ...M.clientView(cur), ...input }), advisorId, updatedAt: now });
    data.mortgageAdvisor.clients[i] = M.withStage(cur, next, actor, now);
    await this.db.save(data);
    return M.clientView(data.mortgageAdvisor.clients[i]);
  }

  // מחיקת תיק מוחקת גם את ההצעות שלו — אחרת נשארות הצעות יתומות שאינן מוצגות בשום מקום
  async deleteClient(clientId, actor) {
    const data = await this._load();
    this._findClient(data, clientId, actor);
    data.mortgageAdvisor.clients = data.mortgageAdvisor.clients.filter(c => c.id !== clientId);
    data.mortgageAdvisor.offers = data.mortgageAdvisor.offers.filter(o => o.clientId !== clientId);
    await this.db.save(data);
    return true;
  }

  async toggleDoc(clientId, key, actor) {
    const data = await this._load();
    const c = this._findClient(data, clientId, actor);
    c.docs = M.toggleDoc(c, key);
    c.updatedAt = new Date().toISOString();
    await this.db.save(data);
    return M.docsProgress(c);
  }

  async addOffer(input, actor) {
    const data = await this._load();
    if (data.mortgageAdvisor.offers.length >= MAX_OFFERS) throw new Error('הגעת למספר המקסימלי של הצעות');
    const offer = { id: crypto.randomUUID(), ...M.validateOffer(input, this._visible(data, actor)), createdAt: new Date().toISOString() };
    data.mortgageAdvisor.offers.push(offer);
    await this.db.save(data);
    return { ...offer, summary: M.offerSummary(offer) };
  }

  _findOffer(data, offerId, actor) {
    const o = data.mortgageAdvisor.offers.find(x => x.id === offerId);
    const c = o && data.mortgageAdvisor.clients.find(x => x.id === o.clientId);
    if (!o || (c && !M.canSee(c, actor, data.mortgageAdvisor.settings))) throw new Error('ההצעה לא נמצאה');
    return { o, c };
  }

  async deleteOffer(offerId, actor) {
    const data = await this._load();
    this._findOffer(data, offerId, actor);
    data.mortgageAdvisor.offers = data.mortgageAdvisor.offers.filter(o => o.id !== offerId);
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

  async getScheduleExport(offerId, actor) {
    const data = await this._load();
    const { o, c } = this._findOffer(data, offerId, actor);
    return M.scheduleTable(o, c && c.name);
  }

  // הגדרות המשרד (מנהל בלבד — נאכף ב-permissionFor)
  async saveSettings(input) {
    const data = await this._load();
    data.mortgageAdvisor.settings = M.normalizeSettings({ ...data.mortgageAdvisor.settings, ...(input || {}) });
    await this.db.save(data);
    return data.mortgageAdvisor.settings;
  }
}

module.exports = { MortgageAdvisorService: new MortgageAdvisorService() };
