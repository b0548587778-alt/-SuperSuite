// ממשק המודול הכלכלי — תצוגות כלליות: לוח בקרה, תכנון פיננסי, עסקים, משכנתאות, משימות, אנשי קשר, כושר.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

// לוח הבוקר: מה דורש טיפול היום. מוצג רק כשיש מה להציג — לעסק בלי עמותה/גמ"ח/חסד אין כאן כלום
const BRIEF_AREAS = { npo: 'עמותה', gemach: 'גמ"ח', chesed: 'חסד', acct: 'חשבוניות' };
const BRIEF_SHOWN = 8;

function renderMorningBrief(brief) {
  const items = Array.isArray(brief?.items) ? brief.items : [];
  if (!items.length) return '';
  const c = brief.counts || {};
  const summary = [c.urgent ? `${c.urgent} דחופים` : '', c.soon ? `${c.soon} בקרוב` : '', c.info ? `${c.info} לידיעה` : ''].filter(Boolean).join(' · ');
  const row = (it) => `
    <div class="brief-row ${esc(it.level)}">
      <span class="brief-level">${esc(it.levelLabel)}</span>
      <div class="brief-text"><strong>${esc(it.title)}</strong><small>${esc(BRIEF_AREAS[it.area] || '')}${it.detail ? ' · ' + esc(it.detail) : ''}</small></div>
      <button class="secondary" data-goto="${esc(it.view)}">למסך</button>
    </div>`;
  return `
    <section class="hub brief" id="morningBrief">
      <div class="hub-head">
        <div><h2>מה דורש טיפול היום</h2><small>${esc(brief.date || '')} · ${esc(summary)}</small></div>
        <span class="hub-badge ${c.urgent ? 'bad' : ''}">${c.urgent ? '⚠ יש פריטים דחופים' : '✓ אין פריטים דחופים'}</span>
      </div>
      <div class="card brief-list">
        ${items.slice(0, BRIEF_SHOWN).map(row).join('')}
        ${items.length > BRIEF_SHOWN ? `<details><summary>ועוד ${items.length - BRIEF_SHOWN} פריטים</summary>${items.slice(BRIEF_SHOWN).map(row).join('')}</details>` : ''}
      </div>
    </section>`;
}

