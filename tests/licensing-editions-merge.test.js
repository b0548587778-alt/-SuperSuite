'use strict';
// מיזוג שני קווי הרישוי: מרכז הרישוי (shell/licensing/products.js — הצעה ראשית לכל התוכנות, חבילות) וקו המהדורות
// (shell/edition.js — תכנית אחת לכל מהדורה של SuperSuite, מודולי הלימוד במהדורה המלאה).
// הכלל: מהדורה היא מאפיין של תכנית של SuperSuite בלבד, בתוך ההצעה הראשית; היא נכתבת רק בהצעה החתומה של SuperSuite.
// חלק ראשון — הפונקציות הטהורות ומנהל-העל; חלק שני — main.js האמיתי: גיבוי של המהדורה המלאה עם מודולי הלימוד.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../shell/licensing/license');
const P = require('../shell/licensing/products');
const OF = require('../shell/licensing/offer');
const G = require('../shell/licensing/gate');
const Edition = require('../shell/edition');
const Scope = require('../shell/backup-scope');
const BK = require('../modules/econ/core/backupCrypto');
const { createOwnerCore } = require('../shell/licensing/owner-core');
const { createMainHarness } = require('./helpers/secure-store-main');

const TERMS = 'תקנון השימוש בתוכנות של הספק.\n1. השימוש כפוף לתנאים אלה.\n2. התשלום מראש לתקופה שנבחרה.\n3. הנתונים נשמרים במחשב הלקוח.\n'.repeat(3);
const LIMITS = { maxUsers: 5, maxChildren: 0 };
const LEARN_MODULES = ['trainer', 'english', 'math', 'school'];
const NPO = ['econ', 'econ.npo', 'econ.gemach', 'tools', 'ai'];
const plan = (extra) => ({ id: 'p', name: 'תכנית', priceAgorot: 49900, months: 12, limits: LIMITS, ...extra });
const master = (plans) => ({ seller: { name: 'בונים סלר' }, plans, terms: { version: '2.0', title: 'תקנון', text: TERMS } });
const mem = () => { const m = new Map(); return { read: (n) => (m.has(n) ? m.get(n) : null), write: (n, t) => m.set(n, t) }; };
test.afterEach(() => Edition._setForTests('full'));

/* ================= תחומים: קטלוג המוצרים מול המהדורות ================= */

test('תחומי SuperSuite בקטלוג = תחומי ההצעה, כולל מודולי הלימוד; כל תחום של כל מהדורה קיים בקטלוג', () => {
  assert.deepEqual(OF.FEATURES, P.featuresOf(P.THIS_PRODUCT));
  for (const f of LEARN_MODULES) assert.ok(OF.FEATURES.includes(f), f);
  for (const id of Edition.PARTIAL_IDS) {
    for (const f of Edition.get(id).features) assert.ok(OF.FEATURES.includes(f), id + ': ' + f);
    // מודולי הלימוד — רק במהדורה המלאה
    for (const f of LEARN_MODULES) assert.equal(Edition.featureAllowed(f, Edition.get(id)), false, id + ': ' + f);
  }
  // לכל מודול שהשער מכיר יש תחום בקטלוג — אחרת רישיון לא היה יכול לפתוח אותו
  for (const f of Object.values(G.MODULE_FEATURES)) assert.ok(OF.FEATURES.includes(f), f);
  assert.equal(P.checkFeatures('supersuite', ['econ', 'trainer', 'school']), null);
  assert.match(P.checkFeatures('supersuite', ['econ', 'shir-studio']), /אינם של SuperSuite/);
  assert.match(P.checkFeatures('learn', ['econ', 'econ.npo']), /אינם של SuperSuite לימוד/);
});

