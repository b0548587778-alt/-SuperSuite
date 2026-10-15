// ממשק המודול הכלכלי — סכימות הטפסים והנהלת החשבונות (דוחות, יומן, חשבוניות, מחירון, הוצאות אישיות).
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

// ============================================================
// הגדרת טפסים לכל תצוגה — שדה, תווית, סוג, חובה
// ============================================================
const formSchemas = {
  'tasks': {
    title: 'משימה חדשה',
    fields: [
      { name: 'title', label: 'כותרת', type: 'text', required: true },
      { name: 'description', label: 'תיאור', type: 'textarea' },
      { name: 'category', label: 'קטגוריה', type: 'select', options: [
        { value: 'work', label: 'עבודה' },
        { value: 'personal', label: 'אישי' },
        { value: 'finance', label: 'כספים' },
        { value: 'other', label: 'אחר' }
      ]},
      { name: 'priority', label: 'עדיפות', type: 'select', options: [
        { value: 'low', label: 'נמוכה' },
        { value: 'medium', label: 'בינונית' },
        { value: 'high', label: 'גבוהה' }
      ]},
      { name: 'status', label: 'סטטוס', type: 'select', options: [
        { value: 'todo', label: 'לביצוע' },
        { value: 'in-progress', label: 'בתהליך' },
        { value: 'done', label: 'הושלם' }
      ]},
      { name: 'dueDate', label: 'תאריך יעד', type: 'date' }
    ],
    create: (data) => window.systemAPI.createTask(data),
    update: (id, data) => window.systemAPI.updateTask(id, data),
    remove: (id) => window.systemAPI.deleteTask(id)
  },
  'contacts': {
    title: 'איש קשר חדש',
    searchable: true,
    fields: [
      { name: 'name', label: 'שם', type: 'text', required: true },
      { name: 'email', label: 'דוא"ל', type: 'email' },
      { name: 'phone', label: 'טלפון', type: 'tel' },
      { name: 'company', label: 'חברה', type: 'text' },
      { name: 'role', label: 'תפקיד', type: 'text' },
      { name: 'address', label: 'כתובת', type: 'text' },
      { name: 'notes', label: 'הערות', type: 'textarea' }
    ],
    create: (data) => window.systemAPI.createContact(data),
    update: (id, data) => window.systemAPI.updateContact(id, data),
    remove: (id) => window.systemAPI.deleteContact(id),
    search: (q) => window.systemAPI.searchContacts(q)
  },
  'business': {
    title: 'תוכנית עסקית חדשה',
    fields: [
      { name: 'name', label: 'שם התוכנית', type: 'text', required: true },
      { name: 'description', label: 'תיאור', type: 'textarea' },
      { name: 'industry', label: 'תעשייה', type: 'text' },
      { name: 'targetMarket', label: 'שוק יעד', type: 'text' },
      { name: 'startupCost', label: 'עלות הקמה (₪)', type: 'number' },
      { name: 'projectedRevenue', label: 'הכנסה צפויה (₪)', type: 'number' }
    ],
    create: (data) => window.systemAPI.saveBusinessPlan(data),
    update: (id, data) => window.systemAPI.updateBusinessPlan(id, data),
    remove: (id) => window.systemAPI.deleteBusinessPlan(id)
  },
  'market-intel': {
    title: 'רשומת מודיעין שוק חדשה',
    fields: [
      { name: 'title', label: 'כותרת', type: 'text', required: true },
      { name: 'description', label: 'תיאור', type: 'textarea' },
      { name: 'sourceType', label: 'סוג מקור', type: 'select', options: [
        { value: 'news', label: 'חדשות' },
        { value: 'report', label: 'דוח' },
        { value: 'social', label: 'רשתות' },
        { value: 'internal', label: 'פנימי' },
        { value: 'other', label: 'אחר' }
      ]},
      { name: 'credibility', label: 'אמינות', type: 'select', options: [
        { value: 'low', label: 'נמוכה' },
        { value: 'medium', label: 'בינונית' },
        { value: 'high', label: 'גבוהה' }
      ]},
      { name: 'impactDirection', label: 'כיוון השפעה', type: 'select', options: [
        { value: 'positive', label: 'חיובי' },
        { value: 'neutral', label: 'ניטרלי' },
        { value: 'negative', label: 'שלילי' }
      ]}
    ],
    create: (data) => window.systemAPI.updateMarketIntel(data),
    // עריכת רשומת מודיעין בודדת — הערוץ marketIntel:updateEntry קיים ב-ipc.js
    // ובשירות (מיזוג שדות), אך ה-UI מעולם לא חיבר אליו כפתור עריכה.
    update: (id, data) => window.systemAPI.updateMarketIntelEntry(id, data),
    remove: (id) => window.systemAPI.deleteMarketIntelEntry(id)
  },
  'mortgage': {
    title: 'תרחיש הלוואה חדש',
    fields: [
      { name: 'name', label: 'שם התרחיש', type: 'text', required: true },
      { name: 'principal', label: 'סכום ההלוואה (₪)', type: 'number', required: true },
      { name: 'annualRate', label: 'ריבית שנתית (%)', type: 'number', required: true },
      { name: 'years', label: 'תקופה (שנים)', type: 'number', required: true }
    ],
    create: (data) => window.systemAPI.saveMortgageScenario(data),
    update: (id, data) => window.systemAPI.updateMortgageScenario(id, data),
    remove: (id) => window.systemAPI.deleteMortgageScenario(id)
  },
  'voice-notes': {
    title: 'הערה קולית חדשה',
    searchable: true,
    fields: [
      { name: 'title', label: 'כותרת', type: 'text', required: true },
      { name: 'description', label: 'תיאור', type: 'textarea' },
      { name: 'duration', label: 'משך (שניות)', type: 'number' },
      { name: 'audioPath', label: 'נתיב קובץ שמע', type: 'text' },
      { name: 'notes', label: 'תמלול / הערות', type: 'textarea' }
    ],
    create: (data) => window.systemAPI.createVoiceNote(data),
    update: (id, data) => window.systemAPI.updateVoiceNote(id, data),
    remove: (id) => window.systemAPI.deleteVoiceNote(id),
    search: (q) => window.systemAPI.searchVoiceNotes(q)
  },
  'canvas': {
    title: 'לוח חדש',
    fields: [
      { name: 'boardName', label: 'שם הלוח', type: 'text', required: true },
      { name: 'description', label: 'תיאור', type: 'textarea' }
    ],
    create: (data) => window.systemAPI.saveCanvasBoard(data),
    update: (id, data) => window.systemAPI.updateCanvasBoard(id, data),
    remove: (id) => window.systemAPI.deleteCanvasBoard(id)
  },
  'fitness': {
    title: 'רשומת כושר חדשה',
    // טופס אחד עם בחירת סוג — השדות מוחלפים לפי הסוג הנבחר
    dynamic: true,
    fields: [
      { name: 'fitnessKind', label: 'סוג הרשומה', type: 'select', required: true, options: [
        { value: 'workout', label: 'אימון' },
        { value: 'nutrition', label: 'תזונה' },
        { value: 'metric', label: 'מדד גוף' }
      ]},
      // אימון
      { name: 'date', label: 'תאריך', type: 'date', required: true, kinds: ['workout', 'nutrition', 'metric'] },
      { name: 'type', label: 'סוג האימון', type: 'select', required: true, kinds: ['workout'], options: [
        { value: 'cardio', label: 'אירובי' },
        { value: 'strength', label: 'כוח' },
        { value: 'yoga', label: 'יוגה' },
        { value: 'walking', label: 'הליכה' },
        { value: 'sports', label: 'ספורט' },
        { value: 'other', label: 'אחר' }
      ]},
      { name: 'durationMinutes', label: 'משך (דקות)', type: 'number', required: true, kinds: ['workout'] },
      { name: 'caloriesBurned', label: 'קלוריות שנשרפו', type: 'number', kinds: ['workout'] },
      // תזונה
      { name: 'mealType', label: 'סוג הארוחה', type: 'select', required: true, kinds: ['nutrition'], options: [
        { value: 'breakfast', label: 'בוקר' },
        { value: 'lunch', label: 'צהריים' },
        { value: 'dinner', label: 'ערב' },
        { value: 'snack', label: 'ביניים' }
      ]},
      { name: 'calories', label: 'קלוריות', type: 'number', required: true, kinds: ['nutrition'] },
      { name: 'description', label: 'תיאור הארוחה', type: 'text', kinds: ['nutrition'] },
      // מדד
      { name: 'weightKg', label: 'משקל (ק"ג)', type: 'number', kinds: ['metric'] },
      { name: 'bodyFatPercent', label: 'אחוז שומן (%)', type: 'number', kinds: ['metric'] },
      // הערות — לכל הסוגים
      { name: 'notes', label: 'הערות', type: 'textarea', kinds: ['workout', 'nutrition', 'metric'] }
    ],
    create: (data) => {
      const kind = data.fitnessKind;
      const base = { date: data.date, notes: data.notes };
      if (kind === 'workout') {
        return window.systemAPI.createWorkout({
          ...base, type: data.type,
          durationMinutes: data.durationMinutes, caloriesBurned: data.caloriesBurned
        });
      }
      if (kind === 'nutrition') {
        return window.systemAPI.createNutrition({
          ...base, mealType: data.mealType,
          calories: data.calories, description: data.description
        });
      }
      return window.systemAPI.createMetric({
        ...base, weightKg: data.weightKg, bodyFatPercent: data.bodyFatPercent
      });
    }
  }
};