function renderDashboard(data) {
  const finance = data?.finance;
  const tasks = data?.tasks;
  const marketIntel = data?.marketIntel;
  // דוח חשבונאי חלקי לא מפיל את מסך הבית — מנורמל לאותה צורה מלאה כמו בדוחות.
  const acc = data?.accounting ? normalizeAcctReports(data.accounting) : null;
  const invoices = (Array.isArray(data?.invoices) ? data.invoices : []).slice(0, 5);
  const cash = acc ? (acc.balanceSheet.assets.find(a => a.code === '1000')?.amount || 0) : 0;
  const quick = [
    ['acct-reports', '📈', 'דוחות ומע"מ'], ['acct-journal', '📒', 'יומן חשבונאי'],
    ['acct-invoices', '🧾', 'חשבוניות מס'], ['acct-pricing', '🏷', 'מחירון ותמחור'],
    ['acct-chart', '🗂', 'תוכנית חשבונות'], ['acct-settings', '🏢', 'הגדרות עסק']
  ];

  return `
    <div class="dashboard">
      ${renderMorningBrief(data?.brief)}
      ${acc ? `
      <section class="hub">
        <div class="hub-head">
          <div>
            <h2>לוח הבקרה של העסק</h2>
            <small>שנת ${new Date().getFullYear()} · עד ${esc(acc.period.to)}${acc.lockDate ? ` · תקופה נעולה עד ${esc(acc.lockDate)}` : ''}</small>
          </div>
          <span class="hub-badge ${acc.balanceSheet.balanced && acc.trialBalance.balanced ? 'ok' : 'bad'}">${acc.balanceSheet.balanced && acc.trialBalance.balanced ? '✓ הספרים מאוזנים' : '⚠ יש בעיית איזון'}</span>
        </div>
        <div class="kpis">
          <div class="kpi"><small>יתרת בנק</small><strong>${money(cash)}</strong></div>
          <div class="kpi"><small>הכנסות מתחילת השנה</small><strong>${money(acc.incomeStatement.totalRevenue)}</strong></div>
          <div class="kpi ${tone(acc.incomeStatement.netProfit)}"><small>רווח נקי</small><strong>${money(acc.incomeStatement.netProfit)}</strong></div>
          <div class="kpi"><small>חייבים פתוחים</small><strong>${money(acc.openInvoices)}</strong></div>
          <div class="kpi ${tone(-acc.vat.netPayable)}"><small>${acc.vat.netPayable >= 0 ? 'מע"מ לתשלום' : 'מע"מ לזיכוי'}</small><strong>${money(Math.abs(acc.vat.netPayable))}</strong></div>
          <div class="kpi"><small>מוצרים במחירון</small><strong>${(data.products || []).length}</strong></div>
        </div>
        <div class="hub-grid">
          <div class="card">
            <h3>חשבוניות אחרונות</h3>
            ${invoices.length === 0 ? '<p class="muted">עדיין אין חשבוניות</p>' : invoices.map(i => `
              <div class="acct-row"><span>${esc(i.number)} · ${esc(i.customer)}</span><span>${money(i.total)} <small class="muted">${esc({open:'פתוחה',paid:'שולמה',cancelled:'בוטלה'}[i.status] || '')}</small></span></div>`).join('')}
            <button class="secondary" data-goto="acct-invoices">לכל החשבוניות</button>
          </div>
          <div class="card">
            <h3>מסכים מהירים</h3>
            <div class="quick">${quick.map(([v, ic, label]) => `<button class="quick-btn" data-goto="${v}"><span>${ic}</span>${esc(label)}</button>`).join('')}</div>
          </div>
        </div>
      </section>` : ''}
      <section class="modules">
        <h3 class="modules-title">מודולים נוספים בחבילה</h3>
        <div class="modules-grid">
          <button class="module-card" data-module="shamai"><span class="module-ic">💎</span><strong>שמאות נכסים</strong><small>הערכת שווי ופנקס הזדמנויות</small></button>
          <button class="module-card" data-module="trainer"><span class="module-ic">🏋️</span><strong>ניהול אימונים</strong><small>למאמני כושר: מתאמנים ותוכניות</small></button>
          <button class="module-card" data-module="tools"><span class="module-ic">🧰</span><strong>ארגז כלים</strong><small>13 כלים שימושיים</small></button>
        </div>
      </section>
      <div class="dashboard-grid">
        <div class="card">
          <h3>💰 פיננסים</h3>
          <p>הכנסות: ${finance?.incomes?.length || 0}</p>
          <p>הוצאות: ${finance?.expenses?.length || 0}</p>
          <p>השקעות: ${finance?.investments?.length || 0}</p>
        </div>
        <div class="card">
          <h3>📋 משימות</h3>
          <p>סה"כ: ${tasks?.tasks?.length || 0}</p>
          <p>דחופות: ${tasks?.tasks?.filter(t => t.priority === 'high').length || 0}</p>
          <p>באיחור: ${tasks?.tasks?.filter(t => t.isOverdue).length || 0}</p>
        </div>
        <div class="card">
          <h3>📊 מודיעין שוק</h3>
          <p>נתונים: ${marketIntel?.entries?.length || 0}</p>
        </div>
      </div>
    </div>
  `;
}

// ממיר סכום ותדירות לסכום חודשי. תדירות לא מוכרת נחשבת חודשית (ברירת המחדל של השירות).
const MONTHLY_FACTOR = { monthly: 1, yearly: 1 / 12, annual: 1 / 12, weekly: 52 / 12, daily: 365 / 12 };
function monthlyAmount(amount, frequency) {
  const factor = MONTHLY_FACTOR[String(frequency || 'monthly').toLowerCase()] ?? 1;
  return (Number(amount) || 0) * factor;
}

