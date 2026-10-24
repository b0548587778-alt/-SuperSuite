// ממשק המודול הכלכלי — דוחות לעסק (PLAN.md 9.5): תזרים צפוי, כרטסת לקוחות, מקדמות ומע"מ, וכרטיס בלוח הבקרה.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

const BIZ_TABS = [['forecast', '💧 תזרים צפוי'], ['customers', '👥 כרטסת לקוחות'], ['advances', '🧮 מקדמות ומע"מ']];
const BIZ_SOURCE = { invoice: 'חשבונית פתוחה', recurring: 'חשבונית חוזרת', vat: 'מע"מ', advance: 'מקדמה', expenses: 'הערכה' };
const BIZ_PERIOD = { monthly: 'חודשי', bimonthly: 'דו-חודשי' };
const BIZ_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const bizMonthName = (m) => { const [y, mm] = String(m || '').split('-').map(Number); return mm ? `${BIZ_MONTHS[mm - 1]} ${y}` : ''; };
const bizRange = (a, b) => (a === b ? bizMonthName(a) : `${BIZ_MONTHS[Number(a.slice(5)) - 1]}–${bizMonthName(b)}`);
const bizPct = (bp) => `${(Number(bp) || 0) / 100}%`;
const bizTone = (ag) => (ag < 0 ? 'neg' : ag > 0 ? 'pos' : '');

async function loadBizReports() {
  const ui = state.biz || (state.biz = { tab: 'forecast', months: 3, year: new Date().getFullYear(), customer: '' });
  const settings = await window.systemAPI.getBizSettings();
  const out = { ui, settings };
  if (ui.tab === 'forecast') out.forecast = await window.systemAPI.getCashForecast({ months: ui.months, includeExpenses: ui.expenses !== false });
  if (ui.tab === 'customers') {
    out.balances = await window.systemAPI.getCustomerBalances();
    if (ui.customer && !out.balances.some(c => c.customer === ui.customer)) ui.customer = '';
    if (ui.customer) out.ledger = await window.systemAPI.getCustomerLedger(ui.customer, { from: ui.from, to: ui.to });
  }
  if (ui.tab === 'advances') out.advances = await window.systemAPI.getAdvancesReport(ui.year);
  return out;
}

// עמודות התזרים: נכנס מול יוצא לכל חודש, בגובה יחסי (SVG, בלי ספרייה)
function bizFlowChart(buckets) {
  const max = Math.max(1, ...buckets.flatMap(b => [b.inAg, b.outAg]));
  const w = 64, gap = 26, h = 120;
  const bars = buckets.map((b, i) => {
    const x = 20 + i * (w + gap);
    const hi = Math.round((b.inAg / max) * h), ho = Math.round((b.outAg / max) * h);
    return `<g><rect class="biz-in" x="${x}" y="${h - hi + 10}" width="${w / 2 - 3}" height="${hi}" rx="3"><title>נכנס ${agMoney(b.inAg)}</title></rect>
      <rect class="biz-out" x="${x + w / 2}" y="${h - ho + 10}" width="${w / 2 - 3}" height="${ho}" rx="3"><title>יוצא ${agMoney(b.outAg)}</title></rect>
      <text x="${x + w / 2}" y="${h + 28}" text-anchor="middle">${esc(BIZ_MONTHS[Number(b.month.slice(5)) - 1])}</text></g>`;
  }).join('');
  const width = 40 + buckets.length * (w + gap);
  return `<svg class="biz-chart" viewBox="0 0 ${width} ${h + 36}" role="img" aria-label="נכנס ויוצא לפי חודש">
    <line x1="10" y1="${h + 10}" x2="${width - 10}" y2="${h + 10}" class="biz-axis"/>${bars}</svg>
    <div class="biz-legend"><span class="biz-dot biz-in"></span>נכנס <span class="biz-dot biz-out"></span>יוצא</div>`;
}

