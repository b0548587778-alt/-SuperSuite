// שמאי — תיק שמאות מקצועי לזהב, תכשיטים ומטלטלין: לקוח, מטרה, בסיס שווי, פריטים מורכבים (מתכת + אבנים), נעילה וגרסאות.
'use strict';
// חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד). כאן הלוגיקה בלבד, בלי DOM — נבדקת ב-tests/shamai-casefile.test.js.
// כסף: אגורות שלמות (ILS), ובמטבע זר — סנטים/פני שלמים. ההמרה לשקלים לפי שער שהוקלד (prices.usdIls / eurIls / gbpIls), עיגול לכל רכיב.
// אין פנייה לרשת: מחירי מתכות ושערים מגיעים רק מ-src/prices.js (הקלדה או קובץ).

const CASE_CURRENCIES = {
  ILS: { sym: '₪', rateKey: null, he: 'שקל', en: 'ILS' },
  USD: { sym: '$', rateKey: 'usdIls', he: 'דולר', en: 'USD' },
  EUR: { sym: '€', rateKey: 'eurIls', he: 'אירו', en: 'EUR' },
  GBP: { sym: '£', rateKey: 'gbpIls', he: 'לירה שטרלינג', en: 'GBP' },
};

// מטרת השמאות — משפיעה על בסיס השווי המתאים
const CASE_PURPOSES = {
  insurance: { he: 'ביטוח', en: 'Insurance', basis: 'replacement' },
  sale: { he: 'מכירה או קנייה', en: 'Sale or purchase', basis: 'market' },
  estate: { he: 'עיזבון וירושה', en: 'Estate and inheritance', basis: 'market' },
  division: { he: 'חלוקת רכוש', en: 'Division of property', basis: 'market' },
  collateral: { he: 'בטוחה להלוואה', en: 'Loan collateral', basis: 'liquidation' },
  other: { he: 'אחר', en: 'Other', basis: 'market' },
};

// בסיס השווי — ההגדרות נכתבו כאן בניסוח עצמאי (לא ציטוט של תקן)
const CASE_BASES = {
  market: {
    he: 'שווי שוק', en: 'Market value',
    defHe: 'הסכום המוערך שבו הפריט היה עובר במועד הקובע בין קונה מרצון למוכר מרצון, בעסקה רגילה, אחרי שיווק מתאים, כששני הצדדים פועלים בידיעה, בזהירות ובלי כפייה.',
    defEn: 'The estimated amount for which the item would exchange on the valuation date between a willing buyer and a willing seller in an arm\'s-length transaction, after proper marketing, where both parties acted knowledgeably, prudently and without compulsion.',
  },
  replacement: {
    he: 'שווי החלפה (לביטוח)', en: 'Replacement value (insurance)',
    defHe: 'העלות לרכישת פריט דומה בסוג, באיכות ובמצב, בשוק הקמעונאי הרגיל, במועד הקובע.',
    defEn: 'The cost to acquire a comparable item of similar kind, quality and condition in the normal retail market on the valuation date.',
  },
  liquidation: {
    he: 'שווי מימוש', en: 'Liquidation value',
    defHe: 'הסכום שצפוי להתקבל במכירה בזמן קצר מהזמן הרגיל לשיווק פריט כזה.',
    defEn: 'The amount expected to be realised in a sale within a period shorter than the normal marketing period for such an item.',
  },
  melt: {
    he: 'ערך התכה', en: 'Melt value',
    defHe: 'שווי המתכת היקרה בלבד לפי המשקל הטהור ומחיר המתכת במועד הקובע, בלי ערך לעבודה, לעיצוב או לאבנים.',
    defEn: 'The value of the precious metal content only, by fine weight and the metal price on the valuation date, with no value for workmanship, design or stones.',
  },
};

// בדיקות שבוצעו (היקף העבודה)
const CASE_TESTS = {
  weighed: { he: 'שקילה במשקל אלקטרוני', en: 'Weighed on an electronic scale' },
  loupe: { he: 'בדיקה בזכוכית מגדלת', en: 'Examined under magnification' },
  measured: { he: 'מדידת מידות', en: 'Measured' },
  metalTest: { he: 'בדיקת מתכת (חומצה או מכשיר)', en: 'Metal tested (acid or instrument)' },
  hallmarks: { he: 'בדיקת חותמות וסימנים', en: 'Hallmarks and marks examined' },
  photographed: { he: 'צילום הפריטים', en: 'Items photographed' },
};

const CASE_CATEGORIES = {
  jewelry: { he: 'תכשיט', en: 'Jewelry' },
  gold: { he: 'זהב / כסף', en: 'Gold / silver' },
  watch: { he: 'שעון', en: 'Watch' },
  judaica: { he: 'יודאיקה', en: 'Judaica' },
  coin: { he: 'מטבע', en: 'Coin' },
  other: { he: 'מטלטלין אחר', en: 'Other chattel' },
};

