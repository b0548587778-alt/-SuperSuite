// ממשק המודול הכלכלי — נתוני דוגמה וקבלה ראשונה (PLAN.md 1.5).
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

const SAMPLE_OFFER_KEY = 'econ.sampleOffer';
// מסכים שבהם נתוני הדוגמה מופיעים — שם מוצג הפס "אלה נתוני דוגמה"
const SAMPLE_VIEWS = ['dashboard', 'npo', 'gemach', 'people', 'acct-pricing', 'contacts'];

function sampleOfferDismissed() {
  try { return localStorage.getItem(SAMPLE_OFFER_KEY) === 'dismissed'; } catch { return false; }
}

async function refreshSampleStatus() {
  if (typeof window.systemAPI.getSampleStatus !== 'function') { state.sample = null; return null; }
  state.sample = await window.systemAPI.getSampleStatus().catch(() => null);
  return state.sample;
}

// פס במסכים שיש בהם דוגמה — עם כפתור מחיקה
function renderSampleBanner(viewName) {
  const st = state.sample;
  if (!st || !st.counts || !st.counts.total || !SAMPLE_VIEWS.includes(viewName)) return '';
  return `<div class="sample-banner" role="note">
    <span>📋 במערכת יש <b>נתוני דוגמה</b> (${st.counts.total} רשומות) — הם מסומנים "דוגמה", לא מקבלים מספר קבלה ולא מדווחים לרשות המסים.</span>
    <button type="button" class="secondary small" data-sample-delete>מחיקת נתוני הדוגמה</button>
  </div>`;
}

// כרטיס בלוח הבקרה: הצעה להכניס דוגמה, וכפתור "הפקת קבלה ראשונה"
function renderSampleOffer() {
  const st = state.sample;
  if (!st || !Array.isArray(st.kinds) || !st.kinds.length) return '';
  const hasNpo = st.kinds.some(k => k.id === 'npo');
  const firstReceipt = hasNpo ? '<button type="button" class="primary" data-first-receipt>🧾 הפקת קבלה ראשונה</button>' : '';
  if (st.counts && st.counts.total) return firstReceipt ? `<section class="sample-offer"><div class="sample-actions">${firstReceipt}</div></section>` : '';
  if (sampleOfferDismissed()) return firstReceipt ? `<section class="sample-offer"><div class="sample-actions">${firstReceipt}</div></section>` : '';
  return `<section class="sample-offer" aria-labelledby="sampleOfferTitle">
    <h3 id="sampleOfferTitle">👋 רוצים לראות איך זה עובד?</h3>
    <p class="muted">אפשר להכניס כמה רשומות לדוגמה, להסתכל ולנסות — ולמחוק אותן בלחיצה אחת. רשומות שתקלידו בעצמכם לא יימחקו.</p>
    <div class="sample-kinds">${st.kinds.map(k => `<label><input type="checkbox" name="sampleKind" value="${esc(k.id)}" checked> ${esc(k.label)}</label>`).join('')}</div>
    <div class="sample-actions">
      <button type="button" class="secondary" data-sample-add>הכנסת נתוני דוגמה</button>
      ${firstReceipt}
      <button type="button" class="link" data-sample-dismiss>לא תודה</button>
    </div>
  </section>`;
}

function attachSampleHandlers(root) {
  root.querySelectorAll('[data-sample-delete]').forEach(b => b.addEventListener('click', deleteSampleData));
  root.querySelectorAll('[data-sample-add]').forEach(b => b.addEventListener('click', () => {
    const kinds = [...root.querySelectorAll('input[name="sampleKind"]:checked')].map(i => i.value);
    addSampleData(kinds);
  }));
  root.querySelectorAll('[data-sample-dismiss]').forEach(b => b.addEventListener('click', () => {
    try { localStorage.setItem(SAMPLE_OFFER_KEY, 'dismissed'); } catch { /* לא קריטי */ }
    switchView(state.currentView);
  }));
  root.querySelectorAll('[data-first-receipt]').forEach(b => b.addEventListener('click', startFirstReceipt));
}

async function addSampleData(kinds) {
  if (!kinds.length) return showError('בחרו לפחות תחום אחד');
  try {
    await window.systemAPI.addSampleData(kinds);
    showToast('נתוני הדוגמה נוספו — אפשר להסתכל ולנסות');
    await refreshSampleStatus();
    switchView(state.currentView);
  } catch (error) {
    showError('לא ניתן להוסיף נתוני דוגמה: ' + errMsg(error));
  }
}

async function deleteSampleData() {
  if (!await askConfirm('למחוק את כל נתוני הדוגמה? רשומות שהקלדתם בעצמכם לא יימחקו.')) return;
  try {
    const r = await window.systemAPI.deleteSampleData();
    showToast(`נמחקו ${r.removed} רשומות דוגמה${r.kept ? ` · ${r.kept} נשארו כי רשומות שלכם מפנות אליהן` : ''}`);
    await refreshSampleStatus();
    switchView(state.currentView);
  } catch (error) {
    showError('המחיקה נכשלה: ' + errMsg(error));
  }
}

// קבלה ראשונה: למסך העמותה. בלי פרטי עמותה — קודם ההגדרות (בלעדיהן אין קבלה), אחרת טופס תרומה חדשה
async function startFirstReceipt() {
  await switchView('npo');
  const s = (state.data.npo && state.data.npo.settings) || {};
  if (!s.orgName) {
    showToast('צעד 1 מתוך 2: פרטי העמותה — ואז רושמים את התרומה הראשונה');
    const btn = document.getElementById('npoSettingsBtn');
    if (btn) btn.click();
    return;
  }
  showToast('ממלאים את פרטי התרומה ושומרים — הקבלה מופקת מיד');
  handleAdd();
}
