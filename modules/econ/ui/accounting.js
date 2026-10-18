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
// מספר הקצאה (9.2א): המצב מחושב בשרת (getInvoices → allocation, לפי core/allocation.js) — כאן רק תצוגה
const invoiceAllocState = (i) => i.allocation || 'not-required';
function renderAllocLine(i) {
  const st = invoiceAllocState(i);
  if (st === 'assigned') return `<small class="alloc-ok">הקצאה מספר: <span dir="ltr">${esc(String(i.allocationNumber).slice(-9))}</span></small>`;
  if (st === 'waived') return '<small>מספר הקצאה: סומן "לא נדרש"</small>';
  if (st === 'pending') return '<small class="alloc-pending">⚠ דרוש מספר הקצאה מרשות המסים</small>';
  return '';
}
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
        <button class="secondary" id="acctUniformFile" title="INI.TXT ו-BKMVDATA לרשות המסים ולרואה החשבון">קבצים במבנה אחיד</button>
        <button class="secondary" id="acctPcn874" title="קובץ PCN874 לדוח המע&quot;מ המפורט">דוח מע"מ מפורט (PCN874)</button>
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

// מסמכי מכירה (PLAN.md 9.3): הצעת מחיר → הזמנה → תעודת משלוח → חשבונית, בלחיצה. זיכויים וקבלות — מתוך החשבונית
const DOC_PAY_METHODS = [['cash', 'מזומן'], ['check', 'המחאה'], ['card', 'כרטיס אשראי'], ['transfer', 'העברה בנקאית'], ['other', 'אחר']];
const DOC_NEXT = { quote: [['order', 'להזמנה'], ['delivery', 'לתעודת משלוח'], ['invoice', 'לחשבונית']], order: [['delivery', 'לתעודת משלוח'], ['invoice', 'לחשבונית']], delivery: [['invoice', 'לחשבונית']] };
const DOC_TARGET_LABELS = { order: 'הזמנה', delivery: 'תעודת משלוח', invoice: 'חשבונית' };
function renderSalesDocs(docs) {
  const drafts = docs.filter(x => DOC_NEXT[x.kind]);
  const others = docs.filter(x => !DOC_NEXT[x.kind]);
  const card = (x) => `
      <div class="card ${x.status === 'cancelled' ? 'muted-card' : x.status === 'converted' ? 'done' : ''}">
        <h4>${esc(x.kindLabel)} ${esc(x.number)} · ${esc(x.customer)}</h4>
        <small>${esc(x.date)}${x.validUntil ? ' · בתוקף עד ' + esc(x.validUntil) : ''}${x.invoiceNumber ? ' · לחשבונית ' + esc(x.invoiceNumber) : ''}${x.methodLabel ? ' · ' + esc(x.methodLabel) : ''}${x.convertedTo ? ' · הומר ל' + esc(DOC_TARGET_LABELS[x.convertedTo.kind] || 'מסמך') + ' ' + esc(x.convertedTo.number) : ''}</small>
        <div class="acct-row acct-big"><span>${esc(x.statusLabel)}</span><span>${money(x.total)}</span></div>
        <div class="card-actions">
          <button class="secondary" data-doc-pdf="${esc(x.id)}">הורד PDF</button>
          ${DOC_NEXT[x.kind] ? `<button class="secondary" data-dup-kind="${esc(x.kind)}" data-dup-id="${esc(x.id)}">שכפול</button>` : ''}
          ${x.status === 'open' && DOC_NEXT[x.kind] ? DOC_NEXT[x.kind].map(([to, label]) => `<button class="secondary" data-doc-convert="${esc(x.id)}" data-to="${to}">המרה ${label}</button>`).join('') : ''}
          ${x.status === 'open' && DOC_NEXT[x.kind] ? `<button class="danger-outline" data-doc-cancel="${esc(x.id)}">בטל</button>` : ''}
        </div>
      </div>`;
  return `
    <div class="card-actions">
      <button class="secondary" data-doc-new="quote">＋ הצעת מחיר</button>
      <button class="secondary" data-doc-new="order">＋ הזמנה</button>
      <button class="secondary" data-doc-new="delivery">＋ תעודת משלוח</button>
    </div>
    ${drafts.length ? `<h3>הצעות, הזמנות ותעודות משלוח (${drafts.length})</h3>${drafts.map(card).join('')}` : ''}
    ${others.length ? `<h3>זיכויים וקבלות (${others.length})</h3>${others.map(card).join('')}` : ''}`;
}