const CASE_METALS = {
  gold: { he: 'זהב', en: 'Gold', purities: [999, 916, 875, 750, 585, 583, 417, 375] },
  silver: { he: 'כסף', en: 'Silver', purities: [999, 958, 925, 900, 835, 800] },
  platinum: { he: 'פלטינה', en: 'Platinum', purities: [999, 950, 900, 850] },
  palladium: { he: 'פלדיום', en: 'Palladium', purities: [999, 950, 500] },
};

// טוהר ברירת מחדל כשמחליפים מתכת בשורה
const CASE_DEFAULT_PURITY = { gold: 585, silver: 925, platinum: 950, palladium: 950 };

const CASE_STONES = {
  diamond: { he: 'יהלום', en: 'Diamond' },
  ruby: { he: 'אודם', en: 'Ruby' },
  sapphire: { he: 'ספיר', en: 'Sapphire' },
  emerald: { he: 'ברקת', en: 'Emerald' },
  pearl: { he: 'פנינה', en: 'Pearl' },
  other: { he: 'אבן אחרת', en: 'Other stone' },
};
const CASE_STONE_ORIGINS = {
  natural: { he: 'טבעית', en: 'Natural' },
  labGrown: { he: 'מעבדה (מתורבתת)', en: 'Laboratory-grown' },
  simulant: { he: 'חיקוי', en: 'Simulant' },
  unknown: { he: 'לא נקבע', en: 'Not determined' },
};
// איך זוהתה האבן — מופיע בדוח ליד כל אבן
const CASE_ID_METHODS = {
  lab: { he: 'תעודת מעבדה', en: 'Laboratory report' },
  observed: { he: 'בדיקת השמאי', en: 'Appraiser examination' },
  assumed: { he: 'לא נבדקה — הנחה', en: 'Not tested — assumed' },
};

const CASE_DEFAULT_ASSUMPTIONS_HE = [
  'ההערכה תקפה למועד הקובע בלבד.',
  'כל אבן מזוהה בשיטה שמצוינת לידה. אבן שסומנה "לא נבדקה" הוערכה לפי הנחה בלבד.',
  'משקל אבנים משובצות הוא הערכה לפי מידות, אלא אם צוין שהאבן נשקלה או שיש לה תעודת מעבדה.',
  'מחירי המתכות ושערי המטבע הוקלדו על ידי השמאי, מהמקור ובתאריך שמצוינים בדוח.',
  'הדוח מיועד למזמין ולמטרה שמצוינים בו בלבד, ואין להשתמש בו למטרה אחרת.',
].join('\n');
const CASE_DEFAULT_ASSUMPTIONS_EN = [
  'The valuation is valid as of the valuation date only.',
  'Each stone was identified by the method stated next to it. A stone marked "not tested" was valued on an assumption only.',
  'The weight of mounted stones is estimated from measurements unless stated as weighed or certified by a laboratory.',
  'Metal prices and exchange rates were entered by the appraiser from the source and on the date stated in this report.',
  'This report is intended only for the client and the purpose stated in it and may not be used for any other purpose.',
].join('\n');

const CASE_MAX_ITEMS = 100;
const CASE_MAX_METALS = 10;
const CASE_MAX_STONES = 30;
const CASE_MAX_PHOTOS = 6;
const CASE_MAX_PHOTO_CHARS = 400 * 1024; // תמונה דחוסה אחת ב-data:image
const caseTxt = (v, max) => String(v ?? '').trim().slice(0, max);
// תאריך אמיתי בלבד (Date.parse מקבל 2026-02-30 ומגלגל למרץ)
const caseIsDay = (v) => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};

// מספר עשרוני מהקלדה (פסיק או נקודה), או NaN
function caseNum(raw) {
  const s = normalizeNumText(raw);
  return s === null ? NaN : Number(s);
}

// סכום מוקלד ← יחידות שלמות (אגורות/סנטים), או null כשהשדה ריק. זורק על קלט שגוי
function caseMinor(raw, label) {
  if (raw === '' || raw === null || raw === undefined) return null;
  if (Number.isInteger(raw) && raw >= 0) return raw;
  const v = parseAgorot(raw);
  if (v === null) throw new Error(`${label}: יש להזין סכום`);
  return v;
}

// המרה לאגורות: סכום במטבע (יחידות שלמות) × השער שהוקלד
function caseToIlsAg(minor, currency, prices) {
  const cur = CASE_CURRENCIES[currency];
  if (!cur) throw new Error('מטבע לא מוכר');
  if (!cur.rateKey) return minor;
  const rate = Number(prices && prices[cur.rateKey]);
  if (!(rate > 0)) throw new Error(`חסר שער ${cur.he}`);
  return Math.round(minor * rate);
}

// מתכת בפריט: משקל × טוהר × מחיר (דולר לאונקיה) × שער הדולר ← אגורות
function caseMetalAg(m, prices, where) {
  const metal = CASE_METALS[m && m.metal];
  if (!metal) throw new Error(`${where}: מתכת לא מוכרת`);
  const purity = Number(m.purityPpt);
  if (!metal.purities.includes(purity)) throw new Error(`${where}: טוהר לא מוכר`);
  const grams = caseNum(m.grams);
  if (!(grams > 0 && grams <= 100000)) throw new Error(`${where}: יש להזין משקל בגרמים`);
  const spot = Number(prices && prices[m.metal]);
  const usdIls = Number(prices && prices.usdIls);
  if (!(spot > 0) || !(usdIls > 0)) throw new Error(`חסר מחיר ${metal.he} או שער דולר`);
  const fineGrams = grams * purity / 1000;
  return { metal: m.metal, purityPpt: purity, grams, fineGrams, valueAg: Math.round(fineGrams * spot / TROY_OZ * usdIls * 100) };
}

