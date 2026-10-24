// שמאי — "מאין הסכום?" פאנל הסבר ליד תוצאת השמאות, ובדיקת שדות חסרים. חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  EXPLAIN — "מאין הסכום?", בדיקת שדות חסרים וניסוח החישוב
//  הפאנל מציג את אותם המספרים שהחישוב עצמו (src/calc.js) החזיר, ואינו מחשב מחדש.
//  מספר מוצג בפאנל רק כשהוא מוצג גם בתוצאה — כדי שלא יימצאו שניים שונים לאותו שדה.
// ─────────────────────────────────────────────────────────────────────────────

// פאנל "מאין הסכום?" — steps: [{ label, value }]
// stays: פאנל של מחירי הבסיס — נשאר פתוח תמיד, גם אחרי עריכת משקל או תעריף
const EXPLAIN_STAYS_CLASS = 'explain-stays';

function explainPanel(steps, opts = {}) {
  const list = (steps || []).filter((s) => s && s.label);
  if (!list.length) return '';
  const cls = opts.stays ? ` ${EXPLAIN_STAYS_CLASS}` : '';
  return `<details class="explain${cls}">
    <summary>מאין הסכום?</summary>
    <ol class="explain-steps">
      ${list.map((s) => `<li><span class="explain-label">${escapeHtml(String(s.label))}</span>
        <span class="explain-value">${escapeHtml(String(s.value ?? '—'))}</span></li>`).join('')}
    </ol>
  </details>`;
}

// שדות חסרים: checks = [{ key, label, what }] — what: מה נעשה בלי השדה (ולא ניחוש)
function missingFieldWarnings(input, checks) {
  const data = input || {};
  const warnings = [];
  for (const c of checks || []) {
    const v = data[c.key];
    // NaN — שדה מספרי ריק (parseFloat של ''), גם הוא חסר
    const empty = v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v)) || String(v).trim() === '';
    if (empty) warnings.push({ key: c.key, label: c.label || c.key, what: c.what || 'החישוב התבצע בלעדיו' });
  }
  return warnings;
}

// אזהרות על שדות חסרים — לא מוסיפות ולא משנות מספר בתוצאה, רק מזהירות
function missingFieldPanel(warnings) {
  const list = (warnings || []).filter((w) => w && w.label);
  if (!list.length) return '';
  return `<div class="explain-missing">
    <ul>${list.map((w) => `<li><strong>${escapeHtml(String(w.label))}</strong>${w.what ? ` — ${escapeHtml(String(w.what))}` : ''}</li>`).join('')}</ul>
  </div>`;
}

// אחרי רינדור מחדש של התוצאה: הפאנל שהיה פתוח נשאר פתוח (המצב ב-state.explainOpen)
// הפאנלים נלקחים דרך $$ של core.js (עם השורש) — לא querySelectorAll ישיר על האלמנט
function explainAttach(resultSel) {
  const box = $(resultSel);
  if (!box) return;
  const panels = $$('.explain', box);
  const panel = panels.find((p) => !p.classList.contains(EXPLAIN_STAYS_CLASS));
  for (const p of panels) {
    if (p === panel) p.open = state.explainOpen === true; else p.open = true;
  }
  if (panel) panel.addEventListener('toggle', () => { state.explainOpen = panel.open; });
}

// מכפיל מתוך רשימה — כמו findMult ב-calc.js
const explainMult = (list, k) => list.find((x) => x.k === k)?.mult ?? 1;

