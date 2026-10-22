// מכתבים ותבניות לעמותה — מכתב תודה לתורם, נרטיב לדוח השנתי וטיוטת בקשת מענק.
// פונקציות טהורות: אין require ואין רשת (הקובץ נכלל גם בגרסת אנדרואיד), בקלט בלבד —
// הקלט הוא הפלט שכבר חושב במנוע (donorAnnualStatement / annualReport ב-core/npo.js) — בשקלים.
// הכספים מוצגים בשקלים; החישובים כאן הם סכום/חלוקה בלבד ובעיגול מפורש.
'use strict';

// ---------- עזרי תצוגה (עותק מקומי של exports.js — הקובץ הזה טהור) ----------
const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const money = (n) => '₪' + Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// אחוז שלם, ספרה אחת אחרי הנקודה (בלי אפס מיותר)
const pct = (part, whole) => {
  const w = Number(whole) || 0;
  if (!w) return '—';
  return (Math.round((Number(part) / w) * 1000) / 10).toFixed(1).replace(/\.0$/, '') + '%';
};

// ---------- עזרי קלט לא־מהימן ----------
const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max || 200);
const lines = (v, maxLines) => String(v ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, maxLines || 12);

const orgOf = (src) => ({
  name: str(src && src.org && src.org.name, 120),
  regNumber: str(src && src.org && src.org.regNumber, 30),
  address: str(src && src.org && src.org.address, 160),
  phone: src && src.org ? str(src.org.phone, 40) : '',
  sec46Number: src && src.org ? str(src.org.sec46Number, 40) : '',
  sec46ValidUntil: src && src.org ? str(src.org.sec46ValidUntil, 20) : ''
});

// ---------- 1. מכתב תודה לתורם ----------
// statement — הפלט של npo.donorAnnualStatement:
// { year, donor: { name, id, address }, org, receipts: [...], total, sec46Total }
function thankYouLetter(statement, options = {}) {
  const st = statement || {};
  const o = orgOf({ org: st.org });
  const d = st.donor || {};
  const year = Number(st.year) || '';
  const total = Number(st.total) || 0;
  const sec46 = Number(st.sec46Total) || 0;
  const count = Array.isArray(st.receipts) ? st.receipts.length : 0;
  const fundName = str(options.fundName, 80);
  const extra = str(options.message, 1200);

  const hello = str(d.name, 120) ? `לכבוד ${str(d.name, 120)}` : 'לכבוד התורם היקר';
  const paragraphs = [];
  paragraphs.push(`שלום וברכה,`);
  paragraphs.push(
    `בשם ${o.name || 'העמותה'} ובשם כל מי שנהנה מפעילותה — הננו להודות לך מקרב לב על תמיכתך בשנת ${year || 'השנה'}.`
  );
  if (count) {
    paragraphs.push(
      `במהלך השנה התקבלו ממך ${count === 1 ? 'תרומה אחת' : count + ' תרומות'}${fundName ? ` ל${fundName}` : ''}, ` +
      `בסך כולל של ${money(total)}.`
    );
  } else {
    paragraphs.push('הודעה זו נשלחת לכבוד תמיכתך בעמותה.');
  }
  if (sec46 > 0) {
    paragraphs.push(
      `מתוך הסכום, ${money(sec46)} הינם תרומות מוכרות לזיכוי ממס לפי סעיף 46 לפקודת מס הכנסה` +
      (o.sec46Number ? ` (אישור מס׳ ${o.sec46Number}${o.sec46ValidUntil ? `, בתוקף עד ${o.sec46ValidUntil}` : ''})` : '') + '.'
    );
  }
  paragraphs.push('תודה על שותפותך במלאכת הקודש. תזכה למצוות, ולשכר רב מן השמים.');
  if (extra) paragraphs.push(extra);

  const signature = [];
  signature.push('בכבוד רב ובהערכה,');
  signature.push(o.name || 'העמותה');
  if (o.regNumber) signature.push(`ע"ר ${o.regNumber}`);
  if (o.address) signature.push(o.address);
  if (o.phone) signature.push(`טלפון: ${o.phone}`);

  const text = [hello, ...paragraphs, '', ...signature].join('\n\n').replace(/\n{3,}/g, '\n\n');
  return {
    kind: 'thank-you', year, donor: str(d.name, 120), title: `מכתב תודה — ${str(d.name, 120) || 'תורם'} ${year || ''}`.trim(),
    text,
    amounts: { total, sec46, receipts: count }
  };
}