// אבן: כמות × (משקל בקראט × מחיר לקראט) או כמות × מחיר ליחידה, במטבע שנבחר ← אגורות
function caseStoneAg(st, prices, where) {
  if (!CASE_STONES[st && st.type]) throw new Error(`${where}: סוג אבן לא מוכר`);
  const count = Number(String(st.count ?? '1').trim() || '1');
  if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error(`${where}: כמות לא תקינה`);
  const perCarat = st.pricing !== 'perPiece';
  const carat = String(st.carat ?? '').trim() ? caseNum(st.carat) : NaN;
  if (perCarat && !(carat > 0 && carat <= 1000)) throw new Error(`${where}: יש להזין משקל בקראט`);
  if (!perCarat && String(st.carat ?? '').trim() && !(carat > 0 && carat <= 1000)) throw new Error(`${where}: משקל בקראט לא תקין`);
  const currency = CASE_CURRENCIES[st.currency] ? st.currency : 'USD';
  const price = caseMinor(st.price, where + ' מחיר');
  if (price === null) throw new Error(`${where}: יש להזין מחיר`);
  const idMethod = CASE_ID_METHODS[st.idMethod] ? st.idMethod : 'assumed';
  const totalMinor = Math.round(count * (perCarat ? carat * price : price));
  return {
    type: st.type, name: caseTxt(st.name, 60), count, carat: Number.isNaN(carat) ? null : carat,
    pricing: perCarat ? 'perCarat' : 'perPiece', currency, price, totalMinor,
    valueAg: caseToIlsAg(totalMinor, currency, prices),
    origin: CASE_STONE_ORIGINS[st.origin] ? st.origin : 'unknown',
    idMethod, lab: idMethod === 'lab' ? caseTxt(st.lab, 40) : '', certNo: idMethod === 'lab' ? caseTxt(st.certNo, 40) : '',
    shape: caseTxt(st.shape, 30), color: caseTxt(st.color, 30), clarity: caseTxt(st.clarity, 30), treatment: caseTxt(st.treatment, 60),
  };
}

// שווי פריט: מתכות + אבנים + עבודה + רכיב אחר. שווי שנקבע ידנית גובר רק עם נימוק.
// basis 'melt' — רק המתכת (בלי אבנים, עבודה ורכיב אחר)
function caseItemValue(item, prices, n = 1, basis = 'market') {
  const where = `פריט ${n}`;
  const metals = (Array.isArray(item.metals) ? item.metals : []).filter(m => String(m.grams ?? '').trim());
  const stones = (Array.isArray(item.stones) ? item.stones : []).filter(s => String(s.price ?? '').trim() || String(s.carat ?? '').trim());
  if (metals.length > CASE_MAX_METALS) throw new Error(`${where}: עד ${CASE_MAX_METALS} מתכות`);
  if (stones.length > CASE_MAX_STONES) throw new Error(`${where}: עד ${CASE_MAX_STONES} שורות אבנים`);
  const m = metals.map((x, i) => caseMetalAg(x, prices, `${where}, מתכת ${i + 1}`));
  const s = stones.map((x, i) => caseStoneAg(x, prices, `${where}, אבן ${i + 1}`));
  const labourAg = caseMinor(item.labour, `${where}: עבודה`) || 0;
  const otherAg = caseMinor(item.other, `${where}: רכיב אחר`) || 0;
  const metalAg = m.reduce((a, x) => a + x.valueAg, 0);
  const stoneAg = s.reduce((a, x) => a + x.valueAg, 0);
  const computedAg = basis === 'melt' ? metalAg : metalAg + stoneAg + labourAg + otherAg;
  const overrideAg = caseMinor(item.override, `${where}: שווי שנקבע`);
  const reason = caseTxt(item.overrideReason, 300);
  if (overrideAg !== null && !reason) throw new Error(`${where}: שווי שנקבע ידנית מחייב נימוק`);
  const valueAg = overrideAg !== null ? overrideAg : computedAg;
  return { metals: m, stones: s, metalAg, stoneAg, labourAg, otherAg, computedAg, overrideAg, overrideReason: overrideAg !== null ? reason : '', valueAg };
}

// סיכום התיק. מחזיר גם שגיאות לכל פריט, כדי שהמסך יציג את מה שאפשר
function caseTotals(c, prices) {
  const items = [], errors = [];
  (c.items || []).forEach((it, i) => {
    try { items.push({ id: it.id, ...caseItemValue(it, prices, i + 1, c.basis) }); }
    catch (e) { items.push(null); errors.push(e.message); }
  });
  const totalAg = items.reduce((a, x) => a + (x ? x.valueAg : 0), 0);
  return { items, errors, totalAg };
}

