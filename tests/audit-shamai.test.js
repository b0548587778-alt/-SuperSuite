'use strict';
// שמאי — תיקוני בדיקת הקוד 23.10.2026 (ממצאים 14–18 והממצאים הנמוכים): מס רכישה, יומן שזהה למסך, פסיק אלפים,
// ייצוא/ייבוא/מחיקה, נתונים פגומים שלא משביתים את המודול, דוחות, חיפוש, OCR, מע"מ, לוח עברי ושמות קבצים.
// כל הנתונים בדוגמאות בדויים.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { DIR, loadShamai } = require('./helpers/shamai-src');

const BASE = ['core', 'calc', 'explain', 'prices', 'appraise-metals', 'appraise-gems', 'appraise-judaica', 'appraise-other', 'appraise-assets', 'ledger', 'report', 'tools'];
const src = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const j = (v) => JSON.parse(JSON.stringify(v));

// localStorage בזיכרון עם key / length (כמו בדפדפן ובמחסן המוצפן)
function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => { m.delete(String(k)); },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

// קבצים נוספים אחרי הבסיס: טיימרים של חיבור ממשק לא רצים (אין DOM אמיתי)
function load(extra = [], { readyState = 'complete' } = {}) {
  const s = loadShamai(BASE);
  s.ctx.localStorage = memStorage();
  s.run("state.prices = { ...state.prices, gold: 3110.35, silver: 31.1035, usdIls: 4 };");
  s.run('var __toasts = []; toast = (m, t) => { __toasts.push([m, t || ""]); }; var renderHeader = () => {}; var renderDashboard = () => {};');
  s.ctx.setTimeout = () => 0;
  s.ctx.setInterval = () => 0;
  s.ctx.document.readyState = readyState;
  for (const n of extra) vm.runInContext(src(`src/${n}.js`), s.ctx, { filename: n + '.js' });
  return s;
}

const fmt0 = (s, n) => s.run(`fmt0(${n})`);

// ── ממצא 14: מס רכישה ──

test('14: מס רכישה לפי המדרגות — דירה יחידה, דירה נוספת, עולה חדש בלי ניחוש', () => {
  const s = load();
  assert.equal(s.run("calcPurchaseTax(3000000, 'single')"), 45538.33, '3.5% ו-5% במדרגות, לא 0 ₪');
  assert.equal(s.run("calcPurchaseTax(1900000, 'single')"), 0);
  assert.equal(s.run("calcPurchaseTax(3000000, 'additional')"), 240000);
  assert.equal(s.run("calcPurchaseTax(7000000, 'additional')"), 578898.6, '8% עד המדרגה, 10% מעליה — לא 8% קבוע');
  assert.equal(s.run("calcPurchaseTax(3000000, 'new-immigrant')"), null);
  const b = j(s.run("purchaseTaxBreakdown(3000000, 'single')"));
  for (const r of b.rows) assert.ok(Number.isInteger(r.taxAg) && Number.isInteger(r.portionAg), 'אגורות שלמות');
  assert.equal(b.rows.reduce((a, r) => a + r.taxAg, 0), b.taxAg);
  // הטבלה המובנית מסומנת כלא מאומתת, עם שנת תוקף
  assert.equal(s.run('PURCHASE_TAX_TABLE.verified'), false);
  assert.match(s.run('purchaseTaxWarning()'), new RegExp(`${s.run('PURCHASE_TAX_TABLE.year')}.*לא מאומתת`));
  // אין יותר קריאה לשדות שלא קיימים בטבלה
  for (const f of ['src/tools.js', 'src/appraise-assets.js', 'src/calc.js']) assert.doesNotMatch(src(f), /b\.(limit|from)\b/, f);
});

test('14: מסך הנדל"ן וכלי המס מציגים אותו מס, עם אזהרה על הטבלה', () => {
  const s = load();
  const html = s.calc('recalcRealEstate', '#re-result', { '#re-size': 100, '#re-ppsqm': '30000', '#re-floor': 2 });
  const est = s.run('reQuickEstimate(state.realestate).value');
  assert.match(html, new RegExp(`כדירה יחידה: ₪${fmt0(s, s.run(`calcPurchaseTax(${est}, 'single')`))}`));
  assert.match(html, new RegExp(`כדירה נוספת: ₪${fmt0(s, s.run(`calcPurchaseTax(${est}, 'additional')`))}`));
  assert.match(html, /לא מאומתת/);

  const tool = s.calc('recalcPurchaseTax', '#tx-result', { '#tx-value': 3000000, '#tx-status': 'single' });
  assert.match(tool, /₪45,538/);
  assert.match(tool, /לא מאומתת/);
  const imm = s.calc('recalcPurchaseTax', '#tx-result', { '#tx-value': 3000000, '#tx-status': 'new-immigrant' });
  assert.match(imm, /רשות המסים/);
  assert.doesNotMatch(imm, /₪0\b/);
});

