// שמאות מקרקעין (PLAN.md 9.20): עסקאות השוואה והתאמות, שלוש גישות, שקלול, קליטת CSV, נעילה וגרסאות, ודוח.
// כל הסכומים באגורות. כל הנתונים בדוגמאות בדויים.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../modules/econ/core/realEstateAppraisal');

const TODAY = '2026-10-20';
const base = (over = {}) => R.validateCase({
  client: { name: 'משה כהן', idNumber: '123456782' }, purpose: 'mortgage', effectiveDate: '2026-10-01', visitDate: '2026-10-01',
  property: { address: 'רחוב הרב קוק 5', city: 'בני ברק', block: '6123', parcel: '45', subParcel: '7', type: 'apartment', area: '100' },
  comparables: [
    { date: '2026-06-01', price: '2,000,000', area: '100', source: 'קובץ עסקאות', adjustments: [{ factor: 'time', pct: '2' }, { factor: 'floor', pct: '-1' }] },
    { date: '2026-03-15', price: '2,200,000', area: '110', adjustments: [{ factor: 'condition', pct: '-5' }] },
    { date: '2026-08-10', price: '1,800,000', area: '90', adjustments: [] },
  ],
  ...over,
}, TODAY);

test('המרות: סכום ← אגורות, אחוז ← נקודות בסיס, שטח, ספרת ביקורת', () => {
  assert.equal(R.toAg('1,250,000'), 125000000);
  assert.equal(R.toAg('₪ 980000.5'), 98000050);
  assert.equal(R.toAg(''), null);
  assert.throws(() => R.toAg('abc', 'מחיר'), /מחיר: יש להזין סכום/);
  assert.equal(R.pctToBp('-2.5'), -250);
  assert.equal(R.pctToBp('+3'), 300);
  assert.equal(R.pctToBp(''), 0);
  assert.throws(() => R.pctToBp('60', 'התאמה'), /מחוץ לטווח/);
  assert.equal(R.toArea('85,5'), 85.5);
  assert.throws(() => R.toArea('0', 'שטח'), /מחוץ לטווח/);
  assert.equal(R.validIsraeliId('123456782'), true);
  assert.throws(() => R.validateCase({ client: { idNumber: '123456789' } }, TODAY), /מספר הזהות/);
});

test('עסקת השוואה: מחיר למ"ר, התאמה נטו וגולמית, מחיר מותאם — באגורות שלמות', () => {
  const cs = base();
  const r = R.comparableResult(cs.comparables[0]);
  assert.equal(r.perSqmAg, 2000000, '₪20,000 למ"ר');
  assert.equal(r.netBp, 100);
  assert.equal(r.grossBp, 300);
  assert.equal(r.adjustedPerSqmAg, 2020000);
  const r2 = R.comparableResult(cs.comparables[1]);
  assert.equal(r2.perSqmAg, Math.round(220000000 / 110));
  assert.equal(r2.adjustedPerSqmAg, Math.round(r2.perSqmAg * 9500 / 10000));
  assert.throws(() => R.validateCase({ comparables: [{ date: '2026-13-01', price: '1', area: '1' }] }, TODAY), /עסקה 1: תאריך/);
  assert.throws(() => R.validateCase({ comparables: [{ date: '2026-01-01', price: '', area: '50' }] }, TODAY), /עסקה 1: יש להזין מחיר/);
});

