// NPO Service - עמותות: תרומות וקבלות סעיף 46, קרנות, תמיכות ודוח שנתי.
// נשמר באוסף npo במסד המרכזי — ולכן נכנס אוטומטית לגיבוי המוצפן הקיים.
const crypto = require('crypto');
const N = require('../core/npo');

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
      grants: Array.isArray(npo.grants) ? npo.grants : []
    };
    return data;
  }

  async getOverview(year) {
    const { npo } = await this._load();
    const y = Number(year) || new Date().getFullYear();
    return {
      year: y,
      settings: npo.settings,
      funds: N.allFunds(npo.settings),
      donations: [...npo.donations].sort((a, b) => b.receipt.number - a.receipt.number).map(d => ({ ...d, taxStatus: N.taxStatus(d) })),
      grants: [...npo.grants].sort((a, b) => b.year - a.year || a.source.localeCompare(b.source, 'he')),
      donors: N.donorSummary(npo.donations),
      fundSummary: N.fundSummary(npo.donations, npo.grants, npo.settings, y),
      report: N.annualReport(npo.donations, npo.grants, npo.settings, y),
      grantAlerts: N.grantAlerts(npo.grants, new Date().toISOString().slice(0, 10)),
      tax: N.taxSummary(npo.donations)
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