// חשבוניות חוזרות (PLAN.md 9.6): טיוטות לאישור בראש, והתבניות מתחת
function renderRecurring(rec) {
  const templates = Array.isArray(rec?.templates) ? rec.templates : [];
  const drafts = Array.isArray(rec?.drafts) ? rec.drafts : [];
  const name = (id) => (templates.find(t => t.id === id) || {}).customer || '';
  return `
    <div class="acct-header"><h3>חשבוניות חוזרות (${templates.length})</h3><button class="secondary" id="acctRecurringNew">＋ תבנית חודשית</button></div>
    ${drafts.length ? `<div class="card"><h4>ממתינות לאישור (${drafts.length})</h4>
      ${drafts.map(x => `<div class="acct-row"><span>${esc(x.date)} · ${esc(x.customer)} · ${money(x.total)}</span><span class="card-actions">
        <button class="primary" data-rec-issue="${esc(x.templateId)}" data-month="${esc(x.month)}">הפקה</button>
        <button class="secondary" data-rec-skip="${esc(x.templateId)}" data-month="${esc(x.month)}">דילוג על החודש</button></span></div>`).join('')}
      <p class="muted">טיוטה לא מופקת לבד — רק בלחיצה על "הפקה".</p></div>` : ''}
    ${templates.map(t => `
      <div class="card ${t.paused ? 'muted-card' : ''}">
        <h4>${esc(t.customer)} · כל חודש ב-${esc(t.dayOfMonth)}</h4>
        <small>מ-${esc(t.startMonth)}${t.endMonth ? ' עד ' + esc(t.endMonth) : ''} · ${(t.items || []).map(i => esc(i.description)).join(', ')}${t.paused ? ' · מושהית' : ''} · הופקו ${Object.keys(t.issued || {}).length}</small>
        <div class="card-actions">
          <button class="secondary" data-rec-edit="${esc(t.id)}">עריכה</button>
          <button class="secondary" data-rec-pause="${esc(t.id)}">${t.paused ? 'חידוש' : 'השהיה'}</button>
          ${Object.keys(t.issued || {}).length ? '' : `<button class="danger-outline" data-rec-delete="${esc(t.id)}">מחיקה</button>`}
        </div>
      </div>`).join('')}`;
}