// תכנון פיננסי — תמונת מצב מחושבת: סיכומים, תזרים חודשי נטו ותחזית השקעות.
// (התוכנית הגולמית — שם, מטבע ורשימת הפריטים — מוצגת ונערכת בתצוגת "התוכנית הפיננסית".)
function renderFinance(data) {
  const finance = data || {};
  const incomes = Array.isArray(finance.incomes) ? finance.incomes : [];
  const expenses = Array.isArray(finance.expenses) ? finance.expenses : [];
  const investments = Array.isArray(finance.investments) ? finance.investments : [];

  if (incomes.length === 0 && expenses.length === 0 && investments.length === 0) {
    return renderEmpty('אין נתונים בתכנון הפיננסי עדיין — הזן הכנסות והוצאות ב"התוכנית הפיננסית" כדי לראות כאן את התמונה הכוללת') +
      '<div class="acct-actions"><button class="secondary" data-goto="personal-finance">להזנת הכנסות והוצאות ←</button></div>';
  }

  // סיכומים חודשיים — מנרמלים תדירויות שונות לבסיס חודשי אחד.
  // מעוגל לאגורות בדיוק כמו שאר המערכת.
  // כל פריט מומר לסכום חודשי בשלמי אגורות, והסיכום נעשה על שלמים (כלל 1)
  const agMonthly = (x) => Math.round(monthlyAmount(x.amount, x.frequency) * 100);
  const round2 = (ag) => ag / 100;
  const incomeMonthly = incomes.reduce((s, i) => s + agMonthly(i), 0);
  const expenseMonthly = expenses.reduce((s, e) => s + agMonthly(e), 0);
  const netMonthly = incomeMonthly - expenseMonthly;
  const fixedMonthly = expenses.filter(e => e.isFixed !== false).reduce((s, e) => s + agMonthly(e), 0);
  // תחזית השקעה: ריבית דריבית חודשית עם הפקדה, מעוגלת לאגורה בכל חודש
  const projectAg = (inv) => {
    let bal = Math.round((Number(inv.principal) || 0) * 100);
    const dep = Math.round((Number(inv.monthlyContribution) || 0) * 100);
    const r = (Number(inv.annualRate) || 0) / 100 / 12;
    const months = Math.min(1200, Math.max(0, Math.round((Number(inv.years) || 0) * 12)));
    for (let m = 0; m < months; m++) bal = Math.round(bal * (1 + r)) + dep;
    return bal;
  };

  return `
    <div class="finance">
      <div class="kpis">
        <div class="kpi ${tone(incomeMonthly)}"><small>הכנסות בחודש</small><strong>${money(round2(incomeMonthly))}</strong></div>
        <div class="kpi neg"><small>הוצאות בחודש</small><strong>${money(round2(expenseMonthly))}</strong></div>
        <div class="kpi ${tone(netMonthly)}"><small>תזרים חודשי נטו</small><strong>${money(round2(netMonthly))}</strong></div>
        <div class="kpi"><small>הוצאות קבועות</small><strong>${money(round2(fixedMonthly))}</strong></div>
      </div>
      <div class="section">
        <h3>הכנסות (${incomes.length})</h3>
        ${incomes.length === 0 ? '<div class="acct-row muted">אין הכנסות רשומות</div>' : incomes.map(i => `
          <div class="item">
            <span>${esc(i.source)}</span>
            <span>${money(i.amount)} / ${esc(FREQ_LABELS[i.frequency] || 'חודשי')}</span>
          </div>
        `).join('')}
      </div>
      <div class="section">
        <h3>הוצאות (${expenses.length})</h3>
        ${expenses.length === 0 ? '<div class="acct-row muted">אין הוצאות רשומות</div>' : expenses.map(e => `
          <div class="item">
            <span>${esc(e.category)}${e.isFixed === false ? ' <small class="muted">(משתנה)</small>' : ''}</span>
            <span>${money(e.amount)} / ${esc(FREQ_LABELS[e.frequency] || 'חודשי')}</span>
          </div>
        `).join('')}
      </div>
      <div class="section">
        <h3>השקעות (${investments.length})</h3>
        ${investments.length === 0 ? '<div class="acct-row muted">אין השקעות רשומות</div>' : investments.map(inv => `
          <div class="item">
            <span>${esc(inv.name)} <small class="muted">· ${money(inv.principal)} · ${esc(inv.annualRate)}% · ${esc(inv.years || 0)} שנים</small></span>
            <span>שווי צפוי: ${money(projectAg(inv) / 100)}</span>
          </div>
        `).join('')}
      </div>
      <div class="acct-actions"><button class="secondary" data-goto="personal-finance">עריכת הפריטים בתוכנית ←</button></div>
    </div>
  `;
}

