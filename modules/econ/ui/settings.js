// ממשק המודול הכלכלי — הגדרות מתקדמות, משתמשים ופרטיות.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

// ============================================================
// הגדרות מתקדמות: כללי, משתמשים ותפקידים, יומן ביקורת, מרכז ייבוא/ייצוא
// ============================================================
const ROLE_LABELS = { admin: 'מנהל — הכל כולל משתמשים', editor: 'עורך — צפייה, הזנה, ייצוא וגיבוי', viewer: 'צופה — קריאה בלבד',
  accountant: 'רואה חשבון — צפייה וייצוא בלבד' };
const START_LABELS = { dashboard: 'לוח בקרה', 'acct-reports': 'דוחות ומע"מ', 'acct-invoices': 'חשבוניות מס', 'acct-journal': 'יומן חשבונאי',
  'personal-finance': 'התוכנית הפיננסית', finance: 'תכנון פיננסי', contacts: 'אנשי קשר', tasks: 'משימות', npo: 'עמותה ותרומות', gemach: 'גמ"ח', chesed: 'חסד וחלוקות', 'mortgage-advisor': 'ייעוץ משכנתאות', 'mortgage-lab': 'מעבדת תמהיל' };

const advGeneralSchema = {
  title: 'הגדרות כלליות',
  fields: [
    { name: 'idleMinutes', label: 'ניתוק אוטומטי אחרי (דקות ללא פעילות, 5–240)', type: 'number', required: true },
    { name: 'startView', label: 'מסך פתיחה אחרי כניסה', type: 'select', options: Object.entries(START_LABELS).map(([value, label]) => ({ value, label })) }
  ],
  create: (d) => window.systemAPI.saveAdvancedSettings(d)
};
const advUserSchema = {
  title: 'משתמש חדש',
  fields: [
    { name: 'username', label: 'שם משתמש (אותיות לועזיות, ספרות, . _ -)', type: 'text', required: true },
    { name: 'password', label: 'סיסמה ראשונית (לפחות 12 תווים)', type: 'password', required: true },
    { name: 'role', label: 'תפקיד', type: 'select', options: Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })) }
  ],
  create: (d) => window.systemAPI.createUser(d)
};

// הגנת הפרטיות (תיקון 13) — כלי עזר למנהל: מיפוי מאגרים, מזעור נזקקים לא פעילים, רשימת בדיקה לאירוע
function renderPrivacyCard(pv) {
  if (!pv || !Array.isArray(pv.rows)) return '';
  return `<div class="card">
    <h3>הגנת הפרטיות — מיפוי מאגרים</h3>
    <p class="muted">${esc(pv.disclaimer)}</p>
    <div class="acct-scroll"><table class="acct-table">
      <thead><tr><th>מאגר</th><th>רשומות</th><th>שדות</th><th>רגישות</th><th>מי רואה</th></tr></thead>
      <tbody>${pv.rows.map(r => `<tr><td>${esc(r.area)}</td><td>${Number(r.count) || 0}</td><td><small>${esc(r.fields)}</small></td>
        <td><small class="${r.sensitivity === 'regular' ? 'muted' : 'bad'}">${esc(r.sensitivityLabel)}</small></td><td><small>${esc(r.access)}</small></td></tr>`).join('')}</tbody>
    </table></div>
    <div class="acct-row"><span>משתמשים פעילים</span><span>מנהלים ${Number(pv.users.admin)} · עורכים ${Number(pv.users.editor)} · צופים ${Number(pv.users.viewer)}</span></div>
    <h4>היכן הנתונים נשמרים</h4>
    ${pv.storage.map(s => `<div class="acct-row"><span><small>${esc(s)}</small></span></div>`).join('')}
    <h4>מזעור נזקקים לא פעילים</h4>
    <p class="muted">נזקק שסומן "לא פעיל" ולא הייתה לו פעילות בתקופה שנבחרה: שם המשפחה, גודל המשפחה והאזור נשמרים (להיסטוריית החלוקות), והפרטים המזהים נמחקים — ראש המשפחה, ת.ז, טלפון, כתובת והערות. הפעולה אינה הפיכה, ורצה רק אחרי אישור הרשימה. כדאי לבצע גיבוי לפני.</p>
    <div class="acct-actions"><button class="secondary" id="privacyRetentionBtn">בדיקת רשומות למזעור…</button></div>
    <details><summary><h4 style="display:inline">רשימת בדיקה לאירוע אבטחה</h4></summary>
      <ol>${(pv.checklist || []).map(s => `<li>${esc(s)}</li>`).join('')}</ol>
    </details>
  </div>`;
}

