// Financial Service - Handles financial calculations and analysis
const { calculateFinancialMetrics, exportToCSV, escapeCSV, validateCSVData } = require('../core/financial');

class FinancialService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    // FinancialService עורך חישובים טהורים ואינו נשען על מסד נתונים
    if (db) this.db = db;
  }

  async calculateMetrics(records, budgets, cashFlow) {
    // Use the core financial calculation function
    const metrics = calculateFinancialMetrics(records || [], budgets || [], cashFlow || []);
    
    // Add additional analysis
    const recordsArray = Array.isArray(records) ? records : [];
    
    // Calculate category breakdown
    const categoryBreakdown = recordsArray.reduce((acc, record) => {
      const category = record.category || 'uncategorized';
      if (!acc[category]) {
        acc[category] = { count: 0, total: 0 };
      }
      acc[category].count++;
      acc[category].total += Number(record.amount) || 0;
      return acc;
    }, {});
    
    // Calculate monthly trends (last 12 months)
    const monthlyTrends = recordsArray.reduce((acc, record) => {
      const recordDate = new Date(record.date);
      if (!isNaN(recordDate.getTime())) {
        const monthKey = `${recordDate.getFullYear()}-${String(recordDate.getMonth() + 1).padStart(2, '0')}`;
        if (!acc[monthKey]) {
          acc[monthKey] = { income: 0, expense: 0 };
        }
        if (record.type === 'income' || record.type === 'donation') {
          acc[monthKey].income += Number(record.amount) || 0;
        } else {
          acc[monthKey].expense += Number(record.amount) || 0;
        }
      }
      return acc;
    }, {});
    
    return {
      ...metrics,
      categoryBreakdown,
      monthlyTrends: Object.entries(monthlyTrends).sort(([a], [b]) => a.localeCompare(b))
    };
  }

  async exportToCSV(data, filename = 'export.csv') {
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Data is missing or empty');
    }
    
    // Validate data structure
    if (!validateCSVData(data)) {
      throw new Error('Invalid data format for CSV export');
    }
    
    return exportToCSV(data, filename);
  }

  // Calculate ROI
  async calculateROI(investment, returns) {
    if (!investment || !returns) {
      throw new Error('Investment and returns values are required');
    }
    
    const investmentNum = Number(investment);
    const returnsNum = Number(returns);
    
    if (investmentNum <= 0) {
      throw new Error('Investment must be greater than zero');
    }
    
    const roi = ((returnsNum - investmentNum) / investmentNum) * 100;
    return {
      investment: investmentNum,
      returns: returnsNum,
      roi: roi.toFixed(2) + '%',
      profit: returnsNum - investmentNum
    };
  }

  // Calculate compound interest
  async calculateCompoundInterest(principal, rate, years, monthlyContribution = 0) {
    // בדיקה לערכים חסרים (מאפשר ריבית 0 שהיא מקרה חוקי)
    if (principal === undefined || principal === null ||
        rate === undefined || rate === null ||
        years === undefined || years === null) {
      throw new Error('Principal, rate, and years are required');
    }

    const p = Number(principal);
    const r = Number(rate) / 100; // Convert percentage to decimal
    const y = Number(years);
    const m = Number(monthlyContribution) || 0;
    
    if (p < 0 || r < 0 || y < 0 || m < 0) {
      throw new Error('Values cannot be negative');
    }
    
    // Handle zero interest rate case
    let futureValue;
    if (r === 0) {
      futureValue = p + (m * 12 * y);
    } else {
      // Compound interest formula with monthly contributions
      futureValue = p * Math.pow(1 + r / 12, y * 12) + (m * (Math.pow(1 + r / 12, y * 12) - 1) / (r / 12));
    }
    const totalContributed = p + (m * 12 * y);
    const totalInterest = futureValue - totalContributed;
    
    return {
      principal: p,
      annualRate: r * 100,
      years: y,
      monthlyContribution: m,
      totalContributed,
      futureValue: Math.round(futureValue * 100) / 100,
      totalInterest: Math.round(totalInterest * 100) / 100
    };
  }
}

module.exports = { FinancialService: new FinancialService() };