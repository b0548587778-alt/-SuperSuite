// „אין מספרים מומצאים”: כל מספר בתשובת המודל חייב להופיע בתוצאות הכלים (או בשאלה עצמה).
// תשובה שיש בה סכום שלא הגיע מכלי — נדחית, והעוזר עונה ממנוע הכללים. פונקציה טהורה.

// מספר: ספרות עם מפרידי אלפים/עשרוניים. „₪1,234.50” ← „1234.5”; „03.2026” נשאר כפי שהוא
const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;

function canon(token) {
  let s = String(token).replace(/,/g, '');
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s.replace(/^0+(?=\d)/, '');
}

function numbersIn(text) {
  return (String(text || '').match(NUM_RE) || []).map(canon).filter(Boolean);
}

// מספרים קטנים (1–12) מותרים: מספור רשימה, „3 החודשים”, חודש בתאריך. סכום (עם ₪) — תמיד נבדק
function isSmallFree(token, text, index) {
  const n = Number(token);
  if (!Number.isInteger(n) || n < 0 || n > 12) return false;
  const around = text.slice(Math.max(0, index - 2), index + String(token).length + 2);
  return !/₪|ש"ח|ש״ח|%/.test(around);
}

// answer — טקסט המודל; sources — מערך של תוצאות כלים (אובייקטים) וטקסטים (השאלה)
function checkGrounded(answer, sources = []) {
  const allowed = new Set();
  for (const s of sources) for (const n of numbersIn(typeof s === 'string' ? s : JSON.stringify(s))) allowed.add(n);
  const text = String(answer || '');
  const invented = [];
  for (const m of text.matchAll(NUM_RE)) {
    const c = canon(m[0]);
    if (!c || allowed.has(c)) continue;
    if (isSmallFree(c, text, m.index)) continue;
    invented.push(m[0]);
  }
  return { ok: invented.length === 0, invented };
}

module.exports = { checkGrounded, numbersIn };
