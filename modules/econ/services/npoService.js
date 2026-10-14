// NPO Service - עמותות: תרומות וקבלות סעיף 46, קרנות, תמיכות ודוח שנתי.
// נשמר באוסף npo במסד המרכזי — ולכן נכנס אוטומטית לגיבוי המוצפן הקיים.
const crypto = require('crypto');
const N = require('../core/npo');
const SO = require('../core/standingOrders');
const DI = require('../core/donationImport');
const MEM = require('../core/memorials');
const CMP = require('../core/campaigns');

class NpoService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    if (db) this.db = db;
  }

  async _load() {
    const data = await this.db.load();
    const npo = data.npo && typeof data.npo === 'object' ? data.npo : {};
    data.npo = {
      settings: N.normalizeSettings(npo.settings),
      donations: Array.isArray(npo.donations) ? npo.donations : [],
      grants: Array.isArray(npo.grants) ? npo.grants : [],
      standingOrders: Array.isArray(npo.standingOrders) ? npo.standingOrders : [],
      memorials: Array.isArray(npo.memorials) ? npo.memorials : [],
      campaigns: Array.isArray(npo.campaigns) ? npo.campaigns : []
    };
    return data;
  }

  /* ---------- הוראות קבע (מעקב בלבד) ---------- */
  async getStandingOrders(today) {
    const { npo } = await this._load();
    const t = /^\d{4}-\d{2}-\d{2}$/.test(String(today || '')) ? today : new Date().toISOString().slice(0, 10);
    return SO.summarize(npo.standingOrders, t);
  }

  async saveStandingOrder(orderId, input) {
    const data = await this._load();
    const list = data.npo.standingOrders;
    const prev = orderId ? list.find(o => o.id === orderId) : null;
    if (orderId && !prev) throw new Error('הוראת הקבע לא נמצאה');
    const fundIds = N.allFunds(data.npo.settings).filter(f => !f.archived || (prev && prev.fundId === f.id)).map(f => f.id);
    const clean = SO.validateStandingOrder({ ...(prev || {}), ...input }, { fundIds, prev: prev || {}, count: list.length });
    const now = new Date().toISOString();
    const order = prev ? Object.assign(prev, clean, { updatedAt: now }) : { id: crypto.randomUUID(), ...clean, history: [], createdAt: now };
    if (!prev) list.push(order);
    await this.db.save(data);
    return order;
  }

  // סימון חודש: "התקבל" מפיק תרומה וקבלה רגילות (באותה שמירה), "נכשל" נרשם להיסטוריה בלבד
  async recordStandingPayment(orderId, month, status, date) {
    const data = await this._load();
    const order = data.npo.standingOrders.find(o => o.id === orderId);
    if (!order) throw new Error('הוראת הקבע לא נמצאה');
    SO.assertCanRecord(order, month, status);
    const entry = { month, status, at: new Date().toISOString() };
    let donation = null;
    if (status === 'received') {
      if (!data.npo.settings.orgName) throw new Error('יש להגדיר תחילה את פרטי העמותה (כפתור "הגדרות עמותה")');
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : SO.dueDate(month, order.dayOfMonth);
      const clean = N.validateDonation({
        date: day, donorName: order.donorName, donorId: order.donorId, amount: order.amount, method: order.method,
        fundId: order.fundId, purpose: order.purpose || 'הוראת קבע', donorPhone: order.donorPhone, donorAddress: order.donorAddress
      }, data.npo.settings, data.npo.donations.length);
      const { receipt, settings } = N.issueReceipt(clean, data.npo.settings);
      donation = { id: crypto.randomUUID(), ...clean, receipt, status: 'active', standingOrderId: order.id, createdAt: entry.at };
      data.npo.donations.push(donation);
      data.npo.settings = settings;
      entry.donationId = donation.id;
    }
    order.history = [...(Array.isArray(order.history) ? order.history : []), entry];
    await this.db.save(data);
    return { order, donation };
  }

  async deleteStandingOrder(orderId) {
    const data = await this._load();
    const order = data.npo.standingOrders.find(o => o.id === orderId);
    if (!order) throw new Error('הוראת הקבע לא נמצאה');
    // הוראה שכבר הפיקה קבלות לא נמחקת — רק מסתיימת, כדי שהקשר לקבלות יישמר
    if ((order.history || []).some(h => h.status === 'received')) throw new Error('להוראה זו כבר הופקו קבלות. במקום למחוק — קבע לה חודש סיום');
    data.npo.standingOrders = data.npo.standingOrders.filter(o => o.id !== orderId);
    await this.db.save(data);
    return true;
  }

  /* ---------- קמפיינים ---------- */
  async saveCampaign(campaignId, input) {
    const data = await this._load();
    const list = data.npo.campaigns;
    const prev = campaignId ? list.find(x => x.id === campaignId) : null;
    if (campaignId && !prev) throw new Error('הקמפיין לא נמצא');
    const fundIds = N.allFunds(data.npo.settings).filter(f => !f.archived || (prev && prev.fundId === f.id)).map(f => f.id);
    const clean = CMP.validateCampaign({ ...(prev || {}), ...input }, { count: prev ? 0 : list.length, fundIds });
    if (prev) {
      // שינוי תקופה לא יכול "להוציא" תרומות שכבר שויכו
      const out = data.npo.donations.filter(d => d.campaignId === prev.id && d.status !== 'cancelled' && (d.date < clean.startDate || d.date > clean.endDate));
      if (out.length) throw new Error(`${out.length} תרומות משויכות לקמפיין מחוץ לתקופה החדשה — יש להרחיב את התקופה`);
    }
    const now = new Date().toISOString();
    const cmp = prev ? Object.assign(prev, clean, { updatedAt: now }) : { id: crypto.randomUUID(), ...clean, createdAt: now };
    if (!prev) list.push(cmp);
    await this.db.save(data);
    return cmp;
  }

  // קמפיין עם תרומות לא נמחק — נסגר, כדי שהשיוך בקבלות יישמר
  async deleteCampaign(campaignId) {
    const data = await this._load();
    if (!data.npo.campaigns.some(x => x.id === campaignId)) throw new Error('הקמפיין לא נמצא');
    if (data.npo.donations.some(d => d.campaignId === campaignId)) throw new Error('לקמפיין יש תרומות משויכות. במקום למחוק — סמן אותו כסגור');
    data.npo.campaigns = data.npo.campaigns.filter(x => x.id !== campaignId);
    await this.db.save(data);
    return true;
  }

  _campaignFor(data, campaignId) {
    if (!campaignId) return null;
    const c = data.npo.campaigns.find(x => x.id === campaignId);
    if (!c) throw new Error('הקמפיין לא נמצא');
    return c;
  }

  /* ---------- הנצחות ויארצייטים ---------- */
  async getMemorials(today, days) {
    const { npo } = await this._load();
    const t = /^\d{4}-\d{2}-\d{2}$/.test(String(today || '')) ? today : new Date().toISOString().slice(0, 10);
    const list = [...npo.memorials].sort((a, b) => a.name.localeCompare(b.name, 'he')).map(m => ({ ...m, hebrewLabel: MEM.hebrewLabel(m) }));
    return { list, ...MEM.upcoming(npo.memorials, t, days) };
  }

  async saveMemorial(memorialId, input) {
    const data = await this._load();
    const list = data.npo.memorials;
    const prev = memorialId ? list.find(m => m.id === memorialId) : null;
    if (memorialId && !prev) throw new Error('רשומת ההנצחה לא נמצאה');
    const clean = MEM.validateMemorial({ ...(prev || {}), ...input }, { count: prev ? 0 : list.length });
    const now = new Date().toISOString();
    const m = prev ? Object.assign(prev, clean, { updatedAt: now }) : { id: crypto.randomUUID(), ...clean, createdAt: now };
    if (!prev) list.push(m);
    await this.db.save(data);
    return m;
  }

  async deleteMemorial(memorialId) {
    const data = await this._load();
    if (!data.npo.memorials.some(m => m.id === memorialId)) throw new Error('רשומת ההנצחה לא נמצאה');
    data.npo.memorials = data.npo.memorials.filter(m => m.id !== memorialId);
    await this.db.save(data);
    return true;
  }

  async getMemorialsExport(today) {
    const { npo } = await this._load();
    const t = /^\d{4}-\d{2}-\d{2}$/.test(String(today || '')) ? today : new Date().toISOString().slice(0, 10);
    return MEM.exportRows(npo.memorials, MEM.upcoming(npo.memorials, t, 400).rows);
  }

  /* ---------- ייבוא תרומות מקובץ של ערוץ חיצוני ---------- */
  async previewImport(csvText, source) {
    const { npo } = await this._load();
    return DI.preview(csvText, source, npo.settings);
  }

  // כל השורות התקינות נשמרות יחד בשמירה אחת. קבלות מקומיות מופקות לפי סדר התאריכים;
  // קבלה של הערוץ נשמרת כקבלה חיצונית ואינה צורכת מספר מהמספור הרץ.
  async importDonations(csvText, options = {}) {
    const data = await this._load();
    if (!data.npo.settings.orgName) throw new Error('יש להגדיר תחילה את פרטי העמותה (כפתור "הגדרות עמותה")');
    const campaign = this._campaignFor(data, options.campaignId);
    if (campaign && campaign.closed) throw new Error(`הקמפיין "${campaign.name}" סגור`);
    const { records, errors, skipped } = DI.buildRecords(csvText, { ...options, campaign }, data.npo.donations, data.npo.settings);
    if (data.npo.donations.length + records.length > N.MAX_DONATIONS) throw new Error('הייבוא יחרוג מהמספר המקסימלי של תרומות');
    const now = new Date().toISOString();
    let settings = data.npo.settings;
    const added = [];
    for (const rec of [...records].sort((a, b) => a.date.localeCompare(b.date))) {
      let receipt;
      if (rec.import.receipts === 'issue') ({ receipt, settings } = N.issueReceipt(rec, settings));
      else receipt = DI.externalReceipt(rec, settings);
      added.push({ id: crypto.randomUUID(), ...rec, receipt, status: 'active', createdAt: now });
    }
    const mappings = { ...(settings.importMappings || {}), [options.source]: Object.fromEntries(Object.keys(DI.FIELDS).filter(k => options.mapping && options.mapping[k]).map(k => [k, String(options.mapping[k])])) };
    data.npo.settings = { ...settings, importMappings: mappings };
    data.npo.donations.push(...added);
    await this.db.save(data);
    const total = added.reduce((t, d) => t + Math.round(d.amount * 100), 0) / 100;
    return { imported: added.length, total, skipped, errors };
  }

  async getOverview(year) {
    const { npo } = await this._load();
    const y = Number(year) || new Date().getFullYear();
    return {
      year: y,
      settings: npo.settings,
      funds: N.allFunds(npo.settings),
      donations: [...npo.donations].sort((a, b) => b.date.localeCompare(a.date) || N.byReceipt(b, a)).map(d => ({ ...d, taxStatus: N.taxStatus(d) })),
      grants: [...npo.grants].sort((a, b) => b.year - a.year || a.source.localeCompare(b.source, 'he')),
      donors: N.donorSummary(npo.donations),
      fundSummary: N.fundSummary(npo.donations, npo.grants, npo.settings, y),
      report: N.annualReport(npo.donations, npo.grants, npo.settings, y),
      grantAlerts: N.grantAlerts(npo.grants, new Date().toISOString().slice(0, 10)),
      tax: N.taxSummary(npo.donations),
      campaigns: CMP.summarize(npo.campaigns, npo.donations, new Date().toISOString().slice(0, 10))
    };
  }

  async saveSettings(input = {}) {
    const data = await this._load();
    const used = new Set([...data.npo.donations.map(d => d.fundId), ...data.npo.grants.map(g => g.fundId)]);
    data.npo.settings = N.applySettings(data.npo.settings, input, used, () => crypto.randomUUID());
    await this.db.save(data);
    return data.npo.settings;
  }

  // תרומה וקבלה נוצרות יחד, באותה שמירה — אין מצב של תרומה בלי קבלה או מספר שדולג
  async addDonation(input) {
    const data = await this._load();
    if (!data.npo.settings.orgName) throw new Error('יש להגדיר תחילה את פרטי העמותה (כפתור "הגדרות עמותה")');
    const clean = N.validateDonation(input, data.npo.settings, data.npo.donations.length);
    if (clean.campaignId) CMP.assertCanAssign(this._campaignFor(data, clean.campaignId), clean.date);
    const { receipt, settings } = N.issueReceipt(clean, data.npo.settings);
    const donation = { id: crypto.randomUUID(), ...clean, receipt, status: 'active', createdAt: new Date().toISOString() };
    data.npo.donations.push(donation);
    data.npo.settings = settings;
    await this.db.save(data);
    return donation;
  }

  // קבלה אינה נמחקת: ביטול משאיר את המספר "שרוף" ומסומן כמבוטל, כנדרש בתיעוד קבלות
  async cancelDonation(donationId) {
    const data = await this._load();
    const d = data.npo.donations.find(x => x.id === donationId);
    if (!d) throw new Error('התרומה לא נמצאה');
    if (d.status === 'cancelled') throw new Error('הקבלה כבר בוטלה');
    d.status = 'cancelled';
    d.cancelledAt = new Date().toISOString();
    await this.db.save(data);
    return d;
  }

  async getDonorStatement(donorKey, year) {
    const { npo } = await this._load();
    return N.donorAnnualStatement(npo.donations, npo.settings, donorKey, year);
  }

  async getDonation(donationId) {
    const { npo } = await this._load();
    const d = npo.donations.find(x => x.id === donationId);
    if (!d) throw new Error('התרומה לא נמצאה');
    return d;
  }

  async addGrant(input) {
    const data = await this._load();
    if (data.npo.grants.length >= N.MAX_GRANTS) throw new Error('הגעת למספר המקסימלי של תמיכות');
    const clean = N.validateGrant(input);
    if (!N.allFunds(data.npo.settings).some(f => f.id === clean.fundId)) throw new Error('הקרן שנבחרה אינה קיימת');
    const grant = { id: crypto.randomUUID(), ...clean, createdAt: new Date().toISOString() };
    data.npo.grants.push(grant);
    await this.db.save(data);
    return grant;
  }

  async updateGrant(grantId, input) {
    const data = await this._load();
    const i = data.npo.grants.findIndex(g => g.id === grantId);
    if (i < 0) throw new Error('התמיכה לא נמצאה');
    const clean = N.validateGrant({ ...data.npo.grants[i], ...input }, data.npo.grants[i].documents);
    if (!N.allFunds(data.npo.settings).some(f => f.id === clean.fundId)) throw new Error('הקרן שנבחרה אינה קיימת');
    data.npo.grants[i] = { ...data.npo.grants[i], ...clean, updatedAt: new Date().toISOString() };
    await this.db.save(data);
    return data.npo.grants[i];
  }

  async toggleGrantDocument(grantId, index) {
    const data = await this._load();
    const g = data.npo.grants.find(x => x.id === grantId);
    if (!g) throw new Error('התמיכה לא נמצאה');
    const docs = Array.isArray(g.documents) ? g.documents : [];
    const i = Number(index);
    if (!Number.isInteger(i) || !docs[i]) throw new Error('המסמך לא נמצא');
    docs[i] = { ...docs[i], done: !docs[i].done };
    g.documents = docs;
    await this.db.save(data);
    return g;
  }

  // מעקב דיווח ל"תרומות ישראל": מספר רישום לתרומה, או אישור שביטול דווח
  async recordTaxReport(donationId, input = {}) {
    const data = await this._load();
    const i = data.npo.donations.findIndex(x => x.id === donationId);
    if (i < 0) throw new Error('התרומה לא נמצאה');
    data.npo.donations[i] = N.recordTaxReport(data.npo.donations[i], input);
    await this.db.save(data);
    return { ...data.npo.donations[i], taxStatus: N.taxStatus(data.npo.donations[i]) };
  }

  async deleteGrant(grantId) {
    const data = await this._load();
    const before = data.npo.grants.length;
    data.npo.grants = data.npo.grants.filter(g => g.id !== grantId);
    if (data.npo.grants.length === before) throw new Error('התמיכה לא נמצאה');
    await this.db.save(data);
    return true;
  }

  async getExportData(kind, year) {
    const { npo } = await this._load();
    return N.exportTable(kind, npo.donations, npo.grants, npo.settings, Number(year) || new Date().getFullYear());
  }
}

module.exports = { NpoService: new NpoService() };
