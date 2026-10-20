// Gemach Service — קופת גמ"ח: הלוואות ללא ריבית, ערבים, לוח סילוקין, הפקדות ופיגורים.
// נשמר באוסף gemach במסד המרכזי — ולכן נכנס אוטומטית לגיבוי המוצפן הקיים.
const crypto = require('crypto');
const G = require('../core/gemach');
const GX = require('../core/gemachExtra');
const MSV = require('../core/masav');

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
      lendings: Array.isArray(gemach.lendings) ? gemach.lendings : [],
      masav: MSV.normalizeStore(gemach.masav)
    };
    return data;
  }

  async getOverview(asOf) {
    const { gemach } = await this._load();
    const today = asOf || new Date().toISOString().slice(0, 10);
    return {
      settings: gemach.settings,
      loans: [...gemach.loans]
        .map(l => ({ ...G.loanSummary(l, today), bankMasked: MSV.maskAccount(l.bankAccount), masavStopped: l.masavStopped || '' }))
        .sort((a, b) => (b.status === 'active') - (a.status === 'active') || b.issueDate.localeCompare(a.issueDate)),
      deposits: [...gemach.deposits].sort((a, b) => b.date.localeCompare(a.date)),
      overview: G.overview(gemach.loans, gemach.deposits, gemach.settings, today),
      applications: [...gemach.applications].sort((a, b) => (['approved', 'rejected'].includes(a.status) - ['approved', 'rejected'].includes(b.status)) || b.requestDate.localeCompare(a.requestDate))
        .map(a => ({ ...a, statusLabel: GX.APP_STATUSES[a.status] })),
      guarantorArrears: GX.arrearsByGuarantor(gemach.loans, today),
      items: GX.itemsOverview(gemach.items, gemach.lendings, today),
      masav: { configured: !!gemach.masav.settings, settings: gemach.masav.settings, batches: gemach.masav.batches.map(MSV.batchView).reverse() }
    };
  }

  async getLoan(loanId) {
    const { gemach } = await this._load();
    const l = gemach.loans.find(x => x.id === loanId);
    if (!l) throw new Error('ההלוואה לא נמצאה');
    const { bankAccount, ...rest } = l;
    return { ...rest, bankMasked: MSV.maskAccount(bankAccount) };
  }

  // דף חשבון ללווה: ההלוואה (חשבון הבנק ממוסך בלבד) ושם הגמ"ח
  async getLoanStatement(loanId) {
    const loan = await this.getLoan(loanId);
    const { gemach } = await this._load();
    return { loan, fundName: G.normalizeSettings(gemach.settings).fundName };
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
    const { bankAccount, ...loan } = data.gemach.loans[i];
    return loan;
  }

  async cancelLoan(loanId) {
    const data = await this._load();
    const l = data.gemach.loans.find(x => x.id === loanId);
    if (!l) throw new Error('ההלוואה לא נמצאה');
    if (G.totalPaidAg(l) > 0) throw new Error('לא ניתן לבטל הלוואה שכבר נרשמו עליה תשלומים');
    // חיוב שכבר נשלח לבנק — הכסף עשוי להיגבות; ביטול היה משאיר את האצווה בלי הלוואה
    if (data.gemach.masav.batches.some(b => b.status === 'open' && b.items.some(i => i.status === 'pending' && i.key.split('|')[0] === loanId))) {
      throw new Error('להלוואה זו יש חיוב באצוות מס"ב פתוחה. יש לסגור או לבטל את האצווה לפני ביטול ההלוואה');
    }
    l.status = 'cancelled';
    l.cancelledAt = new Date().toISOString();
    // הלוואה שבוטלה לא תחויב — פרטי החשבון נמחקים
    delete l.bankAccount;
    await this.db.save(data);
    return l;
  }

  /* ---------- מס"ב (PLAN.md 9.17): קובץ חיובים להחזרי הלוואות וקליטת החזרות ---------- */
  async saveMasavSettings(input) {
    const data = await this._load();
    data.gemach.masav.settings = MSV.validateSettings(input);
    await this.db.save(data);
    return data.gemach.masav.settings;
  }

  // פרטי חשבון הלווה לחיוב (הרשאה בבנק). input ריק — הסרה. אסמכתה קבועה לכל חיי ההרשאה
  async setLoanBank(loanId, input) {
    const data = await this._load();
    const l = data.gemach.loans.find(x => x.id === loanId);
    if (!l) throw new Error('ההלוואה לא נמצאה');
    if (!input) { delete l.bankAccount; await this.db.save(data); return { bankMasked: '' }; }
    if (l.status !== 'active') throw new Error('פרטי חשבון רק להלוואה פעילה');
    l.bankAccount = MSV.validateBankAccount(input);
    if (!l.masavRef) { data.gemach.masav.refSeq += 1; l.masavRef = String(data.gemach.masav.refSeq); }
    delete l.masavStopped;
    await this.db.save(data);
    return { bankMasked: MSV.maskAccount(l.bankAccount), masavRef: l.masavRef };
  }

  // החיובים לחודש: תשלומים בלוח הסילוקין שמועדם בחודש ונותרה בהם יתרה, בהלוואה פעילה עם חשבון, שלא באצווה אחרת
  _masavCandidates(data, month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) throw new Error('חודש לא תקין (YYYY-MM)');
    const busy = MSV.busyKeys(data.gemach.masav.batches);
    const out = [];
    for (const l of data.gemach.loans) {
      if (l.status !== 'active' || !l.bankAccount || l.masavStopped) continue;
      for (const s of l.schedule || []) {
        const key = `${l.id}|${s.seq}`;
        if (!String(s.dueDate).startsWith(month) || s.paidAg >= s.amountAg || busy.has(key)) continue;
        out.push({ key, loan: l, item: s, amountAg: s.amountAg - s.paidAg });
      }
    }
    return out;
  }

  async createMasavBatch({ month, chargeDate } = {}, { today, preview = false } = {}) {
    const data = await this._load();
    const m = data.gemach.masav;
    if (!m.settings) throw new Error('יש להגדיר תחילה את פרטי המוסד במס"ב');
    if (!MSV.isDay(chargeDate)) throw new Error('תאריך החיוב אינו תקין');
    if (today && chargeDate < today) throw new Error('תאריך החיוב עבר — יש לבחור תאריך עתידי');
    const cands = this._masavCandidates(data, month);
    if (!cands.length) throw new Error(`אין חיובים ל-${month}: אין תשלומים פתוחים בהלוואות עם פרטי חשבון שטרם חויבו`);
    const file = MSV.buildDebitFile({
      settings: m.settings, chargeDate, createdDate: today || chargeDate,
      items: cands.map(c => ({ ...c.loan.bankAccount, idNumber: c.loan.borrowerId, name: c.loan.borrowerName, amountAg: c.amountAg, reference: c.loan.masavRef, period: month }))
    });
    const fileName = `masav-${m.settings.institution}-${chargeDate}.txt`;
    if (preview) return { fileName, count: file.count, totalAg: file.totalAg };
    const batch = { id: crypto.randomUUID(), month, chargeDate, status: 'open', createdAt: new Date().toISOString(), returns: [],
      items: cands.map(c => ({ key: c.key, ref: c.loan.masavRef, amountAg: c.amountAg, label: `${c.loan.borrowerName} · תשלום ${c.item.seq}`, status: 'pending' })) };
    m.batches.push(batch);
    await this.db.save(data);
    return { fileName, text: file.text, count: file.count, totalAg: file.totalAg, batchId: batch.id };
  }

  async cancelMasavBatch(batchId) {
    const data = await this._load();
    const b = data.gemach.masav.batches.find(x => x.id === batchId);
    if (!b) throw new Error('האצווה לא נמצאה');
    if (b.status !== 'open' || b.items.some(i => i.status !== 'pending')) throw new Error('ניתן לבטל רק אצווה פתוחה שלא נקלטו לה החזרות');
    b.status = 'cancelled';
    b.cancelledAt = new Date().toISOString();
    await this.db.save(data);
    return MSV.batchView(b);
  }

  // קובץ החזרות: התשלום נשאר פתוח (ונכנס לפיגורים במועדו), וההחזרה נרשמת בהלוואה. החזרה סופית עוצרת חיובים נוספים
  async importMasavReturns(text) {
    const data = await this._load();
    const m = data.gemach.masav;
    if (!m.settings) throw new Error('יש להגדיר תחילה את פרטי המוסד במס"ב');
    const parsed = MSV.parseReturnsFile(text);
    const r = MSV.applyReturns(m.batches, parsed, m.settings.institution);
    const at = new Date().toISOString();
    for (const x of r.matched) {
      const [loanId, seq] = x.itemKey.split('|');
      const l = data.gemach.loans.find(o => o.id === loanId);
      if (!l) continue;
      l.masavReturns = [...(l.masavReturns || []), { seq: Number(seq), reason: x.reason, batchId: x.batchId, at }];
      if (x.fatal) l.masavStopped = x.reason;
    }
    // החזרה אחרי סגירת האצווה: התשלום כבר נרשם (ביטול ידני), אבל החזרה סופית עוצרת את החיובים הבאים
    for (const x of r.late) {
      const l = data.gemach.loans.find(o => o.id === x.itemKey.split('|')[0]);
      if (l && x.fatal) l.masavStopped = x.reason;
    }
    await this.db.save(data);
    return MSV.returnsSummary(r, parsed);
  }

  // סגירת אצווה: כל חיוב שלא הוחזר נרשם כתשלום בתאריך החיוב, בשמירה אחת
  async closeMasavBatch(batchId) {
    const data = await this._load();
    const b = data.gemach.masav.batches.find(x => x.id === batchId);
    if (!b) throw new Error('האצווה לא נמצאה');
    if (b.status !== 'open') throw new Error('האצווה כבר סגורה או מבוטלת');
    let paid = 0;
    const manual = [];
    for (const it of b.items.filter(i => i.status === 'pending')) {
      const [loanId, seq] = it.key.split('|');
      const i = data.gemach.loans.findIndex(o => o.id === loanId);
      // הלוואה שנמחקה או בוטלה (נתונים מלפני החסימה ב-cancelLoan) — לא מפילה את כל האצווה; נרשמת לטיפול ידני
      if (i < 0 || data.gemach.loans[i].status === 'cancelled') {
        it.status = 'paid';
        it.manual = 'ההלוואה בוטלה אחרי שליחת הקובץ — הכסף נגבה, ויש להחזיר אותו ללווה או לרשום ידנית';
        manual.push({ label: it.label, amountAg: it.amountAg, why: it.manual });
        continue;
      }
      const s = data.gemach.loans[i].schedule.find(x => x.seq === Number(seq));
      // תשלום שנרשם ידנית בינתיים — לא נרשם פעמיים; נרשם רק מה שנותר, עד סכום החיוב
      const amountAg = Math.min(it.amountAg, s ? s.amountAg - s.paidAg : 0);
      if (amountAg > 0) data.gemach.loans[i] = G.recordPayment(data.gemach.loans[i], seq, { amount: amountAg / 100, date: b.chargeDate });
      it.status = 'paid';
      paid++;
    }
    b.status = 'closed';
    b.closedAt = new Date().toISOString();
    await this.db.save(data);
    return { paid, manual, batch: MSV.batchView(b) };
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
