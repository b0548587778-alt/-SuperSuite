// Mortgage Service - Handles mortgage and loan calculations and scenarios
const crypto = require('crypto');
const { editable } = require('../core/editable');
const { calculateLoan } = require('../utils/calculations');

class MortgageService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    // ה-Database המרכזי מנהל את כל האוספים בטבלת collections — אין צורך בטבלה נפרדת
    if (db) this.db = db;
  }

  async getScenarios(senderId) {
    const data = await this.db.load();
    return this._asShape(data.mortgageScenarios, senderId);
  }

  // מנרמל את האוסף למבנה { userId, scenarios: [] } — תומך גם במערך ישן וגם באובייקט
  _asShape(raw, senderId) {
    if (Array.isArray(raw)) return { userId: senderId, scenarios: raw };
    if (raw && typeof raw === 'object') return { userId: raw.userId || senderId, scenarios: raw.scenarios || [] };
    return { userId: senderId, scenarios: [] };
  }

  async saveScenario(senderId, scenarioData) {
    if (!scenarioData || !scenarioData.name || !scenarioData.principal || !scenarioData.annualRate || !scenarioData.years) {
      throw new Error('יש להזין שם תרחיש, סכום, ריבית ותקופה');
    }
    
    const scenario = {
      id: crypto.randomUUID(),
      name: scenarioData.name,
      principal: Number(scenarioData.principal),
      annualRate: Number(scenarioData.annualRate),
      years: Number(scenarioData.years),
      notes: scenarioData.notes || '',
      createdAt: new Date().toISOString()
    };
    
    const data = await this.db.load();
    const shape = this._asShape(data.mortgageScenarios, senderId);
    shape.userId = senderId;
    shape.scenarios.push(scenario);
    data.mortgageScenarios = shape;
    await this.db.save(data);

    return scenario;
  }

  async deleteScenario(senderId, scenarioId) {
    const existing = await this.getScenarios(senderId);
    const scenarioIndex = existing.scenarios.findIndex(s => s.id === scenarioId);

    if (scenarioIndex === -1) {
      throw new Error('התרחיש לא נמצא');
    }

    const updatedScenarios = existing.scenarios.filter(s => s.id !== scenarioId);

    const data = await this.db.load();
    const shape = this._asShape(data.mortgageScenarios, senderId);
    shape.scenarios = updatedScenarios;
    data.mortgageScenarios = shape;
    await this.db.save(data);

    return true;
  }

  async updateScenario(senderId, scenarioId, updates) {
    const existing = await this.getScenarios(senderId);
    const scenarioIndex = existing.scenarios.findIndex(s => s.id === scenarioId);
    
    if (scenarioIndex === -1) {
      throw new Error('התרחיש לא נמצא');
    }
    
    const scenario = { 
      ...existing.scenarios[scenarioIndex], 
      ...editable(updates), 
      updatedAt: new Date().toISOString() 
    };
    
    const updatedScenarios = existing.scenarios.map((s, index) => {
      if (index === scenarioIndex) return scenario;
      return s;
    });

    const data = await this.db.load();
    const shape = this._asShape(data.mortgageScenarios, senderId);
    shape.scenarios = updatedScenarios;
    data.mortgageScenarios = shape;
    await this.db.save(data);

    return scenario;
  }

  async calculateLoan(loanData) {
    if (!loanData) {
      throw new Error('חסרים נתוני ההלוואה');
    }
    
    const { principal, annualRate, years } = loanData;
    
    if (principal === undefined || principal === null ||
        annualRate === undefined || annualRate === null ||
        years === undefined || years === null) {
      throw new Error('יש להזין סכום, ריבית ותקופה');
    }

    const principalNum = Number(principal);
    const annualRateNum = Number(annualRate);
    const yearsNum = Number(years);

    if (principalNum <= 0 || annualRateNum < 0 || yearsNum <= 0) {
      throw new Error('נתוני ההלוואה אינם תקינים (סכום ותקופה חיוביים, ריבית לא שלילית)');
    }
    
    // Use the core calculation function
    return calculateLoan({
      principal: principalNum,
      annualRate: annualRateNum / 100, // Convert percentage to decimal
      years: yearsNum
    });
  }

  async getScenarioSummary(senderId) {
    const scenarios = await this.getScenarios(senderId);
    
    if (!scenarios || !scenarios.scenarios || scenarios.scenarios.length === 0) {
      return { totalScenarios: 0, scenarios: [] };
    }
    
    const summary = scenarios.scenarios.map(scenario => {
      const loanCalc = calculateLoan({
        principal: scenario.principal,
        annualRate: scenario.annualRate / 100,
        years: scenario.years
      });
      
      return {
        ...scenario,
        monthlyPayment: loanCalc.monthlyPayment,
        totalPaid: loanCalc.totalPaid,
        totalInterest: loanCalc.totalInterest
      };
    });
    
    return {
      totalScenarios: summary.length,
      scenarios: summary
    };
  }
}

module.exports = { MortgageService: new MortgageService() };