// סכום בשקלים ← מטבע הדוח (יחידות שלמות), לפי השער
function caseFromIlsAg(ag, currency, prices) {
  const cur = CASE_CURRENCIES[currency];
  if (!cur || !cur.rateKey) return ag;
  const rate = Number(prices && prices[cur.rateKey]);
  return rate > 0 ? Math.round(ag / rate) : null;
}

const caseMoney = (minor, currency = 'ILS') => (CASE_CURRENCIES[currency] || CASE_CURRENCIES.ILS).sym + fmt(minor / 100, 2);

// לקוח: שם חובה; מספר זהות — רשות, אבל אם הוקלד הוא חייב להיות תקין (ספרת ביקורת)
function caseValidateClient(cl) {
  const client = {
    name: caseTxt(cl && cl.name, 80), idNumber: caseTxt(cl && cl.idNumber, 9),
    phone: caseTxt(cl && cl.phone, 30), email: caseTxt(cl && cl.email, 80), address: caseTxt(cl && cl.address, 120),
  };
  if (!client.name) throw new Error('יש להזין את שם הלקוח');
  if (client.idNumber) {
    if (!isValidIsraeliIdNumber(client.idNumber)) throw new Error('מספר הזהות של הלקוח אינו תקין');
    client.idNumber = client.idNumber.padStart(9, '0');
  }
  return client;
}

