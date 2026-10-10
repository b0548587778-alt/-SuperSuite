// Personal Finance Service - Handles personal financial planning and calculations
const crypto = require('crypto');
const { calculateLoan } = require('../utils/calculations');

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

  async updateFinance(senderId, financeData) {
    if (!financeData) {
      throw new Error('Financial data is required');
    }
    
    // Validate required fields
    const validData = {
      userId: senderId,
      planName: financeData.planName || 'התוכנית הפיננסית שלי',
      currency: financeData.currency || 'ILS',
      incomes: Array.isArray(financeData.incomes) ? financeData.incomes : [],
      expenses: Array.isArray(financeData.expenses) ? financeData.expenses : [],
      investments: Array.isArray(financeData.investments) ? financeData.investments : [],
      cashFlowEntries: Array.isArray(financeData.cashFlowEntries) ? financeData.cashFlowEntries : []
    };
    
    await this._saveShape(senderId, this._asShape(validData, senderId));

    return validData;
  }

  async calculateLoan(loanData) {
    if (!loanData) {
      throw new Error('Loan data is required');
    }
    
    const { principal, annualRate, years } = loanData;
    
    // בדיקה לערכים חסרים (מאפשר ריבית 0 שהיא מקרה חוקי)
    if (principal === undefined || principal === null ||
        annualRate === undefined || annualRate === null ||
        years === undefined || years === null) {
      throw new Error('Principal, annual rate, and years are required');
    }
    
    const principalNum = Number(principal);
    const annualRateNum = Number(annualRate);
    const yearsNum = Number(years);
    
    if (principalNum <= 0 || annualRateNum < 0 || yearsNum <= 0) {
      throw new Error('Invalid loan parameters');
    }
    
    // Use the core calculation function
    return calculateLoan({
      principal: principalNum,
      annualRate: annualRateNum / 100, // Convert percentage to decimal
      years: yearsNum
    });
  }

  async addIncome(senderId, incomeData) {
    if (!incomeData || !incomeData.source || !incomeData.amount) {
      throw new Error('Income source and amount are required');
    }
    
    const income = {
      id: crypto.randomUUID(),
      source: incomeData.source,
      category: incomeData.category || 'salary',
      amount: Number(incomeData.amount),
      frequency: incomeData.frequency || 'monthly',
      notes: incomeData.notes || '',
      createdAt: new Date().toISOString()
    };
    
    const shape = await this._loadShape(senderId);
    shape.incomes.push(income);
    await this._saveShape(senderId, shape);

    return income;
  }

  async addExpense(senderId, expenseData) {
    if (!expenseData || !expenseData.category || !expenseData.amount) {
      throw new Error('Expense category and amount are required');
    }
    
    const expense = {
      id: crypto.randomUUID(),
      category: expenseData.category,
      description: expenseData.description || '',
      amount: Number(expenseData.amount),
      frequency: expenseData.frequency || 'monthly',
      isFixed: expenseData.isFixed !== undefined ? expenseData.isFixed : true,
      notes: expenseData.notes || '',
      createdAt: new Date().toISOString()
    };
    
    const shape = await this._loadShape(senderId);
    shape.expenses.push(expense);
    await this._saveShape(senderId, shape);

    return expense;
  }

  async addInvestment(senderId, investmentData) {
    if (!investmentData || !investmentData.name || !investmentData.principal || !investmentData.annualRate || !investmentData.years) {
      throw new Error('Investment name, principal, annual rate, and years are required');
    }
    
    const investment = {
      id: crypto.randomUUID(),
      name: investmentData.name,
      type: investmentData.type || 'stocks-etf',
      principal: Number(investmentData.principal),
      monthlyContribution: Number(investmentData.monthlyContribution) || 0,
      annualRate: Number(investmentData.annualRate),
      years: Number(investmentData.years),
      notes: investmentData.notes || '',
      createdAt: new Date().toISOString()
    };
    
    const shape = await this._loadShape(senderId);
    shape.investments.push(investment);
    await this._saveShape(senderId, shape);

    return investment;
  }

  async addCashFlowEntry(senderId, cashFlowData) {
    if (!cashFlowData || !cashFlowData.type || !cashFlowData.amount) {
      throw new Error('Cash flow type and amount are required');
    }
    
    const entry = {
      id: crypto.randomUUID(),
      date: cashFlowData.date || new Date().toISOString().split('T')[0],
      type: cashFlowData.type, // income or expense
      amount: Number(cashFlowData.amount),
      description: cashFlowData.description || '',
      category: cashFlowData.category || '',
      createdAt: new Date().toISOString()
    };
    
    const shape = await this._loadShape(senderId);
    shape.cashFlowEntries.push(entry);
    await this._saveShape(senderId, shape);

    return entry;
  }
}

module.exports = { PersonalFinanceService: new PersonalFinanceService() };