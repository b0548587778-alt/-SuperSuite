// ממשק המודול הכלכלי — גמ"ח: הלוואות, ערבים, הפקדות, בקשות וחפצים.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

// ============================================================
// גמ"ח — קופת גמילות חסדים: הלוואות ללא ריבית, ערבים, לוח סילוקין, הפקדות ופיגורים.
// נפרד לחלוטין מהעמותה (npo) ומהיומן העסקי: הלוואת גמ"ח אינה תרומה ואינה עסקה.
// ============================================================
const GEMACH_LOAN_STATUS = { active: 'פעילה', closed: 'נפרעה', cancelled: 'בוטלה' };
const GEMACH_TIER_LABEL = {
  exempt: 'מתחת לסף הרישוי — ללא חובת רישוי',
  basic: 'מעל סף הרישוי הבסיסי — נדרש רישוי בסיסי (יש לאמת מול הרשות לשוק ההון)',
  extended: 'מעל סף הרישוי המורחב — נדרש רישוי מורחב (יש לאמת מול הרשות לשוק ההון)'
};

formSchemas['gemach'] = {
  title: 'בקשת הלוואה חדשה',
  prepare: (schema) => {
    schema.fields.find(f => f.name === 'issueDate').value = today();
  },
  fields: [
    { name: 'borrowerName', label: 'שם הלווה', type: 'text', required: true },
    { name: 'borrowerId', label: 'ת.ז של הלווה', type: 'text' },
    { name: 'borrowerPhone', label: 'טלפון הלווה', type: 'tel' },
    { name: 'borrowerAddress', label: 'כתובת הלווה', type: 'text' },
    { name: 'amount', label: 'סכום ההלוואה (₪)', type: 'number', required: true },
    { name: 'installments', label: 'מספר תשלומים חודשיים', type: 'number', required: true },
    { name: 'issueDate', label: 'תאריך מתן ההלוואה', type: 'date', required: true },
    { name: 'guarantorsText', label: 'ערבים — שורה לכל ערב: שם, ת.ז, טלפון', type: 'textarea' },
    { name: 'purpose', label: 'מטרת ההלוואה', type: 'text' },
    { name: 'notes', label: 'הערות', type: 'textarea' }
  ],
  create: (d) => window.systemAPI.addGemachLoan(d)
};

const gemachSettingsSchema = {
  title: 'הגדרות קופת הגמ"ח',
  fields: [
    { name: 'fundName', label: 'שם הקופה', type: 'text' },
    { name: 'notes', label: 'הערות כלליות', type: 'textarea' }
  ],
  create: (d) => window.systemAPI.saveGemachSettings(d)
};

const gemachDepositSchema = {
  title: 'הפקדה חדשה לקופה',
  prepare: (schema) => { schema.fields.find(f => f.name === 'date').value = today(); },
  fields: [
    { name: 'date', label: 'תאריך', type: 'date', required: true },
    { name: 'depositorName', label: 'שם המפקיד', type: 'text', required: true },
    { name: 'amount', label: 'סכום (₪)', type: 'number', required: true },
    { name: 'notes', label: 'הערות', type: 'text' }
  ],
  create: (d) => window.systemAPI.addGemachDeposit(d)
};

// טופס תשלום: נבנה בכל פתיחה עם loanId/seq/יתרה סגורים בלולאה, כדי שהשמירה תדע על איזה תשלום מדובר
function gemachPaymentSchema(loanId, seq, remaining) {
  return {
    title: `רישום תשלום — תשלום מס' ${seq}`,
    prepare: (schema) => {
      schema.fields.find(f => f.name === 'amount').value = remaining;
      schema.fields.find(f => f.name === 'date').value = today();
    },
    fields: [
      { name: 'date', label: 'תאריך התשלום', type: 'date', required: true },
      { name: 'amount', label: `סכום (עד ${money(remaining)})`, type: 'number', required: true }
    ],
    create: (d) => window.systemAPI.recordGemachPayment(loanId, seq, d)
  };
}

