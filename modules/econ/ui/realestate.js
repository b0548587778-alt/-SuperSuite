// ממשק המודול הכלכלי — שמאות מקרקעין.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

// ============================================================
// שמאות מקרקעין — רשימת תיקי שומה, ועורך תיק: מזמין ומטרה, נכס, עסקאות השוואה (הקלדה או קובץ CSV),
// טבלת התאמות, גישת ההכנסות והעלות, שקלול, נעילה ודוח PDF. כל החישובים בצד הראשי (realestate:*).
// בממשק הסכומים בשקלים והאחוזים כטקסט; השרת ממיר לאגורות ולנקודות בסיס.
// ============================================================
const RE_ADJ_COLS = ['time', 'location', 'size', 'floor', 'condition', 'age', 'view', 'parking', 'rights', 'other'];

function reState() {
  if (!state.re) state.re = { caseId: null, current: null, form: null, filter: '', tab: 'case', importPreview: null, importText: '', importSource: '' };
  return state.re;
}

const reShekel = (ag) => (ag === null || ag === undefined ? '' : String(ag / 100));
const rePct = (bp) => (bp === null || bp === undefined || bp === 0 ? '' : String(bp / 100));
const reStr = (v) => (v === null || v === undefined ? '' : String(v));
const reMoney = (ag) => (ag === null || ag === undefined ? '—' : '₪' + Math.round(ag / 100).toLocaleString('he-IL'));
const reBp = (bp) => `${bp > 0 ? '+' : ''}${(bp / 100).toLocaleString('he-IL', { maximumFractionDigits: 2 })}%`;

// תיק שמור ← טופס עריכה (שקלים ואחוזים כטקסט; התאמות לפי סוג)
function reToForm(c) {
  const p = c.property || {};
  return {
    client: { ...c.client },
    purpose: c.purpose, purposeOther: c.purposeOther || '', visitDate: c.visitDate, effectiveDate: c.effectiveDate,
    property: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, reStr(v)])),
    comparables: (c.comparables || []).map(x => {
      const adj = {};
      for (const a of x.adjustments || []) adj[a.factor] = { pct: rePct(a.bp), note: a.note || '' };
      return { id: x.id, date: x.date, price: reShekel(x.priceAg), area: reStr(x.area), address: x.address || '', city: x.city || '',
        block: x.block || '', parcel: x.parcel || '', subParcel: x.subParcel || '', rooms: reStr(x.rooms), floor: reStr(x.floor),
        yearBuilt: reStr(x.yearBuilt), source: x.source || '', notes: x.notes || '', included: x.included !== false, weight: reStr(x.weight), adj };
    }),
    income: { enabled: !!c.income.enabled, monthlyRent: reShekel(c.income.monthlyRentAg), vacancyPct: rePct(c.income.vacancyBp),
      annualExpenses: c.income.annualExpensesAg ? reShekel(c.income.annualExpensesAg) : '', capRatePct: rePct(c.income.capRateBp), note: c.income.note || '' },
    cost: { enabled: !!c.cost.enabled, land: c.cost.landAg ? reShekel(c.cost.landAg) : '', buildArea: reStr(c.cost.buildArea),
      costPerSqm: reShekel(c.cost.costPerSqmAg), profitPct: rePct(c.cost.profitBp), depreciationPct: rePct(c.cost.depreciationBp), note: c.cost.note || '' },
    reconcile: { weights: Object.fromEntries(Object.entries(c.reconcile.weights || {}).map(([k, v]) => [k, v ? String(v) : ''])),
      roundToIls: String(c.reconcile.roundToIls), override: reShekel(c.reconcile.overrideAg), overrideReason: c.reconcile.overrideReason || '', note: c.reconcile.note || '' },
    assumptions: c.assumptions || '',
    reportLang: c.reportLang || 'he',
  };
}

// טופס ← קלט לשרת
function reFromForm(f) {
  return {
    client: f.client, purpose: f.purpose, purposeOther: f.purposeOther, visitDate: f.visitDate, effectiveDate: f.effectiveDate,
    property: f.property,
    comparables: f.comparables.map(x => {
      const { adj, ...rest } = x;
      return { ...rest, adjustments: RE_ADJ_COLS.filter(k => adj[k] && String(adj[k].pct).trim() !== '').map(k => ({ factor: k, pct: adj[k].pct, note: adj[k].note || '' })) };
    }),
    income: f.income, cost: f.cost, reconcile: f.reconcile, assumptions: f.assumptions, reportLang: f.reportLang,
  };
}

const rePath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
function reSet(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) { if (o[k] == null) o[k] = {}; o = o[k]; }
  o[keys[keys.length - 1]] = value;
}

