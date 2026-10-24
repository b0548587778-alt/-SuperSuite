// שמאי — חישובי השמאות בלי DOM (זהב, כסף, יהלומים, שעונים, יודאיקה, מטבעות, טלפון, אמנות, שטיח, סקראפ, מס רכישה), משותפים למסך וליומן. נבדק ב-tests/shamai-appraisal.test.js וב-tests/audit-shamai.test.js
'use strict';

// מחיר לגרם טהור (USD) לפי מחיר לאונקיה
function pricePerPureGramUsd(spotUsdPerOz) {
  return spotUsdPerOz / TROY_OZ;
}

function toGrams(weight, unit) {
  return unit === 'oz' ? weight * TROY_OZ : unit === 'kg' ? weight * 1000 : weight;
}

// זהב / כסף: purity כשבר (0.750), סקראפ = 70% מההתכה
function goldValue({ weight, unit, purity, spotUsd, usdIls, scrap }) {
  const grams = toGrams(weight, unit);
  const perGramUsd = pricePerPureGramUsd(spotUsd);
  const pureGrams = grams * purity;
  const meltUsd = pureGrams * perGramUsd;
  const meltIls = meltUsd * usdIls;
  const f = scrap ? 0.70 : 1;
  return { grams, pureGrams, perGramUsd, perGramIls: perGramUsd * usdIls, meltUsd, meltIls, payUsd: meltUsd * f, payIls: meltIls * f };
}

// כסף לפי אלפיות (925) — בשקלים
function silverIls(grams, purityPpt, prices) {
  return grams * (purityPpt / 1000) * pricePerPureGramUsd(prices.silver) * prices.usdIls;
}

const findMult = (list, k) => list.find((x) => x.k === k)?.mult ?? 1;

// יהלום: מחיר בסיס לקראט × מקדמים; סיטונאי = 65%; מעבדה = 25%. null מתחת ל-0.30 קראט
function diamondValue(d, carat, usdIls) {
  if (!carat || carat < 0.30) return null;
  const bracket = DIAMOND_BASE_PRICES.find((b) => carat >= b.min && carat <= b.max);
  if (!bracket) return null;
  const pricePerCarat = bracket.price
    * findMult(DIAMOND_COLORS, d.color) * findMult(DIAMOND_CLARITY, d.clarity) * findMult(DIAMOND_CUTS, d.cut)
    * findMult(DIAMOND_SHAPES, d.shape) * findMult(DIAMOND_FLUOR, d.fluor) * findMult(DIAMOND_CERTS, d.cert)
    * (d.origin === 'lab' ? 0.25 : 1.00);
  const retailUsd = pricePerCarat * carat;
  const wholesaleUsd = retailUsd * 0.65;
  return { pricePerCarat, retailUsd, wholesaleUsd, retailIls: retailUsd * usdIls, wholesaleIls: wholesaleUsd * usdIls };
}

// שעון: שוק = מחיר יד שנייה × מצב × אבזור × שירות; לסוחר = שוק × 0.78 × (0.85 + נזילות × 0.15)
function watchValue(w) {
  const brand = WATCH_BRANDS.find((b) => b.k === w.brand) || WATCH_BRANDS[WATCH_BRANDS.length - 1];
  const cond = WATCH_CONDITIONS[w.condition] || WATCH_CONDITIONS.excellent;
  const papers = WATCH_PAPERS[w.papers] || WATCH_PAPERS.full;
  const service = WATCH_SERVICE[w.service] || WATCH_SERVICE.medium;
  const estValue = w.retail * cond.mult * papers.mult * service.mult;
  const wholesale = estValue * 0.78 * (0.85 + brand.liquidity * 0.15);
  return { brand, cond, papers, service, estValue, wholesale };
}

// יודאיקה ועתיקות: שוק × מצב × הולמרק × מקור (1.25) × חתימה (1.15) × נדירות (1.5); רכישה = 55%
function antiqueValue(a) {
  const condMult = findMult(CONDITIONS, a.condition);
  const hallmarkMult = findMult(HALLMARKS, a.hallmark);
  const value = a.market * condMult * hallmarkMult * (a.prov ? 1.25 : 1) * (a.signed ? 1.15 : 1) * (a.rare ? 1.50 : 1);
  return { condMult, hallmarkMult, value, maxPurchase: value * 0.55 };
}