test('גישת ההשוואה: ממוצע פשוט או משוקלל, עסקה מוחרגת, ואזהרות', () => {
  const cs = base();
  const s = R.salesApproach(cs);
  const adj = [2020000, Math.round(Math.round(220000000 / 110) * 9500 / 10000), 2000000];
  const avg = Math.round(adj.reduce((a, b) => a + b, 0) / 3);
  assert.equal(s.perSqmAg, avg);
  assert.equal(s.valueAg, avg * 100);
  assert.equal(s.stats.count, 3);
  assert.equal(s.stats.medianAg, 2000000);
  // משקלות 50/30/20
  const w = base({ comparables: base().comparables.map((c, i) => ({ ...c, weight: [50, 30, 20][i] })) });
  const sw = R.salesApproach(w);
  assert.equal(sw.perSqmAg, Math.round((adj[0] * 50 + adj[1] * 30 + adj[2] * 20) / 100));
  assert.equal(sw.stats.weighted, true);
  // עסקה מוחרגת + פחות משלוש עסקאות + עסקה ישנה + התאמה גולמית גדולה
  const x = base({ comparables: [
    { date: '2024-01-01', price: '2,000,000', area: '100', adjustments: [{ factor: 'location', pct: '20' }, { factor: 'size', pct: '-10' }] },
    { date: '2026-01-01', price: '9,000,000', area: '100', included: false },
  ] });
  const sx = R.salesApproach(x);
  assert.equal(sx.stats.count, 1);
  assert.equal(sx.perSqmAg, 2200000);
  assert.ok(sx.warnings.some(m => /פחות מ-3/.test(m)));
  assert.ok(sx.warnings.some(m => /התאמה גולמית של 30%/.test(m)));
  assert.ok(sx.warnings.some(m => /33 חודשים/.test(m)));
  // שטח אקוויוולנטי גובר על השטח הבנוי
  const eq = base({ property: { ...base().property, equivArea: '110' } });
  assert.equal(R.salesApproach(eq).valueAg, avg * 110);
});

test('היוון הכנסות וגישת העלות: ערכים ידועים', () => {
  const inc = R.validateCase({ income: { enabled: true, monthlyRent: '6,000', vacancyPct: '5', annualExpenses: '4,400', capRatePct: '3' } }, TODAY).income;
  const i = R.incomeApproach(inc);
  assert.equal(i.grossAg, 7200000);
  assert.equal(i.effectiveAg, 6840000);
  assert.equal(i.noiAg, 6400000);
  assert.equal(i.valueAg, Math.round(6400000 * 10000 / 300), 'NOI / 3%');
  assert.equal(R.incomeApproach({ ...inc, capRateBp: 0 }).ok, false);
  const cs = R.validateCase({ property: { area: '120' }, cost: { enabled: true, land: '1,000,000', costPerSqm: '8,000', profitPct: '10', depreciationPct: '20' } }, TODAY);
  const c = R.costApproach(cs.cost, cs.property);
  assert.equal(c.buildAg, 96000000);
  assert.equal(c.withProfitAg, 105600000);
  assert.equal(c.depreciatedAg, 84480000);
  assert.equal(c.valueAg, 100000000 + 84480000);
});

test('שקלול: משקלות, נרמול, עיגול, שווי ידני עם נימוק', () => {
  const cs = base({ income: { enabled: true, monthlyRent: '6,000', capRatePct: '3.5' }, reconcile: { weights: { sales: 80, income: 20 }, roundToIls: 10000 } });
  const r = R.computeCase(cs);
  const raw = Math.round(r.sales.valueAg * 0.8 + r.income.valueAg * 0.2);
  assert.equal(r.final.rawAg, raw);
  assert.equal(r.final.valueAg, Math.round(raw / 1000000) * 1000000, 'עיגול ל-10,000 ₪');
  assert.equal(r.final.valueAg % 1000000, 0);
  // בלי משקלות — ממוצע פשוט עם אזהרה
  const plain = R.computeCase(base({ income: { enabled: true, monthlyRent: '6,000', capRatePct: '3.5' } }));
  assert.ok(plain.final.warnings.some(w => /ממוצע פשוט/.test(w)));
  // משקלות שאינם 100
  const odd = R.computeCase(base({ income: { enabled: true, monthlyRent: '6,000', capRatePct: '3.5' }, reconcile: { weights: { sales: 60, income: 20 } } }));
  assert.ok(odd.final.warnings.some(w => /80%/.test(w)));
  assert.equal(odd.final.weights.sales, 75);
  // שווי ידני: בלי נימוק — אזהרה וחסם נעילה
  const ov = base({ reconcile: { override: '2,050,000' } });
  assert.equal(R.computeCase(ov).final.valueAg, 205000000);
  assert.ok(R.finalizeProblems(ov, TODAY).includes('שווי סופי שנקבע ידנית מחייב נימוק'));
});

