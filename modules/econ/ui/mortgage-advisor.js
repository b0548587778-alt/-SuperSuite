// ממשק המודול הכלכלי — ייעוץ משכנתאות.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

// ============================================================
// ייעוץ משכנתאות — תיקי לקוחות, מחשבון מסלולים, השוואת הצעות בנקים, עמלה ומסמכים
// ============================================================
// שלבי התיק — רשימת הגיבוי. בפועל נלקחים מהשרת (statuses), כדי שיהיה מקור אחד
const MADV_STATUS = {
  lead: 'פנייה', meeting: 'פגישת היכרות', documents: 'איסוף מסמכים', submitted: 'הוגש לבנקים', principle: 'אישורים עקרוניים',
  negotiation: 'משא ומתן', final: 'אישור סופי', signing: 'חתימה וביצוע', closed: 'הסתיים', lost: 'לא התקדם'
};
const MADV_TRACKS = [
  ['fixed-indexed', 'קבועה צמודה'], ['fixed-unindexed', 'קבועה לא צמודה'],
  ['variable-5', 'משתנה כל 5 שנים'], ['prime', 'פריים']
];
const trackFields = () => MADV_TRACKS.flatMap(([k, label]) => [
  { name: `${k}_amount`, label: `${label} — סכום (₪)`, type: 'number' },
  { name: `${k}_rate`, label: `${label} — ריבית שנתית (%)`, type: 'number' },
  { name: `${k}_years`, label: `${label} — תקופה (שנים)`, type: 'number' }
]);

formSchemas['mortgage-advisor'] = {
  title: 'תיק לקוח חדש',
  fields: [
    { name: 'name', label: 'שם הלקוח', type: 'text', required: true },
    { name: 'phone', label: 'טלפון', type: 'tel' },
    { name: 'bank', label: 'בנק מוביל', type: 'text' },
    { name: 'requestedAmount', label: 'סכום מבוקש (₪)', type: 'number', required: true },
    { name: 'propertyValue', label: 'שווי הנכס (₪)', type: 'number' },
    { name: 'status', label: 'שלב', type: 'select', options: opts(MADV_STATUS) },
    { name: 'advisorId', label: 'יועץ אחראי', type: 'select', options: [{ value: '', label: 'ללא שיוך' }] },
    { name: 'employment', label: 'תעסוקת הלווים', type: 'select', options: opts({ employee: 'שכיר', selfEmployed: 'עצמאי', mixed: 'שכיר ועצמאי', pension: 'פנסיונר' }) },
    { name: 'deal', label: 'סוג העסקה', type: 'select', options: opts({ secondHand: 'דירה יד שנייה', contractor: 'דירה מקבלן', upgrader: 'משפר דיור (מוכר דירה קיימת)', refinance: 'מחזור משכנתא' }) },
    { name: 'lostReason', label: 'סיבה (אם התיק לא התקדם)', type: 'text' },
    { name: 'feeType', label: 'סוג עמלת ייעוץ', type: 'select', options: [
      { value: 'percent', label: 'אחוז מהסכום המבוקש' },
      { value: 'fixed', label: 'סכום קבוע' }
    ]},
    { name: 'feeValue', label: 'עמלה (% או ₪, לפני מע"מ)', type: 'number' },
    { name: 'feeDeposit', label: 'מקדמה שמבקשים מראש (₪, כולל מע"מ)', type: 'number' },
    { name: 'notes', label: 'הערות', type: 'textarea' }
  ],
  create: (d) => window.systemAPI.createMortgageClient(d),
  update: (id, d) => window.systemAPI.updateMortgageClient(id, d),
  remove: (id) => window.systemAPI.deleteMortgageClient(id),
  confirmText: 'למחוק את תיק הלקוח וכל הצעות הבנקים שלו? הפעולה אינה ניתנת לביטול.'
};

const madvOfferSchema = {
  title: 'הצעת בנק חדשה',
  prepare: async (schema) => {
    const o = state.data.mortgageAdvisor || {};
    schema.fields.find(f => f.name === 'clientId').options = (Array.isArray(o.clients) ? o.clients : []).map(c => ({ value: c.id, label: c.name }));
    schema.fields.find(f => f.name === 'date').value = today();
  },
  fields: [
    { name: 'clientId', label: 'לקוח', type: 'select', required: true, options: [] },
    { name: 'bank', label: 'בנק', type: 'text', required: true },
    { name: 'date', label: 'תאריך ההצעה', type: 'date' },
    { name: 'cpi', label: 'הנחת מדד שנתית למסלול צמוד (%)', type: 'number' },
    ...trackFields(),
    { name: 'notes', label: 'הערות', type: 'textarea' }
  ],
  create: (d) => window.systemAPI.addMortgageOffer(d)
};

