// מנוע הכללים של „שאל את התוכנה” — דטרמיניסטי, בלי רשת ובלי מודל. פונקציה טהורה.
// התשובות מחושבות מהנתונים שהמנוע הקיים מחזיר; המנוע הזה לא נוגע במסד ולא קורא שום דבר בעצמו.
// כספים: כל החישובים באגורות שלמות (integer), וההמרה לשקלים רק בתצוגה.

// ---------- עזרי תצוגה ----------
const nis = (ag) => '₪' + (Math.round(Number(ag) || 0) / 100).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (bp) => `${(bp / 100).toFixed(1).replace(/\.0$/, '')}%`;
const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
// 'YYYY-MM-DD' או 'YYYY-MM' → 'אוקטובר 2026'. הקלט תמיד תאריך לועזי מקומי (לא UTC)
const monthLabel = (ym) => {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return String(ym || '');
  return `${MONTHS_HE[Number(m[2]) - 1] || m[2]} ${m[1]}`;
};
const addDays = (day, n) => {
  const m = String(day || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return day;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + n);
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// ---------- מנועי שימור המפתח: 'YYYY-MM' של חודש קודם/נוכחי ----------
const monthOf = (day) => String(day || '').slice(0, 7);
const prevMonth = (ym) => {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return '';
  const y = Number(m[1]), mo = Number(m[2]);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
};

// ---------- זיהוי הכוונה ----------
// כל סימן הוא רשימת ביטויים; הראשון שמתאים קובע את סוג השאלה. סדר חשוב: ספציפי לפני כללי
const INTENTS = [
  { id: 'unpaid', words: ['מי לא שילם', 'לא שילמו', 'חייבים', 'חוב לקוחות', 'יתרות פתוחות', 'חשבוניות פתוחות', 'גבייה פתוחה'] },
  { id: 'profit', words: ['רווח', 'הפסד', 'עודף', 'תוצאות'] },
  { id: 'vat', words: ['מע"מ', 'מעמ', 'מס עסקאות'] },
  { id: 'income', words: ['גביתי', 'גבייתי', 'גבייה', 'הכנסות', 'הכנסה', 'מכירות', 'מחזור', 'הכנסתי', 'הכנסתי החודש'] },
  { id: 'expense', words: ['הוצאות', 'הוצאה', 'הוצאתי', 'עלויות'] },
  { id: 'customers', words: ['לקוחות חוזרים', 'לקוח חוזר', 'לקוחות'] },
  { id: 'collect', words: ['מה להגבות', 'מה לגבות', 'מה נשאר לגבות'] },
  { id: 'howto', words: ['איך', 'היכן', 'איפה', 'איך עושים', 'איך מוציאים'] },
];

function detectIntent(question) {
  const q = String(question || '').toLowerCase();
  for (const it of INTENTS) if (it.words.some(w => q.includes(w.toLowerCase()))) return it.id;
  return 'general';
}

// „השנה שעברה”, „אשתקד”, „השנה הקודמת” / „בשנה הקודמת” / „שנה קודמת”, „שנת המס הקודמת”. נבדק לפני „השנה”:
// פעם „השנה הקודמת” נתפסה כ„השנה” והתשובה הייתה על השנה הנוכחית (בדיקה חוזרת 24.10.2026)
const LAST_YEAR_RE = /שנה שעברה|אשתקד|שנה ה?קודמת|שנת ה?מס ה?קודמת/;
// „החודש שעבר”, „החודש הקודם”, „בחודש הקודם” (ב+ה מתקצר ל„בחודש”), „חודש קודם”
const LAST_MONTH_RE = /חודש שעבר|חודש ה?קודם/;

// טווח: „החודש”, „החודש שעבר”, „השנה”, „3 חודשים”, אחרת החודש הנוכחי
function resolveRange(question, today) {
  const q = String(question || '');
  const cur = monthOf(today);
  if (LAST_YEAR_RE.test(q)) { const y = Number(String(today).slice(0, 4)) - 1; return { from: `${y}-01-01`, to: `${y}-12-31`, label: `שנת ${y}` }; }
  if (/השנה|מתחילת השנה|מתחילת שנה/.test(q)) return { from: `${String(today).slice(0, 4)}-01-01`, to: today, label: `מתחילת ${String(today).slice(0, 4)}` };
  // הגבול העליון כוללני (inRange) — היום האחרון של החודש הקודם, לא ה-1 בחודש הזה (ממצא 47)
  if (LAST_MONTH_RE.test(q)) { const p = prevMonth(cur); return { from: `${p}-01`, to: addDays(`${cur}-01`, -1), label: monthLabel(p) }; }
  // „12 חודשים” — שתי ספרות (פעם „12” נקרא כ„2”); „3 החודשים האחרונים” — עם ה הידיעה (פעם נענה רק החודש הנוכחי)
  const months = q.match(/(?<!\d)(\d{1,2})\s*ה?חודש/);
  if (months && Number(months[1]) >= 2 && Number(months[1]) <= 24) {
    let from = cur;
    for (let i = 1; i < Number(months[1]); i++) from = prevMonth(from);
    return { from: `${from}-01`, to: today, label: `${months[1]} החודשים האחרונים` };
  }
  return { from: `${cur}-01`, to: today, label: monthLabel(cur) };
}

// האם הטווח שהממשק ביקש זהה לזה שהכללים גזרו מהשאלה? רק טווח זהה מתקבל — אחרת השאלה קובעת.
// פעם „אותו חודש התחלה” הספיק, וגבול סיום של „1.11” לאוקטובר הכניס גם את ה-1 בנובמבר (הגבול כוללני, ממצא 47)
function rangeAgrees(hint, rule) {
  if (!hint || !rule) return false;
  const from = String(hint.from || ''), to = String(hint.to || '');
  const looksLikeDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!looksLikeDate(from) || !looksLikeDate(to) || from > to) return false;
  return from === String(rule.from || '') && to === String(rule.to || '');
}