// הרחבות גמ"ח: בקשות הלוואה (טיוטה → ראיון → אימות ערבים → אישור/דחייה), גמ"ח חפצים, ופיגורים לפי ערב
const GX_NEXT = { draft: [['interview', 'לראיון']], interview: [['verified', 'ערבים אומתו'], ['draft', 'חזרה לטיוטה']], verified: [['approved', 'אישור ויצירת הלוואה'], ['interview', 'חזרה לראיון']] };
const GX_CONDITIONS = { new: 'חדש', good: 'תקין', worn: 'משומש', repair: 'בתיקון', retired: 'יצא משימוש' };
const gemachAppSchema = {
  title: 'בקשת הלוואה — טיוטה',
  editTitle: 'עריכת בקשת הלוואה',
  prepare: (schema) => { schema.fields.find(f => f.name === 'requestDate').value = today(); },
  fields: [
    { name: 'borrowerName', label: 'שם המבקש', type: 'text', required: true },
    { name: 'borrowerId', label: 'ת.ז', type: 'text' },
    { name: 'borrowerPhone', label: 'טלפון', type: 'tel' },
    { name: 'borrowerAddress', label: 'כתובת', type: 'text' },
    { name: 'amount', label: 'סכום מבוקש (₪)', type: 'number', required: true },
    { name: 'installments', label: 'מספר תשלומים חודשיים', type: 'number', required: true },
    { name: 'requestDate', label: 'תאריך הבקשה', type: 'date' },
    { name: 'guarantorsText', label: 'ערבים — שורה לכל ערב: שם, ת.ז, טלפון', type: 'textarea' },
    { name: 'purpose', label: 'מטרת ההלוואה', type: 'text' },
    { name: 'interviewNotes', label: 'סיכום הראיון', type: 'textarea' },
    { name: 'notes', label: 'הערות', type: 'textarea' }
  ],
  create: (d) => window.systemAPI.saveGemachApplication(null, d),
  update: (id, d) => window.systemAPI.saveGemachApplication(id, { interviewNotes: '', notes: '', purpose: '', guarantorsText: '', ...d })
};
const gemachItemSchema = {
  title: 'פריט חדש לגמ"ח חפצים',
  editTitle: 'עריכת פריט',
  fields: [
    { name: 'name', label: 'שם הפריט', type: 'text', required: true },
    { name: 'category', label: 'קטגוריה (מיטות, עגלות, ציוד רפואי…)', type: 'text' },
    { name: 'code', label: 'מק"ט / מספר פנימי', type: 'text' },
    { name: 'condition', label: 'מצב', type: 'select', options: Object.entries(GX_CONDITIONS).map(([value, label]) => ({ value, label })) },
    { name: 'deposit', label: 'פיקדון בהשאלה (₪)', type: 'number' },
    { name: 'location', label: 'מיקום במחסן', type: 'text' },
    { name: 'notes', label: 'הערות', type: 'textarea' }
  ],
  create: (d) => window.systemAPI.saveGemachItem(null, d),
  update: (id, d) => window.systemAPI.saveGemachItem(id, { category: '', code: '', location: '', notes: '', ...d })
};

function renderGemachApplications(apps) {
  if (!Array.isArray(apps)) return '';
  const open = apps.filter(a => !['approved', 'rejected'].includes(a.status));
  const done = apps.filter(a => ['approved', 'rejected'].includes(a.status));
  const row = (a) => `<div class="acct-row">
    <span>${esc(a.borrowerName)} <small class="muted">${esc(a.requestDate)} · ${money(a.amount)} ב-${Number(a.installments)} תשלומים · ${(a.guarantors || []).length} ערבים</small>
      <small class="${a.status === 'rejected' ? 'bad' : a.status === 'approved' ? 'ok' : 'muted'}">· ${esc(a.statusLabel)}${a.rejectReason ? ': ' + esc(a.rejectReason) : ''}</small></span>
    <span>${(GX_NEXT[a.status] || []).map(([to, l]) => `<button class="secondary small" data-gx-move="${esc(a.id)}" data-to="${to}">${esc(l)}</button>`).join(' ')}
      ${['approved', 'rejected'].includes(a.status) ? '' : `<button class="secondary small" data-gx-move="${esc(a.id)}" data-to="rejected">דחייה</button>
        <button class="icon-btn" data-gx-app-edit="${esc(a.id)}" title="עריכה">✎</button>`}
      ${a.status === 'approved' ? '' : `<button class="icon-btn danger" data-gx-app-del="${esc(a.id)}" title="מחיקה">🗑</button>`}</span>
  </div>`;
  return `<div class="card acct-wide">
    <div class="acct-header"><h3>בקשות הלוואה (${open.length} פתוחות)</h3><button class="secondary" id="gxAppAdd">＋ בקשה</button></div>
    <p class="muted">טיוטה ← ראיון ← אימות ערבים ← אישור. באישור נוצרת ההלוואה עם לוח הסילוקין. שינוי ערבים אחרי האימות מחזיר את הבקשה לשלב הראיון.</p>
    ${open.map(row).join('') || '<div class="acct-row muted">אין בקשות פתוחות</div>'}
    ${done.length ? `<details><summary><small>בקשות שהוכרעו (${done.length})</small></summary>${done.map(row).join('')}</details>` : ''}
  </div>`;
}

