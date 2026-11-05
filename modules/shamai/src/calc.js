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

// מדרגת המחיר של משקל: המדרגה האחרונה שהמשקל הגיע לתחילתה — בלי פערים. פעם 0.995 או 1.495 קראט נפלו
// בין max של מדרגה ל-min של הבאה, והתוצאה הייתה ריקה בלי הודעה (סקירת קוד 2.11.2026)
function diamondBracket(carat) {
  let found = null;
  for (const b of DIAMOND_BASE_PRICES) if (carat >= b.min) found = b;
  return found;
}

// יהלום: מחיר בסיס לקראט × מקדמים; סיטונאי = 65%; מעבדה = 25%. null מתחת ל-0.30 קראט
function diamondValue(d, carat, usdIls) {
  if (!carat || carat < 0.30) return null;
  const bracket = diamondBracket(carat);
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

// מחיר לליברה של סוג סקראפ: נחושת / אלומיניום — נגזר מהמחיר בלוח המחירים (באותו יחס לברירת המחדל),
// ולא מהקבוע: פעם עדכון מחיר הנחושת בלוח לא השפיע בכלל (סקירת קוד 2.11.2026). שאר הסוגים — ערך ייחוס קבוע
function scrapPricePerLb(type, prices) {
  const board = type.base && prices ? Number(prices[type.base]) : NaN;
  const ref = type.base ? DEFAULT_PRICES[type.base] : 0;
  return board > 0 && ref > 0 ? type.pricePerLb * board / ref : type.pricePerLb;
}

// סקראפ: מחיר לק"ג שהוקלד, ואם לא — מהמחיר בלוח (scrapPricePerLb); לסוחר = שוק × מקדם הסוחר. null — סוג לא מוכר.
// prices — state.prices (מספר — שער הדולר בלבד, כמו בגרסה קודמת)
function scrapValue(s, prices) {
  const type = SCRAP_TYPES.find((t) => t.k === s.type);
  if (!type) return null;
  const p = typeof prices === 'number' ? { usdIls: prices } : (prices || {});
  const weightKg = s.unit === 'ton' ? s.weight * 1000 : s.weight;
  const pricePerLb = scrapPricePerLb(type, p);
  const pricePerKg = s.priceKg > 0 ? s.priceKg : pricePerLb * p.usdIls / POUND;
  const marketValue = weightKg * pricePerKg;
  return { type, weightKg, pricePerLb, pricePerKg, marketValue, dealerPay: marketValue * type.dealerMargin };
}

// רכב: מחירון × נזילות × מצב × יד × קילומטראז' × מאפיינים; לסוחר = 85%. אותה פונקציה למסך ולפנקס.
// גיל — שנה אחת לפחות: פעם רכב משנת הייצור הנוכחית קיבל ממוצע 0 ק"מ, וכל קילומטר נחשב חריגה של 15%
// (סקירת קוד 2.11.2026). nowYear — מוזרק בבדיקות
function vehicleValue(v, nowYear = new Date().getFullYear()) {
  const liquidity = VEHICLE_BRANDS.find((b) => b.k === v.brand)?.liquidity ?? 0.7;
  const condMult = VEHICLE_CONDITIONS.find((c) => c.k === v.condition)?.mult ?? 1;
  const handMult = { '1': 1.05, '2': 1.00, '3': 0.92, '4+': 0.80 }[v.hand] ?? 1;
  let kmMult = 1;
  if (v.km && v.year) {
    const age = Math.max(1, nowYear - v.year);
    const avgKm = 15000 * age;
    if (v.km > avgKm * 1.5) kmMult = 0.85;
    else if (v.km > avgKm * 1.2) kmMult = 0.92;
    else if (v.km < avgKm * 0.7) kmMult = 1.05;
  }
  const featMult = (v.test ? 1.03 : 1) * (v.accident ? 0.75 : 1) * (v.private ? 1.05 : 1) * (v.service ? 1.04 : 1);
  const estValue = (v.list || 0) * liquidity * condMult * handMult * kmMult * featMult;
  return { liquidity, condMult, handMult, kmMult, featMult, estValue, maxBuy: estValue * 0.85 };
}

const coinIsPrecious = (c) => c.metal === 'gold' || c.metal === 'silver';

// מטבע מזהב או מכסף: הגבוה מבין התכה לבין התכה × פרמיה × דירוג; רכישה = 65%.
// מטבע מנחושת או ממתכת אחרת — אין ערך התכה: מחיר השוק שהשמאי הקליד × דירוג. פעם יצא תמיד ₪0,
// גם עם פרמיה ×50 (סקירת קוד 2.11.2026). פרמיה לא תקינה ← ×1.5; 0 = "אין פרמיה"
function coinValue(c, prices) {
  const gradeMult = findMult(COIN_GRADES, c.grade);
  const premium = Number.isFinite(c.premium) && c.premium >= 0 ? c.premium : 1.5;
  if (!coinIsPrecious(c)) {
    const market = Number(c.market) > 0 ? Number(c.market) : 0;
    const value = market * gradeMult;
    return { meltIls: 0, gradeMult, value, maxPurchase: value * 0.65, needsMarket: !market };
  }
  let meltIls = 0;
  if (c.weight > 0) {
    const spotUsd = c.metal === 'gold' ? prices.gold : prices.silver;
    meltIls = c.weight * (c.purity / 1000) * pricePerPureGramUsd(spotUsd) * prices.usdIls;
  }
  const value = Math.max(meltIls, meltIls * premium * gradeMult);
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
