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

// טווח: „החודש”, „החודש שעבר”, „השנה”, „3 חודשים”, אחרת החודש הנוכחי
function resolveRange(question, today) {
  const q = String(question || '');
  const cur = monthOf(today);
  if (/שנה שעברה|אשתקד/.test(q)) { const y = Number(String(today).slice(0, 4)) - 1; return { from: `${y}-01-01`, to: `${y}-12-31`, label: `שנת ${y}` }; }
  if (/השנה|מתחילת השנה|מתחילת שנה/.test(q)) return { from: `${String(today).slice(0, 4)}-01-01`, to: today, label: `מתחילת ${String(today).slice(0, 4)}` };
  if (/חודש שעבר|החודש הקודם/.test(q)) { const p = prevMonth(cur); return { from: `${p}-01`, to: `${cur}-01`, label: monthLabel(p) }; }
  const months = q.match(/(\d)\s*חודש/);
  if (months && Number(months[1]) >= 2 && Number(months[1]) <= 12) {
    let from = cur;
    for (let i = 1; i < Number(months[1]); i++) from = prevMonth(from);
    return { from: `${from}-01`, to: today, label: `${months[1]} החודשים האחרונים` };
  }
  return { from: `${cur}-01`, to: today, label: monthLabel(cur) };
}

// האם הטווח שהממשק ביקש סותר את זה שהכללים גזרו מהשאלה?
// אותו חודש/שנה — מסכים גם כשגבול הסיום נכתב מעט אחרת („31.10” מול „1.11”: הגבול כוללני).
// חודש שונה, שנה שונה, או „N החודשים האחרונים” — סתירה: השאלה היא הקובעת
function rangeAgrees(hint, rule) {
  if (!hint || !rule) return false;
  const from = String(hint.from || ''), to = String(hint.to || '');
  const looksLikeDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!looksLikeDate(from) || !looksLikeDate(to) || from > to) return false;
  const rFrom = String(rule.from || ''), rTo = String(rule.to || '');
  if (/החודשים האחרונים/.test(String(rule.label || ''))) {
    return from === rFrom && to === rTo;
  }
  // שנת מס שקדמה לחודש הזה („24 החודשים האחרונים” מתחיל בשנתיים אחורה): מספיק אותו חודש התחלה
  const shortFrom = /^שנת /.test(String(rule.label || '')) ? rFrom.slice(0, 4) : rFrom.slice(0, 7);
  return from.slice(0, 7) === shortFrom;
}

// ---------- בוני תשובה ----------
const answer = (text, data) => ({ text, ...(data ? { data } : {}) });