test('מוצר של רישיון בלי מוצר: מודול לימוד לצד תחום שיש רק ב-SuperSuite — SuperSuite; בלי תחום כזה — לימוד, כמו קודם', () => {
  assert.equal(P.productOfFeatures(['econ', 'english']), 'learn');
  assert.equal(P.productOfFeatures(['econ', 'trainer', 'tools', 'ai']), 'learn');
  assert.equal(P.productOfFeatures(['econ', 'econ.npo', 'trainer', 'tools']), 'supersuite');
  assert.equal(P.productOfFeatures(['shamai', 'school']), 'supersuite');
  assert.equal(P.productOfFeatures([...OF.FEATURES]), 'supersuite');
  assert.equal(P.productOfFeatures(['econ', 'tools']), 'supersuite');
  assert.equal(P.productOfFeatures(['shir-studio']), 'shir-studio');
});

/* ================= תכנית עם מהדורה בהצעה הראשית ================= */

test('הצעה ראשית: תכנית של SuperSuite עם מהדורה נשמרת; תחום של מהדורה אחרת, מהדורה לא מוכרת ומודול לימוד במהדורה חלקית — נדחים', () => {
  const m = OF.cleanMaster(master([
    plan({ id: 'amutot', name: 'עמותות', scope: 'supersuite', edition: 'npo', features: { supersuite: NPO } }),
    plan({ id: 'klali', name: 'כללית', scope: 'supersuite', features: { supersuite: ['econ'] } }),
    plan({ id: 'male', name: 'מלאה', scope: 'supersuite', edition: 'full', features: { supersuite: [...OF.FEATURES] } }),
  ]));
  assert.deepEqual(m.plans.map(p => p.edition || null), ['npo', null, 'full']);
  assert.equal('edition' in m.plans[1], false, 'תכנית בלי מהדורה — בלי השדה');
  assert.deepEqual(m.plans[0].products, ['supersuite']);
  assert.equal(m.v, 2);
  const one = (extra) => () => OF.cleanMaster(master([plan({ id: 'amutot', name: 'עמותות', scope: 'supersuite', edition: 'npo', features: { supersuite: NPO }, ...extra })]));
  assert.throws(one({ features: { supersuite: ['econ', 'econ.realestate'] } }), /בתכנית "עמותות" יש תחומים שאינם חלק מ-SuperSuite עמותות/);
  assert.throws(one({ edition: 'acct' }), /אינם חלק מ-SuperSuite חשבונאות/);
  for (const f of LEARN_MODULES) assert.throws(one({ features: { supersuite: ['econ', f] } }), /אינם חלק מ-SuperSuite עמותות/, f);
  // מהדורה לא מוכרת — גם שם של מאפיין מובנה, וגם ערך שאינו מחרוזת
  for (const bad of ['xyz', 'constructor', 'toString', '__proto__', 'FULL', 5, true, ['npo'], { id: 'npo' }]) {
    assert.throws(one({ edition: bad }), /המהדורה בתכנית "עמותות" אינה מוכרת/, JSON.stringify(bad));
  }
  // ריק = בלי מהדורה (כמו הצעה ישנה)
  for (const none of ['', null, undefined]) assert.equal('edition' in one({ edition: none })().plans[0], false);
});

test('הצעה ראשית: תכנית מגרסה קודמת (features מערך) עם מהדורה, והתבנית "תכנית אחת לכל מוצר" — תכניות של SuperSuite', () => {
  const old = OF.cleanMaster(master([plan({ edition: 'realty', features: ['econ', 'econ.realestate', 'shamai'] })]));
  assert.equal(old.plans[0].scope, 'supersuite');
  assert.equal(old.plans[0].edition, 'realty');
  assert.deepEqual(old.plans[0].features, { supersuite: ['econ', 'econ.realestate', 'shamai'] });
  // התבנית בלי מחיר לא נשמרת; עם מחיר — שלוש תכניות, כל אחת במהדורה שלה
  const t = OF.editionPlanTemplates();
  assert.throws(() => OF.cleanMaster(master(t)), /המחיר בתכנית/);
  const m = OF.cleanMaster(master(t.map((p, i) => ({ ...p, priceAgorot: 10000 * (i + 1) }))));
  assert.deepEqual(m.plans.map(p => [p.scope, p.edition, p.priceAgorot]), [['supersuite', 'npo', 10000], ['supersuite', 'realty', 20000], ['supersuite', 'acct', 30000]]);
  for (const p of m.plans) for (const f of p.features.supersuite) assert.ok(Edition.featureAllowed(f, Edition.get(p.edition)), p.edition + ': ' + f);
});