// תצוגות ללא טופס הוספה (מחושבות/מצטברות בלבד)
// ============================================================
// הנהלת חשבונות — דוחות, יומן, חשבוניות ותוכנית חשבונות
// ============================================================
// צבע לפי סימן: אפס נשאר ניטרלי (לא ירוק)
const tone = (v) => (Number(v) < 0 ? 'neg' : Number(v) > 0 ? 'pos' : '');
const money = (n) => '₪' + Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isoDate = (d) => d.toISOString().slice(0, 10);
const yearStart = () => isoDate(new Date(new Date().getFullYear(), 0, 1));
const today = () => isoDate(new Date());
const acctPeriod = () => state.acctPeriod || (state.acctPeriod = { from: yearStart(), to: today() });
const ACCT_STATUS = { open: 'פתוחה', paid: 'שולמה', cancelled: 'בוטלה' };
const ACCT_TYPE_LABELS = { asset: 'נכס', liability: 'התחייבות', equity: 'הון', revenue: 'הכנסה', expense: 'הוצאה' };

function accountOptions(chart) {
  return (chart || []).map(a => ({ value: a.code, label: `${a.code} · ${a.name}` }));
}

// הגנת עומק לדוחות: דוח חלקי (גרסת נתונים ישנה / תקופה בלי תנועות) לא מפיל את התצוגה.
// כל שדה נדרש מנורמל כאן, ורק מכאן והלאה הרינדור יכול להניח צורה מלאה.
function normalizeAcctReports(r) {
  const num = (v) => Number(v) || 0;
  const list = (v) => (Array.isArray(v) ? v : []);
  const o = (v) => (v && typeof v === 'object' ? v : {});
  const summary = o(r.summary), analytics = o(r.analytics),
        incomeStatement = o(r.incomeStatement), balanceSheet = o(r.balanceSheet),
        vat = o(r.vat), aged = o(r.aged), trialBalance = o(r.trialBalance);
  return {
    period: o(r.period),
    lockDate: r.lockDate,
    vatRate: num(r.vatRate),
    openInvoices: num(r.openInvoices),
    summary: { income: num(summary.income), expenses: num(summary.expenses),
               vatPayable: num(summary.vatPayable), profit: num(summary.profit) },
    analytics: { totalInvoices: num(analytics.totalInvoices), totalRevenue: num(analytics.totalRevenue),
                 customers: num(analytics.customers), repeatShare: num(analytics.repeatShare),
                 repeatCustomers: list(analytics.repeatCustomers), monthly: list(analytics.monthly) },
    incomeStatement: { revenue: list(incomeStatement.revenue), expenses: list(incomeStatement.expenses),
                       totalRevenue: num(incomeStatement.totalRevenue), totalExpenses: num(incomeStatement.totalExpenses),
                       netProfit: num(incomeStatement.netProfit) },
    balanceSheet: { balanced: !!balanceSheet.balanced, assets: list(balanceSheet.assets),
                    liabilities: list(balanceSheet.liabilities), equity: list(balanceSheet.equity),
                    totalAssets: num(balanceSheet.totalAssets), totalLiabilities: num(balanceSheet.totalLiabilities),
                    totalEquity: num(balanceSheet.totalEquity) },
    vat: { outputVat: num(vat.outputVat), inputVat: num(vat.inputVat), netPayable: num(vat.netPayable) },
    aged: { buckets: list(aged.buckets) },
    trialBalance: { rows: list(trialBalance.rows), balanced: !!trialBalance.balanced,
                    totalDebit: num(trialBalance.totalDebit), totalCredit: num(trialBalance.totalCredit) }
  };
}