// ── ממצא 15: היומן שומר את ההערכה שבמסך ──

test('15: שמירה ליומן — אותו שווי כמו במסך, מעוגל לאגורה (טלפון, אמנות, שטיח, סקראפ, שעון, זהב כסקראפ)', () => {
  const s = load(['appraise-luxury']);
  const saved = (cat) => { s.run(`saveCurrentAsOpp('${cat}')`); return s.run('state.opportunities[0]'); };
  const cents = (n) => assert.equal(Math.round(n * 100) / 100, n, 'מעוגל לאגורה');
  const shown = (html, n) => assert.ok(html.includes('₪' + fmt0(s, n)), 'הסכום שנשמר מוצג במסך');

  s.run("state.phone.brand = 'iphone'; state.phone.condition = 'good'");
  let html = s.calc('recalcPhone', '#ph-result', { '#ph-model': 'דגם בדוי', '#ph-retail': 4000, '#ph-battery': 92, '#ph-warranty': 'active', '#ph-asking': 1500 });
  let o = saved('phone');
  assert.equal(o.estimate, s.run('roundMoney(phoneValue(state.phone).estValue)'));
  shown(html, o.estimate); cents(o.estimate);

  html = s.calc('recalcArt', '#ar-result', { '#ar-artist': 'צייר בדוי', '#ar-market': 10000, '#ar-signed': true, '#ar-frame': true, '#ar-asking': 4000 });
  o = saved('art');
  assert.equal(o.estimate, s.run('roundMoney(artValue(state.art).estValue)'));
  assert.ok(o.estimate > 10000, 'כולל חתימה ומסגרת — לא רק מחיר השוק');
  shown(html, o.estimate);

  html = s.calc('recalcRug', '#rg-result', { '#rg-length': 200, '#rg-width': 150, '#rg-material': 'wool', '#rg-kpsi': 300, '#rg-age': 'antique', '#rg-asking': 9000 });
  o = saved('rug');
  assert.equal(o.estimate, s.run('roundMoney(rugValue(state.rug).estValue)'));
  assert.notEqual(o.estimate, 9000 * 1.5, 'לא "מחיר מבוקש × 1.5"');
  shown(html, o.estimate);

  html = s.calc('recalcScrap', '#sc-result', { '#sc-weight': 50, '#sc-unit': 'kg', '#sc-price-kg': 31.5, '#sc-asking': 1000 });
  o = saved('scrap');
  assert.equal(o.estimate, s.run('roundMoney(scrapValue(state.scrap, state.prices.usdIls).dealerPay)'));
  assert.equal(o.estimate, s.run('roundMoney(50 * 31.5 * SCRAP_TYPES.find(t => t.k === state.scrap.type).dealerMargin)'), 'לפי המחיר לק"ג שהוקלד');
  cents(o.estimate);

  html = s.calc('recalcWatch', '#w-result', { '#w-retail': 40000, '#w-condition': 'good', '#w-papers': 'full', '#w-service': 'medium', '#w-asking': 20000 });
  o = saved('watch');
  assert.equal(o.estimate, s.run('roundMoney(watchValue(state.watch).wholesale)'));
  shown(html, o.estimate);

  s.run("state.gold.metal = 'gold'; state.gold.purity = 0.750; state.gold.asking = 2000");
  s.el('#g-weight').value = '10'; s.el('#g-unit').value = 'g'; s.el('#g-scrap-mode').checked = true;
  o = saved('gold');
  assert.equal(o.estimate, 2100, 'במצב סקראפ — 70% משווי ההתכה (3,000 ₪), כמו במסך');

  s.run("state.wine = { region: 'bordeaux', name: 'יין בדוי', vintage: 2000, score: 95, asking: 500, kosher: true }");
  s.el('#wn-retail').value = '300';
  o = saved('wine');
  assert.equal(o.estimate, s.run("roundMoney(wineValue(state.wine, 300).estValue)"));
  cents(o.asking);
});

