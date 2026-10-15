// ממשק המודול הכלכלי — חסד וחלוקות.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

// ============================================================
// חסד וחלוקות — נזקקים (כולל חסויים), מתנדבים וסבבי חלוקה: שיוך, שיבוץ מתנדב ומסירה.
// פרטי נזקק חסוי מוסתרים כבר בצד השרת למי שאינו מנהל; המסך רק מציג את מה שקיבל.
// ============================================================
const CHESED_TIERS = { regular: 'רגיל', confidential: 'חסוי (מתן בסתר)' };
const CHESED_DIVISIONS = { none: 'ללא הפרדה', men: 'מחלקת גברים', women: 'מחלקת נשים' };
const CHESED_RULES = { perFamily: 'מנה אחת לכל משפחה', bySize: 'לפי גודל המשפחה' };
const CHESED_ACTIVE = { yes: 'פעיל', no: 'לא פעיל' };
const activeVal = (r) => (r && r.active === false ? 'no' : 'yes');

const chesedBeneficiaryFields = [
  { name: 'familyName', label: 'שם המשפחה', type: 'text', required: true },
  { name: 'headName', label: 'שם ראש המשפחה', type: 'text' },
  { name: 'idNumber', label: 'ת.ז', type: 'text' },
  { name: 'familySize', label: 'מספר נפשות', type: 'number' },
  { name: 'phone', label: 'טלפון', type: 'tel' },
  { name: 'address', label: 'כתובת', type: 'text' },
  { name: 'area', label: 'אזור / שכונה (לחלוקה לפי מסלולים)', type: 'text' },
  { name: 'tier', label: 'רמת חיסיון', type: 'select', options: opts(CHESED_TIERS) },
  { name: 'active', label: 'סטטוס', type: 'select', options: opts(CHESED_ACTIVE) },
  { name: 'notes', label: 'הערות', type: 'textarea' }
];

formSchemas['chesed'] = {
  title: 'נזקק חדש',
  fields: chesedBeneficiaryFields,
  create: (d) => window.systemAPI.addChesedBeneficiary(d)
};

const chesedBeneficiaryEditSchema = {
  title: 'נזקק חדש',
  editTitle: 'עריכת נזקק',
  fields: chesedBeneficiaryFields,
  create: (d) => window.systemAPI.addChesedBeneficiary(d),
  update: (id, d) => window.systemAPI.updateChesedBeneficiary(id, d)
};

const chesedVolunteerSchema = {
  title: 'מתנדב חדש',
  editTitle: 'עריכת מתנדב',
  fields: [
    { name: 'name', label: 'שם המתנדב', type: 'text', required: true },
    { name: 'phone', label: 'טלפון', type: 'tel' },
    { name: 'division', label: 'מחלקה', type: 'select', options: opts(CHESED_DIVISIONS) },
    { name: 'area', label: 'אזור', type: 'text' },
    { name: 'availability', label: 'זמינות (למשל: ערבי חמישי)', type: 'text' },
    { name: 'active', label: 'סטטוס', type: 'select', options: opts(CHESED_ACTIVE) },
    { name: 'notes', label: 'הערות', type: 'text' }
  ],
  create: (d) => window.systemAPI.addChesedVolunteer(d),
  update: (id, d) => window.systemAPI.updateChesedVolunteer(id, d)
};

const chesedRoundSchema = {
  title: 'סבב חלוקה חדש',
  prepare: (schema) => { schema.fields.find(f => f.name === 'date').value = today(); },
  fields: [
    { name: 'name', label: 'שם הסבב (למשל: קמחא דפסחא)', type: 'text', required: true },
    { name: 'date', label: 'תאריך החלוקה', type: 'date', required: true },
    { name: 'item', label: 'מה מחלקים (תיאור המנה)', type: 'text' },
    { name: 'unitValue', label: 'שווי מנה (₪)', type: 'number' },
    { name: 'rule', label: 'כלל שיוך', type: 'select', options: opts(CHESED_RULES) },
    { name: 'personsPerUnit', label: 'נפשות למנה (בכלל "לפי גודל")', type: 'number', value: 4 },
    { name: 'division', label: 'שיבוץ מתנדבים מתוך', type: 'select', options: opts(CHESED_DIVISIONS) },
    { name: 'notes', label: 'הערות', type: 'textarea' }
  ],
  create: (d) => window.systemAPI.addChesedRound(d)
};

