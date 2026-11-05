// מהדורות (shell/edition.js, docs/SPLIT-3-PRODUCTS-PLAN.md): עמותות / נדל"ן ועסקים / חשבונאות / מלאה.
// ההרשאה בפועל = מהדורה ∩ רישיון ∩ תפקיד. האכיפה בשרת (gate.js ← runGuarded), לא רק הסתרה במסך.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const Edition = require('../shell/edition');
const LG = require('../shell/licensing/gate');
const offer = require('../shell/licensing/offer');

// טעינה מחדש של קבצי המעטפת שקוראים את המהדורה בזמן הטעינה (catalog / tasks / onboarding / intents)
function freshShell(id) {
  Edition._setForTests(id);
  for (const f of ['catalog', 'tasks', 'onboarding', 'intents', 'simple-mode']) delete require.cache[require.resolve('../shell/' + f)];
  return {
    CAT: require('../shell/catalog'), T: require('../shell/tasks'), OB: require('../shell/onboarding'),
    I: require('../shell/intents'), S: require('../shell/simple-mode'),
  };
}
test.afterEach(() => Edition._setForTests('full'));

// כל הערוצים שה-preload של המודול הכלכלי חושף (כולל ערוצי מס"ב שנבנים בתבנית)
function preloadChannels() {
  const src = fs.readFileSync(path.join(ROOT, 'modules/econ/preload.js'), 'utf8');
  const out = new Set([...src.matchAll(/invoke\('([a-zA-Z]+:[a-zA-Z-]+)'/g)].map(m => m[1]));
  for (const p of ['npo', 'gemach']) for (const a of ['saveMasavSettings', 'createMasavFile', 'importMasavReturns', 'closeMasavBatch', 'cancelMasavBatch']) out.add(`${p}:${a}`);
  // shell:* — ערוצי main.js (המעטפת), לא של המודול הכלכלי; נבדקים שם (nav-guard, MODULE_CHANNELS)
  return [...out].filter(ch => !ch.startsWith('shell:'));
}
const prefixOf = (ch) => ch.split(':')[0];
const UNLICENSED = { mode: 'unlicensed' };

test('במאגר המהדורה היא תמיד "מלאה" — הבנייה כותבת את edition-id.js, לא commit', () => {
  assert.equal(require('../shell/edition-id'), 'full');
  assert.equal(Edition.current().id, 'full');
});

test('הגדרות המהדורות: מודולים, מסכים, תכונות ופרופילים קיימים באמת', () => {
  const CAT = require('../shell/catalog');
  const allViews = new Set(CAT.ALL_GROUPS.flatMap(g => g.items).filter(i => i.mod === 'econ').map(i => i.view));
  const OB = require('../shell/onboarding');
  const appIds = new Set();
  for (const id of Edition.IDS) {
    const ed = Edition.get(id);
    assert.ok(ed.name.startsWith('SuperSuite'), id);
    assert.match(ed.appId, /^com\.bunimseller\.supersuite(\.[a-z]+)?$/, id);
    assert.ok(!appIds.has(ed.appId), 'appId כפול: ' + id); appIds.add(ed.appId);
    if (id === 'full') continue;
    for (const m of ed.mods) assert.ok(['econ', 'shamai', 'tools'].includes(m), id + ': ' + m);
    for (const v of ed.views) assert.ok(allViews.has(v), id + ': מסך לא קיים ' + v);
    for (const f of ed.features) assert.ok(offer.FEATURES.includes(f), id + ': תכונה לא קיימת ' + f);
    for (const p of ed.profiles) assert.ok(OB.ALL_PROFILES.some(x => x.id === p), id + ': פרופיל ' + p);
    assert.match(ed.color, /^#[0-9a-f]{6}$/);
  }
  for (const v of Edition.COMMON_VIEWS) assert.ok(allViews.has(v), v);
  // המלאה שומרת על המזהה ותיקיית הנתונים של היום — לקוח קיים לא מרגיש שינוי
  assert.equal(Edition.get('full').appId, require('../package.json').build.appId);
});

test('החלוקה שאישר הבעלים: כל תחום במהדורה הנכונה, וכל מסך בקטלוג שייך לפחות למהדורה חלקית אחת', () => {
  const has = (id, view) => Edition.viewAllowed(view, Edition.get(id));
  for (const v of ['npo', 'gemach', 'chesed', 'people']) { assert.ok(has('npo', v)); assert.ok(!has('realty', v) && !has('acct', v), v); }
  for (const v of ['realty', 'realestate', 'mortgage-advisor', 'mortgage-lab', 'mortgage']) { assert.ok(has('realty', v)); assert.ok(!has('npo', v) && !has('acct', v), v); }
  for (const v of ['acct-journal', 'acct-reports', 'acct-bank', 'biz-reports', 'acct-chart', 'personal-finance', 'acct-personal', 'finance']) {
    assert.ok(has('acct', v)); assert.ok(!has('npo', v) && !has('realty', v), v);
  }
  assert.ok(Edition.modAllowed('shamai', Edition.get('realty')));
  assert.ok(!Edition.modAllowed('shamai', Edition.get('npo')) && !Edition.modAllowed('shamai', Edition.get('acct')));
  for (const id of Edition.IDS) assert.ok(Edition.modAllowed('tools', Edition.get(id)), 'ארגז הכלים בכל מהדורה');
  // מנוע החשבוניות בכל מהדורה (החלטת הבעלים) — מסך החשבוניות והגדרות העסק קיימים בשלוש
  for (const id of Edition.PARTIAL_IDS) for (const v of ['acct-invoices', 'acct-settings']) assert.ok(has(id, v), id + ' ' + v);
  const CAT = require('../shell/catalog');
  const orphan = CAT.ALL_GROUPS.flatMap(g => g.items).filter(it => !Edition.PARTIAL_IDS.some(id => Edition.keyAllowed(CAT.keyOf(it), Edition.get(id))));
  assert.deepEqual(orphan.map(i => CAT.keyOf(i)), [], 'מסך שלא שויך לאף מהדורה');
});

test('כל תחילית ערוץ של המודול הכלכלי משויכת: משותפת או לפחות מהדורה חלקית אחת (ערוץ חדש — לשייך)', () => {
  const prefixes = [...new Set(preloadChannels().map(prefixOf))];
  assert.ok(prefixes.length > 25);
  const orphan = prefixes.filter(p => !Edition.COMMON_PREFIXES.includes(p) && !Edition.PARTIAL_IDS.some(id => Edition.get(id).prefixes.includes(p)));
  assert.deepEqual(orphan, []);
  for (const id of Edition.PARTIAL_IDS) for (const p of Edition.get(id).prefixes) assert.ok(prefixes.includes(p) || p === 'financial', id + ': ' + p);
});

test('gate: כל ערוץ × כל מהדורה — נחסם בהודעה בעברית בדיוק כשהתחום אינו במהדורה, גם בלי רישוי', () => {
  const channels = preloadChannels();
  assert.ok(channels.length > 300, 'נמצאו הערוצים (' + channels.length + ')');
  for (const ch of channels) assert.equal(LG.checkChannel(UNLICENSED, ch, 'data.view'), null, 'המלאה: ' + ch);
  for (const id of Edition.PARTIAL_IDS) {
    Edition._setForTests(id);
    const ed = Edition.current();
    for (const ch of channels) {
      const [p, a] = ch.split(':');
      const expectOpen = Edition.COMMON_PREFIXES.includes(p) || ed.prefixes.includes(p) || (p === 'acct' && ed.backstage && Edition.ACCT_BACKSTAGE.includes(a));
      const msg = LG.checkChannel(UNLICENSED, ch, 'data.view');
      if (expectOpen) assert.equal(msg, null, id + ': ' + ch);
      else assert.equal(msg, `התחום הזה אינו חלק מ-${ed.name}`, id + ': ' + ch);
    }
  }
});

test('מהדורה ∩ רישיון: רישיון מלא לא פותח תחום של מהדורה אחרת; רישיון חסר סוגר גם במהדורה', () => {
  const all = { mode: 'licensed', status: 'active', features: [...offer.FEATURES] };
  Edition._setForTests('npo');
  assert.match(LG.checkChannel(all, 'rlty:getOverview', 'data.view'), /אינו חלק מ-SuperSuite עמותות/);
  assert.match(LG.checkChannel(all, 'acct:getJournal', 'data.view'), /אינו חלק/);
  assert.equal(LG.checkChannel(all, 'npo:getOverview', 'data.view'), null);
  assert.equal(LG.moduleAllowed(all, 'shamai'), false);
  assert.equal(LG.moduleAllowed(UNLICENSED, 'shamai'), false, 'גם בלי רישוי');
  assert.equal(LG.viewAllowed(UNLICENSED, 'econ', 'acct-journal'), false);
  assert.equal(LG.viewAllowed(UNLICENSED, 'econ', 'licensing'), true, 'מסך הרישוי תמיד');
  assert.equal(LG.featureOpen(all, 'econ.accounting'), false);
  assert.equal(LG.shellState(all).modules.shamai, false);
  const onlyGemach = { mode: 'licensed', status: 'active', features: ['econ', 'econ.gemach'] };
  assert.match(LG.checkChannel(onlyGemach, 'npo:getOverview', 'data.view'), /אינו כלול ברישיון/);
  Edition._setForTests('realty');
  assert.equal(LG.moduleAllowed(all, 'shamai'), true);
  assert.match(LG.checkChannel(all, 'npo:addDonation', 'data.edit'), /אינו חלק מ-SuperSuite נדל"ן ועסקים/);
});

test('מנוע החשבוניות מאחורי הקלעים: בעמותות ובנדל"ן בלי econ.accounting; במלאה — כמו היום', () => {
  const realtyLic = { mode: 'licensed', status: 'active', features: ['econ', 'econ.realestate', 'econ.mortgage-advisor'] };
  // המלאה: חשבונית עמלה דורשת רישיון לחשבונות (ההתנהגות של היום)
  assert.match(LG.checkChannel(realtyLic, 'acct:x', 'data.edit'), /אינו כלול ברישיון/);
  Edition._setForTests('realty');
  assert.equal(LG.checkChannel(realtyLic, 'acct:x', 'data.edit'), null, 'madv:issueFeeInvoice / rlty:issueCommissionInvoice');
  assert.equal(LG.checkChannel(realtyLic, 'acct:exportInvoicePdf', 'data.export'), null);
  assert.equal(LG.checkChannel(realtyLic, 'acct:startTask', 'data.edit'), null);
  assert.match(LG.checkChannel(realtyLic, 'acct:getJournal', 'data.view'), /אינו חלק/);
  assert.match(LG.checkChannel(realtyLic, 'acct:exportUniformFile', 'data.export'), /אינו חלק/);
  // רישיון בלי 'econ' — גם המנוע סגור; ומערכת מושבתת — כמו כל ערוץ
  assert.match(LG.checkChannel({ mode: 'licensed', status: 'active', features: ['shamai'] }, 'acct:x', 'data.edit'), /אינו כלול ברישיון/);
  assert.ok(LG.checkChannel({ ...realtyLic, status: 'suspended' }, 'acct:x', 'data.edit'));
  Edition._setForTests('acct');
  assert.match(LG.checkChannel(realtyLic, 'acct:x', 'data.edit'), /אינו כלול ברישיון/, 'בחשבונאות — הרישיון לחשבונות');
});

test('מאגר האנשים ונתוני הדוגמה: רק תחומים של המהדורה', () => {
  assert.equal(LG.peopleSources(UNLICENSED), null);
  Edition._setForTests('npo');
  assert.deepEqual(LG.peopleSources(UNLICENSED), ['npo', 'gemach', 'chesed']);
  Edition._setForTests('realty');
  assert.deepEqual(LG.peopleSources(UNLICENSED), []);
  assert.match(LG.checkChannel(UNLICENSED, 'people:list', 'data.view'), /אינו חלק/);
  const SD = require('../modules/econ/core/sampleData');
  assert.deepEqual(SD.availableKinds(UNLICENSED, Edition.featureAllowed), ['realty']);
  Edition._setForTests('npo');
  assert.deepEqual(SD.availableKinds(UNLICENSED, Edition.featureAllowed).sort(), ['gemach', 'npo']);
  Edition._setForTests('full');
  assert.equal(SD.availableKinds(UNLICENSED, Edition.featureAllowed).length, Object.keys(SD.KINDS).length);
});

test('ייבוא / ייצוא: נתונים אישיים ותוכניות עסקיות שייכים לתחום — נסגרים במהדורה שאין בה אותו', () => {
  const DP = require('../modules/econ/core/dataPorts');
  assert.equal(DP.kindDomain('personal'), 'personal');
  assert.equal(DP.kindDomain('financeIncomes'), 'personalFinance');
  assert.equal(DP.kindDomain('businessPlans'), 'business');
  Edition._setForTests('npo');
  for (const k of ['personal', 'financeIncomes', 'financeExpenses', 'businessPlans', 'marketIntel', 'mortgageClients']) {
    assert.ok(LG.checkChannel(UNLICENSED, DP.kindDomain(k) + ':x', 'data.view'), k);
  }
  assert.equal(LG.checkChannel(UNLICENSED, DP.kindDomain('npoGrants') + ':x', 'data.view'), null);
  assert.equal(LG.checkChannel(UNLICENSED, 'contacts:x', 'data.view'), null);
});

test('הקטלוג: כל מהדורה רואה רק את המסכים שלה; במלאה — הכול כמו היום', () => {
  const full = freshShell('full');
  assert.equal(full.CAT.ITEMS.length, full.CAT.ALL_GROUPS.flatMap(g => g.items).length);
  for (const id of Edition.PARTIAL_IDS) {
    const { CAT } = freshShell(id);
    const keys = CAT.ITEMS.map(i => i.key);
    for (const k of keys) assert.ok(Edition.keyAllowed(k), id + ': ' + k);
    assert.ok(keys.includes('tools') && keys.includes('econ:settings') && keys.includes('econ:licensing'), id);
    assert.ok(CAT.GROUPS.every(g => g.items.length), 'תחום ריק לא מוצג');
    // מסך של מהדורה אחרת אינו "חדש"
    const html = fs.readFileSync(path.join(ROOT, 'modules/econ/views/index.html'), 'utf8');
    assert.deepEqual(CAT.extrasFromHtml(html), [], id);
  }
  const npo = freshShell('npo').CAT.ITEMS.map(i => i.key);
  assert.ok(npo.includes('econ:npo') && !npo.includes('econ:acct-journal') && !npo.includes('shamai') && !npo.includes('econ:realty'));
  const realty = freshShell('realty').CAT.ITEMS.map(i => i.key);
  assert.ok(realty.includes('shamai') && realty.includes('econ:realestate') && !realty.includes('econ:npo'));
});

test('משימות, תיבת הפקודה, מצב פשוט ואשף ההתחלה — רק מה שקיים במהדורה', () => {
  let s = freshShell('npo');
  const ids = s.T.TASKS.map(t => t.id);
  assert.ok(ids.includes('donation') && ids.includes('gemachLoan') && ids.includes('backup') && ids.includes('invoice'));
  assert.ok(!ids.includes('expense'), 'הוצאה — יומן חשבונאי, רק בחשבונאות');
  assert.equal(s.T.validateTask('expense', { amount: '30' }), null, 'main.js דוחה משימה שאינה במהדורה');
  assert.equal(s.I.parse('לרשום הוצאה 30').kind, 'unknown');
  assert.equal(s.I.parse('לרשום תרומה מלוי 100').task, 'donation');
  assert.deepEqual(s.OB.PROFILES.map(p => p.id), ['npo', 'gemach', 'chesed']);
  assert.deepEqual(s.OB.normalizeState({ profiles: ['business', 'npo'] }).profiles, ['npo'], 'פרופיל של מהדורה אחרת שנשמר — מסונן');
  assert.ok(!s.S.tasksFor({ admin: true }).some(t => t.key === 'shamai'));

  s = freshShell('realty');
  assert.deepEqual(s.T.TASKS.map(t => t.id).sort(), ['backup', 'contact', 'invoice', 'receipt']);
  assert.notEqual(s.I.parse('לרשום תרומה מלוי 100').kind, 'task');
  assert.ok(s.S.tasksFor({ admin: true }).some(t => t.key === 'shamai'));
  assert.ok(!s.S.tasksFor({ admin: true }).some(t => t.key === 'econ:npo' || t.key === 'econ:gemach'));

  s = freshShell('acct');
  assert.ok(s.T.TASKS.some(t => t.id === 'expense') && !s.T.TASKS.some(t => t.id === 'donation' || t.id === 'gemachLoan'));
  assert.equal(s.I.parse('לתת הלוואה מהגמ"ח לכהן 1000').kind === 'task', false);
  assert.deepEqual(s.OB.PROFILES.map(p => p.id), ['business', 'household']);

  s = freshShell('full');
  assert.equal(s.T.TASKS.length, s.T.ALL_TASKS.length);
  assert.equal(s.OB.PROFILES.length, s.OB.ALL_PROFILES.length);
});

test('המודול הכלכלי בפועל: ערוץ של תחום אחר נדחה ב-runGuarded גם למנהל מחובר', async () => {
  const handlers = {};
  const Module = require('module');
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_edition__.js' : orig.call(this, req, ...rest); };
  require.cache['/__electron_stub_edition__.js'] = { id: '/__electron_stub_edition__.js', filename: '/__electron_stub_edition__.js', loaded: true,
    exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) } } };
  const ipc = require('../modules/econ/ipc');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-edition-'));
  try {
    await ipc.initEcon(dir, { relayUrl: '' });
    const ev = { sender: { id: 811 } };
    await handlers['auth:setup'](ev, 'menahel', 'menahel-strong-pass-1');
    Edition._setForTests('npo');
    for (const ch of ['acct:getJournal', 'rlty:getOverview', 'madv:getOverview', 'personalFinance:get', 'mlab:getState', 'realestate:getOverview']) {
      if (!handlers[ch]) continue;
      await assert.rejects(handlers[ch](ev), /אינו חלק מ-SuperSuite עמותות/, ch);
    }
    const ov = await handlers['npo:getOverview'](ev);
    assert.ok(ov && typeof ov === 'object');
    assert.ok(Array.isArray(await handlers['acct:getInvoices'](ev)), 'מנוע החשבוניות פתוח');
    // נתונים של תחומים אחרים לא נמחקים במהדורה חלקית: המסד נשמר כמו שהוא, וחוזרים למלאה — הכול שם
    Edition._setForTests('full');
    await handlers['personal:addEntry'](ev, { date: '2026-01-05', amount: 120, category: 'מזון', description: 'קניות' }).catch(() => {});
    const before = await handlers['personal:getEntries'](ev).catch(() => null);
    Edition._setForTests('npo');
    await assert.rejects(handlers['personal:getEntries'](ev), /אינו חלק/);
    await handlers['npo:saveSettings'](ev, {}).catch(() => {});
    Edition._setForTests('full');
    assert.deepEqual(await handlers['personal:getEntries'](ev).catch(() => null), before);
  } finally {
    Edition._setForTests('full');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('main.js ו-shell: המהדורה נאכפת במעבר למסך, ושם המהדורה מוצג', () => {
  const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  assert.match(MAIN, /ALL_ECON_VIEWS\.has\(view\)\) openEconView\('dashboard'\)/);
  const html = fs.readFileSync(path.join(ROOT, 'shell/shell.html'), 'utf8');
  const i = (f) => html.indexOf(`src="${f}"`);
  for (const f of ['catalog.js', 'tasks.js', 'onboarding.js', 'intents.js', 'simple-mode.js']) {
    assert.ok(i('edition-id.js') > 0 && i('edition-id.js') < i('edition.js') && i('edition.js') < i(f), f);
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'shell/shell.js'), 'utf8'), /document\.title = EDITION\.name/);
});