// ── ממצא 16: פסיק אלפים ──

test('16: מחיר קנייה ומכירה עם פסיק אלפים — 12,500 ולא 12', async () => {
  const s = load();
  assert.equal(s.run("parseMoneyInput('12,500')"), 12500);
  assert.equal(s.run("parseMoneyInput('₪ 1,234.5')"), 1234.5);
  assert.equal(s.run("parseMoneyInput('99,9')"), 99.9);
  assert.equal(s.run("parseMoneyInput('0')"), null);
  assert.equal(s.run("parseMoneyInput('abc')"), null);
  s.run(`var renderLedger = () => {};
    state.opportunities = [{ id: 'o1', name: 'טבעת בדויה', status: 'watching', category: 'gold', asking: 13000, created: new Date().toISOString() }];
    var __answers = ['12,500', '15,000.50'];
    ssDialog = { prompt: async () => __answers.shift(), confirm: async () => true };`);
  await s.run("oppAction('o1', 'bought')");
  assert.equal(s.run('state.opportunities[0].purchasePrice'), 12500);
  await s.run("oppAction('o1', 'sold')");
  assert.equal(s.run('state.opportunities[0].salePrice'), 15000.5);
  assert.equal(s.run('oppProfit(state.opportunities[0])'), 2500.5);
});

// ── ממצא 17: ייצוא, ייבוא ומחיקה ──

test('17: "מחק את כל הנתונים" שומר את המספור, ולא נוגע במפתחות של מודולים אחרים', () => {
  const s = load(['navigation', 'casefile'], { readyState: 'loading' });
  s.run(`Storage.save('purchaseSeq', 12); Storage.save('caseSeq', 4); Storage.save('reportSeq', 30);
    Storage.save('opportunities', [{ id: 'a', name: 'x' }]); Storage.save('cases', [{ id: 'c' }]); Storage.save('purchases', [{ id: 'p' }]);
    localStorage.setItem('trainer:profile', '{}');`);
  assert.equal(s.run('clearAllShamaiData()'), true);
  assert.equal(s.run("Storage.load('purchaseSeq')"), 12);
  assert.equal(s.run("Storage.load('caseSeq')"), 4);
  assert.equal(s.run("Storage.load('reportSeq')"), 30);
  assert.equal(s.run("Storage.load('opportunities')"), null);
  assert.equal(s.run("Storage.load('cases')"), null);
  assert.equal(s.run("Storage.load('purchases')"), null);
  assert.equal(s.run("localStorage.getItem('trainer:profile')"), '{}');
  // אחרי המחיקה — התיק הבא ממשיך מהמספור ולא חוזר ל-1
  assert.equal(s.run('nextCaseNo()'), 5);
});

test('17: ייבוא בהוספה מדלג על מזהים שכבר בפנקס; הייצוא מוצג כפריטים בלבד, בשם קובץ לפי התאריך המקומי', async () => {
  const s = load(['navigation'], { readyState: 'loading' });
  s.run(`var renderLedger = () => {};
    state.opportunities = [{ id: 'a1', name: 'קיים', status: 'watching', category: 'general', created: '2026-10-01T08:00:00.000Z' }];
    ssDialog = { choose: async () => 'merge', confirm: async () => true };
    var __file = JSON.stringify({ opportunities: [{ id: 'a1', name: 'כפול' }, { id: 'b2', name: 'חדש', asking: 100 }, null, { id: 'b2', name: 'כפול בקובץ' }] });
    var FileReader = function () {}; FileReader.prototype.readAsText = function () { this.onload({ target: { result: __file } }); };`);
  await s.run("importJSON({ target: { files: [{}], value: 'x' } })");
  await new Promise((r) => setImmediate(r));
  const ids = j(s.run('state.opportunities.map(o => o.id)'));
  assert.deepEqual(ids, ['b2', 'a1']);
  assert.equal(s.run("state.opportunities.find(o => o.id === 'a1').name"), 'קיים', 'הקיים לא נדרס');
  assert.deepEqual(j(s.run("Storage.load('opportunities').map(o => o.id)")), ['b2', 'a1']);

  // ייצוא: שם קובץ לפי localToday (לא UTC), וסימון "פריטים" — לא "גיבוי מלא"
  const downloads = [];
  s.ctx.document.createElement = () => { const a = { click() { downloads.push(a.download); } }; return a; };
  s.ctx.Blob = function (parts) { this.text = parts.join(''); s.ctx.__lastBlob = this.text; };
  s.ctx.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
  s.run('exportJSON(); exportCSV();');
  const today = s.run('localToday()');
  assert.deepEqual(downloads, [`shamai-items-${today}.json`, `shamai-${today}.csv`]);
  const html = src('index.html');
  assert.doesNotMatch(html, /גיבוי מלא \(JSON\)/);
  assert.match(html, /בלי תיקי שמאות, שטרות קנייה, מספור ותמונות/);
  // גם ה-QR אינו גיבוי ושחזור — רק פריטי הפנקס והמחירים (סקירה)
  assert.doesNotMatch(html, /QR לגיבוי|QR לשחזור/);
  const qrCard = html.slice(html.indexOf('id="btn-show-qr"') - 700, html.indexOf('id="qr-container"'));
  assert.match(qrCard, /לא גיבוי מלא/);
  assert.match(qrCard, /העברת פריטי הפנקס ב-QR/);
  assert.doesNotMatch(src('src/navigation.js'), /toISOString\(\)\.split\('T'\)/);
});