// סכום בשקלים ← מעוגל לאגורה שלמה (CLAUDE.md, כלל 1), לשמירה ביומן. null — אין סכום
function roundMoney(x) {
  const n = Number(x);
  return x !== null && x !== '' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// החישובים הבאים משותפים למסך ולשמירה ביומן (saveCurrentAsOpp): פעם היומן חישב בנוסחאות אחרות,
// ונשמרה הערכה שונה מזו שבמסך (בדיקת קוד 23.10.2026, ממצא 15)

// טלפון: מחיר חדש × מצב × אחריות (1.10) × סוללה (90%+ 1.05, מתחת ל-80% 0.90) × נזילות המותג; לסוחר = 70%
function phoneValue(p) {
  const brand = PHONE_BRANDS.find((b) => b.k === p.brand) || PHONE_BRANDS[PHONE_BRANDS.length - 1];
  const cond = PHONE_CONDITIONS.find((c) => c.k === p.condition) || PHONE_CONDITIONS.find((c) => c.k === 'excellent');
  const warrantyMult = p.warranty === 'active' ? 1.10 : 1.00;
  const batteryMult = p.battery && p.battery >= 90 ? 1.05 : p.battery && p.battery < 80 ? 0.90 : 1.00;
  const liquidity = brand.liquidity;
  const estValue = p.retail * cond.mult * warrantyMult * batteryMult * liquidity;
  return { brand, cond, warrantyMult, batteryMult, liquidity, estValue, maxPurchase: estValue * 0.70 };
}

// אמנות: מחיר שוק × טכניקה × מצב × חתימה (1.30) × מקור (1.25) × מסגרת (1.10) × תערוכה (1.20); רכישה = 50%
function artValue(a) {
  const techMult = findMult(ART_TECHNIQUES, a.technique);
  const condMult = findMult(CONDITIONS, a.condition);
  const estValue = a.market * techMult * condMult * (a.signed ? 1.30 : 1) * (a.prov ? 1.25 : 1) * (a.frame ? 1.10 : 1) * (a.exhibited ? 1.20 : 1);
  return { techMult, condMult, estValue, maxPurchase: estValue * 0.50 };
}

// שטיח: מ"ר × מחיר בסיס לפי חומר × אזור × מצב × גיל × צפיפות קשרים (KPSI/200, בין 0.5 ל-2); רכישה = 50%
const RUG_BASE_PER_SQM = { silk: 12000, 'silk-wool': 6000, wool: 2500, 'wool-cotton': 1500, cotton: 600 };
function rugValue(rg) {
  const sqm = (rg.length * rg.width) / 10000;
  const basePerSqm = RUG_BASE_PER_SQM[rg.material] || 1500;
  const regionMult = findMult(RUG_REGIONS, rg.region);
  const condMult = findMult(CONDITIONS, rg.condition);
  const ageMult = rg.age === 'antique' ? 1.50 : rg.age === 'semi' ? 1.10 : 1.00;
  const kpsiMult = rg.kpsi ? Math.min(2.0, Math.max(0.5, rg.kpsi / 200)) : 1;
  const baseValue = sqm * basePerSqm;
  const estValue = baseValue * regionMult * condMult * ageMult * kpsiMult;
  return { sqm, basePerSqm, regionMult, condMult, ageMult, kpsiMult, baseValue, estValue, maxPurchase: estValue * 0.50 };
}

// סקראפ: מחיר לק"ג שהוקלד, ואם לא — ממחיר ברירת המחדל לליברה; לסוחר = שוק × מקדם הסוחר. null — סוג לא מוכר
function scrapValue(s, usdIls) {
  const type = SCRAP_TYPES.find((t) => t.k === s.type);
  if (!type) return null;
  const weightKg = s.unit === 'ton' ? s.weight * 1000 : s.weight;
  const pricePerKg = s.priceKg > 0 ? s.priceKg : type.pricePerLb * usdIls / POUND;
  const marketValue = weightKg * pricePerKg;
  return { type, weightKg, pricePerKg, marketValue, dealerPay: marketValue * type.dealerMargin };
}

// מטבע: הגבוה מבין התכה לבין התכה × פרמיה × דירוג; רכישה = 65%
function coinValue(c, prices) {
  let meltIls = 0;
  if (c.weight > 0 && (c.metal === 'gold' || c.metal === 'silver')) {
    const spotUsd = c.metal === 'gold' ? prices.gold : prices.silver;
    meltIls = c.weight * (c.purity / 1000) * pricePerPureGramUsd(spotUsd) * prices.usdIls;
  }
  const gradeMult = findMult(COIN_GRADES, c.grade);
  const value = Math.max(meltIls, meltIls * c.premium * gradeMult);
  return { meltIls, gradeMult, value, maxPurchase: value * 0.65 };
}

// מס רכישה לפי המדרגות המובנות (PURCHASE_TAX_TABLE ב-core.js — לא מאומתת). באגורות: כל מדרגה מעוגלת לאגורה.
// הפונקציה היחידה שמחשבת את המס — גם בכלי "מסי נדל"ן" וגם במסך הנדל"ן. פעם שני המסכים קראו שדות limit ו-from,
// שאינם בטבלה: דירה יחידה יצאה 0 ₪, ובנדל"ן כל שיעור הוחל על מלוא הערך (בדיקת קוד 23.10.2026, ממצא 14).
// עולה חדש — אין בטבלה מדרגות שלו: null (פעם "הנחה של 50%" שאינה כלל אמיתי)
function purchaseTaxBreakdown(value, status) {
  if (status !== 'single' && status !== 'additional') return null;
  const valueAg = Math.round(Number(value) * 100);
  const rows = [];
  let prevAg = 0, taxAg = 0;
  if (!(valueAg > 0)) return { valueAg: 0, taxAg: 0, rows };
  for (const b of status === 'single' ? PURCHASE_TAX_SINGLE : PURCHASE_TAX_ADDITIONAL) {
    if (valueAg <= prevAg) break;
    const topAg = b.upTo === Infinity ? Infinity : Math.round(b.upTo * 100);
    const portionAg = Math.min(valueAg, topAg) - prevAg;
    const partAg = Math.round(portionAg * b.rate);
    rows.push({ fromAg: prevAg, toAg: topAg, rate: b.rate, portionAg, taxAg: partAg });
    taxAg += partAg;
    prevAg = topAg;
  }
  return { valueAg, taxAg, rows };
}

// בשקלים (מעוגל לאגורה), או null כשאין חישוב לסטטוס הזה
function calcPurchaseTax(value, status) {
  const b = purchaseTaxBreakdown(value, status);
  return b ? b.taxAg / 100 : null;
}

const purchaseTaxWarning = () => `⚠ טבלת מדרגות לשנת ${PURCHASE_TAX_TABLE.year}${PURCHASE_TAX_TABLE.verified ? '' : ' — לא מאומתת: לבדוק מול מחשבון מס רכישה של רשות המסים לפני הסתמכות'}`;