// ── זהב וכסף ──
// v: goldValue; w: המשקל שהוקלד — 0/ריק ← אין תוצאה
function explainGold(g, v, askingIls) {
  const isGold = g.metal === 'gold';
  const spotUsd = isGold ? state.prices.gold : state.prices.silver;
  const steps = [
    { label: 'מחיר מתכת טהורה', value: `$${fmt(spotUsd)} לאונקיה (מחירון התוכנה)` },
    { label: 'גרם באונקיה', value: `${fmt(TROY_OZ, 2)} גרם` },
    { label: 'מחיר לגרם טהור (USD)', value: `$${fmt(v.perGramUsd)} (מחיר לאונקיה ÷ 31.1)` },
    { label: 'שער המרה', value: `1$ = ₪${fmt(state.prices.usdIls)}` },
    { label: 'מחיר לגרם טהור (₪)', value: `₪${fmt(v.perGramIls)}` },
    { label: 'משקל', value: `${fmt(v.grams, 2)} גרם` },
    { label: 'מתכת טהורה', value: `${fmt(v.pureGrams, 2)} גרם (משקל × טוהר)` },
    { label: 'שווי התכה', value: `₪${fmt0(v.meltIls)} (מתכת טהורה × מחיר לגרם)` },
  ];
  if (g.scrap) steps.push({ label: 'מצב סקראפ', value: '70% מהתכה — 30% מופחתים על עיבוד והתכה' });
  if (askingIls) steps.push({ label: 'רווח/הפסד', value: `מחיר הרכישה פחות המחיר המבוקש (₪${fmt0(askingIls)})` });
  const checks = [{ key: 'weight', label: 'משקל', what: 'בלי משקל אין חישוב' }];
  return missingFieldPanel(missingFieldWarnings({ weight: v.grams }, checks)) + explainPanel(steps, { stays: true });
}

// ── יהלומים ──
// d: state.diamond; carat: מה שהוקלד — מתחת ל-0.30 אין תוצאה
function explainDiamond(d, carat, v, askingIls) {
  const shapeName = DIAMOND_SHAPES.find((s) => s.k === d.shape)?.name || d.shape;
  const certName = DIAMOND_CERTS.find((c) => c.k === d.cert)?.name || d.cert;
  const steps = [
    { label: 'קראט', value: fmt(carat, 2) },
    { label: 'צבע', value: `${d.color} × ${fmt(explainMult(DIAMOND_COLORS, d.color))}` },
    { label: 'ניקיון', value: `${d.clarity} × ${fmt(explainMult(DIAMOND_CLARITY, d.clarity))}` },
    { label: 'ליטוש', value: `${d.cut} × ${fmt(explainMult(DIAMOND_CUTS, d.cut))}` },
    { label: 'צורה', value: `${shapeName} × ${fmt(explainMult(DIAMOND_SHAPES, d.shape))}` },
    { label: 'פלואורסנציה', value: `${d.fluor} × ${fmt(explainMult(DIAMOND_FLUOR, d.fluor))}` },
    { label: 'תעודה', value: `${certName} × ${fmt(explainMult(DIAMOND_CERTS, d.cert))}` },
    { label: 'מעבדה', value: d.origin === 'lab' ? '× 0.25 לעומת טבעי' : 'טבעי — בלי הפחתה' },
    { label: 'מחיר לקראט', value: `$${fmt0(v.pricePerCarat)} (מחיר הבסיס לקראט × כל המקדמים)` },
    { label: 'קמעונאי', value: `₪${fmt0(v.retailIls)} (מחיר לקראט × קראט × שער)` },
    { label: 'סיטונאי', value: `₪${fmt0(v.wholesaleIls)} (65% מהקמעונאי)` },
  ];
  if (askingIls) steps.push({ label: 'רווח (לעומת סיטוני)', value: `סיטונאי פחות המחיר המבוקש (₪${fmt0(askingIls)})` });
  return explainPanel(steps, { stays: true });
}

// ── שעונים ──
// w.retail: מחיר היד השנייה שהוקלד (₪); v: watchValue
function explainWatch(w, v) {
  const steps = [
    { label: 'מחיר יד שנייה שהוקלד', value: `₪${fmt0(w.retail)}` },
    { label: 'מותג', value: `${v.brand.name} — נזילות ${fmt0(v.brand.liquidity * 100)}%` },
    { label: 'מצב', value: `${v.cond.name} × ${fmt(v.cond.mult)}` },
    { label: 'אבזרים', value: `${v.papers.name} × ${fmt(v.papers.mult)}` },
    { label: 'שירות', value: `${v.service.name} × ${fmt(v.service.mult)}` },
    { label: 'שווי שוק', value: `₪${fmt0(v.estValue)} (המחיר שהוקלד × כל המקדמים)` },
    { label: 'לסוחר', value: `₪${fmt0(v.wholesale)} (שווי השוק × 78% × (85% + נזילות × 15%))` },
  ];
  if (w.asking) steps.push({ label: 'רווח (סיטוני)', value: `מחיר הסוחר פחות המחיר המבוקש (₪${fmt0(w.asking)})` });
  const checks = [{ key: 'retail', label: 'מחיר יד שנייה', what: 'בלי מחיר יד שנייה אין הערכה' }];
  return missingFieldPanel(missingFieldWarnings(w, checks)) + explainPanel(steps, { stays: true });
}

