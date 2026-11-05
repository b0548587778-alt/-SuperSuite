// "מה תרצה לעשות?" — הבנת בקשה בעברית פשוטה, בלי רשת ובלי מודל. פונקציה טהורה, משותפת למחשב ולאנדרואיד.
// parse(text, { today }) מחזיר אחד מאלה:
//   { kind: 'question', text }                      — שאלה: נענית בעוזר (shellCall ← ai:run, תשובות מהנתונים בלבד)
//   { kind: 'task', task, prefill, missing, unclear } — משימה מוכרת (shell/tasks.js) עם מה שזוהה; **לא נשמר כלום**:
//                                                      המעטפת מציגה לאישור, והטופס נפתח מלא — השמירה של המשתמש
//   { kind: 'choose', options, prefill }             — כמה משמעויות ("הלוואה" — חדשה או החזר?) ← "התכוונת ל...?"
//   { kind: 'screen', key }                          — מסך בלי טופס (גבייה)
//   { kind: 'unknown' }                              — לא הובן ← suggest() מציע עד 3 משימות / מסכים
// הסכום מוחזר כמחרוזת שקלים ("1500", "12.50") — ההמרה לאגורות בחשבון שלמים (tasks.amountToAg).
(function (root) {
  'use strict';
  const T = (typeof module !== 'undefined' && module.exports) ? require('./tasks') : root.SUITE_TASKS;

  // ---------- נרמול ----------
  function normalize(text) {
    return String(text == null ? '' : text)
      .replace(/[֑-ׇ]/g, (c) => (c === '־' ? '-' : '')) // ניקוד וטעמים; מקף עברי ← '-'
      .replace(/[״“”„]/g, '"').replace(/[׳‘’`]/g, "'").replace(/[–—]/g, '-')
      .replace(/[\u0000-\u001f\u007f‎‏‪-‮]/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 300);
  }
  const bare = (w) => String(w || '').replace(/["'.,!?:;()]/g, '');
  const PREFIX = 'והבלכמש';
  // המילה ואותה מילה בלי אות שימוש אחת או שתיים ("ולמשה" ← "למשה" ← "משה")
  function variants(w) {
    const b = bare(w);
    const out = [b];
    if (b.length > 3 && PREFIX.includes(b[0])) out.push(b.slice(1));
    if (b.length > 4 && PREFIX.includes(b[0]) && PREFIX.includes(b[1])) out.push(b.slice(2));
    return out;
  }

  // ---------- תאריכים ----------
  function addDays(day, n) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
    if (!m) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
    return d.toISOString().slice(0, 10); // חשבון ב-UTC על תאריך בלבד — אין כאן שעון
  }
  const pad = (v) => String(v).padStart(2, '0');
  // "היום" / "אתמול" / "שלשום" / "ב-3.11" / "3/11/2026" / "בתאריך 3.11". מספר עם נקודה בלי "ב" ובלי שנה — סכום ("12.5")
  function takeDate(s, today) {
    let date = null;
    const rel = [['שלשום', -2], ['אתמול', -1], ['היום', 0]];
    for (const [w, n] of rel) {
      const re = new RegExp(`(^|\\s)[ומ]?${w}(?=\\s|$|[.,!?])`);
      if (re.test(s)) { if (today) date = addDays(today, n); s = s.replace(re, '$1 '); }
    }
    const re = /(^|\s)(?:(?:ב|מ)?תאריך\s+|ב-?|ביום\s+)?(\d{1,2})([./])(\d{1,2})(?:\3(\d{2}|\d{4}))?(?=\s|$|[,!?])/g;
    s = s.replace(re, (all, lead, d, sep, mo, y) => {
      const prefixed = all.trim() !== `${d}${sep}${mo}${y ? sep + y : ''}`;
      if (!prefixed && !y && sep === '.') return all; // "12.5" — כנראה סכום
      if (date) return lead + ' ';
      const year = y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : Number(String(today || '').slice(0, 4));
      const iso = `${year}-${pad(mo)}-${pad(d)}`;
      if (!year || !T.isDay(iso)) return all;
      date = iso;
      return lead + ' ';
    });
    return { s, date };
  }

  // ---------- טלפון ומספר תשלומים ----------
  function takePhone(s) {
    let phone = null;
    s = s.replace(/(^|\s)(\+?972-?|0)(\d{1,2})-?(\d{3})-?(\d{4})(?=\s|$|[,.!?])/, (all, lead, cc, a, b, c) => {
      phone = (cc.startsWith('+') || cc.startsWith('972') ? '0' : cc) + a + b + c;
      return lead + ' ';
    });
    return { s, phone };
  }
  function takeInstallments(s) {
    let n = null;
    s = s.replace(/(^|\s)(?:ב-?)?(\d{1,3})\s+(?:תשלומים|תשלומי|חודשים)(?=\s|$|[,.!?])/, (all, lead, d) => {
      n = Number(d);
      return lead + ' ';
    });
    return { s, installments: n && n >= 1 && n <= 360 ? n : null };
  }

  // ---------- סכומים ----------
  const CURRENCY = '(?:₪|ש"ח|שח|ש\'ח|שקלים|שקל|ש״ח)';
  const UNITS = { 'אחד': 1, 'אחת': 1, 'שניים': 2, 'שתיים': 2, 'שני': 2, 'שתי': 2, 'שלוש': 3, 'שלושה': 3, 'שלושת': 3, 'ארבע': 4, 'ארבעה': 4, 'ארבעת': 4,
    'חמש': 5, 'חמישה': 5, 'חמשת': 5, 'שש': 6, 'שישה': 6, 'ששת': 6, 'שבע': 7, 'שבעה': 7, 'שבעת': 7, 'שמונה': 8, 'שמונת': 8,
    'תשע': 9, 'תשעה': 9, 'תשעת': 9, 'עשר': 10, 'עשרה': 10, 'עשרת': 10 };
  const TENS = { 'עשרים': 20, 'שלושים': 30, 'ארבעים': 40, 'חמישים': 50, 'שישים': 60, 'שבעים': 70, 'שמונים': 80, 'תשעים': 90 };
  const BIG = new Set(['מאה', 'מאות', 'מאתיים', 'אלף', 'אלפים', 'אלפיים']);
  // רצף מילים של מספר ("חמש מאות", "אלף וחמש מאות", "אלפיים") ← שקלים שלמים, או null
  function wordNumber(words) {
    let total = 0, cur = 0, used = 0, big = false;
    for (let i = 0; i < words.length; i++) {
      let w = bare(words[i]);
      if (i > 0 && w.length > 1 && w[0] === 'ו' && (UNITS[w.slice(1)] || TENS[w.slice(1)] || BIG.has(w.slice(1)))) w = w.slice(1);
      if (UNITS[w]) cur += UNITS[w];
      else if (TENS[w]) cur += TENS[w];
      else if (w === 'מאה') { cur += 100; big = true; }
      else if (w === 'מאתיים') { cur += 200; big = true; }
      else if (w === 'מאות' && cur >= 3 && cur <= 9) { cur *= 100; big = true; }
      else if (w === 'אלף') { total += (cur || 1) * 1000; cur = 0; big = true; }
      else if (w === 'אלפיים') { total += 2000; big = true; }
      else if (w === 'אלפים' && cur >= 3 && cur <= 10) { total += cur * 1000; cur = 0; big = true; }
      else break;
      used = i + 1;
    }
    return used ? { value: total + cur, used, big } : null;
  }
  // שקלים (שלם) + אגורות ← מחרוזת "1500" / "12.50"
  const agToStr = (ag) => (ag % 100 ? `${Math.floor(ag / 100)}.${pad(ag % 100)}` : String(ag / 100));

  function takeAmounts(s) {
    const found = [];
    // ספרות: "1,500", "12.5", "₪200", "200 ש"ח", "5 אלף"
    const re = new RegExp(`(^|\\s)(₪\\s*)?(\\d{1,3}(?:,\\d{3})+|\\d+)(?:[.,](\\d{1,2}))?(?!\\d)(\\s*אלף)?(\\s*${CURRENCY})?(?=\\s|$|[,.!?])`, 'g');
    s = s.replace(re, (all, lead, sym, int, dec, thousand, cur) => {
      let ag = Number(int.replace(/,/g, '')) * 100 + Number((dec || '').padEnd(2, '0'));
      if (thousand) ag *= 1000;
      if (ag > 0 && ag <= 100000000000) found.push({ ag, currency: !!(sym || cur) });
      return lead + ' ';
    });
    // במילים: רק עם מטבע אחריו, או מספר "גדול" (מאה / אלף) — כדי ש"שני" לא ייקרא כסכום
    const words = s.split(' ');
    const out = [];
    for (let i = 0; i < words.length; i++) {
      const n = wordNumber(words.slice(i));
      if (n && n.value > 0) {
        const next = words[i + n.used] || '';
        const cur = new RegExp(`^${CURRENCY}$`).test(next);
        if (cur || n.big) {
          found.push({ ag: n.value * 100, currency: cur });
          i += n.used - 1 + (cur ? 1 : 0);
          continue;
        }
      }
      out.push(words[i]);
    }
    s = out.join(' ');
    // מטבע שנשאר לבד ("שקל" בלי מספר)
    s = s.replace(new RegExp(`(^|\\s)${CURRENCY}(?=\\s|$)`, 'g'), '$1 ');
    const withCur = found.filter(f => f.currency);
    let amount = null, unclear = false;
    if (withCur.length === 1 || (withCur.length > 1 && withCur.every(f => f.ag === withCur[0].ag))) amount = withCur[0].ag;
    else if (!withCur.length && found.length === 1) amount = found[0].ag;
    else if (found.length) unclear = true;
    return { s, amount: amount != null ? agToStr(amount) : null, unclear };
  }

  // ---------- סוג הבקשה ----------
  const Q_START = /^ו?(?:כמה|מי|מתי|מה|מהו|מהי|מהם|איזה|איזו|אילו|האם|איך|היכן|איפה|למה|מדוע|תראה לי|תראי לי|תראו לי|הראה לי|תגיד לי|תגידי לי|ספר לי)(?=\s|$|\?)/;
  const VERBS = new Set(['תרשום', 'תרשמי', 'תרשמו', 'לרשום', 'רשום', 'רשמי', 'רשמו', 'תוסיף', 'תוסיפי', 'להוסיף', 'הוסף', 'הוסיפי',
    'תכניס', 'תכניסי', 'להכניס', 'הכנס', 'תעשה', 'תעשי', 'לעשות', 'תוציא', 'תוציאי', 'להוציא', 'הוצא', 'תפיק', 'תפיקי', 'להפיק', 'הפק',
    'תן', 'תני', 'לתת', 'תכין', 'להכין', 'צריך', 'צריכה', 'רוצה', 'נא', 'בבקשה', 'תפתח', 'תפתחי', 'לפתוח', 'פתח', 'פתחי', 'תעבור', 'עבור']);
  const TIME_WORDS = new Set(['החודש', 'השנה', 'השבוע', 'שעבר', 'האחרון', 'האחרונים', 'האחרונה', 'אשתקד']);
  // מילות מפתח: [מילה, משימה או מסך, משקל]. 'loan' — "הלוואה" (חדשה או החזר — לפי שאר המילים)
  const KEYWORDS = [
    [['תרומה', 'תרומות', 'נדבה', 'נדבות', 'צדקה', 'תרם', 'תרמה'], 'donation', 3],
    [['קבלה', 'קבלות'], 'receipt', 2],
    [['הוצאה', 'הוצאות', 'שילמתי', 'קניתי'], 'expense', 3],
    [['חשבונית', 'חשבוניות'], 'invoice', 3],
    [['הלוואה', 'הלוואות'], 'loan', 2],
    [['החזר', 'החזיר', 'החזירה', 'פירעון', 'פרעון'], 'loanPayment', 2],
    [['להלוות', 'תלווה', 'הלוויתי', 'גמח'], 'gemachLoan', 2],
    [['גיבוי', 'גבה', 'תגבה', 'גבי', 'גיבויים'], 'backup', 3],
    [['גבייה', 'גביה', 'דרישת'], 'screen:econ:collect', 3],
  ];
  const LOAN_PAY = new Set(['תשלום', 'שילם', 'שילמה', 'משלם', 'משלמת']);
  const LOAN_NEW = new Set(['חדשה', 'לתת', 'תן', 'תני', 'נותנים']);
  const DATA_WORDS = new Set(['נתונים', 'הנתונים', 'המחשב', 'הכל', 'הכול']);
  const MONEY_WORDS = new Set(['כסף', 'תשלום', 'חוב', 'חובות']);

  function score(words) {
    const sc = {};
    const add = (k, n) => { sc[k] = (sc[k] || 0) + n; };
    const has = (set) => words.some(w => variants(w).some(v => set.has(v)));
    const used = new Set();
    words.forEach((w, i) => {
      const vs = variants(w);
      for (const [list, target, n] of KEYWORDS) if (vs.some(v => list.includes(v))) { add(target, n); used.add(i); }
      if ((vs.includes('קשר') && i > 0 && ['איש', 'אנשי'].includes(bare(words[i - 1]))) || vs.includes('איש-קשר')) { add('contact', 3); used.add(i); used.add(i - 1); }
      if (vs.includes('טלפון')) { add('contact', 2); used.add(i); }
      if (vs.includes('לגבות') || vs.includes('גבות')) { add('backup', 1); add('screen:econ:collect', 1); used.add(i); }
    });
    if (sc.loan) {
      add('gemachLoan', sc.loan); add('loanPayment', sc.loan); delete sc.loan;
      if (has(LOAN_PAY)) add('loanPayment', 2);
      if (has(LOAN_NEW)) add('gemachLoan', 2);
    }
    if (sc.backup && has(DATA_WORDS)) add('backup', 3);
    if (sc['screen:econ:collect'] && has(MONEY_WORDS)) add('screen:econ:collect', 3);
    // "קבלה" לצד "תרומה" — זו קבלה על תרומה
    if (sc.donation && sc.receipt) delete sc.receipt;
    return { sc, used };
  }

  // ---------- שם ופירוט ----------
  // שמות פרטיים ותארים שמתחילים ב-מ / ל — כדי לא לקצץ אות מהשם עצמו ("מנחם", "לאה")
  const KNOWN = new Set(['משה', 'מנחם', 'מאיר', 'מרדכי', 'מיכאל', 'מנשה', 'מתתיהו', 'מלכיאל', 'מרים', 'מלכה', 'מיכל', 'מרגלית', 'משולם',
    'לאה', 'לוי', 'ליבא', 'לייבל', 'לייב', 'ליפא', 'לביא', 'למברגר', 'לנדאו', 'לוין', 'ליברמן', 'לויטן', 'מילר', 'מזרחי', 'מלמד',
    'רבקה', 'רחל', 'שרה', 'יוסף', 'יוסי', 'אברהם', 'יצחק', 'יעקב', 'דוד', 'שלמה', 'חיים', 'אליהו', 'שמואל', 'יהודה', 'אהרן', 'בנימין',
    'כהן', 'לוי', 'פרידמן', 'גולדברג', 'אשכנזי', 'פרץ', 'ביטון', 'דהן', 'אוחיון', 'שפירא', 'קליין', 'וייס', 'רוזנברג', 'ברגר',
    'משפחת', 'הרב', 'רב', 'מר', 'גב', 'חברת', 'ישיבת', 'קהילת', 'מוסדות', 'בית', 'הגאון', 'ר', 'מרת', 'מורה']);
  const STOP = new Set(['את', 'עם', 'בבקשה', 'לי', 'אני', 'אנחנו', 'רוצה', 'צריך', 'צריכה', 'בסך', 'סך', 'סכום', 'של', 'חדשה', 'חדש',
    'בעד', 'תודה', 'עכשיו', 'נא', 'כסף', 'איש', 'אנשי', 'קשר', 'מספר', 'ב', 'ל', 'מ', 'ו', 'ה', '-', 'גם', 'שוב', 'כאן', 'פה',
    'הלוואה', 'הלוואות', 'תשלום', 'החזר', 'גמח', 'מהגמח', 'בגמח', 'שילם', 'שילמה', 'משלם', 'משלמת', 'חוב', 'עוד', 'אחת', 'אחד']);
  const NOTE_START = new Set(['על', 'עבור', 'בשביל', 'לצורך', 'בגין', 'בעבור']);
  const PREP_WORDS = new Set(['מ', 'מאת', 'ל', 'של', 'אצל', 'מן', 'מאצל', 'לטובת', 'עבור-']);

  function stripPrep(w) {
    const b = bare(w);
    if (/^[מל]-/.test(b)) return b.slice(2);
    if (/^(?:מאת|לטובת)-?/.test(b) && b.length > 4) return b.replace(/^(?:מאת|לטובת)-?/, '');
    if (b.length > 2 && (b[0] === 'מ' || b[0] === 'ל')) {
      const cut = b.slice(1);
      if (KNOWN.has(cut)) return cut;
      if (KNOWN.has(b)) return b;
      if (cut.length >= 2) return cut;
    }
    return b;
  }
  const isNameWord = (w) => /[א-ת]/.test(w) && !/\d/.test(w);

  function takeNameNote(words, used, taskId) {
    const rest = words.map((w, i) => (used.has(i) || VERBS.has(bare(w)) ? null : w));
    let name = [], note = [], inNote = false, gapAfterName = false;
    for (const w of rest) {
      if (w == null) { if (name.length) gapAfterName = true; continue; }
      const b = bare(w);
      if (!b) continue;
      if (NOTE_START.has(b) && !inNote) { inNote = true; continue; }
      if (inNote) { if (!STOP.has(b)) note.push(b); continue; }
      if (STOP.has(b) || TIME_WORDS.has(b) || PREP_WORDS.has(b)) { if (name.length) gapAfterName = true; continue; }
      if (!isNameWord(b)) continue;
      if (gapAfterName || name.length >= 4) { note.push(b); continue; }
      name.push(name.length ? b : b);
    }
    // הוצאה: מילה בלי "ל" — מה שעליו ההוצאה ("הוצאה 200 חשמל"); עם "ל" — למי שולם
    if (taskId === 'expense' && name.length && !/^ל/.test(name[0]) && !note.length) { note = name; name = []; }
    if (name.length) name[0] = stripPrep(name[0]);
    // איש קשר: אין מילת יחס לפני השם
    return { name: name.join(' ').trim() || null, note: note.join(' ').trim() || null };
  }

  const NEEDS = { donation: ['name', 'amount'], receipt: ['name', 'amount'], expense: ['amount'], invoice: ['name', 'amount'],
    loanPayment: ['name', 'amount'], gemachLoan: ['name', 'amount'], contact: ['name'], backup: [] };

  function build(taskId, parts) {
    const t = T.getTask(taskId);
    const prefill = {};
    for (const k of t.fields) if (parts[k] != null && parts[k] !== '') prefill[k] = parts[k];
    // רק מה שעובר את אותו אימות של main.js
    const v = T.validateTask(taskId, prefill);
    const clean = v ? v.prefill : {};
    if (!v) for (const k of Object.keys(prefill)) { const one = T.validateTask(taskId, { [k]: prefill[k] }); if (one) clean[k] = one.prefill[k]; }
    return { prefill: clean, missing: (NEEDS[taskId] || []).filter(k => clean[k] == null) };
  }

  function parse(text, { today = '' } = {}) {
    const raw = normalize(text);
    if (!raw) return { kind: 'unknown', empty: true };
    if (!/[א-ת]/.test(raw)) return { kind: 'unknown' };
    const question = Q_START.test(raw) || /\?\s*$/.test(raw);
    let s = raw.replace(/[?!]+/g, ' ');
    const d = takeDate(s, today); s = d.s;
    const ph = takePhone(s); s = ph.s;
    const ins = takeInstallments(s); s = ins.s;
    const am = takeAmounts(s); s = am.s;
    const words = s.split(' ').filter(Boolean);
    const verb = words.some(w => VERBS.has(bare(w)));
    const { sc, used } = score(words);
    const ranked = Object.entries(sc).sort((a, b) => b[1] - a[1]);
    const best = ranked.length ? ranked[0][1] : 0;

    // שאלה ("כמה...", "מי...", סימן שאלה) — בלי פועל ציווי בראש המשפט
    if (question && !(verb && VERBS.has(bare(raw.split(' ')[0])))) return { kind: 'question', text: raw };
    // "תרומות השנה", "הכנסות החודש" — שאלה בלי מילת שאלה: אין פועל, אין סכום ויש מילת זמן
    if (!verb && !am.amount && words.some(w => TIME_WORDS.has(bare(w)))) return { kind: 'question', text: raw };
    if (!best) return { kind: 'unknown' };

    const top = ranked.filter(r => r[1] === best).map(r => r[0]);
    const firstTask = top.find(k => !k.startsWith('screen:')) || 'donation';
    const nn = takeNameNote(words, used, top.length === 1 ? top[0] : firstTask);
    const parts = { name: nn.name, note: nn.note, amount: am.amount, date: d.date, phone: ph.phone, installments: ins.installments };
    if (top.length > 1) {
      return { kind: 'choose', options: top.map(k => (k.startsWith('screen:') ? { type: 'screen', key: k.slice(7) }
        : { type: 'task', id: k, prefill: build(k, parts).prefill })) };
    }
    const target = top[0];
    if (target.startsWith('screen:')) return { kind: 'screen', key: target.slice(7) };
    // מילה אחת בלי פועל ובלי פרטים ("חשבוניות", "תרומה") — אולי רוצים רק את המסך: שואלים
    const t = T.getTask(target);
    if (!verb && !am.amount && !nn.name && !nn.note && !d.date && !ph.phone && t.key) {
      return { kind: 'choose', options: [{ type: 'task', id: target, prefill: {} }, { type: 'screen', key: t.key }] };
    }
    const b = build(target, parts);
    return { kind: 'task', task: target, prefill: b.prefill, missing: b.missing, unclear: am.unclear ? ['amount'] : [] };
  }

  // הצעות "התכוונת ל...?" — עד limit משימות / מסכים שהמילים שלהם הכי קרובות לטקסט.
  // tasks — המשימות שמותרות למשתמש (tasks.tasksFor); items — פריטי הקטלוג הפתוחים { key, name, desc }
  function suggest(text, { tasks = [], items = [], limit = 3 } = {}) {
    const words = normalize(text).replace(/[?!]/g, ' ').split(' ').filter(w => bare(w).length >= 2);
    const vs = words.flatMap(variants).filter(v => v.length >= 2);
    const hit = (hay) => vs.reduce((n, v) => n + (hay.includes(v) ? 1 : 0), 0);
    const scored = [
      ...tasks.map(t => ({ type: 'task', id: t.id, label: t.verb, score: hit([t.verb, t.label, ...(t.words || [])].join(' ').replace(/"/g, '')) * 2 })),
      ...items.map(it => ({ type: 'screen', key: it.key, label: it.name, score: hit(`${it.name} ${it.desc || ''}`.replace(/"/g, '')) })),
    ].filter(x => x.score > 0).sort((a, b) => b.score - a.score);
    const out = [];
    for (const x of scored) {
      // משימה ומסך של אותו פריט — פעם אחת
      if (out.some(o => (o.type === 'screen' && x.type === 'screen' && o.key === x.key))) continue;
      out.push(x);
      if (out.length >= limit) break;
    }
    if (out.length) return { guess: false, list: out };
    // לא נמצא כלום — המשימות הנפוצות, כדי שתמיד יהיה צעד הבא
    return { guess: true, list: tasks.slice(0, limit).map(t => ({ type: 'task', id: t.id, label: t.verb })) };
  }

  const api = { parse, suggest, normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SUITE_INTENTS = api;
})(typeof window !== 'undefined' ? window : this);