// מפתח לקוח להיסטוריה: מספר זהות, ואם אין — השם המנורמל
function caseClientKey(client) {
  if (!client) return '';
  const id = String(client.idNumber || '').trim();
  if (id && isValidIsraeliIdNumber(id)) return 'id:' + id.padStart(9, '0');
  return 'name:' + String(client.name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function casesForClient(cases, key) {
  return (cases || []).filter(c => caseClientKey(c.client) === key);
}

// רשימת לקוחות מתוך התיקים: שם, מספר תיקים, תיק אחרון ושווי כולל של התיקים הסופיים
function caseClients(cases) {
  const map = new Map();
  for (const c of cases || []) {
    const k = caseClientKey(c.client);
    if (!k || k === 'name:') continue;
    const e = map.get(k) || { key: k, name: c.client.name, idNumber: c.client.idNumber || '', count: 0, last: '', finalAg: 0 };
    e.count++;
    if ((c.created || '') > e.last) { e.last = c.created || ''; e.name = c.client.name; }
    if (c.status === 'final' && c.frozen) e.finalAg += c.frozen.totalAg;
    map.set(k, e);
  }
  return [...map.values()].sort((a, b) => b.last.localeCompare(a.last));
}

// תיק חדש (טיוטה). המספר נקבע ביצירה ולא חוזר אחורה
function newCase(no, today = localToday(), client = null) {
  return {
    id: uid(), no, rev: 0, status: 'draft', created: new Date().toISOString(),
    client: client ? { ...client } : { name: '', idNumber: '', phone: '', email: '', address: '' },
    purpose: 'insurance', purposeOther: '', basis: 'replacement', currency: 'ILS', lang: 'he',
    inspectionDate: today, effectiveDate: today, tests: ['weighed', 'loupe', 'photographed'],
    scopeNote: '', assumptionsHe: CASE_DEFAULT_ASSUMPTIONS_HE, assumptionsEn: CASE_DEFAULT_ASSUMPTIONS_EN,
    items: [newCaseItem()], history: [],
  };
}

function newCaseItem() {
  return {
    id: uid(), category: 'jewelry', desc: '', descEn: '', marks: '', condition: '', dimensions: '',
    metals: [{ metal: 'gold', purityPpt: 585, grams: '' }], stones: [],
    labour: '', other: '', otherLabel: '', override: '', overrideReason: '', photos: [],
  };
}

function newCaseStone() {
  return { type: 'diamond', name: '', count: '1', carat: '', pricing: 'perCarat', price: '', currency: 'USD', origin: 'natural', idMethod: 'observed', lab: '', certNo: '', shape: '', color: '', clarity: '', treatment: '' };
}

// בדיקה לפני נעילה: כל מה שדוח מקצועי חייב לכלול
function caseFinalizeProblems(c, prices, today = localToday()) {
  const out = [];
  try { caseValidateClient(c.client); } catch (e) { out.push(e.message); }
  if (!CASE_PURPOSES[c.purpose]) out.push('יש לבחור את מטרת השמאות');
  if (c.purpose === 'other' && !caseTxt(c.purposeOther, 120)) out.push('מטרה "אחר" — יש לפרט');
  if (!CASE_BASES[c.basis]) out.push('יש לבחור את בסיס השווי');
  if (!caseIsDay(c.effectiveDate)) out.push('יש להזין את המועד הקובע');
  else if (c.effectiveDate > today) out.push('המועד הקובע אחרי היום');
  if (!caseIsDay(c.inspectionDate)) out.push('יש להזין את תאריך הבדיקה');
  else if (c.inspectionDate > today) out.push('תאריך הבדיקה אחרי היום');
  if (!(c.items || []).length) out.push('יש להוסיף פריט אחד לפחות');
  if ((c.items || []).length > CASE_MAX_ITEMS) out.push(`עד ${CASE_MAX_ITEMS} פריטים בתיק`);
  (c.items || []).forEach((it, i) => { if (!caseTxt(it.desc, 200)) out.push(`פריט ${i + 1}: יש להזין תיאור`); });
  const t = caseTotals(c, prices);
  out.push(...t.errors);
  t.items.forEach((x, i) => { if (x && !(x.valueAg > 0)) out.push(`פריט ${i + 1}: אין שווי — יש להזין מתכת, אבן, רכיב אחר או שווי שנקבע`); });
  if (c.currency !== 'ILS' && caseFromIlsAg(1, c.currency, prices) === null) out.push(`חסר שער ${CASE_CURRENCIES[c.currency].he}`);
  return out;
}

// המחירים שבשימוש בתיק, עם התאריך והמקור — נשמרים בנעילה ומודפסים בדוח
function casePriceKeys(c) {
  const keys = new Set();
  for (const it of c.items || []) {
    for (const m of it.metals || []) if (String(m.grams ?? '').trim() && CASE_METALS[m.metal]) { keys.add(m.metal); keys.add('usdIls'); }
    if (c.basis !== 'melt') for (const s of it.stones || []) { const r = CASE_CURRENCIES[s.currency]; if (r && r.rateKey) keys.add(r.rateKey); }
  }
  const rc = CASE_CURRENCIES[c.currency];
  if (rc && rc.rateKey) keys.add(rc.rateKey);
  return [...keys];
}

// מחירים שתאריכם רחוק מהמועד הקובע (יותר מ-PRICE_STALE_DAYS ימים, לפני או אחרי). פעם מועד קובע בעבר ננעל
// עם מחירי היום בלי שום התראה (סקירת קוד 2.11.2026). מחיר בלי תאריך — כבר באזהרת "לא עודכן"
function casePriceDateWarnings(c, prices) {
  if (!caseIsDay(c.effectiveDate)) return [];
  const out = [];
  for (const k of casePriceKeys(c)) {
    const d = priceDateOf(prices, k);
    if (!d) continue;
    const diff = dayDiff(c.effectiveDate, d);
    if (Math.abs(diff) <= PRICE_STALE_DAYS) continue;
    const name = PRICE_FIELDS.find(f => f.k === k)?.name || k;
    out.push(`${name}: המחיר מ-${shortDay(d)}, ${Math.abs(diff)} ימים ${diff > 0 ? 'אחרי' : 'לפני'} המועד הקובע (${shortDay(c.effectiveDate)})`);
  }
  return out;
}

// פרטי השמאי בזמן ההנפקה — עותק, כדי שהדפסה חוזרת לא תציג פרטים שהשתנו מאז
const caseAppraiserCopy = (a) => {
  if (!a || typeof a !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(a)) if (typeof v === 'string') out[k] = v.slice(0, 2000);
  return out;
};

// נעילה: עותק של הערכים, המחירים ותאריכיהם — הדפסה חוזרת זהה גם אחרי שהמחירים השתנו.
// appraiser / appraiserEn — פרטי השמאי בזמן ההנפקה (נשמרים ב-frozen; סקירת קוד 2.11.2026)
function finalizeCase(c, prices, today = localToday(), { appraiser = null, appraiserEn = null } = {}) {
  const problems = caseFinalizeProblems(c, prices, today);
  if (problems.length) throw new Error(problems.join('\n'));
  const t = caseTotals(c, prices);
  const snap = {};
  for (const k of casePriceKeys(c)) {
    const f = priceFreshness(prices, k, today);
    snap[k] = { value: Number(prices[k]), date: f.date, source: f.source, note: f.note || '' };
  }
  return {
    ...c, client: caseValidateClient(c.client), status: 'final', reportDate: today, finalizedAt: new Date().toISOString(),
    frozen: { items: t.items, totalAg: t.totalAg, prices: snap, reportTotal: caseFromIlsAg(t.totalAg, c.currency, prices),
      ...(appraiser ? { appraiser: caseAppraiserCopy(appraiser) } : {}), ...(appraiserEn ? { appraiserEn: caseAppraiserCopy(appraiserEn) } : {}) },
  };
}

// פתיחה מחדש של תיק סופי: גרסה חדשה (מספר הדוח מקבל סיומת), והגרסה הקודמת נשמרת בהיסטוריה — עותק עמוק של הדוח
// שהונפק (snapshot), כדי שאפשר יהיה להדפיס אותו שוב. פעם נשמרו רק התאריך והסכום, והחלון הבטיח "הדוח נשמר"
// (סקירת קוד 2.11.2026)
function reopenCase(c) {
  if (c.status !== 'final') return c;
  const { history: _h, ...issued } = c;
  const snapshot = JSON.parse(JSON.stringify(issued));
  const history = [...(c.history || []), { rev: c.rev, reportDate: c.reportDate, finalizedAt: c.finalizedAt, totalAg: c.frozen.totalAg, snapshot }];
  const { frozen, reportDate, finalizedAt, ...rest } = c;
  return { ...rest, status: 'draft', rev: (c.rev || 0) + 1, history };
}

const caseReportNo = (c) => String(c.no) + (c.rev ? '-' + c.rev : '');

// גרסה קודמת להדפסה חוזרת: התיק כפי שננעל, בלי ההיסטוריה. null — גרסה ישנה שנשמרה בלי עותק
function caseHistoryVersion(c, rev) {
  const h = (c.history || []).find(x => x && x.rev === rev);
  if (!h || !h.snapshot || h.snapshot.status !== 'final' || !h.snapshot.frozen) return null;
  return { ...JSON.parse(JSON.stringify(h.snapshot)), history: [] };
}

// תמונות שגרסה שהונפקה מפנה אליהן — לא נמחקות בעריכת הגרסה המתוקנת
function caseHistoryPhotoIds(c) {
  const ids = new Set();
  for (const h of c.history || []) for (const it of (h && h.snapshot && h.snapshot.items) || []) for (const id of it.photos || []) ids.add(id);
  return ids;
}

// מחירים שהדוח מציג: אחרי נעילה — העותק; בטיוטה — המחירים הנוכחיים
function casePricesFor(c, prices) {
  if (c.status === 'final' && c.frozen) {
    const p = {};
    for (const [k, v] of Object.entries(c.frozen.prices)) p[k] = v.value;
    return p;
  }
  return prices;
}

// ─────────────────────────────────────────────────────────────────────────────
//  אחסון: תיקים ותמונות (מוצפנים ונכללים בגיבוי — האחסון המקומי של השמאות עובר דרך המחסן המוצפן)
// ─────────────────────────────────────────────────────────────────────────────

// מפתח לכל תיק (case_<id>) ואינדקס קטן (casesIndex) — סקירת קוד 2.11.2026, תכנית א. עד עכשיו כל התיקים היו
// במפתח אחד (cases), והשמירה נעצרה בתקרה של 5MB לערך — בסביבות 1,000 תיקים.
// סדר כתיבה: התיק ואז האינדקס; מחיקה: התיק ואז האינדקס. בטעינה הראשונה בעמוד: מפתח תיק שחסר באינדקס (קריסה בין
// השניים) נוסף אליו, ורשומת אינדקס בלי מפתח — נמחקת. המבנה הישן (cases) מועבר בטעינה ונשאר כ-cases.bak עד הטעינה
// המוצלחת הבאה; העברה שנכשלה (צפייה בלבד, אין מקום) ← התיקים נקראים מהמבנה הישן, ובטעינה הבאה — ניסיון נוסף
const CASE_KEY_PREFIX = 'case_';
const CASES_INDEX = 'casesIndex';
const CASES_LEGACY = 'cases';
const CASES_BAK = 'cases.bak';
const CASES_MIGRATED = 'casesMigratedAt';
const caseKey = (id) => CASE_KEY_PREFIX + id;
// אישור שהמחסן כתוב בדיסק (src/core.js); בלי ImageDB (בדיקות של הלוגיקה בלבד) — אין מה לאשר
const caseFlushStore = () => (typeof ImageDB === 'undefined' ? true : ImageDB.flushStore());
// מצב לעמוד הנוכחי: checked — הבדיקה של האינדקס מול המפתחות כבר רצה; migratedNow — ההעברה רצה בטעינה הזו
const CASES_STORE = { checked: false, migratedNow: false, lastLegacy: null };

const caseIsValid = (c) => !!(c && typeof c === 'object' && !Array.isArray(c) && (typeof c.id === 'string' || typeof c.id === 'number')
  && String(c.id) && String(c.id).length <= 200 && c.client && typeof c.client === 'object');

// שורת האינדקס: מה שמסך רשימה צריך בלי לקרוא את כל התיק. totalAg — רק לתיק סופי (טיוטה — לפי המחירים של היום)
function caseIndexRow(c) {
  return {
    id: String(c.id), no: c.no, rev: c.rev || 0, status: c.status === 'final' ? 'final' : 'draft',
    clientName: String((c.client && c.client.name) || ''), idNumber: String((c.client && c.client.idNumber) || ''),
    clientKey: caseClientKey(c.client), effectiveDate: c.effectiveDate || '', purpose: c.purpose || '',
    totalAg: c.status === 'final' && c.frozen && Number.isSafeInteger(c.frozen.totalAg) ? c.frozen.totalAg : null,
    created: c.created || '',
  };
}

// כל מפתחות המחסן (בעמוד של SuperSuite — ownKeys של העותק בזיכרון; בדפדפן — מאפייני localStorage)
function caseStorageKeys() {
  try {
    if (typeof localStorage.length === 'number' && typeof localStorage.key === 'function') {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i));
      return out.filter(k => typeof k === 'string');
    }
    return Object.keys(localStorage);
  } catch (e) { return []; }
}

