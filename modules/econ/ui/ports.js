// ממשק המודול הכלכלי — סרגל ייבוא/ייצוא.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

// ============================================================
// ייבוא וייצוא — פס בכל תצוגת נתונים, ומרכז מלא בהגדרות המתקדמות
// ============================================================
const PORT_VIEWS = {"contacts":["contacts"],"tasks":["tasks"],"business":["businessPlans"],"market-intel":["marketIntel"],"acct-personal":["personal"],"personal-finance":["financeIncomes","financeExpenses"],"mortgage-advisor":["mortgageClients"]};
const PORT_LABELS = {
  contacts: 'אנשי קשר', tasks: 'משימות', businessPlans: 'תוכניות עסקיות', marketIntel: 'מודיעין שוק',
  personal: 'הוצאות אישיות', financeIncomes: 'הכנסות', financeExpenses: 'הוצאות', mortgageClients: 'תיקי לקוחות',
  npoGrants: 'תמיכות', products: 'מחירון'
};
function renderPortsBar(kinds) {
  const multi = kinds.length > 1;
  return `<div class="ports-bar">${kinds.map(k => `
    <span class="ports-group">${multi ? `<small class="muted">${esc(PORT_LABELS[k] || k)}:</small>` : ''}
      <button class="secondary small" data-port-export="${esc(k)}">⬇ ייצוא ל-Excel</button>
      <button class="secondary small" data-port-import="${esc(k)}">⬆ ייבוא מ-CSV</button>
      <button class="secondary small" data-port-template="${esc(k)}">תבנית</button>
    </span>`).join('')}
    ${kinds.includes('contacts') ? '<button class="secondary small" data-vcard-import>⬆ ייבוא vCard</button><button class="secondary small" data-vcard-export>⬇ ייצוא vCard</button>' : ''}
  </div>`;
}

function pickFileText(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      if (file.size > 20 * 1024 * 1024) { showError('הקובץ גדול מדי (עד 20MB)'); return resolve(null); }
      resolve(await file.text());
    });
    input.click();
  });
}

function importSummary(r) {
  const parts = [`יובאו ${r.added}`];
  if (r.skipped) parts.push(`${r.skipped} כפולים דולגו`);
  if (r.errors && r.errors.length) parts.push(`${r.errors.length} שורות נדחו (${r.errors.slice(0, 3).map(e => 'שורה ' + e.line + ': ' + e.message).join('; ')})`);
  return parts.join(' · ');
}

function attachPortsHandlers() {
  document.querySelectorAll('[data-port-export]').forEach(b => b.addEventListener('click', async () => {
    try { const r = await window.systemAPI.exportData(b.dataset.portExport); if (r && r.ok) showToast(`הקובץ נשמר (${r.rows} שורות)`); }
    catch (error) { showError('שגיאה בייצוא: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-port-template]').forEach(b => b.addEventListener('click', async () => {
    try { const r = await window.systemAPI.exportDataTemplate(b.dataset.portTemplate); if (r && r.ok) showToast('התבנית נשמרה — מלא אותה ב-Excel וייבא'); }
    catch (error) { showError('שגיאה: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-port-import]').forEach(b => b.addEventListener('click', async () => {
    const text = await pickFileText('.csv,text/csv');
    if (text == null) return;
    try { const r = await window.systemAPI.importData(b.dataset.portImport, text); showToast(importSummary(r)); await switchView(state.currentView); }
    catch (error) { showError('שגיאה בייבוא: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-vcard-import]').forEach(b => b.addEventListener('click', async () => {
    const text = await pickFileText('.vcf,text/vcard,text/x-vcard');
    if (text == null) return;
    try { const r = await window.systemAPI.importContactsVcard(text); showToast(importSummary(r)); await switchView(state.currentView); }
    catch (error) { showError('שגיאה בייבוא: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-vcard-export]').forEach(b => b.addEventListener('click', async () => {
    try { const r = await window.systemAPI.exportContactsVcard(); if (r && r.ok) showToast('אנשי הקשר נשמרו כ-vCard'); }
    catch (error) { showError('שגיאה בייצוא: ' + errMsg(error)); }
  }));
}