function madvSummaryHtml(sum, yearly) {
  return `
    <div class="acct-row"><span>סכום ההלוואה</span><span>${money(sum.principal)}</span></div>
    <div class="acct-row"><span>החזר חודשי ראשון</span><span>${money(sum.firstPayment)}</span></div>
    <div class="acct-row"><span>החזר חודשי מקסימלי</span><span>${money(sum.maxPayment)}</span></div>
    <div class="acct-row"><span>סה"כ ריבית</span><span>${money(sum.totalInterest)}</span></div>
    <div class="acct-row"><span>סה"כ הצמדה</span><span>${money(sum.totalIndexation)}</span></div>
    <div class="acct-row acct-big"><span>סה"כ תשלומים</span><span>${money(sum.totalPaid)}</span></div>
    ${Array.isArray(yearly) && yearly.length ? `
    <details><summary>לוח סילוקין שנתי (${yearly.length} שנים)</summary>
      <div class="acct-scroll"><table class="acct-table">
        <thead><tr><th>שנה</th><th>תשלומים</th><th>ריבית</th><th>קרן</th><th>הצמדה</th><th>יתרה</th></tr></thead>
        <tbody>${yearly.map(y => `<tr><td>${y.year}</td><td>${money(y.payment)}</td><td>${money(y.interest)}</td><td>${money(y.principal)}</td><td>${money(y.indexation)}</td><td>${money(y.balance)}</td></tr>`).join('')}</tbody>
      </table></div>
    </details>` : ''}`;
}

// רשימת היועצים בטופס התיק מתעדכנת בכל רינדור — prepare היה מונע את מילוי הערכים בעריכה.
// יועץ שאינו מנהל רואה רק את עצמו (השרת דוחה שיוך לאחר בכל מקרה)
function madvSyncAdvisorField(o) {
  const f = formSchemas['mortgage-advisor'].fields.find(x => x.name === 'advisorId');
  const me = (o && o.me) || {};
  const list = Array.isArray(o && o.advisors) ? o.advisors : [];
  const allowed = me.isManager ? list : list.filter(a => a.id === me.id);
  f.options = [{ value: '', label: 'ללא שיוך' }, ...allowed.map(a => ({ value: a.id, label: a.name }))];
  if (!me.isManager && me.id) f.value = me.id;
  const st = formSchemas['mortgage-advisor'].fields.find(x => x.name === 'status');
  if (o && o.statuses) st.options = opts(o.statuses);
}

function madvBoardHtml(board) {
  if (!board || !Array.isArray(board.columns)) return '';
  return `
      <div class="card">
        <div class="acct-header">
          <h3>צנרת התיקים (${board.openCount} פתוחים)</h3>
          ${board.stuckCount ? `<span class="ss-badge ss-badge-warning">⚠ ${board.stuckCount} תיקים תקועים יותר מ-${board.stuckDays} ימים</span>` : ''}
        </div>
        <div class="ss-board">${board.columns.map(col => `
          <div class="ss-board-col${col.closed ? ' is-closed' : ''}">
            <h4><span>${esc(col.label)}</span><span>${col.cards.length}</span></h4>
            ${col.cards.map(k => `<div class="ss-board-card${k.stuck ? ' is-stuck' : ''}">
              <strong>${esc(k.name)}</strong>
              <span>${money(k.requestedAmount)}</span><br>
              <small>${k.advisorName ? esc(k.advisorName) + ' · ' : ''}${k.days} ימים בשלב${k.stuck ? ' ⚠' : ''}</small>
              ${k.lostReason ? `<br><small>${esc(k.lostReason)}</small>` : ''}
            </div>`).join('')}
          </div>`).join('')}
        </div>
      </div>`;
}

// אישורים עקרוניים של התיק — הרשימה כאן, העריכה במעבדת התמהיל (אותו עורך), וההשוואה במנוע המעבדה
function madvApprovalsHtml(c) {
  const list = Array.isArray(c.approvals) ? c.approvals : [];
  return `
          <h4>אישורים עקרוניים (${list.length})</h4>
          ${list.length ? `<div class="acct-scroll"><table class="acct-table">
            <thead><tr><th>בנק</th><th>התקבל</th><th>בתוקף עד</th><th>עמלות</th><th>סכום מאושר</th><th>נבחר</th></tr></thead>
            <tbody>${list.map(a => `<tr>
              <td>${esc(a.lender)}</td><td>${esc(a.receivedAt || '')}</td>
              <td>${esc(a.validUntil || '—')}${a.expired ? ' <span class="ss-badge ss-badge-warning">פג תוקף</span>' : ''}</td>
              <td>${money(a.fees)}</td><td>${a.maxAmount === '' ? '—' : money(a.maxAmount)}</td>
              <td><button class="icon-btn" data-madv-choose="${esc(c.id)}" data-appr="${a.chosen ? '' : esc(a.id)}" title="${a.chosen ? 'ביטול הבחירה' : 'בחירת האישור הזה'}">${a.chosen ? '★' : '☆'}</button></td>
            </tr>`).join('')}</tbody>
          </table></div>` : '<div class="acct-row muted">אין עדיין אישורים עקרוניים בתיק</div>'}
          <div class="acct-actions">
            <button class="secondary" data-madv-appr-edit="${esc(c.id)}">${list.length ? 'עריכת האישורים' : '＋ הזנת אישורים'} במעבדת התמהיל</button>
            ${list.length ? `<button data-madv-appr-cmp="${esc(c.id)}">השוואת האישורים</button>` : ''}
          </div>
          <div id="madvApprOut-${esc(c.id)}"></div>`;
}

