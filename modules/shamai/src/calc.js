// שמאי — חישובי השמאות בלי DOM (זהב, כסף, יהלומים, שעונים, יודאיקה, מטבעות). נבדק ב-tests/shamai-appraisal.test.js
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