test('נעילה: בדיקות חובה, עותק התוצאות, גרסה מתוקנת', () => {
  const empty = R.validateCase({}, TODAY);
  const probs = R.finalizeProblems(empty, TODAY);
  for (const m of ['יש להזין את שם המזמין', 'יש להזין את כתובת הנכס', 'יש להזין גוש וחלקה', 'יש להזין את שטח הנכס']) assert.ok(probs.includes(m), m);
  const cs = { ...base(), id: 'x', no: 12, rev: 0, status: 'draft' };
  const f = R.finalizeCase(cs, TODAY);
  assert.equal(f.status, 'final');
  assert.equal(f.reportDate, TODAY);
  const v = f.frozen.final.valueAg;
  // שינוי בעסקה אחרי הנעילה לא משנה את הדוח
  const html1 = R.renderReportHtml(f, { name: 'שמאי' }, TODAY);
  f.comparables[0].priceAg = 1;
  assert.equal(R.renderReportHtml(f, { name: 'שמאי' }, '2027-01-01').includes(R.renderReportHtml(f, { name: 'שמאי' }, TODAY).slice(0, 50)), true);
  assert.ok(html1.includes('₪' + (v / 100).toLocaleString('he-IL', { maximumFractionDigits: 0 })));
  const r = R.reopenCase(f);
  assert.equal(r.status, 'draft');
  assert.equal(r.rev, 1);
  assert.equal(r.frozen, undefined);
  assert.equal(r.history[0].valueAg, v);
  assert.equal(R.reportNo(r), '12-1');
  assert.throws(() => R.reopenCase(r), /אינו נעול/);
  assert.throws(() => R.finalizeCase({ ...empty, id: 'y', no: 1 }, TODAY), /שם המזמין/);
});

test('קליטת CSV: כותרות בעברית, גרשיים, תאריך ישראלי, גוש/חלקה בעמודה אחת, ושורות שגויות', () => {
  const csv = '﻿תאריך עסקה,מחיר,שטח במ"ר,כתובת,עיר,חדרים,קומה,גוש/חלקה\n'
    + '15/03/2026,"2,150,000",98.5,"רחוב חזון איש 10, דירה 4",בני ברק,4,3,6123-45-7\n'
    + '01.02.2026,1900000,90,רחוב רבי עקיבא 2,בני ברק,3,קומה 2,6124/12\n'
    + '2026-02-30,1000000,50,שגוי,,,,\n'
    + '2026-01-10,,70,בלי מחיר,,,,\n';
  const r = R.parseComparablesCsv(csv, { source: 'ייצוא מאגר' });
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].date, '2026-03-15');
  assert.equal(r.rows[0].priceAg, 215000000);
  assert.equal(r.rows[0].area, 98.5);
  assert.equal(r.rows[0].address, 'רחוב חזון איש 10, דירה 4');
  assert.deepEqual([r.rows[0].block, r.rows[0].parcel, r.rows[0].subParcel], ['6123', '45', '7']);
  assert.equal(r.rows[1].floor, 2);
  assert.equal(r.rows[1].source, 'ייצוא מאגר');
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0], /^שורה 4: תאריך/);
  assert.match(r.errors[1], /^שורה 5: יש להזין מחיר/);
  assert.throws(() => R.parseComparablesCsv('עיר,כתובת\nבני ברק,א'), /עמודות חובה.*תאריך, מחיר, שטח/);
  assert.throws(() => R.parseComparablesCsv(''), /ריק/);
  // נקודה-פסיק כמפריד (אקסל בעברית)
  assert.equal(R.parseComparablesCsv('date;price;area\n2026-01-01;1000000;50').rows.length, 1);
});

