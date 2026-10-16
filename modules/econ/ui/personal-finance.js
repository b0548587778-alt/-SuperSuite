// ממשק המודול הכלכלי — התוכנית הפיננסית.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

// ============================================================
// התוכנית הפיננסית — טופס עריכת פרטי התוכנית.
// טופס "עריכה" במהותו: טוען את התוכנית הקיימת ומעדכן אותה.
// (ראו TODO-FIXES.md — איחוד תצוגות הכפילות "תכנון פיננסי"/"התוכנית הפיננסית".)
// ============================================================
const pfOpts = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));
formSchemas['personal-finance'] = {
  title: 'פריט חדש בתוכנית הפיננסית',
  editTitle: 'עריכת פריט בתוכנית',
  dynamic: true,
  fields: [
    { name: 'pfKind', label: 'סוג הפריט', type: 'select', required: true, options: pfOpts(PF_KINDS) },
    // הכנסה
    { name: 'source', label: 'מקור ההכנסה', type: 'text', required: true, kinds: ['incomes'] },
    { name: 'incomeCategory', label: 'קטגוריה', type: 'select', kinds: ['incomes'], options: pfOpts(PF_INCOME_CATS) },
    // הוצאה
    { name: 'category', label: 'קטגוריית ההוצאה', type: 'text', required: true, kinds: ['expenses'] },
    { name: 'isFixed', label: 'סוג ההוצאה', type: 'select', kinds: ['expenses'], options: [{ value: 'fixed', label: 'קבועה' }, { value: 'variable', label: 'משתנה' }] },
    // השקעה
    { name: 'name', label: 'שם ההשקעה', type: 'text', required: true, kinds: ['investments'] },
    { name: 'investType', label: 'סוג ההשקעה', type: 'select', kinds: ['investments'], options: pfOpts(PF_INVEST_TYPES) },
    { name: 'principal', label: 'סכום התחלתי (₪)', type: 'number', required: true, kinds: ['investments'] },
    { name: 'monthlyContribution', label: 'הפקדה חודשית (₪)', type: 'number', kinds: ['investments'] },
    { name: 'annualRate', label: 'תשואה שנתית צפויה (%)', type: 'number', required: true, kinds: ['investments'] },
    { name: 'years', label: 'מספר שנים', type: 'number', required: true, kinds: ['investments'] },
    // תנועת תזרים
    { name: 'date', label: 'תאריך', type: 'date', required: true, kinds: ['cashFlowEntries'] },
    { name: 'type', label: 'כיוון', type: 'select', kinds: ['cashFlowEntries'], options: [{ value: 'income', label: 'הכנסה' }, { value: 'expense', label: 'הוצאה' }] },
    // משותף
    { name: 'amount', label: 'סכום (₪)', type: 'number', required: true, kinds: ['incomes', 'expenses', 'cashFlowEntries'] },
    { name: 'frequency', label: 'תדירות', type: 'select', kinds: ['incomes', 'expenses'], options: [{ value: 'monthly', label: 'חודשי' }, { value: 'yearly', label: 'שנתי' }, { value: 'weekly', label: 'שבועי' }, { value: 'daily', label: 'יומי' }] },
    { name: 'description', label: 'תיאור', type: 'text', kinds: ['expenses', 'cashFlowEntries'] },
    { name: 'notes', label: 'הערות', type: 'textarea', kinds: ['incomes', 'expenses', 'investments'] }
  ],
  // שמות השדות בטופס ייחודיים לכל סוג (incomeCategory/investType) — ממופים כאן לשמות ברשומה
  toItem: (d) => {
    const kind = d.pfKind;
    const item = { ...d };
    delete item.pfKind;
    if (kind === 'incomes') { item.category = d.incomeCategory; delete item.incomeCategory; }
    if (kind === 'investments') { item.type = d.investType; delete item.investType; }
    if (kind === 'expenses') item.isFixed = d.isFixed !== 'variable';
    return { kind, item };
  },
  fromItem: (kind, r) => ({
    ...r, pfKind: kind,
    incomeCategory: kind === 'incomes' ? r.category : undefined,
    investType: kind === 'investments' ? r.type : undefined,
    isFixed: kind === 'expenses' ? (r.isFixed === false ? 'variable' : 'fixed') : r.isFixed,
    type: kind === 'cashFlowEntries' ? r.type : undefined
  }),
  create: (d) => { const { kind, item } = formSchemas['personal-finance'].toItem(d); return window.systemAPI.addFinanceItem(kind, item); }
};

// עריכת פרטי התוכנית (שם ומטבע) — טופס משני בתצוגה
const pfPlanSchema = {
  title: 'פרטי התוכנית הפיננסית',
  fields: [
    { name: 'planName', label: 'שם התוכנית', type: 'text', required: true },
    { name: 'currency', label: 'מטבע', type: 'select', options: pfOpts(CURRENCY_LABELS) }
  ],
  create: async (d) => {
    // עדכון פרטי התוכנית בלבד — הפריטים נשמרים כמו שהם
    const plan = await window.systemAPI.getPersonalFinance() || {};
    return window.systemAPI.updatePersonalFinance({ ...plan, planName: d.planName, currency: d.currency });
  }
};

function attachPersonalFinanceHandlers() {
  const plan = document.getElementById('pfPlanBtn');
  if (plan) plan.addEventListener('click', () => {
    const p = state.data.personalFinance || {};
    openSubForm(pfPlanSchema, { planName: p.planName || 'התוכנית הפיננסית שלי', currency: p.currency || 'ILS' });
  });
  document.querySelectorAll('[data-pf-edit]').forEach(btn => btn.addEventListener('click', async () => {
    const kind = btn.dataset.pfEdit;
    const list = (state.data.personalFinance || {})[kind];
    const rec = Array.isArray(list) ? list.find(x => x.id === btn.dataset.id) : null;
    if (!rec) return;
    const base = formSchemas['personal-finance'];
    // עריכה: אותו טופס, נעול לסוג הפריט, ושמירה דרך updateFinanceItem
    const schema = {
      ...base,
      title: base.editTitle,
      fields: base.fields.map(f => (f.name === 'pfKind' ? { ...f, options: [{ value: kind, label: PF_KINDS[kind] }] } : f)),
      create: (d) => { const { item } = base.toItem({ ...d, pfKind: kind }); return window.systemAPI.updateFinanceItem(kind, rec.id, item); }
    };
    await openSubForm(schema, base.fromItem(kind, rec));
    attachDynamicFields(schema);
    // אחרי בניית השדות הדינמיים — ממלאים שוב את הערכים של הפריט
    const values = base.fromItem(kind, rec);
    for (const f of schema.fields) {
      const el = document.getElementById('f_' + f.name);
      if (el && values[f.name] !== undefined && values[f.name] !== null) el.value = String(values[f.name]);
    }
  }));
  document.querySelectorAll('[data-pf-del]').forEach(btn => btn.addEventListener('click', async () => {
    if (!(await askConfirm('למחוק את הפריט מהתוכנית?'))) return;
    try { await window.systemAPI.deleteFinanceItem(btn.dataset.pfDel, btn.dataset.id); showToast('הפריט נמחק'); await switchView('personal-finance'); }
    catch (error) { showError('שגיאה במחיקה: ' + errMsg(error)); }
  }));
}