function renderChesedRound(r, benById, volunteers) {
  const s = r.summary || {};
  const closed = r.status === 'closed';
  const div = r.division && r.division !== 'none' ? r.division : '';
  const pool = volunteers.filter(v => v.active !== false && (!div || v.division === div));
  const rows = (r.allocations || []).map(a => {
    const b = benById[a.beneficiaryId] || { familyName: '(נמחק)', area: '', address: '' };
    const volOpts = ['<option value="">— לא שובץ —</option>']
      .concat(pool.map(v => `<option value="${esc(v.id)}"${v.id === a.volunteerId ? ' selected' : ''}>${esc(v.name)}</option>`));
    // מתנדב ששובץ ואינו במאגר הנוכחי (לא פעיל) — עדיין מוצג כדי לא להיעלם מהרשימה
    if (a.volunteerId && !pool.some(v => v.id === a.volunteerId)) {
      const v = volunteers.find(x => x.id === a.volunteerId);
      volOpts.push(`<option value="${esc(a.volunteerId)}" selected>${esc(v ? v.name + ' (לא פעיל)' : '(נמחק)')}</option>`);
    }
    return `
      <tr>
        <td>${esc(b.familyName)}${b.masked ? ' <small class="muted">🔒</small>' : ''}</td>
        <td>${esc(b.area || '')}</td><td>${esc(b.address || '')}</td><td>${Number(a.units) || 0}</td>
        <td><select data-chesed-assign="${esc(r.id)}" data-ben="${esc(a.beneficiaryId)}"${closed ? ' disabled' : ''}>${volOpts.join('')}</select></td>
        <td><label><input type="checkbox" data-chesed-deliver="${esc(r.id)}" data-ben="${esc(a.beneficiaryId)}"${a.delivered ? ' checked' : ''}${closed ? ' disabled' : ''}> ${a.delivered ? esc(a.deliveredAt) : ''}</label></td>
      </tr>`;
  }).join('');
  return `
    <details class="chesed-round" data-chesed-round="${esc(r.id)}"${state.chesedOpenRound === r.id ? ' open' : ''}>
      <summary>
        <span>${esc(r.name)} <small class="muted">${esc(r.date)}${r.item ? ' · ' + esc(r.item) : ''}${div ? ' · ' + esc(CHESED_DIVISIONS[div]) : ''} · ${closed ? 'סגור' : 'פתוח'}</small></span>
        <span>${Number(s.delivered) || 0}/${Number(s.families) || 0} נמסרו · ${Number(s.units) || 0} מנות${s.totalValue ? ' · ' + money(s.totalValue) : ''}</span>
      </summary>
      <div class="acct-actions">
        ${closed ? '' : `<button class="secondary" data-chesed-allocate="${esc(r.id)}">שיוך כל הנזקקים הפעילים</button>`}
        <button class="secondary" data-chesed-export-round="${esc(r.id)}">ייצוא רשימת חלוקה למתנדבים</button>
        ${closed ? '' : `<button class="secondary" data-chesed-close="${esc(r.id)}">סגירת הסבב</button>`}
        ${s.delivered ? '' : `<button class="icon-btn danger" data-chesed-round-del="${esc(r.id)}" title="מחיקת הסבב">🗑</button>`}
      </div>
      ${s.unassigned && !closed ? `<p class="muted">${s.unassigned} משפחות עדיין לא שובצו למתנדב</p>` : ''}
      ${rows ? `<div class="acct-scroll"><table class="acct-table">
        <thead><tr><th>משפחה</th><th>אזור</th><th>כתובת</th><th>מנות</th><th>מתנדב</th><th>נמסר</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : '<p class="muted">עדיין לא שויכו נזקקים — לחץ "שיוך כל הנזקקים הפעילים"</p>'}
    </details>`;
}

function renderChesed(o) {
  if (!o || typeof o !== 'object') return renderEmpty('אין נתונים להצגה');
  const bens = Array.isArray(o.beneficiaries) ? o.beneficiaries : [];
  const vols = Array.isArray(o.volunteers) ? o.volunteers : [];
  const rounds = Array.isArray(o.rounds) ? o.rounds : [];
  const benById = Object.fromEntries(bens.map(b => [b.id, b]));
  const activeBens = bens.filter(b => b.active !== false);
  const openRounds = rounds.filter(r => r.status !== 'closed');
  const pending = openRounds.reduce((t, r) => t + ((r.summary && r.summary.families) || 0) - ((r.summary && r.summary.delivered) || 0), 0);
  return `
    <div class="chesed">
      <div class="acct-header">
        <div>
          <h3>חסד וחלוקות</h3>
          <small class="muted">${o.canSeeConfidential ? 'מוצגים כל הפרטים, כולל נזקקים חסויים' : 'פרטי נזקקים חסויים מוסתרים (מוצגים למנהל בלבד)'}</small>
        </div>
        <div class="acct-actions">
          <button class="secondary" id="chesedRoundBtn">＋ סבב חלוקה</button>
          <button class="secondary" id="chesedVolunteerBtn">＋ מתנדב</button>
        </div>
      </div>
      <div class="kpis">
        <div class="kpi"><small>נזקקים פעילים</small><strong>${activeBens.length}</strong></div>
        <div class="kpi"><small>מתוכם חסויים</small><strong>${activeBens.filter(b => b.tier === 'confidential').length}</strong></div>
        <div class="kpi"><small>מתנדבים פעילים</small><strong>${vols.filter(v => v.active !== false).length}</strong></div>
        <div class="kpi"><small>סבבים פתוחים</small><strong>${openRounds.length}</strong></div>
        <div class="kpi${pending ? ' neg' : ''}"><small>משפחות שטרם קיבלו</small><strong>${pending}</strong></div>
      </div>
      <div class="acct-grid">
        <div class="card acct-wide">
          <h3>סבבי חלוקה (${rounds.length})</h3>
          ${rounds.length ? rounds.map(r => renderChesedRound(r, benById, vols)).join('') : renderEmpty('אין סבבי חלוקה — לחץ "＋ סבב חלוקה"')}
        </div>
        <div class="card">
          <div class="acct-header"><h3>נזקקים (${bens.length})</h3><button class="secondary small" data-chesed-export="beneficiaries">ייצוא</button></div>
          ${bens.map(b => `
            <div class="acct-row${b.active === false ? ' muted' : ''}">
              <span>${esc(b.familyName)}${b.headName ? ' · ' + esc(b.headName) : ''}${b.masked ? ' 🔒' : ''}
                <small class="muted">${Number(b.familySize) || 1} נפשות${b.area ? ' · ' + esc(b.area) : ''}${b.tier === 'confidential' && !b.masked ? ' · חסוי' : ''}${b.active === false ? ' · לא פעיל' : ''}</small></span>
              <span>
                ${b.masked ? '' : `<button class="icon-btn" data-chesed-ben-edit="${esc(b.id)}" title="עריכה">✎</button>`}
                <button class="icon-btn danger" data-chesed-ben-del="${esc(b.id)}" title="מחיקה">🗑</button>
              </span>
            </div>`).join('') || '<div class="acct-row muted">אין נזקקים — לחץ "＋ הוספת רשומה"</div>'}
        </div>
        <div class="card">
          <div class="acct-header"><h3>מתנדבים (${vols.length})</h3><button class="secondary small" data-chesed-export="volunteers">ייצוא</button></div>
          ${vols.map(v => `
            <div class="acct-row${v.active === false ? ' muted' : ''}">
              <span>${esc(v.name)} <small class="muted">${esc(CHESED_DIVISIONS[v.division] || '')}${v.area ? ' · ' + esc(v.area) : ''}${v.availability ? ' · ' + esc(v.availability) : ''}${v.phone ? ' · ' + esc(v.phone) : ''}</small></span>
              <span>
                <button class="icon-btn" data-chesed-vol-edit="${esc(v.id)}" title="עריכה">✎</button>
                <button class="icon-btn danger" data-chesed-vol-del="${esc(v.id)}" title="מחיקה">🗑</button>
              </span>
            </div>`).join('') || '<div class="acct-row muted">אין מתנדבים עדיין</div>'}
        </div>
      </div>
    </div>`;
}

function attachChesedHandlers() {
  const data = state.data.chesed || {};
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  const all = (sel, ev, fn) => document.querySelectorAll(sel).forEach(el => el.addEventListener(ev, () => fn(el)));
  // פעולה שמרעננת את התצוגה — שומרים איזה סבב היה פתוח כדי שלא ייסגר אחרי כל סימון
  const act = async (fn, okMsg, errPrefix) => {
    try { await fn(); if (okMsg) showToast(okMsg); await switchView('chesed'); }
    catch (error) { showError(errPrefix + errMsg(error)); await switchView('chesed'); }
  };
  on('chesedRoundBtn', () => openSubForm(chesedRoundSchema));
  on('chesedVolunteerBtn', () => openSubForm(chesedVolunteerSchema));
  all('[data-chesed-round]', 'toggle', (el) => { if (el.open) state.chesedOpenRound = el.dataset.chesedRound; else if (state.chesedOpenRound === el.dataset.chesedRound) state.chesedOpenRound = null; });
  all('[data-chesed-ben-edit]', 'click', (el) => {
    const b = (data.beneficiaries || []).find(x => x.id === el.dataset.chesedBenEdit);
    if (b) openSubForm(chesedBeneficiaryEditSchema, { ...b, active: activeVal(b) }, b.id);
  });
  all('[data-chesed-ben-del]', 'click', async (el) => {
    if (!(await askConfirm('למחוק את הנזקק?'))) return;
    act(() => window.systemAPI.deleteChesedBeneficiary(el.dataset.chesedBenDel), 'הנזקק נמחק', 'שגיאה במחיקה: ');
  });
  all('[data-chesed-vol-edit]', 'click', (el) => {
    const v = (data.volunteers || []).find(x => x.id === el.dataset.chesedVolEdit);
    if (v) openSubForm(chesedVolunteerSchema, { ...v, active: activeVal(v) }, v.id);
  });
  all('[data-chesed-vol-del]', 'click', async (el) => {
    if (!(await askConfirm('למחוק את המתנדב?'))) return;
    act(() => window.systemAPI.deleteChesedVolunteer(el.dataset.chesedVolDel), 'המתנדב נמחק', 'שגיאה במחיקה: ');
  });
  all('[data-chesed-allocate]', 'click', (el) => act(async () => {
    const r = await window.systemAPI.allocateChesedRound(el.dataset.chesedAllocate);
    showToast(r.added ? `שויכו ${r.added} משפחות` : 'כל הנזקקים הפעילים כבר משויכים');
  }, '', 'שגיאה בשיוך: '));
  all('[data-chesed-assign]', 'change', (el) => act(
    () => window.systemAPI.assignChesedVolunteer(el.dataset.chesedAssign, el.dataset.ben, el.value), '', 'שגיאה בשיבוץ: '));
  all('[data-chesed-deliver]', 'change', (el) => act(
    () => window.systemAPI.markChesedDelivered(el.dataset.chesedDeliver, el.dataset.ben, el.checked, today()), '', 'שגיאה בעדכון מסירה: '));
  all('[data-chesed-close]', 'click', async (el) => {
    if (!(await askConfirm('לסגור את הסבב? לאחר הסגירה לא ניתן לשנות שיבוצים ומסירות.'))) return;
    act(() => window.systemAPI.closeChesedRound(el.dataset.chesedClose), 'הסבב נסגר', 'שגיאה בסגירה: ');
  });
  all('[data-chesed-round-del]', 'click', async (el) => {
    if (!(await askConfirm('למחוק את סבב החלוקה?'))) return;
    act(() => window.systemAPI.deleteChesedRound(el.dataset.chesedRoundDel), 'הסבב נמחק', 'שגיאה במחיקה: ');
  });
  all('[data-chesed-export]', 'click', async (el) => {
    try { const r = await window.systemAPI.exportChesedCsv(el.dataset.chesedExport); if (r && r.ok) showToast('הקובץ נשמר'); }
    catch (error) { showError('שגיאה בייצוא: ' + errMsg(error)); }
  });
  all('[data-chesed-export-round]', 'click', async (el) => {
    try { const r = await window.systemAPI.exportChesedCsv('round', el.dataset.chesedExportRound); if (r && r.ok) showToast('רשימת החלוקה נשמרה'); }
    catch (error) { showError('שגיאה בייצוא: ' + errMsg(error)); }
  });
}
