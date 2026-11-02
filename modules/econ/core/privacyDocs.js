// מסמכים לתיקון 13 (PLAN.md 9.15) — טיוטות להדפסה, לא ייעוץ משפטי. פונקציות טהורות שמחזירות HTML.
// מסמך הגדרות מאגר (תקנה 2), טיוטת נוהל אבטחה (תקנה 4), הודעת יידוע (סעיף 11), ודוח זכות עיון לפי ת"ז (סעיף 13).
// המקורות: docs/LEGAL-REQUIREMENTS.md, סעיף 4.
const { esc } = require('./exports');
const PR = require('./privacy');
const P = require('./people');

const DISCLAIMER = 'טיוטה שהופקה בתוכנה מתוך הנתונים השמורים בה. אינה ייעוץ משפטי — יש להשלים את החלקים המסומנים ולבדוק את המסמך עם עורך דין או עם ממונה הגנת הפרטיות.';
const FILL = '<span class="fill">__________ (למילוי)</span>';

function page(title, body, today) {
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1e293b; margin: 0; font-size: 13px; line-height: 1.55; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 18px 0 6px; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0; }
  th { background: #e2e8f0; padding: 5px; text-align: right; }
  td { padding: 5px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  .muted { color: #64748b; font-size: 12px; }
  .fill { color: #b45309; }
  .note { border: 1px dashed #94a3b8; padding: 8px 10px; margin: 10px 0; font-size: 12px; }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<div class="muted">הופק ב-${esc(today)}</div>
<div class="note">${esc(DISCLAIMER)}</div>
${body}
</body>
</html>`;
}

const orgLine = (org) => `<div>שם בעל המאגר: <b>${org && org.name ? esc(org.name) : FILL}</b>${org && org.id ? ` · מספר מזהה: <span dir="ltr">${esc(org.id)}</span>` : ''}</div>
<div>כתובת: ${org && org.address ? esc(org.address) : FILL}</div>`;

const mapTable = (map) => `<table><thead><tr><th>מאגר</th><th>רשומות</th><th>סוגי המידע</th><th>רגישות</th><th>מי ניגש</th></tr></thead><tbody>
${map.rows.map(r => `<tr><td>${esc(r.area)}</td><td>${r.count == null ? '—' : Number(r.count) || 0}</td><td>${esc(r.fields)}</td><td>${esc(r.sensitivityLabel)}</td><td>${esc(r.access)}</td></tr>`).join('')
  || '<tr><td colspan="5">אין עדיין רשומות במאגרים</td></tr>'}
</tbody></table>`;

const usersLine = (map) => `מנהלים ${Number(map.users.admin) || 0} · עורכים ${Number(map.users.editor) || 0} · צופים ${Number(map.users.viewer) || 0} · רואי חשבון ${Number(map.users.accountant) || 0}`;

// ---------- מסמך הגדרות מאגר (תקנה 2)
function renderDefinitionHtml(map, level, org, today) {
  const body = `
<h2>1. בעל המאגר והאחראים</h2>
${orgLine(org)}
<div>מנהל המאגר / האחראי על אבטחת המידע: ${FILL}</div>
<div>מחזיק (מי שמעבד את המידע עבור בעל המאגר, אם יש): ${FILL}</div>
<h2>2. מטרות המאגר והשימושים במידע</h2>
<div>${FILL}</div>
<div class="muted">למשל: הנפקת קבלות לתורמים ודיווח לרשות המסים, ניהול הלוואות גמ"ח וגבייתן, חלוקת סיוע לנזקקים, תיאום מתנדבים.</div>
<h2>3. סוגי המידע במאגר</h2>
${mapTable(map)}
<h2>4. פעולות העיבוד העיקריות</h2>
<div>איסוף מהאדם עצמו (טופס / שיחה), הקלדה בתוכנה, הפקת קבלות ודוחות, ייבוא קובצי תרומות מערוצים חיצוניים (אם בשימוש), גיבוי מוצפן.</div>
<div>העברת מידע לאחרים: ${FILL}</div>
<div class="muted">למשל: דיווח תרומות לרשות המסים, מסירת דוחות לרואה החשבון. העברה אל מחוץ לישראל: ${FILL}</div>
<h2>5. היכן המידע נשמר ומי ניגש אליו</h2>
${map.storage.map(x => `<div>• ${esc(x)}</div>`).join('')}
<div>משתמשים פעילים בתוכנה: ${usersLine(map)}</div>
<h2>6. רמת האבטחה</h2>
<div>הצעת התוכנה: <b>${esc(level.label)}</b></div>
${level.reasons.map(r => `<div>• ${esc(r)}</div>`).join('')}
<div class="muted">${esc(level.note)} המקור: ${esc(level.source)}</div>
<h2>7. הסיכונים העיקריים ודרכי ההתמודדות</h2>
<table><thead><tr><th>סיכון</th><th>מה קיים בתוכנה</th><th>מה נדרש מהארגון</th></tr></thead><tbody>
<tr><td>גניבת המחשב או גישה לא מורשית אליו</td><td>${map.encrypted ? 'מסד נתונים מוצפן, כניסה בסיסמה, נעילה אחרי חוסר פעילות' : 'כניסה בסיסמה, נעילה אחרי חוסר פעילות. המסד במכשיר הזה אינו מוצפן'}</td><td>${FILL}</td></tr>
<tr><td>משתמש שרואה מידע שאינו נחוץ לו</td><td>תפקידים (צופה / עורך / מנהל / רואה חשבון), נזקק חסוי למנהל בלבד, יומן פעולות</td><td>${FILL}</td></tr>
<tr><td>אובדן נתונים</td><td>גיבוי מוצפן ידני ואוטומטי, קוד שחזור</td><td>${FILL}</td></tr>
<tr><td>קובצי ייצוא (CSV / PDF) שנשארים גלויים</td><td>—</td><td>${FILL}</td></tr>
<tr><td>מידע שנשמר יותר מהנדרש</td><td>מזעור לפי תקופת שמירה, באישור מנהל</td><td>${FILL}</td></tr>
</tbody></table>
<h2>8. תאריך עדכון המסמך</h2>
<div>${esc(today)} · יש לעדכן את המסמך כשמשתנים סוגי המידע, המטרות או מספר המורשים.</div>`;
  return page('מסמך הגדרות מאגר', body, today);
}

// ---------- טיוטת נוהל אבטחת מידע (תקנה 4)
function renderProcedureHtml(map, level, org, today) {
  const sec = (title, inApp, todo) => `<h2>${esc(title)}</h2>${inApp.map(x => `<div>• ${esc(x)}</div>`).join('')}<div>השלמה של הארגון: ${FILL}</div>${todo ? `<div class="muted">${esc(todo)}</div>` : ''}`;
  const body = `
${orgLine(org)}
<div>רמת האבטחה המוצעת: <b>${esc(level.label)}</b> · משתמשים פעילים: ${usersLine(map)}</div>
${sec('1. אבטחה פיזית וסביבתית', [map.encrypted ? 'הנתונים נשמרים במחשב המקומי בלבד, במסד מוצפן'
  : 'הנתונים נשמרים במכשיר המקומי בלבד. המסד במכשיר הזה אינו מוצפן (הצפנת המערכת אינה זמינה) — יש להצפין את הכונן או את המכשיר ולנעול אותו בסיסמה'], 'היכן עומד המחשב, מי נכנס לחדר, נעילת המחשב ביציאה.')}
${sec('2. הרשאות גישה', ['כל משתמש נכנס בשם משתמש וסיסמה משלו (לפחות 12 תווים)', 'תפקידים: צופה, עורך, מנהל, רואה חשבון — לפי הצורך בלבד', 'נזקק חסוי מוצג למנהל בלבד, וכל צפייה בו נרשמת'], 'מי מאשר משתמש חדש, ומתי מבטלים משתמש של מי שסיים לעבוד.')}
${sec('3. ניהול סיסמאות וזיהוי', ['נעילה אחרי חוסר פעילות (ברירת מחדל: 15 דקות)', 'אפשרות כניסה עם Google בנוסף לסיסמה'], 'איסור על מסירת סיסמה לאחר, והחלפת סיסמה אחרי חשד לדליפה.')}
${sec('4. תיעוד ובקרה', ['יומן פעולות במסך ההגדרות: מי עשה מה ומתי'], 'מי בודק את היומן ובאיזו תדירות.')}
${sec('5. גיבוי ושחזור', ['גיבוי מוצפן (‎.ssbk) ידני ואוטומטי', 'קוד שחזור למפתח הגיבוי'], 'היכן נשמר עותק הגיבוי מחוץ למחשב, ובדיקת שחזור תקופתית.')}
${sec('6. קובצי ייצוא והתקנים ניידים', ['קובצי CSV / PDF נשמרים במקום שהמשתמש בוחר — ללא הצפנה'], 'איסור על שמירה בדיסק נייד לא מוצפן, ומחיקת קבצים אחרי השימוש.')}
${sec('7. צמצום מידע ותקופות שמירה', Object.values(PR.RETENTION_KINDS).map(k => `${k.label}: מזעור אחרי תקופה שהמנהל קובע (לפחות ${k.minYears} שנים)`), 'מה תקופת השמירה שנקבעה לכל סוג, ומי מבצע את הבדיקה פעם בשנה.')}
${sec('8. אירוע אבטחה', PR.INCIDENT_CHECKLIST, level.reportBreach ? 'ברמה בינונית או גבוהה — אירוע חמור מדווח לרשות להגנת הפרטיות מיד.' : '')}
${sec('9. הדרכת מורשי הגישה', [], 'הדרכה לכל משתמש חדש ורענון פעם בשנה (מי מדריך, ותיעוד ההדרכה).')}
<h2>10. אישור הנוהל</h2>
<div>אושר על ידי: ${FILL} · תאריך: ${FILL}</div>`;
  return page('טיוטת נוהל אבטחת מידע', body, today);
}

// ---------- הודעת יידוע (סעיף 11) להדפסה בטופסי איסוף
const NOTICE_KINDS = {
  donor: { label: 'תורם', purpose: 'הנפקת קבלה על התרומה, דיווח לרשות המסים כנדרש בחוק, ותיעוד התרומות של העמותה',
    legal: 'מסירת שם ומספר זהות נדרשת לצורך הקבלה לפי סעיף 46 לפקודת מס הכנסה ולדיווח לרשות המסים. בלי מספר זהות התרומה תדווח בעילום שם, ולא ניתן יהיה לקבל זיכוי ממס בגינה. מסירת טלפון וכתובת — לפי רצונך.',
    transfer: 'רשות המסים (דיווח תרומות), ורואה החשבון של העמותה' },
  borrower: { label: 'לווה או ערב בגמ"ח', purpose: 'בדיקת הבקשה, מתן ההלוואה, מעקב אחר ההחזרים ופנייה לערבים במקרה של פיגור',
    legal: 'אין חובה חוקית למסור את המידע. בלי הפרטים המבוקשים לא ניתן לאשר את ההלוואה.',
    transfer: 'הערבים להלוואה (במקרה של פיגור בלבד)' },
  beneficiary: { label: 'משפחה נתמכת', purpose: 'קביעת זכאות לסיוע, תיאום החלוקה ומסירת הסיוע',
    legal: 'אין חובה חוקית למסור את המידע. בלי הפרטים המבוקשים ייתכן שלא נוכל לכלול את המשפחה בחלוקה.',
    transfer: 'המתנדבים שמוסרים את הסיוע — שם וכתובת למסירה בלבד' },
  volunteer: { label: 'מתנדב', purpose: 'תיאום ההתנדבות ופנייה אליך לגבי משימות',
    legal: 'אין חובה חוקית למסור את המידע. בלי טלפון לא נוכל לתאם איתך משימות.', transfer: 'רכזי ההתנדבות בארגון בלבד' },
  client: { label: 'לקוח', purpose: 'מתן השירות, הנפקת חשבוניות וניהול החשבון מול הלקוח',
    legal: 'פרטים הנדרשים לחשבונית מס נמסרים לפי חוק. בלי שאר הפרטים ייתכן שלא נוכל לתת את השירות.',
    transfer: 'רואה החשבון של העסק ורשות המסים, כנדרש בחוק' }
};

function noticeText(kind, org) {
  const k = NOTICE_KINDS[kind];
  if (!k) throw new Error('סוג טופס לא מוכר');
  const name = (org && org.name) || '__________';
  return [
    `המידע שתמסור/י בטופס זה יישמר במאגר מידע של ${name}${org && org.address ? `, ${org.address}` : ''}.`,
    `מטרת איסוף המידע: ${k.purpose}.`,
    k.legal,
    `המידע עשוי להימסר ל: ${k.transfer}. הוא לא יימסר לגורם אחר אלא לפי דין או בהסכמתך.`,
    'לפי חוק הגנת הפרטיות, התשמ"א-1981, זכותך לעיין במידע עליך השמור במאגר (סעיף 13), ולבקש לתקן או למחוק מידע שאינו נכון, שלם, ברור או מעודכן (סעיף 14). פנייה בעניין זה — אל: __________.'
  ];
}

function renderNoticeHtml(kind, org, today) {
  const lines = noticeText(kind, org);
  const body = `<div class="muted">להדפסה בטופס איסוף פרטים של ${esc(NOTICE_KINDS[kind].label)}. הנוסח הוא הצעה — יש להתאים אותו לשימוש בפועל.</div>
<h2>הודעה לפי סעיף 11 לחוק הגנת הפרטיות</h2>
${lines.map(l => `<p>${esc(l)}</p>`).join('')}`;
  return page(`הודעת יידוע — ${NOTICE_KINDS[kind].label}`, body, today);
}

// ---------- זכות עיון: כל המידע על אדם לפי ת"ז, מכל התחומים שפתוחים ברישיון
// תוויות לשדות. שדה בלי תווית מוצג בשמו הפנימי — עדיף מלהשמיט מידע מבקשת עיון
const LABELS = {
  donorName: 'שם', donorId: 'ת.ז', donorPhone: 'טלפון', donorAddress: 'כתובת', donorType: 'סוג תורם', date: 'תאריך', amount: 'סכום',
  purpose: 'ייעוד', reference: 'אסמכתה', method: 'אמצעי תשלום', paymentMethod: 'אמצעי תשלום', status: 'מצב', notes: 'הערות', fund: 'קרן',
  receipt: 'קבלה', number: 'מספר', startMonth: 'חודש התחלה', endMonth: 'חודש סיום', dayOfMonth: 'יום בחודש', name: 'שם', contactName: 'איש קשר',
  contactId: 'ת.ז איש הקשר', contactPhone: 'טלפון איש הקשר', relation: 'קרבה', borrowerName: 'שם הלווה', borrowerId: 'ת.ז הלווה',
  borrowerPhone: 'טלפון', borrowerAddress: 'כתובת', installments: 'מספר תשלומים', issueDate: 'תאריך הלוואה', guarantors: 'ערבים',
  schedule: 'לוח תשלומים', requestDate: 'תאריך בקשה', interviewNotes: 'סיכום ראיון', dueDate: 'תאריך החזרה', returnedAt: 'הוחזר',
  deposit: 'פיקדון', familyName: 'שם משפחה', headName: 'ראש המשפחה', idNumber: 'ת.ז', phone: 'טלפון', address: 'כתובת', familySize: 'נפשות',
  area: 'אזור', tier: 'רמת חיסיון', active: 'פעיל', customer: 'לקוח', customerTaxId: 'ע.מ / ח.פ', net: 'לפני מע"מ', vat: 'מע"מ', total: 'סה"כ',
  items: 'פריטים', createdAt: 'נוצר', updatedAt: 'עודכן', paidAt: 'שולם', cancelledAt: 'בוטל', depositorName: 'שם המפקיד',
  privacyMinimizedAt: 'מוזער', minimizedAt: 'מוזער', reportStatus: 'דיווח לרשות המסים', campaignId: 'קמפיין', availability: 'זמינות',
  cheques: 'המחאות', receivedDate: 'ההמחאות התקבלו', bouncedCheque: 'המחאה שחזרה', replacesReceipt: 'מחליפה את קבלה', bank: 'בנק', branch: 'סניף',
  role: 'סוג לקוח', email: 'דוא"ל', areas: 'אזורים מבוקשים', types: 'סוגי נכס מבוקשים', minRooms: 'חדרים — מינימום', maxRooms: 'חדרים — מקסימום',
  budgetMinAg: 'תקציב מינימלי (אגורות)', budgetMaxAg: 'תקציב מקסימלי (אגורות)', needsMortgage: 'צריך משכנתא',
  propertyAddress: 'כתובת הנכס', effectiveDate: 'מועד קובע', caseStatus: 'מצב התיק',
  supplierName: 'שם הספק', supplierTaxId: 'מספר עוסק', cancelCreditNumber: 'בוטלה בחשבונית זיכוי', printedAt: 'הודפס'
};
// מזהים פנימיים בלבד — לא מידע על האדם
const SKIP = new Set(['id', 'entryId', 'paymentEntryId', 'reversalEntryId', 'loanId', 'itemId', 'applicationId', 'ambassadorId', 'standingOrderId', 'chequeGroupId', 'replacesId', 'replacedBy', 'realtyDealId', 'mortgageCaseId', 'advisorId', 'buyerClientId', 'sellerClientId', 'propertyId', 'cancelCreditId', 'issuer']);

function show(key, v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? 'כן' : 'לא';
  if (key === 'guarantors' && Array.isArray(v)) return v.map(g => [g.name, g.id, g.phone].filter(Boolean).join(' · ')).join('; ');
  if (key === 'schedule' && Array.isArray(v)) return `${v.length} תשלומים, מהם שולמו ${v.filter(x => x.status === 'paid').length}`;
  if (key === 'items' && Array.isArray(v)) return v.map(it => `${it.description || ''} × ${it.quantity || 1}`).join('; ');
  if (key === 'cheques' && Array.isArray(v)) return v.map(c => [c.number, c.bank && `בנק ${c.bank}`, c.branch && `סניף ${c.branch}`, `פירעון ${c.dueDate}`, `${(c.amountAg / 100).toFixed(2)} ₪`].filter(Boolean).join(' · ')).join('; ');
  if (Array.isArray(v)) return v.every(x => typeof x !== 'object') ? v.join(', ') : `${v.length} פריטים`;
  if (typeof v === 'object') return Object.entries(v).filter(([k]) => !SKIP.has(k)).map(([k, x]) => `${LABELS[k] || k}: ${show(k, x)}`).filter(x => !/: $/.test(x)).join(' · ');
  return String(v);
}

const fieldsOf = (rec) => Object.entries(rec || {}).filter(([k]) => !SKIP.has(k)).map(([k, v]) => ({ label: LABELS[k] || k, value: show(k, v) })).filter(f => f.value);

// opts: canSeeConfidential, sources (תחומים פתוחים), acct (הנהלת חשבונות פתוחה), today
function subjectReport(data, idNumber, opts = {}) {
  const id = String(idNumber || '').replace(/\D/g, '');
  if (id.length < 5 || id.length > 9) throw new Error('יש להזין מספר זהות (5–9 ספרות)');
  const key = id.padStart(9, '0');
  const sources = opts.sources || P.SOURCES;
  const people = P.group(P.collect(data, { canSeeConfidential: !!opts.canSeeConfidential, today: opts.today, sources }));
  const person = people.find(p => p.idNumber === key);
  const sections = [];
  const npo = data.npo || {};
  const gm = data.gemach || {};
  const ch = data.chesed || {};
  const find = (list, refId) => (list || []).find(x => x.id === refId);
  const TITLES = { donation: 'תרומה', standing: 'הוראת קבע', memorial: 'הנצחה (איש קשר)', loan: 'הלוואה בגמ"ח', lending: 'השאלת חפץ', deposit: 'הפקדה בגמ"ח', beneficiary: 'משפחה נתמכת', volunteer: 'מתנדב' };
  const SRC = { donation: npo.donations, standing: npo.standingOrders, memorial: npo.memorials, loan: gm.loans, lending: gm.lendings, deposit: gm.deposits, beneficiary: ch.beneficiaries, volunteer: ch.volunteers };
  const seen = new Set();
  for (const h of person ? person.hits : []) {
    const rec = find(SRC[h.ref.kind], h.ref.id);
    if (!rec || seen.has(h.ref.kind + ':' + rec.id + ':' + h.role)) continue;
    seen.add(h.ref.kind + ':' + rec.id + ':' + h.role);
    const title = h.role === 'guarantor' ? 'ערבות להלוואה בגמ"ח' : TITLES[h.ref.kind];
    sections.push({ title, byName: !!h.byName, fields: fieldsOf(rec) });
  }
  // בקשות הלוואה בגמ"ח — לא נכללות במאגר האנשים
  if (sources.includes('gemach')) {
    for (const a of gm.applications || []) {
      const asBorrower = String(a.borrowerId || '').replace(/\D/g, '').padStart(9, '0') === key;
      const asGuarantor = (a.guarantors || []).some(g => String(g.id || '').replace(/\D/g, '').padStart(9, '0') === key);
      if (asBorrower || asGuarantor) sections.push({ title: asBorrower ? 'בקשת הלוואה בגמ"ח' : 'ערבות בבקשת הלוואה', byName: false, fields: fieldsOf(a) });
    }
  }
  // לקוחות נדל"ן ותיווך לפי ת"ז — רק אם התחום פתוח ברישיון (opts.realty)
  if (opts.realty) {
    for (const c of (data.realty && data.realty.clients) || []) {
      if (String(c.idNumber || '').replace(/\D/g, '').padStart(9, '0') !== key) continue;
      sections.push({ title: 'לקוח נדל"ן ותיווך', byName: false, fields: fieldsOf(c) });
      // תיק ייעוץ משכנתאות שנפתח מעסקה שבה הלקוח קונה — מקושר, ולכן נמצא גם בלי ת"ז בתיק.
      // רק כשגם ייעוץ המשכנתאות פתוח ברישיון (opts.madv) — אחרת הדוח עוקף את הרישיון של תחום סגור
      for (const d of (opts.madv ? data.realty.deals || [] : []).filter(x => x.buyerClientId === c.id && x.mortgageCaseId)) {
        const mc = ((data.mortgageAdvisor && data.mortgageAdvisor.clients) || []).find(x => x.id === d.mortgageCaseId);
        if (mc) sections.push({ title: 'תיק ייעוץ משכנתאות (נפתח מעסקת תיווך)', byName: false, fields: fieldsOf(mc) });
      }
    }
  }
  // תיקי שמאות מקרקעין לפי ת"ז המזמין — רק אם התחום פתוח ברישיון (opts.realestate). פרטי המזמין והנכס
  // בלבד; החישובים ועסקאות ההשוואה אינם מידע על האדם
  if (opts.realestate) {
    for (const cs of (data.realEstate && data.realEstate.cases) || []) {
      const cl = cs.client || {};
      if (String(cl.idNumber || '').replace(/\D/g, '').padStart(9, '0') !== key) continue;
      const p = cs.property || {};
      sections.push({ title: `תיק שמאות מקרקעין ${cs.no}${cs.rev ? '-' + cs.rev : ''}`, byName: false, fields: fieldsOf({
        name: cl.name, idNumber: cl.idNumber, phone: cl.phone, email: cl.email, address: cl.address,
        propertyAddress: [p.address, p.city].filter(Boolean).join(', '), effectiveDate: cs.effectiveDate,
        caseStatus: cs.status === 'final' ? 'נעול' : 'טיוטה', createdAt: cs.createdAt,
      }) });
    }
  }
  // חשבוניות לפי ע.מ / ח.פ של הלקוח — רק אם הנהלת החשבונות פתוחה ברישיון
  if (opts.acct) {
    for (const inv of data.invoices || []) {
      if (String(inv.customerTaxId || '').replace(/\D/g, '').padStart(9, '0') === key) sections.push({ title: `חשבונית ${inv.number}`, byName: false, fields: fieldsOf(inv) });
    }
    // ספק שהוא עוסק יחיד — מספר העוסק שלו הוא מספר הזהות. רק פרטי החשבונית, בלי שורות היומן
    for (const e of data.journal || []) {
      const sd = (e && e.supplierDoc) || {};
      const vd = (e && e.vatDoc) || {};
      const tax = String(sd.taxId || vd.supplierTaxId || '').replace(/\D/g, '');
      if (!tax || tax.padStart(9, '0') !== key) continue;
      sections.push({ title: 'חשבונית ספק ביומן', byName: false, fields: fieldsOf({
        supplierName: sd.name, supplierTaxId: tax, reference: sd.reference || vd.reference, date: sd.docDate || vd.docDate || e.date, total: e.total,
      }) });
    }
  }
  const names = person ? [...person.names] : [];
  return {
    idNumber: key, names, phones: person ? [...person.phones] : [], sections, count: sections.length,
    notCovered: 'לא נכללים: רשומות שאין בהן מספר זהות ושלא שויכו לפי שם (למשל מתנדב או מפקיד ששמו מופיע אצל כמה אנשים), תיקי ייעוץ משכנתאות (אין בהם ת"ז — נכללים רק אם נפתחו מעסקת תיווך של הלקוח והייעוץ פתוח ברישיון), לקוחות נדל"ן ומזמיני שומה שנרשמו בלי ת"ז, אנשי קשר, ומודול השמאות. יש לחפש גם לפי שם במאגר האנשים ובמודול הזה.'
  };
}

function renderSubjectHtml(report, org, today) {
  const body = `${orgLine(org)}
<div>מספר זהות: <b dir="ltr">${esc(report.idNumber)}</b>${report.names.length ? ` · שם: ${esc(report.names.join(' / '))}` : ''}${report.phones.length ? ` · טלפון: ${esc(report.phones.join(', '))}` : ''}</div>
<div>נמצאו ${report.count} רשומות.</div>
${report.sections.map((s, i) => `<h2>${i + 1}. ${esc(s.title)}${s.byName ? ' <span class="muted">(שויך לפי שם — לוודא שזה אותו אדם)</span>' : ''}</h2>
<table><tbody>${s.fields.map(f => `<tr><td style="width:30%">${esc(f.label)}</td><td>${esc(f.value)}</td></tr>`).join('')}</tbody></table>`).join('') || '<p>לא נמצא מידע על מספר הזהות הזה בתחומים שנבדקו.</p>'}
<div class="note">${esc(report.notCovered)}</div>`;
  return page('המידע השמור על נושא המידע (זכות עיון)', body, today);
}

module.exports = { DISCLAIMER, NOTICE_KINDS, renderDefinitionHtml, renderProcedureHtml, noticeText, renderNoticeHtml, subjectReport, renderSubjectHtml };