function loadCasesIndex() {
  const idx = Storage.load(CASES_INDEX, null);
  if (!idx || typeof idx !== 'object' || idx.v !== 1 || !Array.isArray(idx.ids)) return null;
  const ids = [...new Set(idx.ids.filter(id => typeof id === 'string' && id))];
  const rows = Array.isArray(idx.rows) ? idx.rows.filter(r => r && typeof r === 'object' && typeof r.id === 'string') : [];
  return { v: 1, ids, rows };
}

function saveCasesIndex(ids, rows, opts) {
  const byId = new Map(rows.map(r => [r.id, r]));
  return Storage.save(CASES_INDEX, { v: 1, ids, rows: ids.map(id => byId.get(id)).filter(Boolean) }, opts);
}

function loadCaseById(id) {
  const c = Storage.load(caseKey(id), null);
  return caseIsValid(c) && String(c.id) === String(id) ? c : null;
}

// המבנה הישן (מפתח אחד לכל התיקים) — מגרסה קודמת, מגיבוי ישן, או כשההעברה עוד לא הצליחה
function loadLegacyCases() {
  const list = Storage.load(CASES_LEGACY, null);
  return Array.isArray(list) ? list.filter(caseIsValid) : null;
}

// העברה מ-cases: כל תיק למפתח משלו (תיק שכבר קיים במבנה החדש — גובר), אינדקס, אימות בקריאה חוזרת, כתיבה לדיסק
// (ImageDB.flushStore) — ורק אז cases.bak והסרת cases. true — הועבר. כשל ← שום דבר לא נמחק, ו-cases נשאר המקור
function migrateLegacyCases() {
  const raw = localStorage.getItem(Storage.k(CASES_LEGACY));
  if (raw === null || raw === undefined) return true;
  CASES_STORE.lastLegacy = raw;
  // ערך שאינו רשימה (פגום) — לא מעבירים ולא מסירים: נשאר כמו שהוא
  const legacy = loadLegacyCases();
  if (!legacy) return false;
  try {
    const idx = loadCasesIndex() || { v: 1, ids: [], rows: [] };
    const rows = new Map(idx.rows.map(r => [r.id, r]));
    const ids = [...idx.ids];
    const known = new Set(ids);
    const written = [];
    for (const c of legacy) {
      const id = String(c.id);
      const existing = loadCaseById(id);
      if (!existing) {
        if (!Storage.save(caseKey(id), c, { quiet: true })) return false;
        written.push([id, JSON.stringify(c)]);
      }
      if (!known.has(id)) { ids.push(id); known.add(id); }
      rows.set(id, caseIndexRow(existing || c));
    }
    if (!saveCasesIndex(ids, [...rows.values()], { quiet: true })) return false;
    // אימות: כל תיק שנכתב נקרא חזרה זהה, והאינדקס מכיל את כולם
    for (const [id, json] of written) if (localStorage.getItem(Storage.k(caseKey(id))) !== json) return false;
    const check = loadCasesIndex();
    if (!check || legacy.some(c => !check.ids.includes(String(c.id)))) return false;
    if (!caseFlushStore()) return false;
    // עותק לחזרה לאחור עד הטעינה המוצלחת הבאה; בלעדיו — לא מסירים את המקור
    try { localStorage.setItem(Storage.k(CASES_BAK), raw); } catch (e) { return false; }
    if (localStorage.getItem(Storage.k(CASES_BAK)) !== raw) return false;
    if (!Storage.save(CASES_MIGRATED, new Date().toISOString(), { quiet: true })) return false;
    try { localStorage.removeItem(Storage.k(CASES_LEGACY)); } catch (e) { return false; }
    caseFlushStore();
    CASES_STORE.migratedNow = true;
    return true;
  } catch (e) {
    console.error('Cases migration failed', e);
    return false;
  }
}