async function runPrivacyRetention() {
  const f = await askFields('מזעור נזקקים לא פעילים', [{ name: 'years', label: 'ללא פעילות לפחות (שנים)', type: 'number' }], 'הצג רשימה', { years: '7' });
  if (!f) return;
  let pv;
  try { pv = await window.systemAPI.previewPrivacyRetention(Number(f.years)); }
  catch (error) { return showError('שגיאה: ' + errMsg(error)); }
  if (!pv.rows.length) return showToast(`אין נזקקים לא פעילים ללא פעילות מאז ${pv.cutoff}`);
  const ok = await openDialog((card, finish) => {
    card.style.maxWidth = '560px';
    card.innerHTML = `<h2>${pv.rows.length} רשומות למזעור</h2>
      <p class="muted" style="padding:0 1.5rem">לא פעילים, ללא פעילות מאז ${esc(pv.cutoff)}. הפרטים המזהים יימחקו לצמיתות.</p>
      <div class="acct-scroll" style="max-height:45vh;padding:0 1.5rem">${pv.rows.map(r => `<div class="acct-row"><span>${esc(r.familyName)}${r.tier === 'confidential' ? ' <small class="bad">· חסוי</small>' : ''}</span><span><small class="muted">פעילות אחרונה ${esc(r.last)}</small></span></div>`).join('')}</div>
      <div class="modal-actions"><button type="button" class="secondary" data-act="no">ביטול</button><button type="button" class="danger" data-act="yes">מזעור ${pv.rows.length} רשומות</button></div>`;
    card.querySelector('[data-act="no"]').addEventListener('click', () => finish(false));
    card.querySelector('[data-act="yes"]').addEventListener('click', () => finish(true));
  });
  if (!ok) return;
  try {
    const r = await window.systemAPI.minimizePrivacy(pv.rows.map(x => x.id), Number(f.years));
    showToast(`מוזערו ${r.minimized} רשומות${r.skipped ? ` · ${r.skipped} דולגו (השתנו בינתיים)` : ''}`);
    await switchView('settings');
  } catch (error) { showError('שגיאה במזעור: ' + errMsg(error)); }
}

