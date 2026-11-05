// נדל"ן ותיווך (שלב 5): עמלות תיווך לכל צד, תשלומים, חשבונית מס/קבלה, והזמנת שירותי תיווך עם "מה חסר".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const B = require('../modules/econ/core/brokerage');

// ---------- עמלות ----------

test('עמלה: אחוז בנקודות בסיס או סכום באגורות; ריק ← אין; מעל 10% — שגיאה', () => {
  assert.equal(B.validateFee({ type: 'percent', value: '' }), null);
  assert.equal(B.validateFee({ type: 'percent', value: 0 }), null);
  assert.deepEqual(B.validateFee({ type: 'percent', value: 1.5 }), { type: 'percent', bp: 150 });
  assert.deepEqual(B.validateFee({ type: 'fixed', value: 5000.25 }), { type: 'fixed', fixedAg: 500025 });
  assert.throws(() => B.validateFee({ type: 'percent', value: 12 }), /10%/);
  assert.throws(() => B.validateFee({ type: 'fixed', value: -1 }), /אינו תקין/);
});

test('סכום העמלה: אחוז ממחיר העסקה + מע"מ, מעוגל לאגורה; עוסק פטור — בלי מע"מ', () => {
  const fee = { type: 'percent', bp: 200 };
  assert.deepEqual(B.feeAmount(fee, 235000000, 0.18), { netAg: 4700000, vatAg: 846000, totalAg: 5546000 });
  assert.deepEqual(B.feeAmount(fee, 235000000, 0.18, true), { netAg: 4700000, vatAg: 0, totalAg: 4700000 });
  assert.equal(B.feeAmount({ type: 'percent', bp: 150 }, 33333, 0.18).netAg, 500, '33333 × 1.5% = 499.995 ← 500');
  assert.deepEqual(B.feeAmount(null, 1, 0.18), { netAg: 0, vatAg: 0, totalAg: 0 });
});

test('מצב הגבייה: לכל צד ובסך הכול; תשלום רק מצד שיש לו עמלה', () => {
  const deal = { priceAg: 200000000, commissions: { buyer: { type: 'percent', bp: 200 }, seller: { type: 'fixed', fixedAg: 1000000 } }, commissionPayments: [] };
  let st = B.commissionStatus(deal, 0.18);
  assert.equal(st.totalAg, 4720000 + 1180000);
  assert.deepEqual(st.sides.map(s => s.state), ['open', 'open']);
  deal.commissionPayments.push({ side: 'buyer', amountAg: 4720000 }, { side: 'seller', amountAg: 500000 });
  st = B.commissionStatus(deal, 0.18);
  assert.deepEqual(st.sides.map(s => s.state), ['paid', 'partial']);
  assert.equal(st.balanceAg, 680000);
  assert.throws(() => B.validatePayment({ side: 'seller', date: '2026-10-20', amount: 1 }, ['buyer']), /לא הוגדרה עמלה/);
  assert.throws(() => B.validatePayment({ side: 'buyer', date: 'x', amount: 1 }, ['buyer']), /תאריך/);
  assert.equal(B.validatePayment({ side: 'buyer', date: '2026-10-20', amount: 10.5 }, ['buyer']).amountAg, 1050);
});

// ---------- הזמנת שירותי תיווך ----------

const ctx = {
  clients: [{ id: 'c1', name: 'משפחת כהן', idNumber: '000000018' }],
  properties: [{ id: 'p1', city: 'בני ברק', street: 'רחוב הרב קוק 5' }]
};