// פעם אחת לעמוד: העברה מהמבנה הישן, התאמת האינדקס למפתחות, ומחיקת cases.bak אחרי טעינה מוצלחת נוספת
function ensureCasesLayout() {
  if (CASES_STORE.checked) {
    // נתונים חדשים במבנה הישן שהגיעו אחרי הבדיקה — מועברים גם עכשיו. אותו ערך שכבר נכשל — לא בכל קריאה
    // (העברה שנדחתה, למשל בצפייה בלבד, הייתה כותבת לדיסק בכל רינדור)
    const raw = localStorage.getItem(Storage.k(CASES_LEGACY));
    if (raw !== null && raw !== CASES_STORE.lastLegacy) migrateLegacyCases();
    return;
  }
  CASES_STORE.checked = true;
  migrateLegacyCases();
  const idx = loadCasesIndex();
  const prefix = Storage.k(CASE_KEY_PREFIX);
  const present = new Set(caseStorageKeys().filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length)));
  if (!idx && !present.size) return;
  const ids = idx ? idx.ids.filter(id => present.has(id)) : [];
  const rows = new Map((idx ? idx.rows : []).map(r => [r.id, r]));
  const orphans = [];
  for (const id of present) {
    if (ids.includes(id)) continue;
    const c = loadCaseById(id);
    if (c) orphans.push(c);
  }
  // תיק שנכתב בלי האינדקס (קריסה בין השניים) — נוסף, החדש קודם
  orphans.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
  for (const c of orphans) { ids.unshift(String(c.id)); rows.set(String(c.id), caseIndexRow(c)); }
  if (!idx || orphans.length || ids.length !== idx.ids.length) saveCasesIndex(ids, [...rows.values()], { quiet: true });
  // cases.bak — רק אחרי טעינה נוספת שבה המבנה החדש תקין וכתוב בדיסק
  if (!CASES_STORE.migratedNow && localStorage.getItem(Storage.k(CASES_LEGACY)) === null
    && localStorage.getItem(Storage.k(CASES_BAK)) !== null && loadCasesIndex() && caseFlushStore()) {
    // בשקט: מי שאינו רשאי לכתוב (צפייה בלבד) — העותק נשאר עד טעינה של מי שרשאי
    try { localStorage.removeItem(Storage.k(CASES_BAK)); } catch (e) { /* ננסה בטעינה הבאה */ }
  }
}

