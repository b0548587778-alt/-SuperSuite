// „אין מספרים מומצאים”: כל מספר בתשובת המודל חייב להופיע בתוצאות הכלים (או בשאלה עצמה).
// תשובה שיש בה סכום שלא הגיע מכלי — נדחית, והעוזר עונה ממנוע הכללים. פונקציה טהורה.
// גם מספר שנכתב במילים („חמשת אלפים שקלים”) נדחה: אי אפשר לבדוק אותו מול הכלי, וההנחיה למודל היא להעתיק ספרות.
// evidence (אופציונלי) — תוצאות הכלים שהצליחו: התשובה חייבת לצטט מהן ערך אחד לפחות. תשובה בלי ספרות בכלל
// עברה פעם תמיד, גם כשלא הייתה קשורה לנתונים (בדיקת קוד 23.10.2026, ממצא 48)

// מספר: ספרות עם מפרידי אלפים/עשרוניים. „₪1,234.50” ← „1234.5”; „03.2026” נשאר כפי שהוא
const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;

// תאריך ישראלי („24.10.2026”, „1/11/2026”) — נבדק כתאריך שלם מול התאריכים שבמקורות (כולל היום), לפני המספרים.
// פעם „נכון ל-24.10.2026” נדחה: „24.10” נקרא כמספר עשרוני מומצא (בדיקה חוזרת 24.10.2026)
const DMY_RE = /(?<![\d.\/])(\d{1,2})([./])(\d{1,2})\2(\d{4})(?!\d|[.\/]\d)/g;
const ISO_DAY_RE = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
// 'YYYY-MM-DD' של תאריך קיים בלוח, אחרת null (31.2 אינו תאריך)
function isoDay(y, m, d) {
  const Y = Number(y), M = Number(m), D = Number(d);
  const t = new Date(Date.UTC(Y, M - 1, D));
  if (t.getUTCFullYear() !== Y || t.getUTCMonth() !== M - 1 || t.getUTCDate() !== D) return null;
  return `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
}
function datesIn(text) {
  const s = String(text || '');
  const out = new Set();
  for (const m of s.matchAll(ISO_DAY_RE)) { const d = isoDay(m[1], m[2], m[3]); if (d) out.add(d); }
  for (const m of s.matchAll(DMY_RE)) { const d = isoDay(m[4], m[3], m[1]); if (d) out.add(d); }
  return out;
}

// מספרים במילים — לפי רצף של מילות מספר („מאה ושמונים”) וההקשר שלו (עד שתי מילים מכל צד, בתוך המשפט):
// • מספר מדויק (עשרים, מאה, אלף, מיליון...) — תמיד, חוץ מצירוף קבוע: „עד מאה ועשרים שנה”, „מאה שערים”, „אלף תודות”.
// • כמות כללית (עשרות, מאות, אלפי, רבבות, מיליוני) — רק בהקשר של סכום: יחידה, ספרה, מילת מספר נוספת, „בסך” או „כ־”.
//   פעם כל מופע נדחה, ו„אלפי תודות” או „משה אלפי” הפילו מכתב תודה (סקירה לממצא 48).
// • אחד–עשר — רק כשמיד אחריהן מטבע או אחוז („חמישה שקלים”), אחרת „חשבונית אחת” נדחית.
// תחיליות: ו, ה, ב, ל, כ, מ — בלי ש: „שמאות” אינה „ש+מאות”
const HEB = '\\u05d0-\\u05ea';
const PREFIX = '[והבלכמ]{0,2}';
const BIG_WORDS = ['עשרות', 'עשרים', 'שלושים', 'ארבעים', 'חמישים', 'שישים', 'ששים', 'שבעים', 'שמונים', 'תשעים', 'מאה', 'מאות', 'מאתיים',
  'אלף', 'אלפיים', 'אלפים', 'אלפי', 'רבבה', 'רבבות', 'מיליון', 'מיליונים', 'מיליוני', 'מליון', 'מיליארד', 'מיליארדים', 'מליארד'];
const VAGUE_WORDS = new Set(['עשרות', 'מאות', 'אלפי', 'רבבות', 'מיליוני']);
const SMALL_WORDS = ['אחד', 'אחת', 'שניים', 'שתיים', 'שני', 'שתי', 'שלוש', 'שלושה', 'שלושת', 'ארבע', 'ארבעה', 'ארבעת', 'חמש', 'חמישה', 'חמשת',
  'שש', 'שישה', 'ששת', 'שבע', 'שבעה', 'שבעת', 'שמונה', 'שמונת', 'תשע', 'תשעה', 'תשעת', 'עשר', 'עשרה', 'עשרת'];
const SMALL_SET = new Set(SMALL_WORDS);
const UNITS = new Set(['שקלים', 'שקל', 'ש"ח', 'ש״ח', 'שח', '₪', 'אגורות', 'אגורה', 'דולרים', 'דולר', 'אירו', 'אחוזים', 'אחוז', '%']);
// מילה שמיד אחרי מספר מדויק הופכת אותו לצירוף קבוע — רק כשאין לידו יחידה, ספרה או „בסך”
const IDIOM_AFTER = new Set(['שנה', 'שנים', 'שנות', 'שערים', 'תודות', 'ברכות']);
const AMOUNT_CONTEXT = new Set(['סך', 'בסך', 'הסך', 'סכום', 'בסכום', 'כ', 'בערך', 'כמעט']);
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NUM_WORD_RE = new RegExp(`^(${PREFIX})(${[...BIG_WORDS, ...SMALL_WORDS].join('|')})$`);
// מילים שנראות כ„תחילית + מספר” ואינן מספר: „מעשר”, „מעשרות”, „המעשר”, „ממעשר”, „ומעשרות” (מעשר כספים, לא „מ”+„עשר”),
// ו„השלושים” (ימי האבל). הן מספר רק כשמיד אחריהן יחידה במילים: „מעשרות שקלים”, „השלושים שקלים”.
// פעם „מכספי מעשרות” ו„אזכרת השלושים” הפילו תשובה תקינה (בדיקה חוזרת 24.10.2026)
const isIdiomWord = (prefix, core) => ((core === 'עשר' || core === 'עשרות') && prefix.endsWith('מ'))
  || (core === 'שלושים' && prefix.endsWith('ה'));
const SYMBOL_UNIT = /^[₪%]$/;
// מילים, מספרים, יחידות וסוף משפט או פסוקית (החלון לא עובר אותם: נקודה, פסיק, מקף מפריד). „כ־אלף” ← „כ”, „אלף”
const STOP_CHARS = '.!?;:,()\\n—–';
const TOKEN_RE = new RegExp(`[ובלה]?ש["״]ח|[א-ת]+|\\d[\\d,.]*\\d|\\d|[₪%]|[${STOP_CHARS}]|(?<=\\s)-(?=\\s)`, 'g');
const STOP_RE = new RegExp(`^(?:[${STOP_CHARS}]|-)$`);
const isUnit = (t) => UNITS.has(t) || (/^[ובלה]/.test(t) && UNITS.has(t.slice(1)));

function classify(t) {
  const m = NUM_WORD_RE.exec(t);
  const kind = !m ? null : SMALL_SET.has(m[2]) ? 'small' : VAGUE_WORDS.has(m[2]) ? 'vague' : 'precise';
  const idiom = !!m && isIdiomWord(m[1], m[2]);
  return { t, num: idiom ? null : kind, kind, idiom, prefix: m ? m[1] : '', core: m ? m[2] : '', unit: isUnit(t), digit: /\d/.test(t), stop: STOP_RE.test(t) };
}

function tokensOf(text) {
  const toks = [...String(text || '').matchAll(TOKEN_RE)].map(m => ({ ...classify(m[0]), i: m.index, end: m.index + m[0].length }));
  // „מעשרות שקלים” — כן מספר. ₪ / % צמודים לספרות שאחריהם („מעשרות ₪1,234.50”), ולכן רק יחידה במילים
  toks.forEach((x, k) => {
    const next = toks[k + 1];
    if (x.idiom && next && next.unit && !SYMBOL_UNIT.test(next.t)) x.num = x.kind;
  });
  return toks;
}

// עד שתי מילים מכל צד של הרצף, בלי לעבור סוף משפט
function windowOf(toks, from, dir) {
  const out = [];
  for (let k = from; k >= 0 && k < toks.length && out.length < 2; k += dir) {
    if (toks[k].stop) break;
    out.push(toks[k]);
  }
  return out;
}

function flagged(run, before, after) {
  const kinds = run.map(x => x.num);
  if (kinds.every(k => k === 'small')) return !!(after[0] && after[0].unit);
  const unitAfter = after.some(x => x.unit);
  const digitNear = before.some(x => x.digit) || after.some(x => x.digit);
  const amountBefore = before.some(x => AMOUNT_CONTEXT.has(x.t)) || run[0].prefix.includes('כ');
  if (kinds.includes('precise')) {
    if (unitAfter || digitNear || amountBefore) return true;
    const blessing = before[0] && before[0].t === 'עד' && run.map(x => x.t).join(' ') === 'מאה ועשרים'; // „עד מאה ועשרים”
    return !(blessing || (after[0] && IDIOM_AFTER.has(after[0].t)));
  }
  return unitAfter || digitNear || amountBefore || run.length > 1;
}

function numberWords(text) {
  const s = String(text || '');
  const toks = tokensOf(s);
  const out = [];
  for (let a = 0; a < toks.length; a++) {
    if (!toks[a].num) continue;
    let b = a;
    while (b + 1 < toks.length && toks[b + 1].num) b++;
    if (flagged(toks.slice(a, b + 1), windowOf(toks, a - 1, -1), windowOf(toks, b + 1, 1))) out.push(s.slice(toks[a].i, toks[b].end));
    a = b;
  }
  return out;
}

// מופע של ערך מהכלי כמילה שלמה (מותרות תחיליות ו/ה/ב/ל/כ/מ/ש): „אור” אינו ציטוט ב„האורח”
const wordRe = (s, flags = '') => new RegExp(
  `(?<![${HEB}A-Za-z])[והבלכמש]{0,2}${String(s).trim().split(/\s+/).map(reEsc).join('\\s+')}(?![${HEB}A-Za-z])`, flags);
const wordCount = (s) => String(s).trim().split(/\s+/).length;
// שם בן מילה אחת — לפחות 4 אותיות; „כהן”, „לוי”, „אור” הופיעו כחלק מכל טקסט
const citable = (s) => wordCount(s) > 1 || String(s).replace(/[^\p{L}]/gu, '').length >= 4;

function canon(token) {
  let s = String(token).replace(/,/g, '');
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s.replace(/^0+(?=\d)/, '');
}

function numbersIn(text) {
  return (String(text || '').match(NUM_RE) || []).map(canon).filter(Boolean);
}

const isSmall = (c) => /^\d+$/.test(c) && Number(c) <= 12;

// מספר קטן (0–12) שלא הגיע מכלי מותר רק כמספור רשימה: בתחילת שורה, ואחריו „.” או „)”.
// פעם כל מספר קטן עבר, ו„יש 7 חשבוניות” מומצא התקבל
function isListNumber(raw, text, index) {
  if (!isSmall(canon(raw))) return false;
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  return /^\s*$/.test(text.slice(lineStart, index)) && /^[.)]/.test(text.slice(index + raw.length));
}

// ערכים מתוך תוצאות הכלים שהתשובה יכולה לצטט: מספרים, ושמות/תוויות בלי ספרות (3 תווים ומעלה).
// הערה, שגיאה, „רווח/הפסד”, התקופה והשנה אינם ציטוט — הם לא מעידים שהתשובה מבוססת על הנתונים
const SKIP_KEYS = new Set(['note', 'error', 'result', 'period', 'year']);
function evidenceOf(results) {
  const nums = new Set(), strs = new Set(), dates = new Set();
  const walk = (v, depth) => {
    if (v == null || depth > 6) return;
    if (typeof v === 'number' || typeof v === 'string') {
      for (const n of numbersIn(String(v))) nums.add(n);
      if (typeof v === 'string') for (const d of datesIn(v)) dates.add(d);
      const t = String(v).trim();
      if (typeof v === 'string' && t.length >= 3 && !/\d/.test(t) && /[א-תA-Za-z]/.test(t)) strs.add(t);
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!SKIP_KEYS.has(k)) walk(x, depth + 1);
  };
  for (const r of results || []) walk(r, 0);
  return { nums, strs, dates };
}

// תאריכים בטקסט של מקור: התאריך השלם מותר, והשנה שלו — כמספר; היום והחודש אינם מספרים מותרים.
// פעם „יש 14 חשבוניות פתוחות” עבר כי 14 הופיע בתאריך 2026-10-14 (סקירת קוד 2.11.2026)
function splitDates(text, dates, years) {
  const blank = (m) => ' '.repeat(m.length);
  return String(text).replace(ISO_DAY_RE, (m, y, mo, d) => {
    const iso = isoDay(y, mo, d);
    if (!iso) return m;
    dates.add(iso); years.add(canon(y));
    return blank(m);
  }).replace(DMY_RE, (m, d, sep, mo, y) => {
    const iso = isoDay(y, mo, d);
    if (!iso) return m;
    dates.add(iso); years.add(canon(y));
    return blank(m);
  });
}

// מספרי מסמכים (חשבונית) — מותרים רק כשמיד לפניהם „חשבונית” / „מס׳” / „מספר” / „#”, לא כסכום או ככמות
const REF_KEYS = new Set(['invoice', 'number', 'receipt']);
const REF_BEFORE = /(?:חשבונית|קבלה|מס['׳"]?|מספר|#)\s*$/;
// רשומה של ישות (תורם / לקוח) בתוצאת כלי — הסכומים שלה קשורים לשם שלה
const ENTITY_KEYS = ['name', 'customer'];

// מקור (תוצאת כלי) ← מספרים מותרים, מספרי מסמכים, תאריכים, ורשומות ישות עם המספרים שלהן
function walkSource(v, out, key = '', depth = 0, entity = null) {
  if (v == null || depth > 8) return;
  if (typeof v === 'number' || typeof v === 'string') {
    const nums = numbersIn(splitDates(String(v), out.dates, out.years));
    const target = REF_KEYS.has(key) ? out.refs : out.nums;
    for (const n of nums) {
      target.add(n);
      if (entity && !REF_KEYS.has(key)) entity.nums.add(n);
    }
    return;
  }
  if (Array.isArray(v)) { for (const x of v) walkSource(x, out, key, depth + 1, entity); return; }
  if (typeof v === 'object') {
    const nameKey = ENTITY_KEYS.find(k => typeof v[k] === 'string' && v[k].trim());
    const own = nameKey ? { name: v[nameKey].trim(), nums: new Set() } : null;
    if (own) out.entities.push(own);
    for (const [k, x] of Object.entries(v)) {
      if (own && k === nameKey) continue;
      walkSource(x, out, k, depth + 1, own || entity);
    }
  }
}

// answer — טקסט המודל; sources — מערך של תוצאות כלים (אובייקטים) וטקסטים (השאלה, התאריך)
// opts.evidence — תוצאות הכלים שהצליחו; כשהוא ניתן, התשובה חייבת לצטט מהן מספר (שאינו מהשאלה ואינו מספר קטן) או שם
function checkGrounded(answer, sources = [], opts = {}) {
  const allowed = new Set();
  const given = new Set(); // מספרים מהשאלה ומהתאריך — מותרים, אבל אינם ציטוט של נתון
  const allowedDates = new Set();
  const givenDates = new Set();
  const refs = new Set();
  const entities = [];
  // מספרים שאינם של רשומת ישות מסוימת (סיכומים, השאלה) — מותרים ליד כל שם
  const shared = new Set();
  for (const s of sources) {
    if (typeof s === 'string') {
      const years = new Set();
      const rest = splitDates(s, givenDates, years);
      for (const n of [...numbersIn(rest), ...years]) { allowed.add(n); given.add(n); shared.add(n); }
      continue;
    }
    if (!s || typeof s !== 'object') continue;
    const out = { nums: new Set(), refs, dates: allowedDates, years: new Set(), entities: [] };
    walkSource(s, out);
    for (const n of [...out.nums, ...out.years]) allowed.add(n);
    const inEntity = new Set(out.entities.flatMap(e => [...e.nums]));
    for (const n of [...out.nums, ...out.years]) if (!inEntity.has(n)) shared.add(n);
    entities.push(...out.entities);
  }
  for (const d of givenDates) allowedDates.add(d);
  const raw = String(answer || '');
  const invented = [];
  const used = [];
  const usedDates = [];
  // תאריך שלם קודם — ובמקומו רווחים (אותם מיקומים), כדי שהיום והחודש לא ייבדקו שוב כמספרים
  const dateOk = (m, iso) => {
    if (iso && allowedDates.has(iso)) usedDates.push(iso); else invented.push(m);
    return ' '.repeat(m.length);
  };
  const text = raw.replace(DMY_RE, (m, d, sep, mo, y) => dateOk(m, isoDay(y, mo, d)))
    .replace(ISO_DAY_RE, (m, y, mo, d) => dateOk(m, isoDay(y, mo, d)));
  const numHits = [];
  for (const m of text.matchAll(NUM_RE)) {
    const c = canon(m[0]);
    if (!c) continue;
    if (allowed.has(c)) { used.push(c); numHits.push({ c, raw: m[0], i: m.index }); continue; }
    if (refs.has(c) && REF_BEFORE.test(text.slice(Math.max(0, m.index - 12), m.index))) continue;
    if (isListNumber(m[0], text, m.index)) continue;
    invented.push(m[0]);
  }
  // סכום של תורם/לקוח אחר: במשפט (או בשורה) שמוזכרת בו ישות אחת בלבד, מספר שמופיע רק ברשומה של ישות אחרת — מומצא
  const named = entities.filter(e => citable(e.name));
  if (named.length > 1) {
    const seps = [...text.matchAll(/\n|[!?;•]|\.(?!\d)|,(?!\d)/g)].map(m => m.index);
    const segOf = (i) => { let a = 0; for (const x of seps) { if (x < i) a = x; else return [a, x]; } return [a, text.length]; };
    for (const h of numHits) {
      if (shared.has(h.c)) continue;
      const [a, b] = segOf(h.i);
      const seg = raw.slice(a, b);
      const here = named.filter(e => wordRe(e.name).test(seg));
      const names = new Set(here.map(e => e.name));
      if (names.size !== 1) continue;
      if (here.some(e => e.nums.has(h.c))) continue;
      if (named.some(e => !names.has(e.name) && e.nums.has(h.c))) invented.push(h.raw);
    }
  }
  // שם בן כמה מילים שהגיע מכלי ויש בו מילת מספר („ישיבת מאה שערים”, „משה אלפי”) — לא נבדק כמספר
  const names = [...evidenceOf(sources.filter(s => s && typeof s === 'object')).strs]
    .filter(s => wordCount(s) > 1 && tokensOf(s).some(x => x.num));
  const plain = names.reduce((t, n) => t.replace(wordRe(n, 'g'), m => ' '.repeat(m.length)), text);
  invented.push(...numberWords(plain));
  let cited = true;
  if (opts && Array.isArray(opts.evidence)) {
    const ev = evidenceOf(opts.evidence);
    cited = used.some(c => ev.nums.has(c) && !given.has(c) && !isSmall(c))
      || usedDates.some(d => ev.dates.has(d) && !givenDates.has(d))
      || [...ev.strs].some(s => citable(s) && wordRe(s).test(raw));
  }
  return { ok: invented.length === 0 && cited, invented, cited };
}

module.exports = { checkGrounded, numbersIn, numberWords };