// תדירויות בעברית לתצוגה
const FREQ_LABELS = { monthly: 'חודשי', yearly: 'שנתי', annual: 'שנתי', weekly: 'שבועי', daily: 'יומי' };

// Render business view
function renderBusiness(data) {
  const plans = Array.isArray(data?.plans) ? data.plans : [];
  return `
    <div class="business">
      <h3>תוכניות עסקיות (${plans.length})</h3>
      ${plans.length === 0 ? renderEmpty('אין תוכניות עסקיות עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
      ${plans.map(p => `
        <div class="card">
          <h4>${esc(p.name)}</h4>
          <p>${esc(p.description || 'ללא תיאור')}</p>
          <small>תעשייה: ${esc(p.industry || 'לא צוין')}${p.targetMarket ? ' · שוק יעד: ' + esc(p.targetMarket) : ''}</small>
          ${p.startupCost || p.projectedRevenue ? `<div class="acct-row"><span>עלות הקמה ${money(p.startupCost)}</span><span>הכנסה צפויה ${money(p.projectedRevenue)}</span></div>` : ''}
          ${renderCardActions(p.id)}
        </div>
      `).join('')}
    </div>
  `;
}

// Render market intelligence view
function renderMarketIntel(data) {
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  return `
    <div class="market-intel">
      <h3>מודיעין שוק (${entries.length})</h3>
      ${entries.length === 0 ? renderEmpty('אין רשומות מודיעין עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
      ${entries.map(e => `
        <div class="card">
          <h4>${esc(e.title)}</h4>
          <p>${esc(e.description || '')}</p>
          <small>מקור: ${esc(INTEL_LABELS.sourceType[e.sourceType] || e.sourceType)} | אמינות: ${esc(INTEL_LABELS.credibility[e.credibility] || e.credibility)} | כיוון: ${esc(INTEL_LABELS.impactDirection[e.impactDirection] || e.impactDirection)}</small>
          ${renderCardActions(e.id)}
        </div>
      `).join('')}
    </div>
  `;
}

// Render mortgage view
function renderMortgage(data) {
  const scenarios = Array.isArray(data?.scenarios) ? data.scenarios : [];
  return `
    <div class="mortgage">
      <div class="acct-header"><h3>משכנתאות והלוואות (${scenarios.length})</h3><button class="secondary" data-goto="mortgage-advisor">כלי ייעוץ משכנתאות מלא ←</button></div>
      ${scenarios.length === 0 ? renderEmpty('אין תרחישי הלוואה עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
      ${scenarios.map(s => `
        <div class="card">
          <h4>${esc(s.name)}</h4>
          <p>סכום: ₪${s.principal} | ריבית: ${s.annualRate}% | תקופה: ${s.years} שנים</p>
          ${renderCardActions(s.id)}
        </div>
      `).join('')}
    </div>
  `;
}

