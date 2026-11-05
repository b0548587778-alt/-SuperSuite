// ממשק המודול הכלכלי — עמותה: המחאות דחויות. קבלה נפרדת לכל שנת מס לפי תאריך הפירעון
// ("תרומות ישראל", סעיף 2.3.2). החישובים (חלוקה לשנים, אגורות) רק בשרת — כאן רק טופס ותצוגה מקדימה.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

const NPO_CHEQUE_DONOR_FIELDS = [
  ['donorName', 'שם התורם *', 'text'], ['donorId', 'ת.ז / ח.פ של התורם', 'text'], ['donorPhone', 'טלפון', 'tel'],
  ['donorAddress', 'כתובת', 'text'], ['purpose', 'ייעוד / הערה לקבלה', 'text']
];

// שורת המחאה בטבלת ההזנה הידנית. השמות בטופס: number_<i> וכו' — כל שדה עם aria-label
function npoChequeRow(i, c = {}) {
  const cell = (k, label, type, width) => `<td><input name="${k}_${i}" type="${type}" value="${esc(c[k] ?? '')}" aria-label="${label} — המחאה ${i + 1}" style="width:${width}"${type === 'text' ? ' dir="ltr" inputmode="numeric"' : ''}></td>`;
  return `<tr>${cell('number', 'מספר המחאה', 'text', '7em')}${cell('bank', 'קוד בנק', 'text', '3.5em')}${cell('branch', 'סניף', 'text', '4em')}${cell('dueDate', 'תאריך פירעון', 'date', '10em')}${cell('amount', 'סכום', 'number', '7em')}</tr>`;
}

// תצוגה מקדימה: קבלה לכל שנה, עם האזהרות מהשרת
function npoChequePreviewHtml(pv) {
  const rows = (pv.years || []).map(y => `<tr><td>${esc(y.year)}</td><td>${esc(y.date)}</td><td>${esc(y.cheques.map(c => c.number).join(', '))}</td><td>${money(y.amount)}</td><td>${y.sec46 ? '✓' : '<span class="bad">בלי</span>'}</td></tr>`).join('');
  const warn = (pv.warnings || []).map(w => `<div class="bad">⚠ ${esc(w.text)}</div>`).join('');
  return `<h4>יופקו ${(pv.years || []).length} קבלות — אחת לכל שנת מס</h4>
    <table class="acct-table"><thead><tr><th>שנת מס</th><th>תאריך הקבלה</th><th>המחאות</th><th>סכום</th><th>סעיף 46</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="muted">סה"כ ${money((pv.totalAg || 0) / 100)} · ההמחאות התקבלו ב-${esc(pv.receivedDate)}</div>${warn}`;
}

// איסוף הטופס לקלט לשרת: חלוקה שווה (generate) או טבלה ידנית (cheques). השרת מאמת הכול
function npoChequeInput(form, mode, rowCount) {
  const v = Object.fromEntries(new FormData(form).entries());
  const input = { receivedDate: v.receivedDate, donorType: v.donorType, fundId: v.fundId, campaignId: v.campaignId };
  for (const [k] of NPO_CHEQUE_DONOR_FIELDS) input[k] = String(v[k] || '').trim();
  if (mode === 'equal') {
    input.generate = { total: v.genTotal, count: v.genCount, firstDueDate: v.genFirstDue, firstNumber: String(v.genFirstNumber || '').trim(), bank: String(v.genBank || '').trim(), branch: String(v.genBranch || '').trim() };
  } else {
    input.cheques = [];
    for (let i = 0; i < rowCount; i++) {
      const c = { number: String(v['number_' + i] || '').trim(), bank: String(v['bank_' + i] || '').trim(), branch: String(v['branch_' + i] || '').trim(), dueDate: v['dueDate_' + i], amount: v['amount_' + i] };
      if (c.number || c.dueDate || c.amount) input.cheques.push(c);
    }
  }
  return input;
}