test('הזמנה: לקוח ותאריך חובה, חתימה לא לפני ההזמנה, בלעדיות רק כשסומנה', () => {
  assert.throws(() => B.validateOrder({ date: '2026-10-20' }, {}, ctx), /לקוח/);
  assert.throws(() => B.validateOrder({ clientId: 'c1', date: 'x' }, {}, ctx), /תאריך ההזמנה/);
  assert.throws(() => B.validateOrder({ clientId: 'c1', date: '2026-10-20', signedDate: '2026-10-19' }, {}, ctx), /לפני/);
  assert.throws(() => B.validateOrder({ clientId: 'c1', date: '2026-10-20', propertyId: 'ghost' }, {}, ctx), /הנכס/);
  assert.throws(() => B.validateOrder({ clientId: 'c1', date: '2026-10-20', exclusive: 'yes', exclusiveUntil: '2026-10-20' }, {}, ctx), /אחרי/);
  const o = B.validateOrder({ clientId: 'c1', date: '2026-10-20', exclusiveUntil: '2027-01-01', marketing: 'x' }, {}, ctx);
  assert.equal(o.exclusiveUntil, '', 'בלי סימון בלעדיות — השדות לא נשמרים');
});

test('"מה חסר": רשימת שדות לא מאומתת; הזמנה מלאה ← שלמה; בלעדיות ארוכה ← אזהרה בלבד', () => {
  for (const f of [...B.ORDER_FIELDS, ...B.EXCLUSIVE_FIELDS]) assert.equal(f.needsVerification, true, f.id);
  const empty = B.validateOrder({ clientId: 'c1', date: '2026-10-20' }, {}, ctx);
  const c0 = B.orderCheck(empty, { client: ctx.clients[0], property: null, settings: {} });
  assert.equal(c0.complete, false);
  assert.ok(c0.missing.includes('מספר רישיון התיווך'));
  assert.ok(c0.missing.includes('חתימת הלקוח על ההזמנה'));
  assert.match(c0.verificationNote, /לא מאומת · 2026/);
  const full = B.validateOrder({ clientId: 'c1', propertyId: 'p1', date: '2026-10-20', transaction: 'purchase', clientAddress: 'רחוב חזון איש 1, בני ברק', price: 2000000, feeType: 'percent', feeValue: 2, signedDate: '2026-10-20' }, {}, ctx);
  const ok = B.orderCheck(full, { client: ctx.clients[0], property: ctx.properties[0], settings: { brokerName: 'משרד דוגמה', licenseNo: '12345' } });
  assert.deepEqual(ok.missing, []);
  assert.equal(ok.complete, true);
  const excl = B.validateOrder({ exclusive: 'yes', exclusiveUntil: '2027-06-01', marketing: 'מודעות בעיתון' }, full, ctx);
  const ex = B.orderCheck(excl, { client: ctx.clients[0], property: ctx.properties[0], settings: { brokerName: 'א', licenseNo: '1' } });
  assert.equal(ex.complete, true);
  assert.equal(ex.warnings.length, 1);
  assert.match(ex.warnings[0], /6 חודשים/);
  const missingMkt = B.orderCheck(B.validateOrder({ marketing: '' }, excl, ctx), { client: ctx.clients[0], property: ctx.properties[0], settings: { brokerName: 'א', licenseNo: '1' } });
  assert.ok(missingMkt.missing.includes('פעולות השיווק שהמתווך מתחייב להן'));
});

test('טופס להחתמה: RTL, פרטים ידועים ממולאים, חסרים — קו למילוי, בלי hex ובלי סקריפט', () => {
  const o = B.validateOrder({ clientId: 'c1', propertyId: 'p1', date: '2026-10-20', feeType: 'fixed', feeValue: 10000 }, {}, ctx);
  const html = B.renderOrderHtml(o, { client: ctx.clients[0], property: ctx.properties[0], settings: { brokerName: '<משרד>' } }, '');
  assert.match(html, /dir="rtl"/);
  assert.match(html, /משפחת כהן/);
  assert.match(html, /רחוב הרב קוק 5, בני ברק/);
  assert.match(html, /10000 ₪ \+ מע&quot;מ/);
  assert.match(html, /class="blank"/, 'כתובת הלקוח חסרה');
  assert.ok(html.includes('&lt;משרד&gt;'));
  assert.doesNotMatch(html, /#[0-9a-fA-F]{3,6}\b|<script/i);
});

test('רשימת האימות לבעלים כוללת כל שדה של הזמנת התיווך', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'RULES-TO-VERIFY.md'), 'utf8');
  assert.deepEqual(B.ALL_RULE_IDS.filter(id => !doc.includes('`' + id + '`')), []);
});