function renderAcctReports(raw) {
  if (!raw) return renderEmpty('אין נתונים להצגה');
  const r = normalizeAcctReports(raw);
  const rows = (list) => (list || []).map(x => `<div class="acct-row"><span>${esc(x.code)} ${esc(x.name)}</span><span>${money(x.amount)}</span></div>`).join('') || '<div class="acct-row muted">אין תנועות</div>';
  const tbRows = r.trialBalance.rows.map(x => `<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td>${money(x.debit)}</td><td>${money(x.credit)}</td><td>${money(x.balance)}</td></tr>`).join('');
  return `
    <div class="acct-header">
      <div>תקופה: ${esc(r.period.from || 'מההתחלה')} — ${esc(r.period.to)} · שיעור מע"מ: ${(r.vatRate * 100).toFixed(2)}%${r.lockDate ? ` · תקופה נעולה עד ${esc(r.lockDate)}` : ''}</div>
      <div class="acct-actions">
        <button class="secondary" id="acctCsvSummary">ייצוא סיכום תקופתי ל-Excel</button>
        <button class="secondary" id="acctCsvTb">ייצוא מאזן בוחן ל-Excel</button>
        <button class="secondary" id="acctPeriodBtn">החלף תקופה</button>
      </div>
    </div>
    <div class="acct-grid">
      <div class="card">
        <h3>סיכום תקופתי</h3>
        <div class="acct-row"><span>הכנסות</span><span>${money(r.summary.income)}</span></div>
        <div class="acct-row"><span>הוצאות</span><span>${money(r.summary.expenses)}</span></div>
        <div class="acct-row"><span>מע"מ לתשלום (עסקאות פחות תשומות)</span><span>${money(r.summary.vatPayable)}</span></div>
        <div class="acct-row acct-big ${tone(r.summary.profit)}"><span>רווח (הפסד) לפני מע"מ</span><span>${money(r.summary.profit)}</span></div>
      </div>
      <div class="card">
        <h3>ניתוח חשבוניות</h3>
        <div class="acct-row"><span>חשבוניות פעילות</span><span>${r.analytics.totalInvoices}</span></div>
        <div class="acct-row"><span>סה"כ מחזור</span><span>${money(r.analytics.totalRevenue)}</span></div>
        <div class="acct-row"><span>לקוחות שונים / חוזרים</span><span>${r.analytics.customers} / ${r.analytics.repeatCustomers.length} (${r.analytics.repeatShare}%)</span></div>
        <h4>חשבוניות לפי חודש</h4>
        ${r.analytics.monthly.slice(-6).map(m => `<div class="acct-row"><span>${esc(m.month)} <span class="muted">(${m.count})</span></span><span>${money(m.total)}</span></div>`).join('') || '<div class="acct-row muted">אין חשבוניות</div>'}
        <h4>לקוחות חוזרים</h4>
        ${r.analytics.repeatCustomers.slice(0, 5).map(c => `<div class="acct-row"><span>${esc(c.customer)} <span class="muted">(${c.count})</span></span><span>${money(c.total)}</span></div>`).join('') || '<div class="acct-row muted">אין לקוחות חוזרים עדיין</div>'}
      </div>
      <div class="card">
        <h3>רווח והפסד</h3>
        <h4>הכנסות</h4>${rows(r.incomeStatement.revenue)}
        <div class="acct-row acct-total"><span>סה"כ הכנסות</span><span>${money(r.incomeStatement.totalRevenue)}</span></div>
        <h4>הוצאות</h4>${rows(r.incomeStatement.expenses)}
        <div class="acct-row acct-total"><span>סה"כ הוצאות</span><span>${money(r.incomeStatement.totalExpenses)}</span></div>
        <div class="acct-row acct-big ${tone(r.incomeStatement.netProfit)}"><span>רווח (הפסד) נקי</span><span>${money(r.incomeStatement.netProfit)}</span></div>
      </div>
      <div class="card">
        <h3>מאזן ${r.balanceSheet.balanced ? '<span class="ok">✓ מאוזן</span>' : '<span class="bad">⚠ לא מאוזן</span>'}</h3>
        <h4>נכסים</h4>${rows(r.balanceSheet.assets)}
        <div class="acct-row acct-total"><span>סה"כ נכסים</span><span>${money(r.balanceSheet.totalAssets)}</span></div>
        <h4>התחייבויות</h4>${rows(r.balanceSheet.liabilities)}
        <h4>הון</h4>${rows(r.balanceSheet.equity)}
        <div class="acct-row acct-total"><span>סה"כ התחייבויות והון</span><span>${money(r.balanceSheet.totalLiabilities + r.balanceSheet.totalEquity)}</span></div>
      </div>
      <div class="card">
        <h3>דוח מע"מ לתקופה</h3>
        <div class="acct-row"><span>מע"מ עסקאות (שהוצא)</span><span>${money(r.vat.outputVat)}</span></div>
        <div class="acct-row"><span>מע"מ תשומות (זיכוי)</span><span>${money(r.vat.inputVat)}</span></div>
        <div class="acct-row acct-big ${tone(-r.vat.netPayable)}"><span>${r.vat.netPayable >= 0 ? 'לתשלום לרשות המסים' : 'זכות לקבל'}</span><span>${money(Math.abs(r.vat.netPayable))}</span></div>
      </div>
      <div class="card">
        <h3>גיול חייבים</h3>
        ${r.aged.buckets.map(b => `<div class="acct-row"><span>${esc(b.label)} <span class="muted">(${b.count})</span></span><span>${money(b.total)}</span></div>`).join('')}
        <div class="acct-row acct-big"><span>סה"כ פתוח</span><span>${money(r.openInvoices)}</span></div>
      </div>
      <div class="card acct-wide">
        <h3>מאזן בוחן ${r.trialBalance.balanced ? '<span class="ok">✓ מאוזן</span>' : '<span class="bad">⚠ לא מאוזן</span>'}</h3>
        <div class="acct-scroll"><table class="acct-table">
          <thead><tr><th>קוד</th><th>שם</th><th>חובה</th><th>זכות</th><th>יתרה</th></tr></thead>
          <tbody>${tbRows || '<tr><td colspan="5" class="muted">אין תנועות בתקופה</td></tr>'}</tbody>
          <tfoot><tr><th colspan="2">סה"כ</th><th>${money(r.trialBalance.totalDebit)}</th><th>${money(r.trialBalance.totalCredit)}</th><th></th></tr></tfoot>
        </table></div>
      </div>
    </div>`;
}

