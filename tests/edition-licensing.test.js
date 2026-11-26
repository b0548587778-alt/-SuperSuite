// מהדורות ורישוי (שלב 2 בתכנית docs/SPLIT-3-PRODUCTS-PLAN.md): תכנית אחת לכל מוצר, המחיר — של הבעלים.
// תכנית עם edition מוצעת רק במהדורה שלה, והתחומים שלה רק מאותה מהדורה. הצעה ישנה (בלי edition) — לכל המהדורות.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const L = require('../shell/licensing/license');
const OF = require('../shell/licensing/offer');
const Edition = require('../shell/edition');

const TERMS = { version: '1.0', title: 'תקנון', text: 'תקנון השימוש במערכת. התשלום מראש לתקופה שנבחרה.\n'.repeat(4) };
const offer = (plans) => ({ seller: { name: 'ספק' }, terms: TERMS, plans });
test.afterEach(() => Edition._setForTests('full'));

test('תכנית עם מהדורה: נחתמת ומאומתת; תחום של מהדורה אחרת או מהדורה לא מוכרת — נדחים בעברית', () => {
  const root = L.generateKeyPair();
  const plans = [
    { id: 'npo', name: 'עמותות', edition: 'npo', priceAgorot: 0, months: 12, features: ['econ', 'econ.npo', 'econ.gemach', 'ai'] },
    { id: 'old', name: 'כללית', priceAgorot: 0, months: 12, features: ['econ'] },
  ];
  const signed = OF.verifyOffer(OF.createOffer(root.privateJwk, offer(plans)), [root.publicJwk]);
  assert.equal(signed.plans[0].edition, 'npo');
  assert.equal('edition' in signed.plans[1], false, 'תכנית בלי מהדורה — בלי השדה (כמו הצעה ישנה)');
  assert.throws(() => OF.createOffer(root.privateJwk, offer([{ ...plans[0], features: ['econ', 'econ.realestate'] }])), /אינם חלק מ-SuperSuite עמותות/);
  assert.throws(() => OF.createOffer(root.privateJwk, offer([{ ...plans[0], edition: 'xyz' }])), /המהדורה בתכנית "עמותות" אינה מוכרת/);
  assert.throws(() => OF.createOffer(root.privateJwk, offer([{ ...plans[0], edition: 'acct' }])), /אינם חלק מ-SuperSuite חשבונאות/);
  // המלאה מקבלת כל תחום
  assert.ok(OF.createOffer(root.privateJwk, offer([{ ...plans[0], edition: 'full', features: [...OF.FEATURES] }])));
});

test('plansForEdition / planInEdition: כל מהדורה רואה את שלה ואת התכניות הכלליות', () => {
  const o = { plans: [{ id: 'a', edition: 'npo' }, { id: 'b', edition: 'realty' }, { id: 'c' }, { id: 'd', edition: 'full' }] };
  assert.deepEqual(OF.plansForEdition(o, 'npo').map(p => p.id), ['a', 'c']);
  assert.deepEqual(OF.plansForEdition(o, 'full').map(p => p.id), ['c', 'd']);
  assert.deepEqual(OF.plansForEdition(null, 'npo'), []);
  Edition._setForTests('realty');
  assert.deepEqual(OF.plansForEdition(o).map(p => p.id), ['b', 'c'], 'ברירת המחדל — המהדורה של הבנייה');
  assert.equal(OF.planInEdition({ edition: 'npo' }), false);
});

test('תבנית "תכנית אחת לכל מוצר": התחומים של המהדורה + העוזר, בלי מחיר — לא נחתמת עד שהבעלים מקליד מחיר', () => {
  const t = OF.editionPlanTemplates();
  assert.deepEqual(t.map(p => p.edition), ['npo', 'realty', 'acct']);
  for (const p of t) {
    assert.equal(p.priceAgorot, null);
    for (const f of p.features) assert.ok(Edition.featureAllowed(f, Edition.get(p.edition)), p.edition + ': ' + f);
    assert.ok(p.features.includes('ai'));
  }
  assert.ok(t.find(p => p.edition === 'realty').features.includes('shamai'));
  const root = L.generateKeyPair();
  assert.throws(() => OF.createOffer(root.privateJwk, offer(t)), /המחיר בתכנית/);
  const priced = t.map((p, i) => ({ ...p, priceAgorot: 10000 * (i + 1) }));
  const s = OF.verifyOffer(OF.createOffer(root.privateJwk, offer(priced)), [root.publicJwk]);
  assert.deepEqual(s.plans.map(p => [p.edition, p.priceAgorot]), [['npo', 10000], ['realty', 20000], ['acct', 30000]]);
  assert.deepEqual(OF.editionChoices().map(c => c.id), ['full', 'npo', 'realty', 'acct']);
});

test('ipc: ההרשמה מציגה רק את תכניות המהדורה, ותכנית של מהדורה אחרת נדחית לפני השרת; העורך מקבל את המהדורות', () => {
  const src = fs.readFileSync(path.join(ROOT, 'modules/econ/ipc.js'), 'utf8');
  const get = src.slice(src.indexOf("handleNet('license:getOffer'"), src.indexOf("handleNet('license:signup'"));
  assert.match(get, /OF\.plansForEdition\(r\.offer\)/);
  assert.match(get, /text: r\.text/, 'הטקסט החתום לא משתנה');
  const su = src.slice(src.indexOf("handleNet('license:signup'"), src.indexOf("handleNet('license:signupStatus'"));
  assert.ok(su.indexOf('planInEdition') > 0 && su.indexOf('planInEdition') < su.indexOf('licenseSync.signup'));
  assert.match(src, /handle\('owner:offerEditions'/);
  assert.match(fs.readFileSync(path.join(ROOT, 'modules/econ/preload.js'), 'utf8'), /ownerOfferEditions: \(\) => ipcRenderer\.invoke\('owner:offerEditions'\)/);
});

test('שרת הרישוי בקונטיינר: כל קובץ שהשרת טוען (כולל shell/edition.js) מועתק לתמונה', () => {
  const docker = fs.readFileSync(path.join(ROOT, 'deploy/relay/Dockerfile'), 'utf8');
  const copied = [...docker.matchAll(/^COPY (.+)$/gm)].flatMap(m => m[1].trim().split(/\s+/).slice(0, -1));
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/require\('(\.{1,2}\/[^']+)'\)/g)) {
      let f = path.resolve(path.dirname(file), m[1]);
      if (!f.endsWith('.js')) f += '.js';
      if (fs.existsSync(f)) visit(f);
    }
  };
  visit(path.join(ROOT, 'server/license-relay.js'));
  const missing = [...seen].map(f => path.relative(ROOT, f).replace(/\\/g, '/'))
    .filter(rel => !copied.some(c => (c.endsWith('/') ? rel.startsWith(c) : rel === c)));
  assert.deepEqual(missing, []);
  assert.ok(seen.has(path.join(ROOT, 'shell/edition.js')));
});