test('מהדורה רק בתכנית שכוללת את SuperSuite: תכנית של תוכנה אחרת או חבילת לימוד עם מהדורה — נדחית, לא מושמטת בשקט', () => {
  const learnFam = { learn: ['econ', 'english'], 'shir-studio': ['shir-studio'], vidlearn: ['vidlearn'] };
  assert.throws(() => OF.cleanMaster(master([plan({ scope: 'learn', edition: 'npo', features: { learn: ['econ', 'english'] } })])), /מהדורה נקבעת רק לתכנית שכוללת את SuperSuite/);
  assert.throws(() => OF.cleanMaster(master([plan({ scope: 'shir-studio', edition: 'full', features: { 'shir-studio': ['shir-studio'] } })])), /מהדורה נקבעת רק/);
  assert.throws(() => OF.cleanMaster(master([plan({ scope: 'family:learn', edition: 'full', features: learnFam })])), /מהדורה נקבעת רק/);
  assert.ok(OF.cleanMaster(master([plan({ scope: 'family:learn', features: learnFam })])));
  // גם בהצעה חתומה של תוכנה אחרת: createOffer / verifyOffer דוחים מהדורה
  const root = L.generateKeyPair();
  const learnOffer = { seller: { name: 'ספק' }, terms: { version: '1.0', text: TERMS }, plans: [plan({ features: ['econ', 'english'], edition: 'npo' })] };
  assert.throws(() => OF.createOffer(root.privateJwk, learnOffer, { product: 'learn' }), /מהדורה נקבעת רק/);
  const ok = JSON.parse(OF.createOffer(root.privateJwk, { ...learnOffer, plans: [plan({ features: ['econ', 'english'] })] }, { product: 'learn' }));
  ok.payload.plans[0].edition = 'npo';
  ok.sig = L.signObject(ok.payload, root.privateJwk);
  assert.throws(() => OF.verifyOffer(JSON.stringify(ok), [root.publicJwk], { expectProduct: 'learn' }), /מהדורה נקבעת רק/);
});

/* ================= פיצול ההצעה הראשית להצעה לכל תוכנה ================= */