// ── ממצא 18: נתונים פגומים לא משביתים את המודול ──

test('18: פריטים פגומים מסוננים — null, טיפוסים שגויים, מזהה כפול, שדות זדוניים', () => {
  const s = load();
  s.run(`var __r = sanitizeOpportunities([null, 5, 'x', [], { name: '' }, { name: '  ' },
    { id: 'ok1', name: 'טבעת', asking: '12', status: 'stolen', category: 'nope', seller: 7, details: [['a', 'b'], 'bad'], tags: ['t', 3],
      __proto__: { polluted: true }, authReport: { category: 'gold', score: '80', verdict: 'מקורי', results: { q1: 'pass', 'x y': 'fail' } } },
    { id: 'ok1', name: 'כפול' }, { id: 'a b c', name: 'מזהה לא תקין' }])`);
  const r = j(s.run('__r'));
  assert.equal(r.items.length, 2);
  assert.equal(r.skipped, 7);
  const [a, b] = r.items;
  assert.equal(a.id, 'ok1');
  assert.equal(a.asking, 12);
  assert.equal(a.status, 'watching');
  assert.equal(a.category, 'general');
  assert.equal(a.seller, '');
  assert.deepEqual(a.details, [['a', 'b']]);
  assert.deepEqual(a.tags, ['t']);
  assert.deepEqual(a.authReport, { category: 'gold', score: 80, verdict: 'מקורי', results: { q1: 'pass' } });
  assert.equal(s.run('({}).polluted'), undefined);
  assert.match(b.id, /^[\w-]+$/);
  assert.notEqual(b.id, 'a b c');
});

test('18: שחזור מקוד QR עם {"opps":[null]} — לא נשמר; פריטים תקינים נשמרים בלבד', async () => {
  const s = load(['misc']);
  vm.runInContext(src('lib/lz-string.min.js'), s.ctx, { filename: 'lz-string.min.js' });
  s.run(`ssDialog = { confirm: async () => true }; Storage.save('opportunities', [{ id: 'keep', name: 'קיים' }]);
    state.opportunities = Storage.load('opportunities');`);
  const code = (data) => s.run(`LZString.compressToEncodedURIComponent(${JSON.stringify(JSON.stringify(data))})`);
  await s.run(`restoreFromCode(${JSON.stringify(code({ opps: [null] }))})`);
  assert.deepEqual(j(s.run("Storage.load('opportunities').map(o => o.id)")), ['keep'], 'לא נשמר כלום');
  assert.match(s.run('__toasts[__toasts.length - 1][0]'), /שחזור נכשל: אין בקוד פריטים תקינים/);

  await s.run(`restoreFromCode(${JSON.stringify(code({ opps: [null, { id: 'n1', name: 'שעון בדוי', asking: 500 }] }))})`);
  assert.deepEqual(j(s.run("Storage.load('opportunities').map(o => o.id)")), ['n1']);
  // קוד פגום — הודעה בעברית, לא שגיאת JSON באנגלית
  await s.run(`restoreFromCode(${JSON.stringify(s.run("LZString.compressToEncodedURIComponent('{bad')"))})`);
  assert.match(s.run('__toasts[__toasts.length - 1][0]'), /^שחזור נכשל: [^A-Za-z]+$/);
});