// שנת התרומות שהשאלה שואלת עליה: „שנה שעברה” / „אשתקד” / „השנה הקודמת” (LAST_YEAR_RE), שנה מפורשת (עד השנה הנוכחית), אחרת השנה הנוכחית.
// מספר בצורת 20XX הוא שנה רק כשאינו סכום: לא ליד מטבע / אחוז ולא אחרי „מעל”, „יותר מ”, „בסך”.
// אחרי „בשנת” / „ב־” / „מ־” — שנה; מספר בלי הקשר — רק ב-15 השנים האחרונות. פעם „מי תרם מעל 2000 שקל?”
// נקרא כשנת 2000, והעוזר ענה „בשנת 2000 לא נרשמו תרומות” (סקירה לממצא 46)
const YEAR_MONEY_AFTER = /^\s*(?:₪|%|[ובל]?ש["״']?ח(?![א-ת])|שקל|אגור|דולר|אירו|אלף|אחוז)/;
const YEAR_MONEY_BEFORE = /(?:₪|(?:^|[^א-ת])[ובלה]?(?:מעל|מעלה|יותר\s*מ|פחות\s*מ|מתחת\s*ל|סך|סכום|לפחות))[\s\-־]*$/;
const YEAR_CONTEXT_BEFORE = /(?:^|[^א-ת])(?:[ובלמה]?שנת|[ובלמ])[\s\-־]*$/;
function donorYear(question, today) {
  const y = Number(String(today || '').slice(0, 4)) || null;
  if (!y) return null;
  const q = String(question || '');
  if (LAST_YEAR_RE.test(q)) return y - 1;
  for (const m of q.matchAll(/(?<!\d)(20\d{2})(?![\d.,]\d|\d)/g)) {
    const year = Number(m[1]);
    const before = q.slice(Math.max(0, m.index - 12), m.index), after = q.slice(m.index + 4);
    if (year > y || YEAR_MONEY_AFTER.test(after) || YEAR_MONEY_BEFORE.test(before)) continue;
    if (YEAR_CONTEXT_BEFORE.test(before) || year >= y - 15) return year;
  }
  return y;
}

// התשובה הקבועה לשאלה כללית שאין לה מקור בנתונים (ממצא 48): טקסט חופשי של המודל לא מגיע למשתמש
const OFF_TOPIC = 'אני עונה רק על שאלות על הנתונים שבתוכנה — חשבונות וחשבוניות, גבייה, עמותה ותרומות ושמאות — ועל השימוש בתוכנה. '
  + 'לדוגמה: „כמה גבייתי החודש?”, „מי לא שילם?” או „איך מוציאים חשבונית?”.';

// ---------- בוני תשובה ----------
const answer = (text, data) => ({ text, ...(data ? { data } : {}) });

// context: { today, summary, invoices, analytics, opened: { acct, npo } }
// summary   — features.periodSummary (שקלים) או null
// invoices  — רשימת חשבוניות עם status ו-balance (שקלים)
// analytics — features.invoiceAnalytics או null
// חשבונית פתוחה = status 'open' ויתרה אחרי זיכויים — כמו openAg ב-bizReports.js. תשלום לא מקטין את balance
// (הוא רק מעביר את status ל-'paid'), ולכן סינון לפי היתרה לבדה הציג חשבוניות ששולמו כ„לא שילם” (ממצא 45)
function unpaidInvoices(invoices) {
  const open = (invoices || []).filter(i => i && i.status === 'open' && Math.round(Number(i.balance || 0) * 100) > 0);
  const rows = open.map(i => ({
    number: i.number, customer: String(i.customer || '').trim() || 'לקוח ללא שם',
    date: String(i.date || ''), balanceAg: Math.round(Number(i.balance) * 100),
  })).sort((a, b) => b.balanceAg - a.balanceAg);
  const totalAg = sumAg(rows.map(r => r.balanceAg));
  return { rows, totalAg };
}
const sumAg = (list) => list.reduce((t, v) => t + (Number(v) || 0), 0);

function answerUnpaid(ctx) {
  const { rows, totalAg } = unpaidInvoices(ctx.invoices);
  if (!rows.length) return answer('כל החשבוניות שנפתחו נסגרו — אין יתרות פתוחות לגבייה. יישר כוח.');
  const top = rows.slice(0, 5).map(r => `• ${r.customer} — חשבונית ${r.number} מ-${r.date}: ${nis(r.balanceAg)}`);
  const more = rows.length > 5 ? `\nועוד ${rows.length - 5} חשבוניות ב„מסך החשבוניות”.` : '';
  return answer(`יש ${rows.length} חשבוניות פתוחות לגבייה, בסך ${nis(totalAg)}:\n${top.join('\n')}${more}`,
    { kind: 'unpaid', count: rows.length, totalAg, rows: rows.slice(0, 10) });
}

function answerRange(ctx, kind) {
  if (!ctx.summary) return answer('גישה לנתוני החשבונאות אינה כלולה בהרשאה או ברישיון של המשתמש הזה.');
  const s = ctx.summary;
  const label = ctx.range && ctx.range.label ? ctx.range.label : 'התקופה';
  const incomeAg = Math.round(Number(s.income) * 100), expensesAg = Math.round(Number(s.expenses) * 100);
  // מספר החשבוניות שהונפקו בתקופה — לפי תאריך החשבונית בתוך הטווח עצמו (כוללני), כמו הסכומים.
  // פעם נספר לפי חודשים שלמים מהניתוח החודשי, ו„החודש שעבר” כלל את כל החודש הנוכחי (ממצא 47)
  const r = ctx.range || {};
  const periodCount = (Array.isArray(ctx.invoices) && r.from && r.to)
    ? ctx.invoices.filter(i => i && i.status !== 'cancelled' && String(i.date || '') >= String(r.from) && String(i.date || '') <= String(r.to)).length
    : null;
  if (kind === 'income') {
    return answer(`ב${label} נרשמו הכנסות של ${nis(incomeAg)} (לפני מע"מ).` + (periodCount != null ? ` הונפקו ${periodCount} חשבוניות.` : ''),
      { kind, incomeAg });
  }
  if (kind === 'expense') {
    const share = incomeAg > 0 ? Math.round((Math.abs(expensesAg) / incomeAg) * 10000) : null;
    return answer(`ב${label} נרשמו הוצאות של ${nis(Math.abs(expensesAg))}.` + (share != null ? ` כלומר ${pct(share)} מההכנסות.` : ''),
      { kind, expensesAg: Math.abs(expensesAg) });
  }
  if (kind === 'vat') {
    const outAg = Math.round(Number(s.outputVat) * 100), inAg = Math.round(Number(s.inputVat) * 100), dueAg = Math.round(Number(s.vatPayable) * 100);
    const dir = dueAg >= 0 ? `לתשלום ${nis(dueAg)}` : `להחזר ${nis(-dueAg)}`;
    return answer(`דוח מע"מ ל${label}:\n• מס עסקאות (על מכירות): ${nis(outAg)}\n• מס תשומות (על הוצאות): ${nis(inAg)}\n• נטו: ${dir}.\nהסכום הסופי — לפי הדוח שמוגש; „התוכנה מחשבת, האדם מאשר”.`,
      { kind, outputVatAg: outAg, inputVatAg: inAg, payableAg: dueAg });
  }
  // רווח
  const profitAg = incomeAg - expensesAg;
  const afterVatAg = Math.round(Number(s.cashAfterVat) * 100);
  return answer(`ב${label}: הכנסות ${nis(incomeAg)}, הוצאות ${nis(Math.abs(expensesAg))}, ${profitAg >= 0 ? 'רווח' : 'הפסד'} של ${nis(Math.abs(profitAg))} (לפני מע"מ).\nלאחר תשלום המע"מ הצפוי: ${nis(afterVatAg)}.`,
    { kind: 'profit', incomeAg, expensesAg: Math.abs(expensesAg), profitAg });
}

function answerCustomers(ctx) {
  const a = ctx.analytics;
  if (!a) return answer('נתוני הניתוח של החשבוניות אינם זמינים בהרשאה של המשתמש הזה.');
  const repeat = Array.isArray(a.repeatCustomers) ? a.repeatCustomers.slice(0, 5) : [];
  if (!repeat.length) return answer(`אין עדיין לקוחות חוזרים — מתוך ${a.customers || 0} לקוחות, לכל אחד חשבונית אחת.`);
  const lines = repeat.map(c => `• ${c.customer} — ${c.count} חשבוניות, ${nis(Math.round(Number(c.total) * 100))}`);
  return answer(`יש ${repeat.length} לקוחות חוזרים מתוך ${a.customers} (${pct(Math.round(Number(a.repeatShare || 0) * 100))}):\n${lines.join('\n')}`,
    { kind: 'customers', repeat });
}

// „איך/היכן” — הוראות קצרות מתוך המדריך, בלי נתונים
const HOWTO = [
  { words: ['חשבונית', 'חשבוניות'], text: 'להפקת חשבונית: מסך „חשבוניות” ← „＋ חשבונית חדשה”. לבחירת לקוח קיים — להתחיל להקליד את שמו. לתשלום מיידי — „חשבונית מס/קבלה”.' },
  { words: ['גבייה', 'לגבות', 'תשלום מלקוח'], text: 'לגבייה: מסך „גבייה” ← לבחור את החשבונית או התרומה ← להעתיק את קישור התשלום או להדפיס דרישה. תשלומים שנקלטו מדוח חברת הסליקה מסומנים אוטומטית.' },
  { words: ['תרומה', 'קבלה', 'עמותה'], text: 'לתרומה וקבלה בעמותה: מסך „עמותה” ← „תרומה חדשה”. על הקבלה מופיע מספר הרישום לסעיף 46 ו„דווח לרשות המסים” — רק אחרי שנרשם הדיווח.' },
  { words: ['גיבוי', 'לגבות נתונים'], text: 'לגיבוי: Ctrl+Shift+B, או כפתור הגיבוי במסך הבית. הגיבוי מוצפן ומושלם רק אחרי שהתוכנה מאמתת אותו. לתמליל שחזור — Ctrl+Shift+R.' },
  { words: ['מע"מ', 'דוח מע"מ'], text: 'לדוח מע"מ: מסך „דוחות” ← לשונית מע"מ. הקובץ המפורט (PCN874) מופק מאותו מסך; בדקו את האזהרות לפני בקשת ההחזר.' },
  { words: ['משתמש', 'הרשאה', 'מנהל'], text: 'לניהול משתמשים: מסך „הגדרות” ← „משתמשים” (למנהל בלבד). תפקיד קובע מה מותר: צופה קורא בלבד, עורך כותב, רואה חשבון קורא ומייצא.' },
];
// מחזיר תשובה מלאה ({ text }) — הצורה זהה לשאר הבונים
function answerHowTo(q) {
  const s = String(q || '').toLowerCase();
  const hit = HOWTO.find(h => h.words.some(w => s.includes(w)));
  return answer(hit ? hit.text : 'אפשר לשאול אותי על חשבוניות, גבייה, תרומות וקבלות, מע"מ, גיבוי והרשאות. כתבו למשל: „איך מוציאים חשבונית?”');
}

function answerGeneral(ctx) {
  const lines = [];
  if (ctx.summary) {
    const incomeAg = Math.round(Number(ctx.summary.income) * 100);
    const { totalAg, rows } = unpaidInvoices(ctx.invoices);
    lines.push(`ב${ctx.range ? ctx.range.label : 'החודש'} נרשמו הכנסות של ${nis(incomeAg)}.`);
    if (rows.length) lines.push(`יש ${rows.length} חשבוניות פתוחות לגבייה, בסך ${nis(totalAg)}.`);
    else lines.push('אין חשבוניות פתוחות לגבייה.');
  } else {
    lines.push('אני עונה על שאלות על החשבונות, החשבוניות והגבייה. לדוגמה: „כמה גבייתי החודש?”, „מי לא שילם?”, „מה דוח המע"מ של החודש?”.');
  }
  return answer(lines.join('\n'));
}

// ---------- עמותה: סיכום תורמים לשנה ----------
// ctx.npo — { year, donors: [{ name, count, total (₪) }] } או null: התרומות של אותה שנה בלבד (yearDonors של getOverview).
// פעם נשלח סיכום של כל השנים, והוא הוצג כ„בשנת 2026” (ממצא 46)
function answerDonors(ctx) {
  const n = ctx.npo;
  if (!n || !Array.isArray(n.donors)) return answer('נתוני העמותה אינם זמינים בהרשאה או ברישיון של המשתמש הזה.');
  const year = Number(n.year) || null;
  const donorsAg = sumAg(n.donors.map(d => Math.round(Number(d.total || 0) * 100)));
  const count = n.donors.reduce((t, d) => t + (Number(d.count) || 0), 0);
  if (!count) return answer(`ב${year ? 'שנת ' + year : 'תקופה זו'} לא נרשמו תרומות.`);
  const top = [...n.donors].sort((a, b) => b.total - a.total).slice(0, 5)
    .map(d => `• ${d.name} — ${d.count} תרומות, ${nis(Math.round(Number(d.total) * 100))}`);
  return answer(`ב${year ? 'שנת ' + year : 'תקופה זו'} נרשמו ${count} תרומות מ-${n.donors.length} תורמים, בסך ${nis(donorsAg)}:\n${top.join('\n')}`,
    { kind: 'donors', year, count, donors: n.donors.length, totalAg: donorsAg });
}

// ---------- שמאות: פירוט ההערכה האחרונה ----------
// ctx.shamai — { label, valueAg, confidence, factors: [{ name, bp }], warnings: [string] } או null.
// המקור: תיק השמאות האחרון שננעל במודול השמאות (shamaiContext ב-module-context.js)
const bpLabel = (bp) => {
  const v = Number(bp) || 0;
  const s = (v / 100).toFixed(1).replace(/\.0$/, '');
  return v > 0 ? `+${s}%` : `${s}%`;
};
function answerShamai(ctx) {
  const s = ctx.shamai;
  if (!s) return answer('אין עדיין תיק שמאות סופי. הערכת השווי נלקחת מהתיק האחרון שננעל ב„תיק שמאות מקצועי” במודול השמאות — נעלו שם תיק, והשאלה תיענה ממנו.');
  const lines = [];
  lines.push(`הערכת השווי האחרונה${s.label ? ` (${s.label})` : ''}: ${nis(s.valueAg)}.`);
  if (s.confidence != null) lines.push(`רמת הביטחון: ${Number(s.confidence)} מתוך 100.`);
  const factors = (s.factors || []).filter(f => Number(f.bp));
  if (factors.length) lines.push('גורמים שהוזנו בהערכה:\n' + factors.map(f => `• ${f.name}: ${bpLabel(f.bp)}`).join('\n'));
  if (s.warnings && s.warnings.length) lines.push('לתשומת לב:\n' + s.warnings.map(w => `• ${w}`).join('\n'));
  lines.push('ההערכה מחשבת לפי השדות שהוזנו בלבד — היא אינה ייעוץ מקצועי ואינה מחליפה בדיקת שמאי.');
  return answer(lines.join('\n'), { kind: 'shamai', valueAg: s.valueAg, confidence: s.confidence });
}

// סדר תחומים: שאלה „איך…” — מדריך; אחרת התחום שהשאלה מכוונת אליו; ואם אין סימן — החשבונות
const DOMAINS = [
  { id: 'shamai', words: ['הערכת שווי', 'שווי', 'הערכת', 'שמאות', 'שמאי', 'שומה'] },
  { id: 'npo', words: ['תורם', 'תורמים', 'תרומה', 'תרומות', 'עמותה', 'קבלות לתורם'] },
];
function detectDomain(q) {
  const s = String(q || '').toLowerCase();
  for (const d of DOMAINS) if (d.words.some(w => s.includes(w.toLowerCase()))) return d.id;
  return null;
}
const domainClosed = (ctx, id) => !ctx.opened || ctx.opened[id] !== true;

// נקודת הכניסה: שאלה + הקשר ← תשובה בעברית
// כל שימוש בנתונים מותנה ב-ctx.opened: תחום סגור (לפי רישיון או הרשאה) לא נכנס להקשר בכלל
function runRules(question, context = {}) {
  const ctx = context || {};
  const today = ctx.today || '';
  const q = String(question || '').trim();
  if (!q) return answer('כתבו שאלה, למשל: „כמה גבייתי החודש?”, או „אילו תורמים תרמו השנה?”');
  const intent = detectIntent(q);
  if (intent === 'howto') return answerHowTo(q);
  const domain = detectDomain(q);
  if (domain === 'shamai') {
    if (domainClosed(ctx, 'shamai')) return answer('על השמאות אני עונה רק כשמודול השמאות פתוח ברישיון ובהרשאה של המשתמש הזה.');
    return answerShamai(ctx);
  }
  if (domain === 'npo') {
    if (domainClosed(ctx, 'npo')) return answer('על העמותה והתרומות אני עונה רק כשתחום העמותה פתוח ברישיון ובהרשאה של המשתמש הזה.');
    return answerDonors(ctx);
  }
  if (domainClosed(ctx, 'acct')) {
    return answer('על שאלות על החשבונות אני עונה רק כשמודול החשבונאות פתוח ברישיון ובהרשאה של המשתמש הזה.');
  }
  const range = resolveRange(q, today);
  const scoped = { ...ctx, range };
  switch (intent) {
    case 'unpaid': return answerUnpaid(scoped);
    case 'customers': return answerCustomers(scoped);
    case 'income': case 'expense': case 'vat': case 'profit': return answerRange(scoped, intent);
    case 'collect': return answerUnpaid(scoped);
    default: return answerGeneral(scoped);
  }
}

module.exports = { runRules, detectIntent, detectDomain, resolveRange, rangeAgrees, donorYear, monthLabel, unpaidInvoices, addDays, nis, OFF_TOPIC, INTENTS, DOMAINS };