function renderBizForecast(d) {
  const f = d.forecast;
  if (!f) return renderEmpty('אין נתונים לתחזית');
  const opt = (n) => `<option value="${n}"${f.months === n ? ' selected' : ''}>${n} חודשים</option>`;
  const month = (b) => `
    <div class="card biz-month">
      <h3>${esc(bizMonthName(b.month))}</h3>
      <div class="acct-row"><span>יתרת פתיחה</span><span>${agMoney(b.openingAg)}</span></div>
      ${b.items.map(it => `<div class="acct-row biz-item ${it.amountAg < 0 ? 'out' : 'in'}">
          <span><small class="biz-tag ${esc(it.source)}">${esc(BIZ_SOURCE[it.source] || '')}</small> ${esc(it.label)} <small class="muted">${esc(it.date)}</small></span>
          <span class="${bizTone(it.amountAg)}">${agMoney(it.amountAg)}</span></div>`).join('') || '<div class="acct-row muted">אין תנועות צפויות</div>'}
      <div class="acct-row acct-big ${bizTone(b.closingAg)}"><span>יתרה צפויה בסוף החודש</span><span>${agMoney(b.closingAg)}</span></div>
    </div>`;
  return `
    <div class="acct-header">
      <div>התחזית נבנית מהספרים: יתרת הבנק, חשבוניות פתוחות (לפי תנאי תשלום של ${f.settings.paymentTermsDays} יום), חשבוניות חוזרות, מע"מ ומקדמות לפי הרישומים, והוצאות לפי ממוצע. <b>זו הערכה, לא התחייבות.</b></div>
      <div class="acct-actions">
        <select id="bizMonths" aria-label="טווח התחזית">${opt(3)}${opt(6)}${opt(12)}</select>
        <label class="check"><input type="checkbox" id="bizExpenses"${d.ui.expenses !== false ? ' checked' : ''}> כולל הוצאות משוערות</label>
      </div>
    </div>
    <div class="kpis">
      <div class="kpi ${bizTone(f.openingAg)}"><small>יתרת בנק היום</small><strong>${agMoney(f.openingAg)}</strong></div>
      <div class="kpi ${bizTone(f.closingAg)}"><small>יתרה צפויה בעוד ${f.months} חודשים</small><strong>${agMoney(f.closingAg)}</strong></div>
      <div class="kpi ${bizTone(f.lowest.closingAg)}"><small>הנקודה הנמוכה (${esc(bizMonthName(f.lowest.month))})</small><strong>${agMoney(f.lowest.closingAg)}</strong></div>
      <div class="kpi ${f.overdueAg ? 'neg' : ''}"><small>חייבים באיחור</small><strong>${agMoney(f.overdueAg)}</strong></div>
    </div>
    ${f.negative ? '<div class="card biz-warn">⚠ לפי התחזית היתרה יורדת מתחת לאפס. כדאי לזרז גבייה מחייבים באיחור או לתכנן את מועדי התשלומים.</div>' : ''}
    <div class="card">${bizFlowChart(f.buckets)}</div>
    <div class="acct-grid">${f.buckets.map(month).join('')}</div>`;
}

