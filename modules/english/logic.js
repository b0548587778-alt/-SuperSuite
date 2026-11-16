// לוגיקה טהורה של מודול האנגלית (בלי DOM) — חזרה מרווחת, בדיקת תשובות, יצירת שאלות,
// סטטיסטיקה וניקוי נתונים שמורים. נבדק ב-tests/english-logic.test.js.
(function (root) {
  'use strict';

  // ---------- ימים ----------
  const DAY_MS = 86400000;
  // מספר יום מקומי (לא UTC): ימים מאז 1.1.1970 לפי השעון המקומי
  function dayIndex(date) {
    const d = date instanceof Date ? date : new Date(date == null ? Date.now() : date);
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
  }

  // ---------- אקראיות ניתנת לשחזור ----------
  function rng(seed) {
    let a = (Number(seed) >>> 0) || 0x9e3779b9;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rand) {
    const r = rand || Math.random;
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // ---------- חזרה מרווחת (קופסאות לייטנר) ----------
  // קופסה 0 = חדשה / נשכחה; כל תשובה נכונה מקדמת קופסה, שגויה מחזירה לקופסה 1.
  const INTERVALS = [0, 1, 2, 4, 8, 16, 32]; // ימים עד החזרה הבאה לפי הקופסה
  const MAX_BOX = INTERVALS.length - 1;
  const LEARNED_BOX = 3; // מילה "נלמדה" מקופסה 3 (שלוש תשובות נכונות ברצף)

  function newCard() { return { b: 0, d: 0, c: 0, w: 0, s: 0 }; }

  // מחזיר כרטיס חדש (לא משנה את המקור)
  // opts.countNew === false — סבב שאינו התור היומי (תרגול הטעויות מהבוחן): מילה שנראתה רק בבוחן
  // לא נספרת כ"חדשה היום" ולא מקטינה את מכסת המילים החדשות
  function review(card, known, today, opts) {
    const c = Object.assign(newCard(), sanitizeCard(card) || {});
    const t = Number.isFinite(today) ? today : dayIndex();
    // היום שבו המילה נלמדה לראשונה (למכסת המילים החדשות) — רק בתור היומי
    if (!c.s && !(opts && opts.countNew === false)) c.f = t;
    // חזרה שלא בזמנה (מילים קשות, תרגול הטעויות, הרצה חוזרת באותו יום): תשובה נכונה לא מקדמת קופסה
    // ולא מרחיקה את החזרה — אחרת כל הרצה של הכפתור הייתה מנפחת את המרווח בלי ריווח אמיתי
    const early = c.s > 0 && c.d > t;
    if (known) {
      if (!early) c.b = Math.min(MAX_BOX, c.b + 1);
      c.c += 1;
    } else {
      c.b = 1;
      c.w += 1;
    }
    c.s += 1;
    if (!(known && early)) c.d = t + (known ? INTERVALS[c.b] : 1);
    c.l = t;
    return c;
  }

  // תשובה בבוחן: תשובה נכונה לא מזיזה קופסה. טעות במילה שכבר נלמדה מחזירה אותה לקופסה 1 ולחזרה היום —
  // כמו "לא ידעתי" בכרטיסיות (אחרת "ידעתי" מיד אחרי הטעות היה מקדם קופסה ומאריך את המרווח)
  function quizAnswer(card, ok, today) {
    const c = Object.assign(newCard(), sanitizeCard(card) || {});
    if (!ok) {
      c.q = (c.q || 0) + 1;
      if (c.s) { c.b = Math.min(c.b, 1); c.d = Math.min(c.d, today); }
    }
    return c;
  }

  // כמה מילים חדשות כבר הוצגו היום
  function newToday(cards, today) {
    let n = 0;
    for (const k in cards) if (cards[k] && cards[k].f === today) n += 1;
    return n;
  }

  function isDue(card, today) { return !!card && card.s > 0 && card.d <= today; }

  // תור לימוד יומי: קודם מילים שהגיע זמנן (הוותיקות קודם), אחר כך מילים חדשות עד המכסה
  function dailyQueue(words, cards, today, opts) {
    const o = opts || {};
    const newLimit = Math.max(0, Number.isFinite(o.newLimit) ? o.newLimit : 10);
    const filter = o.filter || (() => true);
    const due = [], fresh = [];
    for (const w of words) {
      if (!filter(w)) continue;
      const c = cards[w.id];
      if (c && c.s > 0) { if (c.d <= today) due.push(w); }
      else fresh.push(w);
    }
    due.sort((a, b) => (cards[a.id].d - cards[b.id].d) || (cards[a.id].b - cards[b.id].b));
    fresh.sort((a, b) => a.level - b.level);
    return { due, fresh: fresh.slice(0, newLimit) };
  }

  // ---------- בדיקת תשובות ----------
  function normalize(s) {
    return String(s == null ? '' : s)
      .normalize('NFKC')
      .replace(/[‘’ʼ`´]/g, "'")
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/^[\s.,!?;:"]+|[\s.,!?;:"]+$/g, '')
      .trim();
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      const t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }

  // הבדל ברמת אות: [{t:'ok'|'miss'|'extra', ch}] — miss = אות שחסרה בתשובה, extra = אות מיותרת
  function diffChars(input, expected) {
    const a = String(input || ''), b = String(expected || '');
    const m = a.length, n = b.length;
    const L = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) {
      L[i][j] = a[i].toLowerCase() === b[j].toLowerCase() ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
    const out = [];
    let i = 0, j = 0;
    while (i < m && j < n) {
      if (a[i].toLowerCase() === b[j].toLowerCase()) { out.push({ t: 'ok', ch: b[j] }); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { out.push({ t: 'extra', ch: a[i] }); i++; }
      else { out.push({ t: 'miss', ch: b[j] }); j++; }
    }
    while (i < m) out.push({ t: 'extra', ch: a[i++] });
    while (j < n) out.push({ t: 'miss', ch: b[j++] });
    return out;
  }

  // answers: מחרוזת או מערך של תשובות נכונות. close = טעות של אות אחת (לא נחשב נכון)
  function checkAnswer(input, answers) {
    const list = (Array.isArray(answers) ? answers : [answers]).map(normalize).filter(Boolean);
    const got = normalize(input);
    if (!got) return { correct: false, close: false, empty: true, expected: list[0] || '' };
    if (list.includes(got)) return { correct: true, close: false, empty: false, expected: got };
    let best = list[0] || '', dist = Infinity;
    for (const a of list) { const d = levenshtein(got, a); if (d < dist) { dist = d; best = a; } }
    return { correct: false, close: dist === 1 && best.length > 2, empty: false, expected: best, diff: diffChars(got, best) };
  }

  // ---------- משמעויות של תרגום עברי ----------
  // "על (נושא), בערך" ← ['על', 'בערך']: פיצול לפי פסיק והסרת הסוגריים
  function meanings(he) {
    return String(he == null ? '' : he).split(/[,،]/)
      .map(x => normalize(x.replace(/\([^)]*\)/g, ' ')))
      .filter(Boolean);
  }
  function sharesMeaning(a, b) {
    const s = new Set(a);
    return b.some(x => s.has(x));
  }
  // משמעויות עם הסוגריים: "שפה (בפה)" נשארת שונה מ"שפה" — הסוגריים הם שמבדילים בין הומונימים
  function exactMeanings(he) {
    return String(he == null ? '' : he).split(/[,،]/)
      .map(x => normalize(x.replace(/\s*\(\s*/g, ' (').replace(/\s*\)/g, ')')))
      .filter(Boolean);
  }
  // תשובות נכונות בבוחן האיות: המילה עצמה, האיות החלופי שלה (alt — בריטי), וכל מילה אחרת שכל משמעויות
  // ההנחיה נמצאות בתרגום שלה כמו שהן, כולל הסוגריים (learn "ללמוד" ← גם study "ללמוד, לעיין";
  // אבל lip "שפה (בפה)" לא מקבל את language "שפה", ו-sister "אחות" לא את nurse "אחות (רפואית)").
  // לכן ההשוואה כאן מחמירה יותר מזו של המסיחים (meanings), שבהם עדיף לפסול יותר מדי
  function spellAnswers(word, pool) {
    const out = [word.en].concat(word.alt || []);
    const need = exactMeanings(word.he);
    if (!need.length) return out;
    for (const w of pool || []) {
      if (!w || w.id === word.id) continue;
      const m = new Set(exactMeanings(w.he));
      if (need.every(x => m.has(x))) out.push(w.en, ...(w.alt || []));
    }
    return [...new Set(out)];
  }

  // ---------- יצירת שאלות ----------
  // dir: 'en-he' (מציגים אנגלית, בוחרים עברית) או 'he-en'. האפשרויות שונות זו מזו ותמיד כוללות את הנכונה.
  function buildChoice(word, pool, dir, rand, count) {
    const r = rand || Math.random;
    const n = Math.max(2, count || 4);
    const key = dir === 'he-en' ? 'en' : 'he';
    const promptKey = dir === 'he-en' ? 'he' : 'en';
    const correct = word[key];
    const seen = new Set([normalize(correct)]);
    const seenPrompt = normalize(word[promptKey]);
    const own = meanings(word.he);
    // מסיחים: קודם מאותו נושא, אחר כך מאותה רמה, ואז כל השאר
    const cands = shuffle(pool.filter(w => w && w.id !== word.id), r);
    const rank = w => (w.topic === word.topic ? 0 : w.level === word.level ? 1 : 2);
    cands.sort((a, b) => rank(a) - rank(b));
    const opts = [];
    for (const w of cands) {
      if (opts.length >= n - 1) break;
      const v = normalize(w[key]);
      // לא מסיח עם אותה תשובה, לא מסיח שהשאלה שלו זהה, ולא מסיח שחולק משמעות עם המילה הנשאלת
      // (like "לחבב, לאהוב" מול love "לאהוב" — היו שתי תשובות נכונות, בשני הכיוונים)
      if (seen.has(v) || normalize(w[promptKey]) === seenPrompt || sharesMeaning(own, meanings(w.he))) continue;
      seen.add(v);
      opts.push(w[key]);
    }
    const options = shuffle(opts.concat([correct]), r);
    return { id: word.id, dir, prompt: word[promptKey], options, answer: correct, answerIndex: options.indexOf(correct) };
  }

  function tokenize(sentence) {
    return String(sentence || '').trim().split(/\s+/).filter(Boolean);
  }
  // סידור משפט: מערבב את המילים כך שהסדר שונה מהמקור (כשאפשר)
  function buildOrder(sentence, rand) {
    const r = rand || Math.random;
    const tokens = tokenize(sentence);
    let mixed = tokens.slice();
    const distinct = new Set(tokens).size > 1;
    for (let k = 0; k < 20 && distinct; k++) {
      mixed = shuffle(tokens, r);
      if (mixed.join(' ') !== tokens.join(' ')) break;
    }
    return { sentence: tokens.join(' '), tokens: mixed };
  }
  function checkOrder(tokens, sentence) {
    const norm = s => normalize(s).replace(/[.,!?]/g, '');
    return norm((tokens || []).join(' ')) === norm(sentence);
  }

  // בחירת מילים לבוחן: מעדיפים מילים שכבר נראו וקשות, ואחר כך את השאר
  function pickQuizWords(words, cards, count, rand) {
    const r = rand || Math.random;
    const scored = shuffle(words, r).map(w => {
      const c = cards[w.id];
      const weight = !c || !c.s ? 1 : 1 + c.w * 2 - Math.min(c.b, 4) * 0.3;
      return { w, k: r() * weight };
    });
    scored.sort((a, b) => b.k - a.k);
    return scored.slice(0, Math.max(0, count)).map(x => x.w);
  }

  // ---------- סטטיסטיקה ----------
  function stats(words, progress, today) {
    const cards = progress.cards || {};
    let learned = 0, seen = 0, correct = 0, wrong = 0, due = 0;
    const topics = {};
    for (const w of words) {
      const c = cards[w.id];
      const t = topics[w.topic] || (topics[w.topic] = { total: 0, score: 0, learned: 0 });
      t.total += 1;
      if (!c || !c.s) continue;
      seen += 1; correct += c.c; wrong += c.w;
      if (c.b >= LEARNED_BOX) { learned += 1; t.learned += 1; }
      if (c.d <= today) due += 1;
      t.score += c.b / MAX_BOX;
    }
    const q = progress.quiz || { c: 0, t: 0 };
    const totalAns = correct + wrong + q.t;
    const accuracy = totalAns ? Math.round(((correct + q.c) / totalAns) * 100) : 0;
    const mastery = {};
    for (const [k, t] of Object.entries(topics)) mastery[k] = { pct: t.total ? Math.round((t.score / t.total) * 100) : 0, learned: t.learned, total: t.total };
    return { learned, seen, due, accuracy, answers: totalAns, mastery, streak: streak(progress.days || {}, today), todayCount: (progress.days || {})[today] || 0 };
  }

  // רצף ימים: היום (אם כבר תורגל) או אתמול ואחורה
  function streak(days, today) {
    let d = today;
    if (!(days[d] > 0)) d -= 1;
    let n = 0;
    while (days[d] > 0) { n += 1; d -= 1; }
    return n;
  }

  // מילים קשות: לפחות 2 טעויות (כרטיסיות + בחנים) ושיעור טעות של שליש ומעלה, או שנשכחו
  function hardWords(words, cards, limit) {
    const out = [];
    for (const w of words) {
      const c = cards[w.id];
      if (!c) continue;
      const wrong = c.w + (c.q || 0);
      if (wrong < 2) continue;
      const ratio = wrong / (c.c + wrong);
      if (ratio >= 1 / 3 || (c.s && c.b <= 1)) out.push({ word: w, ratio, wrong });
    }
    out.sort((a, b) => (b.ratio - a.ratio) || (b.wrong - a.wrong));
    return out.slice(0, limit || 30);
  }

  // רישום פעילות יומית (לרצף ולמטרה היומית); שומר רק 400 ימים אחרונים
  function bumpDay(progress, today, n) {
    const days = progress.days || (progress.days = {});
    days[today] = (days[today] || 0) + (n || 1);
    const keys = Object.keys(days).map(Number).sort((a, b) => a - b);
    while (keys.length > 400) delete days[keys.shift()];
    return progress;
  }

  // ---------- ניקוי נתונים שמורים (קלט לא מהימן) ----------
  const int = (v, min, max, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d;
  };
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

  function sanitizeCard(c) {
    if (!isObj(c)) return null;
    const out = { b: int(c.b, 0, MAX_BOX, 0), d: int(c.d, 0, 1e6, 0), c: int(c.c, 0, 1e6, 0), w: int(c.w, 0, 1e6, 0), s: int(c.s, 0, 1e6, 0) };
    if (c.l != null) out.l = int(c.l, 0, 1e6, 0);
    if (c.f != null) out.f = int(c.f, 0, 1e6, 0);
    if (c.q != null) out.q = int(c.q, 0, 1e6, 0); // טעויות בבחנים
    return out;
  }

  function emptyProgress() { return { v: 1, cards: {}, days: {}, quiz: { c: 0, t: 0 }, grammar: {} }; }

  // validIds — קבוצת מזהי מילים מוכרים (מילה שהוסרה מהרשימה נזרקת)
  function sanitizeProgress(raw, validIds) {
    const p = emptyProgress();
    if (!isObj(raw)) return p;
    if (isObj(raw.cards)) {
      for (const [k, v] of Object.entries(raw.cards)) {
        if (typeof k !== 'string' || k.length > 60 || (validIds && !validIds.has(k))) continue;
        const c = sanitizeCard(v);
        if (c) p.cards[k] = c;
      }
    }
    if (isObj(raw.days)) {
      for (const [k, v] of Object.entries(raw.days)) {
        if (!/^\d{1,6}$/.test(k)) continue;
        const n = int(v, 0, 100000, 0);
        if (n > 0) p.days[k] = n;
      }
    }
    if (isObj(raw.quiz)) {
      const t = int(raw.quiz.t, 0, 1e7, 0);
      p.quiz = { t, c: Math.min(t, int(raw.quiz.c, 0, 1e7, 0)) };
    }
    if (isObj(raw.grammar)) {
      for (const [k, v] of Object.entries(raw.grammar)) {
        if (!/^[a-z-]{1,30}$/.test(k) || !isObj(v)) continue;
        const total = int(v.total, 0, 100, 0);
        p.grammar[k] = { best: Math.min(total, int(v.best, 0, 100, 0)), total };
      }
    }
    return p;
  }

  function cleanName(s) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
  }

  function sanitizeLearners(raw) {
    const out = { list: [], active: null };
    if (!isObj(raw) || !Array.isArray(raw.list)) return out;
    const ids = new Set();
    for (const l of raw.list.slice(0, 50)) {
      if (!isObj(l)) continue;
      const id = String(l.id || '');
      const name = cleanName(l.name);
      if (!/^[a-z0-9]{4,24}$/.test(id) || !name || ids.has(id)) continue;
      ids.add(id);
      out.list.push({ id, name, created: int(l.created, 0, 1e6, 0) });
    }
    out.active = ids.has(raw.active) ? raw.active : (out.list[0] ? out.list[0].id : null);
    return out;
  }

  const DEFAULT_SETTINGS = { dailyGoal: 20, newPerDay: 10, cardDir: 'en-he', levels: [1, 2, 3], topic: 'all', autoSpeak: false };
  function sanitizeSettings(raw) {
    const s = Object.assign({}, DEFAULT_SETTINGS, { levels: DEFAULT_SETTINGS.levels.slice() });
    if (!isObj(raw)) return s;
    s.dailyGoal = int(raw.dailyGoal, 5, 200, DEFAULT_SETTINGS.dailyGoal);
    s.newPerDay = int(raw.newPerDay, 0, 50, DEFAULT_SETTINGS.newPerDay);
    s.cardDir = raw.cardDir === 'he-en' ? 'he-en' : 'en-he';
    if (Array.isArray(raw.levels)) {
      const lv = [...new Set(raw.levels.map(Number).filter(n => n === 1 || n === 2 || n === 3))].sort();
      if (lv.length) s.levels = lv;
    }
    s.topic = typeof raw.topic === 'string' && /^[a-z]{1,20}$/.test(raw.topic) ? raw.topic : 'all';
    s.autoSpeak = raw.autoSpeak === true;
    return s;
  }

  // JSON.parse שלא זורק
  function parseJSON(text) {
    if (typeof text !== 'string' || !text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  function newId(rand) {
    const r = rand || Math.random;
    let s = '';
    for (let i = 0; i < 10; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(r() * 36)];
    return s;
  }

  // ---------- בדיקת נתוני המילים ----------
  function validateWords(words, topics) {
    const errs = [];
    const tIds = new Set((topics || []).map(t => t.id));
    const ids = new Set();
    for (const w of words || []) {
      const tag = w && w.en ? w.en : JSON.stringify(w);
      if (!w || typeof w.en !== 'string' || !w.en.trim()) errs.push('חסר en: ' + tag);
      else if (!/^[A-Za-z][A-Za-z' -]*$/.test(w.en)) errs.push('en לא תקין: ' + tag);
      if (!w || typeof w.he !== 'string' || !/[א-ת]/.test(w.he)) errs.push('חסר he: ' + tag);
      if (!w || !tIds.has(w.topic)) errs.push('נושא לא מוכר: ' + tag);
      if (!w || ![1, 2, 3].includes(w.level)) errs.push('רמה לא תקינה: ' + tag);
      if (w && w.ex != null && (typeof w.ex !== 'string' || !/^[A-Z][^<>]*[.?!]$/.test(w.ex))) errs.push('משפט לא תקין: ' + tag);
      if (w && w.alt != null && (!Array.isArray(w.alt) || !w.alt.every(a => typeof a === 'string' && /^[A-Za-z][A-Za-z' -]*$/.test(a)))) errs.push('איות חלופי לא תקין: ' + tag);
      if (w && w.id) { if (ids.has(w.id)) errs.push('כפילות: ' + w.id); ids.add(w.id); }
    }
    return errs;
  }

  const API = {
    DAY_MS, INTERVALS, MAX_BOX, LEARNED_BOX, DEFAULT_SETTINGS,
    dayIndex, rng, shuffle, newCard, review, quizAnswer, newToday, isDue, dailyQueue,
    normalize, levenshtein, diffChars, checkAnswer, meanings, exactMeanings, sharesMeaning, spellAnswers,
    buildChoice, tokenize, buildOrder, checkOrder, pickQuizWords,
    stats, streak, hardWords, bumpDay,
    sanitizeCard, emptyProgress, sanitizeProgress, sanitizeLearners, sanitizeSettings, cleanName, parseJSON, newId,
    validateWords
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.EnglishLogic = API;
})(this);
