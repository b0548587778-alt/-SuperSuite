// Gemach Service — קופת גמ"ח: הלוואות ללא ריבית, ערבים, לוח סילוקין, הפקדות ופיגורים.
// נשמר באוסף gemach במסד המרכזי — ולכן נכנס אוטומטית לגיבוי המוצפן הקיים.
const crypto = require('crypto');
const G = require('../core/gemach');

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
      deposits: Array.isArray(gemach.deposits) ? gemach.deposits : []
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
      overview: G.overview(gemach.loans, gemach.deposits, gemach.settings, today)
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

  async getExportData(kind) {
    const { gemach } = await this._load();
    return G.exportTable(kind, gemach.loans, gemach.deposits, gemach.settings);
  }
}

module.exports = { GemachService: new GemachService() };