function renderAcctJournal(d) {
  const entries = Array.isArray(d?.entries) ? d.entries : [];
  const names = Object.fromEntries((d?.chart || []).map(a => [a.code, a.name]));
  return `
    <div class="acct-header"><h3>רשומות יומן (${entries.length})</h3><button class="secondary" id="acctCsvJournal">ייצוא יומן ל-Excel</button></div>
    ${entries.length === 0 ? renderEmpty('אין רשומות יומן עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
    ${entries.map(e => `
      <div class="card ${e.reversedBy || e.reversalOf ? 'muted-card' : ''}">
        <h4>${esc(e.description || 'ללא תיאור')}</h4>
        <small>${esc(e.date)}${e.reversalOf ? ' · רשומת ביטול' : ''}${e.reversedBy ? ' · בוטלה' : ''}</small>
        <div class="acct-lines">${(Array.isArray(e.lines) ? e.lines : []).map(l => `<div class="acct-row"><span>${esc(l.account)} ${esc(names[l.account] || '')}</span><span>${l.debit ? 'חובה ' + money(l.debit) : 'זכות ' + money(l.credit)}</span></div>`).join('')}</div>
        ${!e.reversedBy && !e.reversalOf ? renderCardActions(e.id) : ''}
      </div>`).join('')}`;
}