function renderGemachGuarantorArrears(list) {
  if (!Array.isArray(list) || !list.length) return '';
  return `<div class="card">
    <div class="acct-header"><h3>פיגורים לפי ערב (${list.length})</h3><button class="secondary" data-gemach-export="guarantor-arrears">ייצוא</button></div>
    <p class="muted">למי לפנות כשלווה בפיגור. אין כאן שליחת תזכורות — הפנייה נעשית ידנית.</p>
    ${list.map(g => `<div class="acct-row"><span>${esc(g.name)} <small class="muted">${esc(g.phone)}${g.id ? ' · ת.ז ' + esc(g.id) : ''}</small>
      <div><small class="muted">${g.loans.map(l => `${esc(l.borrowerName)} — ${Number(l.lateCount)} תשלומים מאז ${esc(l.oldestDue)}`).join(' · ')}</small></div></span>
      <span class="bad">${money(g.lateAmount)}</span></div>`).join('')}
  </div>`;
}

function renderGemachItems(ov) {
  if (!ov || !Array.isArray(ov.rows)) return '';
  return `<div class="card acct-wide">
    <div class="acct-header"><h3>גמ"ח חפצים (${ov.rows.length})</h3>
      <div class="acct-actions"><button class="secondary" id="gxItemAdd">＋ פריט</button>${ov.rows.length ? '<button class="secondary" data-gemach-export="items">ייצוא</button>' : ''}</div></div>
    <div class="kpis">
      <div class="kpi"><small>מושאלים</small><strong>${Number(ov.lentCount) || 0}</strong></div>
      <div class="kpi${ov.overdueCount ? ' neg' : ''}"><small>באיחור</small><strong>${Number(ov.overdueCount) || 0}</strong></div>
      <div class="kpi"><small>פיקדונות מוחזקים</small><strong>${money(ov.depositsHeld)}</strong></div>
    </div>
    ${ov.rows.length === 0 ? renderEmpty('אין פריטים. מיטות, עגלות, ציוד רפואי — כל פריט עם מצב ופיקדון.') : `<div class="acct-scroll"><table class="acct-table">
      <thead><tr><th>פריט</th><th>מצב</th><th>פיקדון</th><th>מושאל ל</th><th>להחזרה עד</th><th></th></tr></thead>
      <tbody>${ov.rows.map(r => `<tr class="${r.condition === 'retired' ? 'muted' : ''}">
        <td>${esc(r.name)} <small class="muted">${esc([r.category, r.code, r.location].filter(Boolean).join(' · '))}</small></td>
        <td><small>${esc(r.conditionLabel)}</small></td><td>${r.deposit ? money(r.deposit) : '—'}</td>
        <td>${r.lending ? `${esc(r.lending.borrowerName)} <small class="muted">${esc(r.lending.borrowerPhone)} · מ-${esc(r.lending.date)}</small>` : '<small class="muted">זמין</small>'}</td>
        <td>${r.lending && r.lending.dueDate ? `<small class="${r.overdue ? 'bad' : ''}">${esc(r.lending.dueDate)}${r.overdue ? ' · באיחור' : ''}</small>` : ''}</td>
        <td>${r.lending ? `<button class="secondary small" data-gx-return="${esc(r.id)}">החזרה</button>`
          : r.condition === 'retired' || r.condition === 'repair' ? '' : `<button class="secondary small" data-gx-lend="${esc(r.id)}">השאלה</button>`}
          <button class="icon-btn" data-gx-item-edit="${esc(r.id)}" title="עריכה">✎</button>
          ${r.timesLent ? '' : `<button class="icon-btn danger" data-gx-item-del="${esc(r.id)}" title="מחיקה">🗑</button>`}</td>
      </tr>`).join('')}</tbody></table></div>`}
  </div>`;
}

