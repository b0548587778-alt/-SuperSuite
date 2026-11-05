// ממשק המודול הכלכלי — מעבדת תמהיל.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

// ============================================================
// מעבדת תמהיל — מנוע התמהיל המלא (הועבר מ-tamhil): תמהיל, סלים אחידים, כושר החזר,
// מחזור, השוואת אישורים, עמלת פירעון, אופטימייזר, שימור, תרחישים, תחזית וכללים.
// כל החישובים בצד הראשי (mlab:*); כאן רק טפסים ותצוגה. ריביות באחוזים, תקופות בשנים.
// ============================================================
const LAB_TABS = [
  ['mix', 'תמהיל וסימולטור'], ['baskets', 'סלים אחידים'], ['afford', 'כושר החזר'], ['refi', 'מחזור משכנתא'],
  ['approvals', 'השוואת אישורים'], ['prepay', 'עמלת פירעון'], ['opt', 'אופטימייזר'], ['retention', 'שימור'],
  ['scenarios', 'תרחישים שמורים'], ['settings', 'תחזית וכללים']
];
const LAB_TRACK_TYPES = {
  PRIME: 'פריים', FIXED_UNLINKED: 'קבועה לא צמודה', FIXED_LINKED: 'קבועה צמודה',
  VARIABLE_UNLINKED: 'משתנה לא צמודה', VARIABLE_LINKED: 'משתנה צמודה', ELIGIBILITY: 'זכאות', BRIDGE: 'גישור'
};
const LAB_REPAY = { SPITZER: 'שפיצר', EQUAL_PRINCIPAL: 'קרן שווה', BULLET: 'בלון' };
const LAB_BUYERS = { SINGLE_HOME: 'דירה יחידה', HOME_UPGRADER: 'משפר דיור', ADDITIONAL_HOME: 'דירה נוספת' };
const LAB_OBJECTIVES = { TOTAL_COST: 'עלות כוללת נמוכה', MAX_PAYMENT: 'החזר מקסימלי נמוך (יציבות)', TOTAL_COST_WITH_PAYMENT_CAP: 'עלות נמוכה עם תקרת החזר' };
// שדות לפי סוג מסלול: מה נדרש בכל סוג
const ANCHOR_LABELS = { GOV_BOND_5Y: 'אג"ח ממשלתי 5 שנים' };
const LAB_FIELD_FOR = {
  ratePct: (t) => !['PRIME', 'VARIABLE_LINKED', 'VARIABLE_UNLINKED'].includes(t),
  spreadPct: (t) => ['PRIME', 'VARIABLE_LINKED', 'VARIABLE_UNLINKED'].includes(t),
  resetMonths: (t) => ['VARIABLE_LINKED', 'VARIABLE_UNLINKED'].includes(t),
  anchorKey: (t) => ['VARIABLE_LINKED', 'VARIABLE_UNLINKED'].includes(t)
};

const labDefaultMix = () => [
  { type: 'FIXED_UNLINKED', repayment: 'SPITZER', amount: 400000, years: 25, ratePct: 4.9 },
  { type: 'PRIME', repayment: 'SPITZER', amount: 400000, years: 25, spreadPct: -0.5 },
  { type: 'VARIABLE_LINKED', repayment: 'SPITZER', amount: 400000, years: 25, spreadPct: 0.2, resetMonths: 60, anchorKey: 'GOV_BOND_5Y' }
];
const labShares = (rows, shares) => rows.map((r, i) => { const { amount: _a, ...rest } = r; return { ...rest, share: shares[i] }; });

function labState() {
  if (!state.lab) {
    state.lab = {
      tab: 'mix',
      results: {},
      form: { buyerType: 'SINGLE_HOME' },
      editors: {
        mix: labDefaultMix(),
        afford: labShares(labDefaultMix(), [34, 33, 33]),
        refiOld: [{ type: 'FIXED_UNLINKED', repayment: 'SPITZER', amount: 700000, years: 20, ratePct: 5.6 }],
        refiNew: [{ type: 'FIXED_UNLINKED', repayment: 'SPITZER', amount: 350000, years: 20, ratePct: 4.7 }, { type: 'PRIME', repayment: 'SPITZER', amount: 350000, years: 20, spreadPct: -0.6 }],
        opt: labDefaultMix().map(r => ({ ...r, amount: '', minSharePct: '', maxSharePct: '' })),
        prepay: [{ balance: 500000, monthlyPayment: 3100, remainingPayments: 216, contractRatePct: 5.2, averageRatePct: 4.3, isFixedRate: true, isCpiLinked: false, monthsElapsed: 60, noticeGiven: true }]
      },
      approvals: [
        { lender: 'בנק א׳', validUntil: '', fees: 360, maxAmount: '', tracks: labShares(labDefaultMix(), [34, 33, 33]) },
        { lender: 'בנק ב׳', validUntil: '', fees: 0, maxAmount: '', tracks: labShares(labDefaultMix().map(r => ({ ...r, ratePct: r.ratePct && 4.75, spreadPct: r.spreadPct != null ? r.spreadPct + 0.1 : r.spreadPct })), [34, 33, 33]) }
      ]
    };
  }
  return state.lab;
}

// תאריך האימות — היום המקומי של חותמת הזמן (UTC), לא 10 התווים הראשונים שלה (סקירת קוד 2.11.2026)
function labStampDay(v) {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? isoDate(new Date(t)) : String(v || '').slice(0, 10);
}

const pctFmt = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? '—' : (Number(v) * 100).toFixed(d) + '%');
const labNum = (v) => (v === '' || v == null ? '' : v);