function renderAcctInvoices(d) {
  const invoices = Array.isArray(d?.invoices) ? d.invoices : [];
  return `
    <h3>חשבוניות מס (${invoices.length})</h3>
    ${invoices.length === 0 ? renderEmpty('אין חשבוניות עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
    ${invoices.map(i => `
      <div class="card ${i.status === 'paid' ? 'done' : ''} ${i.status === 'cancelled' ? 'muted-card' : ''}">
        <h4>חשבונית ${esc(i.number)} · ${esc(i.customer)}</h4>
        <p>${(Array.isArray(i.items) ? i.items : []).map(it => esc(it.description)).join(', ')}</p>
        <small>${esc(i.date)} · נטו ${money(i.net)} · מע"מ ${money(i.vat)}${i.vatExempt ? ' (פטור)' : ''}</small>
        <div class="acct-row acct-big"><span>${ACCT_STATUS[i.status] || i.status}</span><span>${money(i.total)}</span></div>
        <div class="card-actions">
          <button class="secondary" data-action="pdf" data-id="${esc(i.id)}">הורד PDF</button>
          ${i.status === 'open' ? `<button class="secondary" data-action="pay" data-id="${esc(i.id)}">סמן כשולמה</button>` : ''}
          ${i.status === 'paid' ? `<button class="danger-outline" data-action="unpay" data-id="${esc(i.id)}">בטל תשלום</button>` : ''}
          ${i.status === 'open' ? `<button class="danger-outline" data-action="cancel" data-id="${esc(i.id)}">בטל (חשבונית זיכוי)</button>` : ''}
        </div>
      </div>`).join('')}`;
}

function renderAcctChart(chart) {
  const list = chart || [];
  // טבלה אחת מקובצת לפי סוג החשבון — כרטיס לכל חשבון יצר גלילה של כמה מסכים
  const order = Object.keys(ACCT_TYPE_LABELS);
  const groups = [...order, ...[...new Set(list.map(a => a.type))].filter(t => !order.includes(t))]
    .map(t => [t, list.filter(a => a.type === t)]).filter(([, rows]) => rows.length);
  return `
    <h3>תוכנית חשבונות (${list.length})</h3>
    ${list.length === 0 ? renderEmpty('אין חשבונות בתוכנית') : `
    <div class="card acct-chart-card"><div class="acct-scroll"><table class="acct-table">
      <thead><tr><th>קוד</th><th>שם החשבון</th><th>סוג</th></tr></thead>
      ${groups.map(([t, rows]) => `<tbody>
        <tr class="acct-group"><th colspan="3">${esc(ACCT_TYPE_LABELS[t] || t)} (${rows.length})</th></tr>
        ${rows.map(a => `<tr><td class="num">${esc(a.code)}</td><td>${esc(a.name)}</td><td class="muted">${esc(ACCT_TYPE_LABELS[a.type] || a.type)}</td></tr>`).join('')}
      </tbody>`).join('')}
    </table></div></div>`}`;
}

function renderAcctSettings(st) {
  if (!st) return renderEmpty('אין נתונים להצגה');
  const b = st.business || {};
  const row = (k, v) => `<div class="acct-row"><span>${esc(k)}</span><span>${esc(v || '—')}</span></div>`;
  // שיעור מע"מ חסר/לא מספרי — מציגים "—" ולא "NaN%"
  const vatPct = Number.isFinite(Number(st.vatRate)) ? (Number(st.vatRate) * 100).toFixed(2) + '%' : null;
  return `
    <div class="acct-grid">
      <div class="card">
        <h3>פרטי העסק</h3>
        ${row('שם העסק', b.name)}${row('ע.מ / ח.פ', b.taxId)}${row('כתובת', b.address)}${row('טלפון', b.phone)}${row('דוא"ל', b.email)}
      </div>
      <div class="card">
        <h3>הגדרות חשבונאות</h3>
        ${row('שיעור מע"מ', vatPct)}
        ${row('תקופה נעולה עד', st.lockDate)}
        <p class="muted">אחרי נעילת תקופה לא ניתן לרשום, לבטל או לגבות בתאריך שלפני הנעילה.</p>
      </div>
    </div>`;
}

