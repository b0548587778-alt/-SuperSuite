// אחידות חזותית בין המסכים והמודולים (רגרסיות מסקירת צילומי המסכים).
// המודול הכלכלי: ממשק המודול (modules/econ/ui) רץ ב-vm עם DOM מדומה ונבדק מה המשתמש רואה.
// שמאות ואימונים: בדיקות סטטיות לקבצי הסגנון והתבנית (המודולים אינם נטענים ב-Node).
const test = require('node:test');
const { shamaiSource } = require('./helpers/shamai-src');
const EconUI = require('./helpers/econ-ui');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const UI_SRC = EconUI.source();
const HTML = read('modules/econ/views/index.html');
const VIEWS = [...new Set([...HTML.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]))];

function fakeElement(id = '', extra = {}) {
  const listeners = {};
  return Object.assign({
    id, textContent: '', value: '', innerHTML: '', style: {}, dataset: {}, disabled: false, hidden: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); }, _listeners: listeners,
    appendChild() {}, append() {}, querySelector() { return fakeElement(); }, querySelectorAll() { return []; },
    setAttribute() {}, focus() {}, remove() {}
  }, extra);
}
async function settle(n = 14) { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); }

async function makeHarness(responses = {}) {
  const elements = {};
  const systemAPI = new Proxy({}, {
    get(_t, name) {
      if (name === 'authStatus') return () => Promise.resolve({ user: { id: 'u1' }, configured: true });
      return () => {
        if (name in responses) return Promise.resolve(responses[name]);
        if (/^get(Invoices|Products|Chart|Journal|PersonalEntries)$/.test(name)) return Promise.resolve([]);
        return Promise.resolve({});
      };
    }
  });
  const navButtons = VIEWS.map(view => fakeElement('', { dataset: { view } }));
  const document = {
    readyState: 'complete',
    getElementById(id) { return (elements[id] ||= fakeElement(id)); },
    querySelector() { return fakeElement(); },
    querySelectorAll(sel) { return sel === '.nav' ? navButtons : []; },
    addEventListener() {}, createElement() { return fakeElement(); }, body: fakeElement()
  };
  const context = { document, console, setTimeout, clearTimeout, Date, Intl };
  context.window = context;
  context.window.systemAPI = systemAPI;
  vm.createContext(context);
  EconUI.run(context);
  await settle();
  return { elements, navButtons };
}
async function goTo(h, view) {
  const i = VIEWS.indexOf(view);
  assert.ok(i >= 0, `התצוגה ${view} קיימת בניווט`);
  h.navButtons[i]._listeners.click[0]();
  await settle();
}

// ---------- המודול הכלכלי ----------

test('כפתור "הוספת רשומה" מוסתר (ולא רק דהוי) במסך בלי טופס, וחוזר במסך עם טופס', async () => {
  const h = await makeHarness();
  await goTo(h, 'finance');
  assert.equal(h.elements.addBtn.disabled, true);
  assert.equal(h.elements.addBtn.hidden, true, 'כפתור מושבת לא מוצג');
  await goTo(h, 'acct-journal');
  assert.equal(h.elements.addBtn.disabled, false);
  assert.equal(h.elements.addBtn.hidden, false);
});

