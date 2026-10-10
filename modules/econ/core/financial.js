// Financial calculations and export utilities
function calculateFinancialMetrics(records, budgets, cashFlow) {
    const recordsArray = Array.isArray(records) ? records : [];
    const income = recordsArray
        .filter(r => r.type === 'income' || r.type === 'donation')
        .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

    const expense = recordsArray
        .filter(r => r.type === 'expense')
        .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

    const vat = recordsArray
        .filter(r => (r.type === 'income' || r.type === 'donation') && r.vat)
        .reduce((sum, r) => sum + (Number(r.vat) || 0), 0);

    const netIncome = income - vat;
    const profit = netIncome - expense;

    return {
        grossIncome: income,
        vat,
        netIncome,
        totalExpense: expense,
        profit,
        profitMargin: income > 0 ? ((profit / income) * 100).toFixed(2) + '%' : 'N/A',
        recordCount: recordsArray.length,
        expenseCount: recordsArray.filter(r => r.type === 'expense').length,
        incomeCount: recordsArray.filter(r => r.type === 'income' || r.type === 'donation').length
    };
}

function exportToCSV(data, fileName = 'export.csv') {
    if (!Array.isArray(data) || data.length === 0) {
        throw new Error('נתונים חסרים או ריקים');
    }

    // Get all unique keys from all objects
    const keys = [...new Set(data.flatMap(obj => Object.keys(obj)))];

    // Create header row with Hebrew BOM for proper encoding
    const header = keys.map(k => `"${escapeCSV(String(k))}"`).join(',');

    // Create data rows
    const rows = data.map(obj =>
        keys.map(key => {
            const value = obj[key];
            if (value === null || value === undefined) return '""';
            if (typeof value === 'number') return value.toString();
            return `"${escapeCSV(String(value))}"`;
        }).join(',')
    );

    const csv = '\ufeff' + header + '\r\n' + rows.join('\r\n');

    if (typeof window === 'undefined') {
        // Node.js environment
        const fs = require('fs');
        fs.writeFileSync(fileName, csv, { encoding: 'utf8', mode: 0o644 });
        return fileName;
    } else {
        // Browser environment
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(link.href);
        return fileName;
    }
}

function escapeCSV(value) {
    return String(value ?? '').replace(/"/g, '""');
}

function validateCSVData(data) {
    if (!Array.isArray(data)) return false;
    if (data.length === 0) return true;
    return data.every(item => item && typeof item === 'object' && !Array.isArray(item));
}

module.exports = { calculateFinancialMetrics, exportToCSV, escapeCSV, validateCSVData };