// ---------- IPC ----------

const handlers = {};
const pdfHtml = [];
Module._resolveFilename_orig_brk = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_brk__.js' : Module._resolveFilename_orig_brk.call(this, req, ...rest); };
require.cache['/__electron_stub_brk__.js'] = {
  id: '/__electron_stub_brk__.js', filename: '/__electron_stub_brk__.js', loaded: true,
  exports: {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    BrowserWindow: function () {
      return { loadURL: async (u) => { pdfHtml.push(Buffer.from(u.split(',')[1], 'base64').toString('utf8')); }, webContents: { printToPDF: async () => Buffer.from('') }, destroy() {} };
    },
    dialog: { showSaveDialog: async () => ({ canceled: true }) }
  }
};
const ipc = require('../modules/econ/ipc');
const ev = (id) => ({ sender: { id } });

test('IPC: עמלות לשני הצדדים, תשלומים, חשבונית פעם אחת, הזמנה וטופס; הגדרות למנהל בלבד', async () => {
  await ipc.initEcon(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-brk-')), { relayUrl: '' });
  await handlers['auth:setup'](ev(95), 'menahel', 'menahel-strong-pass-1');
  await handlers['auth:login'](ev(95), 'menahel', 'menahel-strong-pass-1');
  await handlers['users:create'](ev(95), { username: 'orech', password: 'orech-strong-pass-1', role: 'editor' });
  await handlers['auth:login'](ev(96), 'orech', 'orech-strong-pass-1');

  const seller = await handlers['rlty:createClient'](ev(95), { name: 'משפחת לוי', role: 'seller' });
  const buyer = await handlers['rlty:createClient'](ev(95), { name: 'משפחת כהן', role: 'buyer', idNumber: '000000018' });
  const p = await handlers['rlty:createProperty'](ev(95), { city: 'בני ברק', street: 'רחוב רבי עקיבא 10', asking: 2000000, ownerClientId: seller.id });
  const d = await handlers['rlty:createDeal'](ev(95), { propertyId: p.id, buyerClientId: buyer.id, stage: 'contract' });

  await assert.rejects(handlers['rlty:setCommissions'](ev(95), d.id, { buyer: { type: 'percent', value: 15 } }), /10%/);
  let r = await handlers['rlty:setCommissions'](ev(95), d.id, { buyer: { type: 'percent', value: 2 }, seller: { type: 'fixed', value: 10000 } });
  assert.equal(r.commission.total, 47200 + 11800);
  await assert.rejects(handlers['rlty:addCommissionPayment'](ev(95), d.id, { side: 'buyer', date: '2026-10-20', amount: 0 }), /סכום/);
  const pay = await handlers['rlty:addCommissionPayment'](ev(95), d.id, { side: 'buyer', date: '2026-10-20', amount: 47200, method: 'check' });
  assert.equal(pay.deal.commission.sides.find(s => s.side === 'buyer').state, 'paid');
  await assert.rejects(handlers['rlty:setCommissions'](ev(95), d.id, { seller: { type: 'fixed', value: 10000 } }), /התקבלו תשלומים/);

  let ov = await handlers['rlty:getOverview'](ev(95));
  assert.equal(ov.canInvoice, true);
  assert.equal(ov.isManager, true);
  assert.equal(ov.commissionTotals.balance, 11800);
  assert.equal(ov.deals[0].commissionFees.buyer.value, 2);
  assert.equal(ov.deals[0].commissions, undefined, 'שדות האגורות הפנימיים לא יוצאים למסך');

  await assert.rejects(handlers['rlty:issueCommissionInvoice'](ev(95), d.id, pay.payment.id, {}), /אישור מפורש/);
  const inv = await handlers['rlty:issueCommissionInvoice'](ev(95), d.id, pay.payment.id, { confirmed: true });
  assert.equal(inv.total, 47200);
  await assert.rejects(handlers['rlty:issueCommissionInvoice'](ev(95), d.id, pay.payment.id, { confirmed: true }), /כבר הופקה/);
  await assert.rejects(handlers['rlty:deleteCommissionPayment'](ev(95), d.id, pay.payment.id), /הופקה חשבונית/);
  await assert.rejects(handlers['rlty:deleteDeal'](ev(95), d.id), /תשלומי עמלה/);
  const invoices = await handlers['acct:getInvoices'](ev(95));
  const stored = (invoices.invoices || invoices).find(i => i.id === inv.id);
  assert.equal(stored.customer, 'משפחת כהן');
  // החלטת הבעלים 5.11.2026: הת"ז מכרטיס הלקוח ממולאת מראש בחלון (rltyInvoiceTaxId, ניתנת לעריכה) — השרת לוקח רק את מה שנשלח
  assert.equal(stored.customerTaxId, undefined, 'בלי ערך מהחלון — בלי מספר עוסק / ת"ז (המשתמש מחק את הערך שמולא)');
  assert.equal(stored.status, 'paid');

  // הזמנה
  await assert.rejects(handlers['rlty:saveSettings'](ev(96), { licenseNo: '1' }), /הרשאה/);
  await handlers['rlty:saveSettings'](ev(95), { brokerName: 'משרד התיווך', licenseNo: '12345' });
  const o = await handlers['rlty:saveOrder'](ev(96), '', { clientId: buyer.id, propertyId: p.id, date: '2026-10-20', transaction: 'purchase', price: 2000000, feeType: 'percent', feeValue: 2 });
  assert.equal(o.check.complete, false);
  assert.ok(o.check.missing.includes('כתובת הלקוח'));
  const o2 = await handlers['rlty:saveOrder'](ev(96), o.id, { clientAddress: 'רחוב חזון איש 1', signedDate: '2026-10-21' });
  assert.equal(o2.check.complete, true);
  await assert.rejects(handlers['rlty:deleteClient'](ev(95), seller.id), /עסקאות/);
  const pdf = await handlers['rlty:exportOrderPdf'](ev(96), o.id);
  assert.equal(pdf.ok, false);
  assert.match(pdfHtml.at(-1), /משרד התיווך/);
  assert.match(pdfHtml.at(-1), /12345/);
  await assert.rejects(handlers['rlty:deleteOrder'](ev(96), o.id), /הרשאה/, 'לעורך אין הרשאת מחיקה');
  await handlers['rlty:deleteOrder'](ev(95), o.id);
  ov = await handlers['rlty:getOverview'](ev(96));
  assert.equal(ov.orders.length, 0);
  assert.equal(ov.isManager, false);
});

test('המסך והחשיפה: לשונית הזמנות, עמלות, ערוצים ב-preload, הרשאות', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ui', 'realty.js'), 'utf8');
  for (const s of ['rltyOrderSchema', 'data-rlty-deal', 'rltyFeeSave', 'rltyPayAdd', 'data-rlty-invoice', 'data-rlty-order-pdf', 'rltySaveSettings']) assert.ok(ui.includes(s), s);
  assert.doesNotMatch(ui, /\b(alert|confirm|prompt)\(/);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'preload.js'), 'utf8');
  for (const ch of ['setCommissions', 'addCommissionPayment', 'deleteCommissionPayment', 'issueCommissionInvoice', 'saveOrder', 'deleteOrder', 'exportOrderPdf', 'saveSettings']) assert.ok(preload.includes(`'rlty:${ch}'`), ch);
  assert.equal(ipc.permissionFor('rlty:saveSettings'), 'users.manage');
  assert.equal(ipc.permissionFor('rlty:exportOrderPdf'), 'data.export');
  assert.equal(ipc.permissionFor('rlty:deleteCommissionPayment'), 'data.delete');
});