// קריאת כל השדות מהמסך לטופס
function reCollect() {
  const re = reState();
  if (!re.form) return;
  document.querySelectorAll('[data-re]').forEach(el => reSet(re.form, el.dataset.re, el.type === 'checkbox' ? el.checked : el.value));
}

function reInput(path, label, { type = 'text', wide = false, attrs = '' } = {}) {
  const v = rePath(reState().form, path);
  const ro = reState().current && reState().current.case.status === 'final' ? ' disabled' : '';
  if (type === 'textarea') return `<label class="ss-field${wide ? ' ss-wide' : ''}"><span class="ss-label">${esc(label)}</span><textarea class="ss-input" data-re="${path}" rows="3"${ro}>${esc(v)}</textarea></label>`;
  return `<label class="ss-field${wide ? ' ss-wide' : ''}"><span class="ss-label">${esc(label)}</span><input class="ss-input" type="${type}" data-re="${path}" value="${esc(v)}"${attrs}${ro}></label>`;
}
function reSelect(path, label, map) {
  const v = rePath(reState().form, path);
  const ro = reState().current && reState().current.case.status === 'final' ? ' disabled' : '';
  return `<label class="ss-field"><span class="ss-label">${esc(label)}</span><select class="ss-input" data-re="${path}"${ro}>${Object.entries(map).map(([k, l]) => `<option value="${esc(k)}"${v === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
}
function reCheck(path, label) {
  const ro = reState().current && reState().current.case.status === 'final' ? ' disabled' : '';
  return `<label class="ss-check"><input type="checkbox" data-re="${path}"${rePath(reState().form, path) ? ' checked' : ''}${ro}> ${esc(label)}</label>`;
}

// ----- רשימת התיקים -----
function reListHtml(o) {
  const re = reState();
  const q = re.filter.trim();
  const cases = (o.cases || []).filter(c => !q || [c.client, c.address, c.block, c.parcel, c.reportNo].join(' ').includes(q));
  const rows = cases.map(c => `<tr>
      <td>${esc(c.reportNo)}</td><td>${esc(c.client) || '<span class="ss-muted">—</span>'}</td><td>${esc(c.address) || '—'}</td>
      <td>${c.block ? `${esc(c.block)}/${esc(c.parcel)}` : '—'}</td><td>${esc(c.purpose || '')}</td>
      <td>${c.status === 'final' ? '<span class="ss-badge ss-badge-success">🔒 נעול</span>' : '<span class="ss-badge">טיוטה</span>'}</td>
      <td>${reMoney(c.valueAg)}${c.warnings ? ` <small class="ss-muted">⚠ ${c.warnings}</small>` : ''}</td>
      <td><button class="ss-btn-secondary ss-btn-sm" data-re-open="${esc(c.id)}">פתיחה</button></td>
    </tr>`).join('');
  return `
    <div class="ss-page-head"><span>שמאות מקרקעין לפי עסקאות השוואה שהשמאי מקליד או מייבא מקובץ — בלי חיבור לרשת. השווי והאחריות המקצועית — של השמאי.</span>
      <span class="ss-actions"><button class="ss-btn-primary" id="reNew">＋ תיק שומה חדש</button> <button class="ss-btn-secondary" id="reSettingsBtn">פרטי השמאי</button>${(o.cases || []).length ? ' <button class="ss-btn-secondary" id="reRegister" title="כל התיקים לקובץ CSV">⬇ יומן שומות</button>' : ''}</span></div>
    <div class="ss-card">
      <label class="ss-field"><span class="ss-label">חיפוש</span><input class="ss-input" type="search" id="reFilter" value="${esc(re.filter)}" placeholder="מזמין, כתובת, גוש או מספר דוח"></label>
      ${cases.length ? `<div class="ss-scroll"><table class="ss-table">
        <thead><tr><th>דוח</th><th>מזמין</th><th>נכס</th><th>גוש/חלקה</th><th>מטרה</th><th>מצב</th><th>שווי</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : renderEmpty(q ? 'לא נמצאו תיקים — נסו חיפוש אחר' : 'אין עדיין תיקי שומה — פתחו תיק ראשון בכפתור "תיק שומה חדש"', '🏘')}
    </div>`;
}

function reSettingsHtml(o) {
  const s = o.settings || {};
  const f = (k, l) => `<label class="ss-field"><span class="ss-label">${esc(l)}</span><input class="ss-input" type="text" data-re-set="${k}" value="${esc(s[k])}"></label>`;
  return `
    <div class="ss-page-head"><span>פרטי השמאי מופיעים בכל דוח שומה.</span><button class="ss-btn-secondary" id="reBack">→ חזרה לרשימה</button></div>
    <div class="ss-card ss-form-grid">
      ${f('name', 'שם השמאי')} ${f('license', 'מספר רישיון')} ${f('office', 'שם המשרד')} ${f('phone', 'טלפון')} ${f('email', 'דוא"ל')} ${f('address', 'כתובת המשרד')}
      <h3 class="ss-section-title">לדוח בעברית ובאנגלית</h3>
      ${f('nameEn', 'שם השמאי באנגלית')} ${f('officeEn', 'שם המשרד באנגלית')} ${f('addressEn', 'כתובת המשרד באנגלית')}
      <label class="ss-field ss-wide"><span class="ss-label">הצהרה באנגלית (ריק — נוסח ברירת המחדל)</span><textarea class="ss-input" data-re-set="declarationEn" rows="3" dir="ltr">${esc(s.declarationEn)}</textarea></label>
      <label class="ss-field ss-wide"><span class="ss-label">הצהרת השמאי (ריק — נוסח ברירת המחדל)</span><textarea class="ss-input" data-re-set="declaration" rows="3">${esc(s.declaration)}</textarea></label>
      <div class="ss-wide"><button class="ss-btn-primary" id="reSaveSettings">שמירה</button></div>
    </div>`;
}

// ----- עורך התיק -----
function reCompsHtml(f, lists, rows, final) {
  const ro = final ? ' disabled' : '';
  const cell = (i, k, label, type = 'text') => `<td><input class="ss-input" type="${type}" data-re="comparables.${i}.${k}" value="${esc(f.comparables[i][k])}" aria-label="${esc(label)} — עסקה ${i + 1}"${ro}></td>`;
  const res = (i) => rows.find(r => r.n === i + 1);
  const basic = f.comparables.map((c, i) => `<tr class="${c.included ? '' : 'ss-muted'}">
      <td>${i + 1}</td>
      <td><input type="checkbox" data-re="comparables.${i}.included"${c.included ? ' checked' : ''} aria-label="בחישוב — עסקה ${i + 1}"${ro}></td>
      ${cell(i, 'date', 'תאריך', 'date')}${cell(i, 'address', 'כתובת')}${cell(i, 'block', 'גוש')}${cell(i, 'parcel', 'חלקה')}
      ${cell(i, 'price', 'מחיר ₪')}${cell(i, 'area', 'שטח מ"ר')}${cell(i, 'rooms', 'חדרים')}${cell(i, 'floor', 'קומה')}${cell(i, 'yearBuilt', 'שנת בנייה')}
      ${cell(i, 'source', 'מקור')}${cell(i, 'weight', 'משקל %')}
      <td>${final ? '' : `<button class="ss-btn-secondary ss-btn-sm" data-re-delcomp="${i}" title="הסרת העסקה">✕</button>`}</td>
    </tr>`).join('');
  const adj = f.comparables.map((c, i) => {
    const r = res(i);
    return `<tr class="${c.included ? '' : 'ss-muted'}"><td>${i + 1}</td><td>${r ? reMoney(r.perSqmAg) : '—'}</td>
      ${RE_ADJ_COLS.map(k => `<td><input class="ss-input" type="text" data-re="comparables.${i}.adj.${k}.pct" value="${esc(c.adj[k] ? c.adj[k].pct : '')}" aria-label="התאמת ${esc(lists.factors[k])} באחוזים — עסקה ${i + 1}" inputmode="decimal" dir="ltr"${ro}></td>`).join('')}
      <td>${r ? `<bdi dir="ltr">${reBp(r.netBp)}</bdi>` : '—'}</td><td>${r ? (r.grossBp / 100) + '%' : '—'}</td><td><b>${r ? reMoney(r.adjustedPerSqmAg) : '—'}</b></td></tr>`;
  }).join('');
  return `
    <div class="ss-page-head"><h3 class="ss-section-title">עסקאות השוואה (${f.comparables.length})</h3>
      ${final ? '' : '<span class="ss-actions"><button class="ss-btn-secondary" id="reAddComp">＋ עסקה</button> <button class="ss-btn-secondary" id="reImport">⬆ ייבוא מקובץ CSV</button></span>'}</div>
    <p class="ss-hint">מחיר בשקלים, שטח במ"ר. מקור — למשל מאגר העסקאות שממנו הועתקה העסקה. משקל — ריק בכל העסקאות = ממוצע פשוט.</p>
    ${f.comparables.length ? `<div class="ss-scroll"><table class="ss-table ss-table-edit">
      <thead><tr><th>#</th><th>בחישוב</th><th>תאריך</th><th>כתובת</th><th>גוש</th><th>חלקה</th><th>מחיר ₪</th><th>שטח</th><th>חדרים</th><th>קומה</th><th>שנת בנייה</th><th>מקור</th><th>משקל %</th><th></th></tr></thead>
      <tbody>${basic}</tbody></table></div>
      <h4 class="ss-section-title">טבלת התאמות (באחוזים, + מעלה את מחיר העסקה, − מוריד)</h4>
      <div class="ss-scroll"><table class="ss-table ss-table-edit">
      <thead><tr><th>#</th><th>מחיר למ"ר</th>${RE_ADJ_COLS.map(k => `<th>${esc(lists.factors[k])}</th>`).join('')}<th>נטו</th><th>גולמי</th><th>מותאם למ"ר</th></tr></thead>
      <tbody>${adj}</tbody></table></div>` : renderEmpty('אין עדיין עסקאות השוואה — הוסיפו עסקה או ייבאו קובץ', '🏘')}
    ${reState().importPreview ? reImportPreviewHtml(reState().importPreview) : ''}`;
}

function reImportPreviewHtml(p) {
  return `<div class="ss-card ss-card-info">
    <h4 class="ss-section-title">תצוגה מקדימה של הייבוא</h4>
    <div class="ss-row"><span>שורות שזוהו</span><span>${p.found}</span></div>
    <div class="ss-row"><span>כפולות (כבר בתיק)</span><span>${p.duplicates}</span></div>
    <div class="ss-row"><span>יתווספו</span><span><b>${p.added}</b>${p.skipped ? ` <small class="ss-muted">(${p.skipped} מעבר למגבלה)</small>` : ''}</span></div>
    ${p.errors.length ? `<details><summary>⚠ ${p.errors.length} שורות שלא נקלטו</summary>${p.errors.map(e => `<div class="ss-row ss-muted">${esc(typeof e === 'string' ? e : (e.line ? `שורה ${e.line}: ` : '') + (e.error || ''))}</div>`).join('')}</details>` : ''}
    ${p.preview.length ? `<div class="ss-scroll"><table class="ss-table"><thead><tr><th>תאריך</th><th>כתובת</th><th>מחיר</th><th>שטח</th></tr></thead>
      <tbody>${p.preview.map(x => `<tr><td>${esc(x.date)}</td><td>${esc([x.address, x.city].filter(Boolean).join(', '))}</td><td>${reMoney(x.priceAg)}</td><td>${esc(x.area)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="ss-toolbar"><button class="ss-btn-primary" id="reImportApply"${p.added ? '' : ' disabled'}>הוספת ${p.added} עסקאות</button> <button class="ss-btn-secondary" id="reImportCancel">ביטול</button></div>
  </div>`;
}

function reResultsHtml(r, lists) {
  if (!r) return '';
  const s = r.sales || {}, inc = r.income || {}, cost = r.cost || {}, fin = r.final || {};
  const line = (l, v, cls = '') => `<div class="ss-row ${cls}"><span>${esc(l)}</span><span>${v}</span></div>`;
  return `
    <div class="ss-grid">
      <div class="ss-card"><h4 class="ss-section-title">${esc(lists.approaches.sales)}</h4>
        ${s.ok ? line('עסקאות בחישוב', s.stats.count) + line('טווח מותאם למ"ר', `${reMoney(s.stats.minAg)} – ${reMoney(s.stats.maxAg)}`) + line('חציון מותאם למ"ר', reMoney(s.stats.medianAg))
          + line(s.stats.weighted ? 'ממוצע משוקלל למ"ר' : 'ממוצע למ"ר', reMoney(s.perSqmAg)) + line(`שווי (× ${s.area} מ"ר)`, reMoney(s.valueAg), 'ss-row-total') : '<div class="ss-row ss-muted">אין תוצאה</div>'}</div>
      <div class="ss-card"><h4 class="ss-section-title">${esc(lists.approaches.income)}</h4>
        ${inc.ok ? line('הכנסה שנתית', reMoney(inc.grossAg)) + line('אחרי אי-תפוסה', reMoney(inc.effectiveAg)) + line('הכנסה נטו (NOI)', reMoney(inc.noiAg)) + line('שווי', reMoney(inc.valueAg), 'ss-row-total') : '<div class="ss-row ss-muted">לא בשימוש</div>'}</div>
      <div class="ss-card"><h4 class="ss-section-title">${esc(lists.approaches.cost)}</h4>
        ${cost.ok ? line('עלות הקמה', reMoney(cost.buildAg)) + line('עם רווח יזמי', reMoney(cost.withProfitAg)) + line('אחרי פחת', reMoney(cost.depreciatedAg)) + line('קרקע', reMoney(cost.landAg)) + line('שווי', reMoney(cost.valueAg), 'ss-row-total') : '<div class="ss-row ss-muted">לא בשימוש</div>'}</div>
      <div class="ss-card"><h4 class="ss-section-title">שקלול ושווי סופי</h4>
        ${fin.ok ? Object.entries(fin.weights).map(([k, w]) => line(lists.approaches[k], Math.round(w * 100) / 100 + '%')).join('') + line('לפני עיגול', reMoney(fin.rawAg))
          + line('שווי השומה', reMoney(fin.valueAg), 'ss-row-big') + (fin.perSqmAg ? line('למ"ר', reMoney(fin.perSqmAg)) : '') : '<div class="ss-row ss-muted">אין עדיין שווי</div>'}</div>
    </div>
    ${reSensitivityHtml(r.sensitivity, lists)}
    ${(r.warnings || []).length ? `<div class="ss-card ss-card-warning"><h4 class="ss-section-title">⚠ לתשומת לב השמאי</h4>${r.warnings.map(w => `<div class="ss-row">${esc(w)}</div>`).join('')}
      <small class="ss-muted">ספי האזהרה הם של התוכנה ולא דרישה של תקן.</small></div>` : ''}`;
}

// ניתוח רגישות — לבחינה בלבד: שווי בגישת ההכנסות לפי שיעורי היוון סביב השיעור שנבחר, וטווח לפי עסקאות ההשוואה
function reSensitivityHtml(sens, lists) {
  if (!sens || (!sens.income && !sens.sales)) return '';
  const line = (l, v, cls = '') => `<div class="ss-row ${cls}"><span>${l}</span><span>${v}</span></div>`;
  const pctTxt = (bp) => (bp / 100).toLocaleString('he-IL', { maximumFractionDigits: 2 }) + '%';
  return `<div class="ss-card ss-card-info"><h4 class="ss-section-title">ניתוח רגישות</h4>
    <div class="ss-grid">
      ${sens.income ? `<div><div class="ss-hint">${esc(lists.approaches.income)} — שיעור היוון ← שווי</div>
        ${sens.income.map(x => line(`<bdi dir="ltr">${pctTxt(x.capRateBp)}</bdi>${x.base ? ' <span class="ss-badge ss-badge-info">נבחר</span>' : ''}`, reMoney(x.valueAg), x.base ? 'ss-row-total' : '')).join('')}</div>` : ''}
      ${sens.sales ? `<div><div class="ss-hint">${esc(lists.approaches.sales)} — טווח לפי המחיר המותאם למ"ר × השטח</div>
        ${line('נמוך', reMoney(sens.sales.lowAg))}${line('חציון', reMoney(sens.sales.medianAg))}${line('גבוה', reMoney(sens.sales.highAg))}</div>` : ''}
    </div>
    <small class="ss-muted">לבחינה בלבד — לא משנה את שווי השומה. השלבים בשיעור ההיוון הם בחירה של התוכנה, לא דרישה של תקן.</small></div>`;
}

function reEditorHtml(o) {
  const re = reState();
  const { case: c, result, problems } = re.current;
  const f = re.form;
  const lists = o.lists || {};
  const final = c.status === 'final';
  const no = String(c.no) + (c.rev ? '-' + c.rev : '');
  return `
    <div class="ss-page-head"><span><button class="ss-btn-secondary" id="reBack">→ לרשימה</button> <b>תיק שומה ${esc(no)}</b> ${final ? '<span class="ss-badge ss-badge-success">🔒 נעול — לשינוי פותחים גרסה מתוקנת</span>' : '<span class="ss-badge ss-badge-warning">טיוטה</span>'}</span>
      <span class="ss-actions">
        ${final ? '<button class="ss-btn-secondary" id="reReopen">פתיחת גרסה מתוקנת</button>' : '<button class="ss-btn-primary" id="reSave">שמירה וחישוב</button> <button class="ss-btn-secondary" id="reFinalize">🔒 נעילת השומה</button>'}
        <button class="ss-btn-secondary" id="reExport">⬇ דוח PDF${final ? '' : ' (טיוטה)'}</button>
        ${final ? '' : '<button class="ss-btn-secondary" id="reDelete">מחיקה</button>'}
      </span></div>
    ${!final && problems && problems.length ? `<div class="ss-card ss-card-warning"><b>לפני נעילה חסר:</b> ${problems.map(esc).join(' · ')}</div>` : ''}
    <div class="ss-card ss-form-grid"><h3 class="ss-section-title">מזמין ומטרה</h3>
      ${reInput('client.name', 'שם המזמין')} ${reInput('client.idNumber', 'ת.ז / ח.פ')} ${reInput('client.phone', 'טלפון', { type: 'tel' })} ${reInput('client.email', 'דוא"ל', { type: 'email' })}
      ${reInput('client.address', 'כתובת המזמין')}
      ${reSelect('purpose', 'מטרת השומה', lists.purposes || {})} ${f.purpose === 'other' ? reInput('purposeOther', 'פירוט המטרה') : ''}
      ${reInput('visitDate', 'תאריך הביקור', { type: 'date' })} ${reInput('effectiveDate', 'המועד הקובע', { type: 'date' })}
      ${reSelect('reportLang', 'שפת הדוח', { he: 'עברית', 'he-en': 'עברית ואנגלית' })}
    </div>
    <div class="ss-card ss-form-grid"><h3 class="ss-section-title">הנכס</h3>
      ${reInput('property.address', 'כתובת')} ${reInput('property.city', 'יישוב')}
      ${reInput('property.block', 'גוש')} ${reInput('property.parcel', 'חלקה')} ${reInput('property.subParcel', 'תת-חלקה')}
      ${reSelect('property.type', 'סוג הנכס', lists.types || {})} ${reSelect('property.rights', 'הזכויות', lists.rights || {})} ${reSelect('property.condition', 'מצב', lists.conditions || {})}
      ${reInput('property.area', 'שטח בנוי (מ"ר)')} ${reInput('property.equivArea', 'שטח אקוויוולנטי (מ"ר, רשות)')} ${reInput('property.landArea', 'שטח קרקע (מ"ר)')}
      ${reInput('property.rooms', 'חדרים')} ${reInput('property.floor', 'קומה')} ${reInput('property.floors', 'קומות בבניין')} ${reInput('property.yearBuilt', 'שנת בנייה')}
      ${reInput('property.parking', 'חניה')} ${reInput('property.storage', 'מחסן')}
      ${reInput('property.description', 'תיאור הנכס', { type: 'textarea', wide: true })}
      ${reInput('property.environment', 'הסביבה', { type: 'textarea', wide: true })}
      ${reInput('property.planning', 'מצב תכנוני (תוכניות, היתרים)', { type: 'textarea', wide: true })}
      ${reInput('property.legal', 'מצב משפטי (רישום, הערות, שעבודים)', { type: 'textarea', wide: true })}
      ${reInput('property.considerations', 'גורמים ושיקולים', { type: 'textarea', wide: true })}
    </div>
    <div class="ss-card">${reCompsHtml(f, lists, (result && result.sales && result.sales.rows) || [], final)}</div>
    <div class="ss-grid">
      <div class="ss-card ss-form-grid"><h3 class="ss-section-title">${esc((lists.approaches || {}).income || '')}</h3>
        ${reCheck('income.enabled', 'בשימוש')}
        ${reInput('income.monthlyRent', 'שכר דירה חודשי (₪)')} ${reInput('income.vacancyPct', 'אי-תפוסה (%)')} ${reInput('income.annualExpenses', 'הוצאות שנתיות (₪)')} ${reInput('income.capRatePct', 'שיעור היוון (%)')}
        ${reInput('income.note', 'הסבר', { type: 'textarea', wide: true })}</div>
      <div class="ss-card ss-form-grid"><h3 class="ss-section-title">${esc((lists.approaches || {}).cost || '')}</h3>
        ${reCheck('cost.enabled', 'בשימוש')}
        ${reInput('cost.land', 'שווי הקרקע (₪)')} ${reInput('cost.buildArea', 'שטח לחישוב (מ"ר; ריק — שטח הנכס)')} ${reInput('cost.costPerSqm', 'עלות הקמה למ"ר (₪)')}
        ${reInput('cost.profitPct', 'רווח יזמי (%)')} ${reInput('cost.depreciationPct', 'פחת (%)')}
        ${reInput('cost.note', 'הסבר', { type: 'textarea', wide: true })}</div>
    </div>
    <div class="ss-card ss-form-grid"><h3 class="ss-section-title">שקלול</h3>
      ${reInput('reconcile.weights.sales', 'משקל גישת ההשוואה (%)')} ${reInput('reconcile.weights.income', 'משקל גישת ההכנסות (%)')} ${reInput('reconcile.weights.cost', 'משקל גישת העלות (%)')}
      ${reSelect('reconcile.roundToIls', 'עיגול', { 0: 'בלי עיגול', 100: 'ל-100 ₪', 1000: 'ל-1,000 ₪', 5000: 'ל-5,000 ₪', 10000: 'ל-10,000 ₪' })}
      ${reInput('reconcile.override', 'שווי סופי שנקבע ידנית (₪, רשות)')} ${reInput('reconcile.overrideReason', 'נימוק לשווי הידני')}
      ${reInput('reconcile.note', 'הסבר השקלול', { type: 'textarea', wide: true })}
      ${reInput('assumptions', 'הנחות והסתייגויות (שורה לכל הנחה)', { type: 'textarea', wide: true })}
    </div>
    ${rePhotosHtml(re.current.photos || [], final)}
    ${reResultsHtml(result, lists)}
    ${(c.history || []).length ? `<details class="ss-card"><summary>היסטוריית גרסאות (${c.history.length})</summary>${c.history.map(h => `<div class="ss-row"><span>דוח ${esc(String(c.no) + (h.rev ? '-' + h.rev : ''))}</span><span>${esc(h.reportDate || '')} · ${reMoney(h.valueAg)}</span></div>`).join('')}</details>` : ''}`;
}

// צילומים לתיק: מוקטנים בממשק (עד 1200 פיקסלים, JPEG) לפני השליחה; השרת בודק שוב סוג וגודל
const RE_PHOTO_MAX_CHARS = 280000;
function rePhotosHtml(photos, final) {
  const cards = photos.map(p => `<figure class="ss-photo"><img src="${esc(p.data)}" alt="${esc(p.caption || 'צילום')}">
      <figcaption>${esc(p.caption || '')}</figcaption>
      ${final ? '' : `<button class="ss-btn-secondary ss-btn-sm" data-re-delphoto="${esc(p.id)}" title="מחיקת הצילום">✕</button>`}</figure>`).join('');
  return `<div class="ss-card"><div class="ss-page-head"><h3 class="ss-section-title">צילומים (${photos.length}/6)</h3>
      ${final || photos.length >= 6 ? '' : '<span class="ss-actions"><label class="ss-field"><span class="ss-label">כיתוב לצילום</span><input class="ss-input" type="text" id="rePhotoCaption" maxlength="120" placeholder="למשל: חזית הבניין"></label> <button class="ss-btn-secondary" id="reAddPhoto">＋ הוספת צילום</button></span>'}</div>
    ${photos.length ? `<div class="ss-photos">${cards}</div>` : '<p class="ss-hint">אין צילומים. הצילומים יופיעו בדוח השומה.</p>'}</div>`;
}

function reCompressImage(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { reject(new Error('סוג קובץ לא נתמך — JPG, PNG או WEBP')); return; }
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
          if (out.length <= RE_PHOTO_MAX_CHARS) { resolve(out); return; }
        }
        reject(new Error('התמונה גדולה מדי גם אחרי הקטנה'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function rePickImage() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.addEventListener('change', () => resolve((input.files && input.files[0]) || null));
    input.click();
  });
}

function renderRealEstate(o) {
  o = o || {};
  const re = reState();
  let body;
  if (re.tab === 'settings') body = reSettingsHtml(o);
  else if (re.caseId && re.current && re.form) body = reEditorHtml(o);
  else body = reListHtml(o);
  return `<div class="ss-stack" data-screen="realestate">${body}</div>`;
}

async function reOpenCase(id) {
  const re = reState();
  const r = await window.systemAPI.getRealEstateCase(id);
  re.caseId = id;
  re.current = r;
  re.form = reToForm(r.case);
  re.importPreview = null;
  re.tab = 'case';
  renderView('realestate');
}

async function reSaveCase({ quiet = false } = {}) {
  const re = reState();
  reCollect();
  const r = await window.systemAPI.updateRealEstateCase(re.caseId, reFromForm(re.form));
  re.current = r;
  re.form = reToForm(r.case);
  if (!quiet) showToast('התיק נשמר');
  return r;
}

function attachRealEstateHandlers() {
  const re = reState();
  const api = window.systemAPI;
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  const guard = (label, fn) => async () => { try { await fn(); } catch (error) { showError(label + ': ' + errMsg(error)); } };

  const filter = document.getElementById('reFilter');
  if (filter) filter.addEventListener('input', () => {
    re.filter = filter.value;
    const pos = filter.selectionStart;
    renderView('realestate');
    const again = document.getElementById('reFilter');
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  });
  document.querySelectorAll('[data-re-open]').forEach(b => b.addEventListener('click', guard('שגיאה בפתיחת התיק', () => reOpenCase(b.dataset.reOpen))));
  on('reNew', guard('שגיאה ביצירת התיק', async () => {
    const d = await askFields('תיק שומה חדש', [
      { name: 'client', label: 'שם המזמין' },
      { name: 'address', label: 'כתובת הנכס' },
      { name: 'city', label: 'יישוב' }
    ], 'פתיחת התיק');
    if (!d) return;
    const c = await api.createRealEstateCase({ client: { name: d.client }, property: { address: d.address, city: d.city } });
    await reOpenCase(c.id);
  }));
  on('reSettingsBtn', () => { re.tab = 'settings'; renderView('realestate'); });
  on('reRegister', guard('שגיאה בייצוא היומן', async () => {
    const r = await api.exportRealEstateRegister();
    if (r && r.ok) showToast(`יומן השומות נשמר (${r.rows} תיקים)`);
  }));
  on('reBack', guard('שגיאה', async () => {
    re.caseId = null; re.current = null; re.form = null; re.importPreview = null; re.tab = 'case';
    await switchView('realestate');
  }));
  on('reSaveSettings', guard('שגיאה בשמירה', async () => {
    const input = {};
    document.querySelectorAll('[data-re-set]').forEach(el => { input[el.dataset.reSet] = el.value; });
    await api.saveRealEstateSettings(input);
    showToast('פרטי השמאי נשמרו');
    re.tab = 'case';
    await switchView('realestate');
  }));

  // עורך התיק
  const purpose = document.querySelector('[data-re="purpose"]');
  if (purpose) purpose.addEventListener('change', () => { reCollect(); renderView('realestate'); });
  on('reSave', guard('שגיאה בשמירה', async () => { await reSaveCase(); renderView('realestate'); }));
  on('reAddComp', () => {
    reCollect();
    if (re.form.comparables.length >= 60) { showError('עד 60 עסקאות בתיק'); return; }
    re.form.comparables.push({ date: '', price: '', area: '', address: '', city: '', block: '', parcel: '', subParcel: '', rooms: '', floor: '', yearBuilt: '', source: '', notes: '', included: true, weight: '', adj: {} });
    renderView('realestate');
  });
  document.querySelectorAll('[data-re-delcomp]').forEach(b => b.addEventListener('click', async () => {
    reCollect();
    if (!(await askConfirm(`להסיר את עסקה ${Number(b.dataset.reDelcomp) + 1} מהתיק?`))) return;
    re.form.comparables.splice(Number(b.dataset.reDelcomp), 1);
    renderView('realestate');
  }));
  on('reImport', guard('שגיאה בקריאת הקובץ', async () => {
    const text = await pickFileText('.csv,text/csv,.txt');
    if (!text) return;
    await reSaveCase({ quiet: true }); // הייבוא מוסיף לתיק השמור — שומרים קודם את מה שהוקלד
    re.importText = text;
    re.importPreview = await api.importRealEstateComparables(re.caseId, text, { source: 'קובץ' });
    renderView('realestate');
  }));
  on('reImportCancel', () => { re.importPreview = null; re.importText = ''; renderView('realestate'); });
  on('reImportApply', guard('שגיאה בייבוא', async () => {
    const r = await api.importRealEstateComparables(re.caseId, re.importText, { source: 'קובץ', apply: true });
    re.importPreview = null; re.importText = '';
    showToast(`נוספו ${r.added} עסקאות`);
    await reOpenCase(re.caseId);
  }));
  on('reFinalize', guard('שגיאה בנעילה', async () => {
    const r = await reSaveCase({ quiet: true });
    if (r.problems && r.problems.length) { renderView('realestate'); showError('לא ניתן לנעול: ' + r.problems.join(' · ')); return; }
    if (!(await askConfirm('לנעול את השומה? הערכים והחישוב יוקפאו. שינוי לאחר מכן — רק בגרסה מתוקנת עם מספר דוח חדש.'))) { renderView('realestate'); return; }
    await api.finalizeRealEstateCase(re.caseId);
    showToast('השומה ננעלה');
    await reOpenCase(re.caseId);
  }));
  on('reReopen', guard('שגיאה', async () => {
    if (!(await askConfirm('לפתוח גרסה מתוקנת? הדוח הנעול נשמר בהיסטוריה, והגרסה החדשה תקבל מספר דוח עם סיומת.'))) return;
    await api.reopenRealEstateCase(re.caseId);
    await reOpenCase(re.caseId);
  }));
  on('reExport', guard('שגיאה ביצירת הדוח', async () => {
    if (re.current.case.status !== 'final') await reSaveCase({ quiet: true });
    const r = await api.exportRealEstateReport(re.caseId);
    if (r && r.ok) showToast('הדוח נשמר');
    renderView('realestate');
  }));
  on('reAddPhoto', guard('שגיאה בהוספת הצילום', async () => {
    const caption = (document.getElementById('rePhotoCaption') || {}).value || '';
    const file = await rePickImage();
    if (!file) return;
    reCollect();
    await reSaveCase({ quiet: true });
    await api.addRealEstatePhoto(re.caseId, { data: await reCompressImage(file), caption });
    showToast('הצילום נוסף');
    await reOpenCase(re.caseId);
  }));
  document.querySelectorAll('[data-re-delphoto]').forEach(b => b.addEventListener('click', guard('שגיאה במחיקת הצילום', async () => {
    if (!(await askConfirm('למחוק את הצילום מהתיק?'))) return;
    reCollect();
    await reSaveCase({ quiet: true });
    await api.deleteRealEstatePhoto(re.caseId, b.dataset.reDelphoto);
    await reOpenCase(re.caseId);
  })));
  on('reDelete', guard('שגיאה במחיקה', async () => {
    if (!(await askConfirm('למחוק את תיק השומה וכל העסקאות שבו? הפעולה אינה ניתנת לביטול.'))) return;
    await api.deleteRealEstateCase(re.caseId);
    re.caseId = null; re.current = null; re.form = null;
    showToast('התיק נמחק');
    await switchView('realestate');
  }));
}