// חלון ההזנה: פרטי התורם, המחאות (חלוקה שווה או ידנית), תצוגה מקדימה ← הפקה.
// אזהרה (אישור סעיף 46 שפג) — ההפקה רק אחרי סימון האישור (confirmWarnings: true)
async function openNpoChequesDialog() {
  const o = (state.data && state.data.npo) || {};
  // בזמן ההפקה Escape לא סוגר את החלון: הקבלות כבר מופקות בשרת, ושליחה חוזרת הפיקה סט נוסף (סקירת קוד 2.11.2026).
  // המאזין על window (שלב הלכידה) רץ לפני המאזין של openDialog על document
  let sending = false;
  const blockEscape = (e) => { if (sending && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); } };
  window.addEventListener('keydown', blockEscape, true);
  const done = await openDialog((card, finish) => {
    card.style.maxWidth = '720px';
    const titleId = 'dlgTitle' + (++dialogSeq);
    card.parentNode.setAttribute('aria-labelledby', titleId);
    const sel = (name, label, options) => `<label>${label}<select name="${name}">${options.map(x => `<option value="${esc(x.value)}">${esc(x.label)}</option>`).join('')}</select></label>`;
    card.innerHTML = `<h2 id="${titleId}">המחאות דחויות — קבלה לכל שנת מס</h2>
      <form class="modal-form" novalidate>
        <p class="muted">לכל שנת מס מופקת קבלה נפרדת לפי תאריך הפירעון, כנדרש בדיווח ל"תרומות ישראל". כל הקבלות מופקות עכשיו.</p>
        <label>תאריך קבלת ההמחאות<input name="receivedDate" type="date" value="${esc(today())}"></label>
        ${NPO_CHEQUE_DONOR_FIELDS.map(([k, label, type]) => `<label>${label}<input name="${k}" type="${type}"></label>`).join('')}
        ${sel('donorType', 'סוג התורם (לדיווח)', opts(NPO_DONOR_TYPES))}
        ${sel('fundId', 'קרן', npoFundOptions(o))}
        ${sel('campaignId', 'קמפיין', openCampaignOptions(o))}
        <fieldset><legend>ההמחאות</legend>
          <label><input type="radio" name="mode" value="equal" checked> חלוקה שווה לחודשים</label>
          <label><input type="radio" name="mode" value="manual"> הזנה ידנית של כל המחאה</label>
          <div data-chq="equal">
            <label>סכום כולל (₪)<input name="genTotal" type="number" min="0" step="0.01"></label>
            <label>מספר המחאות<input name="genCount" type="number" min="1" max="60" value="12"></label>
            <label>פירעון ראשון<input name="genFirstDue" type="date"></label>
            <label>מספר ההמחאה הראשונה<input name="genFirstNumber" dir="ltr" inputmode="numeric"></label>
            <label>קוד בנק<input name="genBank" dir="ltr" inputmode="numeric"></label>
            <label>סניף<input name="genBranch" dir="ltr" inputmode="numeric"></label>
          </div>
          <div data-chq="manual" hidden>
            <table class="acct-table"><thead><tr><th>מס' המחאה</th><th>בנק</th><th>סניף</th><th>פירעון</th><th>סכום (₪)</th></tr></thead><tbody></tbody></table>
            <button type="button" class="secondary" data-act="add-row">＋ המחאה</button>
          </div>
        </fieldset>
        <div data-chq="preview" aria-live="polite"></div>
        <label data-chq="confirm" hidden><input type="checkbox" name="confirmWarnings"> קראתי את האזהרה — להפיק בכל זאת</label>
        <div class="chq-err" role="alert" style="color:var(--ss-danger);font-size:.9rem"></div>
        <div class="modal-actions">
          <button type="button" class="secondary" data-act="cancel">ביטול</button>
          <button type="button" class="secondary" data-act="preview">תצוגה מקדימה</button>
          <button type="submit" class="primary" disabled>הפקת הקבלות</button>
        </div>
      </form>`;
    const form = card.querySelector('form');
    const part = (k) => form.querySelector(`[data-chq="${k}"]`);
    const err = form.querySelector('.chq-err');
    const submit = form.querySelector('[type="submit"]');
    const body = part('manual').querySelector('tbody');
    let rows = 0;
    const addRow = () => { body.insertAdjacentHTML('beforeend', npoChequeRow(rows)); rows += 1; };
    for (let i = 0; i < 3; i++) addRow();
    const mode = () => (form.querySelector('[name="mode"]:checked') || {}).value || 'equal';
    let preview = null;
    // כל שינוי בטופס מבטל את התצוגה המקדימה — ההפקה תמיד לפי מה שהוצג
    const reset = () => { preview = null; submit.disabled = true; part('preview').innerHTML = ''; part('confirm').hidden = true; };
    form.addEventListener('input', (e) => { if (e.target.name !== 'confirmWarnings') reset(); });
    form.querySelectorAll('[name="mode"]').forEach(r => r.addEventListener('change', () => {
      part('equal').hidden = mode() !== 'equal';
      part('manual').hidden = mode() !== 'manual';
      reset();
    }));
    form.querySelector('[data-act="add-row"]').addEventListener('click', () => { addRow(); reset(); });
    form.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(null));
    form.querySelector('[data-act="preview"]').addEventListener('click', async () => {
      err.textContent = '';
      try {
        const input = npoChequeInput(form, mode(), rows);
        const pv = await window.systemAPI.addNpoChequeDonation(input, { preview: true });
        preview = { input, warnings: (pv.warnings || []).length };
        part('preview').innerHTML = npoChequePreviewHtml(pv);
        part('confirm').hidden = !preview.warnings;
        form.elements.confirmWarnings.checked = false;
        submit.disabled = false;
      } catch (error) { reset(); err.textContent = errMsg(error); }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!preview) return;
      if (preview.warnings && !form.elements.confirmWarnings.checked) { err.textContent = 'יש לסמן שקראת את האזהרה'; return; }
      if (sending) return;
      submit.disabled = true;
      sending = true;
      try {
        const r = await window.systemAPI.addNpoChequeDonation({ ...preview.input, confirmWarnings: preview.warnings ? true : undefined });
        finish(r);
      } catch (error) { submit.disabled = false; err.textContent = errMsg(error); } finally { sending = false; }
    });
    form.elements.donorName.focus();
  });
  window.removeEventListener('keydown', blockEscape, true);
  if (!done) return;
  showToast(`הופקו ${done.donations.length} קבלות: ${done.donations.map(d => d.receipt.number).join(', ')}`);
  await switchView('npo');
}

