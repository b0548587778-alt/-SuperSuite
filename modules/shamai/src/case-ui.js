// שמאי — מסך תיק השמאות המקצועי: רשימת תיקים ולקוחות, עריכת תיק, תמונות, נעילה וגרסה מתוקנת. חלק מ-modules/shamai/src.
'use strict';
// הלוגיקה ב-src/casefile.js והדוח ב-src/case-report.js. כאן רק המסך: הכול נבנה בתוך #cs-root, ושינוי בשדה נשמר אוטומטית (טיוטה בלבד).

// pending — התיק שבעריכה עם שינויים שעוד לא נשמרו (השמירה מתעכבת 400ms בזמן הקלדה)
const CASE_UI = { editId: null, search: '', clientKey: null, saveTimer: null, pending: null };

// פרטי השמאי באנגלית — לדוח דו-לשוני בלבד
function loadAppraiserEn() {
  const a = Storage.load('appraiserEn', {}) || {};
  const out = {};
  for (const k of ['name', 'business', 'license', 'phone', 'address']) out[k] = typeof a[k] === 'string' ? a[k].slice(0, 200) : '';
  out.declaration = typeof a.declaration === 'string' ? a.declaration.slice(0, 2000) : '';
  return out;
}

function renderAppraiserEnSettings() {
  const a = loadAppraiserEn();
  for (const k of ['name', 'business', 'address', 'declaration']) { const el = $('#ape-' + k); if (el) el.value = a[k]; }
  const btn = $('#ape-save');
  if (btn) btn.onclick = () => {
    const out = {};
    for (const k of ['name', 'business', 'address']) out[k] = ($('#ape-' + k)?.value || '').trim().slice(0, 200);
    out.declaration = ($('#ape-declaration')?.value || '').trim().slice(0, 2000);
    Storage.save('appraiserEn', out);
    toast('הפרטים באנגלית נשמרו', 'success');
  };
}