// ----- עורך מסלולים: שורה לכל מסלול, השדות הרלוונטיים לפי הסוג -----
function labEditorHtml(id, rows, { shareMode = false, bounds = false, anchors = [] } = {}) {
  // שם העוגן נשמר כמפתח באנגלית; למשתמש מוצג שם בעברית כשהוא מוכר
  const anchorOpts = (sel) => anchors.map(a => `<option value="${esc(a)}"${a === sel ? ' selected' : ''}>${esc(ANCHOR_LABELS[a] || a)}</option>`).join('');
  const inp = (i, f, v, attrs = '') => `<input type="number" data-ed="${id}" data-i="${i}" data-f="${f}" value="${esc(labNum(v))}" ${attrs}>`;
  return `
    <div class="acct-scroll"><table class="acct-table lab-editor">
      <thead><tr><th>סוג</th><th>החזר</th><th>${shareMode ? 'חלק (%)' : 'סכום (₪)'}</th><th>שנים</th><th>ריבית (%)</th><th>מרווח (%)</th><th>שינוי כל (חודשים)</th><th>עוגן</th><th>גרייס (חודשים)</th>${bounds ? '<th>מינ׳ %</th><th>מקס׳ %</th>' : ''}<th></th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td><select data-ed="${id}" data-i="${i}" data-f="type">${Object.entries(LAB_TRACK_TYPES).map(([k, l]) => `<option value="${k}"${r.type === k ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
        <td><select data-ed="${id}" data-i="${i}" data-f="repayment">${Object.entries(LAB_REPAY).map(([k, l]) => `<option value="${k}"${(r.repayment || 'SPITZER') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
        <td>${shareMode ? inp(i, 'share', r.share, 'min="0" max="100" step="1"') : (bounds ? '<span class="muted">לפי החלוקה</span>' : inp(i, 'amount', r.amount, 'min="0"'))}</td>
        <td>${inp(i, 'years', r.years, 'min="1" max="50" step="1"')}</td>
        <td>${LAB_FIELD_FOR.ratePct(r.type) ? inp(i, 'ratePct', r.ratePct, 'step="0.01"') : '<span class="muted">—</span>'}</td>
        <td>${LAB_FIELD_FOR.spreadPct(r.type) ? inp(i, 'spreadPct', r.spreadPct, 'step="0.01"') : '<span class="muted">—</span>'}</td>
        <td>${LAB_FIELD_FOR.resetMonths(r.type) ? inp(i, 'resetMonths', r.resetMonths, 'min="1" step="1"') : '<span class="muted">—</span>'}</td>
        <td>${LAB_FIELD_FOR.anchorKey(r.type) ? `<select data-ed="${id}" data-i="${i}" data-f="anchorKey">${anchorOpts(r.anchorKey)}</select>` : '<span class="muted">—</span>'}</td>
        <td>${inp(i, 'graceMonths', r.graceMonths, 'min="0" step="1"')}<select data-ed="${id}" data-i="${i}" data-f="graceType"><option value="PARTIAL"${r.graceType !== 'FULL' ? ' selected' : ''}>חלקי</option><option value="FULL"${r.graceType === 'FULL' ? ' selected' : ''}>מלא</option></select></td>
        ${bounds ? `<td>${inp(i, 'minSharePct', r.minSharePct, 'min="0" max="100"')}</td><td>${inp(i, 'maxSharePct', r.maxSharePct, 'min="0" max="100"')}</td>` : ''}
        <td><button class="icon-btn danger" data-lab-delrow="${id}" data-i="${i}" title="הסרת מסלול">🗑</button></td>
      </tr>`).join('')}</tbody>
    </table></div>
    <button class="secondary" data-lab-addrow="${id}">＋ מסלול</button>`;
}

function labPruneRow(row) {
  if (!row || !row.type) return;
  for (const f of Object.keys(LAB_FIELD_FOR)) if (!LAB_FIELD_FOR[f](row.type)) delete row[f];
}

// קריאת כל השדות שעל המסך אל המצב — לפני כל חישוב, החלפת לשונית או רינדור מחדש
function labCollect() {
  const lab = labState();
  document.querySelectorAll('[data-ed]').forEach(el => {
    const target = el.dataset.ed.startsWith('appr') ? (lab.approvals[Number(el.dataset.ed.slice(4))] || {}).tracks : lab.editors[el.dataset.ed];
    const row = target && target[Number(el.dataset.i)];
    if (!row) return;
    const f = el.dataset.f;
    if (el.type === 'checkbox') row[f] = !!el.checked;
    else if (el.type === 'number') row[f] = el.value === '' ? '' : Number(el.value);
    else row[f] = el.value;
  });
  // סקירת קוד 2.11.2026: שדה שלא שייך לסוג המסלול (ריבית קבועה אחרי מעבר למשתנה) נמחק — אחרת הוא נשלח לחישוב
  const pruned = [...Object.entries(lab.editors).filter(([k]) => k !== 'prepay').map(([, rows]) => rows), ...lab.approvals.map(a => a.tracks)];
  pruned.forEach(rows => (rows || []).forEach(labPruneRow));
  document.querySelectorAll('[data-lab-form]').forEach(el => {
    lab.form[el.dataset.labForm] = el.type === 'checkbox' ? !!el.checked : el.value;
  });
  document.querySelectorAll('[data-appr]').forEach(el => {
    const o = lab.approvals[Number(el.dataset.appr)];
    if (o) o[el.dataset.f] = el.value;
  });
}

function labField(name, label, type = 'number', attrs = '') {
  const v = labState().form[name];
  return `<label>${label} <input type="${type}" data-lab-form="${name}" value="${esc(labNum(v))}" ${attrs}></label>`;
}
function labSelect(name, label, map) {
  const v = labState().form[name];
  return `<label>${label} <select data-lab-form="${name}">${Object.entries(map).map(([k, l]) => `<option value="${k}"${v === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
}
const labRow = (label, value, cls = '') => `<div class="acct-row ${cls}"><span>${label}</span><span>${value}</span></div>`;

function labAssumptionsHtml(a) {
  if (!a) return '';
  return `<div class="lab-assumptions muted">
    <b>הנחות החישוב:</b> תחזית "${esc(a.forecastSource)}" (${esc(a.forecastPublishedAt)})${a.forecastNeedsVerification ? ' <span class="warn">⚠ יש לאמת</span>' : ''} ·
    ריבית בנק ישראל בתחילה ${pctFmt(a.boiRateAtStart)} · מרווח פריים ${pctFmt(a.primeSpread)}${a.primeSpreadNeedsVerification ? ' <span class="warn">⚠ יש לאמת</span>' : ''} ·
    מדד בשנה הראשונה ${pctFmt(a.firstYearInflation)} · ריבית חודשית ${a.rateConvention === 'EFFECTIVE' ? 'אפקטיבית' : 'נומינלית (שנתית/12)'} ·
    כללים ${esc(a.rulesVersion)} · מנוע ${esc(a.engineVersion)}. התחזיות אינן ודאיות — התוצאה להמחשה ולא התחייבות.
  </div>`;
}

function labWarningsHtml(ws) {
  if (!Array.isArray(ws) || ws.length === 0) return '<div class="acct-row ok">✓ לא נמצאו חריגות מהכללים הרגולטוריים שנבדקו</div>';
  return `<div class="lab-warnings">${ws.map(w => `<div class="acct-row warn"><span>⚠ ${esc(w.label)}</span><span>${w.code === 'TERM' ? `${w.actual} חודשים (מותר ${w.limit})` : `${pctFmt(w.actual, 1)} (סף ${pctFmt(w.limit, 1)})`}${w.needsVerification ? ' · הכלל טרם אומת' : ''}</span></div>`).join('')}</div>`;
}

function labSummaryHtml(s) {
  if (!s) return '';
  return [
    labRow('סכום ההלוואה', money(s.principal)),
    labRow('החזר חודשי ראשון', money(s.firstPayment)),
    labRow('החזר חודשי מקסימלי צפוי', `${money(s.maxPayment)} <small class="muted">(חודש ${s.maxPaymentMonth})</small>`),
    labRow('סה"כ ריבית', money(s.totalInterest)),
    labRow('סה"כ הצמדה צפויה', money(s.totalIndexation)),
    labRow('עלות האשראי (ריבית + הצמדה)', money(s.totalCost)),
    labRow('סה"כ תשלומים צפוי', money(s.totalPayments), 'acct-big'),
    labRow('תשואה פנימית שנתית (עלות אפקטיבית)', pctFmt(s.irrAnnual))
  ].join('');
}

function labMixResultHtml(r) {
  if (!r) return '';
  return `
    <div class="acct-grid">
      <div><h4>סיכום</h4>${labSummaryHtml(r.summary)}</div>
      <div><h4>בדיקות רגולטוריות</h4>${labWarningsHtml(r.warnings)}</div>
    </div>
    <h4>פירוט מסלולים</h4>
    <div class="acct-scroll"><table class="acct-table">
      <thead><tr><th>מסלול</th><th>סכום</th><th>חודשים</th><th>ריבית התחלתית</th><th>החזר ראשון</th><th>החזר מקסימלי</th><th>סה"כ תשלומים</th></tr></thead>
      <tbody>${(r.tracks || []).map(t => `<tr><td>${esc(t.label)}${t.isCpiLinked ? ' <small class="muted">צמוד</small>' : ''}</td><td>${money(t.principal)}</td><td>${t.termMonths}</td><td>${pctFmt(t.initialRate)}</td><td>${money(t.summary.firstPayment)}</td><td>${money(t.summary.maxPayment)}</td><td>${money(t.summary.totalPayments)}</td></tr>`).join('')}</tbody>
    </table></div>
    ${Array.isArray(r.yearly) && r.yearly.length ? `<details><summary>לוח סילוקין שנתי (${r.yearly.length} שנים)</summary>
      <div class="acct-scroll"><table class="acct-table">
        <thead><tr><th>שנה</th><th>תשלומים</th><th>ריבית</th><th>קרן</th><th>הצמדה</th><th>יתרה</th></tr></thead>
        <tbody>${r.yearly.map(y => `<tr><td>${y.year}</td><td>${money(y.payments)}</td><td>${money(y.interest)}</td><td>${money(y.principal)}</td><td>${money(y.indexation)}</td><td>${money(y.closingBalance)}</td></tr>`).join('')}</tbody>
      </table></div></details>` : ''}
    ${labAssumptionsHtml(r.assumptions)}`;
}

function labCheckFields() {
  return `${labField('monthlyNetIncome', 'הכנסה נטו משפחתית (₪)')} ${labField('propertyValue', 'שווי הנכס (₪)')} ${labSelect('buyerType', 'סוג רוכש', LAB_BUYERS)}`;
}

// ----- לשוניות -----
function labTabMix(o, lab) {
  const clients = Array.isArray(o.clients) ? o.clients : [];
  return `<div class="card">
    <h3>תמהיל וסימולטור</h3>
    <p class="muted">פריים מחושב לפי מסלול ריבית בנק ישראל שבתחזית; מסלול משתנה מתעדכן בכל נקודת שינוי לפי העוגן ועוד המרווח; מסלול צמוד מוצמד למדד בכל חודש.</p>
    ${labEditorHtml('mix', lab.editors.mix, { anchors: o.anchorKeys || [] })}
    <div class="acct-actions">${labCheckFields()}</div>
    <div class="acct-actions"><button id="labCalcMix">חשב</button></div>
    <div id="labOut">${labMixResultHtml(lab.results.mix)}</div>
    ${lab.results.mix ? `<div class="card"><h4>שמירה כתרחיש</h4><div class="acct-actions">
      ${labField('scenarioName', 'שם התרחיש', 'text')}
      <label>תיק לקוח <select data-lab-form="scenarioClient"><option value="">ללא</option>${clients.map(c => `<option value="${esc(c.id)}"${lab.form.scenarioClient === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      ${labField('scenarioStart', 'תאריך תחילת ההלוואה (לשימור)', 'date')}
      <button class="secondary" id="labSaveScenario">שמירה</button></div></div>` : ''}
  </div>`;
}

function labTabBaskets(o, lab) {
  const rs = lab.results.baskets;
  return `<div class="card">
    <h3>שלושת הסלים האחידים (הוראה 451)</h3>
    <p class="muted">אותו סכום, אותה תקופה ואותו תמחור — כך שההשוואה בין הסלים הוגנת.</p>
    <div class="acct-actions">${labField('bAmount', 'סכום (₪)')} ${labField('bYears', 'שנים')} ${labField('bFixed', 'ריבית קל"צ (%)', 'number', 'step="0.01"')} ${labField('bPrime', 'מרווח פריים (%)', 'number', 'step="0.01"')} ${labField('bVar', 'מרווח משתנה צמודה (%)', 'number', 'step="0.01"')}</div>
    <div class="acct-actions"><button id="labCalcBaskets">השווה סלים</button></div>
    ${Array.isArray(rs) ? `<div class="acct-scroll"><table class="acct-table">
      <thead><tr><th>סל</th><th>החזר ראשון</th><th>החזר מקסימלי</th><th>סה"כ תשלומים</th><th>עלות האשראי</th></tr></thead>
      <tbody>${rs.map(b => `<tr><td>${esc(b.label)}</td><td>${money(b.summary.firstPayment)}</td><td>${money(b.summary.maxPayment)}</td><td>${money(b.summary.totalPayments)}</td><td>${money(b.summary.totalCost)}</td></tr>`).join('')}</tbody>
    </table></div>${labAssumptionsHtml(rs[0] && rs[0].assumptions)}` : ''}
  </div>`;
}

function labTabAfford(o, lab) {
  const r = lab.results.afford;
  return `<div class="card">
    <h3>כושר החזר — כמה אפשר לקחת?</h3>
    <p class="muted">מהחזר חודשי רצוי והון עצמי אל ההלוואה ומחיר הנכס המקסימליים, לפי התמהיל המתוכנן (חלקים באחוזים).</p>
    ${labEditorHtml('afford', lab.editors.afford, { shareMode: true, anchors: o.anchorKeys || [] })}
    <div class="acct-actions">${labField('aTarget', 'החזר חודשי רצוי (₪)')} ${labField('aEquity', 'הון עצמי למחיר הנכס (₪)')} ${labSelect('buyerType', 'סוג רוכש', LAB_BUYERS)}
      ${labSelect('aBasis', 'לפי החזר', { MAX: 'המקסימלי הצפוי (שמרני)', FIRST: 'הראשון' })}</div>
    <div class="acct-actions"><button id="labCalcAfford">חשב</button></div>
    ${r ? `<div>${labRow('הלוואה מקסימלית', money(r.maxLoan), 'acct-big')}${labRow('מחיר נכס מקסימלי', money(r.maxPropertyPrice), 'acct-big')}
      ${labRow('המגבלה הקובעת', r.binding === 'PAYMENT' ? 'ההחזר החודשי' : 'שיעור המימון המותר')}
      ${labRow('הלוואה לפי ההחזר בלבד', money(r.loanByPayment))}${labRow('מחיר לפי שיעור המימון', r.priceByLtv == null ? '—' : money(r.priceByLtv))}
      ${labRow('שיעור מימון מותר', pctFmt(r.ltvLimit, 0) + (r.ltvNeedsVerification ? ' · הכלל טרם אומת' : ''))}</div>` : ''}
  </div>`;
}

function labTabRefi(o, lab) {
  const r = lab.results.refi;
  return `<div class="card">
    <h3>מחזור משכנתא — כדאיות</h3>
    <p class="muted">המשכנתא הקיימת: יתרה נוכחית, תקופה שנותרה וריבית נוכחית. הסכומים לפי דוח היתרה לסילוק.</p>
    <h4>המשכנתא הקיימת</h4>${labEditorHtml('refiOld', lab.editors.refiOld, { anchors: o.anchorKeys || [] })}
    <h4>ההצעה החדשה</h4>${labEditorHtml('refiNew', lab.editors.refiNew, { anchors: o.anchorKeys || [] })}
    <div class="acct-actions">${labField('rFee', 'עמלת פירעון מוקדם מהדוח (₪) — ריק אם לא ידוע')} ${labField('rCosts', 'עלויות מעבר: שמאי, עו"ד, פתיחת תיק (₪)')}</div>
    <div class="acct-actions"><button id="labCalcRefi">השווה</button></div>
    ${r ? `<div>
      ${labRow('חיסכון נטו צפוי (אחרי עלויות)', money(r.netSavings), 'acct-big ' + (r.netSavings > 0 ? 'ok' : 'warn'))}
      ${labRow('שינוי בהחזר הראשון', money(r.firstPaymentChange))}
      ${labRow('עלות מיידית', money(r.upfrontCost) + (r.prepaymentFeeKnown ? '' : ' <span class="warn">(עמלת הפירעון לא הוזנה)</span>'))}
      ${labRow('נקודת איזון', r.breakEvenMonth ? `חודש ${r.breakEvenMonth}` : 'אין')}
      ${labRow('הפרש קרן (משיכת כסף אם חיובי)', money(r.principalDifference))}
      ${labRow('סה"כ תשלומים — קיימת / חדשה', `${money(r.existing.summary.totalPayments)} / ${money(r.proposed.summary.totalPayments)}`)}
      <p class="muted">הערכה בלבד: רק דוח היתרה לסילוק של הבנק מחייב.</p>${labAssumptionsHtml(r.proposed.assumptions)}</div>` : ''}
  </div>`;
}

function labTabApprovals(o, lab) {
  const r = lab.results.approvals;
  const rank = r ? Object.fromEntries((r.byTotalCost || []).map((id, i) => [id, i + 1])) : {};
  return `<div class="card">
    <h3>השוואת אישורים עקרוניים</h3>
    <p class="muted">כל הצעה מוזנת בחלקים מהסכום (%) ומחושבת על אותו סכום ואותה תחזית — כך ההשוואה ישירה.</p>
    ${labField('apAmount', 'סכום ההלוואה להשוואה (₪)')}
    ${Array.isArray(o.clients) && o.clients.length ? `<div class="acct-actions">
      <label>תיק לקוח <select data-lab-form="apClient"><option value="">— בלי תיק —</option>${o.clients.map(c => `<option value="${esc(c.id)}"${lab.form.apClient === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <button class="secondary" id="labSaveApprToClient">שמירת האישורים בתיק</button>
    </div>` : ''}
    ${lab.approvals.map((ap, k) => `<div class="card">
      <div class="acct-actions">
        <label>בנק <input type="text" data-appr="${k}" data-f="lender" value="${esc(ap.lender)}"></label>
        <label>בתוקף עד <input type="date" data-appr="${k}" data-f="validUntil" value="${esc(ap.validUntil)}"></label>
        <label>עמלות חד-פעמיות (₪) <input type="number" data-appr="${k}" data-f="fees" value="${esc(labNum(ap.fees))}"></label>
        <label>סכום מאושר מקסימלי (₪) <input type="number" data-appr="${k}" data-f="maxAmount" value="${esc(labNum(ap.maxAmount))}"></label>
        <button class="icon-btn danger" data-lab-delappr="${k}" title="הסרת הצעה">🗑</button>
      </div>
      ${labEditorHtml('appr' + k, ap.tracks, { shareMode: true, anchors: o.anchorKeys || [] })}
    </div>`).join('')}
    <div class="acct-actions"><button class="secondary" id="labAddAppr">＋ הצעה</button><button id="labCalcAppr">השווה</button></div>
    ${r ? `<div class="acct-scroll"><table class="acct-table">
      <thead><tr><th>דירוג</th><th>בנק</th><th>החזר ראשון</th><th>החזר מקסימלי</th><th>עלות כולל עמלות</th><th>הערות</th></tr></thead>
      <tbody>${r.offers.map(x => `<tr><td>${rank[x.offer.id] || '—'}</td><td>${esc(x.offer.lender)}</td>
        <td>${x.result ? money(x.result.summary.firstPayment) : '—'}</td><td>${x.result ? money(x.result.summary.maxPayment) : '—'}</td>
        <td>${x.totalCostWithFees == null ? '—' : money(x.totalCostWithFees)}</td>
        <td>${[x.expired ? 'פג תוקף' : '', x.overMax ? 'מעל הסכום המאושר' : '', x.error ? esc(x.error) : ''].filter(Boolean).join(' · ')}</td></tr>`).join('')}</tbody>
    </table></div>` : ''}
  </div>`;
}

function labTabPrepay(o, lab) {
  const r = lab.results.prepay;
  const rows = lab.editors.prepay;
  const n = (i, f, v, a = '') => `<input type="number" data-ed="prepay" data-i="${i}" data-f="${f}" value="${esc(labNum(v))}" ${a}>`;
  const c = (i, f, v) => `<input type="checkbox" data-ed="prepay" data-i="${i}" data-f="${f}"${v ? ' checked' : ''}>`;
  return `<div class="card">
    <h3>הערכת עמלת פירעון מוקדם</h3>
    <p class="muted">עמלת היוון (ריבית קבועה), עמלת אי-הודעה ועמלה תפעולית. עמלת הפרשי מדד אינה מחושבת. הערכה בלבד — רק דוח היתרה לסילוק של הבנק מחייב.</p>
    <div class="acct-scroll"><table class="acct-table">
      <thead><tr><th>יתרה (₪)</th><th>החזר חודשי (₪)</th><th>תשלומים שנותרו</th><th>ריבית בחוזה (%)</th><th>ריבית ממוצעת היום (%)</th><th>ריבית קבועה</th><th>צמוד</th><th>חודשים מאז הנטילה</th><th>ניתנה הודעה מוקדמת</th><th></th></tr></thead>
      <tbody>${rows.map((t, i) => `<tr><td>${n(i, 'balance', t.balance)}</td><td>${n(i, 'monthlyPayment', t.monthlyPayment)}</td><td>${n(i, 'remainingPayments', t.remainingPayments, 'step="1"')}</td>
        <td>${n(i, 'contractRatePct', t.contractRatePct, 'step="0.01"')}</td><td>${n(i, 'averageRatePct', t.averageRatePct, 'step="0.01"')}</td>
        <td>${c(i, 'isFixedRate', t.isFixedRate)}</td><td>${c(i, 'isCpiLinked', t.isCpiLinked)}</td><td>${n(i, 'monthsElapsed', t.monthsElapsed, 'step="1"')}</td><td>${c(i, 'noticeGiven', t.noticeGiven)}</td>
        <td><button class="icon-btn danger" data-lab-delrow="prepay" data-i="${i}" title="הסרה">🗑</button></td></tr>`).join('')}</tbody>
    </table></div>
    <div class="acct-actions"><button class="secondary" data-lab-addrow="prepay">＋ מסלול</button><button id="labCalcPrepay">הערך</button></div>
    ${r ? `<div>${r.tracks.map((t, i) => labRow(`מסלול ${i + 1}: היוון ${money(t.capitalizationFee)} · אי-הודעה ${money(t.noticeFee)}`, money(t.total))).join('')}
      ${labRow('עמלה תפעולית', money(r.operationalFee))}${labRow('סה"כ הערכה', money(r.total), 'acct-big')}
      ${(r.gapLabels || []).map(g => `<div class="acct-row warn">⚠ ${esc(g)}</div>`).join('')}</div>` : ''}
  </div>`;
}

function labTabOpt(o, lab) {
  const r = lab.results.opt;
  return `<div class="card">
    <h3>אופטימייזר תמהיל — המלצה בלבד</h3>
    <p class="muted">הזן את אבני הבניין שתמחרת (סוג, ריבית/מרווח, תקופה), אפשר עם גבולות לחלק של כל אחת. המערכת בודקת את כל החלוקות, פוסלת חריגות מהכללים ומתקרת ההחזר, ומציגה את המובילות. התחזיות אינן ודאיות — ההחלטה שלך.</p>
    ${labEditorHtml('opt', lab.editors.opt, { bounds: true, anchors: o.anchorKeys || [] })}
    <div class="acct-actions">${labField('oAmount', 'סכום (₪)')} ${labSelect('oObjective', 'מטרה', LAB_OBJECTIVES)} ${labField('oCap', 'תקרת החזר חודשי (₪)')} ${labField('oStep', 'צעד חלוקה (%)', 'number', 'min="1" max="100"')}</div>
    <div class="acct-actions">${labCheckFields()}</div>
    <div class="acct-actions"><button id="labCalcOpt">מצא תמהילים</button></div>
    ${r ? `<p class="muted">נבדקו ${r.evaluated} חלוקות, נפסלו ${r.rejected}.</p>
      ${r.candidates.length === 0 ? '<div class="acct-row warn">לא נמצא תמהיל שעומד בכל המגבלות</div>' : `<div class="acct-scroll"><table class="acct-table">
      <thead><tr><th>#</th><th>חלוקה</th><th>החזר ראשון</th><th>החזר מקסימלי</th><th>סה"כ תשלומים</th><th>אזהרות</th></tr></thead>
      <tbody>${r.candidates.map((cd, i) => `<tr><td>${i + 1}</td><td>${cd.shares.map((s, k) => s > 0 ? `${esc(LAB_TRACK_TYPES[(r.blockTypes || [])[k]] || '')} ${Math.round(s * 100)}%` : '').filter(Boolean).join(' · ')}</td>
        <td>${money(cd.summary.firstPayment)}</td><td>${money(cd.summary.maxPayment)}</td><td>${money(cd.summary.totalPayments)}</td><td>${cd.warnings.map(w => esc(w.label)).join(' · ')}</td></tr>`).join('')}</tbody>
    </table></div>`}` : ''}
  </div>`;
}

function labTabRetention(o) {
  const ev = Array.isArray(o.retention) ? o.retention : [];
  return `<div class="card">
    <h3>שימור לקוחות — 180 הימים הקרובים</h3>
    <p class="muted">נגזר מתרחישים שמורים שמשויכים לתיק לקוח ויש להם תאריך תחילה: יום שנה להלוואה ונקודות שינוי ריבית במסלולים משתנים. אלה משימות לך — המערכת לא פונה ללקוח.</p>
    ${ev.length === 0 ? renderEmpty('אין אירועים קרובים. שמור תרחיש עם תיק לקוח ותאריך תחילה כדי לקבל תזכורות.') : `<div class="acct-scroll"><table class="acct-table">
      <thead><tr><th>תאריך</th><th>בעוד</th><th>לקוח</th><th>אירוע</th><th>תרחיש</th></tr></thead>
      <tbody>${ev.map(e => `<tr><td>${esc(e.date)}</td><td>${e.days} ימים</td><td>${esc(e.clientName)}</td><td>${esc(e.label)}</td><td>${esc(e.scenarioName)}</td></tr>`).join('')}</tbody>
    </table></div>`}
  </div>`;
}

function labTabScenarios(o) {
  const list = Array.isArray(o.scenarios) ? o.scenarios : [];
  return `<div class="card">
    <h3>תרחישים שמורים (${list.length})</h3>
    ${list.length === 0 ? renderEmpty('אין תרחישים שמורים. חשב תמהיל בלשונית "תמהיל וסימולטור" ושמור אותו.') : `<div class="acct-scroll"><table class="acct-table">
      <thead><tr><th>שם</th><th>לקוח</th><th>תחילה</th><th>סכום</th><th>החזר ראשון</th><th>סה"כ תשלומים</th><th>כללים / תחזית</th><th></th></tr></thead>
      <tbody>${list.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.clientName)}</td><td>${esc(s.startDate || '')}</td>
        <td>${money(s.summary && s.summary.principal)}</td><td>${money(s.summary && s.summary.firstPayment)}</td><td>${money(s.summary && s.summary.totalPayments)}</td>
        <td><small>${esc(s.rulesVersion)} / ${esc(s.forecastId)}</small></td>
        <td><button class="icon-btn" data-lab-load="${esc(s.id)}" title="טעינה לסימולטור">↺</button>
            <button class="icon-btn" data-lab-export="${esc(s.id)}" title="ייצוא לוח סילוקין חודשי">📊</button>
            <button class="icon-btn danger" data-lab-delscn="${esc(s.id)}" title="מחיקה">🗑</button></td></tr>`).join('')}</tbody>
    </table></div>`}
  </div>`;
}

function labTabSettings(o, lab) {
  const f = o.forecast || {};
  const rules = Array.isArray(o.rules) ? o.rules : [];
  const fmtVal = (r) => {
    const v = r.value;
    if (Array.isArray(v)) return v.length ? `${v.length} פריטים` : 'לא הוזן';
    if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => `${LAB_BUYERS[k] || k} ${pctFmt(x, 0)}`).join(' · ');
    if (/Months|Days/.test(r.id)) return String(v);
    if (r.id === 'prepayment.operationalFee') return money(v);
    return pctFmt(v, 2);
  };
  return `<div class="card">
    <h3>תחזית שוק</h3>
    ${f.isDemo ? '<div class="acct-row warn">⚠ מוצגים נתוני הדגמה בלבד — יש להזין תחזית ממקור מאומת (למשל תחזית חטיבת המחקר של בנק ישראל וציפיות האינפלציה משוק האג"ח).</div>' : ''}
    ${labRow('מקור', esc(f.source))}${labRow('תאריך פרסום', esc(f.publishedAt))}
    ${labRow('ריבית בנק ישראל (לפי חודש)', esc((f.boiPct || []).join(', ')) + '%')}
    ${labRow('מדד שנתי צפוי (שנה ראשונה)', `${f.inflationAnnualPct}%`)}
    ${Object.entries(f.anchors || {}).map(([k, a]) => labRow(`עוגן ${esc(k)}`, `${a.first}% → ${a.last}% (${a.months} חודשים)`)).join('')}
    <h4>עדכון תחזית</h4>
    <p class="muted">ערכים באחוזים, מופרדים בפסיקים. ריבית בנק ישראל: ערך לכל חודש מהיום. מדד ותשואת העוגן: ערך לכל שנה. הערך האחרון ממשיך הלאה.</p>
    <div class="acct-actions">
      ${labField('fSource', 'מקור (חובה)', 'text')} ${labField('fDate', 'תאריך פרסום', 'date')}
      ${labField('fBoi', 'ריבית בנק ישראל (%)', 'text', 'placeholder="4.25, 4.25, 4"')}
      ${labField('fInfl', 'מדד שנתי (%)', 'text', 'placeholder="2.5, 2.3"')}
      ${labField('fAnchorKey', 'שם העוגן', 'text', 'placeholder="GOV_BOND_5Y"')}
      ${labField('fAnchor', 'תשואת העוגן (%)', 'text', 'placeholder="3, 3, 3, 3, 3, 3.25"')}
      ${labSelect('fConvention', 'חישוב ריבית חודשית', { NOMINAL: 'נומינלית (שנתית/12)', EFFECTIVE: 'אפקטיבית' })}
    </div>
    <div class="acct-actions"><button id="labSaveForecast">שמירת תחזית</button>${f.isDemo ? '' : '<button class="secondary" id="labResetForecast">חזרה לנתוני ההדגמה</button>'}</div>
  </div>
  <div class="card">
    <h3>כללים רגולטוריים (גרסה ${esc(o.rulesVersion)})</h3>
    <p class="muted">כל הערכים הם ערכי התחלה. אימות נרשם ביומן הביקורת, חל על גרסת הכללים הנוכחית בלבד, ומותר למנהל בלבד. אימות מאשר שהערך נבדק — הוא אינו משנה אותו.</p>
    <div class="acct-scroll"><table class="acct-table">
      <thead><tr><th>כלל</th><th>ערך</th><th>מקור</th><th>מצב</th><th></th></tr></thead>
      <tbody>${rules.map(r => `<tr><td>${esc(r.description)}</td><td>${fmtVal(r)}</td><td><small>${esc(r.source)}</small></td>
        <td>${r.needsVerification ? `<span class="warn">⚠ ${esc(r.statusLabel || 'לא מאומת')}</span>` : `<span class="ok">✓ אומת</span> <small>${esc(labStampDay(r.verifiedAt))} · ${esc(r.verifiedNote)}</small>`}</td>
        <td>${r.needsVerification ? `<button class="secondary" data-lab-verify="${esc(r.id)}">אימות</button>` : `<button class="icon-btn" data-lab-unverify="${esc(r.id)}" title="ביטול אימות">↺</button>`}</td></tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

function renderMortgageLab(o) {
  o = o || {};
  const lab = labState();
  const tabs = { mix: labTabMix, baskets: labTabBaskets, afford: labTabAfford, refi: labTabRefi, approvals: labTabApprovals, prepay: labTabPrepay, opt: labTabOpt, retention: labTabRetention, scenarios: labTabScenarios, settings: labTabSettings };
  const unverified = (Array.isArray(o.rules) ? o.rules : []).filter(r => r.needsVerification).length;
  const demo = o.forecast && o.forecast.isDemo;
  return `
    <div class="mortgage-lab">
      ${demo || unverified ? `<div class="card warn-banner">⚠ ${demo ? 'התחזית היא נתוני הדגמה. ' : ''}${unverified ? `${unverified} כללים רגולטוריים טרם אומתו. ` : ''}<button class="secondary" data-lab-tab="settings">לתחזית ולכללים</button></div>` : ''}
      <div class="lab-tabs" role="group" aria-label="בחירת כלי">${LAB_TABS.map(([k, l]) => `<button class="${lab.tab === k ? 'primary' : 'secondary'}" data-lab-tab="${k}" aria-pressed="${lab.tab === k}">${l}</button>`).join('')}</div>
      ${(tabs[lab.tab] || labTabMix)(o, lab)}
    </div>`;
}

// מסלולים לשליחה: בלי שורות ריקות לגמרי
const labTracks = (rows) => rows.filter(r => r && r.type);

async function labRun(key, fn) {
  labCollect();
  const lab = labState();
  try {
    lab.results[key] = await fn(lab);
    renderView('mortgage-lab');
  } catch (error) { showError('שגיאה בחישוב: ' + errMsg(error)); }
}

async function labAskNote(title) {
  if (typeof openDialog !== 'function') return null;
  return openDialog((box, done) => {
    // כותרת חלון ברמה 2, ותווית לשדה (r4 נגישות)
    box.innerHTML = `<h2>${esc(title)}</h2><label for="labNote" class="muted" style="display:block;padding:0 1.5rem">ציין את שם ההוראה, הסעיף ותאריך הנוסח שמולו בדקת.</label>
      <textarea id="labNote" rows="3" style="width:100%"></textarea>
      <div class="modal-actions"><button type="button" class="secondary" id="labNoteCancel">ביטול</button><button type="button" class="primary" id="labNoteOk">אישור</button></div>`;
    box.querySelector('#labNoteOk').addEventListener('click', () => done(box.querySelector('#labNote').value.trim() || null));
    box.querySelector('#labNoteCancel').addEventListener('click', () => done(null));
  });
}

function attachLabHandlers() {
  const lab = labState();
  const api = window.systemAPI;
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  const rerender = () => { labCollect(); renderView('mortgage-lab'); };
  // שינוי בשורות האופטימייזר (סוג, הוספה, הסרה) — התוצאה הישנה כבר לא מתאימה (סקירת קוד 2.11.2026)
  const dropOpt = (id) => { if (id === 'opt') lab.results.opt = null; };

  document.querySelectorAll('[data-lab-tab]').forEach(b => b.addEventListener('click', () => { labCollect(); lab.tab = b.dataset.labTab; renderView('mortgage-lab'); }));
  // שינוי סוג מסלול משנה את השדות הרלוונטיים — רינדור מחדש
  document.querySelectorAll('[data-f="type"]').forEach(s => s.addEventListener('change', () => { dropOpt(s.dataset.ed); rerender(); }));
  document.querySelectorAll('[data-lab-addrow]').forEach(b => b.addEventListener('click', () => {
    labCollect();
    const id = b.dataset.labAddrow;
    const target = id.startsWith('appr') ? lab.approvals[Number(id.slice(4))].tracks : lab.editors[id];
    if (target.length >= 12) { showError('עד 12 מסלולים'); return; }
    dropOpt(id);
    target.push(id === 'prepay' ? { balance: '', monthlyPayment: '', remainingPayments: '', contractRatePct: '', averageRatePct: '', isFixedRate: true } : { type: 'FIXED_UNLINKED', repayment: 'SPITZER', years: 25 });
    renderView('mortgage-lab');
  }));
  document.querySelectorAll('[data-lab-delrow]').forEach(b => b.addEventListener('click', () => {
    labCollect();
    const id = b.dataset.labDelrow;
    const target = id.startsWith('appr') ? lab.approvals[Number(id.slice(4))].tracks : lab.editors[id];
    target.splice(Number(b.dataset.i), 1);
    dropOpt(id);
    renderView('mortgage-lab');
  }));

  on('labCalcMix', () => labRun('mix', (l) => api.calcLabMix({ tracks: labTracks(l.editors.mix), monthlyNetIncome: l.form.monthlyNetIncome, propertyValue: l.form.propertyValue, buyerType: l.form.buyerType })));
  on('labCalcBaskets', () => labRun('baskets', (l) => api.calcLabBaskets({ amount: l.form.bAmount, years: l.form.bYears, pricing: { fixedRatePct: l.form.bFixed, primeSpreadPct: l.form.bPrime, variableSpreadPct: l.form.bVar } })));
  on('labCalcAfford', () => labRun('afford', (l) => api.calcLabAffordability({ tracks: labTracks(l.editors.afford), targetPayment: l.form.aTarget, equity: l.form.aEquity, buyerType: l.form.buyerType, basis: l.form.aBasis })));
  on('labCalcRefi', () => labRun('refi', (l) => api.calcLabRefinance({ existing: labTracks(l.editors.refiOld), proposed: labTracks(l.editors.refiNew), prepaymentFee: l.form.rFee, switchingCosts: l.form.rCosts })));
  on('labCalcAppr', () => labRun('approvals', (l) => api.calcLabApprovals({ amount: l.form.apAmount, offers: l.approvals.map((a, i) => ({ ...a, id: 'o' + i, tracks: labTracks(a.tracks) })) })));
  // האישורים נשמרים בתיק הלקוח (מחליפים את הרשימה שבו). המזהה נשמר, כדי שהאישור הנבחר לא יאבד
  on('labSaveApprToClient', async () => {
    labCollect();
    if (!lab.form.apClient) { showError('יש לבחור תיק לקוח'); return; }
    try {
      const saved = await api.saveMortgageApprovals(lab.form.apClient, lab.approvals.map(a => ({ id: a.id, lender: a.lender, validUntil: a.validUntil, fees: a.fees, maxAmount: a.maxAmount, tracks: labTracks(a.tracks) })));
      saved.forEach((s, i) => { if (lab.approvals[i]) lab.approvals[i].id = s.id; });
      showToast('האישורים נשמרו בתיק');
    } catch (error) { showError('שגיאה בשמירה: ' + errMsg(error)); }
  });
  on('labCalcPrepay', () => labRun('prepay', (l) => api.calcLabPrepayment({ tracks: l.editors.prepay })));
  // התוויות נשמרות עם התוצאה — לפי המסלולים שנשלחו (אחרי סינון שורות ריקות), לא לפי העורך כפי שהוא עכשיו
  on('labCalcOpt', () => labRun('opt', async (l) => {
    const blocks = labTracks(l.editors.opt);
    const r = await api.calcLabOptimize({ amount: l.form.oAmount, blocks, objective: l.form.oObjective, maxMonthlyPayment: l.form.oCap, stepPct: l.form.oStep, monthlyNetIncome: l.form.monthlyNetIncome, propertyValue: l.form.propertyValue, buyerType: l.form.buyerType });
    return r && { ...r, blockTypes: blocks.map(b => b.type) };
  }));

  on('labAddAppr', () => { labCollect(); if (lab.approvals.length >= 10) return; lab.approvals.push({ lender: '', validUntil: '', fees: '', maxAmount: '', tracks: labShares(labDefaultMix(), [34, 33, 33]) }); renderView('mortgage-lab'); });
  document.querySelectorAll('[data-lab-delappr]').forEach(b => b.addEventListener('click', () => { labCollect(); lab.approvals.splice(Number(b.dataset.labDelappr), 1); renderView('mortgage-lab'); }));

  on('labSaveScenario', async () => {
    labCollect();
    try {
      await api.saveLabScenario({ name: lab.form.scenarioName, clientId: lab.form.scenarioClient, startDate: lab.form.scenarioStart, tracks: labTracks(lab.editors.mix) });
      showToast('התרחיש נשמר');
      await switchView('mortgage-lab');
    } catch (error) { showError('שגיאה בשמירה: ' + errMsg(error)); }
  });
  document.querySelectorAll('[data-lab-load]').forEach(b => b.addEventListener('click', () => {
    const s = ((state.data.mortgageLab || {}).scenarios || []).find(x => x.id === b.dataset.labLoad);
    if (!s) return;
    // בלי termMonths: "שנים" שעל המסך הוא מקור התקופה, ושינוי שלהן חייב להשפיע (סקירת קוד 2.11.2026)
    lab.editors.mix = s.tracks.map(({ termMonths, ...t }) => {
      const row = { ...t, years: t.years != null ? t.years : Math.round(termMonths / 12) };
      labPruneRow(row);
      return row;
    });
    lab.results.mix = null;
    lab.tab = 'mix';
    renderView('mortgage-lab');
  }));
  document.querySelectorAll('[data-lab-export]').forEach(b => b.addEventListener('click', async () => {
    try { const r = await api.exportLabScenario(b.dataset.labExport); if (r && r.ok) showToast('לוח הסילוקין נשמר'); }
    catch (error) { showError('שגיאה בייצוא: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-lab-delscn]').forEach(b => b.addEventListener('click', async () => {
    if (!(await askConfirm('למחוק את התרחיש?'))) return;
    try { await api.deleteLabScenario(b.dataset.labDelscn); showToast('התרחיש נמחק'); await switchView('mortgage-lab'); }
    catch (error) { showError('שגיאה במחיקה: ' + errMsg(error)); }
  }));

  on('labSaveForecast', async () => {
    labCollect();
    const f = lab.form;
    try {
      await api.saveLabForecast({ source: f.fSource, publishedAt: f.fDate, boiPct: f.fBoi, inflationAnnualPct: f.fInfl, anchorKey: f.fAnchorKey, anchorPct: f.fAnchor, rateConvention: f.fConvention });
      lab.results = {};
      showToast('התחזית נשמרה');
      await switchView('mortgage-lab');
    } catch (error) { showError('שגיאה בשמירת התחזית: ' + errMsg(error)); }
  });
  on('labResetForecast', async () => {
    if (!(await askConfirm('לחזור לנתוני ההדגמה? התחזית שהוזנה תימחק.'))) return;
    try { await api.resetLabForecast(); lab.results = {}; showToast('חזרה לנתוני ההדגמה'); await switchView('mortgage-lab'); }
    catch (error) { showError('שגיאה: ' + errMsg(error)); }
  });
  document.querySelectorAll('[data-lab-verify]').forEach(b => b.addEventListener('click', async () => {
    const note = await labAskNote('אימות כלל רגולטורי');
    if (!note) return;
    try { await api.verifyLabRule(b.dataset.labVerify, note); showToast('הכלל סומן כמאומת'); await switchView('mortgage-lab'); }
    catch (error) { showError('שגיאה באימות: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-lab-unverify]').forEach(b => b.addEventListener('click', async () => {
    if (!(await askConfirm('לבטל את אימות הכלל?'))) return;
    try { await api.unverifyLabRule(b.dataset.labUnverify); showToast('האימות בוטל'); await switchView('mortgage-lab'); }
    catch (error) { showError('שגיאה: ' + errMsg(error)); }
  }));
}