function renderAcctPricing(products) {
  const list = products || [];
  return `
    <div class="acct-grid">
      <div class="card">
        <h3>מחשבון תמחור</h3>
        <label class="field"><span>עלות (₪)</span><input id="calcCost" type="number" min="0" step="0.01" value="100"></label>
        <label class="field"><span>אחוז רווח (%)</span><input id="calcMarkup" type="number" min="0" step="0.5" value="40"></label>
        <label class="field"><span>פטור ממע"מ</span><select id="calcExempt"><option value="no">לא</option><option value="yes">כן</option></select></label>
        <div id="calcOut" class="acct-lines"></div>
      </div>
    </div>
    <div class="acct-header"><h3>מחירון (${list.length})</h3>
      <div class="acct-actions"><button class="secondary" id="acctImportCsv">ייבוא מחירון מ-CSV</button></div></div>
    ${list.length === 0 ? renderEmpty('אין מוצרים או שירותים עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
    ${list.map(p => {
      // מוצר ישן שנשמר בלי בלוק תמחור מחושב — לא מפיל את כל המחירון
      const pr = (p && typeof p.pricing === 'object' && p.pricing) || {};
      return `
      <div class="card">
        <h4>${esc(p.name)}</h4>
        <small>${p.kind === 'service' ? 'שירות' : 'מוצר'}${p.vatExempt ? ' · פטור ממע"מ' : ''}</small>
        <div class="acct-lines">
          <div class="acct-row"><span>עלות</span><span>${money(pr.cost)}</span></div>
          <div class="acct-row"><span>רווח (${esc(p.markupPct)}%)</span><span>${money(pr.profit)}</span></div>
          <div class="acct-row"><span>מחיר לפני מע"מ</span><span>${money(pr.priceEx)}</span></div>
          <div class="acct-row acct-big"><span>מחיר לצרכן</span><span>${money(pr.priceInc)}</span></div>
        </div>
        ${renderCardActions(p.id)}
      </div>`;
    }).join('')}`;
}

async function refreshCalculator() {
  const out = document.getElementById('calcOut');
  if (!out) return;
  try {
    const r = await window.systemAPI.calcPrice({
      cost: document.getElementById('calcCost').value,
      markupPct: document.getElementById('calcMarkup').value,
      vatExempt: document.getElementById('calcExempt').value === 'yes'
    });
    out.innerHTML = `
      <div class="acct-row"><span>מחיר לפני מע"מ</span><span>${money(r.priceEx)}</span></div>
      <div class="acct-row"><span>מע"מ</span><span>${money(r.vat)}</span></div>
      <div class="acct-row acct-big"><span>מחיר לצרכן</span><span>${money(r.priceInc)}</span></div>
      <div class="acct-row"><span>רווח נקי</span><span>${money(r.profit)}</span></div>
      <div class="acct-row"><span>שיעור רווח ממחיר המכירה</span><span>${r.marginPct}%</span></div>`;
  } catch (error) {
    out.innerHTML = `<div class="bad">${esc(errMsg(error))}</div>`;
  }
}

function renderAcctPersonal(d) {
  const entries = Array.isArray(d?.entries) ? d.entries : [];
  // הגנת עומק: סיכום עשוי לחזור חסר או חסר שדות (גרסת נתונים ישנה / תשובת שרת חלקית).
  // אין להפיל את כל התצוגה בגלל שדה אחד — הכפתור היה מושבת שלא לצורך.
  const raw = d?.summary || {};
  const s = {
    income: Number(raw.income) || 0,
    expense: Number(raw.expense) || 0,
    balance: Number(raw.balance) || 0,
    categories: Array.isArray(raw.categories) ? raw.categories : []
  };
  return `
    <div class="acct-header">
      <div>הוצאות והכנסות אישיות/משפחתיות — <b>נשמרות בנפרד מהיומן העסקי</b> ואינן נכנסות לדוחות המע"מ והרווח של העסק.</div>
      <div class="acct-actions"><button class="secondary" id="acctCsvPersonal">ייצוא ל-Excel</button></div>
    </div>
    <div class="acct-grid">
      <div class="card">
        <h3>סיכום כללי</h3>
        <div class="acct-row"><span>הכנסות</span><span>${money(s.income)}</span></div>
        <div class="acct-row"><span>הוצאות</span><span>${money(s.expense)}</span></div>
        <div class="acct-row acct-big ${tone(s.balance)}"><span>יתרה</span><span>${money(s.balance)}</span></div>
      </div>
      <div class="card">
        <h3>לפי קטגוריה</h3>
        ${s.categories.map(c => `<div class="acct-row"><span>${c.kind === 'income' ? 'הכנסה' : 'הוצאה'} · ${esc(c.category)}</span><span>${money(c.total)}</span></div>`).join('') || '<div class="acct-row muted">אין רשומות</div>'}
      </div>
    </div>
    <div class="acct-header"><h3>רשומות (${entries.length})</h3></div>
    ${entries.length === 0 ? renderEmpty('אין רשומות עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
    ${entries.map(e => `
      <div class="card">
        <h4>${e.kind === 'income' ? '⬆ הכנסה' : '⬇ הוצאה'} · ${esc(e.category)}</h4>
        <small>${esc(e.date)}${e.note ? ' · ' + esc(e.note) : ''}</small>
        <div class="acct-row acct-big"><span></span><span>${money(e.amount)}</span></div>
        ${renderCardActions(e.id)}
      </div>`).join('')}`;
}