// context: { today, summary, invoices, analytics, opened: { acct, npo } }
// summary   — features.periodSummary (שקלים) או null
// invoices  — rשימת חשבוניות עם balance (שקלים)
// analytics — features.invoiceAnalytics או null
function unpaidInvoices(invoices) {
  const open = (invoices || []).filter(i => i.status !== 'cancelled' && Math.round(Number(i.balance || 0) * 100) > 0);
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
  // מספר החשבוניות שמונפקו בתקופה — מתוך הניתוח החודשי, רק אם הניתוח מוכן
  const periodCount = (ctx.analytics && Array.isArray(ctx.analytics.monthly))
    ? ctx.analytics.monthly.filter(m => String(m.month) >= String(ctx.range.from).slice(0, 7) && String(m.month) <= String(ctx.range.to).slice(0, 7))
      .reduce((t, m) => t + (Number(m.count) || 0), 0)
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

// ---------- עמותה: סיכום תורמים לתקופה ----------
// ctx.npo — getOverview(year) של npoService, או null. donors: [{ name, count, total (₪) }] — לתורמים אנונימיים השם כבר מוחלף בשרת
function answerDonors(ctx) {
  const n = ctx.npo;
  if (!n || !Array.isArray(n.donors)) return answer('נתוני העמותה אינם זמינים בהרשאה או ברישיון של המשתמש הזה.');
  const year = Number(ctx.range ? String(ctx.range.to).slice(0, 4) : 0) || null;
  const donorsAg = sumAg(n.donors.map(d => Math.round(Number(d.total || 0) * 100)));
  const count = n.donors.reduce((t, d) => t + (Number(d.count) || 0), 0);
  if (!count) return answer(`ב${year ? 'שנת ' + year : 'תקופה זו'} לא נרשמו תרומות.`);
  const top = [...n.donors].sort((a, b) => b.total - a.total).slice(0, 5)
    .map(d => `• ${d.name} — ${d.count} תרומות, ${nis(Math.round(Number(d.total) * 100))}`);
  return answer(`ב${year ? 'שנת ' + year : 'תקופה זו'} נרשמו ${count} תרומות מ-${n.donors.length} תורמים, בסך ${nis(donorsAg)}:\n${top.join('\n')}`,
    { kind: 'donors', year, count, donors: n.donors.length, totalAg: donorsAg });
}

// ---------- שמאות: פירוט ההערכה האחרונה ----------
// ctx.shamai — { label, valueAg, confidence, factors: [{ name, bp }], warnings: [string] } או null
const bpLabel = (bp) => {
  const v = Number(bp) || 0;
  const s = (v / 100).toFixed(1).replace(/\.0$/, '');
  return v > 0 ? `+${s}%` : `${s}%`;
};
function answerShamai(ctx) {
  const s = ctx.shamai;
  if (!s) return answer('אין הערכת שווי אחרונה בזיכרון. פתחו את מסך השמאות, השלימו את השדות, והשאלה תיענה שוב.');
  const lines = [];
  lines.push(`הערכת השווי האחרונה${s.label ? ` (${s.label})` : ''}: ${nis(s.valueAg)}.`);
  if (s.confidence != null) lines.push(`רמת הביטחון: ${Number(s.confidence)} מתוך 100.`);
  const factors = (s.factors || []).filter(f => Number(f.bp));
  if (factors.length) lines.push('גורמים שהוזנו בהערכה:\n' + factors.map(f => `• ${f.name}: ${bpLabel(f.bp)}`).join('\n'));
  if (s.warnings && s.warnings.length) lines.push('לתשומת לב:\n' + s.warnings.map(w => `• ${w}`).join('\n'));
  lines.push('ההערכה מחשבת לפי השדות שהוזנו בלבד — היא אינה ייעוץ מקצועי ואינה מחליפה בדיקת שמאי.');
  return answer(lines.join('\n'), { kind: 'shamai', valueAg: s.valueAg, confidence: s.confidence });
}

// ---------- אימונים: מתאמנים שדורשים תשומת לב ----------
// ctx.trainer — { alerts: [{ title, detail, tone }], clients: n } או null. דוח המצב מוכן במודול האימונים עצמו
function answerTrainer(ctx) {
  const t = ctx.trainer;
  if (!t || !Array.isArray(t.alerts)) return answer('נתוני האימונים אינם זמינים בהרשאה או ברישיון של המשתמש הזה.');
  if (!t.alerts.length) return answer(`כל ${t.clients || 'המתאמנים'} במצב תקין — אין מנוי שמסתיים, אין יתרה לתשלום ואין מתאמן שנעדר.`);
  const urgent = t.alerts.filter(a => a.tone === 'red');
  const head = urgent.length ? `${urgent.length} מתאמנים דורשים טיפול דחוף:` : `${t.alerts.length} מתאמנים דורשים תשומת לב:`;
  const lines = t.alerts.slice(0, 8).map(a => `• ${a.title} — ${a.detail}`);
  return answer(`${head}\n${lines.join('\n')}`, { kind: 'trainer', count: t.alerts.length, urgent: urgent.length });
}

// סדר תחומים: שאלה „איך…” — מדריך; אחרת התחום שהשאלה מכוונת אליו; ואם אין סימן — החשבונות
const DOMAINS = [
  { id: 'trainer', words: ['מתאמן', 'מתאמנים', 'אימון', 'אימונים', 'מנוי', 'כרטיסייה', 'סטודיו', 'נוכחות'] },
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
  if (!q) return answer('כתבו שאלה, למשל: „כמה גבייתי החודש?”, „אילו תורמים תרמו השנה?” או „איזה מתאמנים דורשים תשומת לב?”');
  const intent = detectIntent(q);
  if (intent === 'howto') return answerHowTo(q);
  const domain = detectDomain(q);
  if (domain === 'trainer') {
    if (domainClosed(ctx, 'trainer')) return answer('על האימונים אני עונה רק כשמודול האימונים פתוח ברישיון ובהרשאה של המשתמש הזה.');
    return answerTrainer(ctx);
  }
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

module.exports = { runRules, detectIntent, detectDomain, resolveRange, rangeAgrees, monthLabel, unpaidInvoices, addDays, nis, INTENTS, DOMAINS };
