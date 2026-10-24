// Personal Finance Service - Handles personal financial planning and calculations
const crypto = require('crypto');
const { isDay, localDay } = require('../core/dates');

const FREQUENCIES = ['monthly', 'yearly', 'weekly', 'daily'];
const MAX_ITEMS = 2000;
const ITEM_KINDS = ['incomes', 'expenses', 'investments', 'cashFlowEntries'];
// המטבעות במסך פרטי התוכנית (CURRENCY_LABELS ב-ui/views-general.js)
const CURRENCIES = ['ILS', 'USD', 'EUR'];

class PersonalFinanceService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    // ה-Database המרכזי מנהל את כל האוספים בטבלת collections — אין צורך בטבלה נפרדת
    if (db) this.db = db;
  }

  async getFinance(senderId) {
    const data = await this.db.load();
    return this._asShape(data.personalFinance, senderId);
  }

  // מנרמל את האוסף למבנה הפיננסי התקין — תומך גם באובייקט חלקי
  _asShape(raw, senderId) {
    const base = {
      userId: senderId,
      planName: 'התוכנית הפיננסית שלי',
      currency: 'ILS',
      incomes: [],
      expenses: [],
      investments: [],
      cashFlowEntries: []
    };
    if (raw && typeof raw === 'object') {
      return {
        ...base,
        ...raw,
        userId: raw.userId || senderId,
        incomes: Array.isArray(raw.incomes) ? raw.incomes : [],
        expenses: Array.isArray(raw.expenses) ? raw.expenses : [],
        investments: Array.isArray(raw.investments) ? raw.investments : [],
        cashFlowEntries: Array.isArray(raw.cashFlowEntries) ? raw.cashFlowEntries : []
      };
    }
    return base;
  }

  // טוען את מבנה ה-personalFinance מהדאטה
  async _loadShape(senderId) {
    const data = await this.db.load();
    return this._asShape(data.personalFinance, senderId);
  }

  // שומר את מבנה ה-personalFinance חזרה לדאטה
  async _saveShape(senderId, shape) {
    const data = await this.db.load();
    shape.userId = senderId;
    data.personalFinance = shape;
    await this.db.save(data);
  }

  // עדכון פרטי התוכנית בלבד (שם ומטבע). הפריטים משתנים רק דרך addItem / updateItem / deleteItem, עם ולידציה ויומן —
  // קודם המערכים הוחלפו כמו שהגיעו מהמסך, ומי שאין לו הרשאת מחיקה יכול היה למחוק הכול (בדיקת קוד 23.10.2026)
  async updateFinance(senderId, financeData) {
    if (!financeData || typeof financeData !== 'object') {
      throw new Error('חסרים נתוני התוכנית');
    }
    const planName = String(financeData.planName ?? '').trim() || 'התוכנית הפיננסית שלי';
    if (planName.length > 200) throw new Error('שם התוכנית ארוך מדי (עד 200 תווים)');
    const currency = financeData.currency === undefined || financeData.currency === '' ? 'ILS' : String(financeData.currency);
    if (!CURRENCIES.includes(currency)) throw new Error('מטבע לא מוכר');
    const shape = await this._loadShape(senderId);
    shape.planName = planName;
    shape.currency = currency;
    await this._saveShape(senderId, shape);
    return shape;
  }

  // ---------- פריטי התוכנית: הוספה, עריכה ומחיקה לכל ארבעת הסוגים ----------
  // סוג הפריט → שם המערך בתוכנית. ולידציה אחת לכל סוג, בעברית, וסכומים מעוגלים לאגורה.
  _validateItem(kind, input) {
    const d = input && typeof input === 'object' ? input : {};
    const text = (v, max, label, required) => {
      const t = String(v ?? '').trim();
      if (required && !t) throw new Error(`${label} חובה`);
      if (t.length > max) throw new Error(`${label} ארוך מדי (עד ${max} תווים)`);
      return t;
    };
    const num = (v, label, { min = 0, max = 1e10, positive = false, integer = false } = {}) => {
      const n = Number(v);
      if (v === '' || v === null || v === undefined || !Number.isFinite(n) || n < min || n > max || (positive && n <= 0) || (integer && !Number.isInteger(n))) {
        throw new Error(`${label} אינו תקין`);
      }
      return n;
    };
    const money = (v, label) => Math.round(num(v, label, { positive: true }) * 100) / 100;
    const freq = FREQUENCIES.includes(d.frequency) ? d.frequency : 'monthly';
    if (kind === 'incomes') {
      return { source: text(d.source, 200, 'מקור ההכנסה', true), category: text(d.category, 100, 'הקטגוריה') || 'salary',
        amount: money(d.amount, 'סכום ההכנסה'), frequency: freq, notes: text(d.notes, 1000, 'ההערות') };
    }
    if (kind === 'expenses') {
      const isFixed = !(d.isFixed === false || d.isFixed === 'false' || d.isFixed === 'variable');
      return { category: text(d.category, 100, 'קטגוריית ההוצאה', true), description: text(d.description, 300, 'התיאור'),
        amount: money(d.amount, 'סכום ההוצאה'), frequency: freq, isFixed, notes: text(d.notes, 1000, 'ההערות') };
    }
    if (kind === 'investments') {
      return { name: text(d.name, 200, 'שם ההשקעה', true), type: text(d.type, 50, 'סוג ההשקעה') || 'stocks-etf',
        principal: money(d.principal, 'סכום ההשקעה'),
        monthlyContribution: Math.round(num(d.monthlyContribution || 0, 'הפקדה חודשית') * 100) / 100,
        annualRate: Math.round(num(d.annualRate, 'התשואה השנתית', { min: -50, max: 100 }) * 1000) / 1000,
        years: num(d.years, 'מספר השנים', { positive: true, max: 100, integer: true }), notes: text(d.notes, 1000, 'ההערות') };
    }
    if (kind === 'cashFlowEntries') {
      // ברירת המחדל — היום המקומי (לא toISOString: בין חצות ל-03:00 זה היה אתמול)
      const date = d.date || localDay();
      // תאריך אמיתי בלבד: 2026-02-31 נדחה (Date.parse מגלגל אותו ל-3.3)
      if (!isDay(date)) throw new Error('תאריך לא תקין');
      if (!['income', 'expense'].includes(d.type)) throw new Error('סוג התנועה חייב להיות הכנסה או הוצאה');
      return { date, type: d.type, amount: money(d.amount, 'סכום התנועה'),
        description: text(d.description, 300, 'התיאור'), category: text(d.category, 100, 'הקטגוריה') };
    }
    throw new Error('סוג פריט לא מוכר');
  }

  async addItem(senderId, kind, input) {
    const clean = this._validateItem(kind, input);
    const shape = await this._loadShape(senderId);
    if (shape[kind].length >= MAX_ITEMS) throw new Error('הגעת למספר המקסימלי של פריטים בתוכנית');
    const item = { id: crypto.randomUUID(), ...clean, createdAt: new Date().toISOString() };
    shape[kind].push(item);
    await this._saveShape(senderId, shape);
    return item;
  }

  async updateItem(senderId, kind, itemId, input) {
    const shape = await this._loadShape(senderId);
    if (!Array.isArray(shape[kind])) throw new Error('סוג פריט לא מוכר');
    const i = shape[kind].findIndex(x => x.id === itemId);
    if (i < 0) throw new Error('הפריט לא נמצא');
    const clean = this._validateItem(kind, { ...shape[kind][i], ...input });
    shape[kind][i] = { ...shape[kind][i], ...clean, updatedAt: new Date().toISOString() };
    await this._saveShape(senderId, shape);
    return shape[kind][i];
  }

  async deleteItem(senderId, kind, itemId) {
    const shape = await this._loadShape(senderId);
    if (!Array.isArray(shape[kind])) throw new Error('סוג פריט לא מוכר');
    const before = shape[kind].length;
    shape[kind] = shape[kind].filter(x => x.id !== itemId);
    if (shape[kind].length === before) throw new Error('הפריט לא נמצא');
    await this._saveShape(senderId, shape);
    return true;
  }

  // הערוצים הישנים נשמרים לתאימות — עוברים כעת באותה ולידציה
  async addIncome(senderId, data) { return this.addItem(senderId, 'incomes', data); }
  async addExpense(senderId, data) { return this.addItem(senderId, 'expenses', data); }
  async addInvestment(senderId, data) { return this.addItem(senderId, 'investments', data); }
  async addCashFlowEntry(senderId, data) { return this.addItem(senderId, 'cashFlowEntries', data); }
}

module.exports = { PersonalFinanceService: new PersonalFinanceService(), ITEM_KINDS };