function attachGemachExtraHandlers() {
  const o = state.data.gemach || {};
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  const run = async (fn, okMsg, prefix) => {
    try { await fn(); if (okMsg) showToast(okMsg); await switchView('gemach'); }
    catch (error) { showError(prefix + errMsg(error)); }
  };
  on('gxAppAdd', () => openSubForm(gemachAppSchema));
  on('gxItemAdd', () => openSubForm(gemachItemSchema, { condition: 'good' }));
  document.querySelectorAll('[data-gx-app-edit]').forEach(b => b.addEventListener('click', () => {
    const a = (o.applications || []).find(x => x.id === b.dataset.gxAppEdit);
    if (a) openSubForm(gemachAppSchema, { ...a, guarantorsText: (a.guarantors || []).map(g => [g.name, g.id, g.phone].join(', ').replace(/(, )+$/, '')).join('\n') }, a.id);
  }));
  document.querySelectorAll('[data-gx-app-del]').forEach(b => b.addEventListener('click', async () => {
    if (!(await askConfirm('למחוק את הבקשה?'))) return;
    run(() => window.systemAPI.deleteGemachApplication(b.dataset.gxAppDel), 'הבקשה נמחקה', 'שגיאה במחיקה: ');
  }));
  document.querySelectorAll('[data-gx-move]').forEach(b => b.addEventListener('click', async () => {
    const to = b.dataset.to;
    let input = {};
    if (to === 'approved') {
      const f = await askFields('אישור בקשה ויצירת הלוואה', [{ name: 'issueDate', label: 'תאריך מתן ההלוואה (YYYY-MM-DD)' }], 'אישור', { issueDate: today() });
      if (!f) return;
      input = f;
    } else if (to === 'rejected') {
      const f = await askFields('דחיית בקשה', [{ name: 'reason', label: 'סיבה (נשמרת בבקשה)' }], 'דחייה');
      if (!f) return;
      input = f;
    }
    run(async () => {
      const r = await window.systemAPI.moveGemachApplication(b.dataset.gxMove, to, input);
      if (r.loan) showToast('ההלוואה נוצרה');
    }, to === 'approved' ? '' : 'הבקשה עודכנה', 'שגיאה: ');
  }));
  document.querySelectorAll('[data-gx-item-edit]').forEach(b => b.addEventListener('click', () => {
    const it = ((o.items && o.items.rows) || []).find(x => x.id === b.dataset.gxItemEdit);
    if (it) openSubForm(gemachItemSchema, it, it.id);
  }));
  document.querySelectorAll('[data-gx-item-del]').forEach(b => b.addEventListener('click', async () => {
    if (!(await askConfirm('למחוק את הפריט?'))) return;
    run(() => window.systemAPI.deleteGemachItem(b.dataset.gxItemDel), 'הפריט נמחק', 'שגיאה במחיקה: ');
  }));
  document.querySelectorAll('[data-gx-lend]').forEach(b => b.addEventListener('click', async () => {
    const it = ((o.items && o.items.rows) || []).find(x => x.id === b.dataset.gxLend);
    if (!it) return;
    const values = await openDialog((card, finish) => {
      card.innerHTML = `<h2>השאלת ${esc(it.name)}</h2>
        <form class="modal-form" novalidate>
          <label>שם השואל *<input name="borrowerName"></label>
          <label>טלפון<input name="borrowerPhone" type="tel"></label>
          <label>ת.ז<input name="borrowerId"></label>
          <label>תאריך השאלה<input name="date" type="date" value="${esc(today())}"></label>
          <label>להחזרה עד<input name="dueDate" type="date"></label>
          <label>פיקדון שהתקבל (₪)<input name="depositHeld" type="number" value="${esc(it.deposit || 0)}"></label>
          <label>הערות<input name="notes"></label>
          <div class="gx-err" style="color:var(--ss-danger);font-size:.9rem"></div>
          <div class="modal-actions"><button type="button" class="secondary" data-act="cancel">ביטול</button><button type="submit" class="primary">השאלה</button></div>
        </form>`;
      const form = card.querySelector('form');
      form.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(null));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(form).entries());
        if (!String(v.borrowerName).trim()) { card.querySelector('.gx-err').textContent = 'יש למלא את שם השואל'; return; }
        finish(v);
      });
      form.elements.borrowerName.focus();
    });
    if (values) run(() => window.systemAPI.lendGemachItem(it.id, values), 'הפריט הושאל', 'שגיאה בהשאלה: ');
  }));
  document.querySelectorAll('[data-gx-return]').forEach(b => b.addEventListener('click', async () => {
    const it = ((o.items && o.items.rows) || []).find(x => x.id === b.dataset.gxReturn);
    if (!it || !it.lending) return;
    const values = await openDialog((card, finish) => {
      card.innerHTML = `<h2>החזרת ${esc(it.name)}</h2>
        <form class="modal-form" novalidate>
          <p class="muted">הושאל ל${esc(it.lending.borrowerName)} · פיקדון ${money(it.lending.depositHeld)}</p>
          <label>תאריך החזרה<input name="date" type="date" value="${esc(today())}"></label>
          <label>מצב הפריט בהחזרה<select name="condition">${Object.entries(GX_CONDITIONS).map(([v, l]) => `<option value="${v}"${v === it.condition ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          <label>פיקדון שהוחזר לשואל (₪)<input name="depositReturned" type="number" value="${esc(it.lending.depositHeld)}"></label>
          <label>הערות (למשל ניכוי על נזק)<input name="notes"></label>
          <div class="modal-actions"><button type="button" class="secondary" data-act="cancel">ביטול</button><button type="submit" class="primary">אישור החזרה</button></div>
        </form>`;
      const form = card.querySelector('form');
      form.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(null));
      form.addEventListener('submit', (e) => { e.preventDefault(); finish(Object.fromEntries(new FormData(form).entries())); });
    });
    if (values) run(() => window.systemAPI.returnGemachItem(it.id, values), 'ההחזרה נרשמה', 'שגיאה בהחזרה: ');
  }));
}

function renderGemach(o) {
  if (!o || typeof o !== 'object') return renderEmpty('אין נתונים להצגה');
  const s = o.settings || {};
  const ov = o.overview || {};
  const loans = Array.isArray(o.loans) ? o.loans : [];
  const deposits = Array.isArray(o.deposits) ? o.deposits : [];
  const fullLoans = Object.fromEntries((state.data.gemachFull || []).map(l => [l.id, l]));
  return `
    <div class="gemach">
      <div class="acct-header">
        <div>
          <h3>${esc(s.fundName || 'קופת הגמ"ח')}</h3>
          <small class="muted">${esc(GEMACH_TIER_LABEL[ov.licenseTier] || GEMACH_TIER_LABEL.exempt)} · הסכומים להערכה בלבד — יש לאמת מול הרשות לשוק ההון</small>
        </div>
        <div class="acct-actions">
          <button class="secondary" id="gemachSettingsBtn">הגדרות קופה</button>
          <button class="secondary" id="gemachDepositBtn">＋ הפקדה</button>
        </div>
      </div>
      <div class="kpis">
        <div class="kpi"><small>יתרת קופה</small><strong>${money(ov.balance)}</strong></div>
        <div class="kpi"><small>הפקדות (סה"כ)</small><strong>${money(ov.depositsTotal)}</strong></div>
        <div class="kpi"><small>יתרת חוב פתוחה</small><strong>${money(ov.outstandingTotal)}</strong></div>
        <div class="kpi"><small>הלוואות פעילות</small><strong>${Number(ov.activeLoansCount) || 0}</strong></div>
        <div class="kpi${ov.lateLoansCount ? ' neg' : ''}"><small>הלוואות בפיגור</small><strong>${Number(ov.lateLoansCount) || 0}</strong></div>
        <div class="kpi${ov.lateTotal ? ' neg' : ''}"><small>סכום בפיגור</small><strong>${money(ov.lateTotal)}</strong></div>
      </div>
      <div class="acct-grid">
        ${renderGemachApplications(o.applications)}
        <div class="card acct-wide">
          <div class="acct-header">
            <h3>הלוואות (${loans.length})</h3>
            <div class="acct-actions">
              <button class="secondary" data-gemach-export="loans">ייצוא הלוואות</button>
              <button class="secondary" data-gemach-export="arrears">ייצוא פיגורים</button>
            </div>
          </div>
          ${loans.length === 0 ? renderEmpty('אין הלוואות עדיין — לחץ "＋ הוספת רשומה" לבקשת הלוואה חדשה') : loans.map(l => `
            <details class="gemach-loan">
              <summary>
                <span>${esc(l.borrowerName)} ${l.borrowerId ? `<small class="muted">ת.ז ${esc(l.borrowerId)}</small>` : ''}
                  <small class="muted">${esc(GEMACH_LOAN_STATUS[l.status] || l.status)}${l.lateCount ? ` · ${l.lateCount} תשלומים בפיגור` : ''}</small>
                </span>
                <span>${money(l.outstanding)} / ${money(l.amount)}
                  ${l.bankMasked ? `<small class="muted">🏦 <bdi dir="ltr">${esc(l.bankMasked)}</bdi></small>` : ''}${l.masavStopped ? ` <small class="bad">מס"ב נעצר: ${esc(l.masavStopped)}</small>` : ''}
                  ${l.status === 'active' ? `<button class="icon-btn" data-gemach-bank="${esc(l.id)}" title="חשבון לחיוב במס&quot;ב">🏦</button>` : ''}
                  <button class="icon-btn" data-gemach-statement="${esc(l.id)}" title="דף חשבון ללווה (PDF)" aria-label="דף חשבון ללווה">📄</button>
                  ${l.status === 'active' && !l.totalPaid ? `<button class="icon-btn danger" data-gemach-cancel="${esc(l.id)}" title="ביטול הלוואה">✖</button>` : ''}
                </span>
              </summary>
              ${renderGemachSchedule(fullLoans[l.id], l.id)}
            </details>`).join('')}
        </div>
        <div class="card">
          <div class="acct-header"><h3>הפקדות (${deposits.length})</h3><button class="secondary small" data-gemach-export="deposits">ייצוא</button></div>
          ${deposits.map(d => `
            <div class="acct-row">
              <span>${esc(d.depositorName)} <small class="muted">${esc(d.date)}${d.notes ? ' · ' + esc(d.notes) : ''}</small></span>
              <span>${money(d.amount)}
                <button class="icon-btn danger" data-gemach-deposit-del="${esc(d.id)}" title="מחיקה">🗑</button>
              </span>
            </div>`).join('') || '<div class="acct-row muted">אין הפקדות עדיין</div>'}
        </div>
        ${renderGemachGuarantorArrears(o.guarantorArrears)}
        ${renderGemachItems(o.items)}
        ${renderMasavPanel('gemach', o.masav)}
      </div>
    </div>`;
}

// לוח סילוקין מלא לא מגיע בסקירה הראשית (כדי לא לטעון את כולה בכל הלוואה) — נטען לפי בקשה כש-<details> נפתח לראשונה
function renderGemachSchedule(full, loanId) {
  if (!full) return `<div class="acct-scroll" data-gemach-schedule-for="${esc(loanId)}"><button class="secondary" data-gemach-load-schedule="${esc(loanId)}">טעינת לוח סילוקין</button></div>`;
  const rows = (full.schedule || []).map(row => `
    <tr class="${row.status === 'paid' ? 'muted' : ''}">
      <td>${row.seq}</td><td>${esc(row.dueDate)}</td><td>${money(row.amountAg / 100)}</td>
      <td>${money(row.paidAg / 100)}</td>
      <td>${row.status === 'paid' ? '✓ נפרע' : row.status === 'partial' ? 'חלקי' : 'ממתין'}</td>
      <td>${row.status !== 'paid' ? `<button class="icon-btn" data-gemach-pay="${esc(loanId)}" data-gemach-pay-seq="${row.seq}" data-gemach-pay-remaining="${(row.amountAg - row.paidAg) / 100}" title="רישום תשלום">💵</button>` : ''}</td>
    </tr>`).join('');
  const guarantors = (full.guarantors || []).map(g => esc(g.name)).join(', ');
  return `
    ${guarantors ? `<p class="muted">ערבים: ${guarantors}</p>` : ''}
    ${full.purpose ? `<p class="muted">מטרה: ${esc(full.purpose)}</p>` : ''}
    <div class="acct-scroll"><table class="acct-table">
      <thead><tr><th>#</th><th>מועד</th><th>סכום</th><th>שולם</th><th>סטטוס</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function attachGemachHandlers() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  attachGemachExtraHandlers();
  const ov = state.data.gemach || {};
  document.querySelectorAll('[data-gemach-bank]').forEach(b => b.addEventListener('click', async (e) => {
    e.preventDefault();
    const l = (ov.loans || []).find(x => x.id === b.dataset.gemachBank);
    try {
      if (await masavBankForm(`חשבון לחיוב — ${l ? l.borrowerName : ''}`, l && l.bankMasked, (v) => window.systemAPI.setGemachLoanBank(b.dataset.gemachBank, v))) await switchView('gemach');
    } catch (error) { showError('שגיאה בשמירת החשבון: ' + errMsg(error)); }
  }));
  attachMasavHandlers(ov.masav);
  on('gemachSettingsBtn', () => openSubForm(gemachSettingsSchema, (state.data.gemach && state.data.gemach.settings) || {}));
  on('gemachDepositBtn', () => openSubForm(gemachDepositSchema));
  document.querySelectorAll('[data-gemach-deposit-del]').forEach(btn => btn.addEventListener('click', async () => {
    if (!(await askConfirm('למחוק את ההפקדה?'))) return;
    try { await window.systemAPI.deleteGemachDeposit(btn.dataset.gemachDepositDel); showToast('ההפקדה נמחקה'); await switchView('gemach'); }
    catch (error) { showError('שגיאה במחיקה: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-gemach-cancel]').forEach(btn => btn.addEventListener('click', async () => {
    if (!(await askConfirm('לבטל את ההלוואה?'))) return;
    try { await window.systemAPI.cancelGemachLoan(btn.dataset.gemachCancel); showToast('ההלוואה בוטלה'); await switchView('gemach'); }
    catch (error) { showError('שגיאה בביטול: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-gemach-statement]').forEach(btn => btn.addEventListener('click', async (e) => {
    e.preventDefault(); // הכפתור בתוך <summary> — לא לפתוח/לסגור את הפרטים
    try { const r = await window.systemAPI.exportGemachLoanStatementPdf(btn.dataset.gemachStatement); if (r && r.ok) showToast('דף החשבון נשמר כ-PDF'); }
    catch (error) { showError('שגיאה בהפקת דף החשבון: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-gemach-export]').forEach(btn => btn.addEventListener('click', async () => {
    try { const r = await window.systemAPI.exportGemachCsv(btn.dataset.gemachExport); if (r && r.ok) showToast('הקובץ נשמר'); }
    catch (error) { showError('שגיאה בייצוא: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-gemach-load-schedule]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      const loan = await window.systemAPI.getGemachLoan(btn.dataset.gemachLoadSchedule);
      state.data.gemachFull = [...(state.data.gemachFull || []).filter(l => l.id !== loan.id), loan];
      renderView('gemach');
    } catch (error) { showError('שגיאה בטעינת לוח הסילוקין: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-gemach-pay]').forEach(btn => btn.addEventListener('click', () => {
    openSubForm(gemachPaymentSchema(btn.dataset.gemachPay, Number(btn.dataset.gemachPaySeq), Number(btn.dataset.gemachPayRemaining)));
  }));
}
