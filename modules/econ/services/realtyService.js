// Realty Service - נדל"ן ותיווך: נכסים, לקוחות, התאמה ועסקאות.
// נשמר באוסף realty במסד המרכזי — ולכן נכנס אוטומטית לגיבוי המוצפן ולהצפנת המסד.
// הרישוי: תחילית הערוצים rlty ← econ.realty (shell/licensing/gate.js).
const crypto = require('crypto');
const R = require('../core/realty');

class RealtyService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    if (db) this.db = db;
  }

  async _load() {
    const data = await this.db.load();
    const r = data.realty && typeof data.realty === 'object' ? data.realty : {};
    data.realty = {
      ...r,
      properties: Array.isArray(r.properties) ? r.properties : [],
      clients: Array.isArray(r.clients) ? r.clients : [],
      deals: Array.isArray(r.deals) ? r.deals : []
    };
    return data;
  }

  _find(list, id, label) {
    const x = list.find(i => i.id === id);
    if (!x) throw new Error(`${label} לא נמצא`);
    return x;
  }

  async getOverview(today) {
    const data = await this._load();
    const { properties, clients, deals } = data.realty;
    const ctx = { properties, clients };
    const t = today || new Date().toISOString().slice(0, 10);
    return {
      propertyTypes: R.PROPERTY_TYPES, listings: R.LISTING, propertyStatuses: R.PROPERTY_STATUS,
      clientRoles: R.CLIENT_ROLES, dealStages: R.DEAL_STAGES,
      properties: properties.map(p => ({ ...R.propertyView(p), matchCount: R.matchesForProperty(p, clients).length })),
      clients: clients.map(c => ({ ...R.clientView(c), matchCount: R.SEEKERS.has(c.role) ? R.matchesForClient(c, properties).length : 0 })),
      deals: deals.map(d => R.dealView(d, ctx)),
      board: R.dealBoard(deals, ctx),
      upcoming: R.upcoming(deals, t)
    };
  }

  // ---------- נכסים ----------
  async createProperty(input) {
    const data = await this._load();
    const list = data.realty.properties;
    if (list.length >= R.MAX_PROPERTIES) throw new Error('הגעת למספר המקסימלי של נכסים');
    const p = R.validateProperty(input);
    this._checkOwner(data, p);
    const now = new Date().toISOString();
    const rec = { id: crypto.randomUUID(), ...p, createdAt: now, updatedAt: now };
    list.push(rec);
    await this.db.save(data);
    return R.propertyView(rec);
  }

  _checkOwner(data, p) {
    if (!p.ownerClientId) return;
    const c = data.realty.clients.find(x => x.id === p.ownerClientId);
    if (!c) throw new Error('הבעלים שנבחר אינו ברשימת הלקוחות');
  }

  async updateProperty(id, input) {
    const data = await this._load();
    const list = data.realty.properties;
    const i = list.findIndex(p => p.id === id);
    if (i < 0) throw new Error('הנכס לא נמצא');
    const p = R.validateProperty(input, list[i]);
    this._checkOwner(data, p);
    list[i] = { ...list[i], ...p, updatedAt: new Date().toISOString() };
    await this.db.save(data);
    return R.propertyView(list[i]);
  }

  // נכס עם עסקה לא נמחק — מסמנים "הוסר"
  async deleteProperty(id) {
    const data = await this._load();
    this._find(data.realty.properties, id, 'הנכס');
    if (data.realty.deals.some(d => d.propertyId === id)) throw new Error('לנכס יש עסקאות — אפשר לסמן אותו "הוסר" במקום למחוק');
    data.realty.properties = data.realty.properties.filter(p => p.id !== id);
    await this.db.save(data);
    return true;
  }

  // ---------- לקוחות ----------
  async createClient(input) {
    const data = await this._load();
    const list = data.realty.clients;
    if (list.length >= R.MAX_CLIENTS) throw new Error('הגעת למספר המקסימלי של לקוחות');
    const now = new Date().toISOString();
    const rec = { id: crypto.randomUUID(), ...R.validateClient(input), createdAt: now, updatedAt: now };
    list.push(rec);
    await this.db.save(data);
    return R.clientView(rec);
  }

  async updateClient(id, input) {
    const data = await this._load();
    const list = data.realty.clients;
    const i = list.findIndex(c => c.id === id);
    if (i < 0) throw new Error('הלקוח לא נמצא');
    const next = R.validateClient(input, list[i]);
    // שינוי תפקיד ממחפש — הדרישות הישנות לא נשארות ברשומה
    const base = R.SEEKERS.has(next.role) ? list[i] : Object.fromEntries(Object.entries(list[i]).filter(([k]) => !['areas', 'types', 'minRooms', 'maxRooms', 'budgetMinAg', 'budgetMaxAg', 'needsMortgage'].includes(k)));
    list[i] = { ...base, ...next, updatedAt: new Date().toISOString() };
    await this.db.save(data);
    return R.clientView(list[i]);
  }

  // לקוח שקשור לעסקה או בעלים של נכס — לא נמחק (המזעור בכלי הפרטיות מוחק את פרטי הקשר)
  async deleteClient(id) {
    const data = await this._load();
    this._find(data.realty.clients, id, 'הלקוח');
    if (data.realty.deals.some(d => d.buyerClientId === id || d.sellerClientId === id)) throw new Error('ללקוח יש עסקאות — אי אפשר למחוק אותו');
    if (data.realty.properties.some(p => p.ownerClientId === id)) throw new Error('הלקוח רשום כבעלים של נכס — יש להסיר את השיוך קודם');
    data.realty.clients = data.realty.clients.filter(c => c.id !== id);
    await this.db.save(data);
    return true;
  }

  // ---------- התאמה ----------
  async getMatches(kind, id, minScore) {
    const data = await this._load();
    const { properties, clients } = data.realty;
    const ms = Number.isFinite(Number(minScore)) ? Math.min(100, Math.max(0, Number(minScore))) : 50;
    if (kind === 'client') {
      const c = this._find(clients, id, 'הלקוח');
      return R.matchesForClient(c, properties, { minScore: ms }).map(x => ({ property: R.propertyView(x.property), ...x.m }));
    }
    const p = this._find(properties, id, 'הנכס');
    return R.matchesForProperty(p, clients, { minScore: ms }).map(x => ({ client: { id: x.client.id, name: x.client.name, phone: x.client.phone, roleLabel: R.CLIENT_ROLES[x.client.role] }, ...x.m }));
  }

  // ---------- עסקאות ----------
  async createDeal(input, actorId) {
    const data = await this._load();
    const { properties, clients, deals } = data.realty;
    if (deals.length >= R.MAX_DEALS) throw new Error('הגעת למספר המקסימלי של עסקאות');
    const now = new Date().toISOString();
    const d = R.withDealStage({}, R.validateDeal(input, {}, { properties, clients }), actorId, now);
    const rec = { id: crypto.randomUUID(), ...d, createdAt: now, updatedAt: now };
    deals.push(rec);
    this._syncProperty(data, rec);
    await this.db.save(data);
    return R.dealView(rec, { properties, clients });
  }

  async updateDeal(id, input, actorId) {
    const data = await this._load();
    const { properties, clients, deals } = data.realty;
    const i = deals.findIndex(d => d.id === id);
    if (i < 0) throw new Error('העסקה לא נמצאה');
    const now = new Date().toISOString();
    const next = R.withDealStage(deals[i], R.validateDeal(input, deals[i], { properties, clients }), actorId, now);
    deals[i] = { ...deals[i], ...next, updatedAt: now };
    this._syncProperty(data, deals[i]);
    await this.db.save(data);
    return R.dealView(deals[i], { properties, clients });
  }

  _syncProperty(data, deal) {
    const p = data.realty.properties.find(x => x.id === deal.propertyId);
    if (!p) return;
    const status = R.propertyStatusAfter(deal, p);
    if (status !== p.status) { p.status = status; p.updatedAt = new Date().toISOString(); }
  }

  async deleteDeal(id) {
    const data = await this._load();
    this._find(data.realty.deals, id, 'העסקה');
    data.realty.deals = data.realty.deals.filter(d => d.id !== id);
    await this.db.save(data);
    return true;
  }
}

module.exports = { RealtyService: new RealtyService() };