// המחאה שחזרה: בחירת ההמחאה מתוך הקבלה, אישור, וביטול + קבלה חדשה ליתרה (בשרת, בשמירה אחת)
async function bounceNpoCheque(d) {
  const cheques = Array.isArray(d.cheques) ? d.cheques : [];
  if (!cheques.length) return;
  const pick = await openDialog((card, finish) => {
    const titleId = 'dlgTitle' + (++dialogSeq);
    card.parentNode.setAttribute('aria-labelledby', titleId);
    card.innerHTML = `<h2 id="${titleId}">המחאה שחזרה — קבלה ${esc(d.receipt && d.receipt.number)}</h2>
      <form class="modal-form" novalidate>
        <p class="muted">הקבלה תבוטל (המספר לא ישומש שוב). אם נשארו בה המחאות נוספות — תופק להן קבלה חדשה.</p>
        <label>איזו המחאה חזרה?<select name="pick">${cheques.map((c, i) => `<option value="${i}">${esc(c.number)}${c.bank ? ' · בנק ' + esc(c.bank) : ''} · פירעון ${esc(c.dueDate)} · ${money(c.amountAg / 100)}</option>`).join('')}</select></label>
        <div class="modal-actions"><button type="button" class="secondary" data-act="cancel">ביטול</button><button type="submit" class="primary">ביטול הקבלה</button></div>
      </form>`;
    const form = card.querySelector('form');
    form.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(null));
    form.addEventListener('submit', (e) => { e.preventDefault(); finish(cheques[Number(form.elements.pick.value)] || null); });
  });
  if (!pick) return;
  try {
    const r = await window.systemAPI.cancelNpoCheque(d.id, pick.number, pick.bank);
    showToast(r.replacement ? `הקבלה בוטלה. הופקה קבלה ${r.replacement.receipt.number} ליתרה` : 'הקבלה בוטלה');
    await switchView('npo');
  } catch (error) { showError('שגיאה בביטול ההמחאה: ' + errMsg(error)); }
}

function attachNpoChequeHandlers() {
  const btn = document.getElementById('npoChequesBtn');
  if (btn) btn.addEventListener('click', () => openNpoChequesDialog());
  document.querySelectorAll('[data-npo-bounce]').forEach(b => b.addEventListener('click', () => {
    const d = ((state.data.npo && state.data.npo.donations) || []).find(x => x.id === b.dataset.npoBounce);
    if (d) bounceNpoCheque(d);
  }));
}