const caseOpts = (obj, cur, label = (v) => v.he) => Object.entries(obj).map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${escapeHtml(label(v))}</option>`).join('');
const caseVal = (v) => escapeHtml(String(v ?? ''));
const caseStatusName = (c) => (c.status === 'final' ? 'סופי' : 'טיוטה') + (c.rev ? ` · גרסה ${c.rev}` : '');

function currentCase() {
  if (CASE_UI.pending && CASE_UI.pending.id === CASE_UI.editId) return CASE_UI.pending;
  return CASE_UI.editId ? loadCases().find(c => c.id === CASE_UI.editId) || null : null;
}

function storeCase(c) {
  const list = loadCases();
  const i = list.findIndex(x => x.id === c.id);
  if (i >= 0) list[i] = c; else list.unshift(c);
  saveCases(list);
}

// ─────────────────────────────────────────────────────────────────────────────
//  רשימת התיקים והלקוחות
// ─────────────────────────────────────────────────────────────────────────────

function renderCasesView() {
  const root = $('#cs-root');
  if (!root) return;
  if (CASE_UI.editId && currentCase()) { renderCaseEditor(); return; }
  CASE_UI.editId = null;
  if (CASE_UI.detach) { CASE_UI.detach(); CASE_UI.detach = null; }
  const all = loadCases();
  const q = CASE_UI.search.trim().toLowerCase();
  let list = CASE_UI.clientKey ? casesForClient(all, CASE_UI.clientKey) : all;
  if (q) list = list.filter(c => [c.client.name, c.client.idNumber, String(c.no), ...(c.items || []).map(i => i.desc)].join(' ').toLowerCase().includes(q));
  const clients = caseClients(all);
  const filterClient = CASE_UI.clientKey ? clients.find(x => x.key === CASE_UI.clientKey) : null;
  root.innerHTML = `
    <div class="ss-hint">תיק לכל שמאות: לקוח, מטרה, בסיס שווי, פריטים עם מתכות ואבנים, תמונות ודוח מקצועי בעברית או בעברית ובאנגלית. המחירים והשערים — מהמחירים השמורים (הקלדה או קובץ).</div>
    <div class="ss-toolbar">
      <button class="ss-btn-primary" id="cs-new">+ תיק חדש</button>
      <input class="ss-input" type="search" id="cs-search" aria-label="חיפוש תיק" placeholder="חיפוש לפי לקוח, מספר זהות, מספר תיק או פריט" value="${caseVal(CASE_UI.search)}" />
    </div>
    ${filterClient ? `<div class="ss-card ss-card-info ss-toolbar">תיקים של <strong>${escapeHtml(filterClient.name)}</strong>
      <button class="ss-btn-ghost ss-btn-sm" id="cs-new-for">+ תיק חדש ללקוח</button><button class="ss-btn-ghost ss-btn-sm" id="cs-clear">✕ כל התיקים</button></div>` : ''}
    <div class="ss-list">${list.length ? list.map(c => {
      const total = c.status === 'final' && c.frozen ? c.frozen.totalAg : caseTotals(c, state.prices).totalAg;
      return `<div class="ss-list-row">
        <strong>תיק ${escapeHtml(caseReportNo(c))}</strong>
        <span class="ss-grow">${escapeHtml(c.client.name || 'ללא שם')}<small class="ss-muted"> · ${escapeHtml(CASE_PURPOSES[c.purpose]?.he || '')} · ${shortDay(c.effectiveDate)}</small></span>
        <span class="ss-badge ${c.status === 'final' ? 'ss-badge-success' : 'ss-badge-warning'}">${escapeHtml(caseStatusName(c))}</span>
        <strong>${caseMoney(total)}</strong>
        <span class="ss-actions">
          <button class="ss-btn-ghost ss-btn-sm" data-open="${caseVal(c.id)}">פתיחה</button>
          <button class="ss-btn-ghost ss-btn-sm" data-report="${caseVal(c.id)}" aria-label="דוח לתיק ${caseVal(caseReportNo(c))}">🖨 דוח</button>
          <button class="ss-btn-ghost ss-btn-sm" data-del="${caseVal(c.id)}" aria-label="מחיקת תיק ${caseVal(caseReportNo(c))}">🗑</button>
        </span>
      </div>`;
    }).join('') : '<div class="ss-hint">אין תיקים להצגה</div>'}</div>
    ${clients.length && !filterClient ? `<h3 class="ss-section-title">לקוחות</h3><div class="ss-list">${clients.slice(0, 50).map(cl => `<div class="ss-list-row">
      <span class="ss-grow">${escapeHtml(cl.name)}${cl.idNumber ? `<small class="ss-muted"> · ${escapeHtml(cl.idNumber)}</small>` : ''}</span>
      <span>${cl.count === 1 ? 'תיק אחד' : cl.count + ' תיקים'}</span><span>דוחות סופיים: <strong>${caseMoney(cl.finalAg)}</strong></span>
      <button class="ss-btn-ghost ss-btn-sm" data-client="${caseVal(cl.key)}">היסטוריה</button></div>`).join('')}</div>` : ''}`;
  $('#cs-new').onclick = () => openNewCase(null);
  $('#cs-search').oninput = debounce((e) => { CASE_UI.search = e.target.value; renderCasesView(); $('#cs-search')?.focus(); }, 300);
  $('#cs-clear') && ($('#cs-clear').onclick = () => { CASE_UI.clientKey = null; renderCasesView(); });
  $('#cs-new-for') && ($('#cs-new-for').onclick = () => {
    const last = casesForClient(all, CASE_UI.clientKey)[0];
    openNewCase(last ? last.client : null);
  });
  $$('#cs-root [data-open]').forEach(b => b.onclick = () => { CASE_UI.editId = b.dataset.open; renderCasesView(); });
  $$('#cs-root [data-report]').forEach(b => b.onclick = () => showCaseReport(all.find(c => c.id === b.dataset.report)));
  $$('#cs-root [data-client]').forEach(b => b.onclick = () => { CASE_UI.clientKey = b.dataset.client; renderCasesView(); });
  $$('#cs-root [data-del]').forEach(b => b.onclick = () => deleteCase(b.dataset.del));
}

function openNewCase(client) {
  const c = newCase(nextCaseNo(), localToday(), client);
  storeCase(c);
  CASE_UI.editId = c.id;
  renderCasesView();
}

async function deleteCase(id) {
  const c = loadCases().find(x => x.id === id);
  if (!c) return;
  const msg = c.status === 'final'
    ? `תיק ${caseReportNo(c)} הוא דוח סופי שהופק ללקוח. למחוק אותו ואת התמונות שלו? אי אפשר לבטל.`
    : `למחוק את הטיוטה של תיק ${caseReportNo(c)} ואת התמונות שלה?`;
  if (!(await ssDialog.confirm(msg, { danger: true, okText: 'מחיקה' }))) return;
  deleteCasePhotos((c.items || []).flatMap(i => i.photos || []));
  saveCases(loadCases().filter(x => x.id !== id));
  toast('התיק נמחק', 'success');
  renderCasesView();
}

function showCaseReport(c) {
  if (!c) return;
  const photos = {};
  for (const it of c.items || []) for (const id of it.photos || []) photos[id] = loadCasePhoto(id);
  openPrintPreview(buildCaseReportHtml(c, state.prices, loadAppraiser(), loadAppraiserEn(), photos));
}

// ─────────────────────────────────────────────────────────────────────────────
//  עריכת תיק
// ─────────────────────────────────────────────────────────────────────────────

const caseField = (label, path, value, attrs = '') => {
  const id = 'cs-f-' + path.replace(/\./g, '-');
  return `<div class="ss-field"><label class="ss-label" for="${id}">${escapeHtml(label)}</label><input class="ss-input" id="${id}" data-path="${path}" value="${caseVal(value)}" ${attrs} /></div>`;
};
const caseSelect = (label, path, obj, cur, labelFn) => {
  const id = 'cs-f-' + path.replace(/\./g, '-');
  return `<div class="ss-field"><label class="ss-label" for="${id}">${escapeHtml(label)}</label><select class="ss-input" id="${id}" data-path="${path}">${caseOpts(obj, cur, labelFn)}</select></div>`;
};

function caseMetalRow(m, i, j) {
  const p = `items.${i}.metals.${j}`;
  const purities = (CASE_METALS[m.metal] || CASE_METALS.gold).purities;
  return `<div class="ss-form-grid">
    <select class="ss-input" data-path="${p}.metal" data-rerender="1" aria-label="מתכת">${caseOpts(CASE_METALS, m.metal)}</select>
    <select class="ss-input" data-path="${p}.purityPpt" data-num="1" aria-label="טוהר">${purities.map(v => `<option value="${v}"${Number(m.purityPpt) === v ? ' selected' : ''}>${v}</option>`).join('')}</select>
    <input class="ss-input" data-path="${p}.grams" inputmode="decimal" placeholder="גרם" aria-label="משקל בגרמים" value="${caseVal(m.grams)}" />
    <button class="ss-btn-ghost ss-btn-sm" data-rm="${p}" aria-label="הסרת מתכת ${j + 1}">✕</button>
  </div>`;
}

function caseStoneRow(s, i, j) {
  const p = `items.${i}.stones.${j}`;
  const inp = (f, label, extra = '') => `<input class="ss-input" data-path="${p}.${f}" aria-label="${label}" placeholder="${label}" value="${caseVal(s[f])}" ${extra} />`;
  return `<div class="ss-card ss-card-accent ss-stack">
    <div class="ss-form-grid">
      <select class="ss-input" data-path="${p}.type" aria-label="סוג אבן">${caseOpts(CASE_STONES, s.type)}</select>
      ${inp('name', 'שם (לאבן אחרת)')}
      ${inp('count', 'כמות', 'inputmode="numeric"')}
      ${inp('carat', 'קראט (לכל אבן)', 'inputmode="decimal"')}
      <button class="ss-btn-ghost ss-btn-sm" data-rm="${p}" aria-label="הסרת אבן ${j + 1}">✕</button>
    </div>
    <div class="ss-form-grid">
      <select class="ss-input" data-path="${p}.pricing" aria-label="אופן התמחור"><option value="perCarat"${s.pricing !== 'perPiece' ? ' selected' : ''}>מחיר לקראט</option><option value="perPiece"${s.pricing === 'perPiece' ? ' selected' : ''}>מחיר ליחידה</option></select>
      ${inp('price', 'מחיר', 'inputmode="decimal"')}
      <select class="ss-input" data-path="${p}.currency" aria-label="מטבע המחיר">${caseOpts(CASE_CURRENCIES, s.currency, v => v.sym + ' ' + v.he)}</select>
      <select class="ss-input" data-path="${p}.origin" aria-label="מקור האבן">${caseOpts(CASE_STONE_ORIGINS, s.origin)}</select>
    </div>
    <div class="ss-form-grid">
      <select class="ss-input" data-path="${p}.idMethod" data-rerender="1" aria-label="שיטת הזיהוי">${caseOpts(CASE_ID_METHODS, s.idMethod)}</select>
      ${s.idMethod === 'lab' ? inp('lab', 'מעבדה (GIA, IGI...)') + inp('certNo', 'מספר תעודה') : ''}
      ${inp('treatment', 'טיפול (חימום, מילוי...)')}
    </div>
    <div class="ss-form-grid">${inp('shape', 'צורה')}${inp('color', 'צבע')}${inp('clarity', 'ניקיון')}</div>
  </div>`;
}

function caseItemCard(it, i, v, err) {
  const p = `items.${i}`;
  return `<div class="ss-card ss-stack">
    <div class="ss-toolbar"><strong>פריט ${i + 1}</strong>
      <strong data-item-val>${v ? caseMoney(v.valueAg) : `<span class="ss-text-danger">${escapeHtml(err || '')}</span>`}</strong>
      <button class="ss-btn-ghost ss-btn-sm ss-push" data-rm="${p}" aria-label="הסרת פריט ${i + 1}">✕ הסרה</button></div>
    <div class="ss-form-grid">
      ${caseSelect('סוג', p + '.category', CASE_CATEGORIES, it.category)}
      ${caseField('תיאור', p + '.desc', it.desc, 'maxlength="200"')}
    </div>
    <div class="ss-form-grid">
      ${caseField('תיאור באנגלית (לדוח דו-לשוני)', p + '.descEn', it.descEn, 'maxlength="200" dir="ltr"')}
      ${caseField('חותמות וסימנים', p + '.marks', it.marks, 'maxlength="120"')}
    </div>
    <div class="ss-form-grid">
      ${caseField('מידות', p + '.dimensions', it.dimensions, 'maxlength="120"')}
      ${caseField('מצב', p + '.condition', it.condition, 'maxlength="120"')}
    </div>
    <h4 class="ss-section-title">מתכות</h4>
    ${(it.metals || []).map((m, j) => caseMetalRow(m, i, j)).join('')}
    <button class="ss-btn-ghost ss-btn-sm" data-add-metal="${i}">+ מתכת</button>
    <h4 class="ss-section-title">אבנים</h4>
    ${(it.stones || []).map((s, j) => caseStoneRow(s, i, j)).join('')}
    <button class="ss-btn-ghost ss-btn-sm" data-add-stone="${i}">+ אבן</button>
    <div class="ss-form-grid">
      ${caseField('עבודה וייצור (₪)', p + '.labour', it.labour, 'inputmode="decimal"')}
      ${caseField('רכיב אחר (₪)', p + '.other', it.other, 'inputmode="decimal"')}
    </div>
    ${caseField('תיאור הרכיב האחר (למשל: מנגנון השעון)', p + '.otherLabel', it.otherLabel, 'maxlength="80"')}
    <div class="ss-form-grid">
      ${caseField('שווי שנקבע ידנית (₪, רשות)', p + '.override', it.override, 'inputmode="decimal"')}
      ${caseField('נימוק לשווי שנקבע', p + '.overrideReason', it.overrideReason, 'maxlength="300"')}
    </div>
    <h4 class="ss-section-title">תמונות (עד ${CASE_MAX_PHOTOS})</h4>
    <div class="ss-photos">${(it.photos || []).map((id, k) => {
      const src = loadCasePhoto(id);
      return src ? `<figure class="ss-photo"><img src="${src}" alt="תמונה ${k + 1} של פריט ${i + 1}" /><button class="ss-btn-ghost ss-btn-sm" data-rm-photo="${i}.${k}" aria-label="הסרת תמונה ${k + 1}">✕</button></figure>` : '';
    }).join('')}
      ${(it.photos || []).length < CASE_MAX_PHOTOS ? `<button class="ss-btn-ghost ss-btn-sm" data-add-photo="${i}">📷 הוספת תמונה</button>` : ''}
    </div>
  </div>`;
}

function renderCaseEditor() {
  const root = $('#cs-root');
  const c = currentCase();
  if (!root || !c) return;
  const final = c.status === 'final';
  const t = final ? { items: c.frozen.items, errors: [], totalAg: c.frozen.totalAg } : caseTotals(c, state.prices);
  let errAt = 0;
  root.innerHTML = `
    <div class="ss-toolbar">
      <button class="ss-btn-ghost" id="cs-back">‹ לרשימת התיקים</button>
      <strong>תיק ${escapeHtml(caseReportNo(c))} · ${escapeHtml(caseStatusName(c))}</strong>
      <span class="ss-push ss-muted" id="cs-saved"></span>
    </div>
    ${final ? `<div class="ss-hint">התיק נעול: דוח סופי הופק ב-${shortDay(c.reportDate)}. כדי לשנות — "גרסה מתוקנת" (מספר הדוח יקבל סיומת, והגרסה הקודמת נשמרת בהיסטוריה).</div>` : ''}
    ${(c.history || []).length ? `<div class="ss-hint">גרסאות קודמות: ${c.history.map(h => `${escapeHtml(String(c.no) + (h.rev ? '-' + h.rev : ''))} (${shortDay(h.reportDate)}, ${caseMoney(h.totalAg)})`).join(' · ')}</div>` : ''}
    <fieldset class="ss-fieldset ss-stack" ${final ? 'disabled' : ''}>
      <legend class="ss-section-title">הלקוח</legend>
      <div class="ss-form-grid">${caseField('שם מלא', 'client.name', c.client.name, 'maxlength="80"')}${caseField('מספר זהות (רשות)', 'client.idNumber', c.client.idNumber, 'inputmode="numeric" maxlength="9"')}</div>
      <div class="ss-form-grid">${caseField('טלפון', 'client.phone', c.client.phone, 'maxlength="30"')}${caseField('דוא"ל', 'client.email', c.client.email, 'maxlength="80" dir="ltr"')}</div>
      ${caseField('כתובת', 'client.address', c.client.address, 'maxlength="120"')}

      <h3 class="ss-section-title">פרטי השמאות</h3>
      <div class="ss-form-grid">${caseSelect('מטרת השמאות', 'purpose', CASE_PURPOSES, c.purpose)}${caseSelect('בסיס השווי', 'basis', CASE_BASES, c.basis)}</div>
      ${c.purpose === 'other' ? caseField('פירוט המטרה', 'purposeOther', c.purposeOther, 'maxlength="120"') : ''}
      ${CASE_PURPOSES[c.purpose] && CASE_PURPOSES[c.purpose].basis !== c.basis ? `<div class="ss-hint">למטרה "${escapeHtml(CASE_PURPOSES[c.purpose].he)}" מקובל בדרך כלל ${escapeHtml(CASE_BASES[CASE_PURPOSES[c.purpose].basis].he)}.</div>` : ''}
      <div class="ss-hint">${escapeHtml(CASE_BASES[c.basis]?.defHe || '')}</div>
      <div class="ss-form-grid">${caseField('תאריך הבדיקה', 'inspectionDate', c.inspectionDate, `type="date" max="${localToday()}"`)}${caseField('המועד הקובע', 'effectiveDate', c.effectiveDate, `type="date" max="${localToday()}"`)}</div>
      <div class="ss-form-grid">${caseSelect('מטבע הדוח', 'currency', CASE_CURRENCIES, c.currency, v => v.sym + ' ' + v.he)}
        <div class="ss-field"><label class="ss-label" for="cs-f-lang">שפת הדוח</label><select class="ss-input" id="cs-f-lang" data-path="lang"><option value="he"${c.lang !== 'he-en' ? ' selected' : ''}>עברית</option><option value="he-en"${c.lang === 'he-en' ? ' selected' : ''}>עברית ואנגלית</option></select></div></div>

      <h3 class="ss-section-title">היקף העבודה</h3>
      <div class="ss-checks">${Object.entries(CASE_TESTS).map(([k, v]) => `<label class="ss-check"><input type="checkbox" data-test="${k}"${(c.tests || []).includes(k) ? ' checked' : ''} /> ${escapeHtml(v.he)}</label>`).join('')}</div>
      <div class="ss-field"><label class="ss-label" for="cs-f-scopeNote">הערות להיקף העבודה</label><textarea class="ss-input" id="cs-f-scopeNote" data-path="scopeNote" rows="2" maxlength="1000">${caseVal(c.scopeNote)}</textarea></div>

      <h3 class="ss-section-title">הפריטים</h3>
      ${(c.items || []).map((it, i) => caseItemCard(it, i, t.items[i], t.items[i] ? '' : t.errors[errAt++])).join('')}
      <button class="ss-btn-secondary" id="cs-add-item">+ פריט נוסף</button>

      <h3 class="ss-section-title">הנחות ומגבלות</h3>
      <div class="ss-field"><label class="ss-label" for="cs-f-assumptionsHe">בעברית</label><textarea class="ss-input" id="cs-f-assumptionsHe" data-path="assumptionsHe" rows="5" maxlength="3000">${caseVal(c.assumptionsHe)}</textarea></div>
      ${c.lang === 'he-en' ? `<div class="ss-field"><label class="ss-label" for="cs-f-assumptionsEn">באנגלית</label><textarea class="ss-input" id="cs-f-assumptionsEn" data-path="assumptionsEn" rows="5" maxlength="3000" dir="ltr">${caseVal(c.assumptionsEn)}</textarea></div>` : ''}
    </fieldset>
    <div class="ss-card" id="cs-summary">${caseSummaryHtml(c, t)}</div>
    <div class="ss-toolbar">
      <button class="ss-btn-secondary" id="cs-preview">🖨 ${final ? 'הדוח' : 'תצוגת טיוטה'}</button>
      ${final ? '<button class="ss-btn-secondary" id="cs-reopen">✎ גרסה מתוקנת</button>' : '<button class="ss-btn-primary" id="cs-finalize">נעילה והפקת דוח סופי</button>'}
    </div>
    <input type="file" id="cs-photo-file" accept="image/png,image/jpeg,image/webp" hidden />`;
  attachCaseEditor(c);
}

function caseSummaryHtml(c, t) {
  const rc = c.status === 'final' && c.frozen ? c.frozen.reportTotal : caseFromIlsAg(t.totalAg, c.currency, state.prices);
  return `<div class="ss-row ss-row-big"><span>סך השווי</span><strong>${caseMoney(t.totalAg)}</strong></div>
    ${c.currency !== 'ILS' ? `<div class="ss-row"><span>במטבע הדוח</span><strong>${rc === null ? 'חסר שער' : caseMoney(rc, c.currency)}</strong></div>` : ''}
    ${c.status !== 'final' ? priceWarningsFor(c).map(w => `<div class="ss-text-danger">⚠ ${escapeHtml(w)}</div>`).join('') : ''}`;
}

// מחירים ישנים או שלא עודכנו מעולם — מאלה שהתיק משתמש בהם
function priceWarningsFor(c) {
  return casePriceKeys(c).map(k => ({ k, f: priceFreshness(state.prices, k) })).filter(x => x.f.state !== 'fresh')
    .map(x => `${PRICE_FIELDS.find(f => f.k === x.k)?.name || x.k}: ${priceAgeLabel(x.f)}`);
}

function caseSetPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) { o = o[parts[i]]; if (o === undefined || o === null) return; }
  o[parts[parts.length - 1]] = value;
}

function caseGetPath(obj, path) {
  return path.split('.').reduce((o, k) => (o === undefined || o === null ? o : o[k]), obj);
}

function caseAutosave(c, rerender) {
  clearTimeout(CASE_UI.saveTimer);
  CASE_UI.pending = null;
  storeCase(c);
  const s = $('#cs-saved');
  if (s) s.textContent = 'נשמר ✓';
  if (rerender) { renderCaseEditor(); return; }
  const t = caseTotals(c, state.prices);
  const sum = $('#cs-summary');
  if (sum) sum.innerHTML = caseSummaryHtml(c, t);
  let errAt = 0;
  $$('#cs-root [data-item-val]').forEach((el, i) => {
    el.innerHTML = t.items[i] ? caseMoney(t.items[i].valueAg) : `<span class="ss-text-danger">${escapeHtml(t.errors[errAt++] || '')}</span>`;
  });
}

function attachCaseEditor(c) {
  const root = $('#cs-root');
  $('#cs-back').onclick = () => {
    if (CASE_UI.pending) caseAutosave(CASE_UI.pending, false);
    CASE_UI.editId = null;
    renderCasesView();
  };
  $('#cs-preview').onclick = () => showCaseReport(currentCase());
  $('#cs-finalize') && ($('#cs-finalize').onclick = () => finalizeCurrentCase());
  $('#cs-reopen') && ($('#cs-reopen').onclick = async () => {
    if (!(await ssDialog.confirm(`לפתוח גרסה מתוקנת של תיק ${caseReportNo(c)}? הדוח שכבר הופק נשמר בהיסטוריה, והדוח החדש יקבל את המספר ${c.no}-${(c.rev || 0) + 1}.`, { okText: 'גרסה מתוקנת' }))) return;
    storeCase(reopenCase(c));
    renderCaseEditor();
  });
  if (CASE_UI.detach) CASE_UI.detach();
  CASE_UI.detach = null;
  if (c.status === 'final') return;

  const onField = (e) => {
    const el = e.target;
    const cur = currentCase();
    if (!cur) return;
    if (el.dataset.test) {
      const set = new Set(cur.tests || []);
      if (el.checked) set.add(el.dataset.test); else set.delete(el.dataset.test);
      cur.tests = Object.keys(CASE_TESTS).filter(k => set.has(k));
      caseAutosave(cur, false);
      return;
    }
    const path = el.dataset.path;
    if (!path) return;
    caseSetPath(cur, path, el.dataset.num ? Number(el.value) : el.value);
    // החלפת מתכת ← טוהר ברירת מחדל של המתכת החדשה
    if (/\.metal$/.test(path)) caseSetPath(cur, path.replace(/metal$/, 'purityPpt'), CASE_DEFAULT_PURITY[el.value]);
    // מטרה ← בסיס השווי המקובל לה (אפשר לשנות אחר כך)
    if (path === 'purpose' && CASE_PURPOSES[el.value]) cur.basis = CASE_PURPOSES[el.value].basis;
    const structural = el.tagName === 'SELECT' && (el.dataset.rerender || ['purpose', 'basis', 'lang', 'currency'].includes(path));
    clearTimeout(CASE_UI.saveTimer);
    if (structural) { caseAutosave(cur, true); return; }
    CASE_UI.pending = cur;
    CASE_UI.saveTimer = setTimeout(() => caseAutosave(cur, false), 400);
  };
  // רשימה, תיבת סימון ותאריך — באירוע change בלבד (אחרת השינוי נרשם פעמיים); טקסט — בכל הקשה
  const isChange = (el) => el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'date';
  const onInput = (e) => { if (!isChange(e.target)) onField(e); };
  const onChange = (e) => { if (isChange(e.target)) onField(e); };
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  // root נשאר בין ציורים — המאזינים מוסרים לפני הציור הבא
  CASE_UI.detach = () => { root.removeEventListener('input', onInput); root.removeEventListener('change', onChange); };

  $('#cs-add-item').onclick = () => {
    const cur = currentCase();
    if (cur.items.length >= CASE_MAX_ITEMS) { toast(`עד ${CASE_MAX_ITEMS} פריטים בתיק`, 'error'); return; }
    cur.items.push(newCaseItem());
    caseAutosave(cur, true);
  };
  $$('#cs-root [data-add-metal]').forEach(b => b.onclick = () => {
    const cur = currentCase(); const it = cur.items[Number(b.dataset.addMetal)];
    if (it.metals.length >= CASE_MAX_METALS) return;
    it.metals.push({ metal: 'gold', purityPpt: 585, grams: '' });
    caseAutosave(cur, true);
  });
  $$('#cs-root [data-add-stone]').forEach(b => b.onclick = () => {
    const cur = currentCase(); const it = cur.items[Number(b.dataset.addStone)];
    if (it.stones.length >= CASE_MAX_STONES) return;
    it.stones.push(newCaseStone());
    caseAutosave(cur, true);
  });
  $$('#cs-root [data-rm]').forEach(b => b.onclick = async () => {
    const cur = currentCase();
    const path = b.dataset.rm;
    const parts = path.split('.');
    const idx = Number(parts.pop());
    const arr = caseGetPath(cur, parts.join('.'));
    if (!Array.isArray(arr)) return;
    if (parts.length === 1) {
      if (!(await ssDialog.confirm(`להסיר את פריט ${idx + 1} ואת התמונות שלו?`, { danger: true, okText: 'הסרה' }))) return;
      deleteCasePhotos(arr[idx].photos);
    }
    arr.splice(idx, 1);
    if (parts.length === 1 && !arr.length) arr.push(newCaseItem());
    caseAutosave(cur, true);
  });
  $$('#cs-root [data-rm-photo]').forEach(b => b.onclick = () => {
    const cur = currentCase();
    const [i, k] = b.dataset.rmPhoto.split('.').map(Number);
    const [id] = cur.items[i].photos.splice(k, 1);
    deleteCasePhotos([id]);
    caseAutosave(cur, true);
  });
  const fileInput = $('#cs-photo-file');
  $$('#cs-root [data-add-photo]').forEach(b => b.onclick = () => { fileInput.dataset.item = b.dataset.addPhoto; fileInput.click(); });
  fileInput.onchange = async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const dataUrl = await caseCompressImage(file);
      const cur = currentCase();
      const it = cur.items[Number(fileInput.dataset.item)];
      if (!it || it.photos.length >= CASE_MAX_PHOTOS) return;
      it.photos.push(saveCasePhoto(dataUrl));
      caseAutosave(cur, true);
    } catch (e) {
      toast('התמונה לא נשמרה: ' + e.message, 'error');
    }
  };
}

// הקטנת תמונה: עד 1200 פיקסלים בצד הארוך, JPEG, ואיכות יורדת עד שנכנסים למגבלה
function caseCompressImage(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { reject(new Error('סוג קובץ לא נתמך')); return; }
    if (file.size > 25 * 1024 * 1024) { reject(new Error('הקובץ גדול מדי')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('הקובץ לא נקרא'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('הקובץ אינו תמונה תקינה'));
      img.onload = () => {
        const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        for (const q of [0.82, 0.7, 0.55, 0.4]) {
          const out = canvas.toDataURL('image/jpeg', q);
          if (out.length <= CASE_MAX_PHOTO_CHARS) { resolve(out); return; }
        }
        reject(new Error('התמונה גדולה מדי גם אחרי הקטנה'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function finalizeCurrentCase() {
  const c = currentCase();
  if (!c) return;
  const problems = caseFinalizeProblems(c, state.prices);
  if (problems.length) {
    await ssDialog.alert('לפני הפקת דוח סופי יש להשלים:\n\n' + problems.slice(0, 12).join('\n') + (problems.length > 12 ? `\n...ועוד ${problems.length - 12}` : ''));
    return;
  }
  const warn = priceWarningsFor(c);
  const total = caseTotals(c, state.prices).totalAg;
  const msg = `לנעול את תיק ${caseReportNo(c)} ולהפיק דוח סופי על סך ${caseMoney(total)}?\nאחרי הנעילה המחירים והערכים קבועים, ושינוי יוצר גרסה מתוקנת.`
    + (warn.length ? `\n\nלתשומת לב — מחירים לא עדכניים:\n${warn.join('\n')}` : '');
  if (!(await ssDialog.confirm(msg, { okText: 'נעילה והפקה' }))) return;
  try {
    const f = finalizeCase(c, state.prices);
    storeCase(f);
    toast(`דוח ${caseReportNo(f)} הופק ✓`, 'success');
    renderCaseEditor();
    showCaseReport(f);
  } catch (e) {
    await ssDialog.alert(e.message);
  }
}