function renderAcctInvoices(d) {
  const invoices = Array.isArray(d?.invoices) ? d.invoices : [];
  const docs = Array.isArray(d?.docs) ? d.docs : [];
  return `
    <div class="card">
      <label>חיפוש בכל המסמכים (מספר, לקוח, ע.מ או פריט) <input id="acctDocSearch" type="search" autocomplete="off"></label>
      <div id="acctDocResults"></div>
      <small class="muted">קיצורים: Alt+N — חשבונית חדשה · Ctrl+Enter — שמירה בטופס · / — חיפוש</small>
    </div>
    ${renderRecurring(d?.recurring)}
    ${renderSalesDocs(docs)}
    <h3>חשבוניות מס (${invoices.length})</h3>
    ${invoices.length === 0 ? renderEmpty('אין חשבוניות עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
    ${invoices.map(i => `
      <div class="card ${i.status === 'paid' ? 'done' : ''} ${i.status === 'cancelled' ? 'muted-card' : ''}">
        <h4>חשבונית ${esc(i.number)} · ${esc(i.customer)}</h4>
        <p>${(Array.isArray(i.items) ? i.items : []).map(it => esc(it.description)).join(', ')}</p>
        <small>${esc(i.date)} · נטו ${money(i.net)} · מע"מ ${money(i.vat)}${i.vatExempt ? ' (פטור)' : ''}</small>
        <div class="acct-row acct-big"><span>${ACCT_STATUS[i.status] || i.status}</span><span>${money(i.total)}</span></div>
        ${i.credited > 0 ? `<div class="acct-row"><span>זוכה · יתרה</span><span>${money(i.credited)} · ${money(i.balance)}</span></div>` : ''}
        ${i.sourceDoc ? `<small>על פי ${esc(({ quote: 'הצעת מחיר', order: 'הזמנה', delivery: 'תעודת משלוח' })[i.sourceDoc.kind] || '')} ${esc(i.sourceDoc.number)}</small>` : ''}
        ${renderAllocLine(i)}
        <div class="card-actions">
          <button class="secondary" data-action="pdf" data-id="${esc(i.id)}">הורד PDF</button>
          <button class="secondary" data-dup-kind="invoice" data-dup-id="${esc(i.id)}">שכפול</button>
          ${['pending', 'waived'].includes(invoiceAllocState(i)) ? `<button class="secondary" data-action="alloc" data-id="${esc(i.id)}">הזנת מספר הקצאה</button>` : ''}
          ${invoiceAllocState(i) === 'pending' ? `<button class="secondary" data-action="alloc-waive" data-id="${esc(i.id)}">לא נדרש</button>` : ''}
          ${i.status === 'open' ? `<button class="secondary" data-action="pay" data-id="${esc(i.id)}">סמן כשולמה</button>` : ''}
          ${i.status === 'paid' ? `<button class="danger-outline" data-action="unpay" data-id="${esc(i.id)}">בטל תשלום</button>` : ''}
          ${i.receiptId ? `<button class="secondary" data-doc-pdf="${esc(i.receiptId)}">קבלה ${esc(i.receiptNumber)} (PDF)</button>` : ''}
          ${i.status !== 'cancelled' && Number(i.balance ?? i.total) > 0 ? `<button class="secondary" data-action="credit" data-id="${esc(i.id)}">חשבונית זיכוי</button>` : ''}
          ${i.status === 'open' && !(i.credited > 0) ? `<button class="danger-outline" data-action="cancel" data-id="${esc(i.id)}">בטל (חשבונית זיכוי)</button>` : ''}
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
        <h3>מראה המסמכים</h3>
        ${row('צבע', b.brandColor || 'ברירת מחדל')}${row('חתימה', b.signature)}${row('לוגו', b.logo ? 'נבחר' : 'אין')}
        <div class="card-actions">
          <button class="secondary" id="acctLogoBtn">בחירת לוגו (PNG / JPEG)</button>
          ${b.logo ? '<button class="danger-outline" id="acctLogoRemove">הסרת הלוגו</button>' : ''}
        </div>
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

// קבצים במבנה אחיד לתקופה המוצגת. בלי תאריך התחלה — מתחילת השנה
async function handleUniformFile() {
  try {
    const p = acctPeriod();
    const r = await window.systemAPI.exportUniformFile({ from: p.from || (String(p.to).slice(0, 4) + '-01-01'), to: p.to });
    if (r && r.ok) showToast(`נשמרו ${r.report.total} רשומות, עם דוח הפקה, בתיקייה ${r.path}`);
  } catch (error) {
    showError('שגיאה בהפקת קבצים במבנה אחיד: ' + errMsg(error));
  }
}

// דוח מע"מ מפורט: חודש הדיווח (ברירת מחדל — החודש הקודם), חודש או חודשיים
async function handlePcn874() {
  const d = new Date();
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const values = await askFields('דוח מע"מ מפורט (PCN874)', [
    { name: 'month', label: 'חודש הדיווח (YYYY-MM)' },
    { name: 'months', label: 'מספר חודשים בתקופה (1 או 2)' }
  ], 'הפקת הקובץ', { month: `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`, months: '1' });
  if (!values) return;
  try {
    const r = await window.systemAPI.exportPcn874({ month: values.month, months: Number(values.months) });
    if (!r || !r.ok) return;
    showPcnSummary(r);
  } catch (error) {
    showError('שגיאה בהפקת הדוח המפורט: ' + errMsg(error));
  }
}

// סיכום ההפקה: הסכומים שבקובץ, השוואה ליומן, ומה לא נכלל
function showPcnSummary(r) {
  openDialog((card, finish) => {
    const t = r.totals;
    const shekels = (n) => (n < 0 ? '-' : '') + '₪' + Math.abs(n).toLocaleString('he-IL');
    card.innerHTML = `
      <h2>הקובץ נשמר</h2>
      <div style="padding:0 1.5rem">
        <div class="acct-row"><span>עסקאות חייבות (לפני מע"מ)</span><span>${shekels(t.taxableNet)}</span></div>
        <div class="acct-row"><span>מע"מ עסקאות</span><span>${shekels(t.taxableVat)}</span></div>
        <div class="acct-row"><span>עסקאות פטורות / אפס</span><span>${shekels(t.exemptNet)}</span></div>
        <div class="acct-row"><span>מע"מ תשומות (אחרות / ציוד)</span><span>${shekels(t.otherInputVat)} / ${shekels(t.equipmentInputVat)}</span></div>
        <div class="acct-row acct-big"><span>${t.payable >= 0 ? 'לתשלום' : 'להחזר'}</span><span>${shekels(Math.abs(t.payable))}</span></div>
        <p class="muted">רשומות: ${r.counts.S} מכירות ללקוח מזוהה, ${r.counts.L} מצטברות, ${r.counts.T} תשומות. הסכומים מעוגלים לשקל.
          ${r.difference ? `הפרש מול דוח המע"מ שביומן: ${shekels(r.difference)}.` : 'תואם לדוח המע"מ שביומן.'}</p>
        ${r.issues.length ? `<p><strong>לא נכללו בקובץ (${r.issues.length}):</strong></p><ul>${r.issues.slice(0, 20).map(i => `<li>${esc(i.date || '')} — ${esc(i.text)}</li>`).join('')}</ul>` : ''}
        <p class="muted">את הקובץ מגישים באתר רשות המסים. לפני הגשה ראשונה — מומלץ לבדוק אותו בסימולטור של שע"מ.</p>
      </div>
      <div class="modal-actions"><button type="button" class="primary" id="pcnOk">סגירה</button></div>`;
    card.querySelector('#pcnOk').addEventListener('click', () => finish(true));
  });
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

async function handleAllocation(id) {
  const values = await askFields('מספר הקצאה מרשות המסים', [
    { name: 'number', label: 'מספר ההקצאה (9 ספרות לפחות)' }
  ], 'שמירה', {});
  if (!values) return;
  try {
    await window.systemAPI.setAllocation(id, { number: values.number });
    showToast('מספר ההקצאה נשמר ויודפס על החשבונית');
    await switchView('acct-invoices');
  } catch (error) {
    showError('שגיאה בשמירת מספר ההקצאה: ' + errMsg(error));
  }
}

async function handleAllocationWaive(id) {
  if (!(await askConfirm('לסמן שאין צורך במספר הקצאה? מתאים רק כשהלקוח אינו עוסק מורשה או לא דרש מספר. אפשר להזין מספר גם אחר כך.'))) return;
  try {
    await window.systemAPI.waiveAllocation(id, { reason: 'customer' });
    showToast('סומן: לא נדרש מספר הקצאה');
    await switchView('acct-invoices');
  } catch (error) {
    showError('שגיאה בסימון: ' + errMsg(error));
  }
}

// טופס קצר בחלון: שדות טקסט / תאריך / בחירה, ושדות חובה לפי required
function askDocFields(title, fields, submitText) {
  return openDialog((card, finish) => {
    const h = document.createElement('h2');
    h.textContent = title;
    const form = document.createElement('form');
    form.className = 'modal-form';
    form.noValidate = true;
    const inputs = {};
    for (const f of fields) {
      const label = document.createElement('label');
      label.textContent = f.label;
      let input;
      if (f.options) {
        input = document.createElement('select');
        for (const [value, text] of f.options) {
          const o = document.createElement('option');
          o.value = value;
          o.textContent = text;
          input.appendChild(o);
        }
      } else {
        input = document.createElement('input');
        input.type = f.type || 'text';
      }
      input.name = f.name;
      input.value = f.value || (f.options ? f.options[0][0] : '');
      label.appendChild(input);
      form.appendChild(label);
      inputs[f.name] = input;
    }
    const err = document.createElement('div');
    err.style.color = '#b91c1c';
    err.style.fontSize = '0.9rem';
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary';
    cancel.textContent = 'ביטול';
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'primary';
    ok.textContent = submitText;
    actions.append(cancel, ok);
    form.append(err, actions);
    card.append(h, form);
    cancel.addEventListener('click', () => finish(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const values = {};
      for (const f of fields) {
        const v = inputs[f.name].value.trim();
        if (f.required && !v) {
          err.textContent = 'יש למלא את השדה: ' + f.label;
          inputs[f.name].focus();
          return;
        }
        values[f.name] = v;
      }
      finish(values);
    });
    const first = Object.values(inputs)[0];
    if (first) first.focus();
  });
}

async function handlePay(id) {
  const values = await askDocFields('קבלת תשלום', [
    { name: 'date', label: 'תאריך התשלום', type: 'date', value: today(), required: true },
    { name: 'method', label: 'אמצעי תשלום', options: DOC_PAY_METHODS },
    { name: 'reference', label: 'אסמכתא (מספר המחאה / העברה, אופציונלי)' }
  ], 'רישום תשלום והפקת קבלה');
  if (!values) return;
  try {
    await window.systemAPI.recordPayment(id, values);
    showToast('התשלום נרשם והופקה קבלה');
    await switchView('acct-invoices');
  } catch (error) {
    showError('שגיאה בסימון תשלום: ' + errMsg(error));
  }
}

// טופס הצעת מחיר / הזמנה / תעודת משלוח — שורה אחת, כמו בטופס החשבונית
const SALES_DOC_TITLES = { quote: 'הצעת מחיר חדשה', order: 'הזמנה חדשה', delivery: 'תעודת משלוח חדשה' };
function salesDocSchema(kind) {
  const fields = [
    { name: 'customer', label: 'שם לקוח', type: 'text', required: true },
    { name: 'customerTaxId', label: 'ע.מ / ח.פ של הלקוח (אופציונלי)', type: 'text' },
    { name: 'date', label: 'תאריך', type: 'date', required: true },
    ...(kind === 'quote' ? [{ name: 'validUntil', label: 'בתוקף עד (אופציונלי)', type: 'date' }] : []),
    { name: 'description', label: 'תיאור פריט', type: 'text', required: true },
    { name: 'quantity', label: 'כמות', type: 'number' },
    { name: 'unitPrice', label: 'מחיר ליחידה לפני מע"מ (₪)', type: 'number', required: true },
    { name: 'vatExempt', label: 'מע"מ', type: 'select', options: [{ value: 'no', label: 'כולל מע"מ' }, { value: 'yes', label: 'פטור ממע"מ' }] },
    { name: 'notes', label: 'הערות (אופציונלי)', type: 'textarea' }
  ];
  return {
    title: SALES_DOC_TITLES[kind] || 'מסמך חדש',
    fields,
    afterRender: attachCustomerAutocomplete,
    create: (d) => window.systemAPI.createSalesDoc(kind, {
      customer: d.customer, customerTaxId: d.customerTaxId, date: d.date, validUntil: d.validUntil, notes: d.notes,
      vatExempt: d.vatExempt === 'yes', items: [{ description: d.description, quantity: d.quantity, unitPrice: d.unitPrice }]
    })
  };
}

async function handleSalesDocPdf(id) {
  try {
    const r = await window.systemAPI.exportSalesDocPdf(id);
    if (r && r.ok) showToast('קובץ ה-PDF נשמר');
  } catch (error) {
    showError('שגיאה בהפקת PDF: ' + errMsg(error));
  }
}

async function handleConvertDoc(id, to) {
  const text = to === 'invoice' ? 'להפיק חשבונית מס מהמסמך? הפריטים והסכומים יועברו כמו שהם, והחשבונית תירשם ביומן.' : 'להמיר את המסמך? הפריטים והסכומים יועברו כמו שהם.';
  if (!(await askConfirm(text))) return;
  try {
    const r = await window.systemAPI.convertSalesDoc(id, to, { date: today() });
    showToast(r.kind === 'invoice' ? `הופקה חשבונית ${r.number}` : `נוצר מסמך ${r.number}`);
    await switchView('acct-invoices');
  } catch (error) {
    showError('שגיאה בהמרה: ' + errMsg(error));
  }
}

async function handleCancelDoc(id) {
  if (!(await askConfirm('לבטל את המסמך? הוא יישאר ברשימה כמבוטל.'))) return;
  try {
    await window.systemAPI.cancelSalesDoc(id);
    showToast('המסמך בוטל');
    await switchView('acct-invoices');
  } catch (error) {
    showError('שגיאה בביטול: ' + errMsg(error));
  }
}

// זיכוי מלא — אותם סכומים בדיוק; חלקי — שורה אחת בסכום לפני מע"מ, באותו שיעור מע"מ של החשבונית
async function handleCreditNote(id) {
  const values = await askDocFields('חשבונית זיכוי', [
    { name: 'reason', label: 'סיבת הזיכוי', required: true },
    { name: 'scope', label: 'היקף', options: [['full', 'זיכוי מלא של החשבונית'], ['partial', 'זיכוי חלקי']] },
    { name: 'amount', label: 'לזיכוי חלקי: סכום לפני מע"מ (₪)', type: 'number' },
    { name: 'date', label: 'תאריך', type: 'date', value: today(), required: true }
  ], 'הפקת זיכוי');
  if (!values) return;
  const input = { reason: values.reason, date: values.date };
  if (values.scope === 'partial') {
    const amount = Number(values.amount);
    if (!(amount > 0)) { showError('בזיכוי חלקי יש לרשום סכום גדול מאפס'); return; }
    input.items = [{ description: 'זיכוי: ' + values.reason, quantity: 1, unitPrice: amount }];
  }
  try {
    const r = await window.systemAPI.createCreditNote(id, input);
    showToast(`הופקה חשבונית זיכוי ${r.number}`);
    await switchView('acct-invoices');
  } catch (error) {
    showError('שגיאה בהפקת זיכוי: ' + errMsg(error));
  }
}

// ---------- חשבונית חוזרת ----------
function recurringSchema(template) {
  const it = (template && template.items && template.items[0]) || {};
  const now = new Date();
  return {
    title: template ? 'עריכת תבנית חודשית' : 'חשבונית חוזרת — תבנית חודשית',
    fields: [
      { name: 'customer', label: 'שם לקוח', type: 'text', required: true, value: template ? template.customer : '' },
      { name: 'customerTaxId', label: 'ע.מ / ח.פ של הלקוח (אופציונלי)', type: 'text', value: template ? template.customerTaxId || '' : '' },
      { name: 'dayOfMonth', label: 'יום בחודש להפקה (1–31; בחודש קצר — היום האחרון)', type: 'number', required: true, value: template ? template.dayOfMonth : 1 },
      { name: 'startMonth', label: 'מחודש (YYYY-MM)', type: 'text', required: true, value: template ? template.startMonth : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` },
      { name: 'endMonth', label: 'עד חודש (YYYY-MM, ריק — ללא סיום)', type: 'text', value: template ? template.endMonth || '' : '' },
      { name: 'description', label: 'תיאור פריט', type: 'text', required: true, value: it.description || '' },
      { name: 'quantity', label: 'כמות', type: 'number', value: it.quantity || 1 },
      { name: 'unitPrice', label: 'מחיר ליחידה לפני מע"מ (₪)', type: 'number', required: true, value: it.unitPrice ?? '' },
      { name: 'vatExempt', label: 'מע"מ', type: 'select', value: template && template.vatExempt ? 'yes' : 'no', options: [{ value: 'no', label: 'כולל מע"מ' }, { value: 'yes', label: 'פטור ממע"מ' }] }
    ],
    afterRender: attachCustomerAutocomplete,
    create: (d) => window.systemAPI.saveRecurring({
      customer: d.customer, customerTaxId: d.customerTaxId, dayOfMonth: Number(d.dayOfMonth), startMonth: d.startMonth, endMonth: d.endMonth,
      vatExempt: d.vatExempt === 'yes', paused: !!(template && template.paused),
      items: [{ description: d.description, quantity: d.quantity, unitPrice: d.unitPrice, ...(it.account ? { account: it.account } : {}) }]
    }, template ? template.id : null)
  };
}

