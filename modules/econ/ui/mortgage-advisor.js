// ממשק המודול הכלכלי — ייעוץ משכנתאות.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

// ============================================================
// ייעוץ משכנתאות — תיקי לקוחות, מחשבון מסלולים, השוואת הצעות בנקים, עמלה ומסמכים
// ============================================================
const MADV_STATUS = { preparing: 'בהכנה', submitted: 'הוגש', 'approved-principle': 'אושר עקרונית', 'approved-final': 'אושר סופי' };
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
    { name: 'status', label: 'סטטוס', type: 'select', options: opts(MADV_STATUS) },
    { name: 'feeType', label: 'סוג עמלת ייעוץ', type: 'select', options: [
      { value: 'percent', label: 'אחוז מהסכום המבוקש' },
      { value: 'fixed', label: 'סכום קבוע' }
    ]},
    { name: 'feeValue', label: 'עמלה (% או ₪, לפני מע"מ)', type: 'number' },
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

function renderMortgageAdvisor(o) {
  const clients = Array.isArray(o && o.clients) ? o.clients : [];
  return `
    <div class="mortgage-advisor">
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
              <small>${c.bank ? esc(c.bank) + ' · ' : ''}מבוקש ${money(c.requestedAmount)}${c.ltv != null ? ` · מימון ${c.ltv}%` : ''}</small>
            </div>
            <div class="acct-actions">
              <select data-madv-status="${esc(c.id)}">${Object.entries(MADV_STATUS).map(([v, l]) => `<option value="${v}"${c.status === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
              ${renderCardActions(c.id)}
            </div>
          </div>
          <div class="acct-grid">
            <div>
              <h4>עמלת ייעוץ</h4>
              <div class="acct-row"><span>לפני מע"מ ${c.feeType === 'percent' ? `(${Number(c.feeValue) || 0}%)` : ''}</span><span>${money(fee.net)}</span></div>
              <div class="acct-row"><span>מע"מ</span><span>${money(fee.vat)}</span></div>
              <div class="acct-row acct-total"><span>סה"כ</span><span>${money(fee.total)}</span></div>
            </div>
            <div>
              <h4>מסמכים (${docs.done}/${docs.total})</h4>
              ${docs.items.map(d => `<label class="doc-check"><input type="checkbox" data-madv-doc="${esc(c.id)}" data-key="${esc(d.key)}"${d.done ? ' checked' : ''}> ${esc(d.label)}</label>`).join('')}
            </div>
          </div>
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
    try { await window.systemAPI.updateMortgageClient(sel.dataset.madvStatus, { status: sel.value }); showToast('הסטטוס עודכן'); await switchView('mortgage-advisor'); }
    catch (error) { showError('שגיאה בעדכון: ' + errMsg(error)); }
  }));
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
}