async function handleImportCsv() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,text/csv';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const r = await window.systemAPI.importProducts(await file.text());
      const failed = r.errors.length ? ` · ${r.errors.length} שורות נדחו (שורה ${r.errors.slice(0, 5).map(e => e.line).join(', ')})` : '';
      showToast(`יובאו ${r.added} מוצרים${failed}`);
      await switchView(state.currentView);
    } catch (error) {
      showError('שגיאה בייבוא: ' + errMsg(error));
    }
  });
  input.click();
}

async function handleUnpay(id) {
  if (!(await askConfirm('לבטל את סימון התשלום? תיווצר רשומת ביטול ביומן והחשבונית תחזור לפתוחה.'))) return;
  try {
    await window.systemAPI.unrecordPayment(id);
    showToast('התשלום בוטל');
    await switchView(state.currentView);
  } catch (error) {
    showError('שגיאה בביטול תשלום: ' + errMsg(error));
  }
}

async function handleCsv(kind) {
  try {
    const range = kind === 'journal' ? {} : acctPeriod();
    const r = await window.systemAPI.exportAccountingCsv(kind, range);
    if (r.ok) showToast('הקובץ נשמר');
  } catch (error) {
    showError('שגיאה בייצוא: ' + errMsg(error));
  }
}

async function handlePdf(id) {
  try {
    const r = await window.systemAPI.exportInvoicePdf(id);
    if (r.ok) showToast('קובץ ה-PDF נשמר');
  } catch (error) {
    showError('שגיאה בהפקת PDF: ' + errMsg(error));
  }
}

async function fillAccountSelects(schema) {
  const chart = await window.systemAPI.getChart();
  const opts = accountOptions(chart);
  for (const f of schema.fields) if (f.optionsFrom === 'chart') f.options = opts;
}

async function changeAcctPeriod() {
  const values = await askFields('תקופת דוחות (YYYY-MM-DD)', [
    { name: 'from', label: 'מתאריך' },
    { name: 'to', label: 'עד תאריך' }
  ], 'הצג', acctPeriod());
  if (!values) return;
  if (!isoOk(values.from) || !isoOk(values.to) || values.from > values.to) {
    showError('תאריכים לא תקינים — פורמט YYYY-MM-DD ותאריך התחלה לפני סיום');
    return;
  }
  state.acctPeriod = values;
  await switchView('acct-reports');
}
const isoOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

async function handleCancelInvoice(id) {
  if (!(await askConfirm('לבטל את החשבונית? תירשם חשבונית זיכוי שמבטלת את ההכנסה והמע"מ. החשבונית תישאר ברשימה כמבוטלת.'))) return;
  try {
    await window.systemAPI.cancelInvoice(id);
    showToast('החשבונית בוטלה וירשמה חשבונית זיכוי');
    await switchView('acct-invoices');
  } catch (error) {
    showError('שגיאה בביטול: ' + errMsg(error));
  }
}

async function handlePay(id) {
  if (!(await askConfirm('לסמן את החשבונית כשולמה? תירשם גביה לבנק.'))) return;
  try {
    await window.systemAPI.recordPayment(id, { date: today() });
    showToast('החשבונית סומנה כשולמה');
    await switchView('acct-invoices');
  } catch (error) {
    showError('שגיאה בסימון תשלום: ' + errMsg(error));
  }
}