async function handleRecurringAction(fn, okText) {
  try {
    const r = await fn();
    if (r === null) return;
    showToast(okText(r));
    await switchView('acct-invoices');
  } catch (error) {
    showError('שגיאה: ' + errMsg(error));
  }
}

function attachRecurringHandlers() {
  const data = (state.data.acctInvoices && state.data.acctInvoices.recurring) || { templates: [] };
  const find = (id) => (data.templates || []).find(t => t.id === id);
  const btn = document.getElementById('acctRecurringNew');
  if (btn) btn.addEventListener('click', () => openSubForm(recurringSchema(null)));
  document.querySelectorAll('[data-rec-edit]').forEach(b => b.addEventListener('click', () => openSubForm(recurringSchema(find(b.dataset.recEdit)))));
  document.querySelectorAll('[data-rec-issue]').forEach(b => b.addEventListener('click', () => handleRecurringAction(
    () => window.systemAPI.issueRecurring(b.dataset.recIssue, b.dataset.month), (inv) => `הופקה חשבונית ${inv.number}`)));
  document.querySelectorAll('[data-rec-skip]').forEach(b => b.addEventListener('click', async () => {
    if (!(await askConfirm(`לדלג על החודש ${b.dataset.month}? לא תופק בו חשבונית מהתבנית.`))) return;
    handleRecurringAction(() => window.systemAPI.skipRecurring(b.dataset.recSkip, b.dataset.month), () => 'החודש סומן כדילוג');
  }));
  document.querySelectorAll('[data-rec-pause]').forEach(b => b.addEventListener('click', () => {
    const t = find(b.dataset.recPause);
    if (!t) return;
    handleRecurringAction(() => window.systemAPI.saveRecurring({ ...t, paused: !t.paused }, t.id), () => (t.paused ? 'התבנית חודשה' : 'התבנית הושהתה'));
  }));
  document.querySelectorAll('[data-rec-delete]').forEach(b => b.addEventListener('click', async () => {
    if (!(await askConfirm('למחוק את התבנית?'))) return;
    handleRecurringAction(() => window.systemAPI.deleteRecurring(b.dataset.recDelete), () => 'התבנית נמחקה');
  }));
}

