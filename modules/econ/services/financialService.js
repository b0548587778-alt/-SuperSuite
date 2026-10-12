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

  // חישובי ROI וריבית דריבית חיים ב-utils/calculations.js בלבד.
  // היו כאן שתי עטיפות duplicate שאיש לא קרא להן (ל-service אין require ל-utils) — הוסרו.

}

module.exports = { FinancialService: new FinancialService() };