// ── יודאיקה ועתיקות ──
// a.market: מחיר שוק שהוקלד (₪); v: antiqueValue
function explainAntique(a, v) {
  const steps = [
    { label: 'מחיר שוק שהוקלד', value: `₪${fmt0(a.market)}` },
    { label: 'מצב', value: `× ${fmt(v.condMult)}` },
    { label: 'הולמרק', value: `× ${fmt(v.hallmarkMult)}` },
    { label: 'מקור מתועד', value: a.prov ? '× 1.25' : 'לא — בלי תוספת' },
    { label: 'חתימה', value: a.signed ? '× 1.15' : 'לא — בלי תוספת' },
    { label: 'נדירות', value: a.rare ? '× 1.5' : 'לא — בלי תוספת' },
    { label: 'שווי', value: `₪${fmt0(v.value)}` },
    { label: 'רכישה מומלצת', value: `₪${fmt0(v.maxPurchase)} (55% מהשווי)` },
  ];
  if (a.asking) steps.push({ label: 'פוטנציאל רווח', value: `השווי פחות המחיר המבוקש (₪${fmt0(a.asking)})` });
  const checks = [{ key: 'market', label: 'מחיר שוק', what: 'בלי מחיר שוק אין הערכה' }];
  return missingFieldPanel(missingFieldWarnings(a, checks)) + explainPanel(steps, { stays: true });
}

// ── מטבעות ──
// v: coinValue; prices: state.prices
function explainCoin(c, prices, v) {
  // מטבע זהב או כסף בלי משקל — מתכת יקרה שחסר לה משקל, לא "לא ממתכת יקרה" (בדיקת קוד 23.10.2026)
  const precious = c.metal === 'gold' || c.metal === 'silver';
  const isMetal = precious && c.weight > 0;
  const steps = [];
  if (isMetal) {
    const spotUsd = c.metal === 'gold' ? prices.gold : prices.silver;
    steps.push({ label: 'משקל', value: `${fmt(c.weight, 2)} גרם` });
    steps.push({ label: 'טוהר', value: `${fmt0(c.purity)}/1000` });
    steps.push({ label: 'מחיר המתכת', value: `$${fmt(spotUsd)} לאונקיה, 1$ = ₪${fmt(prices.usdIls)}` });
    steps.push({ label: 'שווי התכה', value: `₪${fmt0(v.meltIls)} (משקל × טוהר × מגרם לאונקיה × שער)` });
  } else if (precious) {
    steps.push({ label: 'אין משקל מתכת', value: 'לא הוזן משקל — אין שווי התכה' });
  } else {
    steps.push({ label: 'אין משקל מתכת', value: 'המטבע לא ממתכת יקרה — אין שווי התכה' });
  }
  steps.push({ label: 'פרמיה שהוקלדה', value: `× ${fmt(c.premium)}` });
  steps.push({ label: 'מקדם דירוג', value: `${c.grade} × ${fmt(v.gradeMult)}` });
  steps.push({ label: 'שווי', value: `₪${fmt0(v.value)} (הגבוה מבין שווי ההתכה לבין שווי ההתכה × פרמיה × דירוג)` });
  steps.push({ label: 'רכישה מקסימלית', value: `₪${fmt0(v.maxPurchase)} (65% מהשווי)` });
  if (c.asking) steps.push({ label: 'פוטנציאל רווח', value: `השווי פחות המחיר המבוקש (₪${fmt0(c.asking)})` });
  const checks = [];
  if (precious) checks.push({ key: 'weight', label: 'משקל', what: 'בלי משקל אין שווי התכה — רק פרמיה' });
  return missingFieldPanel(missingFieldWarnings(c, checks)) + explainPanel(steps, { stays: true });
}