function madvApprovalsResultHtml(r) {
  const rank = Object.fromEntries((r.byTotalCost || []).map((id, i) => [id, i + 1]));
  return `<div class="acct-scroll"><table class="acct-table">
    <thead><tr><th>דירוג</th><th>בנק</th><th>החזר ראשון</th><th>החזר מקסימלי</th><th>עלות כוללת עם עמלות</th><th>הערות</th></tr></thead>
    <tbody>${(r.offers || []).map(x => `<tr><td>${rank[x.offer.id] || '—'}</td><td>${esc(x.offer.lender)}</td>
      <td>${x.result ? money(x.result.summary.firstPayment) : '—'}</td><td>${x.result ? money(x.result.summary.maxPayment) : '—'}</td>
      <td>${x.totalCostWithFees == null ? '—' : money(x.totalCostWithFees)}</td>
      <td>${[x.expired ? 'פג תוקף' : '', x.overMax ? 'מעל הסכום המאושר' : '', x.error ? esc(x.error) : ''].filter(Boolean).join(' · ')}</td></tr>`).join('')}</tbody>
  </table></div>
  <p class="muted">החישוב לפי התחזית שבמעבדת התמהיל. להמחשה בלבד — הבנק קובע את התנאים הסופיים.</p>`;
}

// חלון עם טקסט להעתקה (התוכנה לא שולחת — המשתמש מעתיק לערוץ שלו)
function madvShowMessage(title, text) {
  return openDialog((card, finish) => {
    const h = document.createElement('h2');
    h.textContent = title;
    const ta = document.createElement('textarea');
    ta.rows = 12; ta.readOnly = true; ta.value = text; ta.className = 'ss-input';
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'secondary'; close.textContent = 'סגירה';
    const copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'primary'; copy.textContent = '📋 העתקה';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(ta.value); showToast('הנוסח הועתק'); }
      catch { ta.select(); showToast('סמנו והעתיקו (Ctrl+C)'); }
    });
    close.addEventListener('click', () => finish(null));
    actions.append(close, copy);
    card.append(h, ta, actions);
  });
}

// פתיחת המעבדה עם האישורים של התיק, לשמירה חזרה לאותו תיק
function madvOpenApprovalsInLab(c) {
  const lab = labState();
  const list = Array.isArray(c.approvals) ? c.approvals : [];
  lab.approvals = list.length
    ? list.map(a => ({ id: a.id, lender: a.lender, validUntil: a.validUntil || '', fees: a.fees, maxAmount: a.maxAmount, tracks: a.tracks.map(t => ({ ...t })) }))
    : [{ lender: '', validUntil: '', fees: '', maxAmount: '', tracks: labShares(labDefaultMix(), [34, 33, 33]) }];
  lab.form.apAmount = c.requestedAmount;
  lab.form.apClient = c.id;
  lab.results.approvals = null;
  lab.tab = 'approvals';
  return switchView('mortgage-lab');
}

// תשלומי העמלה בתיק: מצב, יתרה, רשימה, והפקת חשבונית (רק כשהנהלת החשבונות ברישיון)
function madvFeePaymentsHtml(c, o) {
  const st = c.feeStatus;
  if (!st) return '';
  const states = (o && o.feeStates) || {};
  const methods = (o && o.feeMethods) || {};
  const pays = Array.isArray(c.feePayments) ? c.feePayments : [];
  return `
              <div class="acct-row"><span>מצב</span><span class="ss-badge${st.state === 'partial' || st.state === 'open' ? ' ss-badge-warning' : ''}">${esc(states[st.state] || st.state)}</span></div>
              <div class="acct-row"><span>שולם</span><span>${money(st.paid)}</span></div>
              <div class="acct-row"><span>יתרה</span><span>${money(st.balance)}</span></div>
              ${st.deposit ? `<div class="acct-row"><span>מקדמה</span><span>${money(st.deposit)}${st.depositDueAg ? ' — טרם התקבלה במלואה' : ' ✓'}</span></div>` : ''}
              ${pays.map(p => `<div class="acct-row"><span>${esc(p.date)} · ${esc(methods[p.method] || '')}${p.note ? ' · ' + esc(p.note) : ''}</span><span>${money(p.amount)}
                ${p.invoiceNumber ? `<small>חשבונית ${esc(p.invoiceNumber)}</small>` : `${o && o.canInvoice ? `<button class="icon-btn" data-madv-invoice="${esc(c.id)}" data-pay="${esc(p.id)}" title="הפקת חשבונית מס/קבלה">🧾</button>` : ''}
                <button class="icon-btn danger" data-madv-paydel="${esc(c.id)}" data-pay="${esc(p.id)}" title="מחיקת תשלום">🗑</button>`}</span></div>`).join('')}
              ${st.state !== 'none' ? `<button class="secondary" data-madv-pay="${esc(c.id)}">＋ תשלום שהתקבל</button>` : ''}`;
}