test('18: עלייה עם פריט פגום שכבר נשמר — הנתונים מסוננים והמסך הראשי מתרנדר', () => {
  const s = load(['navigation', 'widgets', 'dashboard'], { readyState: 'loading' });
  s.run(`Storage.save('opportunities', [null, { id: 'g1', name: 'זהב בדוי', status: 'watching', asking: 100, estimate: 150 }, 'x']);
    Storage.save('settings', 'לא אובייקט');`);
  s.run('loadSavedState()');
  assert.deepEqual(j(s.run('state.opportunities.map(o => o.id)')), ['g1']);
  assert.equal(s.run('typeof state.settings.theme'), 'string', 'הגדרות שאינן אובייקט — לא נפרסות');
  s.el('#reminders-list').querySelector = () => null;
  // renderDashboard האמיתי (dashboard.js) מתרנדר; עם [null] בלי סינון הוא נופל — וכך נפלה העלייה לפני bindEvents
  assert.doesNotThrow(() => s.run('renderDashboard()'));
  s.run('state.opportunities = [null];');
  assert.throws(() => s.run('renderDashboard()'));
});

// ── ממצאים נמוכים ──

test('נמוך: טיוטת תיק — לכל פריט שנכשל השגיאה שלו, לא הראשונה ליד כולם', () => {
  const s = loadShamai(['core', 'calc', 'prices', 'ledger', 'report', 'purchase', 'casefile', 'case-report']);
  s.run(`var P = { gold: 3110.35, usdIls: 4, source: 'manual', meta: {} };
    var c = newCase(1, '2026-10-19');
    c.items = [
      Object.assign(newCaseItem(), { desc: 'פריט ראשון', metals: [], override: '9000' }),
      Object.assign(newCaseItem(), { desc: 'פריט תקין', metals: [{ metal: 'gold', purityPpt: 585, grams: '5' }] }),
      Object.assign(newCaseItem(), { desc: 'פריט שלישי', metals: [{ metal: 'gold', purityPpt: 123, grams: '5' }] }) ];`);
  const errs = j(s.run('caseTotals(c, P).errors'));
  assert.equal(errs.length, 2);
  assert.notEqual(errs[0], errs[1]);
  const html = s.run("buildCaseReportHtml(c, P, {}, {}, {}, '2026-10-19')");
  const warnOf = (desc) => html.match(new RegExp(`${desc}</h3><p class="warn">([^<]*)</p>`))[1];
  assert.equal(warnOf('פריט ראשון'), s.run('caseEsc')(errs[0]));
  assert.equal(warnOf('פריט שלישי'), s.run('caseEsc')(errs[1]));
});

test('נמוך: מספר הדוח בדוח המודפס עובר escape', () => {
  const s = load();
  s.ctx.__opp = { id: 'o1', category: 'gold', name: 'טבעת', estimate: 3000, asking: 2500, details: [] };
  const out = s.run(`buildReportHtml(__opp, loadAppraiser(), null, '01/01/2026', '<img src=x onerror=alert(1)>')`);
  assert.doesNotMatch(out, /<img src=x/);
  assert.equal((out.match(/&lt;img src=x/g) || []).length >= 2, true, 'בכותרת ובתחתית');
  // מספר מקובץ מיובא שאינו שלם חיובי — לא נלקח, ונקבע מספר חדש
  s.run("Storage.save('reportSeq', 5); var __o = { reportNo: '<b>' };");
  assert.equal(s.run('reportNumberFor(__o)'), 6);
});

test('נמוך: סדר ידני — הפנקס מוצג בסדר הגרירה ולא "חדש קודם"', () => {
  const s = load(['opp-extras']);
  s.run(`state.opportunities = [
      { id: 'x1', name: 'ישן', status: 'watching', category: 'general', created: '2026-01-01T08:00:00.000Z', manualOrder: 0 },
      { id: 'x2', name: 'חדש', status: 'watching', category: 'general', created: '2026-10-01T08:00:00.000Z', manualOrder: 1 } ];
    state.ledger.sort = 'manual'; renderLedger();`);
  const list = s.el('#opp-list').innerHTML;
  assert.ok(list.indexOf('data-id="x1"') < list.indexOf('data-id="x2"'), 'בסדר הרשימה');
  s.run("state.ledger.sort = 'newest'; renderLedger();");
  const newest = s.el('#opp-list').innerHTML;
  assert.ok(newest.indexOf('data-id="x2"') < newest.indexOf('data-id="x1"'));
});

