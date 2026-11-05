// חשבונית עמלה (תיווך / ייעוץ משכנתאות): מספר עוסק / ת"ז של הלקוח ממולא מראש מכרטיס הלקוח — החלטת הבעלים 5.11.2026
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const EconUI = require('./helpers/econ-ui');

const ROOT = path.join(__dirname, '..');
let context;
test.before(() => {
  context = { console, setTimeout, clearTimeout, Date, Intl, URLSearchParams, location: { search: '' },
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } } };
  context.window = context;
  vm.createContext(context);
  EconUI.run(context);
});

const O = { clients: [{ id: 'b1', name: 'קונה', idNumber: '000000018' }, { id: 's1', name: 'מוכר', idNumber: '' }, { id: 's2', name: 'מוכר ב', idNumber: '515555555' }] };
const deal = (seller) => ({ id: 'd', buyerClientId: 'b1', sellerClientId: seller,
  commissionPayments: [{ id: 'pb', side: 'buyer' }, { id: 'ps', side: 'seller' }] });
const call = (o, d, pid) => { context.__a = [o, d, pid]; return vm.runInContext('rltyInvoiceTaxId(__a[0], __a[1], __a[2])', context); };

test('תיווך: הת"ז של הצד ששילם ממולאת מראש; בלי ת"ז בכרטיס / בלי לקוח — ריק', () => {
  assert.equal(call(O, deal('s2'), 'pb'), '000000018', 'הקונה');
  assert.equal(call(O, deal('s2'), 'ps'), '515555555', 'המוכר');
  assert.equal(call(O, deal('s1'), 'ps'), '', 'מוכר בלי ת"ז');
  assert.equal(call(O, deal(''), 'ps'), '', 'בלי מוכר בעסקה');
  assert.equal(call(O, deal('s2'), 'nope'), '', 'תשלום שלא נמצא');
  assert.equal(call({}, null, 'pb'), '');
});

test('החלון: תווית "לבדוק" בשני המסכים, והערך מהכרטיס בתיווך (ניתן לעריכה — שדה רגיל)', () => {
  assert.equal(vm.runInContext('RLTY_TAX_ID_LABEL', context), 'מספר עוסק / ת"ז של הלקוח (לבדוק)');
  const realty = fs.readFileSync(path.join(ROOT, 'modules/econ/ui/realty.js'), 'utf8');
  assert.match(realty, /name: 'customerTaxId', label: RLTY_TAX_ID_LABEL, value: rltyInvoiceTaxId\(o, deal, b\.dataset\.rltyInvoice\)/);
  const madv = fs.readFileSync(path.join(ROOT, 'modules/econ/ui/mortgage-advisor.js'), 'utf8');
  assert.match(madv, /name: 'customerTaxId', label: RLTY_TAX_ID_LABEL \}/);
  // askDocFields ממלא את השדה מ-value (ולא רק ברירת מחדל ריקה)
  const acc = fs.readFileSync(path.join(ROOT, 'modules/econ/ui/accounting.js'), 'utf8');
  assert.match(acc, /input\.value = f\.value \|\|/);
});