function madvIncomeHtml(inc) {
  if (!inc) return '<div id="madvIncomeOut"></div>';
  const max = Math.max(1, ...inc.months.map(m => m.receivedAg));
  return `<div id="madvIncomeOut">
        <div class="acct-row acct-total"><span>התקבל בשנת ${esc(inc.year)}</span><span>${money(inc.received)}</span></div>
        <div class="acct-row"><span>יתרות פתוחות בתיקים (בלי תיקים שלא התקדמו)</span><span>${money(inc.outstanding)}</span></div>
        <div class="acct-scroll"><table class="acct-table">
          <thead><tr><th>חודש</th><th>התקבל</th><th></th></tr></thead>
          <tbody>${inc.months.map(m => `<tr><td>${esc(m.month)}</td><td>${money(m.received)}</td><td><progress max="${max}" value="${m.receivedAg}" aria-label="${esc(m.month)}"></progress></td></tr>`).join('')}</tbody>
        </table></div>
        <h4>לפי יועץ</h4>
        <div class="acct-scroll"><table class="acct-table">
          <thead><tr><th>יועץ</th><th>תיקים</th><th>הסתיימו</th><th>התקבל</th><th>יתרה פתוחה</th></tr></thead>
          <tbody>${inc.advisors.map(a => `<tr><td>${esc(a.name)}</td><td>${a.cases}</td><td>${a.closedCases}</td><td>${money(a.received)}</td><td>${money(a.outstanding)}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>`;
}

function madvBrandHtml(o) {
  if (!o || !o.me || !o.me.isManager) return '';
  const b = o.brand || {};
  const f = (k, label, type = 'text') => `<label>${label} <input type="${type}" class="ss-input" id="madvBrand_${k}" value="${esc(b[k] || '')}"></label>`;
  return `
      <details class="card"><summary>מיתוג הדוח ללקוח</summary>
        <p class="muted">מופיע בראש הדוח ללקוח. בלי שם משרד — שם העסק מהגדרות הנהלת החשבונות.</p>
        ${f('officeName', 'שם המשרד')} ${f('licenseNo', 'מספר רישיון')} ${f('phone', 'טלפון')} ${f('email', 'דוא"ל', 'email')} ${f('address', 'כתובת')}
        <label>צבע המותג <input type="color" id="madvBrand_brandColor" value="${esc(b.brandColor || '')}"></label>
        <label>הסתייגות בתחתית הדוח <textarea class="ss-input" id="madvBrand_disclaimer" rows="2">${esc(b.disclaimer || '')}</textarea></label>
        <div class="acct-actions">
          <button id="madvSaveBrand">שמירת המיתוג</button>
          <button class="secondary" id="madvLogoBtn">${b.hasLogo ? 'החלפת הלוגו' : 'בחירת לוגו'}</button>
          ${b.hasLogo ? '<button class="secondary" id="madvLogoDel">הסרת הלוגו</button>' : ''}
        </div>
      </details>`;
}

function madvSettingsHtml(o) {
  if (!o || !o.me || !o.me.isManager || !o.settings) return '';
  return `
      <details class="card"><summary>הגדרות המשרד</summary>
        <label class="doc-check"><input type="checkbox" id="madvOwnOnly"${o.settings.ownOnly ? ' checked' : ''}> כל יועץ רואה רק את התיקים שלו (ותיקים שלא שויכו). המנהל רואה הכול</label>
        <label>תיק נחשב "תקוע" אחרי <input type="number" id="madvStuckDays" min="1" max="365" value="${Number(o.settings.stuckDays) || 14}"> ימים באותו שלב</label>
        <div class="acct-actions"><button id="madvSaveSettings">שמירת ההגדרות</button></div>
      </details>`;
}

function renderMortgageAdvisor(o) {
  const clients = Array.isArray(o && o.clients) ? o.clients : [];
  madvSyncAdvisorField(o);
  const statuses = (o && o.statuses) || MADV_STATUS;
  return `
    <div class="mortgage-advisor">
      ${clients.length ? madvBoardHtml(o.board) : ''}
      ${clients.length ? `<details class="card"><summary>הכנסות המשרד</summary>
        <div class="acct-actions"><label>שנה <input type="number" id="madvIncomeYear" min="2000" max="2100" value="${new Date().getFullYear()}"></label><button id="madvIncomeBtn">הצגה</button></div>
        ${madvIncomeHtml(null)}
      </details>` : ''}
      ${madvSettingsHtml(o)}
      ${madvBrandHtml(o)}
      <div class="card">
        <h3>מחשבון מסלולים</h3>
        <p class="muted">הזן סכום, ריבית ותקופה לכל מסלול רלוונטי. ריבית במשתנה ובפריים מחושבת כקבועה לאורך התקופה; המדד הוא הנחה שלך.</p>
        <div class="acct-scroll"><table class="acct-table">
          <thead><tr><th>מסלול</th><th>סכום (₪)</th><th>ריבית (%)</th><th>שנים</th></tr></thead>
          <tbody>${MADV_TRACKS.map(([k, label]) => `<tr><td>${label}</td>
            <td><input type="number" id="calc_${k}_amount" min="0"></td>
            <td><input type="number" id="calc_${k}_rate" step="0.01" min="0"></td>
            <td><input type="number" id="calc_${k}_years" min="1" max="35"></td></tr>`).join('')}</tbody>
        </table></div>
        <div class="acct-actions">
          <label>מדד שנתי (%) <input type="number" id="calc_cpi" step="0.1" value="2"></label>
          <button id="madvCalcBtn">חשב</button>
          <button class="secondary" data-goto="mortgage-lab">מעבדת תמהיל מלאה ←</button>
          <button class="secondary" id="madvOfferBtn"${clients.length ? '' : ' disabled'}>＋ הצעת בנק ללקוח</button>
        </div>
        <div id="madvCalcOut"></div>
      </div>
      <h3>תיקי לקוחות (${clients.length})</h3>
      ${clients.length === 0 ? renderEmpty('אין תיקי לקוחות עדיין — לחץ "＋ הוספת רשומה" כדי לפתוח תיק') : ''}
      ${clients.map(c => {
        const docs = c.docs && Array.isArray(c.docs.items) ? c.docs : { done: 0, total: 0, items: [] };
        const fee = c.fee || {};
        const cmp = Array.isArray(c.comparison) ? c.comparison : [];
        const offers = Array.isArray(c.offers) ? c.offers : [];
        return `
        <div class="card">
          <div class="acct-header">
            <div>
              <h4>${esc(c.name)}${c.phone ? ` <small class="muted">${esc(c.phone)}</small>` : ''}</h4>
              <small>${c.bank ? esc(c.bank) + ' · ' : ''}מבוקש ${money(c.requestedAmount)}${c.ltv != null ? ` · מימון ${c.ltv}%` : ''}${c.advisorName ? ` · יועץ: ${esc(c.advisorName)}` : ''} · ${Number(c.daysInStage) || 0} ימים בשלב</small>
            </div>
            <div class="acct-actions">
              <select data-madv-status="${esc(c.id)}" aria-label="שלב התיק">${Object.entries(statuses).map(([v, l]) => `<option value="${v}"${c.status === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
              ${renderCardActions(c.id)}
            </div>
          </div>
          <div class="acct-grid">
            <div>
              <h4>עמלת ייעוץ</h4>
              <div class="acct-row"><span>לפני מע"מ ${c.feeType === 'percent' ? `(${Number(c.feeValue) || 0}%)` : ''}</span><span>${money(fee.net)}</span></div>
              <div class="acct-row"><span>מע"מ</span><span>${money(fee.vat)}</span></div>
              <div class="acct-row acct-total"><span>סה"כ</span><span>${money(fee.total)}</span></div>
              ${madvFeePaymentsHtml(c, o)}
            </div>
            <div>
              <h4>מסמכים (${docs.done}/${docs.total})${docs.profile ? ` <small class="muted">${esc((o.employment || {})[docs.profile.employment] || '')} · ${esc((o.deals || {})[docs.profile.deal] || '')}</small>` : ''}</h4>
              ${docs.items.map(d => `<label class="doc-check"><input type="checkbox" data-madv-doc="${esc(c.id)}" data-key="${esc(d.key)}"${d.done ? ' checked' : ''}${d.na ? ' disabled' : ''}> <span${d.na ? ' class="muted"' : ''}>${esc(d.label)}</span>
                <button class="icon-btn" data-madv-docna="${esc(c.id)}" data-key="${esc(d.key)}" data-na="${d.na ? '1' : ''}" title="${d.na ? 'סימון כרלוונטי' : 'לא רלוונטי לתיק הזה'}">${d.na ? '↺' : '⊘'}</button></label>`).join('')}
              ${Array.isArray(docs.missing) && docs.missing.length ? `<button class="secondary" data-madv-missing="${esc(c.id)}">נוסח ללקוח: ${docs.missing.length} מסמכים חסרים</button>` : ''}
            </div>
          </div>
          ${madvApprovalsHtml(c)}
          <h4>השוואת הצעות (${cmp.length})</h4>
          ${cmp.length === 0 ? '<div class="acct-row muted">אין הצעות עדיין</div>' : `
          <div class="acct-scroll"><table class="acct-table">
            <thead><tr><th>בנק</th><th>החזר ראשון</th><th>החזר מקסימלי</th><th>סה"כ תשלומים</th><th>עלות האשראי</th><th>פער מהזולה</th><th></th></tr></thead>
            <tbody>${cmp.map(r => `<tr>
              <td>${esc(r.bank)}${r.cheapest ? ' <span class="ok">★ הזולה</span>' : ''}${r.lowestFirstPayment ? ' <span class="ok">החזר נמוך</span>' : ''}</td>
              <td>${money(r.firstPayment)}</td><td>${money(r.maxPayment)}</td><td>${money(r.totalPaid)}</td>
              <td>${money(r.costOfCredit)}</td><td>${money(r.diffFromBest)}</td>
              <td><button class="icon-btn" data-madv-export="${esc(r.id)}" title="ייצוא לוח סילוקין">📊</button>
                  <button class="icon-btn danger" data-madv-offer-del="${esc(r.id)}" title="מחיקת הצעה">🗑</button></td>
            </tr>`).join('')}</tbody>
          </table></div>
          ${offers.map(of => `<details><summary>${esc(of.bank)} — פירוט מסלולים</summary>
            ${(of.summary && Array.isArray(of.summary.tracks) ? of.summary.tracks : []).map(t => `<div class="acct-row"><span>${esc(t.label)}</span><span>${money(t.amount)} · ${t.rate}% · ${t.years} שנים</span></div>`).join('')}
            ${of.summary ? madvSummaryHtml(of.summary, of.yearly) : ''}
          </details>`).join('')}`}
          ${c.notes ? `<p class="muted">${esc(c.notes)}</p>` : ''}
          <div class="acct-actions"><button class="secondary" data-madv-report="${esc(c.id)}">📄 דוח ללקוח (PDF)</button></div>
        </div>`;
      }).join('')}
    </div>`;
}

function attachMadvHandlers() {
  const calcBtn = document.getElementById('madvCalcBtn');
  if (calcBtn) calcBtn.addEventListener('click', async () => {
    const input = { cpi: (document.getElementById('calc_cpi') || {}).value };
    for (const [k] of MADV_TRACKS) for (const p of ['amount', 'rate', 'years']) {
      const el = document.getElementById(`calc_${k}_${p}`);
      if (el && el.value !== '') input[`${k}_${p}`] = Number(el.value);
    }
    const out = document.getElementById('madvCalcOut');
    try {
      const r = await window.systemAPI.calcMortgageTracks(input);
      if (out) out.innerHTML = madvSummaryHtml(r.summary, r.yearly);
    } catch (error) { showError('שגיאה בחישוב: ' + errMsg(error)); }
  });
  const offerBtn = document.getElementById('madvOfferBtn');
  if (offerBtn) offerBtn.addEventListener('click', () => {
    // הערכים שבמחשבון עוברים להצעה — כך מחשבים פעם אחת ושומרים כהצעה ללקוח
    const values = { cpi: (document.getElementById('calc_cpi') || {}).value };
    for (const [k] of MADV_TRACKS) for (const p of ['amount', 'rate', 'years']) {
      const el = document.getElementById(`calc_${k}_${p}`);
      if (el && el.value !== '') values[`${k}_${p}`] = el.value;
    }
    openSubForm(madvOfferSchema, values);
  });
  document.querySelectorAll('[data-madv-status]').forEach(sel => sel.addEventListener('change', async () => {
    const patch = { status: sel.value };
    if (sel.value === 'lost') {
      const v = await askFields('למה התיק לא התקדם?', [{ name: 'lostReason', label: 'סיבה (לא חובה)' }], 'שמירה');
      if (!v) { await switchView('mortgage-advisor'); return; }
      patch.lostReason = v.lostReason || '';
    }
    try { await window.systemAPI.updateMortgageClient(sel.dataset.madvStatus, patch); showToast('השלב עודכן'); await switchView('mortgage-advisor'); }
    catch (error) { showError('שגיאה בעדכון: ' + errMsg(error)); }
  }));
  const madvClient = (id) => ((state.data.mortgageAdvisor || {}).clients || []).find(c => c.id === id);
  document.querySelectorAll('[data-madv-docna]').forEach(btn => btn.addEventListener('click', async (e) => {
    e.preventDefault();
    try { await window.systemAPI.toggleMortgageDoc(btn.dataset.madvDocna, btn.dataset.key, btn.dataset.na ? 'missing' : 'na'); await switchView('mortgage-advisor'); }
    catch (error) { showError('שגיאה בעדכון: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-madv-missing]').forEach(btn => btn.addEventListener('click', async () => {
    try { const r = await window.systemAPI.getMortgageMissingDocs(btn.dataset.madvMissing); if (r && r.text) await madvShowMessage('מסמכים חסרים — נוסח ללקוח', r.text); }
    catch (error) { showError('שגיאה: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-madv-choose]').forEach(btn => btn.addEventListener('click', async () => {
    try { await window.systemAPI.chooseMortgageApproval(btn.dataset.madvChoose, btn.dataset.appr); showToast(btn.dataset.appr ? 'האישור סומן כנבחר' : 'הבחירה בוטלה'); await switchView('mortgage-advisor'); }
    catch (error) { showError('שגיאה בעדכון: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-madv-appr-edit]').forEach(btn => btn.addEventListener('click', async () => {
    const c = madvClient(btn.dataset.madvApprEdit);
    if (c) await madvOpenApprovalsInLab(c);
  }));
  document.querySelectorAll('[data-madv-appr-cmp]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.madvApprCmp;
    try {
      const r = await window.systemAPI.calcMortgageApprovals(id);
      const out = document.getElementById('madvApprOut-' + id);
      if (out) out.innerHTML = madvApprovalsResultHtml(r);
    } catch (error) { showError('שגיאה בהשוואה: ' + errMsg(error)); }
  }));
  const saveSet = document.getElementById('madvSaveSettings');
  if (saveSet) saveSet.addEventListener('click', async () => {
    try {
      await window.systemAPI.saveMortgageOfficeSettings({
        ownOnly: document.getElementById('madvOwnOnly').checked,
        stuckDays: Number(document.getElementById('madvStuckDays').value)
      });
      showToast('ההגדרות נשמרו');
      await switchView('mortgage-advisor');
    } catch (error) { showError('שגיאה בשמירה: ' + errMsg(error)); }
  });
  document.querySelectorAll('[data-madv-doc]').forEach(cb => cb.addEventListener('change', async () => {
    try { await window.systemAPI.toggleMortgageDoc(cb.dataset.madvDoc, cb.dataset.key); await switchView('mortgage-advisor'); }
    catch (error) { showError('שגיאה בעדכון: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-madv-export]').forEach(btn => btn.addEventListener('click', async () => {
    try { const r = await window.systemAPI.exportMortgageSchedule(btn.dataset.madvExport); if (r && r.ok) showToast('לוח הסילוקין נשמר'); }
    catch (error) { showError('שגיאה בייצוא: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-madv-offer-del]').forEach(btn => btn.addEventListener('click', async () => {
    if (!(await askConfirm('למחוק את ההצעה?'))) return;
    try { await window.systemAPI.deleteMortgageOffer(btn.dataset.madvOfferDel); showToast('ההצעה נמחקה'); await switchView('mortgage-advisor'); }
    catch (error) { showError('שגיאה במחיקה: ' + errMsg(error)); }
  }));
  attachMadvFeeHandlers();
}

// חלון תשלום עמלה: תאריך, סכום (ברירת מחדל — היתרה), אמצעי והערה
function madvAskPayment(c) {
  const o = state.data.mortgageAdvisor || {};
  const methods = o.feeMethods || {};
  const balance = c.feeStatus ? c.feeStatus.balance : '';
  return openDialog((card, finish) => {
    const h = document.createElement('h2');
    h.textContent = 'תשלום עמלה שהתקבל — ' + c.name;
    h.id = 'madvPayTitle';
    card.parentNode.setAttribute('aria-labelledby', h.id);
    const form = document.createElement('form');
    form.className = 'modal-form';
    form.noValidate = true;
    const field = (label, el) => { const l = document.createElement('label'); l.textContent = label; l.appendChild(el); form.appendChild(l); return el; };
    const mk = (type, value) => { const i = document.createElement('input'); i.type = type; i.value = value; return i; };
    const date = field('תאריך התשלום', mk("date", madvToday()));
    const amount = field('סכום (₪, כולל מע"מ)', mk('number', balance || ''));
    amount.min = '0'; amount.step = '0.01';
    const method = field('אמצעי תשלום', document.createElement('select'));
    method.innerHTML = Object.entries(methods).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    const note = field('הערה (לא חובה)', mk('text', ''));
    const err = document.createElement('div');
    err.style.color = 'var(--ss-danger)';
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = 'ביטול';
    const ok = document.createElement('button');
    ok.type = 'submit'; ok.className = 'primary'; ok.textContent = 'שמירה';
    actions.append(cancel, ok);
    form.append(err, actions);
    card.append(h, form);
    cancel.addEventListener('click', () => finish(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!date.value) { err.textContent = 'יש לבחור תאריך'; date.focus(); return; }
      if (!(Number(amount.value) > 0)) { err.textContent = 'יש להזין סכום חיובי'; amount.focus(); return; }
      finish({ date: date.value, amount: Number(amount.value), method: method.value, note: note.value.trim() });
    });
    amount.focus();
  });
}

// היום לפי השעון המקומי (לא UTC)
function madvToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function attachMadvFeeHandlers() {
  const madvClient = (id) => ((state.data.mortgageAdvisor || {}).clients || []).find(c => c.id === id);
  document.querySelectorAll('[data-madv-pay]').forEach(btn => btn.addEventListener('click', async () => {
    const c = madvClient(btn.dataset.madvPay);
    if (!c) return;
    const v = await madvAskPayment(c);
    if (!v) return;
    try { await window.systemAPI.addMortgageFeePayment(c.id, v); showToast('התשלום נרשם'); await switchView('mortgage-advisor'); }
    catch (error) { showError('שגיאה ברישום התשלום: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-madv-paydel]').forEach(btn => btn.addEventListener('click', async () => {
    if (!(await askConfirm('למחוק את התשלום?'))) return;
    try { await window.systemAPI.deleteMortgageFeePayment(btn.dataset.madvPaydel, btn.dataset.pay); showToast('התשלום נמחק'); await switchView('mortgage-advisor'); }
    catch (error) { showError('שגיאה במחיקה: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-madv-invoice]').forEach(btn => btn.addEventListener('click', async () => {
    if (!(await askConfirm('להפיק חשבונית מס/קבלה על התשלום הזה? החשבונית תירשם בהנהלת החשבונות ותקבל מספר.'))) return;
    try {
      const r = await window.systemAPI.issueMortgageFeeInvoice(btn.dataset.madvInvoice, btn.dataset.pay, { confirmed: true });
      showToast(`הופקה חשבונית מספר ${r.number}`);
      await switchView('mortgage-advisor');
    } catch (error) { showError('שגיאה בהפקת החשבונית: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-madv-report]').forEach(btn => btn.addEventListener('click', async () => {
    try { const r = await window.systemAPI.exportMortgageClientReport(btn.dataset.madvReport); if (r && r.ok) showToast('הדוח נשמר'); }
    catch (error) { showError('שגיאה בהפקת הדוח: ' + errMsg(error)); }
  }));
  const incBtn = document.getElementById('madvIncomeBtn');
  if (incBtn) incBtn.addEventListener('click', async () => {
    try {
      const inc = await window.systemAPI.getMortgageIncome(Number(document.getElementById('madvIncomeYear').value));
      const out = document.getElementById('madvIncomeOut');
      if (out) out.outerHTML = madvIncomeHtml(inc);
    } catch (error) { showError('שגיאה בדוח ההכנסות: ' + errMsg(error)); }
  });
  const saveBrand = document.getElementById('madvSaveBrand');
  if (saveBrand) saveBrand.addEventListener('click', async () => {
    const val = (k) => (document.getElementById('madvBrand_' + k) || {}).value || '';
    try {
      await window.systemAPI.saveMortgageBrand({
        officeName: val('officeName'), licenseNo: val('licenseNo'), phone: val('phone'), email: val('email'),
        address: val('address'), disclaimer: val('disclaimer'), brandColor: val('brandColor')
      });
      showToast('המיתוג נשמר');
      await switchView('mortgage-advisor');
    } catch (error) { showError('שגיאה בשמירה: ' + errMsg(error)); }
  });
  const logoBtn = document.getElementById('madvLogoBtn');
  if (logoBtn) logoBtn.addEventListener('click', async () => {
    try { const r = await window.systemAPI.setMortgageBrandLogo(false); if (r && !r.canceled) { showToast('הלוגו נשמר'); await switchView('mortgage-advisor'); } }
    catch (error) { showError('שגיאה בלוגו: ' + errMsg(error)); }
  });
  const logoDel = document.getElementById('madvLogoDel');
  if (logoDel) logoDel.addEventListener('click', async () => {
    if (!(await askConfirm('להסיר את הלוגו מהדוח?'))) return;
    try { await window.systemAPI.setMortgageBrandLogo(true); showToast('הלוגו הוסר'); await switchView('mortgage-advisor'); }
    catch (error) { showError('שגיאה בלוגו: ' + errMsg(error)); }
  });
}