test('נמוך: חיפוש כללי ואנשי קשר — הפנקס באמת מסונן (state.ledger.search)', () => {
  const s = load(['opp-extras', 'widgets', 'contacts']);
  const views = [];
  s.ctx.switchView = (v) => views.push(v);
  s.run(`state.opportunities = [
    { id: 'p1', name: 'חנוכייה בדויה', status: 'watching', category: 'antique', seller: 'משה כהן 050-1234567', asking: 900, created: '2026-10-01T08:00:00.000Z' },
    { id: 'p2', name: 'שעון בדוי', status: 'watching', category: 'watch', seller: '', asking: 500, created: '2026-10-02T08:00:00.000Z' } ];`);
  s.run("var __res = performGlobalSearch('עתיקה'); __res.find(r => r.type === 'opp').action();");
  assert.equal(s.run('state.ledger.search'), 'חנוכייה בדויה', 'לפי שם הפריט — החיפוש בפנקס לא כולל את שם הקטגוריה');
  assert.equal(s.el('#opp-search').value, 'חנוכייה בדויה');
  assert.deepEqual(views, ['ledger']);

  // "עסקאות" של איש קשר — לפי המפתח שלו (טלפון), לא לפי השם
  const handlers = [];
  const btn = { dataset: { act: 'contact-deals', contact: '' }, addEventListener: (ev, fn) => handlers.push(fn) };
  s.ctx.document.querySelectorAll = (sel) => (sel === '.contact-actions button' ? [btn] : []);
  btn.dataset.contact = s.run('getContactsFromOpps()[0].id');
  s.run("state.ledger.search = '';");
  s.run('renderContactsView()');
  handlers[0]();
  assert.equal(s.run('state.ledger.sellerKey'), '0501234567');
  assert.equal(s.run('state.ledger.search'), '', 'הסינון לפי המפתח, לא טקסט חופשי');
  assert.equal(s.el('#opp-search').value, 'משה כהן 0501234567', 'השדה מראה את מי מסננים');
});

// הפנקס האמיתי (renderLedger) אחרי לחיצה: רק מזהי הכרטיסים שמוצגים
const shownIds = (s) => [...s.el('#opp-list').innerHTML.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i);

test('review: "עסקאות" של איש קשר — לפי הטלפון: לא מוכר אחר באותו שם פרטי, כן אותו טלפון בכתיב אחר', () => {
  const s = load(['opp-extras', 'contacts']);
  s.ctx.switchView = (v) => { if (v === 'ledger') s.run('renderLedger()'); };
  s.run(`state.opportunities = [
    { id: 'k1', name: 'חנוכייה בדויה', status: 'watching', category: 'antique', seller: 'משה כהן 050-1111111', asking: 900, created: '2026-10-01T08:00:00.000Z' },
    { id: 'l1', name: 'שעון בדוי', status: 'watching', category: 'watch', seller: 'משה לוי 052-2222222', asking: 500, created: '2026-10-02T08:00:00.000Z' },
    { id: 'k2', name: 'טבעת בדויה', status: 'sold', category: 'gold', seller: '0501111111', asking: 300, created: '2026-10-03T08:00:00.000Z' },
    { id: 'n1', name: 'ספר בדוי', status: 'watching', category: 'book', seller: 'יעקב', asking: 100, created: '2026-10-04T08:00:00.000Z' } ];`);
  const handlers = [];
  const btns = [];
  s.ctx.document.querySelectorAll = (sel) => (sel === '.contact-actions button' ? btns : []);
  const contacts = j(s.run('getContactsFromOpps()'));
  const cohen = contacts.find((c) => c.id === '0501111111');
  assert.equal(cohen.deals.length, 2, 'אותו טלפון בכתיב אחר — אותו איש קשר');
  for (const c of contacts) {
    const btn = { dataset: { act: 'contact-deals', contact: c.id } };
    btn.addEventListener = (ev, fn) => handlers.push([c.id, fn]);
    btns.push(btn);
  }
  s.run('renderContactsView()');
  const click = (id) => handlers.find(([k]) => k === id)[1]();

  click('0501111111');
  assert.deepEqual(shownIds(s).sort(), ['k1', 'k2'], 'בלי העסקה של משה לוי, עם העסקה בלי השם');
  click('0522222222');
  assert.deepEqual(shownIds(s), ['l1']);
  // מוכר בלי טלפון — לפי הטקסט
  click('יעקב');
  assert.deepEqual(shownIds(s), ['n1']);

  // הקלדה בשדה החיפוש מבטלת את הסינון לפי איש קשר (navigation.js)
  const nav = src('src/navigation.js');
  assert.match(nav, /'#opp-search'\)\?\.addEventListener\('input'[\s\S]{0,200}state\.ledger\.sellerKey = null/);
  // חיפוש כללי אחרי איש קשר — המפתח מתאפס
  s.run("showLedgerSearch('שעון בדוי')");
  assert.equal(s.run('state.ledger.sellerKey'), null);
  assert.deepEqual(shownIds(s), ['l1']);
});

