// Realty Service - נדל"ן ותיווך: נכסים, לקוחות, התאמה ועסקאות.
// נשמר באוסף realty במסד המרכזי — ולכן נכנס אוטומטית לגיבוי המוצפן ולהצפנת המסד.
// הרישוי: תחילית הערוצים rlty ← econ.realty (shell/licensing/gate.js).
const crypto = require('crypto');
const R = require('../core/realty');
const B = require('../core/brokerage');

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
      deals: Array.isArray(r.deals) ? r.deals : [],
      orders: Array.isArray(r.orders) ? r.orders : [],
      settings: B.normalizeSettings(r.settings)
    };
    return data;
  }

  _find(list, id, label) {
    const x = list.find(i => i.id === id);
    if (!x) throw new Error(`${label} לא נמצא`);
    return x;
  }

  _vatRate(data) {
    const r = Number(data.settings && data.settings.vatRate);
    return Number.isFinite(r) && r >= 0 && r < 1 ? r : 0.18;
  }

  // עסקה לתצוגה: בלי שדות האגורות הפנימיים של העמלה, עם מצב גבייה בשקלים
  _dealOut(data, d, ctx) {
    const { commissions, commissionPayments, ...rest } = d;
    const st = B.commissionStatus(d, this._vatRate(data), data.realty.settings.vatExempt);
    return {
      ...R.dealView(rest, ctx),
      commission: { ...st, sides: st.sides.map(s => ({ side: s.side, label: s.label, feeText: s.feeText, state: s.state, total: s.total, paid: s.paid, balance: s.balance })) },
      commissionFees: Object.fromEntries(Object.entries(commissions || {}).map(([k, f]) => [k, { type: f.type, value: f.type === 'percent' ? f.bp / 100 : f.fixedAg / 100 }])),
      commissionPayments: (commissionPayments || []).map(p => ({ id: p.id, side: p.side, date: p.date, amount: p.amountAg / 100, method: p.method, note: p.note, invoiceNumber: p.invoiceNumber || null }))
    };
  }

  async getOverview(today) {
    const data = await this._load();
    const { properties, clients, deals, orders, settings } = data.realty;
    const ctx = { properties, clients, settings };
    const t = today || new Date().toISOString().slice(0, 10);
    const outDeals = deals.map(d => this._dealOut(data, d, ctx));
    const open = outDeals.filter(d => d.stage !== 'lost');
    return {
      propertyTypes: R.PROPERTY_TYPES, listings: R.LISTING, propertyStatuses: R.PROPERTY_STATUS,
      clientRoles: R.CLIENT_ROLES, dealStages: R.DEAL_STAGES,
      sides: B.SIDES, feeTypes: B.FEE_TYPES, payMethods: B.METHODS, payStates: B.PAY_STATES, transactions: B.TRANSACTIONS,
      settings, unverified: B.UNVERIFIED,
      properties: properties.map(p => ({ ...R.propertyView(p), matchCount: R.matchesForProperty(p, clients).length })),
      clients: clients.map(c => ({ ...R.clientView(c), matchCount: R.SEEKERS.has(c.role) ? R.matchesForClient(c, properties).length : 0 })),
      deals: outDeals,
      board: R.dealBoard(deals, ctx),
      upcoming: R.upcoming(deals, t),
      orders: orders.map(o => B.orderView(o, ctx)),
      // סיכום עמלות: בעסקאות שלא בוטלו
      commissionTotals: { total: open.reduce((s, d) => s + d.commission.total, 0), paid: open.reduce((s, d) => s + d.commission.paid, 0), balance: open.reduce((s, d) => s + d.commission.balance, 0) }
    };
  }

  // ---------- עמלות תיווך ----------
  async setCommissions(dealId, input) {
    const data = await this._load();
    const d = this._find(data.realty.deals, dealId, 'העסקה');
    const fees = {};
    for (const side of Object.keys(B.SIDES)) {
      const f = B.validateFee(input && input[side]);
      if (f) fees[side] = f;
    }
    const paidSides = new Set((d.commissionPayments || []).map(p => p.side));
    for (const s of paidSides) if (!fees[s]) throw new Error(`התקבלו תשלומים מצד ה${B.SIDES[s]} — אי אפשר לבטל את העמלה שלו`);
    d.commissions = fees;
    d.updatedAt = new Date().toISOString();
    await this.db.save(data);
    return this._dealOut(data, d, { properties: data.realty.properties, clients: data.realty.clients });
  }

  async addCommissionPayment(dealId, input, actorId) {
    const data = await this._load();
    const d = this._find(data.realty.deals, dealId, 'העסקה');
    const list = Array.isArray(d.commissionPayments) ? d.commissionPayments : [];
    if (list.length >= B.MAX_PAYMENTS) throw new Error('הגעת למספר המקסימלי של תשלומים בעסקה');
    const p = { id: crypto.randomUUID(), ...B.validatePayment(input, Object.keys(d.commissions || {})), by: actorId || null, createdAt: new Date().toISOString() };
    d.commissionPayments = [...list, p];
    d.updatedAt = p.createdAt;
    await this.db.save(data);
    return { payment: p, deal: this._dealOut(data, d, { properties: data.realty.properties, clients: data.realty.clients }) };
  }

  async deleteCommissionPayment(dealId, paymentId) {
    const data = await this._load();
    const d = this._find(data.realty.deals, dealId, 'העסקה');
    const p = (d.commissionPayments || []).find(x => x.id === paymentId);
    if (!p) throw new Error('התשלום לא נמצא');
    if (p.invoiceId) throw new Error(`הופקה חשבונית לתשלום הזה (מספר ${p.invoiceNumber}) — אי אפשר למחוק אותו`);
    d.commissionPayments = d.commissionPayments.filter(x => x.id !== paymentId);
    d.updatedAt = new Date().toISOString();
    await this.db.save(data);
    return true;
  }

  // פרטי התשלום להפקת חשבונית: הלקוח של אותו צד
  async commissionPaymentForInvoice(dealId, paymentId) {
    const data = await this._load();
    const d = this._find(data.realty.deals, dealId, 'העסקה');
    const p = (d.commissionPayments || []).find(x => x.id === paymentId);
    if (!p) throw new Error('התשלום לא נמצא');
    if (p.invoiceId) throw new Error(`כבר הופקה חשבונית לתשלום הזה (מספר ${p.invoiceNumber})`);
    const clientId = p.side === 'buyer' ? d.buyerClientId : d.sellerClientId;
    const c = data.realty.clients.find(x => x.id === clientId);
    if (!c) throw new Error('הלקוח של הצד הזה לא נמצא — יש לבחור מוכר בעסקה');
    const prop = data.realty.properties.find(x => x.id === d.propertyId);
    return {
      key: `rlty:${d.id}:${p.id}`, customer: c.name, date: p.date, grossAgorot: p.amountAg, method: p.method,
      description: `דמי תיווך — ${prop ? R.propertyTitle(prop) : 'נכס'}`.slice(0, 200), exempt: data.realty.settings.vatExempt
    };
  }

  async linkCommissionInvoice(dealId, paymentId, invoice) {
    const data = await this._load();
    const d = data.realty.deals.find(x => x.id === dealId);
    const p = d && (d.commissionPayments || []).find(x => x.id === paymentId);
    if (!p) throw new Error('התשלום לא נמצא');
    p.invoiceId = invoice.id;
    p.invoiceNumber = invoice.number;
    await this.db.save(data);
    return p;
  }

  // ---------- הזמנת שירותי תיווך ----------
  async saveOrder(id, input) {
    const data = await this._load();
    const { orders, clients, properties } = data.realty;
    const now = new Date().toISOString();
    if (!id) {
      if (orders.length >= B.MAX_ORDERS) throw new Error('הגעת למספר המקסימלי של הזמנות');
      const rec = { id: crypto.randomUUID(), ...B.validateOrder(input, {}, { clients, properties }), createdAt: now, updatedAt: now };
      orders.push(rec);
      await this.db.save(data);
      return B.orderView(rec, { clients, properties, settings: data.realty.settings });
    }
    const i = orders.findIndex(o => o.id === id);
    if (i < 0) throw new Error('ההזמנה לא נמצאה');
    orders[i] = { ...orders[i], ...B.validateOrder(input, orders[i], { clients, properties }), updatedAt: now };
    await this.db.save(data);
    return B.orderView(orders[i], { clients, properties, settings: data.realty.settings });
  }

  async deleteOrder(id) {
    const data = await this._load();
    this._find(data.realty.orders, id, 'ההזמנה');
    data.realty.orders = data.realty.orders.filter(o => o.id !== id);
    await this.db.save(data);
    return true;
  }

  async orderDocument(id) {
    const data = await this._load();
    const o = this._find(data.realty.orders, id, 'ההזמנה');
    return { order: o, client: data.realty.clients.find(c => c.id === o.clientId), property: data.realty.properties.find(p => p.id === o.propertyId), settings: data.realty.settings };
  }

  async saveSettings(input) {
    const data = await this._load();
    data.realty.settings = B.normalizeSettings({ ...data.realty.settings, ...(input || {}), vatExempt: input && (input.vatExempt === true || input.vatExempt === 'yes') });
    await this.db.save(data);
    return data.realty.settings;
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
    if (data.realty.orders.some(o => o.clientId === id)) throw new Error('ללקוח יש הזמנת שירותי תיווך — אי אפשר למחוק אותו');
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
    return this._dealOut(data, rec, { properties, clients });
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
    return this._dealOut(data, deals[i], { properties, clients });
  }

  _syncProperty(data, deal) {
    const p = data.realty.properties.find(x => x.id === deal.propertyId);
    if (!p) return;
    const status = R.propertyStatusAfter(deal, p);
    if (status !== p.status) { p.status = status; p.updatedAt = new Date().toISOString(); }
  }

  async deleteDeal(id) {
    const data = await this._load();
    const d = this._find(data.realty.deals, id, 'העסקה');
    // עסקה עם תשלומי עמלה לא נמחקת — הכסף והחשבוניות צריכים להישאר מקושרים
    if ((d.commissionPayments || []).length) throw new Error('בעסקה נרשמו תשלומי עמלה — אפשר לסמן אותה "בוטלה" במקום למחוק');
    data.realty.deals = data.realty.deals.filter(x => x.id !== id);
    await this.db.save(data);
    return true;
  }
}

module.exports = { RealtyService: new RealtyService() };