// ---------- עבודה מהירה ----------
// השלמה אוטומטית ללקוח: רשימת לקוחות מוכרים (datalist), ובחירה ממלאת את ע.מ
async function attachCustomerAutocomplete() {
  const input = document.getElementById('f_customer');
  if (!input) return;
  let list;
  try { list = await window.systemAPI.getCustomerDirectory(); } catch { return; }
  if (!Array.isArray(list) || !list.length) return;
  const dl = document.createElement('datalist');
  dl.id = 'acctCustomerList';
  for (const c of list.slice(0, 300)) {
    const o = document.createElement('option');
    o.value = c.name;
    dl.appendChild(o);
  }
  input.setAttribute('list', dl.id);
  input.setAttribute('autocomplete', 'off');
  input.after(dl);
  input.addEventListener('change', () => {
    const c = list.find(x => x.name === input.value.trim());
    const tax = document.getElementById('f_customerTaxId');
    if (c && tax && !tax.value) tax.value = c.taxId || '';
  });
}

// שכפול: טופס חדש עם הלקוח והפריט הראשון, בתאריך היום
async function handleDuplicate(kind, id) {
  try {
    const src = await window.systemAPI.getDuplicateInput(kind, id);
    const it = src.items[0] || {};
    const values = { customer: src.customer, customerTaxId: src.customerTaxId, date: today(), description: it.description, quantity: it.quantity,
      unitPrice: it.unitPrice, vatExempt: src.vatExempt ? 'yes' : 'no' };
    const schema = src.kind === 'invoice' ? formSchemas['acct-invoices'] : salesDocSchema(src.kind);
    await openSubForm(schema, values);
    if (src.items.length > 1) showToast('שוכפלה השורה הראשונה בלבד — הטופס תומך בשורה אחת');
  } catch (error) {
    showError('שגיאה בשכפול: ' + errMsg(error));
  }
}