test('review: חיפוש כללי מאפס את מסנני המצב והקטגוריה — הפריט שנבחר מוצג', () => {
  const s = load(['opp-extras', 'widgets', 'contacts']);
  s.ctx.switchView = (v) => { if (v === 'ledger') s.run('renderLedger()'); };
  const filterBtns = ['all', 'watching', 'bought', 'sold'].map((f) => {
    const cls = new Set(f === 'sold' ? ['active'] : []);
    return { dataset: { filter: f }, classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) } };
  });
  s.ctx.document.querySelectorAll = (sel) => (sel === '.filter-btn' ? filterBtns : []);
  s.run(`state.opportunities = [
    { id: 'w1', name: 'פמוטים בדויים', status: 'watching', category: 'antique', seller: '', asking: 900, created: '2026-10-01T08:00:00.000Z' },
    { id: 's1', name: 'שעון בדוי', status: 'sold', category: 'watch', seller: '', asking: 500, salePrice: 700, created: '2026-10-02T08:00:00.000Z' } ];
    state.ledger.filter = 'sold'; state.ledger.catFilter = 'watch';`);
  s.run("performGlobalSearch('פמוטים').find(r => r.type === 'opp').action()");
  assert.equal(s.run('state.ledger.filter'), 'all');
  assert.equal(s.run('state.ledger.catFilter'), null);
  assert.deepEqual(shownIds(s), ['w1'], 'לא "אין התאמות"');
  assert.deepEqual(filterBtns.filter((b) => b.classList.contains('active')).map((b) => b.dataset.filter), ['all'], 'הכפתור הפעיל מתעדכן');
});

test('נמוך: OCR הוסר כולו — אין כפתור, אין טעינה של lib/tesseract ואין עיצוב יתום', () => {
  assert.doesNotMatch(src('index.html'), /btn-ocr-cert|OCR/);
  assert.doesNotMatch(src('src/ocr-prices.js'), /tesseract\.min|scanGIACertificate|loadTesseract/);
  assert.doesNotMatch(src('sw.js'), /tesseract/i);
  assert.doesNotMatch(src('style.css'), /\.ocr-/);
  assert.ok(!fs.existsSync(path.join(DIR, 'lib', 'tesseract')));
});