function loadCases() {
  ensureCasesLayout();
  const idx = loadCasesIndex();
  const out = [];
  const seen = new Set();
  for (const id of idx ? idx.ids : []) {
    const c = loadCaseById(id);
    if (c && !seen.has(String(c.id))) { out.push(c); seen.add(String(c.id)); }
  }
  // ההעברה לא הצליחה (או עוד לא רצה): התיקים מהמבנה הישן שלא במבנה החדש — גם הם מוצגים
  for (const c of loadLegacyCases() || []) if (!seen.has(String(c.id))) { out.push(c); seen.add(String(c.id)); }
  return out;
}

// תיק אחד לפי מזהה — בלי לקרוא את כל התיקים (עריכה, שמירה אוטומטית)
function findCase(id) {
  if (id === null || id === undefined || id === '') return null;
  ensureCasesLayout();
  return loadCaseById(String(id)) || (loadLegacyCases() || []).find(c => String(c.id) === String(id)) || null;
}

// שמירת תיק אחד: התיק ואז האינדקס. true — המחסן קיבל את שתיהן (אחרת Storage.save כבר הודיע למשתמש)
function saveCase(c) {
  if (!caseIsValid(c)) return false;
  ensureCasesLayout();
  const id = String(c.id);
  if (!Storage.save(caseKey(id), c)) return false;
  const idx = loadCasesIndex() || { v: 1, ids: [], rows: [] };
  const ids = idx.ids.includes(id) ? idx.ids : [id, ...idx.ids];
  const rows = idx.rows.filter(r => r.id !== id);
  rows.push(caseIndexRow(c));
  return saveCasesIndex(ids, rows);
}

// מחיקת תיק: המפתח ואז האינדקס (קריסה באמצע ← רשומת אינדקס בלי מפתח, שנמחקת בטעינה). גם מהמבנה הישן, אם נשאר
function removeCase(id) {
  ensureCasesLayout();
  id = String(id);
  if (!Storage.remove(caseKey(id))) return false;
  const idx = loadCasesIndex();
  if (idx && idx.ids.includes(id) && !saveCasesIndex(idx.ids.filter(x => x !== id), idx.rows)) return false;
  const legacy = loadLegacyCases();
  if (legacy && legacy.some(c => String(c.id) === id) && !Storage.save(CASES_LEGACY, legacy.filter(c => String(c.id) !== id))) return false;
  return true;
}

// כל הרשימה בבת אחת (בדיקות, ייבוא): כל תיק נשמר, ותיקים שאינם ברשימה נמחקים
function saveCases(list) {
  const valid = (list || []).filter(caseIsValid);
  const keep = new Set(valid.map(c => String(c.id)));
  for (const c of valid) if (!saveCase(c)) return false;
  for (const c of loadCases()) if (!keep.has(String(c.id)) && !removeCase(c.id)) return false;
  // הסדר של הרשימה — באינדקס
  return saveCasesIndex([...keep], valid.map(caseIndexRow));
}

function nextCaseNo() {
  const no = (Number(Storage.load('caseSeq', 0)) || 0) + 1;
  // 0 — המספור לא נשמר (ההודעה — מ-Storage.save): לא פותחים תיק במספר שיונפק שוב
  return Storage.save('caseSeq', no) ? no : 0;
}

const casePhotoKey = (id) => 'casePhoto_' + id;
const caseIsPhoto = (s) => typeof s === 'string' && s.length <= CASE_MAX_PHOTO_CHARS && /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(s);

function saveCasePhoto(dataUrl) {
  if (!caseIsPhoto(dataUrl)) throw new Error('התמונה אינה תקינה או גדולה מדי');
  const id = uid();
  // כתיבה שהמחסן דחה (אין מקום, אין כניסה, צפייה בלבד) — הסיבה עולה למסך ("התמונה לא נשמרה: ...")
  if (!Storage.save(casePhotoKey(id), dataUrl, { quiet: true })) throw new Error(Storage.lastError.replace(/^השינוי לא נשמר:\s*/, '') || 'אין מקום לשמור את התמונה');
  if (Storage.load(casePhotoKey(id), null) !== dataUrl) throw new Error('אין מקום לשמור את התמונה');
  return id;
}

function loadCasePhoto(id) {
  const s = Storage.load(casePhotoKey(id), null);
  return caseIsPhoto(s) ? s : '';
}

function deleteCasePhotos(ids) { for (const id of ids || []) Storage.remove(casePhotoKey(id)); }