test('splitMaster: המהדורה נכתבת רק בהצעה של SuperSuite, ולא עוברת לתוכנה אחרת; כל הצעה נחתמת ומאומתת', () => {
  const root = L.generateKeyPair();
  const m = OF.cleanMaster(master([
    plan({ id: 'amutot', name: 'עמותות', scope: 'supersuite', edition: 'npo', features: { supersuite: NPO } }),
    plan({ id: 'hakol', name: 'הכול — עמותות', scope: 'all', edition: 'npo',
      features: { supersuite: NPO, learn: ['econ', 'english', 'math'], 'shir-studio': ['shir-studio'], vidlearn: ['vidlearn'] } }),
    plan({ id: 'limud', name: 'חבילת לימוד', scope: 'family:learn', features: { learn: ['econ', 'school'], 'shir-studio': ['shir-studio'], vidlearn: ['vidlearn'] } }),
  ]));
  const parts = OF.splitMaster(m);
  assert.deepEqual(parts.supersuite.plans.map(p => [p.id, p.edition]), [['amutot', 'npo'], ['hakol', 'npo']]);
  for (const pid of ['learn', 'shir-studio', 'vidlearn']) {
    assert.deepEqual(parts[pid].plans.map(p => p.id), ['hakol', 'limud'], pid);
    for (const p of parts[pid].plans) assert.equal('edition' in p, false, pid + ': ' + p.id);
  }
  const signed = Object.fromEntries(Object.entries(parts).map(([pid, x]) => [pid, OF.verifyOffer(OF.createOffer(root.privateJwk, x, { issuedAt: 9, product: pid }), [root.publicJwk], { expectProduct: pid })]));
  assert.deepEqual(signed.supersuite.plans.map(p => p.edition), ['npo', 'npo']);
  assert.equal(JSON.stringify(signed.learn).includes('edition'), false, 'בהצעה החתומה של לימוד אין מהדורה בכלל');
  assert.equal(JSON.stringify(signed.vidlearn).includes('edition'), false);
  // החבילה חתומה בכל ההצעות באותם תחומים — והתחומים של SuperSuite בה הם של המהדורה
  for (const pid of Object.keys(signed)) {
    const b = signed[pid].plans.find(p => p.id === 'hakol').bundle;
    assert.deepEqual(b.products, ['supersuite', 'learn', 'shir-studio', 'vidlearn'], pid);
    assert.deepEqual(b.features.supersuite, NPO, pid);
    for (const f of b.features.supersuite) assert.ok(Edition.featureAllowed(f, Edition.get('npo')), f);
  }
  // שינוי המהדורה בהצעה החתומה — החתימה נפסלת
  const text = OF.createOffer(root.privateJwk, parts.supersuite, { issuedAt: 9 });
  const t = JSON.parse(text); t.payload.plans[0].edition = 'full';
  assert.throws(() => OF.verifyOffer(JSON.stringify(t), [root.publicJwk]), /חתימת/);
  // ההצעה הראשית חוזרת מההצעה החתומה של SuperSuite (offer.json מגרסה קודמת) — עם המהדורה
  const back = OF.masterFromOffer({ ...signed.supersuite, plans: signed.supersuite.plans.filter(p => !p.bundle) });
  assert.deepEqual(back.plans.map(p => [p.id, p.scope, p.edition]), [['amutot', 'supersuite', 'npo']]);
});