test('נמוך: מע"מ לפי שיעור שהמשתמש הגדיר — אין 17% קבוע; נדל"ן — רק המחיר למ"ר שהוקלד', async () => {
  const s = load(['widgets']);
  s.run("var __asked = 0; ssDialog = { prompt: async () => { __asked++; return '18'; } }; calcState.display = '100';");
  await s.run("calcQuick('vat')");
  assert.equal(s.run('calcState.display'), '118');
  assert.equal(s.run('state.settings.vatPct'), 18);
  assert.equal(s.run("Storage.load('settings').vatPct"), 18);
  s.run("calcState.display = '200';");
  await s.run("calcQuick('vat')");
  assert.equal(s.run('calcState.display'), '236');
  assert.equal(s.run('__asked'), 1, 'השיעור נשמר — לא שואלים שוב');
  for (const f of ['src/widgets.js', 'src/ocr-prices.js']) assert.doesNotMatch(src(f), /1\.17\b|17%/, f);

  const s2 = load(['navigation', 'ocr-prices'], { readyState: 'loading' });
  s2.run("state.realestate.pricePerSqm = 27500;");
  const re = s2.run("getLivePriceBanner('realestate')");
  assert.match(re, /₪27,500/);
  assert.doesNotMatch(re, /תל אביב|ירושלים|חיפה|פריפריה/);
  assert.doesNotMatch(s2.run("getLivePriceBanner('vehicle')"), /מע"מ/);
});

test('נמוך: פרשת השבוע וחגים מהלוח העברי — גם אחרי 26.12.2026, ו-3.10.2026 הוא שמיני עצרת', () => {
  const s = load(['widgets']);
  const parsha = (y, m, d) => s.run(`getCurrentParsha(new Date(${new Date(y, m - 1, d, 10).getTime()}))`);
  const known = [
    [2025, 10, 18, 'בראשית'], [2025, 3, 22, 'ויקהל'], [2025, 4, 12, 'צו'], [2025, 9, 20, 'נצבים'], [2025, 9, 27, 'וילך'],
    [2026, 3, 14, 'ויקהל-פקודי'], [2026, 4, 4, 'שבת חול המועד פסח'], [2026, 4, 18, 'תזריע-מצורע'], [2026, 5, 23, 'נשא'],
    [2026, 7, 11, 'מטות-מסעי'], [2026, 7, 18, 'דברים'], [2026, 9, 5, 'נצבים-וילך'], [2026, 9, 19, 'האזינו'],
    [2026, 10, 3, 'שמיני עצרת ושמחת תורה'], [2026, 10, 10, 'בראשית'], [2026, 10, 24, 'לך לך'],
    [2022, 4, 23, 'אחרי מות'], [2022, 7, 23, 'מטות'], [2022, 7, 30, 'מסעי'], [2018, 5, 5, 'בהר'], [2018, 5, 12, 'בחקתי'],
    [2027, 9, 25, 'נצבים-וילך'], [2027, 10, 9, 'האזינו'],
  ];
  for (const [y, m, d, name] of known) assert.equal(parsha(y, m, d), name, `${d}.${m}.${y}`);
  // יום חול — הפרשה של השבת הקרובה
  assert.equal(parsha(2026, 10, 22), 'לך לך');

  // בכל שנה עברית 5780–5800: לכל שבת שאינה מועד יש פרשה, ומבראשית עד נצבים — כל פרשה פעם אחת, לפי הסדר
  const all = j(s.run('PARSHIYOT'));
  for (let hy = 5780; hy <= 5800; hy++) {
    const rh = s.run(`hebNewYear(Date.UTC(${hy - 3761}, 9, 15, 12))`);
    const map = j(s.run(`[...hebParshaYear(${rh}).entries()]`));
    const seq = [];
    let reachedBereshit = false;
    for (const [, name] of map) {
      assert.ok(name, `${hy}: שבת בלי שם`);
      if (name === 'בראשית') reachedBereshit = true;
      if (!reachedBereshit) continue;
      for (const part of name.split('-')) if (all.includes(part)) seq.push(part);
    }
    assert.deepEqual(seq.slice(0, 51), all.slice(0, 51), `שנה ${hy}`);
    assert.ok(seq.length === 51 || (seq.length === 52 && seq[51] === 'וילך'), `שנה ${hy}: ${seq.length}`);
  }

  const h = j(s.run(`getJewishHolidays(new Date(${new Date(2026, 9, 23, 10).getTime()}))`));
  assert.equal(h.name, 'חנוכה');
  assert.equal(h.daysAway, 43);
  assert.equal(j(s.run(`getJewishHolidays(new Date(${new Date(2026, 8, 1, 10).getTime()}))`)).name, 'ראש השנה');
  assert.doesNotMatch(src('src/widgets.js'), /PARSHA_SCHEDULE|JEWISH_HOLIDAYS|'2026-12-26'/);
});

test('נמוך: מטבע זהב או כסף בלי משקל — "לא הוזן משקל" עם אזהרה, לא "לא ממתכת יקרה"', () => {
  const s = load();
  const gold = s.calc('recalcCoin', '#cn-result', { '#cn-metal': 'gold', '#cn-weight': '', '#cn-asking': '' });
  assert.match(gold, /לא הוזן משקל/);
  assert.match(gold, /class="explain-missing"/);
  assert.doesNotMatch(gold, /לא ממתכת יקרה/);
  const other = s.calc('recalcCoin', '#cn-result', { '#cn-metal': 'other', '#cn-weight': '', '#cn-asking': '' });
  assert.match(other, /לא ממתכת יקרה/);
  assert.doesNotMatch(other, /class="explain-missing"/);
});