// התוכנית הפיננסית — הגדרת התוכנית והפריטים. כל פריט ניתן לעריכה ולמחיקה;
// "＋ הוספת רשומה" פותח טופס עם בחירת סוג (הכנסה / הוצאה / השקעה / תנועת תזרים).
const PF_KINDS = { incomes: 'הכנסה', expenses: 'הוצאה', investments: 'השקעה', cashFlowEntries: 'תנועת תזרים' };
const PF_INCOME_CATS = { salary: 'משכורת', business: 'עסק', rent: 'שכירות', allowance: 'קצבה', other: 'אחר' };
const PF_INVEST_TYPES = { 'stocks-etf': 'קרן מחקה / מניות', bonds: 'אג"ח', deposit: 'פיקדון', pension: 'פנסיה / השתלמות', 'real-estate': 'נדל"ן', other: 'אחר' };
const pfItemActions = (kind, id) => `
  <span class="card-actions inline">
    <button class="icon-btn" data-pf-edit="${esc(kind)}" data-id="${esc(id)}" title="עריכה">✎</button>
    <button class="icon-btn danger" data-pf-del="${esc(kind)}" data-id="${esc(id)}" title="מחיקה">🗑</button>
  </span>`;

function renderPersonalFinance(data) {
  const finance = data || {};
  const incomes = Array.isArray(finance.incomes) ? finance.incomes : [];
  const expenses = Array.isArray(finance.expenses) ? finance.expenses : [];
  const investments = Array.isArray(finance.investments) ? finance.investments : [];
  const cashFlow = Array.isArray(finance.cashFlowEntries) ? finance.cashFlowEntries : [];
  const empty = incomes.length === 0 && expenses.length === 0 && investments.length === 0 && cashFlow.length === 0;

  return `
    <div class="personal-finance">
      <div class="acct-header">
        <div>
          <h3>${esc(finance.planName || 'התוכנית הפיננסית')}</h3>
          <small>מטבע: ${esc(CURRENCY_LABELS[finance.currency] || finance.currency || 'שקל')} · ${incomes.length} הכנסות · ${expenses.length} הוצאות · ${investments.length} השקעות · ${cashFlow.length} תנועות</small>
        </div>
        <div class="acct-actions">
          <button class="secondary" id="pfPlanBtn">עריכת פרטי התוכנית</button>
          <button class="secondary" data-goto="finance">לתמונת המצב ←</button>
        </div>
      </div>
      ${empty ? renderEmpty('התוכנית הפיננסית ריקה עדיין — לחץ "＋ הוספת רשומה" ובחר הכנסה, הוצאה, השקעה או תנועת תזרים') : ''}
      <div class="section">
        <h3>הכנסות (${incomes.length})</h3>
        ${incomes.length === 0 ? '<div class="acct-row muted">אין הכנסות רשומות</div>' : incomes.map(i => `
          <div class="item">
            <span>${esc(i.source)}${i.category ? ` <small class="muted">· ${esc(PF_INCOME_CATS[i.category] || i.category)}</small>` : ''}</span>
            <span>${money(i.amount)} / ${esc(FREQ_LABELS[i.frequency] || 'חודשי')}${pfItemActions('incomes', i.id)}</span>
          </div>
        `).join('')}
      </div>
      <div class="section">
        <h3>הוצאות (${expenses.length})</h3>
        ${expenses.length === 0 ? '<div class="acct-row muted">אין הוצאות רשומות</div>' : expenses.map(e => `
          <div class="item">
            <span>${esc(e.category)}${e.description ? ` <small class="muted">· ${esc(e.description)}</small>` : ''}${e.isFixed === false ? ' <small class="muted">(משתנה)</small>' : ''}</span>
            <span>${money(e.amount)} / ${esc(FREQ_LABELS[e.frequency] || 'חודשי')}${pfItemActions('expenses', e.id)}</span>
          </div>
        `).join('')}
      </div>
      <div class="section">
        <h3>השקעות (${investments.length})</h3>
        ${investments.length === 0 ? '<div class="acct-row muted">אין השקעות רשומות</div>' : investments.map(inv => `
          <div class="item">
            <span>${esc(inv.name)} <small class="muted">· ${esc(PF_INVEST_TYPES[inv.type] || inv.type || '')}${inv.years ? ` · ${esc(inv.years)} שנים` : ''}</small></span>
            <span>${money(inv.principal)} · ${esc(inv.annualRate)}%${inv.monthlyContribution ? ` · +${money(inv.monthlyContribution)} לחודש` : ''}${pfItemActions('investments', inv.id)}</span>
          </div>
        `).join('')}
      </div>
      <div class="section">
        <h3>תזרים מזומנים (${cashFlow.length})</h3>
        ${cashFlow.length === 0 ? '<div class="acct-row muted">אין תנועות תזרים</div>' : [...cashFlow].sort((x, y) => String(y.date).localeCompare(String(x.date))).map(c => `
          <div class="item">
            <span>${esc(c.description || c.category || 'תנועה')} <small class="muted">${esc(c.date)}</small></span>
            <span class="${c.type === 'expense' ? 'neg' : 'pos'}">${c.type === 'expense' ? '−' : '+'}${money(c.amount)}${pfItemActions('cashFlowEntries', c.id)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

const CURRENCY_LABELS = { ILS: 'שקל (₪)', USD: 'דולר ($)', EUR: 'אירו (€)' };

const TASK_LABELS = {
  category: { work: 'עבודה', personal: 'אישי', finance: 'כספים', other: 'אחר' },
  priority: { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' },
  status: { todo: 'לביצוע', 'in-progress': 'בתהליך', done: 'הושלם' }
};
const INTEL_LABELS = {
  sourceType: { news: 'חדשות', report: 'דוח', social: 'רשתות', internal: 'פנימי', other: 'אחר' },
  credibility: { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' },
  impactDirection: { positive: 'חיובי', neutral: 'ניטרלי', negative: 'שלילי' }
};

// Render tasks view
function renderTasks(data) {
  const tasks = data?.tasks || [];
  return `
    <div class="tasks">
      <h3>משימות (${tasks.length})</h3>
      ${tasks.length === 0 ? renderEmpty('אין משימות עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
      ${tasks.map(t => `
        <div class="card ${t.status === 'done' ? 'done' : ''}">
          <h4>${esc(t.title)}</h4>
          <p>${esc(t.description || '')}</p>
          <small>קטגוריה: ${esc(TASK_LABELS.category[t.category] || t.category)} | עדיפות: ${esc(TASK_LABELS.priority[t.priority] || t.priority)} | סטטוס: ${esc(TASK_LABELS.status[t.status] || t.status)}${t.dueDate ? ' | יעד: ' + esc(t.dueDate) : ''}</small>
          ${t.isOverdue ? '<span class="overdue">דחוי!</span>' : ''}
          ${renderCardActions(t.id)}
        </div>
      `).join('')}
    </div>
  `;
}

// Render contacts view
function renderContacts(data) {
  const contacts = data?.contacts || [];
  return `
    <div class="contacts">
      <h3>אנשי קשר (${contacts.length})</h3>
      ${renderSearchBox('חיפוש לפי שם, דוא"ל או חברה...')}
      ${contacts.length === 0 ? renderEmpty('אין אנשי קשר עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
      ${contacts.map(c => `
        <div class="card">
          <h4>${esc(c.name)}</h4>
          <p>${esc(c.email || '')}</p>
          <small>${esc(c.company || '')} | ${esc(c.role || '')}</small>
          ${renderCardActions(c.id)}
        </div>
      `).join('')}
    </div>
  `;
}

// Render fitness view — אימונים, תזונה ומדדים
const FITNESS_KINDS = {
  workout: { emoji: '🏃', label: 'אימון' },
  nutrition: { emoji: '🍎', label: 'תזונה' },
  metric: { emoji: '⚖️', label: 'מדד' }
};

// תרגום ערכי המקרא (השירות שומר באנגלית) לתוויות בעברית
const FITNESS_WORKOUT_TYPES = {
  cardio: 'אירובי', strength: 'כוח', yoga: 'יוגה',
  walking: 'הליכה', sports: 'ספורט', other: 'אחר'
};
const FITNESS_MEAL_TYPES = {
  breakfast: 'בוקר', lunch: 'צהריים', dinner: 'ערב', snack: 'ביניים'
};

function renderFitness(data) {
  const fitness = data || {};
  const workouts = fitness.workouts || [];
  const nutrition = fitness.nutrition || [];
  const metrics = fitness.metrics || [];
  const total = workouts.length + nutrition.length + metrics.length;

  // כרטיס אימון
  const workoutCard = (w) => `
    <div class="card">
      <h4>${FITNESS_KINDS.workout.emoji} ${esc(FITNESS_WORKOUT_TYPES[w.type] || w.type || 'אימון')}</h4>
      <p>משך: ${Number(w.durationMinutes) || 0} דקות${w.caloriesBurned ? ` · ${Number(w.caloriesBurned)} קלוריות` : ''}</p>
      ${w.notes ? `<p>${esc(w.notes)}</p>` : ''}
      <small>תאריך: ${esc(w.date || '')}</small>
    </div>`;
  // כרטיס תזונה
  const nutritionCard = (n) => `
    <div class="card">
      <h4>${FITNESS_KINDS.nutrition.emoji} ${esc(FITNESS_MEAL_TYPES[n.mealType] || n.mealType || 'ארוחה')}</h4>
      <p>${Number(n.calories) || 0} קלוריות</p>
      ${n.description ? `<p>${esc(n.description)}</p>` : ''}
      ${n.notes ? `<p>${esc(n.notes)}</p>` : ''}
      <small>תאריך: ${esc(n.date || '')}</small>
    </div>`;
  // כרטיס מדד
  const metricCard = (m) => `
    <div class="card">
      <h4>${FITNESS_KINDS.metric.emoji} מדד</h4>
      ${m.weightKg !== null && m.weightKg !== undefined ? `<p>משקל: ${Number(m.weightKg)} ק"ג</p>` : ''}
      ${m.bodyFatPercent !== null && m.bodyFatPercent !== undefined ? `<p>אחוז שומן: ${Number(m.bodyFatPercent)}%</p>` : ''}
      ${m.notes ? `<p>${esc(m.notes)}</p>` : ''}
      <small>תאריך: ${esc(m.date || '')}</small>
    </div>`;

  const section = (title, items, renderCard) => `
    <div class="section">
      <h4>${title} (${items.length})</h4>
      ${items.length === 0
        ? renderEmpty('אין רשומות עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל')
        : items.map(renderCard).join('')}
    </div>`;

  return `
    <div class="fitness">
      <h3>כושר ובריאות</h3>
      ${total === 0
        // מסך ריק — הודעה אחת, ולא ארבע הודעות זהות זו מתחת לזו
        ? renderEmpty('אין רשומות כושר עדיין — לחץ "＋ הוספת רשומה" ובחר אימון, תזונה או מדד')
        : section('אימונים', workouts, workoutCard) + section('תזונה', nutrition, nutritionCard) + section('מדדים', metrics, metricCard)}
    </div>
  `;
}

// Render voice notes view
function renderVoiceNotes(data) {
  const notes = Array.isArray(data?.notes) ? data.notes : [];
  return `
    <div class="voice-notes">
      <h3>הערות קוליות (${notes.length})</h3>
      ${renderSearchBox('חיפוש לפי כותרת או תיאור...')}
      ${notes.length === 0 ? renderEmpty('אין הערות קוליות עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
      ${notes.map(n => `
        <div class="card">
          <h4>${esc(n.title)}</h4>
          <p>${esc(n.description || '')}</p>
          <small>משך: ${n.duration}s | תאריך: ${esc(n.recordedAt)}</small>
          ${renderCardActions(n.id)}
        </div>
      `).join('')}
    </div>
  `;
}

// Render canvas view
function renderCanvas(data) {
  const boards = Array.isArray(data?.boards) ? data.boards : [];
  return `
    <div class="canvas">
      <h3>לוחות (${boards.length})</h3>
      ${boards.length === 0 ? renderEmpty('אין לוחות עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
      ${boards.map(b => `
        <div class="card">
          <h4>${esc(b.boardName)}</h4>
          <p>כרטיסים: ${b.cards?.length || 0} | חיבורים: ${b.connections?.length || 0}</p>
          ${renderCardActions(b.id)}
        </div>
      `).join('')}
    </div>
  `;
}
