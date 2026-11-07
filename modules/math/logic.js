// לוגיקה טהורה של מודול החשבון (בלי DOM) — מחוללי תרגילים, שברים מדויקים, בדיקת תשובות,
// רמה מסתגלת, התקדמות ותגים. נבדק ב-tests/math-logic.test.js.
// כל החישובים במספרים שלמים: שבר = { n, d } מצומצם, כסף = אגורות, עשרוני = מונה על חזקה של 10.
// אין השוואות בנקודה צפה לתשובות.
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- אקראיות
  function ri(R, lo, hi) { return lo + Math.floor(R() * (hi - lo + 1)); }
  function pick(R, arr) { return arr[Math.floor(R() * arr.length)]; }
  function safeRandom(random) {
    if (typeof random !== 'function') return Math.random;
    // מגן מפני פונקציה שמחזירה ערך מחוץ ל-[0,1)
    return function () { const v = Number(random()); return Number.isFinite(v) && v >= 0 && v < 1 ? v : 0; };
  }
  // מחולל דטרמיניסטי (לבדיקות ולדפי עבודה עם זרע)
  function seeded(seed) {
    let a = (Number(seed) >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------- שברים
  function gcd(a, b) {
    a = Math.abs(Math.trunc(a)); b = Math.abs(Math.trunc(b));
    while (b) { const t = a % b; a = b; b = t; }
    return a;
  }
  function lcm(a, b) { if (!a || !b) return 0; return Math.abs(a / gcd(a, b) * b); }
  function frac(n, d) {
    if (d === undefined) d = 1;
    if (!Number.isInteger(n) || !Number.isInteger(d) || d === 0) throw new Error('bad fraction');
    if (d < 0) { n = -n; d = -d; }
    const g = gcd(n, d) || 1;
    return { n: n / g, d: d / g };
  }
  const reduce = frac;
  function isReduced(n, d) { return Number.isInteger(n) && Number.isInteger(d) && d > 0 && gcd(n, d) === 1; }
  function fracCompare(a, b) { const l = a.n * b.d, r = b.n * a.d; return l < r ? -1 : l > r ? 1 : 0; }
  function fracEq(a, b) { return fracCompare(a, b) === 0; }
  function fracAdd(a, b) { return frac(a.n * b.d + b.n * a.d, a.d * b.d); }
  function fracSub(a, b) { return frac(a.n * b.d - b.n * a.d, a.d * b.d); }
  function fracMul(a, b) { return frac(a.n * b.n, a.d * b.d); }
  function fracDiv(a, b) { if (b.n === 0) throw new Error('div by zero'); return frac(a.n * b.d, a.d * b.n); }
  function fracStr(f) { return f.d === 1 ? String(f.n) : f.n + '/' + f.d; }
  // שבר מעורב: 7/2 ← "3 1/2"
  function mixedStr(f) {
    if (f.d === 1 || Math.abs(f.n) < f.d) return fracStr(f);
    const sign = f.n < 0 ? '-' : '';
    const n = Math.abs(f.n), w = Math.floor(n / f.d), r = n % f.d;
    return sign + w + (r ? ' ' + r + '/' + f.d : '');
  }
  // שבר שמכנהו חזקה של 2 ו-5 בלבד ← מחרוזת עשרונית מדויקת; אחרת null
  function decStr(f, minPlaces) {
    let d = f.d, p2 = 0, p5 = 0;
    while (d % 2 === 0) { d /= 2; p2++; }
    while (d % 5 === 0) { d /= 5; p5++; }
    if (d !== 1) return null;
    const places = Math.max(p2, p5, minPlaces || 0);
    const scale = Math.pow(10, places);
    const scaled = f.n * (scale / f.d);
    return fmtScaled(scaled, places, minPlaces || 0);
  }
  // מספר שלם שמייצג value/10^places ← מחרוזת; קיצוץ אפסים בסוף עד minPlaces
  function fmtScaled(scaled, places, minPlaces) {
    const neg = scaled < 0; let s = String(Math.abs(scaled));
    if (places > 0) {
      while (s.length <= places) s = '0' + s;
      let int = s.slice(0, s.length - places), dec = s.slice(s.length - places);
      while (dec.length > (minPlaces || 0) && dec.endsWith('0')) dec = dec.slice(0, -1);
      s = int + (dec ? '.' + dec : '');
    }
    return (neg ? '-' : '') + s;
  }
  function fmtMoney(ag) { return (ag % 100 === 0 ? String(ag / 100) : fmtScaled(ag, 2, 2)) + ' ₪'; }
  function fmtInt(n) { return Math.abs(n) >= 10000 ? n.toLocaleString('en-US') : String(n); }

  // ---------------------------------------------------------------- פענוח תשובות
  function normInput(s) {
    return String(s == null ? '' : s)
      .replace(/[‎‏‪-‮⁦-⁩]/g, '')
      .replace(/[−–—]/g, '-')
      .replace(/[₪]|ש"ח|ש״ח|שקלים|שקל/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  // מקלדת עברית (SI-1452): המקש של '.' מפיק 'ץ' והמקש של ',' מפיק 'ת' — התווים האלה לא חוקיים בתשובה
  function fixHebrewKeys(s) { return s.replace(/ץ/g, '.').replace(/(\d)ת(?=\d)/g, '$1,'); }
  function parseUnsigned(s) {
    // 1,000 / 12,345.5 — פסיקים של אלפים; "2,5" — פסיק עשרוני
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    else if (/^\d*,\d+$/.test(s)) s = s.replace(',', '.');
    let m = /^(\d+)$/.exec(s);
    if (m) return m[1].length > 12 ? null : frac(Number(m[1]), 1);
    m = /^(\d*)\.(\d+)$/.exec(s);
    if (m) {
      if ((m[1] + m[2]).length > 12 || m[2].length > 6) return null;
      return frac(Number(m[1] + m[2]), Math.pow(10, m[2].length));
    }
    m = /^(\d+) ?\/ ?(\d+)$/.exec(s);
    if (m) { const d = Number(m[2]); if (!d || m[1].length > 9 || m[2].length > 9) return null; return frac(Number(m[1]), d); }
    m = /^(\d+) (\d+) ?\/ ?(\d+)$/.exec(s);
    if (m) {
      const d = Number(m[3]), n = Number(m[2]);
      if (!d || n >= d || m[1].length > 9 || m[3].length > 9) return null;
      return frac(Number(m[1]) * d + n, d);
    }
    return null;
  }
  // מחרוזת ← { n, d } או null. תומך במספר שלם, עשרוני, שבר, שבר מעורב ואלפים עם פסיק
  function parseNumber(input) {
    let s = fixHebrewKeys(normInput(input));
    if (!s) return null;
    let neg = false;
    if (s[0] === '-') { neg = true; s = s.slice(1).trim(); }
    const f = parseUnsigned(s);
    if (!f) return null;
    return neg ? { n: -f.n, d: f.d } : f;
  }
  // הצורה שהוקלדה כשבר (לבדיקת "צמצום עד הסוף"): "6/8" ← { n:6, d:8 }
  function parseRawFraction(input) {
    const s = fixHebrewKeys(normInput(input));
    const m = /^(\d+) ?\/ ?(\d+)$/.exec(s);
    if (m) return { n: Number(m[1]), d: Number(m[2]) };
    const mm = /^(\d+) (\d+) ?\/ ?(\d+)$/.exec(s);
    if (mm) return { n: Number(mm[2]), d: Number(mm[3]), whole: Number(mm[1]) };
    return null;
  }
  // חילוק עם שארית: "7 ש 2", "7 שארית 2", "7 (2)", "7 r 2", או מספר בלבד (שארית 0)
  function parseDivRem(input) {
    const s = normInput(input);
    if (!s) return null;
    let m = /^(\d+) ?(?:ש(?:ארית|'|׳)?|r|R|ע"?ש)? ?\(? ?(\d+) ?\)?$/.exec(s);
    if (m && /\D/.test(s)) return { q: Number(m[1]), r: Number(m[2]) };
    m = /^(\d+)$/.exec(s);
    if (m) return { q: Number(m[1]), r: 0 };
    return null;
  }
  function parseChoice(input) {
    const s = normInput(input);
    if (s === '<' || s === 'קטן') return '<';
    if (s === '>' || s === 'גדול') return '>';
    if (s === '=' || s === 'שווה') return '=';
    return null;
  }

  // בדיקת תשובה: { status: 'correct' | 'wrong' | 'unparsed' | 'not-reduced' }
  // unparsed — לא נספר כטעות (מבקשים להקליד שוב)
  function checkAnswer(q, input) {
    if (!q || !q.answer) return { status: 'unparsed' };
    if (q.kind === 'choice') {
      const c = parseChoice(input);
      if (!c) return { status: 'unparsed' };
      return { status: c === q.answer ? 'correct' : 'wrong' };
    }
    if (q.kind === 'divrem') {
      const v = parseDivRem(input);
      if (!v) return { status: 'unparsed' };
      return { status: v.q === q.answer.q && v.r === q.answer.r ? 'correct' : 'wrong' };
    }
    // "30%" בשאלה "כמה אחוזים" — הסימן כמו בתשובה המוצגת
    if (q.topic === 'pct' && /%$/.test(String(q.answerText || ''))) input = normInput(input).replace(/ ?%$/, '');
    // משוואה: "x = 5" — התלמיד כותב את מה שמוצג לפני השדה
    if (q.topic === 'eq') input = normInput(input).replace(/^[xX] ?= ?/, '');
    const raw0 = parseRawFraction(input);
    // תשובה שלמה: שבר שמשכתב את התרגיל ("56/7") אינו חישוב — מבקשים מספר
    const wholeOnly = q.answer.d === 1 && (q.topic !== 'frac' || (q.data && q.data.kind === 'ofQty'));
    if (wholeOnly && raw0 && raw0.d !== 1) return { status: 'unparsed', hint: 'whole' };
    const v = parseNumber(input);
    // מקלדת עברית: '/' מוקלד כ-'.' — "3.4" כשהתשובה 3/4
    const slashed = (function () {
      if (q.topic !== 'frac' || q.answer.d === 1) return null;
      const s = normInput(input);
      if (!/^(\d+ )?\d+\.\d+$/.test(s)) return null;
      return parseNumber(s.replace('.', '/'));
    })();
    if (!v) return slashed && fracEq(slashed, q.answer) ? { status: 'unparsed', hint: 'hebrew-slash' } : { status: 'unparsed' };
    if (!fracEq(v, q.answer)) return slashed && fracEq(slashed, q.answer) ? { status: 'unparsed', hint: 'hebrew-slash' } : { status: 'wrong' };
    if (q.requireReduced) {
      const raw = parseRawFraction(input);
      if (raw && !isReduced(raw.n, raw.d)) return { status: 'not-reduced' };
    }
    return { status: 'correct' };
  }

  // ---------------------------------------------------------------- נושאים ורמות
  // maxLevel — לפי כיתה א'..ח' (0 = הנושא עוד לא נלמד בכיתה הזו)
  const TOPICS = [
    { id: 'add', name: 'חיבור', glyph: '+', desc: 'עם ובלי המרה', maxLevel: [2, 4, 5, 6, 6, 6, 6, 6] },
    { id: 'sub', name: 'חיסור', glyph: '−', desc: 'עם ובלי פריטה', maxLevel: [2, 4, 5, 6, 6, 6, 6, 6] },
    { id: 'multable', name: 'לוח הכפל', glyph: '×', desc: 'עובדות הכפל עד 10×10', maxLevel: [0, 2, 4, 4, 4, 4, 4, 4] },
    { id: 'longmul', name: 'כפל ארוך', glyph: '×׳', desc: 'כפל במאונך', maxLevel: [0, 0, 2, 4, 5, 5, 5, 5] },
    { id: 'div', name: 'חילוק', glyph: '÷', desc: 'חילוק ושארית', maxLevel: [0, 2, 3, 4, 5, 5, 5, 5] },
    { id: 'order', name: 'סדר פעולות', glyph: '( )', desc: 'סוגריים, כפל וחילוק קודם', maxLevel: [0, 0, 2, 3, 4, 5, 5, 5] },
    { id: 'frac', name: 'שברים', glyph: '½', desc: 'שבר מכמות, השוואה, צמצום וחיבור', maxLevel: [0, 0, 2, 3, 4, 5, 5, 5] },
    { id: 'dec', name: 'מספרים עשרוניים', glyph: '0.5', desc: 'חיבור, השוואה, כפל וחילוק', maxLevel: [0, 0, 0, 2, 3, 5, 5, 5] },
    { id: 'pct', name: 'אחוזים', glyph: '%', desc: 'אחוז מכמות והנחות', maxLevel: [0, 0, 0, 0, 2, 4, 5, 5] },
    { id: 'word', name: 'שאלות מילוליות', glyph: '?', desc: 'סיפורים מהבית, מהכיתה ומהמכולת', maxLevel: [2, 3, 4, 5, 5, 5, 5, 5] },
    { id: 'round', name: 'עיגול מספרים', glyph: '≈', desc: 'לעשרות, למאות ולאלפים', maxLevel: [0, 2, 3, 4, 5, 5, 5, 5] },
    { id: 'money', name: 'כסף', glyph: '₪', desc: 'שקלים, אגורות ועודף', maxLevel: [1, 2, 3, 4, 5, 6, 6, 6] },
    // כיתות ו'–ח'
    { id: 'ratio', name: 'יחס ופרופורציה', glyph: ':', desc: 'מחיר ליחידה, חלוקה ביחס, קנה מידה', maxLevel: [0, 0, 0, 0, 0, 2, 4, 5] },
    { id: 'geo', name: 'שטח, היקף ונפח', glyph: '▭', desc: 'מלבן, משולש, טרפז, תיבה ומעגל', maxLevel: [0, 0, 0, 1, 2, 3, 4, 5] },
    { id: 'neg', name: 'מספרים מכוונים', glyph: '±', desc: 'מספרים שליליים: חיבור, חיסור, כפל וחילוק', maxLevel: [0, 0, 0, 0, 0, 0, 3, 5] },
    { id: 'pow', name: 'חזקות ושורשים', glyph: 'x²', desc: 'חזקות, שורשים וסדר פעולות', maxLevel: [0, 0, 0, 0, 0, 0, 3, 5] },
    { id: 'eq', name: 'משוואות', glyph: 'x=', desc: 'משוואות ממעלה ראשונה', maxLevel: [0, 0, 0, 0, 0, 0, 3, 5] }
  ];
  const TOPIC_IDS = TOPICS.map(t => t.id);
  const GRADES = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  function topicById(id) { return TOPICS.find(t => t.id === id) || null; }
  function clampGrade(g) { g = Math.trunc(Number(g)); return g >= 1 && g <= 8 ? g : 1; }
  function maxLevelFor(topic, grade) { const t = topicById(topic); return t ? t.maxLevel[clampGrade(grade) - 1] : 0; }
  function topicsForGrade(grade) { return TOPICS.filter(t => maxLevelFor(t.id, grade) > 0); }
  function clampLevel(topic, grade, level) {
    const max = maxLevelFor(topic, grade);
    if (!max) return 0;
    level = Math.trunc(Number(level));
    if (!Number.isFinite(level) || level < 1) return 1;
    return Math.min(level, max);
  }
  function startLevel(topic, grade) { const max = maxLevelFor(topic, grade); return max ? Math.max(1, max - 2) : 0; }
  function gradeName(g) { return GRADES[clampGrade(g) - 1] + "'"; }

  // ---------------------------------------------------------------- עזרי הסבר
  // ⟦...⟧ — ביטוי חשבוני שהממשק מציג משמאל לימין
  const E = s => '⟦' + s + '⟧';
  const PLACES = ['אחדות', 'עשרות', 'מאות', 'אלפים', 'עשרות אלפים', 'מאות אלפים'];
  function digits(n) { return String(n).split('').reverse().map(Number); }

  function addColumnSteps(a, b) {
    const da = digits(a), db = digits(b), steps = [];
    let carry = 0;
    const len = Math.max(da.length, db.length);
    for (let i = 0; i < len; i++) {
      const x = da[i] || 0, y = db[i] || 0, s = x + y + carry;
      const expr = x + ' + ' + y + (carry ? ' + ' + carry : '') + ' = ' + s;
      if (s >= 10 && i < len - 1) steps.push(PLACES[i] + ': ' + E(expr) + ' — כותבים ' + (s % 10) + ' ומעבירים 1 ל' + PLACES[i + 1]);
      else steps.push(PLACES[i] + ': ' + E(expr) + (s >= 10 ? ' — כותבים ' + s : ''));
      carry = s >= 10 ? 1 : 0;
    }
    return steps;
  }
  function subColumnSteps(a, b) {
    const da = digits(a), db = digits(b), steps = [];
    let borrow = 0;
    for (let i = 0; i < da.length; i++) {
      let top = da[i] - borrow; const y = db[i] || 0;
      // פריטה דרך אפס: אין מה לפרוט כאן — פורטים מהמקום הבא ל-10, ואחת מהן כבר עברה הלאה; נשארות 9 (לא מספר שלילי)
      if (borrow && da[i] === 0) {
        steps.push(PLACES[i] + ': אין ' + PLACES[i] + ' לפרוט — פורטים 1 מה' + PLACES[i + 1] + ' ל-10 ' + PLACES[i] + ', ואחת מהן עברה ל' + PLACES[i - 1] + ' — נשארות ' + E('9') + ': ' + E('9 − ' + y + ' = ' + (9 - y)));
        borrow = 1;
        continue;
      }
      const shown = borrow ? E(da[i] + ' − 1 = ' + top) + ' (אחרי הפריטה), ' : '';
      if (top < y) {
        steps.push(PLACES[i] + ': ' + shown + 'אי אפשר להחסיר ' + E(String(y)) + ' מ-' + E(String(top)) + ' — פורטים 1 מה' + PLACES[i + 1] + ': ' + E((top + 10) + ' − ' + y + ' = ' + (top + 10 - y)));
        borrow = 1;
      } else {
        if (i >= db.length && !borrow) continue;
        steps.push(PLACES[i] + ': ' + shown + E(top + ' − ' + y + ' = ' + (top - y)));
        borrow = 0;
      }
    }
    return steps;
  }
  function needsCarry(a, b) { const da = digits(a), db = digits(b); let c = 0; for (let i = 0; i < Math.max(da.length, db.length); i++) { const s = (da[i] || 0) + (db[i] || 0) + c; if (s >= 10) return true; c = 0; } return false; }
  function needsBorrow(a, b) { const da = digits(a), db = digits(b); for (let i = 0; i < db.length; i++) if (da[i] < db[i]) return true; return false; }

  function mk(topic, level, o) {
    return Object.assign({ topic, level, kind: 'number', expr: null, prompt: '', steps: [], data: {} }, o);
  }
  function intQ(topic, level, o, value) {
    o.answer = frac(value, 1);
    o.answerText = o.answerText || fmtInt(value);
    return mk(topic, level, o);
  }

  // ---------------------------------------------------------------- מחוללים
  function genAdd(level, R) {
    let a, b;
    if (level <= 1) { a = ri(R, 1, 9); b = ri(R, 1, 10 - a); }
    else if (level === 2) { if (R() < 0.7) { a = ri(R, 3, 9); b = ri(R, 2, 9); } else { a = ri(R, 11, 18); b = ri(R, 1, 20 - a); } }
    else if (level === 3) { const a1 = ri(R, 1, 8), b1 = ri(R, 1, 9 - a1), a0 = ri(R, 0, 9), b0 = ri(R, 0, 9 - a0); a = a1 * 10 + a0; b = b1 * 10 + b0; }
    else if (level === 4) { const a0 = ri(R, 1, 9), b0 = ri(R, 10 - a0, 9), a1 = ri(R, 1, 7), b1 = ri(R, 1, 8 - a1); a = a1 * 10 + a0; b = b1 * 10 + b0; }
    else if (level === 5) { a = ri(R, 100, 899); b = ri(R, 100, 999 - a); }
    else { a = ri(R, 1000, 8999); b = ri(R, 1000, Math.max(1000, 9999 - a)); if (a + b > 9999) b = 9999 - a; }
    const s = a + b, steps = [];
    if (a >= 10 || b >= 10) steps.push(...addColumnSteps(a, b));
    else if (s > 10) steps.push('משלימים לעשר: ' + E(a + ' + ' + (10 - a) + ' = 10') + ', ועוד ' + E(String(b - (10 - a))) + ' — ' + E('10 + ' + (b - (10 - a)) + ' = ' + s));
    else steps.push('סופרים ' + b + ' קדימה מ-' + a + ': ' + E(a + ' + ' + b + ' = ' + s));
    steps.push('התשובה: ' + E(a + ' + ' + b + ' = ' + s));
    return intQ('add', level, { expr: a + ' + ' + b + ' = ?', prompt: 'כמה זה?', steps, data: { a, b, op: '+', carry: needsCarry(a, b) }, column: { a, b, op: '+', result: s } }, s);
  }

  function genSub(level, R) {
    let a, b;
    if (level <= 1) { a = ri(R, 2, 10); b = ri(R, 1, a); }
    else if (level === 2) { a = ri(R, 11, 20); b = ri(R, 2, 9); }
    else if (level === 3) { const a1 = ri(R, 2, 9), a0 = ri(R, 0, 9), b1 = ri(R, 1, a1), b0 = ri(R, 0, a0); a = a1 * 10 + a0; b = b1 * 10 + b0; }
    else if (level === 4) { const a0 = ri(R, 0, 8), b0 = ri(R, a0 + 1, 9), a1 = ri(R, 2, 9), b1 = ri(R, 1, a1 - 1); a = a1 * 10 + a0; b = b1 * 10 + b0; }
    else if (level === 5) { a = ri(R, 200, 999); b = ri(R, 100, a - 1); }
    else { a = ri(R, 2000, 9999); b = ri(R, 1000, a - 1); }
    const d = a - b, steps = [];
    if (a >= 10 && b >= 10) steps.push(...subColumnSteps(a, b));
    else if (a > 10 && a - b < 10) steps.push('מחסירים עד 10 ואז את השאר: ' + E(a + ' − ' + (a - 10) + ' = 10') + ', ' + E('10 − ' + (b - (a - 10)) + ' = ' + d));
    else steps.push('סופרים ' + b + ' אחורה מ-' + a + ': ' + E(a + ' − ' + b + ' = ' + d));
    steps.push('בדיקה בחיבור: ' + E(d + ' + ' + b + ' = ' + a));
    return intQ('sub', level, { expr: a + ' − ' + b + ' = ?', prompt: 'כמה זה?', steps, data: { a, b, op: '-', borrow: needsBorrow(a, b) }, column: { a, b, op: '−', result: d } }, d);
  }

  function factKey(a, b) { return Math.min(a, b) + 'x' + Math.max(a, b); }
  function mulFactSteps(a, b) {
    const p = a * b, steps = [];
    if (a === 1 || b === 1) steps.push('כל מספר כפול 1 שווה לעצמו: ' + E(a + ' × ' + b + ' = ' + p));
    else if (a === 10 || b === 10) steps.push('כפל ב-10 — מוסיפים אפס: ' + E(a + ' × ' + b + ' = ' + p));
    else if (b === 9 || a === 9) { const o = a === 9 ? b : a; steps.push('טריק התשע: ' + E(o + ' × 9 = ' + o + ' × 10 − ' + o + ' = ' + (o * 10) + ' − ' + o + ' = ' + p)); }
    else if (Math.min(a, b) <= 4) { const s = Math.min(a, b), o = Math.max(a, b); steps.push(s + ' פעמים ' + o + ': ' + E(Array(s).fill(o).join(' + ') + ' = ' + p)); }
    else { const o = a >= b ? a : b, s = a >= b ? b : a; steps.push('מפרקים: ' + E(o + ' × ' + s + ' = 5 × ' + s + ' + ' + (o - 5) + ' × ' + s + ' = ' + (5 * s) + ' + ' + ((o - 5) * s) + ' = ' + p)); }
    return steps;
  }
  function genMulTable(level, R, opts) {
    let a, b;
    if (opts && Array.isArray(opts.fact)) { a = opts.fact[0]; b = opts.fact[1]; }
    else if (level <= 1) { a = pick(R, [1, 2, 5, 10]); b = ri(R, 1, 10); }
    else if (level === 2) { a = ri(R, 1, 5); b = ri(R, 1, 10); }
    else { a = ri(R, 2, 10); b = ri(R, 2, 10); }
    if (R() < 0.5) { const t = a; a = b; b = t; }
    const p = a * b, steps = mulFactSteps(a, b);
    const data = { a, b, product: p, fact: factKey(a, b) };
    if (level >= 4 && !(opts && opts.fact)) {
      const missLeft = R() < 0.5;
      steps.unshift('מחפשים את המספר החסר: ' + E(p + ' ÷ ' + (missLeft ? b : a) + ' = ' + (missLeft ? a : b)));
      return intQ('multable', level, { expr: missLeft ? '? × ' + b + ' = ' + p : a + ' × ? = ' + p, prompt: 'איזה מספר חסר?', steps, data: Object.assign(data, { missing: missLeft ? 'a' : 'b' }) }, missLeft ? a : b);
    }
    return intQ('multable', level, { expr: a + ' × ' + b + ' = ?', prompt: 'כמה זה?', steps, data }, p);
  }

  function genLongMul(level, R) {
    let a, b;
    if (level <= 1) { a = ri(R, 12, 99); b = ri(R, 2, 9); }
    else if (level === 2) { a = ri(R, 102, 999); b = ri(R, 2, 9); }
    else if (level === 3) { a = ri(R, 12, 99); b = ri(R, 11, 99); }
    else if (level === 4) { a = ri(R, 102, 999); b = ri(R, 11, 99); }
    else { a = ri(R, 102, 999); b = ri(R, 101, 999); }
    const p = a * b, steps = [];
    if (b < 10) {
      const parts = digits(a).map((d, i) => d * Math.pow(10, i)).filter(x => x).reverse();
      steps.push('מפרקים לפי ערך המקום: ' + E(a + ' = ' + parts.join(' + ')));
      parts.forEach(x => steps.push(E(x + ' × ' + b + ' = ' + (x * b))));
      steps.push('מחברים: ' + E(parts.map(x => x * b).join(' + ') + ' = ' + p));
    } else {
      const parts = digits(b).map((d, i) => ({ d, v: d * Math.pow(10, i) })).filter(x => x.d);
      parts.forEach(x => steps.push('כפל ב' + (x.v < 10 ? '' : '-') + x.v + ': ' + E(a + ' × ' + x.v + ' = ' + (a * x.v))));
      steps.push('מחברים את המכפלות החלקיות: ' + E(parts.map(x => a * x.v).join(' + ') + ' = ' + p));
    }
    return intQ('longmul', level, { expr: a + ' × ' + b + ' = ?', prompt: 'פתרו במאונך', steps, data: { a, b } }, p);
  }

  function longDivSteps(N, d) {
    const steps = [], ds = String(N);
    let cur = 0, q = '';
    for (let i = 0; i < ds.length; i++) {
      cur = cur * 10 + Number(ds[i]);
      const k = Math.floor(cur / d);
      if (k > 0 || q) {
        q += k;
        if (k > 0) steps.push('כמה פעמים ' + E(String(d)) + ' נכנס ב-' + E(String(cur)) + '? ' + E(String(k)) + ' פעמים: ' + E(k + ' × ' + d + ' = ' + (k * d)) + ', נשאר ' + E(cur + ' − ' + (k * d) + ' = ' + (cur - k * d)));
        else steps.push(E(String(d)) + ' לא נכנס ב-' + E(String(cur)) + ' — כותבים 0 במנה');
      }
      cur = cur - k * d;
    }
    return steps;
  }
  function genDiv(level, R) {
    let d, q, r = 0;
    if (level <= 1) { d = ri(R, 2, 5); q = ri(R, 1, 5); }
    else if (level === 2) { d = ri(R, 2, 10); q = ri(R, 2, 10); }
    else if (level === 3) { d = ri(R, 2, 9); q = ri(R, 2, 9); r = ri(R, 0, d - 1); }
    else if (level === 4) { d = ri(R, 2, 9); q = ri(R, 12, Math.floor((999 - (d - 1)) / d)); r = ri(R, 0, d - 1); }
    else { d = ri(R, 11, 25); q = ri(R, 12, 99); r = ri(R, 0, d - 1); }
    const N = d * q + r, steps = [];
    if (level <= 3) {
      steps.push('מחפשים במכפלות של ' + E(String(d)) + ' את הגדולה ביותר שלא עוברת את ' + E(String(N)) + ': ' + E(q + ' × ' + d + ' = ' + (q * d)));
      if (level === 3) steps.push('השארית: ' + E(N + ' − ' + (q * d) + ' = ' + r) + (r ? '' : ' — אין שארית'));
    } else steps.push(...longDivSteps(N, d));
    steps.push('בדיקה: ' + E(q + ' × ' + d + (r ? ' + ' + r : '') + ' = ' + N));
    const data = { N, d, q, r };
    if (level <= 2) return intQ('div', level, { expr: N + ' ÷ ' + d + ' = ?', prompt: 'כמה זה?', steps, data }, q);
    return mk('div', level, { kind: 'divrem', expr: N + ' ÷ ' + d + ' = ?', prompt: 'מה המנה ומה השארית?', answer: { q, r }, answerText: r ? q + ' (שארית ' + r + ')' : String(q) + ' (בלי שארית)', steps, data });
  }

  // ---- סדר פעולות: ביטוי כרשימת אסימונים, הערכה צעד אחר צעד
  function tokenize(s) {
    const t = [], re = /\s*(\d+|[()+−×÷])/gy; let m;
    while ((m = re.exec(s))) t.push(/\d/.test(m[1]) ? Number(m[1]) : m[1]);
    return t;
  }
  function tokStr(t) {
    let out = '';
    t.forEach((x, i) => {
      if (x === '(') out += (i && t[i - 1] !== '(' ? ' ' : '') + '(';
      else if (x === ')') out += ')';
      else out += (i && t[i - 1] !== '(' ? ' ' : '') + x;
    });
    return out;
  }
  // צעד אחד: סוגריים פנימיים קודם; בתוכם כפל/חילוק משמאל לימין, אחר כך חיבור/חיסור. null = לא חוקי (שלילי / חילוק לא שלם)
  function evalStep(t) {
    let s = 0, e = t.length;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '(') s = i + 1;
      else if (t[i] === ')') { e = i; break; }
    }
    if (e === t.length) s = 0;
    if (e - s === 1 && s > 0) return t.slice(0, s - 1).concat([t[s]], t.slice(e + 1));
    let idx = -1;
    for (let i = s; i < e; i++) if (t[i] === '×' || t[i] === '÷') { idx = i; break; }
    if (idx < 0) for (let i = s; i < e; i++) if (t[i] === '+' || t[i] === '−') { idx = i; break; }
    if (idx < 0) return null;
    const x = t[idx - 1], y = t[idx + 1], op = t[idx];
    let v;
    if (op === '+') v = x + y; else if (op === '−') v = x - y; else if (op === '×') v = x * y;
    else { if (y === 0 || x % y) return null; v = x / y; }
    if (v < 0) return null;
    let out = t.slice(0, idx - 1).concat([v], t.slice(idx + 2));
    // סוגריים שנשאר בהם מספר יחיד — מסירים באותו צעד
    for (let i = 0; i + 2 < out.length; i++) if (out[i] === '(' && typeof out[i + 1] === 'number' && out[i + 2] === ')') { out = out.slice(0, i).concat([out[i + 1]], out.slice(i + 3)); break; }
    return out;
  }
  function evalExpr(str) {
    let t = tokenize(str); const seq = [tokStr(t)];
    let guard = 0;
    while (t.length > 1 && guard++ < 50) { t = evalStep(t); if (!t) return null; seq.push(tokStr(t)); }
    return typeof t[0] === 'number' ? { value: t[0], seq } : null;
  }
  const ORDER_TEMPLATES = [
    null,
    ['a + b × c', 'a × b + c', 'a − b × c', 'a + b ÷ c'],
    ['a × b − c × d', 'a + b ÷ c', 'a ÷ b + c × d', 'a × b + c × d'],
    ['(a + b) × c', 'a × (b − c)', '(a − b) ÷ c', 'a + (b + c) × d'],
    ['a + b × c − d ÷ e', '(a + b) × (c − d)', 'a × (b + c) − d', '(a + b) ÷ c + d'],
    ['((a + b) × c − d) ÷ e', 'a × b − (c + d) ÷ e', '(a + b × c) ÷ d', 'a × (b − (c − d))']
  ];
  function genOrder(level, R) {
    level = Math.max(1, Math.min(5, level));
    for (let tries = 0; tries < 400; tries++) {
      const tpl = pick(R, ORDER_TEMPLATES[level]);
      const expr = tpl.replace(/[a-e]/g, () => String(ri(R, level <= 2 ? 2 : 1, level <= 1 ? 9 : 12)));
      const r = evalExpr(expr);
      if (!r || r.value > 999) continue;
      const steps = ['קודם סוגריים, אחר כך כפל וחילוק, ובסוף חיבור וחיסור — משמאל לימין.'];
      for (let i = 1; i < r.seq.length; i++) steps.push(E(r.seq[i - 1] + ' = ' + r.seq[i]));
      return intQ('order', level, { expr: expr + ' = ?', prompt: 'פתרו לפי סדר הפעולות', steps, data: { expr } }, r.value);
    }
    return intQ('order', level, { expr: '2 + 3 × 4 = ?', prompt: 'פתרו לפי סדר הפעולות', steps: [E('2 + 3 × 4 = 2 + 12'), E('2 + 12 = 14')], data: { expr: '2 + 3 × 4' } }, 14);
  }

  // ---- שברים
  function simplifySteps(n, d) {
    const g = gcd(n, d);
    if (g === 1) return ['השבר ' + E(n + '/' + d) + ' כבר מצומצם.'];
    return ['מחפשים את המספר הגדול ביותר שמחלק גם את ' + E(String(n)) + ' וגם את ' + E(String(d)) + ' (המחלק המשותף הגדול ביותר): ' + E(String(g)),
      'מחלקים את המונה ואת המכנה ב-' + E(String(g)) + ': ' + E(n + ' ÷ ' + g + ' = ' + (n / g)) + ', ' + E(d + ' ÷ ' + g + ' = ' + (d / g)),
      'ולכן: ' + E(n + '/' + d + ' = ' + (n / g) + '/' + (d / g))];
  }
  function cmpSym(c) { return c < 0 ? '<' : c > 0 ? '>' : '='; }
  function compareSteps(a, b) {
    if (a.d === b.d) return ['המכנים שווים — משווים מונים: ' + E(a.n + ' ' + cmpSym(Math.sign(a.n - b.n)) + ' ' + b.n)];
    if (a.n === b.n) return ['המונים שווים — מכנה גדול יותר פירושו חלקים קטנים יותר: ' + E(a.n + '/' + a.d + ' ' + cmpSym(fracCompare(a, b)) + ' ' + b.n + '/' + b.d)];
    const L = lcm(a.d, b.d);
    return ['מכנה משותף: ' + E(String(L)),
      E(a.n + '/' + a.d + ' = ' + (a.n * L / a.d) + '/' + L) + ', ' + E(b.n + '/' + b.d + ' = ' + (b.n * L / b.d) + '/' + L),
      E((a.n * L / a.d) + '/' + L + ' ' + cmpSym(fracCompare(a, b)) + ' ' + (b.n * L / b.d) + '/' + L)];
  }
  function fracAnsText(f) { return mixedStr(f) + (Math.abs(f.n) > f.d && f.d > 1 ? ' (' + fracStr(f) + ')' : ''); }
  function addFracSteps(a, b, op) {
    const res = op === '+' ? fracAdd(a, b) : fracSub(a, b), steps = [];
    const L = lcm(a.d, b.d), an = a.n * L / a.d, bn = b.n * L / b.d, rn = op === '+' ? an + bn : an - bn;
    if (a.d !== b.d) steps.push('מביאים למכנה משותף ' + E(String(L)) + ': ' + E(a.n + '/' + a.d + ' = ' + an + '/' + L) + ', ' + E(b.n + '/' + b.d + ' = ' + bn + '/' + L));
    steps.push((op === '+' ? 'מחברים' : 'מחסירים') + ' את המונים: ' + E(an + '/' + L + ' ' + (op === '+' ? '+' : '−') + ' ' + bn + '/' + L + ' = ' + rn + '/' + L));
    if (gcd(rn, L) > 1 && rn) steps.push('מצמצמים: ' + E(rn + '/' + L + ' = ' + fracStr(res)));
    if (res.n > res.d && res.d > 1) steps.push('כשבר מעורב: ' + E(fracStr(res) + ' = ' + mixedStr(res)));
    return { res, steps };
  }
  function randFrac(R, maxD, proper) {
    const d = ri(R, 2, maxD), n = proper ? ri(R, 1, d - 1) : ri(R, 1, 2 * d - 1);
    return { n, d };
  }
  function genFrac(level, R) {
    // רמות 1–2 (כיתה ג'): שבר כחלק מכמות והשוואת שברי יחידה; צמצום — מרמה 3 (כיתה ד')
    const kinds = level <= 1 ? ['unitCmp', 'ofQty'] : level === 2 ? ['unitCmp', 'cmpSame', 'ofQty'] : level === 3 ? ['addSame', 'subSame', 'cmpSame', 'simplify']
      : level === 4 ? ['addDiff', 'cmpDiff', 'ofQty'] : ['addDiff', 'subDiff', 'cmpDiff', 'ofQty', 'addMixed'];
    const kind = pick(R, kinds);
    if (kind === 'unitCmp') {
      const x = ri(R, 2, 8); let y = ri(R, 2, 8); if (y === x) y = x === 8 ? 2 : x + 1;
      const a = { n: 1, d: x }, b = { n: 1, d: y }, c = fracCompare(a, b);
      return mk('frac', level, { kind: 'choice', choices: ['<', '=', '>'], expr: '1/' + x + ' ☐ 1/' + y, prompt: 'בחרו את הסימן המתאים', answer: cmpSym(c), answerText: '1/' + x + ' ' + cmpSym(c) + ' 1/' + y,
        steps: ['מחלקים שלם אחד ל-' + E(String(x)) + ' חלקים או ל-' + E(String(y)) + ' חלקים: כשיש יותר חלקים, כל חלק קטן יותר.', E('1/' + x + ' ' + cmpSym(c) + ' 1/' + y)], data: { kind, a, b } });
    }
    if (kind === 'simplify') {
      const d0 = ri(R, 2, level <= 3 ? 6 : 10), n0 = ri(R, 1, d0 - 1), k = ri(R, 2, level <= 3 ? 4 : 6);
      const n = n0 * k, d = d0 * k, res = frac(n, d);
      return mk('frac', level, { expr: n + '/' + d + ' = ?', prompt: 'צמצמו את השבר עד הסוף', answer: res, answerText: fracStr(res), requireReduced: true, steps: simplifySteps(n, d), data: { kind, n, d } });
    }
    if (kind === 'cmpSame' || kind === 'cmpDiff') {
      let a, b;
      if (kind === 'cmpSame') {
        if (R() < 0.6) { const d = ri(R, 3, 12); a = { n: ri(R, 1, d - 1), d }; b = { n: ri(R, 1, d - 1), d }; }
        else { const n = ri(R, 1, 5); a = { n, d: ri(R, n + 1, 12) }; b = { n, d: ri(R, n + 1, 12) }; }
      } else {
        a = randFrac(R, 10, true); b = randFrac(R, 10, true);
        if (R() < 0.15) { const k = ri(R, 2, 3); b = { n: a.n * k, d: a.d * k }; }
      }
      const c = fracCompare(a, b);
      return mk('frac', level, { kind: 'choice', choices: ['<', '=', '>'], expr: a.n + '/' + a.d + ' ☐ ' + b.n + '/' + b.d, prompt: 'בחרו את הסימן המתאים', answer: cmpSym(c), answerText: a.n + '/' + a.d + ' ' + cmpSym(c) + ' ' + b.n + '/' + b.d, steps: compareSteps(a, b), data: { kind, a, b } });
    }
    if (kind === 'ofQty') {
      const small = level <= 2, d = small ? ri(R, 2, 4) : ri(R, 2, 10), n = small && R() < 0.6 ? 1 : ri(R, 1, d - 1), q = d * ri(R, 2, small ? 6 : 12), res = q / d * n;
      return intQ('frac', level, { expr: n + '/' + d + ' × ' + q + ' = ?', prompt: 'כמה הם ' + n + '/' + d + ' מתוך ' + q + '?', steps: ['מחלקים ל-' + E(String(d)) + ' חלקים: ' + E(q + ' ÷ ' + d + ' = ' + (q / d)), 'לוקחים ' + E(String(n)) + ' חלקים: ' + E((q / d) + ' × ' + n + ' = ' + res)], data: { kind, n, d, q } }, res);
    }
    let a, b, op = '+';
    if (kind === 'addSame' || kind === 'subSame') {
      const d = ri(R, 3, 12); a = { n: ri(R, 1, d - 1), d }; b = { n: ri(R, 1, d - 1), d };
      if (kind === 'subSame') { op = '−'; if (a.n < b.n) { const t = a; a = b; b = t; } }
    } else if (kind === 'addMixed') {
      a = { n: ri(R, 1, 3), d: 1 }; const f = randFrac(R, 8, true); a = { n: a.n * f.d + f.n, d: f.d }; b = randFrac(R, 8, true);
    } else {
      a = randFrac(R, level >= 5 ? 12 : 8, true); b = randFrac(R, level >= 5 ? 12 : 8, true);
      if (kind === 'subDiff') { op = '−'; if (fracCompare(a, b) < 0) { const t = a; a = b; b = t; } }
    }
    const r = addFracSteps(a, b, op === '+' ? '+' : '-');
    const aTxt = kind === 'addMixed' ? mixedStr(a) : a.n + '/' + a.d;
    if (kind === 'addMixed') r.steps.unshift('ממירים לשבר: ' + E(mixedStr(a) + ' = ' + a.n + '/' + a.d));
    return mk('frac', level, { expr: aTxt + ' ' + op + ' ' + b.n + '/' + b.d + ' = ?', prompt: 'אפשר לענות בשבר (3/4) או בשבר מעורב (1 1/2)', answer: r.res, answerText: fracAnsText(r.res), steps: r.steps, data: { kind, a, b, op } });
  }

  // ---- מספרים עשרוניים (מונה שלם על 10^p)
  function D(n, p) { return fmtScaled(n, p, 0); }
  function genDec(level, R) {
    if (level <= 1) {
      const a = ri(R, 1, 59), b = ri(R, 1, 39), s = a + b;
      return mk('dec', level, { expr: D(a, 1) + ' + ' + D(b, 1) + ' = ?', prompt: 'כמה זה?', answer: frac(s, 10), answerText: D(s, 1), steps: ['מחברים עשיריות לעשיריות: ' + E(a + ' + ' + b + ' = ' + s) + ' עשיריות', E(s + '/10 = ' + D(s, 1))], data: { a: frac(a, 10), b: frac(b, 10), op: '+' } });
    }
    if (level === 2) {
      const a = ri(R, 100, 999), b = ri(R, 10, a), add = R() < 0.5, s = add ? a + b : a - b;
      return mk('dec', level, { expr: D(a, 2) + (add ? ' + ' : ' − ') + D(b, 2) + ' = ?', prompt: 'כמה זה?', answer: frac(s, 100), answerText: D(s, 2), steps: ['מסדרים את הנקודה העשרונית זו מתחת לזו ועובדים במאיות: ' + E(a + (add ? ' + ' : ' − ') + b + ' = ' + s), E(s + '/100 = ' + D(s, 2))], data: { a: frac(a, 100), b: frac(b, 100), op: add ? '+' : '-' } });
    }
    if (level === 3) {
      if (R() < 0.5) {
        // השוואה — כולל המלכודת 0.5 מול 0.45
        const pa = ri(R, 1, 2), pb = ri(R, 1, 2);
        const a = ri(R, 1, pa === 1 ? 9 : 99), b = ri(R, 1, pb === 1 ? 9 : 99);
        const fa = frac(a, Math.pow(10, pa)), fb = frac(b, Math.pow(10, pb)), c = fracCompare(fa, fb);
        const A = D(a, pa), B = D(b, pb);
        return mk('dec', level, { kind: 'choice', choices: ['<', '=', '>'], expr: A + ' ☐ ' + B, prompt: 'בחרו את הסימן המתאים', answer: cmpSym(c), answerText: A + ' ' + cmpSym(c) + ' ' + B, steps: ['משלימים לאותו מספר ספרות אחרי הנקודה: ' + E(D(a * Math.pow(10, 2 - pa), 2).padEnd(4, '0') + ' ' + cmpSym(c) + ' ' + D(b * Math.pow(10, 2 - pb), 2).padEnd(4, '0'))], data: { a: fa, b: fb } });
      }
      const a = ri(R, 101, 9999), p = ri(R, 2, 3), m = pick(R, [10, 100]), res = frac(a * m, Math.pow(10, p));
      return mk('dec', level, { expr: D(a, p) + ' × ' + m + ' = ?', prompt: 'כמה זה?', answer: res, answerText: decStr(res), steps: ['כפל ב-' + m + ' מזיז את הנקודה ' + (m === 10 ? 'ספרה אחת' : 'שתי ספרות') + ' ימינה: ' + E(D(a, p) + ' × ' + m + ' = ' + decStr(res))], data: { a: frac(a, Math.pow(10, p)), m } });
    }
    if (level === 4) {
      const p = ri(R, 1, 2), a = ri(R, 11, p === 1 ? 99 : 999), b = ri(R, 2, 9), res = frac(a * b, Math.pow(10, p));
      return mk('dec', level, { expr: D(a, p) + ' × ' + b + ' = ?', prompt: 'כמה זה?', answer: res, answerText: decStr(res), steps: ['כופלים בלי הנקודה: ' + E(a + ' × ' + b + ' = ' + (a * b)), 'מחזירים ' + (p === 1 ? 'ספרה אחת' : 'שתי ספרות') + ' אחרי הנקודה: ' + E(decStr(res))], data: { a: frac(a, Math.pow(10, p)), b } });
    }
    let q = ri(R, 11, 199), d = ri(R, 2, 9);
    for (let i = 0; i < 20 && (q % 10 === 0 || (q * d) % 10 === 0); i++) { q = ri(R, 11, 199); d = ri(R, 2, 9); }
    const N = q * d;
    return mk('dec', level, { expr: D(N, 1) + ' ÷ ' + d + ' = ?', prompt: 'כמה זה?', answer: frac(q, 10), answerText: D(q, 1), steps: ['מחלקים כאילו אין נקודה: ' + E(N + ' ÷ ' + d + ' = ' + q), 'מחזירים את הנקודה למקומה: ' + E(D(q, 1))], data: { N: frac(N, 10), d } });
  }

  // ---- אחוזים
  function genPct(level, R) {
    if (level <= 3) {
      let p, base;
      if (level <= 1) { p = pick(R, [50, 25, 10]); base = ri(R, 1, 20) * 20; }
      else if (level === 2) { p = ri(R, 1, 9) * 10; base = ri(R, 1, 30) * 10; }
      else { p = pick(R, [5, 15, 20, 30, 40, 60, 75, 80]); base = ri(R, 1, 25) * 20; }
      const res = base * p / 100;
      const steps = p === 50 ? ['50% זה חצי: ' + E(base + ' ÷ 2 = ' + res)] : p === 25 ? ['25% זה רבע: ' + E(base + ' ÷ 4 = ' + res)]
        : ['10% מ-' + E(String(base)) + ' הם ' + E(base + ' ÷ 10 = ' + (base / 10)), p % 10 === 0 ? E(p + '% = ' + (p / 10) + ' × 10%') + ': ' + E((p / 10) + ' × ' + (base / 10) + ' = ' + res) : E(p + '% × ' + base + ' = ' + p + ' × ' + base + ' ÷ 100 = ' + res)];
      return intQ('pct', level, { expr: p + '% × ' + base + ' = ?', prompt: 'כמה הם ' + p + '% מתוך ' + base + '?', steps, data: { p, base } }, res);
    }
    if (level === 4) {
      const b = pick(R, [10, 20, 25, 40, 50, 200, 300]), step = 100 / gcd(b, 100);
      const p = step * ri(R, 1, Math.floor(100 / step)), a = b * p / 100;
      return intQ('pct', level, { expr: a + ' / ' + b + ' = ?%', prompt: 'כמה אחוזים הם ' + a + ' מתוך ' + b + '?', answerText: p + '%', steps: ['כותבים כשבר: ' + E(a + '/' + b), 'מרחיבים למכנה 100: ' + E(a + '/' + b + ' = ' + p + '/100 = ' + p + '%')], data: { a, b } }, p);
    }
    const p = pick(R, [10, 20, 25, 30, 50]), price = ri(R, 1, 25) * 20, off = price * p / 100, res = price - off;
    const item = pick(R, ['ספר', 'סט מחברות', 'שעון קיר', 'סידור', 'ילקוט']);
    return intQ('pct', level, { prompt: item + ' עולה ' + price + ' ₪, ויש עליו הנחה של ' + p + '%. כמה ישלמו אחרי ההנחה?', expr: null, answerText: res + ' ₪', unit: '₪', steps: ['ההנחה: ' + E(p + '% × ' + price + ' = ' + off) + ' ₪', 'המחיר אחרי ההנחה: ' + E(price + ' − ' + off + ' = ' + res) + ' ₪'], data: { p, price } }, res);
  }

  // ---- שאלות מילוליות
  const BOYS = ['יוסי', 'מנחם', 'דוד', 'חיים', 'שמוליק', 'אברהמי'];
  const GIRLS = ["שרה'לה", 'רבקה', 'חנה', 'לאה', 'מירי', 'אסתי'];
  const WORD = {
    add: [
      v => [v.boy + ' סידר על המדף ' + v.a + ' ספרים, ואבא הביא לו עוד ' + v.b + ' ספרים. כמה ספרים יש עכשיו על המדף?', 'ספרים'],
      v => ['בקופת הצדקה של ' + v.girl + ' היו ' + v.a + ' מטבעות. היא הכניסה עוד ' + v.b + ' מטבעות. כמה מטבעות יש בקופה?', 'מטבעות'],
      v => ['לכבוד שבת אמא אפתה ' + v.a + ' חלות גדולות ו-' + v.b + ' חלות קטנות. כמה חלות אפתה בסך הכול?', 'חלות'],
      v => ['בכיתה של ' + v.boy + ' יש ' + v.a + ' תלמידים בשורה הראשונה ו-' + v.b + ' תלמידים בשורה השנייה. כמה תלמידים בשתי השורות?', 'תלמידים'],
      v => [v.girl + ' קנתה במכולת ' + v.a + ' תפוחים, ואחר כך עוד ' + v.b + ' תפוחים. כמה תפוחים קנתה?', 'תפוחים']
    ],
    sub: [
      v => ['במכולת היו ' + v.a + ' בקבוקי חלב. ' + v.boy + ' קנה ' + v.b + ' בקבוקים. כמה בקבוקים נשארו?', 'בקבוקים'],
      v => ['ל' + v.girl + ' היו ' + v.a + ' מדבקות. היא נתנה ' + v.b + ' מדבקות לאחותה הקטנה. כמה מדבקות נשארו לה?', 'מדבקות'],
      v => ['במסכת יש ' + v.a + ' דפים. ' + v.boy + ' כבר למד ' + v.b + ' דפים. כמה דפים נשאר לו ללמוד?', 'דפים'],
      v => ['בצנצנת היו ' + v.a + ' עוגיות. הילדים אכלו ' + v.b + ' עוגיות. כמה עוגיות נשארו?', 'עוגיות']
    ],
    mul: [
      v => [v.boy + ' קנה ' + v.a + ' חבילות עוגיות, ובכל חבילה ' + v.b + ' עוגיות. כמה עוגיות קנה בסך הכול?', 'עוגיות'],
      v => ['בארון הספרים יש ' + v.a + ' מדפים, ובכל מדף ' + v.b + ' ספרים. כמה ספרים יש בארון?', 'ספרים'],
      v => ['בשמחה יש ' + v.a + ' שולחנות, ועל כל שולחן ' + v.b + ' כוסות. כמה כוסות יש?', 'כוסות'],
      v => [v.girl + ' אפתה ' + v.a + ' תבניות, ובכל תבנית ' + v.b + ' לחמניות. כמה לחמניות אפתה?', 'לחמניות']
    ],
    div: [
      v => [v.girl + ' חילקה ' + v.a + ' סוכריות שווה בשווה בין ' + v.b + ' ילדים. כמה סוכריות קיבל כל ילד?', 'סוכריות'],
      v => ['המלמד חילק ' + v.a + ' תלמידים לקבוצות של ' + v.b + '. כמה קבוצות יצאו?', 'קבוצות'],
      v => [v.boy + ' שם בקופת הצדקה ' + v.a + ' ₪ במשך ' + v.b + ' ימים, אותו סכום בכל יום. כמה שקלים שם בכל יום?', '₪'],
      v => ['אמא סידרה ' + v.a + ' ביצים בתבניות של ' + v.b + '. כמה תבניות מילאה?', 'תבניות']
    ]
  };
  function genWord(level, R) {
    const v = { boy: pick(R, BOYS), girl: pick(R, GIRLS) };
    let op, a, b, expr, res, steps, text, unit;
    if (level <= 1) { op = 'add'; a = ri(R, 2, 9); b = ri(R, 2, 15 - a); }
    else if (level === 2) { op = pick(R, ['add', 'sub']); a = op === 'add' ? ri(R, 8, 18) : ri(R, 8, 20); b = ri(R, 2, op === 'add' ? 20 - a : a - 1); }
    else if (level === 3) { op = pick(R, ['add', 'sub']); a = ri(R, 20, op === 'add' ? 95 : 99); b = ri(R, 5, op === 'add' ? 100 - a : a - 1); }
    else if (level === 4) { op = pick(R, ['mul', 'div']); const x = ri(R, 2, 10), y = ri(R, 2, 10); if (op === 'mul') { a = x; b = y; } else { a = x * y; b = y; } }
    if (level <= 4) {
      v.a = a; v.b = b;
      [text, unit] = pick(R, WORD[op])(v);
      const sym = { add: '+', sub: '−', mul: '×', div: '÷' }[op];
      res = op === 'add' ? a + b : op === 'sub' ? a - b : op === 'mul' ? a * b : a / b;
      expr = a + ' ' + sym + ' ' + b + ' = ' + res;
      const why = { add: 'מוסיפים — לכן חיבור', sub: 'מורידים — לכן חיסור', mul: 'קבוצות שוות — לכן כפל', div: 'מחלקים שווה בשווה — לכן חילוק' }[op];
      steps = [why + ': ' + E(a + ' ' + sym + ' ' + b), E(expr), 'התשובה: ' + res + ' ' + unit];
      return intQ('word', level, { prompt: text, answerText: res + ' ' + unit, unit, steps, data: { op, a, b } }, res);
    }
    // שני שלבים
    const t = ri(R, 0, 2);
    if (t === 0) {
      const n = ri(R, 2, 6), p = ri(R, 2, 9), total = n * p, bill = [20, 50, 100, 200].find(x => x > total);
      res = bill - total;
      return intQ('word', level, { prompt: v.boy + ' קנה ' + n + ' מחברות ב-' + p + ' ₪ כל אחת, ושילם בשטר של ' + bill + ' ₪. כמה עודף קיבל?', answerText: res + ' ₪', unit: '₪', steps: ['כמה עלו המחברות: ' + E(n + ' × ' + p + ' = ' + total), 'העודף: ' + E(bill + ' − ' + total + ' = ' + res)], data: { op: 'two', n, p, bill } }, res);
    }
    if (t === 1) {
      const c = ri(R, 2, 6), each = ri(R, 2, 6), used = ri(R, 2, 8), eggs = c * each + used;
      return intQ('word', level, { prompt: 'לאמא היו ' + eggs + ' ביצים. היא השתמשה ב-' + used + ' ביצים לעוגה, ואת השאר סידרה שווה בשווה ב-' + c + ' קופסאות. כמה ביצים בכל קופסה?', answerText: each + ' ביצים', unit: 'ביצים', steps: ['כמה נשארו: ' + E(eggs + ' − ' + used + ' = ' + (eggs - used)), 'בכל קופסה: ' + E((eggs - used) + ' ÷ ' + c + ' = ' + each)], data: { op: 'two', eggs, used, c } }, each);
    }
    const kids = ri(R, 12, 30), per = ri(R, 2, 5), extra = ri(R, 1, 5) * 10;
    res = kids * per + extra;
    return intQ('word', level, { prompt: 'בכיתה של ' + v.girl + ' יש ' + kids + ' בנות. כל אחת הביאה ' + per + ' ₪ לקופת הצדקה, והמורה הוסיפה עוד ' + extra + ' ₪. כמה כסף נאסף?', answerText: res + ' ₪', unit: '₪', steps: ['מה הביאו הבנות: ' + E(kids + ' × ' + per + ' = ' + (kids * per)), 'יחד עם המורה: ' + E((kids * per) + ' + ' + extra + ' = ' + res)], data: { op: 'two', kids, per, extra } }, res);
  }

  // ---- עיגול (חצי ומעלה — למעלה)
  function roundInt(n, unit) { return Math.floor((n + unit / 2) / unit) * unit; }
  function genRound(level, R) {
    if (level <= 4) {
      let n, unit;
      if (level <= 1) { n = ri(R, 11, 99); unit = 10; }
      else if (level === 2) { n = ri(R, 101, 999); unit = 10; }
      else if (level === 3) { n = ri(R, 101, 9999); unit = 100; }
      else { n = ri(R, 1001, 99999); unit = 1000; }
      if (n % unit === 0) n += ri(R, 1, unit - 1);
      const res = roundInt(n, unit), placeIdx = String(unit).length - 1, next = Math.floor(n / (unit / 10)) % 10;
      const name = { 10: 'לעשרת הקרובה', 100: 'למאה הקרובה', 1000: 'לאלף הקרוב' }[unit];
      return intQ('round', level, { expr: n + ' ≈ ?', prompt: 'עגלו ' + name, steps: ['מסתכלים על ספרת ה' + PLACES[placeIdx - 1] + ': ' + E(String(next)), next >= 5 ? '5 ומעלה — מעגלים למעלה: ' + E(n + ' ≈ ' + res) : 'פחות מ-5 — מעגלים למטה: ' + E(n + ' ≈ ' + res)], data: { n, unit } }, res);
    }
    // עשרוני: לשלם הקרוב או לעשירית
    const toTenth = R() < 0.5, p = toTenth ? 2 : 1;
    let a = ri(R, 11, toTenth ? 9999 : 999);
    if (a % 10 === 0) a += ri(R, 1, 9); // מספר שכבר מעוגל אינו תרגיל
    const unit = toTenth ? 10 : 10; // מעגלים ספרה אחת
    const res = roundInt(a, unit) / unit, next = a % 10;
    const resF = frac(res, toTenth ? 10 : 1);
    return mk('round', level, { expr: D(a, p) + ' ≈ ?', prompt: toTenth ? 'עגלו לעשירית הקרובה' : 'עגלו למספר השלם הקרוב', answer: resF, answerText: decStr(resF), steps: ['הספרה הבאה היא ' + E(String(next)) + (next >= 5 ? ' — מעגלים למעלה' : ' — מעגלים למטה'), E(D(a, p) + ' ≈ ' + decStr(resF))], data: { a: frac(a, Math.pow(10, p)), toTenth } });
  }

  // ---- כסף (הכול באגורות)
  function moneyQ(level, o, ag) {
    const f = frac(ag, 100);
    return mk('money', level, Object.assign({ answer: f, answerText: fmtMoney(ag), unit: '₪' }, o));
  }
  function genMoney(level, R) {
    const v = { boy: pick(R, BOYS), girl: pick(R, GIRLS) };
    if (level <= 1) {
      const coins = [10, 5, 2, 1].filter(() => R() < 0.6);
      if (!coins.length) coins.push(pick(R, [5, 2]));
      let parts = coins.map(c => ({ c, k: ri(R, 1, 3) }));
      // כיתה א' — עד 20 ₪
      const sumOf = ps => ps.reduce((s, x) => s + x.c * x.k, 0);
      while (parts.length > 1 && sumOf(parts) > 20) parts = parts.slice(1);
      if (sumOf(parts) > 20) parts = [{ c: parts[0].c, k: 1 }];
      const total = sumOf(parts);
      const desc = parts.map(x => (x.k === 1 ? 'מטבע אחד' : x.k + ' מטבעות') + ' של ' + x.c + ' ₪').reduce((acc, t, i) => i ? acc + (/^\d/.test(t) ? ' ו-' : ' ו') + t : t, '');
      return intQ('money', level, { prompt: 'בארנק של ' + v.girl + ' יש ' + desc + '. כמה שקלים יש בארנק?', answerText: total + ' ₪', unit: '₪', steps: [E(parts.map(x => x.k + ' × ' + x.c).join(' + ') + ' = ' + total) + ' ₪'], data: { parts } }, total);
    }
    if (level === 2) {
      if (R() < 0.5) {
        const sh = ri(R, 1, 20), ag = ri(R, 1, 9) * 10;
        return intQ('money', level, { prompt: 'כמה אגורות הם ' + sh + ' ₪ ו-' + ag + ' אגורות?', answerText: (sh * 100 + ag) + ' אגורות', unit: 'אגורות', steps: ['בשקל יש 100 אגורות: ' + E(sh + ' × 100 = ' + (sh * 100)), E((sh * 100) + ' + ' + ag + ' = ' + (sh * 100 + ag))], data: { sh, ag } }, sh * 100 + ag);
      }
      // כיתה ב': תשובה בשקלים שלמים (עשרוניים נלמדים מכיתה ד')
      const sh = ri(R, 2, 20), ag = sh * 100;
      return intQ('money', level, { prompt: 'כמה שקלים הם ' + ag + ' אגורות?', answerText: sh + ' ₪', unit: '₪', steps: ['בשקל יש 100 אגורות: ' + E(ag + ' ÷ 100 = ' + sh)], data: { agorot: ag } }, sh);
    }
    if (level === 3) {
      // עודף בשלמים: בשקלים שלמים או באגורות
      if (R() < 0.5) {
        const bill = pick(R, [20, 50, 100]), price = ri(R, 2, bill - 1), change = bill - price;
        const it = pick(R, ['ספר', 'משחק', 'קופסת צבעים', 'ילקוט קטן']);
        return intQ('money', level, { prompt: v.boy + ' קנה ' + it + ' ב-' + price + ' ₪ ושילם בשטר של ' + bill + ' ₪. כמה עודף קיבל?', answerText: change + ' ₪', unit: '₪', steps: ['מחסירים: ' + E(bill + ' − ' + price + ' = ' + change) + ' ₪', 'בדיקה: ' + E(price + ' + ' + change + ' = ' + bill)], data: { billSh: bill, priceSh: price } }, change);
      }
      const coin = pick(R, [1, 2, 5]), price = ri(R, 1, coin * 10 - 1) * 10, change = coin * 100 - price;
      const it = pick(R, ['מחק', 'סוכרייה', 'מדבקה', 'עפרון']);
      return intQ('money', level, { prompt: v.girl + ' קנתה ' + it + ' ב-' + price + ' אגורות ושילמה במטבע של ' + coin + ' ₪. כמה אגורות עודף קיבלה?', answerText: change + ' אגורות', unit: 'אגורות', steps: ['במטבע של ' + coin + ' ₪ יש ' + E(coin + ' × 100 = ' + (coin * 100)) + ' אגורות', 'העודף: ' + E((coin * 100) + ' − ' + price + ' = ' + change) + ' אגורות'], data: { coinSh: coin, priceAg: price } }, change);
    }
    if (level === 4) {
      const bill = pick(R, [20, 50]), price = ri(R, 10, bill * 10 - 1) * 10, change = bill * 100 - price;
      return moneyQ(level, { prompt: v.boy + ' קנה במכולת לחם ב-' + fmtMoney(price) + ' ושילם בשטר של ' + bill + ' ₪. כמה עודף קיבל?', steps: ['מחסירים: ' + E(bill + ' − ' + fmtScaled(price, 2, 2) + ' = ' + fmtScaled(change, 2, 2)) + ' ₪', 'אפשר גם באגורות: ' + E((bill * 100) + ' − ' + price + ' = ' + change) + ' אגורות'], data: { bill, price } }, change);
    }
    // [יחיד, רבים, מחיר מינימלי ומקסימלי באגורות]
    const items = [['בקבוק חלב', 'בקבוקי חלב', 590, 790], ['כיכר לחם', 'כיכרות לחם', 690, 1290], ['גביע גבינה', 'גביעי גבינה', 490, 990], ['מחברת', 'מחברות', 350, 890], ['עפרון', 'עפרונות', 150, 390], ['שקית קמח לחלות', 'שקיות קמח לחלות', 590, 1190]];
    const it = pick(R, items), k = ri(R, 2, 5), p = ri(R, it[2] / 10, it[3] / 10) * 10, total = k * p;
    if (level === 5) return moneyQ(level, { prompt: v.girl + ' קנתה ' + k + ' ' + it[1] + ' ב-' + fmtMoney(p) + ' ליחידה. כמה שילמה בסך הכול?', steps: ['באגורות: ' + E(k + ' × ' + p + ' = ' + total), E(total + ' אגורות = ' + fmtMoney(total))], data: { k, p } }, total);
    const it2 = pick(R, items.filter(x => x !== it)), p2 = ri(R, it2[2] / 10, it2[3] / 10) * 10, sum = total + p2;
    const bill = [5000, 10000, 20000].find(x => x > sum), change = bill - sum;
    return moneyQ(level, { prompt: v.boy + ' קנה ' + k + ' ' + it[1] + ' ב-' + fmtMoney(p) + ' ליחידה, ועוד ' + it2[0] + ' ב-' + fmtMoney(p2) + '. הוא שילם ' + (bill / 100) + ' ₪. כמה עודף קיבל?', steps: [E(k + ' × ' + fmtScaled(p, 2, 2) + ' = ' + fmtScaled(total, 2, 2)), 'יחד: ' + E(fmtScaled(total, 2, 2) + ' + ' + fmtScaled(p2, 2, 2) + ' = ' + fmtScaled(sum, 2, 2)), 'העודף: ' + E((bill / 100) + ' − ' + fmtScaled(sum, 2, 2) + ' = ' + fmtScaled(change, 2, 2)) + ' ₪'], data: { k, p, p2, bill } }, change);
  }

  // ================================================================ כיתות ו'–ח'
  // מספר לתצוגה: מינוס אמיתי (−), לא מקף
  function sgn(x) { return x < 0 ? '−' + (-x) : String(x); }
  // טקסט חשבוני בתוך משפט בעברית — מבודד משמאל לימין (אחרת "2 : 3" מוצג הפוך)
  function ltr(s) { return '⁦' + s + '⁩'; }

  // ---- ביטויים עם מספרים מכוונים, חזקות ושורשים: אסימונים (מספר, סוגריים, + − × ÷ ^, { root })
  const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  function sup(n) { return String(n).split('').map(c => SUP[Number(c)]).join(''); }
  function tplTokens(tpl, vals) {
    const t = [], re = /\s*(\d+|√[a-e]|[a-e]|[()+−×÷^])/gy; let m;
    while ((m = re.exec(tpl))) {
      const x = m[1];
      if (/^\d+$/.test(x)) t.push(Number(x));
      else if (x[0] === '√') t.push({ root: vals[x[1]] });
      else if (/^[a-e]$/.test(x)) t.push(vals[x]);
      else t.push(x);
    }
    return t;
  }
  function tokStr2(t) {
    let out = '';
    for (let i = 0; i < t.length; i++) {
      const x = t[i], prev = t[i - 1], sp = i && prev !== '(' ? ' ' : '';
      if (x === '(') out += sp + '(';
      else if (x === ')') out += ')';
      else if (x === '^') { out += sup(t[i + 1]); i++; }
      else if (x && typeof x === 'object') out += sp + '√' + x.root;
      else if (typeof x === 'number') out += sp + (x < 0 ? ((i === 0 || prev === '(') && t[i + 1] !== '^' ? '−' + (-x) : '(−' + (-x) + ')') : String(x));
      else out += sp + x;
    }
    return out;
  }
  // סוגריים שנשאר בהם מספר יחיד — מסירים
  function unwrap(t) {
    for (let i = 0; i + 2 < t.length; i++) if (t[i] === '(' && typeof t[i + 1] === 'number' && t[i + 2] === ')') { t = t.slice(0, i).concat([t[i + 1]], t.slice(i + 3)); i = -1; }
    return t;
  }
  // צעד אחד: סוגריים פנימיים; בתוכם שורשים, חזקות, כפל/חילוק, חיבור/חיסור. null = לא חוקי
  function evalStep2(t) {
    let s = 0, e = t.length;
    for (let i = 0; i < t.length; i++) { if (t[i] === '(') s = i + 1; else if (t[i] === ')') { e = i; break; } }
    if (e === t.length) s = 0;
    for (let i = s; i < e; i++) {
      if (t[i] && typeof t[i] === 'object') {
        const n = t[i].root, r = Math.round(Math.sqrt(n));
        if (!(n >= 0) || r * r !== n) return null;
        return unwrap(t.slice(0, i).concat([r], t.slice(i + 1)));
      }
    }
    let idx = -1;
    for (const ops of [['^'], ['×', '÷'], ['+', '−']]) {
      for (let i = s; i < e; i++) if (ops.includes(t[i])) { idx = i; break; }
      if (idx >= 0) break;
    }
    if (idx < 0) return null;
    const x = t[idx - 1], y = t[idx + 1], op = t[idx];
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    let v;
    if (op === '^') { if (y < 0 || y > 6) return null; v = Math.pow(x, y); }
    else if (op === '+') v = x + y; else if (op === '−') v = x - y; else if (op === '×') v = x * y;
    else { if (y === 0 || x % y) return null; v = x / y; }
    if (!Number.isSafeInteger(v) || Math.abs(v) > 100000) return null;
    return unwrap(t.slice(0, idx - 1).concat([v], t.slice(idx + 2)));
  }
  function evalTokens(t) {
    t = unwrap(t.slice());
    const seq = [tokStr2(t)];
    let guard = 0;
    while (t.length > 1 && guard++ < 60) { t = evalStep2(t); if (!t) return null; seq.push(tokStr2(t)); }
    if (t.length === 1 && t[0] && typeof t[0] === 'object') { t = evalStep2(t); if (!t) return null; seq.push(tokStr2(t)); }
    return typeof t[0] === 'number' ? { value: t[0], seq } : null;
  }
  // תרגיל מתבנית: letters ← ערכים (vals(R) מחזיר מפה), בדיקה עם accept(value, vals)
  function exprFromTemplates(R, templates, vals, accept) {
    for (let tries = 0; tries < 300; tries++) {
      const tpl = pick(R, templates), v = vals(tpl), r = evalTokens(tplTokens(tpl, v));
      if (r && accept(r.value, v, tpl)) return { tpl, vals: v, r, tokens: tplTokens(tpl, v) };
    }
    return null;
  }
  function seqSteps(r) { const out = []; for (let i = 1; i < r.seq.length; i++) out.push(E(r.seq[i - 1] + ' = ' + r.seq[i])); return out; }
  // ביטוי בתחביר JS (לבדיקה עצמאית בטסטים)
  function tokJs(t) { return t.map(x => x === '×' ? '*' : x === '÷' ? '/' : x === '−' ? '-' : x === '^' ? '**' : x && typeof x === 'object' ? 'Math.sqrt(' + x.root + ')' : typeof x === 'number' ? '(' + x + ')' : x).join(' '); }

  // ---- מספרים מכוונים
  const NEG_TEMPLATES = [
    null,
    ['a + b', 'a − b'],
    ['a + b', 'a − b', 'a + b + c', 'a − b + c'],
    ['a × b', 'a ÷ b'],
    ['a × b + c', 'a + b × c', 'a ÷ b − c', 'a × b − c × d'],
    ['a × (b − c)', '(a + b) × (c − d)', 'a − (b + c) × d', '(a − b) ÷ c', 'a × b ÷ (c − d)']
  ];
  const NEG_RULES = [
    null,
    'חיבור: סימנים שווים — מחברים ושומרים על הסימן; סימנים שונים — מחסירים את הקטן מהגדול (בלי הסימנים) ולוקחים את הסימן של הגדול. חיסור מספר הוא חיבור של הנגדי שלו.',
    'חיבור: סימנים שווים — מחברים ושומרים על הסימן; סימנים שונים — מחסירים את הקטן מהגדול (בלי הסימנים) ולוקחים את הסימן של הגדול. חיסור מספר הוא חיבור של הנגדי שלו.',
    'כפל וחילוק: סימנים שווים — התוצאה חיובית; סימנים שונים — התוצאה שלילית.',
    'קודם כפל וחילוק, אחר כך חיבור וחיסור — ובכל צעד שמים לב לסימנים.',
    'קודם סוגריים, אחר כך כפל וחילוק, ובסוף חיבור וחיסור — ובכל צעד שמים לב לסימנים.'
  ];
  function genNeg(level, R) {
    level = Math.max(1, Math.min(5, level));
    const lim = level <= 1 ? 10 : level === 2 ? 20 : level === 3 ? 9 : 12;
    const nz = () => { const v = ri(R, level >= 3 ? 2 : 1, lim); return R() < 0.5 ? -v : v; };
    const vals = tpl => {
      const v = {};
      for (const L of 'abcde') v[L] = nz();
      if (level === 3 && tpl === 'a ÷ b') { const b = v.b, q = R() < 0.5 ? -ri(R, 2, 9) : ri(R, 2, 9); v.a = b * q; }
      if (!Object.keys(v).some(k => tpl.includes(k) && v[k] < 0)) v.a = -Math.abs(v.a); // לפחות מספר שלילי אחד
      return v;
    };
    const got = exprFromTemplates(R, NEG_TEMPLATES[level], vals, value => Math.abs(value) <= 200);
    if (!got) return intQ('neg', level, { expr: '−3 + 5 = ?', prompt: 'כמה זה?', answerText: '2', steps: [NEG_RULES[1], E('−3 + 5 = 2')], data: { js: '(-3) + (5)' } }, 2);
    const steps = [NEG_RULES[level]];
    // חיסור של מספר שלילי — מראים את ההפיכה לחיבור
    if (got.tokens.length === 3 && got.tokens[1] === '−' && got.tokens[2] < 0) steps.push(E(tokStr2(got.tokens) + ' = ' + tokStr2([got.tokens[0], '+', -got.tokens[2]])));
    steps.push(...seqSteps(got.r));
    return intQ('neg', level, { expr: got.r.seq[0] + ' = ?', prompt: 'כמה זה?', answerText: sgn(got.r.value), steps, data: { js: tokJs(got.tokens) } }, got.r.value);
  }

  // ---- חזקות ושורשים
  const POW_TEMPLATES = [
    null,
    ['a ^ 2'],
    ['a ^ 3', 'a ^ 4', 'a ^ 5', 'a ^ 2'],
    ['a + b ^ 2', 'a × b ^ 2', 'a ^ 2 − b', '(a + b) ^ 2', 'a ^ 2 + b ^ 2'],
    ['(a + b) ^ 2 − c × d', 'a × (b − c) ^ 2', '(a − b) ^ 3 + c', 'a ^ 2 − b ^ 2 × c'],
    ['√a + b ^ 2', '√a × √b', '(√a − b) ^ 2', 'a ^ 2 − √b × c', '√a ÷ b + c ^ 2']
  ];
  function genPow(level, R) {
    level = Math.max(1, Math.min(5, level));
    const vals = tpl => {
      const v = {};
      for (const L of 'abcde') v[L] = ri(R, 1, 9);
      if (level === 1) v.a = ri(R, 2, 15);
      if (level === 2) {
        const e = /\^ (\d)/.exec(tpl)[1];
        v.a = e === '2' ? ri(R, 11, 20) : e === '3' ? ri(R, 2, 6) : ri(R, 2, 4);
        if (R() < 0.2) v.a = 10;
        if (R() < 0.25) v.a = -ri(R, 2, 4); // (−2)³
      }
      if (level >= 4 && R() < 0.3) v.c = -v.c;
      for (const L of 'ab') if (tpl.includes('√' + L)) v[L] = Math.pow(ri(R, 2, 12), 2);
      return v;
    };
    const got = exprFromTemplates(R, POW_TEMPLATES[level], vals, value => Math.abs(value) <= (level <= 2 ? 100000 : 2000));
    if (!got) return intQ('pow', level, { expr: '7² = ?', prompt: 'כמה זה?', answerText: '49', steps: ['7 בחזקת 2 — כופלים את 7 בעצמו פעמיים: ' + E('7 × 7 = 49')], data: { js: '(7) ** 2' } }, 49);
    const steps = [];
    if (level <= 2) {
      const base = got.tokens[0], e = got.tokens[2], b = base < 0 ? '(−' + (-base) + ')' : String(base);
      steps.push(b + ' בחזקת ' + e + ' — כופלים את ' + E(b) + ' בעצמו ' + e + ' פעמים: ' + E(Array(e).fill(b).join(' × ') + ' = ' + sgn(got.r.value)));
      if (base === 10) steps.push('חזקה של 10: כותבים 1 ואחריו ' + e + ' אפסים.');
      if (base < 0) steps.push('בסיס שלילי: חזקה זוגית — תוצאה חיובית, חזקה אי-זוגית — תוצאה שלילית.');
    } else {
      steps.push('סדר פעולות: קודם סוגריים, אחר כך חזקות ושורשים, אחר כך כפל וחילוק, ובסוף חיבור וחיסור.');
      if (level === 5) steps.push('שורש ריבועי: המספר שבריבוע נותן את המספר שמתחת לשורש, למשל ' + E('√49 = 7') + ' כי ' + E('7² = 49') + '.');
      steps.push(...seqSteps(got.r));
    }
    return intQ('pow', level, { expr: got.r.seq[0] + ' = ?', prompt: 'כמה זה?', answerText: sgn(got.r.value), steps, data: { js: tokJs(got.tokens) } }, got.r.value);
  }

  // ---- משוואות ממעלה ראשונה (פתרון שלם)
  function lin(a, b) { // ax + b כמחרוזת
    const ax = a === 1 ? 'x' : a === -1 ? '−x' : sgn(a) + 'x';
    return b === 0 ? ax : ax + (b < 0 ? ' − ' + (-b) : ' + ' + b);
  }
  function genEq(level, R) {
    level = Math.max(1, Math.min(5, level));
    const pos = (lo, hi) => ri(R, lo, hi);
    let x, expr, steps = [], js;
    if (level <= 1) {
      x = pos(1, 30); const a = pos(2, 30), kind = ri(R, 0, 2);
      if (kind === 0) { expr = 'x + ' + a + ' = ' + (x + a); steps.push('מחסירים ' + E(String(a)) + ' משני האגפים: ' + E('x = ' + (x + a) + ' − ' + a + ' = ' + x)); js = ['x + ' + a, String(x + a)]; }
      else if (kind === 1) { const b = x; x = b + a; expr = 'x − ' + a + ' = ' + b; steps.push('מוסיפים ' + E(String(a)) + ' לשני האגפים: ' + E('x = ' + b + ' + ' + a + ' = ' + x)); js = ['x - ' + a, String(b)]; }
      else { expr = a + ' + x = ' + (x + a); steps.push('מחסירים ' + E(String(a)) + ' משני האגפים: ' + E('x = ' + (x + a) + ' − ' + a + ' = ' + x)); js = [a + ' + x', String(x + a)]; }
    } else if (level === 2) {
      x = pos(2, 12); const a = pos(2, 9);
      if (R() < 0.6) { expr = a + 'x = ' + (a * x); steps.push(E(a + 'x') + ' פירושו ' + E(a + ' × x') + '. מחלקים את שני האגפים ב-' + E(String(a)) + ': ' + E('x = ' + (a * x) + ' ÷ ' + a + ' = ' + x)); js = [a + ' * x', String(a * x)]; }
      else { const q = x; x = a * q; expr = 'x ÷ ' + a + ' = ' + q; steps.push('כופלים את שני האגפים ב-' + E(String(a)) + ': ' + E('x = ' + q + ' × ' + a + ' = ' + x)); js = ['x / ' + a, String(q)]; }
    } else if (level === 3) {
      x = pos(1, 12); const a = pos(2, 9), b = pos(1, 20) * (R() < 0.5 ? -1 : 1), c = a * x + b;
      expr = lin(a, b) + ' = ' + sgn(c);
      steps.push((b > 0 ? 'מחסירים ' + E(String(b)) + ' משני האגפים: ' : 'מוסיפים ' + E(String(-b)) + ' לשני האגפים: ') + E(a + 'x = ' + sgn(c - b)));
      steps.push('מחלקים ב-' + E(String(a)) + ': ' + E('x = ' + sgn(c - b) + ' ÷ ' + a + ' = ' + x));
      js = [a + ' * x + (' + b + ')', String(c)];
    } else if (level === 4) {
      x = pos(1, 12) * (R() < 0.3 ? -1 : 1); const c = pos(1, 6), a = c + pos(1, 5), b = pos(-15, 15), d = (a - c) * x + b;
      expr = lin(a, b) + ' = ' + lin(c, d);
      steps.push('מעבירים את x לאגף אחד — מחסירים ' + E((c === 1 ? '' : c) + 'x') + ' משני האגפים: ' + E(lin(a - c, b) + ' = ' + sgn(d)));
      if (b) steps.push((b > 0 ? 'מחסירים ' + E(String(b)) : 'מוסיפים ' + E(String(-b))) + (b > 0 ? ' משני האגפים: ' : ' לשני האגפים: ') + E(lin(a - c, 0) + ' = ' + sgn(d - b)));
      if (a - c !== 1) steps.push('מחלקים ב-' + E(String(a - c)) + ': ' + E('x = ' + sgn(d - b) + ' ÷ ' + (a - c) + ' = ' + sgn(x)));
      js = [a + ' * x + (' + b + ')', c + ' * x + (' + d + ')'];
    } else {
      x = pos(1, 10) * (R() < 0.4 ? -1 : 1); const a = pos(2, 6), b = pos(1, 9) * (R() < 0.5 ? -1 : 1), c = a * (x + b);
      const inner = b > 0 ? 'x + ' + b : 'x − ' + (-b);
      expr = a + '(' + inner + ') = ' + sgn(c);
      steps.push('פותחים סוגריים — כופלים את ' + E(String(a)) + ' בכל איבר: ' + E(lin(a, a * b) + ' = ' + sgn(c)));
      steps.push((a * b > 0 ? 'מחסירים ' + E(String(a * b)) + ' משני האגפים: ' : 'מוסיפים ' + E(String(-a * b)) + ' לשני האגפים: ') + E(a + 'x = ' + sgn(c - a * b)));
      steps.push('מחלקים ב-' + E(String(a)) + ': ' + E('x = ' + sgn(c - a * b) + ' ÷ ' + a + ' = ' + sgn(x)));
      js = [a + ' * (x + (' + b + '))', String(c)];
    }
    steps.push('בדיקה: מציבים ' + E('x = ' + sgn(x)) + ' בשני האגפים ומקבלים אותו מספר.');
    return intQ('eq', level, { expr, prompt: 'מצאו את x', answerText: sgn(x), blank: 'x =', steps, data: { lhs: js[0], rhs: js[1] } }, x);
  }

  // ---- יחס ופרופורציה
  const RATE_ITEMS = [['מחברות', 'מחברת אחת'], ['עפרונות', 'עפרון אחד'], ['חלות', 'חלה אחת'], ['ספרים', 'ספר אחד'], ['בקבוקי מיץ', 'בקבוק מיץ אחד'], ['סידורים', 'סידור אחד']];
  function genRatio(level, R) {
    level = Math.max(1, Math.min(5, level));
    const v = { boy: pick(R, BOYS), girl: pick(R, GIRLS) };
    if (level <= 2) {
      const it = pick(R, RATE_ITEMS), k = ri(R, 2, 6), p = ri(R, 2, 15), total = k * p;
      if (level <= 1) return intQ('ratio', level, { prompt: 'המחיר של ' + k + ' ' + it[0] + ' הוא ' + total + ' ₪. מה המחיר של ' + it[1] + '?', answerText: p + ' ₪', unit: '₪', steps: ['מחיר ליחידה — מחלקים את המחיר במספר הפריטים: ' + E(total + ' ÷ ' + k + ' = ' + p) + ' ₪'], data: { kind: 'unit', k, total } }, p);
      let m = ri(R, 2, 12); if (m === k) m = k + 1;
      return intQ('ratio', level, { prompt: 'המחיר של ' + k + ' ' + it[0] + ' הוא ' + total + ' ₪. מה המחיר של ' + m + ' ' + it[0] + '?', answerText: (m * p) + ' ₪', unit: '₪', steps: ['קודם המחיר של אחד: ' + E(total + ' ÷ ' + k + ' = ' + p) + ' ₪', 'ואז של ' + m + ': ' + E(m + ' × ' + p + ' = ' + (m * p)) + ' ₪'], data: { kind: 'rate', k, total, m } }, m * p);
    }
    if (level === 3) {
      let a = ri(R, 1, 5), b = ri(R, 2, 7); if (a === b) b++;
      const g = gcd(a, b); a /= g; b /= g;
      const k = ri(R, 2, 9), total = (a + b) * k, things = pick(R, ['אגוזים', 'מדבקות', 'סוכריות', 'דפים']);
      let other = pick(R, BOYS.filter(x => x !== v.boy));
      const second = R() < 0.5;
      const res = (second ? b : a) * k;
      return intQ('ratio', level, { prompt: v.boy + ' ו' + other + ' חילקו ביניהם ' + total + ' ' + things + ' ביחס ' + ltr(a + ' : ' + b) + '. כמה ' + things + ' קיבל ' + (second ? other : v.boy) + '?', answerText: res + ' ' + things, unit: things,
        steps: ['מספר החלקים: ' + E(a + ' + ' + b + ' = ' + (a + b)), 'כל חלק: ' + E(total + ' ÷ ' + (a + b) + ' = ' + k), (second ? other : v.boy) + ' קיבל ' + ((second ? b : a) === 1 ? 'חלק אחד' : (second ? b : a) + ' חלקים') + ': ' + E((second ? b : a) + ' × ' + k + ' = ' + res)], data: { kind: 'split', a, b, total, second } }, res);
    }
    if (level === 4) {
      let a = ri(R, 2, 9), b = ri(R, 2, 12); if (a === b) b++;
      const k = ri(R, 2, 6), c = a * k, d = b * k, missRight = R() < 0.6;
      const expr = missRight ? a + ' : ' + b + ' = ' + c + ' : ?' : a + ' : ' + b + ' = ? : ' + d;
      const steps = missRight ? ['פי כמה גדל האיבר הראשון: ' + E(c + ' ÷ ' + a + ' = ' + k), 'גם השני גדל פי ' + E(String(k)) + ': ' + E(b + ' × ' + k + ' = ' + d)]
        : ['פי כמה גדל האיבר השני: ' + E(d + ' ÷ ' + b + ' = ' + k), 'גם הראשון גדל פי ' + E(String(k)) + ': ' + E(a + ' × ' + k + ' = ' + c)];
      return intQ('ratio', level, { expr, prompt: 'השלימו את הפרופורציה', steps, data: { kind: 'prop', a, b, c, d, missRight } }, missRight ? d : c);
    }
    if (R() < 0.5) {
      // יחס הפוך: יותר עובדים — פחות זמן
      let n1 = ri(R, 2, 8), t1 = ri(R, 2, 12) * 2, n2 = ri(R, 2, 12);
      for (let i = 0; i < 40 && ((n1 * t1) % n2 || n1 === n2); i++) n2 = ri(R, 2, 12);
      if ((n1 * t1) % n2 || n1 === n2) { n1 = 4; t1 = 12; n2 = 6; }
      const t2 = n1 * t1 / n2;
      return intQ('ratio', level, { prompt: n1 + ' בחורים מסדרים את הספרים בבית המדרש ב-' + t1 + ' דקות. בכמה דקות יסדרו אותם ' + n2 + ' בחורים, באותו קצב?', answerText: t2 + ' דקות', unit: 'דקות',
        steps: ['יחס הפוך: יותר בחורים — פחות זמן. כל העבודה: ' + E(n1 + ' × ' + t1 + ' = ' + (n1 * t1)) + ' דקות עבודה', 'מחלקים בין ' + n2 + ': ' + E((n1 * t1) + ' ÷ ' + n2 + ' = ' + t2) + ' דקות'], data: { kind: 'inverse', n1, t1, n2 } }, t2);
    }
    // קנה מידה: ס"מ במפה ← ק"מ במציאות
    const sc = pick(R, [[50000, 2], [100000, 1], [200000, 0.5]]);
    let cm = ri(R, 2, 15); if (sc[1] === 2 && cm % 2) cm++;
    const km = sc[0] * cm / 100000;
    return intQ('ratio', level, { prompt: 'במפה בקנה מידה ' + ltr('1 : ' + sc[0].toLocaleString('en-US')) + ' המרחק בין שתי ערים הוא ' + cm + ' ס״מ. כמה קילומטרים הם במציאות?', answerText: String(km), unit: 'ק״מ',
      steps: ['כל ס״מ במפה הוא ' + E(sc[0].toLocaleString('en-US')) + ' ס״מ במציאות', 'בקילומטר יש ' + E('100,000') + ' ס״מ, ולכן ס״מ במפה הוא ' + E(sgn(sc[0] / 100000)) + ' ק״מ', E(cm + ' × ' + (sc[0] / 100000) + ' = ' + km) + ' ק״מ'], data: { kind: 'scale', scale: sc[0], cm } }, km);
  }

  // ---- שטח, היקף ונפח
  function genGeo(level, R) {
    level = Math.max(1, Math.min(5, level));
    const cm = 'ס״מ', cm2 = 'סמ״ר', cm3 = 'סמ״ק';
    const Q = (prompt, unit, steps, data, value) => intQ('geo', level, { prompt, unit, answerText: String(value), steps, data }, value);
    if (level <= 1) {
      const a = ri(R, 3, 15), b = ri(R, 2, a - 1);
      if (R() < 0.5) return Q('מלבן שאורכו ' + a + ' ' + cm + ' ורוחבו ' + b + ' ' + cm + '. מה ההיקף שלו?', cm, ['היקף — סכום כל הצלעות: ' + E(a + ' + ' + b + ' + ' + a + ' + ' + b + ' = ' + (2 * (a + b))), 'או בקיצור: ' + E('2 × (' + a + ' + ' + b + ') = ' + (2 * (a + b)))], { kind: 'rectP', a, b }, 2 * (a + b));
      return Q('מלבן שאורכו ' + a + ' ' + cm + ' ורוחבו ' + b + ' ' + cm + '. מה השטח שלו?', cm2, ['שטח מלבן — אורך כפול רוחב: ' + E(a + ' × ' + b + ' = ' + (a * b)) + ' ' + cm2], { kind: 'rectA', a, b }, a * b);
    }
    if (level === 2) {
      let b = ri(R, 2, 16), h = ri(R, 2, 12); if ((b * h) % 2) b++;
      if (R() < 0.6) return Q('במשולש, הצלע ' + b + ' ' + cm + ' והגובה אליה ' + h + ' ' + cm + '. מה שטח המשולש?', cm2, ['שטח משולש — צלע כפול הגובה אליה, חלקי 2: ' + E(b + ' × ' + h + ' ÷ 2 = ' + (b * h / 2)) + ' ' + cm2], { kind: 'tri', b, h }, b * h / 2);
      return Q('במקבילית, הצלע ' + b + ' ' + cm + ' והגובה אליה ' + h + ' ' + cm + '. מה שטח המקבילית?', cm2, ['שטח מקבילית — צלע כפול הגובה אליה: ' + E(b + ' × ' + h + ' = ' + (b * h)) + ' ' + cm2], { kind: 'para', b, h }, b * h);
    }
    if (level === 3) {
      if (R() < 0.5) {
        let a = ri(R, 3, 14), c = ri(R, 2, a - 1), h = ri(R, 2, 10); if (((a + c) * h) % 2) h++;
        return Q('בטרפז, הבסיסים ' + a + ' ' + cm + ' ו-' + c + ' ' + cm + ', והגובה ' + h + ' ' + cm + '. מה שטח הטרפז?', cm2, ['שטח טרפז — סכום הבסיסים כפול הגובה, חלקי 2: ' + E('(' + a + ' + ' + c + ') × ' + h + ' ÷ 2 = ' + (a + c) + ' × ' + h + ' ÷ 2 = ' + ((a + c) * h / 2)) + ' ' + cm2], { kind: 'trap', a, c, h }, (a + c) * h / 2);
      }
      const a = ri(R, 3, 15), b = ri(R, 2, 12);
      return Q('שטח מלבן הוא ' + (a * b) + ' ' + cm2 + ', ואורכו ' + a + ' ' + cm + '. מה הרוחב שלו?', cm, ['אורך כפול רוחב שווה לשטח, ולכן מחלקים את השטח באורך: ' + E((a * b) + ' ÷ ' + a + ' = ' + b) + ' ' + cm], { kind: 'rectSide', area: a * b, a }, b);
    }
    if (level === 4) {
      const a = ri(R, 2, 12), b = ri(R, 2, 10), c = ri(R, 2, 9);
      if (R() < 0.6) return Q('תיבה שמידותיה ' + a + ' ' + cm + ', ' + b + ' ' + cm + ' ו-' + c + ' ' + cm + '. מה הנפח שלה?', cm3, ['נפח תיבה — אורך כפול רוחב כפול גובה: ' + E(a + ' × ' + b + ' × ' + c + ' = ' + (a * b * c)) + ' ' + cm3], { kind: 'boxV', a, b, c }, a * b * c);
      const S = 2 * (a * b + b * c + a * c);
      return Q('תיבה שמידותיה ' + a + ' ' + cm + ', ' + b + ' ' + cm + ' ו-' + c + ' ' + cm + '. מה שטח הפנים שלה (כל שש הפאות)?', cm2, ['לתיבה 3 זוגות של פאות זהות: ' + E(a + ' × ' + b + ' = ' + (a * b)) + ', ' + E(b + ' × ' + c + ' = ' + (b * c)) + ', ' + E(a + ' × ' + c + ' = ' + (a * c)), E('2 × (' + (a * b) + ' + ' + (b * c) + ' + ' + (a * c) + ') = ' + S) + ' ' + cm2], { kind: 'boxS', a, b, c }, S);
    }
    // מעגל, π = 3.14 — תשובה עשרונית מדויקת
    const r = ri(R, 2, 12), area = R() < 0.5;
    const ans = area ? frac(314 * r * r, 100) : frac(2 * 314 * r, 100);
    const txt = decStr(ans);
    return mk('geo', level, { prompt: 'מעגל שהרדיוס שלו ' + r + ' ' + cm + '. ' + (area ? 'מה השטח שלו?' : 'מה ההיקף שלו?') + ' (השתמשו ב-π = 3.14)', unit: area ? cm2 : cm, answer: ans, answerText: txt,
      steps: [area ? 'שטח מעגל — π כפול הרדיוס בריבוע: ' + E('3.14 × ' + r + '² = 3.14 × ' + (r * r) + ' = ' + txt) + ' ' + cm2 : 'היקף מעגל — 2 כפול π כפול הרדיוס: ' + E('2 × 3.14 × ' + r + ' = ' + txt) + ' ' + cm], data: { kind: area ? 'circA' : 'circP', r } });
  }

  const GENERATORS = { add: genAdd, sub: genSub, multable: genMulTable, longmul: genLongMul, div: genDiv, order: genOrder, frac: genFrac, dec: genDec, pct: genPct, word: genWord, round: genRound, money: genMoney, ratio: genRatio, geo: genGeo, neg: genNeg, pow: genPow, eq: genEq };
  const MAX_LEVEL = { add: 6, sub: 6, multable: 4, longmul: 5, div: 5, order: 5, frac: 5, dec: 5, pct: 5, word: 5, round: 5, money: 6, ratio: 5, geo: 5, neg: 5, pow: 5, eq: 5 };

  // תרגיל אחד. grade קובע את הרמה המקסימלית; opts.fact — עובדת כפל מסוימת
  function generate(topic, level, opts) {
    opts = opts || {};
    const R = safeRandom(opts.random);
    const gen = GENERATORS[topic];
    if (!gen) throw new Error('unknown topic');
    let lv = Math.trunc(Number(level)) || 1;
    if (opts.grade) lv = clampLevel(topic, opts.grade, lv) || 1;
    lv = Math.max(1, Math.min(MAX_LEVEL[topic], lv));
    const q = gen(lv, R, opts);
    q.uid = Math.floor(R() * 1e9).toString(36);
    return q;
  }
  function qKey(q) { return q.topic + '|' + (q.expr || '') + '|' + (q.prompt || ''); }
  // סדרת תרגילים בלי כפילויות (ככל האפשר)
  function generateSet(topic, level, count, opts) {
    opts = opts || {};
    const out = [], seen = new Set();
    count = Math.max(1, Math.min(60, Math.trunc(Number(count)) || 10));
    for (let i = 0; out.length < count && i < count * 20; i++) {
      const q = generate(topic, level, opts), k = qKey(q);
      if (seen.has(k) && i < count * 15) continue;
      seen.add(k); out.push(q);
    }
    return out;
  }

  // ---------------------------------------------------------------- רמה מסתגלת
  const UP_AFTER = 3, DOWN_AFTER = 2;
  function newTopicState(topic, grade) { return { level: startLevel(topic, grade) || 1, streak: 0, miss: 0, correct: 0, total: 0, best: 0 }; }
  // מחזיר מצב חדש + change: 1 / -1 / 0
  function updateAdaptive(state, correct, topic, grade) {
    const s = Object.assign({}, state);
    const max = maxLevelFor(topic, grade) || 1;
    s.total = (s.total | 0) + 1;
    let change = 0;
    if (correct) {
      s.correct = (s.correct | 0) + 1; s.streak = (s.streak | 0) + 1; s.miss = 0;
      s.best = Math.max(s.best | 0, s.streak);
      if (s.streak % UP_AFTER === 0 && s.level < max) { s.level++; change = 1; }
    } else {
      s.streak = 0; s.miss = (s.miss | 0) + 1;
      if (s.miss >= DOWN_AFTER && s.level > 1) { s.level--; s.miss = 0; change = -1; }
    }
    s.level = Math.max(1, Math.min(max, s.level | 0 || 1));
    return { state: s, change };
  }

  // ---------------------------------------------------------------- עובדות הכפל
  function factStatus(rec) {
    if (!rec || !(rec.c + rec.w)) return 'new';
    if (rec.c >= 3 && rec.last === 1 && rec.c >= rec.w * 3) return 'mastered';
    if (rec.w > rec.c || rec.last === 0) return 'weak';
    return 'learning';
  }
  function recordFact(facts, a, b, correct) {
    const out = Object.assign({}, facts), k = factKey(a, b), r = Object.assign({ c: 0, w: 0, last: 0 }, out[k]);
    if (correct) r.c++; else r.w++;
    r.last = correct ? 1 : 0; out[k] = r;
    return out;
  }
  function factSummary(facts) {
    const sum = { mastered: 0, learning: 0, weak: 0, new: 0 };
    for (let a = 1; a <= 10; a++) for (let b = a; b <= 10; b++) sum[factStatus(facts && facts[factKey(a, b)])]++;
    sum.total = 55;
    return sum;
  }
  // עובדות לתרגול: חלשות קודם, אחר כך בלמידה, אחר כך חדשות
  function pickFacts(facts, count, random) {
    const R = safeRandom(random), buckets = { weak: [], learning: [], new: [], mastered: [] };
    for (let a = 1; a <= 10; a++) for (let b = a; b <= 10; b++) buckets[factStatus(facts && facts[factKey(a, b)])].push([a, b]);
    const order = ['weak', 'learning', 'new', 'mastered'], out = [];
    for (const k of order) {
      const arr = buckets[k].slice();
      while (arr.length && out.length < count) out.push(arr.splice(Math.floor(R() * arr.length), 1)[0]);
    }
    while (out.length < count) out.push([ri(R, 1, 10), ri(R, 1, 10)]);
    return out;
  }

  // ---------------------------------------------------------------- אחסון: ניקוי נתונים לא אמינים
  function safeParse(text) { if (typeof text !== 'string') return null; try { return JSON.parse(text); } catch (_) { return null; } }
  function cleanStr(s, max) { return typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max || 40) : ''; }
  function isId(s) { return typeof s === 'string' && /^[a-z0-9]{1,24}$/i.test(s); }
  function sanitizeLearners(raw) {
    const out = { v: 1, active: null, list: [] };
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.list)) return out;
    const seen = new Set();
    for (const l of raw.list.slice(0, 50)) {
      if (!l || typeof l !== 'object' || !isId(l.id) || seen.has(l.id)) continue;
      const name = cleanStr(l.name, 30);
      if (!name) continue;
      seen.add(l.id);
      out.list.push({ id: l.id, name, grade: clampGrade(l.grade) });
    }
    out.active = out.list.some(l => l.id === raw.active) ? raw.active : (out.list[0] ? out.list[0].id : null);
    return out;
  }
  // תאריך קפדני: 2026-02-31 נדחה (השוואה חזרה למחרוזת)
  function isDay(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }
  const nat = (x, max) => { x = Math.trunc(Number(x)); return Number.isFinite(x) && x >= 0 ? Math.min(x, max || 1e9) : 0; };
  function emptyProgress() { return { v: 1, topics: {}, facts: {}, sessions: [], days: [], stars: 0, bestTimed: {} }; }
  function sanitizeProgress(raw) {
    const p = emptyProgress();
    if (!raw || typeof raw !== 'object') return p;
    if (raw.topics && typeof raw.topics === 'object') {
      for (const id of TOPIC_IDS) {
        const t = raw.topics[id];
        if (!t || typeof t !== 'object') continue;
        const total = nat(t.total), correct = Math.min(nat(t.correct), total);
        p.topics[id] = { level: Math.max(1, Math.min(MAX_LEVEL[id], nat(t.level) || 1)), streak: nat(t.streak, 1000), miss: nat(t.miss, 100), correct, total, best: nat(t.best, 100000) };
      }
    }
    if (raw.facts && typeof raw.facts === 'object') {
      for (let a = 1; a <= 10; a++) for (let b = a; b <= 10; b++) {
        const k = factKey(a, b), r = raw.facts[k];
        if (r && typeof r === 'object') p.facts[k] = { c: nat(r.c), w: nat(r.w), last: r.last === 1 ? 1 : 0 };
      }
    }
    if (Array.isArray(raw.sessions)) {
      p.sessions = raw.sessions.filter(s => s && typeof s === 'object' && isDay(s.day)).slice(-100).map(s => {
        const total = nat(s.total, 1000);
        return { day: s.day, at: nat(s.at, 9e15), mode: ['practice', 'timed', 'facts'].includes(s.mode) ? s.mode : 'practice', topic: TOPIC_IDS.includes(s.topic) ? s.topic : 'multable', total, correct: Math.min(nat(s.correct, 1000), total), stars: Math.min(3, nat(s.stars)), level: nat(s.level, 10) };
      });
    }
    if (Array.isArray(raw.days)) p.days = Array.from(new Set(raw.days.filter(isDay))).sort().slice(-400);
    p.stars = nat(raw.stars);
    if (raw.bestTimed && typeof raw.bestTimed === 'object') for (const id of TOPIC_IDS) if (raw.bestTimed[id] != null) p.bestTimed[id] = nat(raw.bestTimed[id], 1000);
    return p;
  }

  // ---------------------------------------------------------------- סשנים, כוכבים, רצף ימים ותגים
  function localDay(date) {
    const d = date instanceof Date ? date : new Date(date == null ? Date.now() : date);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function starsFor(correct, total) {
    if (!total) return 0;
    const pct = correct * 100 / total;
    return pct >= 90 ? 3 : pct >= 70 ? 2 : pct >= 50 ? 1 : 0;
  }
  function timedStars(correct) { return correct >= 20 ? 3 : correct >= 12 ? 2 : correct >= 6 ? 1 : 0; }
  // כוכבים לפי אחוז ההצלחה — רק מ-10 תרגילים (אורך תרגול רגיל). אחרת אימון של תרגיל אחד ו"סיום" היה נותן 3 כוכבים
  const MIN_STAR_TOTAL = 10;
  function addDaysStr(day, n) { const [y, m, d] = day.split('-').map(Number); return localDay(new Date(y, m - 1, d + n)); }
  // רצף ימים רצופים שמסתיים היום (או אתמול — הרצף עוד לא נשבר)
  function dayStreak(days, today) {
    const set = new Set(days || []);
    let cur = set.has(today) ? today : addDaysStr(today, -1);
    let n = 0;
    while (set.has(cur) && n < 1000) { n++; cur = addDaysStr(cur, -1); }
    return n;
  }
  function recordSession(progress, s, today) {
    // סשן בלי אף תשובה (אתגר שנעצר מיד) אינו תרגול: לא נרשם, לא מאריך רצף ולא מעניק תגים
    if (!s || !(s.total > 0)) return { progress: Object.assign({}, progress), stars: 0, skipped: true };
    const p = Object.assign({}, progress);
    const stars = s.mode === 'timed' ? timedStars(s.correct) : s.total >= MIN_STAR_TOTAL ? starsFor(s.correct, s.total) : 0;
    const entry = { day: today, at: nat(s.at || 0, 9e15), mode: s.mode, topic: s.topic, total: s.total, correct: s.correct, stars, level: s.level | 0 };
    p.sessions = (p.sessions || []).concat([entry]).slice(-100);
    p.days = Array.from(new Set((p.days || []).concat([today]))).sort().slice(-400);
    p.stars = (p.stars | 0) + stars;
    if (s.mode === 'timed') { p.bestTimed = Object.assign({}, p.bestTimed); p.bestTimed[s.topic] = Math.max(p.bestTimed[s.topic] | 0, s.correct); }
    return { progress: p, stars };
  }
  // ההוראה והתרגיל כטקסט להקראה בקול עברי (מקומי): סימנים במילים, שבר "3 חלקי 4", "?" — "כמה"
  const SAY_OPS = { '+': 'ועוד', '−': 'פחות', '-': 'פחות', '×': 'כפול', '÷': 'חלקי', '=': 'שווה', '<': 'קטן מ', '>': 'גדול מ', '%': 'אחוז', '☐': 'איזה סימן', '?': 'כמה', '/': 'חלקי' };
  // סימנים שהקול מדלג עליהם או קורא מוזר: סימני כיוון (LRI/PDI סביב יחס), בערך, שורש, חזקות, פאי, יחס "1 : 100"
  const SUPER = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
  function sayWords(t) {
    return String(t).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/(\d+)\/(\d+)/g, '$1 חלקי $2').replace(/(\d)\s*%/g, '$1 אחוז')
      .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, m => { const n = m.replace(/./g, c => SUPER[c]); return n === '2' ? ' בריבוע ' : ' בחזקת ' + n + ' '; })
      .replace(/√/g, ' שורש של ').replace(/≈/g, ' בערך ').replace(/π/g, ' פאי ')
      .replace(/(\d)\s+:\s+(?=\d)/g, '$1 ל ');
  }
  function spokenText(q) {
    if (!q || typeof q !== 'object') return '';
    const prompt = sayWords(q.prompt || '').replace(/\s+/g, ' ').trim();
    let expr = sayWords(q.expr || '');
    expr = expr.replace(/[+−×÷=<>☐?%]|(?<=\s)[-/](?=\s)/g, c => ' ' + SAY_OPS[c] + ' ').replace(/\s+/g, ' ').trim();
    if (!prompt || !expr) return prompt || expr;
    return prompt + (/[.?!:]$/.test(prompt) ? ' ' : '. ') + expr;
  }
  function totals(progress) {
    let correct = 0, total = 0;
    for (const id in progress.topics) { correct += progress.topics[id].correct; total += progress.topics[id].total; }
    return { correct, total, pct: total ? Math.round(correct * 100 / total) : 0 };
  }
  const BADGES = [
    { id: 'first', name: 'צעד ראשון', desc: 'סיימו תרגול ראשון', glyph: '1' },
    { id: 'perfect', name: 'מאה אחוז', desc: 'תרגול של 10 בלי טעות', glyph: '✓' },
    { id: 'answers100', name: 'מאה תרגילים', desc: '100 תשובות נכונות', glyph: '100' },
    { id: 'answers500', name: 'חמש מאות', desc: '500 תשובות נכונות', glyph: '500' },
    { id: 'streak10', name: 'רצף של 10', desc: '10 תשובות נכונות ברצף בנושא אחד', glyph: '10' },
    { id: 'days3', name: 'שלושה ימים', desc: 'תרגול 3 ימים ברצף', glyph: '3' },
    { id: 'days7', name: 'שבוע שלם', desc: 'תרגול 7 ימים ברצף', glyph: '7' },
    { id: 'timed20', name: 'זריז', desc: '20 נכונות באתגר הזמן', glyph: '⏱' },
    { id: 'facts25', name: 'חצי לוח', desc: '25 עובדות כפל שנשלטו', glyph: '×' },
    { id: 'factsAll', name: 'אלוף לוח הכפל', desc: 'כל עובדות הכפל נשלטו', glyph: '★' },
    { id: 'explorer', name: 'חוקר', desc: 'תרגלו 5 נושאים שונים', glyph: '5' },
    { id: 'stars50', name: 'אוסף כוכבים', desc: '50 כוכבים', glyph: '☆' }
  ];
  function earnedBadges(progress, today) {
    const p = progress, t = totals(p), got = new Set();
    const sessions = p.sessions || [];
    if (sessions.length) got.add('first');
    if (sessions.some(s => s.mode === 'practice' && s.total >= 10 && s.correct === s.total)) got.add('perfect');
    if (t.correct >= 100) got.add('answers100');
    if (t.correct >= 500) got.add('answers500');
    if (Object.values(p.topics).some(x => x.best >= 10)) got.add('streak10');
    const days = p.days || [];
    let run = 0, best = 0, prev = null;
    for (const d of days) { run = prev && addDaysStr(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
    if (best >= 3) got.add('days3');
    if (best >= 7) got.add('days7');
    if (Object.values(p.bestTimed || {}).some(v => v >= 20)) got.add('timed20');
    const fs = factSummary(p.facts);
    if (fs.mastered >= 25) got.add('facts25');
    if (fs.mastered >= 55) got.add('factsAll');
    if (Object.values(p.topics).filter(x => x.total >= 5).length >= 5) got.add('explorer');
    if ((p.stars | 0) >= 50) got.add('stars50');
    return BADGES.filter(b => got.has(b.id)).map(b => b.id);
  }

  // ---------------------------------------------------------------- טקסטים לממשק
  // תשובה להצגה: רק החלקים החשבוניים בתוך ⟦⟧ (משמאל לימין); מילים בעברית נשארות בכיוון הרגיל
  function answerMarkup(q) {
    if (!q) return '';
    let text = String(q.answerText == null ? '' : q.answerText);
    if (q.unit && text.indexOf(q.unit) < 0) text += ' ' + q.unit;
    if (q.blank) text = q.blank + ' ' + text;
    if (!/[א-ת]/.test(text)) return E(text);
    return text.replace(/[−-]?\d+(?:[.,/]\d+)*(?: \d+\/\d+)?%?/g, m => E(m));
  }
  // סיבת כשל שמירה בעברית: SecurityError מהמחסן נושא הודעה בעברית (רישיון / כניסה); מקום — QuotaExceededError
  function saveErrorText(err, what) {
    const head = what || 'השמירה נכשלה';
    const msg = err && typeof err.message === 'string' ? err.message.trim() : '';
    if (err && err.name === 'QuotaExceededError') return head + ' — אין מספיק מקום לשמירה';
    // הודעת המחסן כבר פותחת ב"השינוי לא נשמר:" — בלי כפילות אחרי שם הפעולה
    const body = msg.replace(/^השינוי לא נשמר:\s*/, '');
    if (body && /[א-ת]/.test(body)) return head + ' — ' + body.slice(0, 160);
    return head;
  }

  const API = {
    // אקראיות ושברים
    seeded, gcd, lcm, frac, reduce, isReduced, fracCompare, fracEq, fracAdd, fracSub, fracMul, fracDiv, fracStr, mixedStr, decStr, fmtScaled, fmtMoney,
    // פענוח ובדיקה
    normInput, parseNumber, parseRawFraction, parseDivRem, parseChoice, checkAnswer, answerMarkup, saveErrorText,
    // נושאים ומחוללים
    TOPICS, TOPIC_IDS, GRADES, MAX_LEVEL, topicById, gradeName, clampGrade, maxLevelFor, topicsForGrade, clampLevel, startLevel,
    generate, generateSet, evalExpr, evalTokens, roundInt, factKey,
    // רמה מסתגלת ועובדות כפל
    UP_AFTER, DOWN_AFTER, newTopicState, updateAdaptive, factStatus, recordFact, factSummary, pickFacts,
    // אחסון, התקדמות ותגים
    safeParse, sanitizeLearners, sanitizeProgress, emptyProgress, localDay, starsFor, timedStars, MIN_STAR_TOTAL, dayStreak, recordSession, totals, BADGES, earnedBadges,
    // הקראה
    spokenText
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.MathLogic = API;
})(this);
