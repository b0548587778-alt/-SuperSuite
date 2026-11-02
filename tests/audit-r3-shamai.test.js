'use strict';
// שמאי — תיקוני סקירת הקוד 2.11.2026 (סבב 3): ערך מנופח ומחירים שנראים עדכניים, מסכי ההערכה, תיקים ושטרות,
// הפנקס, ייבוא וייצוא CSV. כל הנתונים בדוגמאות בדויים. תאריכים מוזרקים — לא תלויים ביום הריצה.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { DIR, loadShamai } = require('./helpers/shamai-src');

const BASE = ['core', 'calc', 'explain', 'prices', 'appraise-metals', 'appraise-gems', 'appraise-judaica', 'appraise-other', 'ledger', 'tools', 'navigation', 'appraise-assets', 'misc', 'report', 'purchase', 'casefile', 'case-report', 'case-ui', 'authenticity', 'opp-extras'];
const src = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const j = (v) => JSON.parse(JSON.stringify(v));

// localStorage בזיכרון עם key / length; fail — כתיבה שהמחסן דוחה (כמו המחסן המוצפן במצב צפייה בלבד)
function memStorage() {
  const m = new Map();
  const st = {
    fail: false,
    getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => { if (st.fail) { const e = new Error('השינוי לא נשמר: צפייה בלבד'); e.name = 'SecurityError'; throw e; } m.set(String(k), String(v)); },
    removeItem: (k) => { m.delete(String(k)); },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
  return st;
}

// כל הקבצים הנחוצים, בלי טיימרים ובלי רינדור של לוח הבקרה
function load() {
  const s = loadShamai(['core', 'calc', 'explain', 'prices', 'appraise-metals', 'appraise-gems', 'appraise-judaica', 'appraise-other', 'ledger', 'tools']);
  s.ctx.localStorage = memStorage();
  s.ctx.setTimeout = () => 0;
  s.ctx.setInterval = () => 0;
  s.ctx.document.readyState = 'loading';
  s.run('var renderHeader = () => {}; var renderDashboard = () => {};');
  for (const n of BASE.slice(10)) vm.runInContext(src(`src/${n}.js`), s.ctx, { filename: n + '.js' });
  s.run(`var __toasts = []; toast = (m, t) => { __toasts.push([m, t || '']); }; renderHeader = () => {}; renderDashboard = () => {};
    var __printed = []; openPrintPreview = (h) => __printed.push(h);`);
  return s;
}

// ── ממצא בינוני: ערך מנופח ──

test('מטבע: "אין פרמיה" (0) נשאר 0 — השווי הוא ערך ההתכה, וגם בפנקס', () => {
  const s = load();
  s.run("state.prices = { ...state.prices, gold: 3110.35, usdIls: 4 }; state.coin.grade = 'XF';");
  s.calc('recalcCoin', '#cn-result', { '#cn-metal': 'gold', '#cn-weight': 7.98, '#cn-purity': 917, '#cn-premium': '0', '#cn-asking': 3000 });
  assert.equal(s.run('state.coin.premium'), 0, 'פעם || 1.5 הפך את 0 ל-×1.5');
  const v = j(s.run('coinValue(state.coin, state.prices)'));
  assert.ok(v.meltIls > 0);
  assert.equal(v.value, v.meltIls, 'בלי פרמיה — ערך ההתכה בלבד');
  assert.equal(v.maxPurchase, v.meltIls * 0.65);
  s.run("saveCurrentAsOpp('coin')");
  assert.equal(s.run('state.opportunities[0].estimate'), s.run('roundMoney(coinValue(state.coin, state.prices).value)'));
  // ערך לא תקין — ברירת המחדל ×1.5
  s.calc('recalcCoin', '#cn-result', { '#cn-premium': '' });
  assert.equal(s.run('state.coin.premium'), 1.5);
});

test('מחירים: עדכון שער הדולר בלבד לא הופך את הזהב והכסף של ברירת המחדל ל"עודכנו היום"', () => {
  const s = load();
  const today = '2026-10-19';
  s.run(`var P0 = { ...DEFAULT_PRICES, lastUpdate: null, source: 'default' };
    var P1 = applyPriceUpdate(P0, { usdIls: 3.7 }, { date: '${today}', source: 'manual', today: '${today}' }).prices;`);
  assert.equal(s.run(`priceFreshness(P1, 'usdIls', '${today}').state`), 'fresh');
  assert.equal(s.run(`priceFreshness(P1, 'gold', '${today}').state`), 'unknown', 'זהב שלא עודכן — עדיין ערך ייחוס');
  assert.equal(s.run(`priceDateOf(P1, 'silver')`), null);
  assert.equal(s.run(`priceSummary(P1, '${today}').state`), 'unknown', 'האזהרה לא נעלמת');
  // שטר הקנייה מדפיס "(ערך ייחוס)" לזהב, לא את התאריך של היום
  const snap = j(s.run(`createPurchase({ seller: { name: 'בדוי', idNumber: '123456782' }, lines: [{ metal: 'gold', purityPpt: 583, grams: '1' }] }, { no: 1, today: '${today}', prices: P1 }).prices`));
  assert.equal(snap.gold.date, null);
  assert.equal(snap.usdIls.date, today);
  // נתונים מגרסה קודמת, בלי meta בכלל — עדיין לפי lastUpdate
  s.run(`var OLD = { gold: 4600, source: 'manual', lastUpdate: new Date(2026, 9, 15, 10).toISOString() };`);
  assert.equal(s.run(`priceDateOf(OLD, 'gold')`), '2026-10-15');
});

// ── שמאי: QR, תיקים, שטרות ──

test('QR / קובץ: מחיר בלי תאריך או ממקור ברירת מחדל מדולג, ומחיר מקומי מאותו יום לא נדרס', () => {
  const s = load();
  const today = '2026-10-19';
  s.run(`var LOCAL = applyPriceUpdate({ ...DEFAULT_PRICES }, { gold: 4700 }, { date: '${today}', source: 'manual', today: '${today}' }).prices;
    var INCOMING = { ...DEFAULT_PRICES, gold: 4500, silver: 80, usdIls: 3.7, source: 'manual', lastUpdate: '${today}T08:00:00.000Z',
      meta: { usdIls: { date: '2026-10-18', source: 'manual' }, gold: { date: '${today}', source: 'manual' }, silver: { date: '${today}', source: 'default' } } };
    var R = restorePrices(LOCAL, INCOMING, { today: '${today}' });`);
  assert.equal(s.run('R.prices.gold'), 4700, 'הזהב שהוקלד היום כאן גובר');
  assert.equal(s.run('R.prices.silver'), 75, 'כסף ממקור "ברירת מחדל" — מדולג');
  assert.equal(s.run('R.prices.usdIls'), 3.7);
  assert.equal(s.run('R.prices.meta.usdIls.date'), '2026-10-18', 'התאריך מהגיבוי, לא היום');
  assert.equal(s.run('R.prices.platinum'), s.run('DEFAULT_PRICES.platinum'));
  assert.equal(s.run('R.prices.meta.platinum'), undefined, 'פלטינה בלי תאריך — לא "עודכנה היום"');
  assert.equal(s.run(`priceFreshness(R.prices, 'platinum', '${today}').state`), 'unknown');
});

test('גרסה מתוקנת: הדוח שהונפק נשמר בהיסטוריה (עותק עמוק) וניתן להדפסה חוזרת, עם פרטי השמאי מזמן ההנפקה', () => {
  const s = load();
  const D = '2026-10-19';
  s.run(`var P = { gold: 3110.35, silver: 31.1035, usdIls: 4, source: 'manual', meta: { gold: { date: '${D}', source: 'manual' }, usdIls: { date: '${D}', source: 'manual' } } };
    Storage.save('appraiser', { name: 'השמאי הראשון', business: 'עסק א' });
    var c = Object.assign(newCase(7, '${D}'), { client: { name: 'שרה לוי', idNumber: '123456782', phone: '050-0000000' },
      items: [{ id: 'i1', category: 'jewelry', desc: 'טבעת', photos: ['ph1'], metals: [{ metal: 'gold', purityPpt: 585, grams: '5' }], stones: [], labour: '', other: '' }] });
    var f = finalizeCase(c, P, '${D}', { appraiser: loadAppraiser(), appraiserEn: loadAppraiserEn() });
    var r = reopenCase(f);`);
  assert.equal(s.run('f.frozen.appraiser.name'), 'השמאי הראשון');
  assert.equal(s.run('r.status'), 'draft');
  assert.equal(s.run('r.history.length'), 1);
  // עריכת הגרסה המתוקנת לא משנה את העותק שבהיסטוריה
  s.run("r.items[0].desc = 'טבעת אחרת'; r.items[0].metals[0].grams = '9';");
  const v = j(s.run('caseHistoryVersion(r, 0)'));
  assert.equal(v.status, 'final');
  assert.equal(v.items[0].desc, 'טבעת');
  assert.equal(v.frozen.totalAg, s.run('f.frozen.totalAg'));
  assert.equal(v.no, 7);
  assert.deepEqual(v.history, []);
  assert.deepEqual(j(s.run('[...caseHistoryPhotoIds(r)]')), ['ph1'], 'התמונה של הגרסה שהונפקה שמורה מפני מחיקה');
  // השמאי החליף פרטים — ההדפסה החוזרת עדיין עם הפרטים מזמן ההנפקה
  s.run("Storage.save('appraiser', { name: 'שמאי חדש' }); showCaseReport(caseHistoryVersion(r, 0)); showCaseReport(f);");
  for (const h of j(s.run('__printed'))) {
    assert.match(h, /השמאי הראשון/);
    assert.doesNotMatch(h, /שמאי חדש/);
  }
  // תיק ישן בלי עותק — אין גרסה להדפסה (ולא קורס)
  assert.equal(s.run(`caseHistoryVersion({ history: [{ rev: 0, reportDate: '${D}', totalAg: 1 }] }, 0)`), null);
  assert.match(src('src/case-ui.js'), /data-hist-rev/);
});

test('שטר קנייה: הדפסה חוזרת עם פרטי השמאי מזמן ההפקה', async () => {
  const s = load();
  const D = '2026-10-19';
  s.run(`state.prices = { gold: 3110.35, silver: 31.1035, usdIls: 4, source: 'manual', meta: { gold: { date: '${D}', source: 'manual' } } };
    state.opportunities = []; localToday = () => '${D}';
    Storage.save('appraiser', { name: 'שמאי בזמן הקנייה' });
    ssDialog = { confirm: async () => true }; renderPurchaseView();`);
  s.el('#pu-name').value = 'יוסף אברהמי';
  s.el('#pu-id').value = '123456782';
  s.el('#pu-pay').value = 'transfer';
  s.run("state.purchase.lines[0].grams = '2'; state.purchase.lines[0].purityPpt = '583';");
  await s.run('savePurchase()');
  assert.equal(s.run("Storage.load('purchases')[0].appraiser.name"), 'שמאי בזמן הקנייה');
  s.run("Storage.save('appraiser', { name: 'שמאי אחר' });");
  assert.equal(s.run("purchaseAppraiser(Storage.load('purchases')[0]).name"), 'שמאי בזמן הקנייה');
  assert.match(s.run("buildPurchaseHtml(Storage.load('purchases')[0], purchaseAppraiser(Storage.load('purchases')[0]))"), /שמאי בזמן הקנייה/);
  // שטר ישן בלי עותק — הפרטים הנוכחיים
  assert.equal(s.run("purchaseAppraiser({ no: 1 }).name"), 'שמאי אחר');
});

test('מועד קובע בעבר: אזהרה כשתאריך המחיר רחוק מהמועד הקובע', () => {
  const s = load();
  s.run(`var P = { gold: 3110.35, usdIls: 4, meta: { gold: { date: '2026-10-19', source: 'manual' }, usdIls: { date: '2026-08-31', source: 'manual' } } };
    var c = Object.assign(newCase(1, '2026-10-19'), { effectiveDate: '2026-09-01', items: [{ metals: [{ metal: 'gold', purityPpt: 585, grams: '5' }], stones: [] }] });`);
  const w = j(s.run('casePriceDateWarnings(c, P)'));
  assert.equal(w.length, 1, 'הדולר מיום לפני המועד — בטווח; הזהב — 48 ימים אחרי');
  assert.match(w[0], /^זהב: המחיר מ-19\.10\.2026, 48 ימים אחרי המועד הקובע \(1\.9\.2026\)/);
  s.run("c.effectiveDate = '2026-10-18';");
  assert.deepEqual(j(s.run('casePriceDateWarnings(c, P)')).length, 1, 'עכשיו הדולר רחוק מהמועד');
  // האזהרה מגיעה גם לחלון הנעילה ולסיכום הטיוטה
  s.run('state.prices = P;');
  assert.ok(j(s.run('priceWarningsFor(c)')).some(x => /המועד הקובע/.test(x)));
});

test('פנקס: עריכת פריט מאפסת את מצב התמונה מהפריט הקודם', async () => {
  const s = load();
  s.el('#new-opp-form').querySelector = () => ({});
  s.run(`pendingPhoto = 'data:image/png;base64,AAAA'; photoRemoved = true;
    openEditOpp({ id: 'b', name: 'פריט ב', asking: 100, category: 'gold', hasPhoto: false });`);
  assert.equal(s.run('pendingPhoto'), null, 'פעם התמונה של פריט א נשמרה על פריט ב');
  assert.equal(s.run('photoRemoved'), false, 'פעם התמונה של פריט ב נמחקה');
  assert.equal(s.el('#no-photo-preview').hidden, true);
});

test('פנקס: רינדור לא מאפס את הקטגוריה בטופס עריכה פתוח', () => {
  const s = load();
  // כמו בדפדפן: החלפת האפשרויות מחזירה את הבחירה לראשונה
  const sel = s.el('#no-cat');
  let html = '';
  Object.defineProperty(sel, 'innerHTML', { get: () => html, set: (v) => { html = v; sel.value = 'general'; }, configurable: true });
  s.el('#opp-list').querySelectorAll = () => [];
  s.run(`state.opportunities = [{ id: 'a', name: 'טבעת', status: 'watching', category: 'gold', asking: 100, estimate: 150, created: '2026-10-01T08:00:00.000Z' }];`);
  sel.value = 'diamond';
  s.run('renderLedger()');
  assert.equal(sel.value, 'diamond');
});

test('ייבוא JSON / QR: מספור הדוחות ממשיך מעל המספרים המיובאים, ובהחלפה תמונות הפריטים הישנים נמחקות', async () => {
  const s = load();
  vm.runInContext(src('lib/lz-string.min.js'), s.ctx, { filename: 'lz-string.min.js' });
  s.run(`renderLedger = () => {};
    Storage.save('reportSeq', 3); Storage.save('img_opp_old', 'data:image/png;base64,AAAA'); Storage.save('img_opp_same', 'data:image/png;base64,BBBB');
    state.opportunities = [{ id: 'old', name: 'ישן', status: 'watching', hasPhoto: true }, { id: 'same', name: 'נשאר', status: 'watching', hasPhoto: true }];
    Storage.save('opportunities', state.opportunities);
    ssDialog = { choose: async () => 'replace', confirm: async () => true };
    var __file = JSON.stringify({ opportunities: [{ id: 'n1', name: 'מיובא', asking: 100, reportNo: 12 }, { id: 'same', name: 'נשאר', asking: 50, hasPhoto: true }] });
    var FileReader = function () {}; FileReader.prototype.readAsText = function () { this.onload({ target: { result: __file } }); };`);
  await s.run("importJSON({ target: { files: [{}], value: 'x' } })");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(j(s.run('state.opportunities.map(o => o.id)')), ['n1', 'same']);
  assert.equal(s.run("Storage.load('reportSeq')"), 12, 'הדוח הבא — 13, לא 4');
  assert.equal(s.run("reportNumberFor(state.opportunities[1])"), 13);
  assert.equal(s.run("Storage.load('img_opp_old')"), null, 'תמונה של פריט שהוחלף — נמחקה');
  assert.ok(s.run("Storage.load('img_opp_same')"), 'תמונה של פריט שנשאר — נשמרת');

  // QR — אותו טיפול
  s.run(`Storage.save('img_opp_n1', 'data:image/png;base64,CCCC'); state.opportunities[0].hasPhoto = true;`);
  const code = s.run(`LZString.compressToEncodedURIComponent(${JSON.stringify(JSON.stringify({ opps: [{ id: 'q1', name: 'מ-QR', asking: 10, reportNo: 40 }] }))})`);
  await s.run(`restoreFromCode(${JSON.stringify(code)})`);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(j(s.run("Storage.load('opportunities').map(o => o.id)")), ['q1']);
  assert.equal(s.run("Storage.load('reportSeq')"), 40);
  assert.equal(s.run("Storage.load('img_opp_n1')"), null);
});

// ── ייבוא וייצוא: CSV של הפנקס ──

test('ייצוא CSV של הפנקס: הגנת נוסחאות כמו בכלכלה, ורווח מעוגל לאגורה', () => {
  const s = load();
  let csv = '';
  s.ctx.document.createElement = () => ({ click() {} });
  s.ctx.Blob = function (parts) { csv = parts.join(''); };
  s.ctx.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
  s.run(`state.opportunities = [
    { id: 'a', name: '=HYPERLINK("http://x","לחץ")', status: 'watching', asking: 0.1, estimate: 0.3, seller: '+972-50', notes: '@SUM(A1)', created: '2026-10-01T08:00:00.000Z' },
    { id: 'b', name: 'הפסד', status: 'watching', asking: 100, estimate: 50, seller: '-cmd', created: '2026-10-01T08:00:00.000Z' }];
    exportCSV();`);
  const rows = csv.replace(/^﻿/, '').split('\n');
  assert.match(rows[1], /^"a","'=HYPERLINK\(""http:\/\/x"",""לחץ""\)"/, 'נוסחה מנוטרלת בגרש');
  assert.match(rows[1], /"'\+972-50"/);
  assert.match(rows[1], /"'@SUM\(A1\)"/);
  assert.match(rows[1], /"0\.2"/, 'רווח 0.2 — לא 0.19999999999999998');
  assert.doesNotMatch(csv, /0\.1999|0\.2000000/);
  assert.match(rows[2], /"-50"/, 'מספר שלילי פשוט — בלי גרש');
  assert.match(rows[2], /"'-cmd"/);
  assert.equal(s.run('oppProfit({ asking: 0.1, estimate: 0.3 })'), 0.2);
});

// ── מסכי הערכה ──

test('מטבע מנחושת או ממתכת אחרת: השווי ממחיר שוק שהוקלד, לא ₪0 קבוע', () => {
  const s = load();
  const v = j(s.run("coinValue({ metal: 'copper', weight: 10, premium: 50, grade: 'XF', market: 800 }, state.prices)"));
  assert.ok(v.value > 0, 'פעם תמיד ₪0, גם עם ×50');
  assert.equal(v.value, 800 * s.run("findMult(COIN_GRADES, 'XF')"));
  // בלי מחיר שוק — הודעה מה חסר
  const html = s.calc('recalcCoin', '#cn-result', { '#cn-metal': 'other', '#cn-weight': '', '#cn-market': '', '#cn-asking': '' });
  assert.match(html, /דרוש מחיר שוק/);
  const html2 = s.calc('recalcCoin', '#cn-result', { '#cn-metal': 'copper', '#cn-market': 800, '#cn-asking': 300 });
  assert.match(html2, /מחיר שוק שהוקלד/);
  s.run("saveCurrentAsOpp('coin')");
  assert.ok(s.run('state.opportunities[0].estimate') > 0);
  assert.match(src('index.html'), /<label for="cn-market">/);
});

test('גרוטאות: נחושת ואלומיניום נגזרים מהמחיר בלוח המחירים, לא מקבוע', () => {
  const s = load();
  s.run('state.prices = { ...state.prices, usdIls: 4, copper: 4.20, aluminum: 1.10 };');
  const base = s.run("scrapValue({ type: 'copper-bare', weight: 100, unit: 'kg' }, state.prices).marketValue");
  const brass = s.run("scrapValue({ type: 'brass', weight: 100, unit: 'kg' }, state.prices).marketValue");
  const iron = s.run("scrapValue({ type: 'iron', weight: 100, unit: 'kg' }, state.prices).marketValue");
  const alu = s.run("scrapValue({ type: 'aluminum-cans', weight: 100, unit: 'kg' }, state.prices).marketValue");
  s.run('state.prices.copper = 5.88; state.prices.aluminum = 2.20;');
  assert.ok(Math.abs(s.run("scrapValue({ type: 'copper-bare', weight: 100, unit: 'kg' }, state.prices).marketValue") - base * 1.4) < 1e-6, 'נחושת +40% בלוח ← +40%');
  assert.ok(Math.abs(s.run("scrapValue({ type: 'brass', weight: 100, unit: 'kg' }, state.prices).marketValue") - brass * 1.4) < 1e-6);
  assert.ok(Math.abs(s.run("scrapValue({ type: 'aluminum-cans', weight: 100, unit: 'kg' }, state.prices).marketValue") - alu * 2) < 1e-6);
  assert.equal(s.run("scrapValue({ type: 'iron', weight: 100, unit: 'kg' }, state.prices).marketValue"), iron, 'ברזל — ערך ייחוס קבוע');
  // המסך והפנקס — אותו ערך
  s.run("state.scrap = { type: 'copper-bare', weight: 100, unit: 'kg', priceKg: null, asking: 500 }; saveCurrentAsOpp('scrap');");
  assert.equal(s.run('state.opportunities[0].estimate'), s.run('roundMoney(scrapValue(state.scrap, state.prices).dealerPay)'));
  assert.doesNotMatch(src('index.html'), /מחיר בורסה רשמי/);
});

test('יהלום: משקל בין מדרגות המחיר (0.995, 1.495 קראט) מקבל מחיר', () => {
  const s = load();
  const d = "{ color: 'D', clarity: 'IF', cut: 'EX', shape: 'round', fluor: 'NONE', cert: 'GIA', origin: 'natural' }";
  const v1 = j(s.run(`diamondValue(${d}, 0.995, 4)`));
  const v2 = j(s.run(`diamondValue(${d}, 1.495, 4)`));
  assert.ok(v1 && v1.retailUsd > 0, '0.995 — פעם null בלי הודעה');
  assert.ok(v2 && v2.retailUsd > 0);
  assert.equal(s.run('diamondBracket(0.995).price'), 6800);
  assert.equal(s.run('diamondBracket(1.495).price'), 9500);
  assert.equal(s.run('diamondBracket(1.0).price'), 9500);
  assert.equal(s.run('diamondBracket(0.2)'), null);
  // ובמסך — תוצאה, לא ריק
  assert.match(s.calc('recalcDiamond', '#d-result', { '#d-carat': 1.495, '#d-asking': '' }), /מחיר קמעונאי/);
});

test('רכב משנת הייצור הנוכחית: גיל שנה לפחות — בלי קנס קילומטראז\' על כל קילומטר; המסך והפנקס זהים', () => {
  const s = load();
  const v = j(s.run("vehicleValue({ brand: 'toyota', condition: 'good', hand: '1', year: 2026, km: 5000, list: 100000 }, 2026)"));
  assert.notEqual(v.kmMult, 0.85, '5,000 ק"מ ברכב חדש — לא חריגה');
  assert.equal(v.kmMult, 1.05);
  const older = j(s.run("vehicleValue({ brand: 'toyota', condition: 'good', hand: '1', year: 2025, km: 5000, list: 100000 }, 2026)"));
  assert.ok(v.estValue >= older.estValue, 'רכב חדש לא מוערך מתחת לרכב בן שנה');
  const year = s.run('new Date().getFullYear()');
  const html = s.calc('recalcVehicleAppraisal', '#veh-result', { '#veh-year': year, '#veh-km': 5000, '#veh-hand': '1', '#veh-list': 100000, '#veh-asking': 90000 });
  s.run("saveCurrentAsOpp('vehicle')");
  const est = s.run('state.opportunities[0].estimate');
  assert.equal(est, s.run('roundMoney(vehicleValue(state.vehicleAppraisal).estValue)'));
  assert.match(html.replace(/,/g, ''), new RegExp('₪' + s.run(`fmt0(${est})`).replace(/,/g, '')));
});

test('ממיר המטבעות: אירו וליש"ט לפי השערים בלוח, בלי הטענה על API', () => {
  const s = load();
  s.run('state.prices = { ...state.prices, usdIls: 3.6, eurIls: 4.2, gbpIls: 4.8 };');
  s.el('#cu-amount').value = '100';
  s.el('#cu-from').value = 'EUR';
  s.el('#cu-to').value = 'ILS';
  s.run('recalcCurrency()');
  assert.match(s.el('#cu-result').innerHTML, /420\.00 ILS/, '100 אירו × 4.2');
  s.el('#cu-from').value = 'GBP';
  s.run('recalcCurrency()');
  assert.match(s.el('#cu-result').innerHTML, /480\.00 ILS/);
  assert.doesNotMatch(s.el('#cu-result').innerHTML, /API|בזמן אמת/);
  assert.doesNotMatch(src('src/tools.js'), /מעודכן בזמן אמת מ-API/);
});

test('בדיקת אותנטיות: ציון 0 ניתן לשמירה, ושמירה שנדחתה לא מוחקת את רשימת הבדיקה', async () => {
  const s = load();
  let save = null;
  const btn = s.el('#btn-auth-save');
  btn.addEventListener = (t, fn) => { save = fn; };
  const cat = s.run('Object.keys(AUTH_CHECKLISTS).find(k => AUTH_CHECKLISTS[k].items.filter(i => i.critical).length >= 2)');
  s.run(`currentAuthCategory = '${cat}'; authResults = {};
    AUTH_CHECKLISTS['${cat}'].items.filter(i => i.critical).slice(0, 2).forEach(i => { authResults[i.id] = 'fail'; });
    renderAuthChecker();`);
  assert.match(s.el('#auth-view').innerHTML, />0<span>%/);
  assert.match(s.el('#auth-view').innerHTML, /btn-auth-save/, 'פעם הכפתור הוצג רק לציון מעל 0');
  assert.ok(save);
  s.run("ssDialog = { prompt: async () => 'שעון בדוי' }; state.opportunities = [];");
  s.ctx.localStorage.fail = true;
  await save();
  assert.equal(s.run('state.opportunities.length'), 0, 'לא נשמר — לא נשאר בפנקס');
  assert.equal(s.run('Object.keys(authResults).length'), 2, 'הבדיקה לא נמחקה');
  s.ctx.localStorage.fail = false;
  await save();
  assert.equal(s.run("Storage.load('opportunities')[0].authReport.score"), 0);
  assert.equal(s.run('Object.keys(authResults).length'), 0);
});