function renderBizCustomers(d) {
  const list = d.balances || [];
  if (!list.length) return renderEmpty('אין לקוחות עדיין — כרטסת נבנית מהחשבוניות שהופקו', '👥');
  const open = list.reduce((t, c) => t + c.openAg, 0);
  const l = d.ledger;
  return `
    <div class="kpis">
      <div class="kpi"><small>לקוחות</small><strong>${list.length}</strong></div>
      <div class="kpi"><small>עם יתרה פתוחה</small><strong>${list.filter(c => c.openAg > 0).length}</strong></div>
      <div class="kpi ${open ? 'neg' : ''}"><small>סה"כ פתוח</small><strong>${agMoney(open)}</strong></div>
    </div>
    <div class="biz-split">
      <div class="card">
        <h3>יתרות לקוחות</h3>
        <div class="acct-scroll"><table class="acct-table">
          <thead><tr><th>לקוח</th><th>מחזור</th><th>פתוח</th><th>ותיק ביותר</th><th></th></tr></thead>
          <tbody>${list.map(c => `<tr class="${c.customer === d.ui.customer ? 'biz-selected' : ''}">
            <td>${esc(c.customer)}</td><td>${agMoney(c.invoicedAg)}</td>
            <td class="${c.openAg ? 'neg' : ''}">${agMoney(c.openAg)}${c.openCount ? ` <small class="muted">(${c.openCount})</small>` : ''}</td>
            <td>${c.openAg ? `${c.oldestDays} יום` : '—'}</td>
            <td><button class="secondary" data-biz-customer="${esc(c.customer)}">כרטסת</button></td></tr>`).join('')}</tbody>
        </table></div>
      </div>
      <div class="card">
        ${l ? `
          <div class="biz-ledger-head">
            <h3>כרטסת — ${esc(l.customer)}</h3>
            <div class="acct-actions">
              <label class="field-inline">מ- <input type="date" id="bizFrom" value="${esc(d.ui.from || '')}"></label>
              <label class="field-inline">עד <input type="date" id="bizTo" value="${esc(d.ui.to || '')}"></label>
              <button class="secondary" id="bizLedgerCsv">ייצוא ל-Excel</button>
              <button class="secondary" id="bizLedgerPdf">כרטסת להדפסה (PDF)</button>
            </div>
          </div>
          <div class="acct-scroll"><table class="acct-table">
            <thead><tr><th>תאריך</th><th>מסמך</th><th>פרטים</th><th>חובה</th><th>זכות</th><th>יתרה</th></tr></thead>
            <tbody>
              ${l.from ? `<tr class="biz-opening"><td>${esc(l.from)}</td><td></td><td>יתרת פתיחה</td><td></td><td></td><td>${agMoney(l.openingAg)}</td></tr>` : ''}
              ${l.rows.map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.ref)}</td><td>${esc(r.label)}</td>
                <td>${r.debitAg ? agMoney(r.debitAg) : ''}</td><td>${r.creditAg ? agMoney(r.creditAg) : ''}</td><td>${agMoney(r.balanceAg)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">אין תנועות בטווח</td></tr>'}
            </tbody>
            <tfoot><tr><th colspan="3">סה"כ</th><th>${agMoney(l.debitAg)}</th><th>${agMoney(l.creditAg)}</th><th>${agMoney(l.closingAg)}</th></tr></tfoot>
          </table></div>` : '<p class="muted biz-hint">בוחרים לקוח ברשימה כדי לראות את כל המסמכים, התשלומים והיתרה שלו.</p>'}
      </div>
    </div>`;
}