test('תוכנית חשבונות — טבלה אחת מקובצת לפי סוג, לא כרטיס לכל חשבון', async () => {
  const chart = [
    { code: '1000', name: 'קופה ובנק', type: 'asset' },
    { code: '1100', name: 'לקוחות', type: 'asset' },
    { code: '4000', name: 'הכנסות ממכירות', type: 'revenue' }
  ];
  const h = await makeHarness({ getChart: chart });
  await goTo(h, 'acct-chart');
  const html = h.elements.view.innerHTML;
  assert.equal((html.match(/<table/g) || []).length, 1);
  assert.equal((html.match(/class="card/g) || []).length, 1, 'כרטיס אחד בלבד');
  assert.match(html, /נכס \(2\)/);
  assert.match(html, /הכנסה \(1\)/);
  assert.ok(html.indexOf('נכס (2)') < html.indexOf('הכנסה (1)'), 'הסדר לפי סוג החשבון');
});

test('כושר ובריאות ריק — הודעת "אין רשומות" אחת ולא ארבע', async () => {
  const h = await makeHarness({ getFitnessData: { workouts: [], nutrition: [], metrics: [] } });
  await goTo(h, 'fitness');
  const html = h.elements.view.innerHTML;
  assert.equal((html.match(/אין רשומות/g) || []).length, 1);
  assert.doesNotMatch(html, /אימונים \(0\)/);
});

test('כושר ובריאות עם נתונים — שלושת האזורים מוצגים', async () => {
  const h = await makeHarness({ getFitnessData: { workouts: [{ id: 'w1', type: 'הליכה', duration: 30, date: '2026-10-01' }], nutrition: [], metrics: [] } });
  await goTo(h, 'fitness');
  const html = h.elements.view.innerHTML;
  assert.match(html, /אימונים \(1\)/);
  assert.match(html, /תזונה \(0\)/);
  assert.match(html, /מדדים \(0\)/);
});

test('מסך ההגדרות: אותו שם בסרגל האחיד ובסרגל הפנימי', () => {
  const catalog = require('../shell/catalog');
  const m = [, (catalog.ITEMS.find(x => x.key === 'econ:settings') || {}).name];
  assert.ok(m[1], 'פריט ההגדרות קיים בקטלוג');
  const nav = HTML.match(/data-view="settings">[^<]*<span>([^<]+)<\/span>/);
  assert.equal(nav[1], m[1]);
});

test('סכום אפס אינו נצבע כחיובי (ירוק)', () => {
  assert.doesNotMatch(UI_SRC, /< 0 \? 'neg' : 'pos'/, 'צביעה לפי סימן עוברת דרך tone()');
  assert.doesNotMatch(UI_SRC, /> 0 \? 'neg' : 'pos'/);
  assert.doesNotMatch(UI_SRC, /class="kpi pos"/, 'גם כרטיס "חיובי" קבוע עובר דרך tone()');
  const def = UI_SRC.match(/const tone = (\(v\) => [^;]+);/);
  assert.ok(def);
  const tone = vm.runInNewContext(def[1]);
  assert.equal(tone(0), '');
  assert.equal(tone(5), 'pos');
  assert.equal(tone(-5), 'neg');
});

test('שדות במסכים מעוצבים כמו בטפסים, וכרטיסים מיושרים לימין', () => {
  const css = read('modules/econ/styles.css');
  assert.match(css, /#view select, #view textarea/);
  assert.match(css, /\.card \{ text-align: start; \}/);
  assert.match(css, /\.kpis > \.kpi \{ flex: 1 1 130px/);
});

// ---------- שמאות ----------

test('שמאות: פס "התקן את שמאי" מוסתר כשהמאפיין hidden מוגדר', () => {
  const css = read('modules/shamai/style.css');
  assert.match(css, /\.install-banner\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
  assert.match(read('modules/shamai/index.html'), /id="install-banner" hidden/);
});

test('שמאות: אין כפתורי ענן ואין "מחירים חיים" (התוכנה אופליין)', () => {
  const html = read('modules/shamai/index.html');
  const js = shamaiSource();
  assert.doesNotMatch(html, /btn-cloud-upload|btn-cloud-download|העלה לענן/);
  assert.doesNotMatch(html + js, /מחירי שוק חיים|שווקים חיים|"העלה לענן"/);
});

test('שמאות: ערכה בהירה כברירת מחדל, ברוחב שולחני', () => {
  const js = shamaiSource();
  assert.match(js, /localStorage\.getItem\('shamai_theme'\) \|\| 'light'/);
  assert.doesNotMatch(read('modules/shamai/style.css'), /max-width: 720px/);
});

// ---------- אימונים ----------

test('אימונים: ערכת הצבעים של התוכנה נטענת אחרי ה-CSS המהודר', () => {
  const html = read('modules/trainer/index.html');
  const bundle = html.match(/href="\/assets\/(index-[^"]+\.css)"/);
  assert.ok(bundle, 'קובץ ה-CSS המהודר מקושר');
  const at = html.indexOf('/suite-theme.css');
  assert.ok(at > html.indexOf(bundle[0]), 'ערכת הצבעים אחרי ה-CSS המהודר (כדי לגבור עליו)');
  assert.ok(fs.existsSync(path.join(ROOT, 'modules/trainer/suite-theme.css')));
});

test('אימונים: כל מחלקת צבע כהה בחבילה המהודרת ממופה בערכת הצבעים', () => {
  const html = read('modules/trainer/index.html');
  const bundleCss = read('modules/trainer/assets/' + html.match(/href="\/assets\/(index-[^"]+\.css)"/)[1]);
  const theme = read('modules/trainer/suite-theme.css');
  // המחלקות שקובעות את המראה הכהה: רקע/גבול כהים (slate 600–950), טקסט בהיר (slate 100–600) ואינדיגו.
  // גוונים שכבר מתאימים לרקע בהיר (גבול slate-200, טקסט slate-900 — בתצוגת ההדפסה) אינם נדרשים.
  const classes = [...new Set(bundleCss.match(/\.(?:hover\\:|focus\\:)?(?:(?:bg|border)-slate-(?:[6-9]00|950)|text-slate-[1-6]00|(?:bg|border|text)-indigo-[0-9]{2,3})(?:\\\/[0-9]+)?/g) || [])];
  assert.ok(classes.length > 10);
  const missing = classes.filter(c => !theme.includes(c));
  assert.deepEqual(missing, [], 'מחלקות שלא מופו (בנייה חדשה של המודול?)');
});

// ---------- סבב שני ----------

test('שדה החיפוש: מירכאות בטקסט (דוא"ל) לא קוטעות את ה-placeholder', async () => {
  const h = await makeHarness({ getContacts: { contacts: [] } });
  await goTo(h, 'contacts');
  const html = h.elements.view.innerHTML;
  assert.match(html, /placeholder="חיפוש לפי שם, דוא&quot;ל או חברה\.\.\."/);
});

test('לוח הבקרה: שמות המודולים כמו בסרגל, ותוויות הספירה תואמות למה שנספר', () => {
  assert.match(UI_SRC, /<strong>שמאות נכסים<\/strong>/);
  assert.match(UI_SRC, /<strong>ניהול אימונים<\/strong>/);
  assert.doesNotMatch(UI_SRC, /<strong>TrainerPro<\/strong>/);
  assert.match(UI_SRC, /<p>הכנסות: \$\{finance\?\.incomes\?\.length/);
  assert.doesNotMatch(UI_SRC, /<p>נכסים: \$\{finance\?\.incomes/);
  assert.match(UI_SRC, /<p>באיחור: \$\{tasks\?\.tasks\?\.filter\(t => t\.isOverdue\)/);
});

test('רשת הכרטיסים ממלאת כל שורה, וכותרות האזורים באותו צבע', () => {
  const css = read('modules/econ/styles.css');
  assert.match(css, /\.acct-grid \{ display: flex; flex-wrap: wrap;/);
  assert.match(css, /\.acct-grid > \.acct-wide \{ flex-basis: 100%; \}/);
  assert.match(css, /\.acct-header h3 \{ color:/);
});

test('גמ"ח: כותרות ההלוואות וההפקדות עטופות ב-acct-header', () => {
  assert.match(UI_SRC, /<div class="acct-header">\s*<h3>הלוואות \(\$\{loans\.length\}\)<\/h3>/);
  assert.match(UI_SRC, /<div class="acct-header"><h3>הפקדות \(\$\{deposits\.length\}\)<\/h3>/);
});

test('שמאות: אנליטיקה ריקה מסתירה את כותרות האזורים; שינוי 0 אינו חץ ירוק', () => {
  const html = read('modules/shamai/index.html');
  const js = shamaiSource();
  assert.match(html, /<div id="analytics-details">[\s\S]*id="analytics-history"[\s\S]*<\/div>/);
  assert.match(js, /\$\('#analytics-details'\)\.hidden = true;/);
  assert.match(js, /\$\('#analytics-details'\)\.hidden = false;/);
  assert.doesNotMatch(js, /d\.change >= 0 \? '▲'/);
  assert.match(js, /ערך ייחוס/);
});

test('אימונים: פס הגלילה ותיבת המידע בגרפים בצבעים בהירים', () => {
  const theme = read('modules/trainer/suite-theme.css');
  // מאז 7.1 — דרך משתני שפת העיצוב (רקע בהיר / משטח לבן)
  assert.match(theme, /::-webkit-scrollbar-track \{ background: var\(--ss-bg\); \}/);
  assert.match(theme, /\.recharts-default-tooltip \{ background: var\(--ss-surface\) !important;/);
});

test('ברכת השעה זהה במעטפת ובמודול השמאות בכל שעה (בעבר 05:00–06:00: "בוקר טוב" מול "לילה טוב")', () => {
  const shellFn = read('shell/shell.js').match(/function greeting\(h\) \{[\s\S]*?\n\}/);
  assert.ok(shellFn, 'greeting במעטפת');
  const shellGreeting = vm.runInNewContext(`(${shellFn[0]})`);
  const block = shamaiSource().match(/let greet = [\s\S]*?greet = 'לילה טוב';/);
  assert.ok(block, 'חישוב הברכה במודול השמאות');
  const shamaiGreeting = vm.runInNewContext(`(hr) => { ${block[0]} return greet; }`);
  for (let h = 0; h < 24; h++) assert.equal(shamaiGreeting(h), shellGreeting(h), 'שעה ' + h);
});

// ---------- שפת עיצוב אחת (PLAN.md 7.1) ----------
const TOKENS = read('shell/design-tokens.css');
const TOKEN_NAMES = new Set([...TOKENS.matchAll(/(--ss-[a-z0-9-]+)\s*:/g)].map(m => m[1]));
const STYLED = ['shell/shell.html', 'modules/econ/styles.css', 'modules/tools/index.html', 'modules/trainer/suite-theme.css', 'modules/shamai/style.css'];
const ECON_UI = () => fs.readdirSync(path.join(ROOT, 'modules/econ/ui')).map(f => 'modules/econ/ui/' + f);
// חריגים מתועדים: בורר צבע (input type=color חייב hex), theme-color של הדפדפן, צבע מסמכים שהמשתמש מקליד,
// צבעי תוויות בהודעות (נשמרים בנתונים), ודיו החתימה על הקנבס
const HEX_ALLOWED = [/type="color"/, /name="theme-color"/, /brandColor/, /CHAT_COLORS/, /strokeStyle = '#/];
const hexLines = (text) => text.split(/\r?\n/).map((l, i) => [i + 1, l])
  .filter(([, l]) => /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/.test(l) && !HEX_ALLOWED.some(r => r.test(l)));

test('שפת עיצוב: אין צבע קבוע מחוץ ל-design-tokens.css (סגנונות וממשק המודול הכלכלי)', () => {
  for (const f of [...STYLED, ...ECON_UI()]) {
    const bad = hexLines(read(f)).map(([n, l]) => n + ': ' + l.trim().slice(0, 90));
    assert.deepEqual(bad, [], f + ' — צבע חדש מוסיפים ל-shell/design-tokens.css ומשתמשים ב-var(--ss-...)');
  }
});

test('שפת עיצוב: כל var(--ss-...) מוגדר בקובץ', () => {
  for (const f of [...STYLED, ...ECON_UI()]) {
    const missing = [...read(f).matchAll(/var\((--ss-[a-z0-9-]+)/g)].map(m => m[1]).filter(n => !TOKEN_NAMES.has(n));
    assert.deepEqual([...new Set(missing)], [], f);
  }
});

test('שפת עיצוב: הקובץ נטען לפני כל סגנון אחר בכל מסך, ו-main.js מגיש רק אותו מהמעטפת', () => {
  const first = (html, href) => {
    const i = html.indexOf(href);
    assert.ok(i > 0, href);
    assert.ok(!/<style[\s>]|rel="stylesheet" href="(?!\/?design-tokens)/.test(html.slice(0, i)), 'לפני כל סגנון אחר: ' + href);
  };
  first(read('shell/shell.html'), 'href="design-tokens.css"');
  first(read('modules/econ/views/index.html'), 'href="/design-tokens.css"');
  first(read('modules/tools/index.html'), 'href="/design-tokens.css"');
  const shamai = read('modules/shamai/index.html');
  assert.ok(shamai.indexOf('href="/design-tokens.css"') > 0 && shamai.indexOf('href="/design-tokens.css"') < shamai.indexOf('href="style.css"'));
  assert.match(read('modules/trainer/suite-theme.css'), /^@import url\("\/design-tokens\.css"\);/);
  assert.match(read('shell/shell.html'), /style-src 'self' 'unsafe-inline'/);
  assert.match(read('main.js'), /if \(rel === '\/design-tokens\.css'\) return net\.fetch\(pathToFileURL\(path\.join\(__dirname, 'shell', 'design-tokens\.css'\)\)/);
  const apk = read('android/build-apk.js');
  assert.match(apk, /copyFileSync\(path\.join\(ROOT, 'shell', 'design-tokens\.css'\), path\.join\(dst, 'design-tokens\.css'\)\)/);
  assert.match(apk, /'shell\.js', 'design-tokens\.css'[\],]/);
});

test('שפת עיצוב: שמאות — המצב הכהה והמצב הבהיר שניהם מהקובץ', () => {
  const css = read('modules/shamai/style.css');
  assert.match(css, /:root \{\s*--bg: var\(--ss-dark-bg\);/);
  assert.match(css, /\[data-theme="light"\] \{\s*--bg: var\(--ss-bg\);/);
});

test('צילומי מסך: --shots שומר תמונה לכל מסך (רק בבדיקת עלייה)', async () => {
  const Smoke = require('../shell/smoke');
  assert.equal(Smoke.shotsDir(['x', '--shots=C:/tmp/a']), 'C:/tmp/a');
  assert.equal(Smoke.shotsDir(['--smoke']), null);
  const written = {};
  const fakeFs = { writeFileSync: (p, d) => { written[p] = d; }, mkdirSync() {} };
  let code = null;
  const s = Smoke.createSmoke({ fs: fakeFs, path, dir: 'D', dialog: {}, exit: (c) => { code = c; }, setTimer: (fn, ms) => { if (ms < Smoke.TIMEOUT_MS) fn(); return {}; }, shots: 'S' });
  await s.run(() => ({}), ['shell', 'econ'], async () => {}, async (id) => (id === 'econ' ? { toPNG: () => Buffer.from('png') } : Buffer.from('raw')));
  assert.equal(String(written[path.join('S', 'econ.png')]), 'png');
  assert.equal(String(written[path.join('S', 'shell.png')]), 'raw');
  assert.equal(code, 0);
});