const acctFormSchemas = {
  'acct-journal': {
    title: 'רשומת יומן חדשה',
    prepare: fillAccountSelects,
    fields: [
      { name: 'date', label: 'תאריך', type: 'date', required: true },
      { name: 'description', label: 'תיאור', type: 'text', required: true },
      { name: 'debitAccount', label: 'חשבון חובה', type: 'select', required: true, optionsFrom: 'chart', options: [] },
      { name: 'creditAccount', label: 'חשבון זכות', type: 'select', required: true, optionsFrom: 'chart', options: [] },
      { name: 'amount', label: 'סכום (₪)', type: 'number', required: true }
    ],
    create: (d) => window.systemAPI.createEntry({
      date: d.date, description: d.description,
      lines: [{ account: d.debitAccount, debit: d.amount }, { account: d.creditAccount, credit: d.amount }]
    }),
    remove: (id) => window.systemAPI.reverseEntry(id),
    confirmText: 'לבטל את הרשומה? תירשם רשומת ביטול הפוכה; הרשומה המקורית נשמרת לביקורת.'
  },
  'acct-invoices': {
    title: 'חשבונית מס חדשה',
    prepare: async (schema) => {
      const products = await window.systemAPI.getProducts();
      const pick = schema.fields.find(f => f.name === 'productId');
      pick.options = [{ value: '', label: '— הזנה ידנית —' }, ...products.map(p => ({ value: p.id, label: `${p.name} · ${money(p.pricing.priceEx)} + מע"מ` }))];
      schema.products = products;
    },
    afterRender: () => {
      const sel = document.getElementById('f_productId');
      if (!sel) return;
      sel.addEventListener('change', () => {
        const p = (formSchemas['acct-invoices'].products || []).find(x => x.id === sel.value);
        if (!p) return;
        document.getElementById('f_description').value = p.name;
        document.getElementById('f_unitPrice').value = p.pricing.priceEx;
        document.getElementById('f_kind').value = p.kind;
        document.getElementById('f_vatExempt').value = p.vatExempt ? 'yes' : 'no';
      });
    },
    fields: [
      { name: 'productId', label: 'בחר מהמחירון (אופציונלי)', type: 'select', options: [] },
      { name: 'customer', label: 'שם לקוח', type: 'text', required: true },
      { name: 'date', label: 'תאריך', type: 'date', required: true },
      { name: 'description', label: 'תיאור פריט', type: 'text', required: true },
      { name: 'quantity', label: 'כמות', type: 'number' },
      { name: 'unitPrice', label: 'מחיר ליחידה לפני מע"מ (₪)', type: 'number', required: true },
      { name: 'kind', label: 'סוג', type: 'select', options: [{ value: 'goods', label: 'מוצר' }, { value: 'service', label: 'שירות' }] },
      { name: 'vatExempt', label: 'מע"מ', type: 'select', options: [{ value: 'no', label: 'כולל מע"מ' }, { value: 'yes', label: 'פטור ממע"מ' }] }
    ],
    create: (d) => window.systemAPI.createInvoice({
      customer: d.customer, date: d.date, vatExempt: d.vatExempt === 'yes',
      items: [{ description: d.description, quantity: d.quantity, unitPrice: d.unitPrice, kind: d.kind || 'goods' }]
    })
  },
  'acct-chart': {
    title: 'חשבון חדש',
    fields: [
      { name: 'code', label: 'קוד חשבון (4-6 ספרות)', type: 'text', required: true },
      { name: 'name', label: 'שם החשבון', type: 'text', required: true },
      { name: 'type', label: 'סוג', type: 'select', required: true, options: Object.entries(ACCT_TYPE_LABELS).map(([value, label]) => ({ value, label })) }
    ],
    create: (d) => window.systemAPI.addAccount(d)
  }
};
acctFormSchemas['acct-pricing'] = {
  title: 'מוצר או שירות חדש',
  fields: [
    { name: 'name', label: 'שם המוצר/שירות', type: 'text', required: true },
    { name: 'kind', label: 'סוג', type: 'select', options: [{ value: 'goods', label: 'מוצר' }, { value: 'service', label: 'שירות' }] },
    { name: 'cost', label: 'עלות (₪)', type: 'number', required: true },
    { name: 'markupPct', label: 'אחוז רווח רצוי (%)', type: 'number', required: true },
    { name: 'vatExempt', label: 'מע"מ', type: 'select', options: [{ value: 'no', label: 'כולל מע"מ' }, { value: 'yes', label: 'פטור ממע"מ' }] }
  ],
  create: (d) => window.systemAPI.addProduct({ ...d, vatExempt: d.vatExempt === 'yes' }),
  remove: (id) => window.systemAPI.deleteProduct(id),
  confirmText: 'למחוק את המוצר/השירות מהמחירון?'
};
acctFormSchemas['acct-personal'] = {
  title: 'רשומה אישית/משפחתית',
  fields: [
    { name: 'date', label: 'תאריך (YYYY-MM-DD)', type: 'date', required: true, value: new Date().toISOString().slice(0, 10) },
    { name: 'kind', label: 'סוג', type: 'select', options: [{ value: 'expense', label: 'הוצאה' }, { value: 'income', label: 'הכנסה' }] },
    { name: 'amount', label: 'סכום (₪)', type: 'number', required: true },
    { name: 'category', label: 'קטגוריה (למשל: מזון, חשמל, חינוך)', type: 'text', required: true },
    { name: 'note', label: 'הערה', type: 'text' }
  ],
  create: (d) => window.systemAPI.addPersonalEntry(d),
  remove: (id) => window.systemAPI.deletePersonalEntry(id),
  confirmText: 'למחוק את הרשומה האישית?'
};
acctFormSchemas['acct-settings'] = {
  title: 'הגדרות עסק ומע"מ',
  prepare: async (schema) => {
    const st = await window.systemAPI.getAccountingSettings();
    const b = st.business || {};
    const values = { name: b.name, taxId: b.taxId, address: b.address, phone: b.phone, email: b.email,
      vatPercent: +(st.vatRate * 100).toFixed(2), lockDate: st.lockDate };
    for (const f of schema.fields) f.value = values[f.name] ?? '';
  },
  fields: [
    { name: 'name', label: 'שם העסק', type: 'text', required: true },
    { name: 'taxId', label: 'ע.מ / ח.פ', type: 'text' },
    { name: 'address', label: 'כתובת', type: 'text' },
    { name: 'phone', label: 'טלפון', type: 'text' },
    { name: 'email', label: 'דוא"ל', type: 'text' },
    { name: 'vatPercent', label: 'שיעור מע"מ (%)', type: 'number', required: true },
    { name: 'lockDate', label: 'נעילת תקופה עד (YYYY-MM-DD, השאר ריק לביטול)', type: 'date' }
  ],
  create: (d) => window.systemAPI.saveAccountingSettings({
    business: { name: d.name, taxId: d.taxId, address: d.address, phone: d.phone, email: d.email },
    vatRate: Number(d.vatPercent) / 100,
    lockDate: d.lockDate || ''
  })
};
Object.assign(formSchemas, acctFormSchemas);