// ---------- 2. נרטיב לדוח שנתי ----------
// report — הפלט של npo.annualReport: { year, org, donationsCount, donationsTotal, sec46Total,
//   byMethod, grants, grantsReceived, donorsCount, largeDonors, largeDonorThreshold, funds }
function annualNarrative(report, options = {}) {
  const r = report || {};
  const o = orgOf({ org: r.org });
  const year = Number(r.year) || '';
  const total = Number(r.donationsTotal) || 0;
  const sec46 = Number(r.sec46Total) || 0;
  const grantsReceived = Number(r.grantsReceived) || 0;
  const funds = r.funds || {};
  const restricted = Number(funds.restrictedTotal) || 0;
  const general = Number(funds.generalTotal) || 0;
  const extra = str(options.message, 1600);

  const parts = [];
  parts.push(
    `${o.name || 'העמותה'}${o.regNumber ? ` (ע"ר ${o.regNumber})` : ''} סיימה את שנת ${year || 'הדוח'} בפעילות עניפה של איסוף תרומות, קבלת תמיכות וביצוע פעולות. ` +
    `דוח זה מרכז את עיקרי ההכנסות ומקורותיהן, כפי שנרשמו במערכת.`
  );
  parts.push(
    `במהלך השנה התקבלו ${Number(r.donationsCount) || 0} תרומות מ-${Number(r.donorsCount) || 0} תורמים, בסך כולל של ${money(total)}.`
  );
  const byMethod = Array.isArray(r.byMethod) ? r.byMethod.filter(m => Number(m.total) > 0) : [];
  if (byMethod.length) {
    parts.push(
      'פילוח אמצעי התשלום: ' + byMethod
        .map(m => `${str(m.label, 40)} — ${money(Number(m.total))} (${pct(Number(m.total), total)})`)
        .join('; ') + '.'
    );
  }
  if (sec46 > 0) {
    parts.push(
      `מתוך התרומות, ${money(sec46)} (${pct(sec46, total)} מהסכום) היו מוכרות לזיכוי ממס לפי סעיף 46 לפקודת מס הכנסה, ` +
      `והן נרשמו וקיבלו קבלות בהתאם.`
    );
  }
  const fundRows = Array.isArray(funds.funds) ? funds.funds.filter(f => Number(f.total) > 0) : [];
  if (funds.total || restricted || general) {
    parts.push(
      `מצב הקרנות בתום השנה: ${money(Number(funds.total))} בסך הכול, מהם ${money(restricted)} בקרנות ייעודיות ו-${money(general)} בקרן הכללית.` +
      (fundRows.length ? ` פירוט לפי קרן: ` + fundRows.map(f => `${str(f.name, 80)} — ${money(Number(f.total))}`).join('; ') + '.' : '')
    );
  }
  const grants = Array.isArray(r.grants) ? r.grants : [];
  if (grants.length) {
    parts.push(
      `התקבלו תמיכות מ-${grants.length} ${grants.length === 1 ? 'מקור' : 'מקורות'}, מהן נכנסו בפועל ${money(grantsReceived)}. ` +
      `פירוט: ` + grants.map(g => `${str(g.source, 80)} (${str(g.count, 6)} ${Number(g.count) === 1 ? 'תמיכה' : 'תמיכות'})`).join('; ') + '.'
    );
  }
  const large = Array.isArray(r.largeDonors) ? r.largeDonors : [];
  if (large.length) {
    parts.push(
      `התורמים הגדולים (מעל ${money(Number(r.largeDonorThreshold))}) היו ${large.length}; ` +
      `סכום תרומותיהם עומד על ${money(large.reduce((t, d) => t + (Number(d.total) || 0), 0))}.`
    );
  }
  if (extra) parts.push(extra);
  parts.push('כל הנתונים בדוח זה נלקחו מהרישומים במערכת. הדוח אינו מחליף את הדוח הכספי המבוקר.');

  return { kind: 'annual-narrative', year, title: `נרטיב לדוח השנתי — שנת ${year || ''}`.trim(), text: parts.join('\n\n') };
}

// ---------- 3. טיוטת בקשת מענק ----------
// report — כמו ב-annualNarrative. input (קלט המשתמש):
//   { fundName, program, amount, purpose, period, contactName, contactPhone }
// הסכום בבקשת מענק מוקלד בשקלים שלמים → מומר לאגורות מיד.
function grantDraft(report, input = {}) {
  const r = report || {};
  const o = orgOf({ org: r.org });
  const year = Number(r.year) || '';
  const amountAg = Math.round((Number(input.amount) || 0) * 100);
  const fundName = str(input.fundName, 120);
  const program = str(input.program, 160);
  const purpose = lines(input.purpose, 10);
  const period = str(input.period, 80);
  const contactName = str(input.contactName, 80);
  const contactPhone = str(input.contactPhone, 40);
  if (!fundName) throw new Error('יש להזין את שם הקרן או הגוף שמבקשים ממנו את המענק');

  const total = Number(r.donationsTotal) || 0;
  const grantsReceived = Number(r.grantsReceived) || 0;
  const parts = [];
  parts.push(`לכבוד ${fundName}`);
  parts.push(`הנדון: בקשה לתמיכה בפעילות ${o.name || 'העמותה'}${program ? ` — ${program}` : ''}`);
  parts.push('שלום וברכה,');
  parts.push(
    `${o.name || 'העמותה'}${o.regNumber ? `, ע"ר ${o.regNumber}${o.address ? `, ${o.address}` : ''}` : ''}, ` +
    `פועלת לקידום ${program || 'פעילותה'} ומגישה בזאת בקשה לתמיכה ${amountAg > 0 ? `בסך ${money(amountAg / 100)} ` : ''}${period ? `עבור ${period}` : ''}.`
  );
  if (purpose.length) {
    parts.push('ייעודי התמיכה המבוקשת:\n' + purpose.map((p, i) => `${i + 1}. ${p}`).join('\n'));
  }
  if (total || grantsReceived) {
    parts.push(
      `לשם שקיפות נבהיר כי בשנת ${year || 'הדוח'} התקבלו תרומות בסך ${money(total)} ` +
      `(${Number(r.donationsCount) || 0} תרומות מ-${Number(r.donorsCount) || 0} תורמים), ` +
      `ותמיכות בסך ${money(grantsReceived)}.`
    );
  }
  parts.push('נשמח להעביר כל מסמך נדרש — דוחות כספיים, אישור ניהול תקין ואישור סעיף 46.');
  parts.push(
    'בברכת יישר כוחทั้ง על השותפות במעשי החסד.',
    '',
    contactName ? `בכבוד רב, ${contactName}` : 'בכבוד רב,',
    o.name || 'העמותה',
    contactPhone ? `טלפון: ${contactPhone}` : (o.phone ? `טלפון: ${o.phone}` : '')
  );
  return {
    kind: 'grant-draft', year, fundName, amountAg, program,
    title: `טיוטת בקשת מענק — ${fundName}`,
    text: parts.filter(p => p !== '').join('\n\n')
  };
}

// ---------- מעטפת HTML להדפסה / PDF ----------
const LETTER_CSS = `
  @page { size: A4; margin: 18mm; }
  body { font-family: "David", "Segoe UI", Arial, sans-serif; color: #14213d; margin: 0; font-size: 14px; line-height: 1.8; }
  header { text-align: center; border-bottom: 2px solid #13264a; padding-bottom: 10px; margin-bottom: 22px; }
  header h2 { margin: 0 0 4px; font-size: 19px; color: #13264a; }
  header .sub { font-size: 12px; color: #5d6b85; }
  h1 { font-size: 16px; margin: 0 0 16px; color: #13264a; }
  .body { white-space: pre-wrap; text-align: justify; }
  .notice { margin-top: 28px; font-size: 11px; color: #5d6b85; border-top: 1px dashed #cbd5e1; padding-top: 8px; }
`;
function letterBody(doc) {
  const d = doc || {};
  return `<header><h2>${esc((d.org && d.org.name) || '')}</h2><div class="sub">${esc((d.org && d.org.address) || '')}${d.org && d.org.phone ? ' · טלפון: ' + esc(d.org.phone) : ''}</div></header>
<h1>${esc(d.title || '')}</h1>
<div class="body">${esc(d.text || '')}</div>
<div class="notice">מסמך זה הופק במערכת SuperSuite ואינו מחליף מסמך חתום. יש לעבור על הנוסח לפני המסירה.</div>`;
}
function htmlDoc(title, body) {
  return `<!doctype html>\n<html lang="he" dir="rtl">\n<head>\n<meta charset="utf-8">\n<title>${esc(title)}</title>\n<style>${LETTER_CSS}</style>\n</head>\n<body>\n${body}</body>\n</html>`;
}
// מקבל תוצאת thankYouLetter / annualNarrative / grantDraft ומחזיר מסמך HTML מלא.
// הכספים במסמך כבר מפורמטים; org הוא כותרת המעטפת (name, address, phone)
function renderLetterHtml(doc, org) {
  const d = Object.assign({}, doc, { org: { name: str(org && org.name, 120), address: str(org && org.address, 160), phone: str(org && org.phone, 40) } });
  return htmlDoc(d.title || 'מכתב', letterBody(d));
}

module.exports = { thankYouLetter, annualNarrative, grantDraft, renderLetterHtml, pct };