test('תכנית חבילה (family: / all) עם מהדורה: התחומים של SuperSuite — של המהדורה; שאר התוכנות בחבילה לא מושפעות', () => {
  const others = { learn: ['econ', 'english', 'trainer'], 'shir-studio': ['shir-studio'], vidlearn: ['vidlearn'] };
  // "כל התוכנות" עם מהדורת נדל"ן: תחום של עמותות ב-SuperSuite נדחה; מודול לימוד ב-SuperSuite נדחה — אבל אותו שם
  // ב-SuperSuite לימוד (תוכנה אחרת בחבילה) תקין
  const all = (sup, edition = 'realty') => () => OF.cleanMaster(master([plan({ id: 'hakol', name: 'הכול', scope: 'all', edition, features: { supersuite: sup, ...others } })]));
  assert.throws(all(['econ', 'econ.npo']), /בתכנית "הכול" יש תחומים שאינם חלק מ-SuperSuite נדל"ן ועסקים/);
  assert.throws(all(['econ', 'econ.realestate', 'trainer']), /אינם חלק מ-SuperSuite נדל"ן ועסקים/);
  const m = all(['econ', 'econ.realestate', 'shamai'])();
  assert.equal(m.plans[0].edition, 'realty');
  assert.deepEqual(m.plans[0].features.learn, ['econ', 'english', 'trainer']);
  // במהדורה המלאה — גם מודולי הלימוד ב-SuperSuite
  assert.deepEqual(all(['econ', 'trainer', 'school'], 'full')().plans[0].features.supersuite, ['econ', 'trainer', 'school']);
  // משפחת הכלכלה (רק SuperSuite בה) — תכנית רגילה של SuperSuite עם מהדורה, בלי חבילה
  const fam = OF.cleanMaster(master([plan({ scope: 'family:econ', edition: 'acct', features: { supersuite: ['econ', 'econ.accounting'] } })]));
  assert.deepEqual(fam.plans[0].products, ['supersuite']);
  const famPart = OF.splitMaster(fam);
  assert.deepEqual(Object.keys(famPart), ['supersuite']);
  assert.equal(famPart.supersuite.plans[0].edition, 'acct');
  assert.equal('bundle' in famPart.supersuite.plans[0], false);
  // בהצעה של SuperSuite: חבילה שהתחומים שלה שונים מתחומי התכנית נדחית גם עם מהדורה
  const part = OF.splitMaster(m).supersuite;
  part.plans[0].bundle.features.supersuite = ['econ', 'econ.realestate', 'shamai', 'econ.npo'];
  assert.throws(() => OF.createOffer(L.generateKeyPair().privateJwk, part), /החבילה בתכנית "הכול" אינה תואמת לתכנית/);
});

test('הלקוח: כל מהדורה רואה בהצעה של SuperSuite את התכניות שלה ואת הכלליות — גם כשהן חבילות', () => {
  const root = L.generateKeyPair();
  const m = OF.cleanMaster(master([
    plan({ id: 'amutot', name: 'עמותות', scope: 'supersuite', edition: 'npo', features: { supersuite: NPO } }),
    plan({ id: 'nadlan-hakol', name: 'נדל"ן וכל התוכנות', scope: 'all', edition: 'realty',
      features: { supersuite: ['econ', 'econ.realestate'], learn: ['econ', 'english'], 'shir-studio': ['shir-studio'], vidlearn: ['vidlearn'] } }),
    plan({ id: 'klali', name: 'כללית', scope: 'supersuite', features: { supersuite: ['econ'] } }),
  ]));
  const offer = OF.verifyOffer(OF.createOffer(root.privateJwk, OF.splitMaster(m).supersuite), [root.publicJwk], { expectProduct: 'supersuite' });
  assert.deepEqual(OF.plansForEdition(offer, 'npo').map(p => p.id), ['amutot', 'klali']);
  assert.deepEqual(OF.plansForEdition(offer, 'realty').map(p => p.id), ['nadlan-hakol', 'klali']);
  assert.deepEqual(OF.plansForEdition(offer, 'full').map(p => p.id), ['klali']);
  Edition._setForTests('acct');
  assert.deepEqual(OF.plansForEdition(offer).map(p => p.id), ['klali']);
  assert.equal(OF.planInEdition(OF.planOf(offer, 'nadlan-hakol')), false);
});

/* ================= מנהל-העל ================= */

test('מנהל-העל: setOffer שומר את המהדורה בהצעה הראשית ובהצעה החתומה של SuperSuite בלבד; offer.json ישן עם מהדורה נקרא', () => {
  const storage = mem();
  const owner = createOwnerCore({ storage });
  const rootKeys = [owner.init('menahel-al-mahadurot-2026').publicKey];
  const r = owner.setOffer(master([
    plan({ id: 'amutot', name: 'עמותות', scope: 'supersuite', edition: 'npo', features: { supersuite: NPO } }),
    plan({ id: 'hakol', name: 'הכול', scope: 'all', edition: 'full',
      features: { supersuite: ['econ', 'school'], learn: ['econ', 'english'], 'shir-studio': ['shir-studio'], vidlearn: ['vidlearn'] } }),
  ]));
  assert.deepEqual(r.master.plans.map(p => p.edition), ['npo', 'full'], 'העורך מקבל את המהדורה חזרה (owner:getOffer)');
  assert.deepEqual(r.offers.supersuite.plans.map(p => p.edition), ['npo', 'full']);
  assert.ok(r.offers.learn.plans.every(p => !('edition' in p)));
  assert.deepEqual(OF.verifyOffer(r.texts.supersuite, rootKeys, { expectProduct: 'supersuite' }).plans.map(p => p.edition), ['npo', 'full']);
  assert.throws(() => owner.setOffer(master([plan({ scope: 'learn', edition: 'npo', features: { learn: ['econ'] } })])), /מהדורה נקבעת רק/);
  assert.deepEqual(owner.offer().master.plans.map(p => p.id), ['amutot', 'hakol'], 'שמירה שנדחתה לא שינתה את ההצעה');

  // offer.json מקו המהדורות לפני המיזוג: { text } — הצעה אחת של SuperSuite, תכניות עם מהדורה
  const storage2 = mem();
  const owner2 = createOwnerCore({ storage: storage2 });
  owner2.init('menahel-al-mahadurot-2026');
  const legacyText = owner2.setOffer(master(OF.editionPlanTemplates().map((p, i) => ({ ...p, priceAgorot: 100 * (i + 1) })))).texts.supersuite;
  storage2.write('offer.json', JSON.stringify({ text: legacyText, published: [] }));
  const o = owner2.offer();
  assert.deepEqual(o.master.plans.map(p => [p.scope, p.edition]), [['supersuite', 'npo'], ['supersuite', 'realty'], ['supersuite', 'acct']]);
  assert.deepEqual(o.offer.plans.map(p => p.edition), ['npo', 'realty', 'acct']);
});

test('ipc: owner:getOffer מחזיר את התצוגה של מרכז הרישוי, owner:offerEditions נשאר, והעורך מקבל גם מוצרים וגם מהדורות', () => {
  const ROOT = path.join(__dirname, '..');
  const ipc = fs.readFileSync(path.join(ROOT, 'modules/econ/ipc.js'), 'utf8');
  assert.match(ipc, /handle\('owner:getOffer', async \(\) => ownerOfferView\(ownerCore\.offer\(\)\)\)/);
  assert.match(ipc, /handle\('owner:offerEditions', async \(\) => \(\{ choices: OF\.editionChoices\(\), templates: OF\.editionPlanTemplates\(\) \}\)\)/);
  assert.equal(ipc.match(/handle\('owner:getOffer'/g).length, 1, 'ערוץ אחד — לא שתי הגדרות');
  const actions = fs.readFileSync(path.join(ROOT, 'modules/econ/ui/licensing-actions.js'), 'utf8');
  assert.match(actions, /offerEditor\(cur, d\.owner && d\.owner\.products, editions\)/);
  const ui = fs.readFileSync(path.join(ROOT, 'modules/econ/ui/licensing.js'), 'utf8');
  assert.match(ui, /function offerEditor\(cur, cat, editions\)/);
  for (const f of ['main.js', 'modules/econ/ipc.js', 'modules/econ/ui/licensing.js', 'modules/econ/ui/licensing-actions.js', 'shell/licensing/offer.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /^(<<<<<<<|=======|>>>>>>>)/m, f);
  }
});

/* ================= השער: מהדורה לפני רישיון, יחד עם המצב offline ================= */

test('שער: המהדורה נבדקת לפני הרישיון גם במצב offline (קריאה בלבד); מודול לימוד — רק במלאה ורק ברישיון', () => {
  const offline = { mode: 'licensed', status: 'offline', features: [...OF.FEATURES], reasons: [] };
  assert.ok(G.READ_ONLY_STATUS.has('offline'));
  assert.equal(G.checkChannel(offline, 'npo:getOverview', 'data.view'), null);
  assert.match(G.checkChannel(offline, 'npo:addDonation', 'data.edit'), /אין חיבור לשרת הרישוי/);
  assert.equal(G.moduleAllowed(offline, 'school'), true, 'קריאה בלבד — המודול נפתח, הכתיבה נחסמת בנפרד');
  assert.equal(G.shellState(offline).level, 'limited');
  Edition._setForTests('npo');
  assert.match(G.checkChannel(offline, 'rlty:getOverview', 'data.view'), /אינו חלק מ-SuperSuite עמותות/, 'המהדורה קודמת להודעת הרישיון');
  assert.match(G.checkChannel(offline, 'npo:addDonation', 'data.edit'), /אין חיבור לשרת הרישוי/);
  assert.equal(G.checkChannel(offline, 'npo:getOverview', 'data.view'), null);
  for (const m of LEARN_MODULES) assert.equal(G.moduleAllowed(offline, m), false, m);
  Edition._setForTests('full');
  const noLearn = { mode: 'licensed', status: 'active', features: ['econ', 'tools'], reasons: [] };
  for (const m of LEARN_MODULES) assert.equal(G.moduleAllowed(noLearn, m), false, m);
});

/* ================= גיבוי של המהדורה המלאה (backup-scope.js) ================= */

test('backup-scope: גיבוי של המהדורה המלאה עם מודולי הלימוד מזוהה כגיבוי של התוכנה הזו — לפי product', () => {
  const MARKS = { hadLicense: true, trialStart: 1 };
  const full = { suite: 'SuperSuite', product: Scope.PRODUCT, scope: 'all', localStorage: { shamai: {}, tools: {}, trainer: {}, english: {}, math: {}, school: {} }, licenseMarks: MARKS };
  assert.equal(Scope.isOwnProduct(full), true);
  assert.deepEqual(Scope.licenseMarksToMerge(full, { encrypted: true }), MARKS);
  // גיבוי של מודול לימוד בודד מהמהדורה המלאה
  assert.equal(Scope.isOwnProduct({ suite: 'SuperSuite', product: Scope.PRODUCT, scope: 'school', localStorage: { school: {} } }), true);
  // בלי product ועם מודול לימוד: רק SuperSuite לימוד כתבה גיבוי כזה (התוכנה הזו רושמת product מאז שהמודולים חזרו) —
  // הסימונים לא נקלטים. זו האפשרות המחמירה כלפי זיהוי המוצר; הנתונים עצמם משוחזרים כרגיל
  assert.equal(Scope.licenseMarksToMerge({ ...full, product: undefined }, { encrypted: true }), null);
  // גם גיבוי מלא של המהדורה המלאה — רק מקובץ מוצפן
  assert.equal(Scope.licenseMarksToMerge(full, { encrypted: false }), null);
});

const H = createMainHarness();
const { handlers, boot, loginAs, shellSender, ADMIN, dialogPlan, userData, ROOT } = H;
const econApi = require(path.join(ROOT, 'modules', 'econ', 'ipc'));
const electron = require('electron'); // ה-stub של הרתמה
const PASS = 'sismat-gibui-aruka-2026';
const DAY = 24 * 60 * 60 * 1000;

test.before(async () => { await boot(); });

test('main.js (מהדורה מלאה): הגיבוי המלא כולל את מודולי הלימוד ואת המוצר, ושחזור שלו קולט את סימוני הרישוי', async () => {
  await loginAs(ADMIN[0]);
  const file = path.join(userData, 'merge-full.ssbk');
  dialogPlan.save = { canceled: false, filePath: file };
  try { assert.deepEqual(await handlers['shell:backup-all'](shellSender(), PASS, 'all'), { ok: true }); }
  finally { dialogPlan.save = { canceled: true }; }
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(BK.isEncryptedBackup(text), 'אין מסלול כתיבה גלוי');
  const data = JSON.parse(BK.decryptBackup(text, PASS));
  assert.equal(data.product, P.THIS_PRODUCT);
  for (const id of ['shamai', 'tools', ...LEARN_MODULES]) assert.ok(Object.prototype.hasOwnProperty.call(data.localStorage, id), 'בגיבוי: ' + id);
  assert.equal(Scope.isOwnProduct(data), true, 'מודולי הלימוד בגיבוי לא הופכים אותו לגיבוי של SuperSuite לימוד');

  // שחזור של אותו גיבוי, עם תחילת ניסיון מוקדמת יותר — הסימון נקלט (רק מחמיר)
  const before = econApi.licenseMarks();
  const t1 = Math.min(Date.now() - 2 * DAY, (before.trialStart || Date.now()) - DAY);
  const restoreFile = path.join(userData, 'merge-full-restore.ssbk');
  fs.writeFileSync(restoreFile, BK.encryptBackup(JSON.stringify({ ...data, licenseMarks: { trialStart: t1 } }), PASS));
  const orig = electron.dialog.showOpenDialog;
  electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [restoreFile] });
  dialogPlan.log.length = 0;
  try { assert.deepEqual(await handlers['shell:restore-all'](shellSender(), PASS), { ok: true }, dialogPlan.log.join(' | ')); }
  finally { electron.dialog.showOpenDialog = orig; }
  assert.equal(econApi.licenseMarks().trialStart, t1, 'סימוני הרישוי מגיבוי של המהדורה המלאה נקלטו');
});
