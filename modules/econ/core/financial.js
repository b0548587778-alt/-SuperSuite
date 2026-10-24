// Financial calculations — הכול בשלמי אגורות (כלל הברזל 1): 0.1 + 0.2 לא יוצא 0.30000000000000004
const toAg = (n) => { const a = Math.round(Number(n) * 100); return Number.isFinite(a) ? a : 0; };
const fromAg = (a) => a / 100;
const isIncome = (r) => r && (r.type === 'income' || r.type === 'donation');
const isExpense = (r) => r && r.type === 'expense';

function calculateFinancialMetrics(records, budgets, cashFlow) {
    const recordsArray = Array.isArray(records) ? records : [];
    const incomeAg = recordsArray.filter(isIncome).reduce((sum, r) => sum + toAg(r.amount), 0);
    const expenseAg = recordsArray.filter(isExpense).reduce((sum, r) => sum + toAg(r.amount), 0);
    const vatAg = recordsArray.filter(r => isIncome(r) && r.vat).reduce((sum, r) => sum + toAg(r.vat), 0);

    const netIncomeAg = incomeAg - vatAg;
    const profitAg = netIncomeAg - expenseAg;

    return {
        grossIncome: fromAg(incomeAg),
        vat: fromAg(vatAg),
        netIncome: fromAg(netIncomeAg),
        totalExpense: fromAg(expenseAg),
        profit: fromAg(profitAg),
        // אחוז עם שתי ספרות — מחלוקת שלמים (נקודות בסיס), לא מנקודה צפה
        profitMargin: incomeAg > 0 ? (Math.round(profitAg * 10000 / incomeAg) / 100).toFixed(2) + '%' : 'N/A',
        recordCount: recordsArray.length,
        expenseCount: recordsArray.filter(isExpense).length,
        incomeCount: recordsArray.filter(isIncome).length
    };
}

// ייצוא CSV נעשה רק דרך חלון שמירה בתהליך הראשי (saveCsv ב-ipc.js). כתיבה לנתיב שהמסך בוחר הוסרה (בדיקת קוד 23.10.2026, ממצא 6)
module.exports = { calculateFinancialMetrics };