const DOC_KIND_LABELS = { invoice: 'חשבונית', quote: 'הצעת מחיר', order: 'הזמנה', delivery: 'תעודת משלוח', credit: 'זיכוי', receipt: 'קבלה' };
function renderDocResults(rows, query) {
  if (!query) return '';
  if (!rows.length) return '<p class="muted">לא נמצאו מסמכים</p>';
  return `<table class="acct-table"><thead><tr><th>סוג</th><th>מספר</th><th>תאריך</th><th>לקוח</th><th>סכום</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(DOC_KIND_LABELS[r.kind] || r.kind)}</td><td class="num">${esc(r.number)}</td><td>${esc(r.date)}</td><td>${esc(r.customer)}</td><td class="num">${money(r.total)}</td>
      <td>${r.kind === 'invoice' ? `<button class="secondary" data-action="pdf" data-id="${esc(r.id)}">PDF</button>` : `<button class="secondary" data-doc-pdf="${esc(r.id)}">PDF</button>`}</td></tr>`).join('')}
  </tbody></table>`;
}

function attachDocSearch() {
  const input = document.getElementById('acctDocSearch');
  const out = document.getElementById('acctDocResults');
  if (!input || !out) return;
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      try {
        out.innerHTML = renderDocResults(q ? await window.systemAPI.searchDocuments(q) : [], q);
        out.querySelectorAll('[data-action="pdf"]').forEach(b => b.addEventListener('click', () => handlePdf(b.dataset.id)));
        out.querySelectorAll('[data-doc-pdf]').forEach(b => b.addEventListener('click', () => handleSalesDocPdf(b.dataset.docPdf)));
      } catch (error) {
        out.innerHTML = `<div class="bad">${esc(errMsg(error))}</div>`;
      }
    }, 250);
  });
}

// קיצורי מקלדת במסך החשבוניות: Alt+N חשבונית חדשה, "/" חיפוש, Ctrl+Enter שמירת הטופס הפתוח
function acctInvoiceKeys(e) {
  if (state.currentView !== 'acct-invoices') return;
  const modalOpen = elements.modal && !elements.modal.classList.contains('hidden');
  if (modalOpen && e.ctrlKey && e.key === 'Enter') { e.preventDefault(); handleSubmit(); return; }
  if (modalOpen || document.querySelector('.modal:not(.hidden):not(#modal)')) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
  if (e.altKey && (e.key === 'n' || e.key === 'N' || e.code === 'KeyN')) { e.preventDefault(); handleAdd(); return; }
  if (!typing && e.key === '/') { const s = document.getElementById('acctDocSearch'); if (s) { e.preventDefault(); s.focus(); } }
}

function attachInvoiceViewHandlers() {
  attachRecurringHandlers();
  attachDocSearch();
  document.querySelectorAll('[data-dup-id]').forEach(b => b.addEventListener('click', () => handleDuplicate(b.dataset.dupKind, b.dataset.dupId)));
  if (!state.acctKeysBound) {
    document.addEventListener('keydown', acctInvoiceKeys);
    state.acctKeysBound = true;
  }
}

async function handleDocLogo(remove) {
  try {
    const r = await window.systemAPI.setDocumentLogo(remove);
    if (r && r.canceled) return;
    showToast(remove ? 'הלוגו הוסר' : 'הלוגו נשמר ויופיע על המסמכים');
    await switchView('acct-settings');
  } catch (error) {
    showError('שגיאה בשמירת הלוגו: ' + errMsg(error));
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
      { name: 'amount', label: 'סכום (₪) — לפני מע"מ, אם יש מע"מ תשומות', type: 'number', required: true },
      { name: 'inputVat', label: 'מע"מ תשומות (₪, אופציונלי — הוצאה עם חשבונית מס)', type: 'number' },
      { name: 'supplierTaxId', label: 'ע.מ / ח.פ של הספק (לדוח המע"מ המפורט)', type: 'text' },
      { name: 'supplierRef', label: 'מספר חשבונית הספק', type: 'text' },
      { name: 'equipment', label: 'סוג התשומה', type: 'select', options: [{ value: '', label: 'לפי החשבון' }, { value: 'no', label: 'תשומות אחרות' }, { value: 'yes', label: 'ציוד (רכוש קבוע)' }] }
    ],
    create: (d) => {
      const vat = Number(d.inputVat || 0);
      // עם מע"מ תשומות: חובה הוצאה (לפני מע"מ) + חובה מע"מ תשומות, זכות הסכום הכולל
      const total = Math.round((Number(d.amount) + vat) * 100) / 100;
      const lines = vat > 0
        ? [{ account: d.debitAccount, debit: d.amount }, { account: '1300', debit: vat, memo: 'מע"מ תשומות' }, { account: d.creditAccount, credit: total }]
        : [{ account: d.debitAccount, debit: d.amount }, { account: d.creditAccount, credit: d.amount }];
      const vatDoc = vat > 0 ? { supplierTaxId: d.supplierTaxId, reference: d.supplierRef, docDate: d.date, ...(d.equipment ? { equipment: d.equipment === 'yes' } : {}) } : undefined;
      return window.systemAPI.createEntry({ date: d.date, description: d.description, lines, ...(vatDoc ? { vatDoc } : {}) });
    },
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
      attachCustomerAutocomplete();
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
      { name: 'customerTaxId', label: 'ע.מ / ח.פ של הלקוח (לבקשת מספר הקצאה)', type: 'text' },
      { name: 'date', label: 'תאריך', type: 'date', required: true },
      { name: 'description', label: 'תיאור פריט', type: 'text', required: true },
      { name: 'quantity', label: 'כמות', type: 'number' },
      { name: 'unitPrice', label: 'מחיר ליחידה לפני מע"מ (₪)', type: 'number', required: true },
      { name: 'kind', label: 'סוג', type: 'select', options: [{ value: 'goods', label: 'מוצר' }, { value: 'service', label: 'שירות' }] },
      { name: 'vatExempt', label: 'מע"מ', type: 'select', options: [{ value: 'no', label: 'כולל מע"מ' }, { value: 'yes', label: 'פטור ממע"מ' }] },
      { name: 'paidNow', label: 'תשלום', type: 'select', options: [{ value: '', label: 'טרם שולמה' }, ...DOC_PAY_METHODS.map(([value, label]) => ({ value, label: 'שולמה עכשיו — ' + label }))] },
      { name: 'paymentRef', label: 'אסמכתא לתשלום (אופציונלי)', type: 'text' }
    ],
    create: (d) => window.systemAPI.createInvoice({
      customer: d.customer, customerTaxId: d.customerTaxId, date: d.date, vatExempt: d.vatExempt === 'yes',
      items: [{ description: d.description, quantity: d.quantity, unitPrice: d.unitPrice, kind: d.kind || 'goods' }],
      ...(d.paidNow ? { paidNow: { method: d.paidNow, reference: d.paymentRef } } : {})
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
    const values = { name: b.name, taxId: b.taxId, address: b.address, phone: b.phone, email: b.email, brandColor: b.brandColor, signature: b.signature,
      vatPercent: +(st.vatRate * 100).toFixed(2), lockDate: st.lockDate };
    for (const f of schema.fields) f.value = values[f.name] ?? '';
  },
  fields: [
    { name: 'name', label: 'שם העסק', type: 'text', required: true },
    { name: 'taxId', label: 'ע.מ / ח.פ', type: 'text' },
    { name: 'address', label: 'כתובת', type: 'text' },
    { name: 'phone', label: 'טלפון', type: 'text' },
    { name: 'email', label: 'דוא"ל', type: 'text' },
    { name: 'brandColor', label: 'צבע המסמכים (למשל #1d4ed8, ריק — ברירת מחדל)', type: 'text' },
    { name: 'signature', label: 'שורת חתימה במסמכים (אופציונלי)', type: 'text' },
    { name: 'vatPercent', label: 'שיעור מע"מ (%)', type: 'number', required: true },
    { name: 'lockDate', label: 'נעילת תקופה עד (YYYY-MM-DD, השאר ריק לביטול)', type: 'date' }
  ],
  create: (d) => window.systemAPI.saveAccountingSettings({
    business: { name: d.name, taxId: d.taxId, address: d.address, phone: d.phone, email: d.email, brandColor: d.brandColor, signature: d.signature },
    vatRate: Number(d.vatPercent) / 100,
    lockDate: d.lockDate || ''
  })
};
Object.assign(formSchemas, acctFormSchemas);