test('דוח: מבנה מקצועי, escape, טיוטה מסומנת, בלי צבע hex ובלי רשת', () => {
  const cs = { ...base({ property: { ...base().property, description: 'דירה <b>מרווחת</b>', planning: 'תב"ע בתוקף' } }), id: 'x', no: 3, rev: 0, status: 'draft' };
  const draft = R.renderReportHtml(cs, { name: 'ישראל ישראלי', license: '1234' }, TODAY);
  assert.match(draft, /טיוטה — לא לשימוש/);
  const f = R.finalizeCase(cs, TODAY);
  const html = R.renderReportHtml(f, { name: 'ישראל ישראלי', license: '1234', office: 'ישראלי שמאות' }, TODAY);
  for (const s of ['שומת מקרקעין', 'מספר דוח', 'המועד הקובע', 'מטרת השומה', 'בטוחה למשכנתא', 'גוש 6123, חלקה 45, תת-חלקה 7',
    'עסקאות השוואה', 'גישת ההשוואה', 'שקלול ושומה סופית', 'שווי הנכס במועד הקובע', 'הנחות ומגבלות', 'הצהרת השמאי', 'המצב התכנוני', '1234']) {
    assert.ok(html.includes(s), 'חסר: ' + s);
  }
  assert.doesNotMatch(html, /טיוטה/);
  assert.doesNotMatch(html, /<b>מרווחת/);
  assert.match(html, /&lt;b&gt;מרווחת/);
  assert.doesNotMatch(html, /#[0-9a-fA-F]{3,6}\b/);
  assert.doesNotMatch(html, /https?:\/\/|<script/i);
  assert.match(html, /<html lang="he" dir="rtl">/);
});

// נמצא בבדיקה בתוכנה (20.10.2026): כותרת "מחיר מוצהר" לא זוהתה, ו"−3%" בדוח מימין לשמאל הוצג "3%-"
test('CSV: כותרות נפוצות נוספות — מחיר מוצהר, יחידה בסוגריים או בסוף', () => {
  const r = R.parseComparablesCsv('\ufeffיום מכירה,כתובת,גוש/חלקה,מחיר מוצהר,שטח במ"ר,קומה\n03/08/2026,"רחוב השומר 9, בני ברק",6125-30-4,"2,180,000",102,קומה 3\n31/02/2026,רחוב עזרא 3,,1500000,80,1\n');
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].priceAg, 218000000);
  assert.equal(r.rows[0].floor, 3);
  assert.deepEqual([r.rows[0].block, r.rows[0].parcel, r.rows[0].subParcel], ['6125', '30', '4']);
  assert.match(r.errors[0], /שורה 3: תאריך/);
  assert.equal(R.parseComparablesCsv('תאריך,מחיר (₪),שטח (מ"ר)\n2026-01-05,1000000,50').rows.length, 1);
  assert.equal(R.parseComparablesCsv('תאריך,מחיר בש"ח,שטח\n2026-01-05,1000000,50').rows.length, 1);
});

test('דוח: אחוז עם סימן עטוף בכיוון שמאל לימין', () => {
  const cs = { ...base(), id: 'x', no: 4, rev: 0, status: 'draft' };
  cs.comparables[0].adjustments = [{ factor: 'floor', bp: -300, note: '' }];
  const html = R.renderReportHtml(cs, {}, TODAY);
  assert.match(html, /קומה <bdi dir="ltr">‎?-3%<\/bdi>/);
  assert.match(html, /<td class="n"><bdi dir="ltr">/, 'גם עמודת הנטו');
});

test('דוח דו-לשוני: תוויות וערכים באנגלית, פרטי שמאי והצהרה; בעברית בלבד — בלי אנגלית', () => {
  const cs = { ...R.validateCase({ ...base(), reportLang: 'he-en' }, TODAY), id: 'x', no: 5, rev: 0, status: 'draft' };
  assert.equal(cs.reportLang, 'he-en');
  const html = R.renderReportHtml(cs, { name: 'ישראל ישראלי', nameEn: 'Israel Israeli', office: 'משרד', officeEn: 'Israeli Appraisals' }, TODAY);
  for (const s of ['Real Estate Appraisal Report', 'DRAFT', 'Effective date', 'Comparable sales', 'Mortgage security', 'Sales comparison approach',
    'Israel Israeli', 'Israeli Appraisals', R.DEFAULT_DECLARATION_EN.slice(0, 30), 'Floor']) assert.ok(html.includes(s), 'חסר: ' + s);
  assert.match(html, /<html lang="he" dir="rtl">/);
  const he = R.renderReportHtml({ ...cs, reportLang: 'he' }, { nameEn: 'Israel Israeli' }, TODAY);
  assert.doesNotMatch(he, /Appraisal Report|Israel Israeli|class="en/);
  assert.equal(R.validateCase({ ...base(), reportLang: 'xx' }, TODAY).reportLang, 'he');
  // כל תווית בעברית בדוח שיש לה מקבילה — בלי ערכים ריקים
  assert.ok(Object.values(R.EN).every(v => typeof v === 'string' && v.trim()));
});