function renderBizAdvances(d) {
  const a = d.advances;
  if (!a) return renderEmpty('אין נתונים');
  const s = a.settings;
  const state_ = { closed: 'הסתיימה', current: 'נוכחית', future: 'עתידית' };
  return `
    <div class="acct-header">
      <div>דיווח ${esc(BIZ_PERIOD[s.period])} · שיעור מקדמה ${esc(bizPct(s.advanceRateBp))}${s.advanceRateBp ? '' : ' — <b>לא הוגדר</b>. השיעור מופיע בהודעה מפקיד השומה.'} · המועד: 15 בחודש שאחרי התקופה.</div>
      <div class="acct-actions">
        <button class="secondary" id="bizYearPrev" aria-label="שנה קודמת">→</button>
        <strong class="biz-year">${a.year}</strong>
        <button class="secondary" id="bizYearNext" aria-label="שנה הבאה">←</button>
        <button class="primary" id="bizSettings">⚙ הגדרות</button>
      </div>
    </div>
    <div class="kpis">
      <div class="kpi"><small>מחזור עסקאות בשנה</small><strong>${agMoney(a.totals.turnoverAg)}</strong></div>
      <div class="kpi"><small>מקדמות לפי השיעור</small><strong>${agMoney(a.totals.advanceAg)}</strong></div>
      <div class="kpi ${bizTone(-a.totals.vatNetAg)}"><small>מע"מ נטו בשנה</small><strong>${agMoney(a.totals.vatNetAg)}</strong></div>
    </div>
    <div class="card">
      <div class="acct-scroll"><table class="acct-table">
        <thead><tr><th>תקופה</th><th>מצב</th><th>מחזור (בלי מע"מ)</th><th>מקדמה</th><th>מע"מ עסקאות</th><th>מע"מ תשומות</th><th>מע"מ לתשלום</th><th>מועד</th></tr></thead>
        <tbody>${a.rows.map(r => `<tr class="biz-${r.state}">
          <td>${esc(bizRange(r.start, r.end))}</td><td>${state_[r.state]}</td><td>${agMoney(r.turnoverAg)}</td><td>${agMoney(r.advanceAg)}</td>
          <td>${agMoney(r.outputVatAg)}</td><td>${agMoney(r.inputVatAg)}</td><td class="${bizTone(-r.vatNetAg)}">${agMoney(r.vatNetAg)}</td><td>${esc(r.due)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="2">סה"כ</th><th>${agMoney(a.totals.turnoverAg)}</th><th>${agMoney(a.totals.advanceAg)}</th><th colspan="2"></th><th>${agMoney(a.totals.vatNetAg)}</th><th></th></tr></tfoot>
      </table></div>
      <p class="muted">המחזור והמע"מ מחושבים מהחשבוניות ומהיומן. הדוח לא יודע מה כבר שולם — הוא כלי לבדיקה מול הדיווח, לא תחליף לרואה החשבון.</p>
    </div>`;
}

function renderBizReports(d) {
  if (!d) return renderEmpty('אין נתונים להצגה');
  const tabs = BIZ_TABS.map(([id, label]) => `<button class="biz-tab${d.ui.tab === id ? ' active' : ''}" data-biz-tab="${id}" aria-pressed="${d.ui.tab === id}">${label}</button>`).join('');
  const body = d.ui.tab === 'customers' ? renderBizCustomers(d) : d.ui.tab === 'advances' ? renderBizAdvances(d) : renderBizForecast(d);
  return `<div class="biz-reports"><div class="biz-tabs" role="tablist">${tabs}</div>${body}</div>`;
}

// כרטיס בלוח הבקרה: תזרים קצר, חייבים ותשלומים קרובים
function renderBizDashCard(s) {
  if (!s) return '';
  const months = (s.months || []).map(m => `<div class="acct-row"><span>${esc(bizMonthName(m.month))}</span><span class="${bizTone(m.closingAg)}">${agMoney(m.closingAg)}</span></div>`).join('');
  const debtors = (s.topDebtors || []).map(c => `<div class="acct-row"><span>${esc(c.customer)}${c.oldestDays > 30 ? ` <small class="muted">${c.oldestDays} יום</small>` : ''}</span><span>${agMoney(c.openAg)}</span></div>`).join('');
  const pays = (s.payments || []).map(p => `<div class="acct-row"><span>${esc(p.label)} <small class="muted">${esc(p.date)}</small></span><span class="neg">${agMoney(p.amountAg)}</span></div>`).join('');
  return `
    <div class="hub-grid biz-dash">
      <div class="card">
        <h3>💧 תזרים צפוי ${s.negative ? '<span class="bad">⚠ יורד מתחת לאפס</span>' : ''}</h3>
        <div class="acct-row"><span>יתרת בנק היום</span><span>${agMoney(s.bankAg)}</span></div>
        ${months}
        <button class="secondary" data-biz-goto="forecast">לתחזית המלאה</button>
      </div>
      <div class="card">
        <h3>👥 חייבים ${s.overdueAg ? `<small class="muted">באיחור: ${agMoney(s.overdueAg)}</small>` : ''}</h3>
        ${debtors || '<p class="muted">אין יתרות פתוחות</p>'}
        <button class="secondary" data-biz-goto="customers">לכרטסת הלקוחות</button>
      </div>
      <div class="card">
        <h3>🧮 תשלומים קרובים לרשויות</h3>
        ${pays || '<p class="muted">אין תשלום מע"מ או מקדמה בשלושת החודשים הקרובים</p>'}
        ${s.advanceRateBp ? '' : '<p class="muted">שיעור המקדמה לא הוגדר.</p>'}
        <button class="secondary" data-biz-goto="advances">למקדמות ומע"מ</button>
      </div>
    </div>`;
}

async function handleBizSettings() {
  const s = state.data.bizReports && state.data.bizReports.settings;
  const v = await licForm('הגדרות דוחות לעסק', [
    { name: 'paymentTermsDays', label: 'תנאי תשלום ללקוחות (ימים)', type: 'number', max: 365, required: true, value: s ? s.paymentTermsDays : 30 },
    { name: 'period', label: 'תקופת דיווח למע"מ ולמקדמות', type: 'select', options: [['bimonthly', 'דו-חודשי'], ['monthly', 'חודשי']], value: s ? s.period : 'bimonthly' },
    { name: 'advanceRatePct', label: 'שיעור מקדמת מס הכנסה (%)', value: s ? String(s.advanceRateBp / 100) : '0' }
  ], 'שמירה', 'השיעור מופיע בהודעה מפקיד השומה. אם לא נקבעה מקדמה — 0.');
  if (!v) return;
  await window.systemAPI.saveBizSettings({ ...v, paymentTermsDays: Number(v.paymentTermsDays) });
  showToast('ההגדרות נשמרו');
}

function attachBizHandlers() {
  const ui = state.biz;
  const act = (fn) => async () => { try { await fn(); } catch (error) { showError(errMsg(error)); return; } await switchView('biz-reports'); };
  document.querySelectorAll('[data-biz-tab]').forEach(b => b.addEventListener('click', act(() => { ui.tab = b.dataset.bizTab; })));
  const months = document.getElementById('bizMonths');
  if (months) months.addEventListener('change', act(() => { ui.months = Number(months.value); }));
  const exp = document.getElementById('bizExpenses');
  if (exp) exp.addEventListener('change', act(() => { ui.expenses = exp.checked; }));
  document.querySelectorAll('[data-biz-customer]').forEach(b => b.addEventListener('click', act(() => { ui.customer = b.dataset.bizCustomer; })));
  const from = document.getElementById('bizFrom'), to = document.getElementById('bizTo');
  if (from) from.addEventListener('change', act(() => { ui.from = from.value || undefined; }));
  if (to) to.addEventListener('change', act(() => { ui.to = to.value || undefined; }));
  const csv = document.getElementById('bizLedgerCsv');
  if (csv) csv.addEventListener('click', async () => {
    const l = state.data.bizReports && state.data.bizReports.ledger;
    if (!l) return;
    try {
      const r = await window.systemAPI.exportCustomerLedger(l.customer, { from: ui.from, to: ui.to });
      if (r && r.ok) showToast('הכרטסת נשמרה');
    } catch (error) { showError(errMsg(error)); }
  });
  const pdf = document.getElementById('bizLedgerPdf');
  if (pdf) pdf.addEventListener('click', async () => {
    const l = state.data.bizReports && state.data.bizReports.ledger;
    if (!l) return;
    try {
      const r = await window.systemAPI.exportCustomerLedgerPdf(l.customer, { from: ui.from, to: ui.to });
      if (r && r.ok) showToast('הכרטסת נשמרה כ-PDF');
    } catch (error) { showError(errMsg(error)); }
  });
  const prev = document.getElementById('bizYearPrev'), next = document.getElementById('bizYearNext');
  if (prev) prev.addEventListener('click', act(() => { ui.year -= 1; }));
  if (next) next.addEventListener('click', act(() => { ui.year += 1; }));
  const set = document.getElementById('bizSettings');
  if (set) set.addEventListener('click', act(handleBizSettings));
}

// כפתורי הכרטיס בלוח הבקרה — פותחים את המסך בלשונית המתאימה
function attachBizDashHandlers() {
  document.querySelectorAll('[data-biz-goto]').forEach(b => b.addEventListener('click', () => {
    state.biz = { ...(state.biz || { months: 3, year: new Date().getFullYear(), customer: '' }), tab: b.dataset.bizGoto };
    switchView('biz-reports');
  }));
}
