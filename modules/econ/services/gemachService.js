// Gemach Service — קופת גמ"ח: הלוואות ללא ריבית, ערבים, לוח סילוקין, הפקדות ופיגורים.
// נשמר באוסף gemach במסד המרכזי — ולכן נכנס אוטומטית לגיבוי המוצפן הקיים.
const crypto = require('crypto');
const G = require('../core/gemach');
const GX = require('../core/gemachExtra');

class GemachService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    if (db) this.db = db;
  }

  async _load() {
    const data = await this.db.load();
    const gemach = data.gemach && typeof data.gemach === 'object' ? data.gemach : {};
    data.gemach = {
      settings: G.normalizeSettings(gemach.settings),
      loans: Array.isArray(gemach.loans) ? gemach.loans : [],
      deposits: Array.isArray(gemach.deposits) ? gemach.deposits : [],
      applications: Array.isArray(gemach.applications) ? gemach.applications : [],
      items: Array.isArray(gemach.items) ? gemach.items : [],
      lendings: Array.isArray(gemach.lendings) ? gemach.lendings : []
    };
    return data;
  }

  async getOverview(asOf) {
    const { gemach } = await this._load();
    const today = asOf || new Date().toISOString().slice(0, 10);
    return {
      settings: gemach.settings,
      loans: [...gemach.loans]
        .map(l => G.loanSummary(l, today))
        .sort((a, b) => (b.status === 'active') - (a.status === 'active') || b.issueDate.localeCompare(a.issueDate)),
      deposits: [...gemach.deposits].sort((a, b) => b.date.localeCompare(a.date)),
      overview: G.overview(gemach.loans, gemach.deposits, gemach.settings, today),
      applications: [...gemach.applications].sort((a, b) => (['approved', 'rejected'].includes(a.status) - ['approved', 'rejected'].includes(b.status)) || b.requestDate.localeCompare(a.requestDate))
        .map(a => ({ ...a, statusLabel: GX.APP_STATUSES[a.status] })),
      guarantorArrears: GX.arrearsByGuarantor(gemach.loans, today),
      items: GX.itemsOverview(gemach.items, gemach.lendings, today)
    };
  }

  async getLoan(loanId) {
    const { gemach } = await this._load();
    const l = gemach.loans.find(x => x.id === loanId);
    if (!l) throw new Error('ההלוואה לא נמצאה');
    return l;
  }

  async saveSettings(input = {}) {
    const data = await this._load();
    data.gemach.settings = G.normalizeSettings({ ...data.gemach.settings, ...input });
    await this.db.save(data);
    return data.gemach.settings;
  }

  async addLoan(input) {
    const data = await this._load();
    const clean = G.validateLoanInput(input, data.gemach.loans.length);
    const schedule = G.buildSchedule(clean.amount, clean.installments, clean.issueDate);
    const loan = { id: crypto.randomUUID(), ...clean, schedule, status: 'active', createdAt: new Date().toISOString() };
    data.gemach.loans.push(loan);
    await this.db.save(data);
    return loan;
  }

  async recordPayment(loanId, seq, input = {}) {
    const data = await this._load();
    const i = data.gemach.loans.findIndex(l => l.id === loanId);
    if (i < 0) throw new Error('ההלוואה לא נמצאה');
    if (data.gemach.loans[i].status === 'cancelled') throw new Error('לא ניתן לרשום תשלום על הלוואה שבוטלה');
    data.gemach.loans[i] = G.recordPayment(data.gemach.loans[i], seq, input);
    await this.db.save(data);
    return data.gemach.loans[i];
  }

  async cancelLoan(loanId) {
    const data = await this._load();
    const l = data.gemach.loans.find(x => x.id === loanId);
    if (!l) throw new Error('ההלוואה לא נמצאה');
    if (G.totalPaidAg(l) > 0) throw new Error('לא ניתן לבטל הלוואה שכבר נרשמו עליה תשלומים');
    l.status = 'cancelled';
    l.cancelledAt = new Date().toISOString();
    await this.db.save(data);
    return l;
  }

  async addDeposit(input) {
    const data = await this._load();
    const clean = G.validateDepositInput(input, data.gemach.deposits.length);
    const deposit = { id: crypto.randomUUID(), ...clean, createdAt: new Date().toISOString() };
    data.gemach.deposits.push(deposit);
    await this.db.save(data);
    return deposit;
  }

  async deleteDeposit(depositId) {
    const data = await this._load();
    const before = data.gemach.deposits.length;
    data.gemach.deposits = data.gemach.deposits.filter(d => d.id !== depositId);
    if (data.gemach.deposits.length === before) throw new Error('ההפקדה לא נמצאה');
    await this.db.save(data);
    return true;
  }

  /* ---------- בקשות הלוואה ---------- */
  async saveApplication(appId, input) {
    const data = await this._load();
    const list = data.gemach.applications;
    const prev = appId ? list.find(a => a.id === appId) : null;
    if (appId && !prev) throw new Error('הבקשה לא נמצאה');
    if (prev && ['approved', 'rejected'].includes(prev.status)) throw new Error('בקשה שהוכרעה אינה ניתנת לעריכה');
    const merged = { ...(prev || {}), ...input };
    if (input && input.guarantorsText !== undefined) delete merged.guarantors;
    const clean = GX.validateApplication(merged, prev ? 0 : list.length);
    const now = new Date().toISOString();
    // שינוי ערבים אחרי אימות מחזיר את הבקשה לשלב הראיון
    const guarantorsChanged = prev && JSON.stringify(prev.guarantors) !== JSON.stringify(clean.guarantors);
    const app = prev
      ? Object.assign(prev, clean, { updatedAt: now }, guarantorsChanged && prev.status === 'verified' ? { status: 'interview' } : {})
      : { id: crypto.randomUUID(), ...clean, status: 'draft', history: [{ status: 'draft', at: now }], createdAt: now };
    if (!prev) list.push(app);
    await this.db.save(data);
    return app;
  }

  // מעבר שלב. אישור יוצר את ההלוואה באותה שמירה (תאריך מתן = issueDate, או היום)
  async moveApplication(appId, to, input = {}) {
    const data = await this._load();
    const app = data.gemach.applications.find(a => a.id === appId);
    if (!app) throw new Error('הבקשה לא נמצאה');
    GX.assertTransition(app, to);
    const now = new Date().toISOString();
    let loan = null;
    if (to === 'approved') {
      const issueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(input.issueDate || '')) ? input.issueDate : now.slice(0, 10);
      const clean = G.validateLoanInput({ ...app, issueDate }, data.gemach.loans.length);
      loan = { id: crypto.randomUUID(), ...clean, schedule: G.buildSchedule(clean.amount, clean.installments, clean.issueDate), status: 'active', applicationId: app.id, createdAt: now };
      data.gemach.loans.push(loan);
      app.loanId = loan.id;
    }
    if (to === 'rejected') app.rejectReason = String(input.reason || '').trim().slice(0, 500);
    app.status = to;
    app.history = [...(app.history || []), { status: to, at: now }];
    await this.db.save(data);
    return { application: app, loan };
  }

  async deleteApplication(appId) {
    const data = await this._load();
    const app = data.gemach.applications.find(a => a.id === appId);
    if (!app) throw new Error('הבקשה לא נמצאה');
    if (app.status === 'approved') throw new Error('בקשה שאושרה קשורה להלוואה ואינה נמחקת');
    data.gemach.applications = data.gemach.applications.filter(a => a.id !== appId);
    await this.db.save(data);
    return true;
  }

  /* ---------- גמ"ח חפצים ---------- */
  async saveItem(itemId, input) {
    const data = await this._load();
    const list = data.gemach.items;
    const prev = itemId ? list.find(i => i.id === itemId) : null;
    if (itemId && !prev) throw new Error('הפריט לא נמצא');
    const clean = GX.validateItem({ ...(prev || {}), ...input }, prev ? 0 : list.length);
    const now = new Date().toISOString();
    const item = prev ? Object.assign(prev, clean, { updatedAt: now }) : { id: crypto.randomUUID(), ...clean, createdAt: now };
    if (!prev) list.push(item);
    await this.db.save(data);
    return item;
  }

  async deleteItem(itemId) {
    const data = await this._load();
    if (!data.gemach.items.some(i => i.id === itemId)) throw new Error('הפריט לא נמצא');
    if (data.gemach.lendings.some(l => l.itemId === itemId)) throw new Error('לפריט יש היסטוריית השאלות — במקום למחוק, סמן "יצא משימוש"');
    data.gemach.items = data.gemach.items.filter(i => i.id !== itemId);
    await this.db.save(data);
    return true;
  }

  async lendItem(itemId, input) {
    const data = await this._load();
    const item = data.gemach.items.find(i => i.id === itemId);
    const clean = GX.validateLending(input || {}, item, data.gemach.lendings, data.gemach.lendings.length);
    const lending = { id: crypto.randomUUID(), ...clean, createdAt: new Date().toISOString() };
    data.gemach.lendings.push(lending);
    await this.db.save(data);
    return lending;
  }

  async returnItem(itemId, input) {
    const data = await this._load();
    const item = data.gemach.items.find(i => i.id === itemId);
    if (!item) throw new Error('הפריט לא נמצא');
    const open = GX.openLending(data.gemach.lendings, itemId);
    if (!open) throw new Error('הפריט אינו מושאל כעת');
    const updated = GX.applyReturn(open, input || {});
    Object.assign(open, updated);
    item.condition = updated.returnCondition;
    await this.db.save(data);
    return open;
  }

  async getExportData(kind) {
    const { gemach } = await this._load();
    const extra = GX.exportExtra(kind, gemach, new Date().toISOString().slice(0, 10));
    if (extra) return extra;
    return G.exportTable(kind, gemach.loans, gemach.deposits, gemach.settings);
  }
}

module.exports = { GemachService: new GemachService() };