function renderSettings(d) {
  const st = d && typeof d === 'object' ? d : {};
  const users = Array.isArray(st.users) ? st.users : [];
  const audit = Array.isArray(st.audit) ? st.audit : [];
  const kinds = Array.isArray(st.kinds) ? st.kinds : [];
  const counts = st.counts || {};
  return `
    <div class="settings">
      <div class="acct-grid">
        <div class="card">
          <h3>כללי</h3>
          <div class="acct-row"><span>ניתוק אוטומטי</span><span>${esc(st.idleMinutes || 15)} דקות</span></div>
          <div class="acct-row"><span>מסך פתיחה</span><span>${esc(START_LABELS[st.startView] || 'לוח בקרה')}</span></div>
          <div class="acct-row"><span>משתמש מחובר</span><span>${esc(st.me && st.me.username || '')}</span></div>
          ${st.isAdmin ? '<button class="secondary" id="advGeneralBtn">עריכת הגדרות כלליות</button>' : '<p class="muted">שינוי הגדרות — למנהל בלבד.</p>'}
        </div>
        <div class="card">
          <h3>גיבוי ושמירת נתונים</h3>
          <p class="muted">כל הנתונים נשמרים במחשב בלבד ונכללים בגיבוי המוצפן. גיבוי ידני ושחזור — בכפתורים שבסרגל העליון. יעד גיבוי אוטומטי (כונן USB) נקבע במסך הראשי של החבילה.</p>
        </div>
      </div>

      <div class="card">
        <h3>ייבוא וייצוא נתונים</h3>
        <p class="muted">ייצוא לקובץ CSV שנפתח ב-Excel בעברית. בייבוא: שורה ראשונה = כותרות (כמו בתבנית); רשומות כפולות מדולגות ושורות שגויות מדווחות.</p>
        <div class="acct-scroll"><table class="acct-table">
          <thead><tr><th>סוג נתונים</th><th>רשומות</th><th></th></tr></thead>
          <tbody>${kinds.map(k => `<tr><td>${esc(k.label)}</td><td>${Number(counts[k.id]) || 0}</td><td>
            <button class="secondary small" data-port-export="${esc(k.id)}">ייצוא</button>
            <button class="secondary small" data-port-import="${esc(k.id)}">ייבוא</button>
            <button class="secondary small" data-port-template="${esc(k.id)}">תבנית</button>
            ${k.id === 'contacts' ? '<button class="secondary small" data-vcard-import>ייבוא vCard</button><button class="secondary small" data-vcard-export>ייצוא vCard</button>' : ''}
          </td></tr>`).join('')}</tbody>
        </table></div>
      </div>

      ${st.isAdmin ? `
      <div class="card">
        <div class="acct-header"><h3>משתמשים ותפקידים (${users.length})</h3><button class="secondary" id="advAddUserBtn">＋ משתמש חדש</button></div>
        <div class="acct-scroll"><table class="acct-table">
          <thead><tr><th>משתמש</th><th>תפקיד</th><th>מצב</th><th></th></tr></thead>
          <tbody>${users.map(u => `<tr class="${u.active ? '' : 'muted'}">
            <td>${esc(u.username)}${st.me && st.me.id === u.id ? ' <small class="muted">(אתה)</small>' : ''}</td>
            <td><select data-user-role="${esc(u.id)}"${st.me && st.me.id === u.id ? ' disabled' : ''}>${Object.keys(ROLE_LABELS).map(r => `<option value="${r}"${u.role === r ? ' selected' : ''}>${esc(ROLE_LABELS[r].split(' — ')[0])}</option>`).join('')}</select></td>
            <td>${u.active ? (u.locked ? 'נעול זמנית' : 'פעיל') : 'חסום'}</td>
            <td>${st.me && st.me.id === u.id ? '' : `<button class="secondary small" data-user-toggle="${esc(u.id)}" data-active="${u.active ? '1' : '0'}">${u.active ? 'חסימה' : 'הפעלה'}</button>`}
              <button class="secondary small" data-user-reset="${esc(u.id)}">איפוס סיסמה</button></td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>

      ${renderPrivacyCard(st.privacy)}

      <div class="card">
        <div class="acct-header"><h3>יומן ביקורת</h3>
          <div class="acct-actions">
            <select id="auditFilter">
              ${[['', 'הכל'], ['chesed.confidential', 'צפייה בחסויים'], ['acct', 'הנהלת חשבונות'], ['npo', 'עמותה'], ['gemach', 'גמ"ח'], ['chesed', 'חסד וחלוקות'], ['madv', 'ייעוץ משכנתאות'], ['users', 'משתמשים'], ['ports', 'ייבוא/ייצוא'], ['data', 'גיבוי ושחזור'], ['settings', 'הגדרות']]
                .map(([v, l]) => `<option value="${v}"${(state.auditFilter || '') === v ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
            <button class="secondary" id="auditExportBtn">ייצוא יומן</button>
          </div>
        </div>
        <div class="acct-scroll"><table class="acct-table">
          <thead><tr><th>מועד</th><th>משתמש</th><th>פעולה</th><th>פרטים</th></tr></thead>
          <tbody>${audit.map(a => `<tr><td>${esc(String(a.at).slice(0, 16).replace('T', ' '))}</td><td>${esc(a.user)}</td><td>${esc(a.action)}</td><td><small>${esc(String(a.details).slice(0, 120))}</small></td></tr>`).join('') || '<tr><td colspan="4" class="muted">אין אירועים</td></tr>'}</tbody>
        </table></div>
      </div>` : ''}
    </div>`;
}

function attachSettingsHandlers() {
  const privBtn = document.getElementById('privacyRetentionBtn');
  if (privBtn) privBtn.addEventListener('click', runPrivacyRetention);
  const st = state.data.settings || {};
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  on('advGeneralBtn', () => openSubForm(advGeneralSchema, { idleMinutes: st.idleMinutes, startView: st.startView }));
  on('advAddUserBtn', () => openSubForm(advUserSchema, { role: 'editor' }));
  on('auditExportBtn', async () => {
    try { const r = await window.systemAPI.exportAudit({ action: state.auditFilter || '' }); if (r && r.ok) showToast('היומן נשמר'); }
    catch (error) { showError('שגיאה בייצוא: ' + errMsg(error)); }
  });
  const filter = document.getElementById('auditFilter');
  if (filter) filter.addEventListener('change', () => { state.auditFilter = filter.value; switchView('settings'); });
  document.querySelectorAll('[data-user-role]').forEach(sel => sel.addEventListener('change', async () => {
    try { await window.systemAPI.updateUser(sel.dataset.userRole, { role: sel.value }); showToast('התפקיד עודכן — המשתמש יידרש להתחבר מחדש'); }
    catch (error) { showError('שגיאה: ' + errMsg(error)); }
    await switchView('settings');
  }));
  document.querySelectorAll('[data-user-toggle]').forEach(b => b.addEventListener('click', async () => {
    const activate = b.dataset.active !== '1';
    if (!activate && !(await askConfirm('לחסום את המשתמש? הוא ינותק מיד ולא יוכל להתחבר.'))) return;
    try { await window.systemAPI.updateUser(b.dataset.userToggle, { active: activate }); showToast(activate ? 'המשתמש הופעל' : 'המשתמש נחסם'); await switchView('settings'); }
    catch (error) { showError('שגיאה: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-user-reset]').forEach(b => b.addEventListener('click', async () => {
    const v = await askFields('איפוס סיסמה', [{ name: 'pass', label: 'סיסמה חדשה (לפחות 12 תווים)', type: 'password' }], 'איפוס');
    if (!v) return;
    try { await window.systemAPI.resetUserPassword(b.dataset.userReset, v.pass); showToast('הסיסמה אופסה'); }
    catch (error) { showError('שגיאה: ' + errMsg(error)); }
  }));
}
