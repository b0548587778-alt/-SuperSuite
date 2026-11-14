// ממשק המודול הכלכלי — "צעד אחר צעד" (מצב פשוט, סבב 5): אשפים של שאלה אחת בכל מסך, סדר היום, "טעיתי, לבטל" ועזרה.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
// האשפים לא מחשבים כסף ולא שומרים בעצמם: הם אוספים תשובות ושולחים אותן באותם ערוצים ובאותה סכימה של הטפסים
// (formSchemas / systemAPI), והשרת מאמת ומחשב באגורות. שום דבר לא נשמר לפני "כן, לשמור".
'use strict';

// מזהי המשימות — חוזה משותף עם shell/tasks.js של המעטפת. לשמור זהים (tests/r5-guided-wizards.test.js)
const GUIDED_TASK_IDS = ['donation', 'receipt', 'expense', 'invoice', 'loanPayment', 'gemachLoan', 'contact'];
// ('backup' שבחוזה — פעולה של המעטפת, בלי אשף כאן)

// תחום רישוי לכל תחום של אשף — מראה של ECON_SUB_FEATURES ב-shell/licensing/gate.js (נבדק בבדיקה)
const WIZ_LICENSE_FEATURES = { acct: 'econ.accounting', npo: 'econ.npo', gemach: 'econ.gemach' };
const WIZ_TEXT_MAX = 120;
const WIZ_LONG_MAX = 500;
const WIZ_NUM_MAX = 100000000;

// תשובה מספרית: אותו נרמול כמו בטופס (1,500 / 12,5) — לא חישוב, רק קריאת מה שהוקלד
function wizNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const s = String(v ?? '').trim();
  if (!s) return NaN;
  return Number(normalizeNumberText(s));
}
const wizShekels = (v) => money(wizNumber(v));
const wizOptLabel = (opts, v) => { const o = (opts || []).find(x => x[0] === v); return o ? o[1] : ''; };

// תאריך: מהמעטפת (prefill.date, נבדק) או היום המקומי. _note — "פירוט" מהמעטפת (ייעוד בקבלה / הערה)
const wizDate = (a) => (a && isoOk(a._date) ? a._date : today());
const WIZ_NOTE_MAX = 200;

const WIZ_PAY_METHODS = [['cash', 'מזומן'], ['check', 'המחאה'], ['transfer', 'העברה בנקאית'], ['card', 'כרטיס אשראי']];

// ---------- הגדרות האשפים ----------
// step: { name, type: text|number|choice|textarea, q (השאלה), hint, required, missing (מה חסר ואיך מתקנים), integer, max, options | (ctx) => options }
// prepare(ctx) — טעינת אפשרויות (חשבוניות פתוחות, הלוואות, חשבונות); ctx.blocked — אין עם מה להמשיך.
// submit(a, ctx) — אותו ערוץ של הטופס; מחזיר { message, undo, after }
const WIZARDS = {
  donation: {
    title: 'רישום תרומה והפקת קבלה', action: 'רישום תרומה — צעד אחר צעד', view: 'npo', domain: 'npo', channel: 'npo:addDonation',
    // בלי פרטי העמותה אין קבלה — אומרים את זה לפני השאלה הראשונה, לא אחרי שהכול הוקלד
    prepare: async (ctx) => {
      const o = await window.systemAPI.getNpoOverview(npoYear());
      if (!(o && o.settings && o.settings.orgName)) ctx.blocked = 'כדי להפיק קבלות צריך קודם למלא את פרטי העמותה: במסך "עמותה ותרומות" — כפתור "הגדרות עמותה".';
    },
    steps: [
      { name: 'donorName', type: 'text', required: true, q: 'ממי התרומה?', hint: 'השם המלא של התורם, כמו שיופיע בקבלה.', missing: 'חסר שם התורם — כתבו ממי התרומה.' },
      { name: 'amount', type: 'number', required: true, q: 'כמה נתרם? (בשקלים)', hint: 'מספר בלבד, למשל 100.', missing: 'חסר סכום — כמה נתרם? כתבו מספר, למשל 100.' },
      { name: 'method', type: 'choice', required: true, q: 'איך שולם?', options: WIZ_PAY_METHODS, missing: 'בחרו איך שולמה התרומה.' },
      { name: 'print', type: 'choice', required: true, q: 'לשמור קבלה להדפסה עכשיו?', hint: 'הקבלה תופק בכל מקרה. אפשר להדפיס גם אחר כך ממסך העמותה.',
        options: [['yes', 'כן, לשמור קבלה להדפסה (PDF)'], ['no', 'לא עכשיו']], missing: 'בחרו אם לשמור את הקבלה להדפסה.' }
    ],
    summary: (a) => [['ממי', a.donorName], ['סכום', wizShekels(a.amount)], ['איך שולם', wizOptLabel(WIZ_PAY_METHODS, a.method)],
      ['קבלה', 'תופק קבלה ממוספרת' + (a.print === 'yes' ? ', ותישמר להדפסה' : '')]],
    submit: async (a) => {
      const d = await formSchemas['npo'].create({ date: wizDate(a), donorName: a.donorName, amount: wizNumber(a.amount), method: a.method, ...(a._note ? { purpose: a._note } : {}) });
      const no = d && d.receipt && d.receipt.number;
      return {
        message: `התרומה נרשמה ✓${no ? ' — קבלה מספר ' + no : ''}`,
        undo: d && d.id ? { kind: 'donation', id: d.id, label: no ? String(no) : '' } : null,
        after: a.print === 'yes' && d && d.id ? () => window.systemAPI.exportNpoReceiptPdf(d.id) : null
      };
    }
  },
  receipt: {
    title: 'קבלת תשלום על חשבונית', action: 'קבלת תשלום — צעד אחר צעד', view: 'acct-invoices', domain: 'acct', channel: 'acct:recordPayment',
    prepare: async (ctx) => {
      const list = await window.systemAPI.getInvoices();
      ctx.invoices = (Array.isArray(list) ? list : []).filter(i => i && i.status === 'open' && !fullyCredited(i));
      if (!ctx.invoices.length) ctx.blocked = 'אין כרגע חשבוניות פתוחות — כל החשבוניות כבר שולמו.';
    },
    steps: [
      { name: 'invoiceId', type: 'choice', required: true, q: 'על איזו חשבונית התקבל התשלום?', missing: 'בחרו את החשבונית ששולמה.',
        options: (ctx) => ctx.invoices.map(i => [i.id, `חשבונית ${i.number} · ${i.customer} · ${money(i.balance ?? i.total)}`]) },
      { name: 'method', type: 'choice', required: true, q: 'איך שולם?', options: DOC_PAY_METHODS, missing: 'בחרו איך שולם.' },
      { name: 'reference', type: 'text', q: 'מספר המחאה או אסמכתא (לא חובה)', hint: 'אפשר להשאיר ריק וללחוץ "המשך".' }
    ],
    summary: (a, ctx) => {
      const inv = ctx.invoices.find(i => i.id === a.invoiceId) || {};
      return [['חשבונית', `${inv.number || ''} · ${inv.customer || ''}`], ['סכום', money(inv.balance ?? inv.total)], ['איך שולם', wizOptLabel(DOC_PAY_METHODS, a.method)],
        ...(a.reference ? [['אסמכתא', a.reference]] : []), ['קבלה', 'תופק קבלה ממוספרת']];
    },
    submit: async (a) => {
      await window.systemAPI.recordPayment(a.invoiceId, { date: wizDate(a), method: a.method, reference: a.reference || '' });
      return { message: 'התשלום נרשם והופקה קבלה ✓', undo: { kind: 'receipt', invoiceId: a.invoiceId } };
    }
  },
  expense: {
    title: 'רישום הוצאה', action: 'רישום הוצאה — צעד אחר צעד', view: 'acct-journal', domain: 'acct', channel: 'acct:createEntry',
    prepare: async (ctx) => {
      const chart = await window.systemAPI.getChart();
      const list = Array.isArray(chart) ? chart : [];
      ctx.expenseAccounts = list.filter(x => x && x.type === 'expense').map(x => [String(x.code), x.name]);
      const has = new Set(list.map(x => String(x.code)));
      ctx.payAccounts = [['1000', 'שילמתי (מזומן, בנק או אשראי)'], ['2000', 'עוד לא שילמתי — חוב לספק']].filter(o => has.has(o[0]));
      if (!ctx.expenseAccounts.length || !ctx.payAccounts.length) ctx.blocked = 'חסרים חשבונות בתוכנית החשבונות — אפשר לרשום הוצאה במסך "יומן חשבונאי".';
    },
    steps: [
      { name: 'description', type: 'text', required: true, q: 'על מה ההוצאה?', hint: 'למשל: נייר למשרד, חשבון חשמל.', missing: 'חסר תיאור — כתבו על מה ההוצאה.' },
      { name: 'amount', type: 'number', required: true, q: 'כמה שילמת? (בשקלים)', hint: 'הסכום הכולל, מספר בלבד.', missing: 'חסר סכום — כמה עלתה ההוצאה? כתבו מספר, למשל 250.' },
      { name: 'debitAccount', type: 'choice', required: true, q: 'איזה סוג הוצאה זו?', options: (ctx) => ctx.expenseAccounts, missing: 'בחרו את סוג ההוצאה. לא בטוחים? בחרו "הוצאות שונות".' },
      { name: 'creditAccount', type: 'choice', required: true, q: 'כבר שילמת?', options: (ctx) => ctx.payAccounts, missing: 'בחרו אם כבר שילמתם.' }
    ],
    summary: (a, ctx) => [['על מה', a.description], ['סכום', wizShekels(a.amount)], ['סוג ההוצאה', wizOptLabel(ctx.expenseAccounts, a.debitAccount)],
      ['תשלום', wizOptLabel(ctx.payAccounts, a.creditAccount)]],
    submit: async (a) => {
      // אותה סכימה של "רשומת יומן חדשה" — העיגול לאגורות והאיזון שם, לא כאן
      const e = await formSchemas['acct-journal'].create({ date: wizDate(a), description: a.description, debitAccount: a.debitAccount, creditAccount: a.creditAccount, amount: wizNumber(a.amount) });
      return { message: 'ההוצאה נרשמה ✓', undo: e && e.id ? { kind: 'entry', id: e.id } : null };
    }
  },
  invoice: {
    title: 'חשבונית חדשה', action: 'חשבונית חדשה — צעד אחר צעד', view: 'acct-invoices', domain: 'acct', channel: 'acct:createInvoice',
    steps: [
      { name: 'customer', type: 'text', required: true, q: 'למי החשבונית?', hint: 'שם הלקוח, כמו שיופיע בחשבונית.', missing: 'חסר שם הלקוח — כתבו למי החשבונית.' },
      { name: 'description', type: 'text', required: true, q: 'על מה?', hint: 'שם המוצר או השירות, למשל: שיעורי עזר.', missing: 'חסר תיאור — כתבו על מה החשבונית.' },
      { name: 'unitPrice', type: 'number', required: true, q: 'כמה זה עולה, לפני מע"מ? (בשקלים)', hint: 'המע"מ יחושב ויתווסף בשמירה.', missing: 'חסר מחיר — כמה זה עולה? כתבו מספר, למשל 250.' },
      { name: 'paid', type: 'choice', required: true, q: 'הלקוח כבר שילם?', hint: 'אם שילם — תופק "חשבונית מס/קבלה" אחת.',
        options: [['no', 'עוד לא שילם'], ...DOC_PAY_METHODS.map(([v, l]) => [v, 'כן, שילם — ' + l])], missing: 'בחרו אם הלקוח כבר שילם.' }
    ],
    summary: (a) => [['למי', a.customer], ['על מה', a.description], ['מחיר לפני מע"מ', wizShekels(a.unitPrice)],
      ['תשלום', a.paid === 'no' ? 'עוד לא שולמה' : 'שולמה — ' + wizOptLabel(DOC_PAY_METHODS, a.paid)], ['מספר', 'החשבונית תקבל מספר בשמירה']],
    submit: async (a) => {
      const inv = await formSchemas['acct-invoices'].create({ customer: a.customer, date: wizDate(a), description: a.description, unitPrice: wizNumber(a.unitPrice),
        kind: 'goods', vatExempt: 'no', paidNow: a.paid === 'no' ? '' : a.paid, paymentRef: '' });
      return { message: `החשבונית הופקה ✓${inv && inv.number ? ' — מספר ' + inv.number : ''}`,
        undo: inv && inv.id ? { kind: inv.status === 'paid' ? 'paidInvoice' : 'invoice', id: inv.id, label: inv.number ? String(inv.number) : '' } : null };
    }
  },
  loanPayment: {
    title: 'החזר הלוואה בגמ"ח', action: 'רישום החזר הלוואה — צעד אחר צעד', view: 'gemach', domain: 'gemach', channel: 'gemach:recordPayment',
    prepare: async (ctx) => {
      const ov = await window.systemAPI.getGemachOverview();
      ctx.loans = ((ov && Array.isArray(ov.loans)) ? ov.loans : []).filter(l => l && l.status === 'active');
      if (!ctx.loans.length) ctx.blocked = 'אין כרגע הלוואות פעילות בגמ"ח.';
    },
    steps: [
      { name: 'loanId', type: 'choice', required: true, q: 'מי החזיר?', missing: 'בחרו את הלווה שהחזיר.',
        options: (ctx) => ctx.loans.map(l => [l.id, `${l.borrowerName} · נשאר להחזיר ${money(l.outstanding)}`]) },
      { name: 'amount', type: 'number', q: 'כמה הוחזר? (בשקלים)', hint: 'אפשר להשאיר ריק — אז יירשם כל התשלום הבא בלוח.' }
    ],
    summary: (a, ctx) => {
      const l = ctx.loans.find(x => x.id === a.loanId) || {};
      return [['מי החזיר', l.borrowerName || ''], ['סכום', a.amount ? wizShekels(a.amount) : 'כל התשלום הבא בלוח']];
    },
    submit: async (a) => {
      const loan = await window.systemAPI.getGemachLoan(a.loanId);
      const row = ((loan && loan.schedule) || []).find(s => s.status !== 'paid');
      if (!row) throw new Error('בהלוואה הזו אין תשלום פתוח — היא כבר נפרעה.');
      // אותה סכימה של "רישום תשלום" בטופס; הסכום והיתרה נבדקים בשרת
      const res = await gemachPaymentSchema(a.loanId, row.seq, 0).create({ date: wizDate(a), ...(a.amount ? { amount: wizNumber(a.amount) } : {}) });
      const after = ((res && res.schedule) || []).find(s => s.seq === row.seq);
      return { message: 'ההחזר נרשם ✓',
        undo: after ? { kind: 'loanPayment', loanId: a.loanId, seq: row.seq, from: after.paidAg, to: row.paidAg } : null };
    }
  },
  gemachLoan: {
    title: 'הלוואה חדשה בגמ"ח', action: 'הלוואה חדשה — צעד אחר צעד', view: 'gemach', domain: 'gemach', channel: 'gemach:addLoan',
    steps: [
      { name: 'borrowerName', type: 'text', required: true, q: 'למי ההלוואה?', hint: 'השם המלא של הלווה.', missing: 'חסר שם הלווה — כתבו למי ההלוואה.' },
      { name: 'amount', type: 'number', required: true, q: 'כמה להלוות? (בשקלים)', hint: 'מספר בלבד, למשל 5000.', missing: 'חסר סכום — כמה להלוות? כתבו מספר, למשל 5000.' },
      { name: 'installments', type: 'number', integer: true, required: true, q: 'בכמה תשלומים חודשיים יוחזר?', hint: 'מספר שלם, למשל 10.', missing: 'חסר מספר תשלומים — בכמה חודשים יוחזר? למשל 10.' },
      { name: 'guarantorsText', type: 'textarea', q: 'מי הערבים? (לא חובה)', hint: 'שורה לכל ערב: שם, ת.ז, טלפון. אפשר להוסיף גם אחר כך.' }
    ],
    summary: (a) => [['למי', a.borrowerName], ['סכום', wizShekels(a.amount)], ['תשלומים', String(wizNumber(a.installments)) + ' תשלומים חודשיים'],
      ['ערבים', a.guarantorsText ? String(a.guarantorsText).split('\n').filter(x => x.trim()).length + ' ערבים' : 'בלי ערבים']],
    submit: async (a) => {
      const l = await formSchemas['gemach'].create({ borrowerName: a.borrowerName, amount: wizNumber(a.amount), installments: wizNumber(a.installments),
        issueDate: wizDate(a), ...(a.guarantorsText ? { guarantorsText: a.guarantorsText } : {}) });
      return { message: 'ההלוואה נרשמה ✓ — לוח התשלומים מוכן', undo: l && l.id ? { kind: 'gemachLoan', id: l.id } : null };
    }
  },
  contact: {
    title: 'איש קשר חדש', action: 'איש קשר חדש — צעד אחר צעד', view: 'contacts', domain: '', channel: 'contacts:create',
    steps: [
      { name: 'name', type: 'text', required: true, q: 'איך קוראים לאיש הקשר?', missing: 'חסר שם — כתבו איך קוראים לאיש הקשר.' },
      { name: 'phone', type: 'text', q: 'מה מספר הטלפון? (לא חובה)', hint: 'אפשר להשאיר ריק וללחוץ "המשך".', max: 30 },
      { name: 'address', type: 'text', q: 'מה הכתובת? (לא חובה)', hint: 'אפשר להשאיר ריק וללחוץ "המשך".' }
    ],
    summary: (a) => [['שם', a.name], ['טלפון', a.phone || '—'], ['כתובת', a.address || '—']],
    submit: async (a) => {
      const c = await formSchemas['contacts'].create({ name: a.name, ...(a.phone ? { phone: a.phone } : {}), ...(a.address ? { address: a.address } : {}), ...(a._note ? { notes: a._note } : {}) });
      return { message: 'איש הקשר נשמר ✓', undo: c && c.id ? { kind: 'contact', id: c.id } : null };
    }
  }
};

// אשפים לכל מסך (הראשון — ל"＋ הוספת רשומה" במצב פשוט)
const VIEW_TASKS = {
  'npo': ['donation'],
  'acct-invoices': ['invoice', 'receipt'],
  'acct-journal': ['expense'],
  'gemach': ['gemachLoan', 'loanPayment'],
  'contacts': ['contact']
};

// ---------- הרשאה ורישיון ----------
const wizHasPerm = (perm) => !!(state.user && Array.isArray(state.user.permissions) && state.user.permissions.includes(perm));
async function ensureWizLicense() {
  if (state.wizLicense !== undefined) return state.wizLicense;
  try { state.wizLicense = await window.systemAPI.getLicenseStatus(); } catch { state.wizLicense = null; }
  return state.wizLicense;
}
// st — license:getStatus. בלי רישוי — הכול פתוח; רישיון שאינו פעיל (קריאה בלבד / נעול) — אין רישום חדש
function wizLicenseOpen(st, domain) {
  if (!st || st.mode === 'unlicensed') return true;
  if (st.status !== 'active') return false;
  const have = new Set(Array.isArray(st.features) ? st.features : []);
  if (!have.has('econ')) return false;
  return !domain || !WIZ_LICENSE_FEATURES[domain] || have.has(WIZ_LICENSE_FEATURES[domain]);
}
// בדיקה מיידית (לרינדור): כשהרישיון עוד לא נטען — לפי ההרשאה בלבד; השרת אוכף בכל מקרה
function wizardAllowedSync(taskId) {
  const def = Object.prototype.hasOwnProperty.call(WIZARDS, taskId) ? WIZARDS[taskId] : null;
  if (!def || !wizHasPerm('data.edit')) return false;
  return state.wizLicense === undefined ? true : wizLicenseOpen(state.wizLicense, def.domain);
}
async function wizardAvailability(taskId) {
  const def = WIZARDS[taskId];
  if (!wizHasPerm('data.edit')) return { ok: false, reason: 'אין לכם הרשאה לרשום דברים חדשים — פנו למנהל המערכת.' };
  if (!wizLicenseOpen(await ensureWizLicense(), def.domain)) return { ok: false, reason: 'התחום הזה אינו פתוח ברישיון של המערכת, או שהמערכת במצב קריאה בלבד. פרטים במסך "רישוי ומערכות".' };
  return { ok: true };
}

// ---------- קלט מהמעטפת (prefill) — לא מהימן ----------
// רק שמות של שלבי האשף; טקסט מקוצר ובלי תווי בקרה; מספר חיובי וסביר; בחירה — רק מהאפשרויות שנטענו.
// אף פעם לא שומר לבד: האשף מתחיל בשאלה הראשונה, והשמירה רק ב"כן, לשמור"
// שדות המעטפת (shell/tasks.js → FIELDS: name, amount, date, note, phone, installments) ← שלבי האשף.
// שם ← רשומה (חשבונית / הלוואה) רק כשיש בדיוק אחת בשם הזה; אחרת המשתמש בוחר
const wizSameName = (a, b) => String(a || '').replace(/\s+/g, ' ').trim() === String(b || '').replace(/\s+/g, ' ').trim();
function wizUnique(list, pick) { return list.length === 1 ? pick(list[0]) : undefined; }
const SHELL_PREFILL = {
  donation: (p) => ({ donorName: p.name, amount: p.amount }),
  receipt: (p, ctx) => ({ invoiceId: p.name ? wizUnique((ctx.invoices || []).filter(i => wizSameName(i.customer, p.name)), i => i.id) : undefined }),
  expense: (p) => ({ description: p.note || p.name, amount: p.amount }),
  invoice: (p) => ({ customer: p.name, unitPrice: p.amount, description: p.note }),
  loanPayment: (p, ctx) => ({ loanId: p.name ? wizUnique((ctx.loans || []).filter(l => wizSameName(l.borrowerName, p.name)), l => l.id) : undefined, amount: p.amount }),
  gemachLoan: (p) => ({ borrowerName: p.name, amount: p.amount, installments: p.installments }),
  contact: (p) => ({ name: p.name, phone: p.phone })
};
function sanitizePrefill(def, prefill, ctx = {}) {
  const out = {};
  if (!def || !prefill || typeof prefill !== 'object' || Array.isArray(prefill)) return out;
  const proto = Object.getPrototypeOf(prefill);
  if (proto !== Object.prototype && proto !== null) return out;
  // תאריך ופירוט מהמעטפת — לא שלבים: נשמרים בצד, מוצגים בסיכום ונבדקים כאן
  if (typeof prefill.date === 'string' && isoOk(prefill.date)) out._date = prefill.date;
  // eslint-disable-next-line no-control-regex
  if (typeof prefill.note === 'string') { const n = prefill.note.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, WIZ_NOTE_MAX); if (n) out._note = n; }
  // שדות המעטפת ממופים לשלבים; שם של שלב (למשל loanId מסדר היום) גובר
  const id = Object.keys(WIZARDS).find(k => WIZARDS[k] === def);
  const shell = id && SHELL_PREFILL[id] ? SHELL_PREFILL[id](prefill, ctx) : {};
  const own = {};
  for (const step of def.steps) if (Object.prototype.hasOwnProperty.call(prefill, step.name)) own[step.name] = prefill[step.name];
  prefill = { ...shell, ...own };
  for (const step of def.steps) {
    if (!Object.prototype.hasOwnProperty.call(prefill, step.name)) continue;
    const raw = prefill[step.name];
    if (raw === null || raw === undefined || (typeof raw === 'object')) continue;
    if (typeof raw !== 'string' && typeof raw !== 'number') continue;
    if (step.type === 'number') {
      const n = wizNumber(raw);
      if (!Number.isFinite(n) || n <= 0 || n > WIZ_NUM_MAX || (step.integer && !Number.isInteger(n))) continue;
      out[step.name] = String(n);
    } else if (step.type === 'choice') {
      const v = String(raw);
      if (wizStepOptions(step, ctx).some(o => o[0] === v)) out[step.name] = v;
    } else {
      const max = step.max || (step.type === 'textarea' ? WIZ_LONG_MAX : WIZ_TEXT_MAX);
      // eslint-disable-next-line no-control-regex
      const clean = String(raw).replace(step.type === 'textarea' ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
      if (clean) out[step.name] = clean;
    }
  }
  return out;
}
function wizStepOptions(step, ctx) {
  const o = typeof step.options === 'function' ? step.options(ctx || {}) : step.options;
  return Array.isArray(o) ? o : [];
}

// ---------- האשף על המסך ----------
let wizActive = null;
// נקרא מהמעטפת (תיבת הפקודה / סדר היום) ומכפתורי המסך. מחזיר true כשהאשף נפתח
// view — המסך של המשימה (shell/tasks.js); כשהוא תקין, עוברים אליו קודם, כדי שהשמירה תתרענן במסך הנכון
async function econStartTask(taskId, prefill, view) {
  const id = String(taskId || '');
  if (!GUIDED_TASK_IDS.includes(id) || !Object.prototype.hasOwnProperty.call(WIZARDS, id)) { showError('המשימה הזו לא מוכרת במערכת הכספים.'); return false; }
  const def = WIZARDS[id];
  const target = typeof view === 'string' && Object.prototype.hasOwnProperty.call(viewTitles, view) ? view : '';
  // לפני כניסה — נפתח מיד אחרי הכניסה (אותה צורה כמו בקשה מהמעטפת: openShellRequest ב-ui/core.js)
  if (!state.user) { state.requestedView = target || def.view; state.requestedTask = { view: target || def.view, task: id, prefill }; return false; }
  if (wizActive) { wizFocus(); return false; }
  if (target && target !== state.currentView) await switchView(target, { focus: true });
  const ok = await wizardAvailability(id);
  if (!ok.ok) { showError(ok.reason); return false; }
  const ctx = {};
  try { if (def.prepare) await def.prepare(ctx); }
  catch (error) { showError('לא הצלחנו לפתוח את האשף — ' + errMsg(error)); return false; }
  if (ctx.blocked) { showToast(ctx.blocked); return false; }
  wizOpen(id, def, sanitizePrefill(def, prefill, ctx), ctx);
  return true;
}

function wizOpen(id, def, answers, ctx) {
  const returnTo = rememberFocus();
  const overlay = document.createElement('div');
  overlay.className = 'modal wiz';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'wizTitle');
  overlay.setAttribute('data-task', id);
  overlay.innerHTML = `<div class="modal-card wiz-card">
      <h2 id="wizTitle">${esc(def.title)}</h2>
      <p id="wizProgress" class="wiz-progress" aria-live="polite"></p>
      <div id="wizBody" class="wiz-body"></div>
      <div id="wizError" class="form-error wiz-error" role="alert" hidden></div>
      <div class="modal-actions wiz-actions">
        <button type="button" class="secondary wiz-btn" id="wizBack">חזרה</button>
        <button type="button" class="primary wiz-btn" id="wizNext">המשך</button>
      </div>
      <p class="wiz-exit"><button type="button" class="link" id="wizExit">יציאה בלי לשמור</button>${formSchemas[def.view] && VIEW_TASKS[def.view] && VIEW_TASKS[def.view][0] === id ? ' · <button type="button" class="link" id="wizFullForm">לטופס המלא</button>' : ''}</p>
    </div>`;
  document.body.appendChild(overlay);
  wizActive = { id, def, answers: { ...answers }, prefilled: { ...answers }, ctx, step: 0, overlay, returnTo, busy: false };
  const onKey = (e) => {
    if (!wizActive || wizActive.overlay !== overlay) return;
    // חלון אישור מעל האשף — הוא מטפל במקשים
    const top = [...document.querySelectorAll('.modal')].filter(m => m !== overlay && m.id !== 'modal');
    if (top.length) return;
    if (e.key === 'Escape') { e.preventDefault(); wizAskExit(); return; }
    if (e.key === 'Enter' && e.target && e.target.id === 'wizInput' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); wizNext(); return; }
    trapTab(e, overlay);
  };
  wizActive.onKey = onKey;
  document.addEventListener('keydown', onKey, true);
  overlay.querySelector('#wizBack').addEventListener('click', () => wizBack());
  overlay.querySelector('#wizNext').addEventListener('click', () => wizNext());
  overlay.querySelector('#wizExit').addEventListener('click', () => wizAskExit());
  const full = overlay.querySelector('#wizFullForm');
  if (full) full.addEventListener('click', async () => { if (await wizAskExit()) handleAdd({ form: true }); });
  wizRender();
}

function wizClose() {
  const w = wizActive;
  if (!w) return;
  wizActive = null;
  document.removeEventListener('keydown', w.onKey, true);
  w.overlay.remove();
  restoreFocus(w.returnTo);
}
function wizFocus() {
  if (!wizActive) return;
  // לפי סדר עדיפות (querySelector עם רשימה מחזיר לפי סדר המסמך — והשאלה קודמת לשדה)
  for (const sel of ['#wizInput', 'input[name="wizChoice"]:checked', 'input[name="wizChoice"]', '#wizQ']) {
    const el = wizActive.overlay.querySelector(sel);
    if (el && typeof el.focus === 'function') { el.focus(); return; }
  }
}
// "יציאה" / Escape: אם הוקלד משהו — שאלה לפני שמאבדים אותו. מחזיר true כשהאשף נסגר
async function wizAskExit() {
  const w = wizActive;
  if (!w || w.busy) return false;
  wizCapture(false);
  const typed = Object.keys(w.answers).some(k => String(w.answers[k] || '').trim() && w.answers[k] !== w.prefilled[k]);
  if (typed && !(await askConfirm('לצאת? מה שהוקלד לא יישמר.', { danger: true, okText: 'כן, לצאת', cancelText: 'לא, להמשיך' }))) { wizFocus(); return false; }
  if (wizActive === w) wizClose();
  return true;
}

// שלב נוכחי ← DOM. step === steps.length — מסך הסיכום
function wizRender() {
  const w = wizActive;
  const { def, step, overlay } = w;
  const total = def.steps.length;
  const body = overlay.querySelector('#wizBody');
  const err = overlay.querySelector('#wizError');
  err.textContent = '';
  err.hidden = true;
  const back = overlay.querySelector('#wizBack');
  const next = overlay.querySelector('#wizNext');
  back.hidden = step === 0;
  if (step >= total) {
    overlay.querySelector('#wizProgress').textContent = 'בדיקה לפני שמירה — עוד לא נשמר דבר';
    const extra = [...(w.answers._date && w.answers._date !== today() ? [['תאריך', w.answers._date]] : []), ...(w.answers._note ? [['פירוט', w.answers._note]] : [])];
    const rows = [...def.summary(w.answers, w.ctx), ...extra].map(([k, v]) => `<div class="wiz-sum-row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    body.innerHTML = `<h3 id="wizQ" class="wiz-q" tabindex="-1">זה מה שיירשם:</h3><dl class="wiz-summary">${rows}</dl>` +
      '<p class="ss-hint">הכול נכון? לחצו "כן, לשמור". רוצים לשנות? "חזרה לתיקון".</p>';
    next.textContent = 'כן, לשמור';
    back.textContent = 'חזרה לתיקון';
    overlay.querySelector('#wizQ').focus();
    return;
  }
  next.textContent = 'המשך';
  back.textContent = 'חזרה';
  overlay.querySelector('#wizProgress').textContent = `שלב ${step + 1} מתוך ${total}`;
  const s = def.steps[step];
  const val = w.answers[s.name] ?? '';
  const hint = s.hint ? `<p id="wizHint" class="ss-hint wiz-hint">${esc(s.hint)}</p>` : '';
  const desc = s.hint ? ' aria-describedby="wizHint"' : '';
  if (s.type === 'choice') {
    const opts = wizStepOptions(s, w.ctx);
    body.innerHTML = `<fieldset class="wiz-choices"${desc}><legend id="wizQ" class="wiz-q">${esc(s.q)}</legend>` +
      opts.map(([v, l], i) => `<label class="wiz-choice"><input type="radio" name="wizChoice" id="wizOpt${i}" value="${esc(v)}"${String(val) === String(v) ? ' checked' : ''}${s.required ? ' aria-required="true"' : ''}> <span>${esc(l)}</span></label>`).join('') +
      `</fieldset>${hint}`;
  } else {
    const max = s.max || (s.type === 'textarea' ? WIZ_LONG_MAX : WIZ_TEXT_MAX);
    const req = s.required ? ' aria-required="true"' : '';
    const input = s.type === 'textarea'
      ? `<textarea id="wizInput" class="ss-input wiz-input" rows="4" maxlength="${max}"${req}${desc}>${esc(val)}</textarea>`
      : `<input id="wizInput" class="ss-input wiz-input" type="text"${s.type === 'number' ? ' inputmode="decimal"' : ''} maxlength="${max}" autocomplete="off" value="${esc(val)}"${req}${desc}>`;
    body.innerHTML = `<label for="wizInput" id="wizQ" class="wiz-q">${esc(s.q)}</label>${input}${hint}`;
  }
  wizFocus();
}

// קריאת התשובה של השלב הנוכחי. check — בדיקה (המשך); בלי — רק שמירה (חזרה / יציאה)
function wizCapture(check) {
  const w = wizActive;
  if (!w || w.step >= w.def.steps.length) return true;
  const s = w.def.steps[w.step];
  const body = w.overlay.querySelector('#wizBody');
  let v = '';
  if (s.type === 'choice') {
    const c = [...body.querySelectorAll('input[name="wizChoice"]')].find(r => r.checked);
    v = c ? c.value : '';
  } else {
    const el = body.querySelector('#wizInput');
    v = el ? String(el.value || '').trim() : '';
  }
  w.answers[s.name] = v;
  if (!check) return true;
  let problem = '';
  if (!v) problem = s.required ? (s.missing || 'חסרה תשובה — מלאו ולחצו "המשך".') : '';
  else if (s.type === 'number') {
    const n = wizNumber(v);
    if (!Number.isFinite(n)) problem = 'כתבו מספר בלבד, בלי אותיות — למשל 100.';
    else if (n <= 0) problem = 'המספר צריך להיות גדול מאפס.';
    else if (n > WIZ_NUM_MAX) problem = 'המספר גדול מדי — בדקו שלא נוספו אפסים.';
    else if (s.integer && !Number.isInteger(n)) problem = 'כתבו מספר שלם, בלי נקודה — למשל 10.';
  } else if (s.type === 'choice' && !wizStepOptions(s, w.ctx).some(o => o[0] === v)) problem = s.missing || 'בחרו אחת מהאפשרויות.';
  if (problem) { wizError(problem); return false; }
  return true;
}
function wizError(message) {
  const w = wizActive;
  const err = w.overlay.querySelector('#wizError');
  err.textContent = message;
  err.hidden = false;
  const input = w.overlay.querySelector('#wizInput') || w.overlay.querySelector('input[name="wizChoice"]');
  if (input && input.setAttribute) {
    input.setAttribute('aria-invalid', 'true');
    const ids = String(input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    if (!ids.includes('wizError')) input.setAttribute('aria-describedby', ['wizError', ...ids].join(' '));
  }
  if (input && typeof input.focus === 'function') input.focus();
}
function wizBack() {
  const w = wizActive;
  if (!w || w.busy || w.step === 0) return;
  wizCapture(false);
  w.step -= 1;
  wizRender();
}
async function wizNext() {
  const w = wizActive;
  if (!w || w.busy) return;
  if (w.step < w.def.steps.length) {
    if (!wizCapture(true)) return;
    w.step += 1;
    wizRender();
    return;
  }
  // "כן, לשמור" — השמירה היחידה באשף
  w.busy = true;
  const btns = [...w.overlay.querySelectorAll('button')];
  btns.forEach(b => { b.disabled = true; });
  let result;
  try {
    result = await w.def.submit(w.answers, w.ctx);
  } catch (error) {
    w.busy = false;
    btns.forEach(b => { b.disabled = false; });
    const err = w.overlay.querySelector('#wizError');
    err.textContent = 'לא נשמר — ' + errMsg(error).replace(/[.!?]?\s*$/, '.') + ' אפשר ללחוץ "חזרה לתיקון".';
    err.hidden = false;
    return;
  }
  const view = state.currentView;
  const doneId = w.id;
  wizClose();
  showUndoToast((result && result.message) || 'נשמר ✓', result && result.undo);
  wizShowSuccess(doneId, (result && result.message) || 'נשמר');
  if (result && typeof result.after === 'function') {
    try { const r = await result.after(); if (r && r.ok) showToast('הקבלה נשמרה להדפסה'); }
    catch (error) { showError('הקבלה נשמרה במערכת, אבל קובץ ההדפסה לא נשמר — ' + errMsg(error)); }
  }
  if (state.user && state.currentView === view) await switchView(view);
}

// ---------- מסך הצלחה: סימן גדול, "היום עשית", ו"עוד אחת" ----------
// הספירה — העדפת תצוגה בלבד (localStorage של המסך, לפי יום); לא נתוני משתמש ולא נכנסת לגיבוי. קלט מהאחסון לא מהימן
const WIZ_DONE_KEY = 'econ.doneToday';
function wizDoneRead() {
  try {
    const o = JSON.parse(localStorage.getItem(WIZ_DONE_KEY) || 'null');
    if (!o || typeof o !== 'object' || o.day !== today() || !o.n || typeof o.n !== 'object') return {};
    const out = {};
    for (const id of GUIDED_TASK_IDS) if (Number.isInteger(o.n[id]) && o.n[id] > 0 && o.n[id] < 100000) out[id] = o.n[id];
    return out;
  } catch { return {}; }
}
// עותק בזיכרון — כשאין אחסון (או שהוא נדחה) הספירה נכונה לפחות עד סגירת התוכנה
let wizDoneMem = { day: '', n: {} };
function wizDoneBump(id) {
  if (wizDoneMem.day !== today()) wizDoneMem = { day: today(), n: {} };
  const stored = wizDoneRead();
  const n = wizDoneMem.n;
  n[id] = Math.max(n[id] || 0, stored[id] || 0) + 1;
  try { localStorage.setItem(WIZ_DONE_KEY, JSON.stringify({ day: today(), n: { ...stored, ...n } })); } catch { /* העדפה בלבד */ }
  return n[id];
}
function wizShowSuccess(id, message) {
  if (!Object.prototype.hasOwnProperty.call(WIZARDS, id)) return;
  const count = wizDoneBump(id);
  const returnTo = rememberFocus();
  const overlay = document.createElement('div');
  overlay.className = 'wiz-done-layer'; // לא .modal: שכבה נמוכה מהטוסט, כדי ש"טעיתי, לבטל" יישאר לחיץ מעליה
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'wizDoneTitle');
  overlay.innerHTML = `<div class="modal-card wiz-card wiz-done-card">
      <div class="wiz-done-mark" aria-hidden="true">✓</div>
      <h2 id="wizDoneTitle" tabindex="-1">${esc(String(message).replace(/s*✓s*$/, ''))}</h2>
      <p class="wiz-done-count">${count === 1 ? 'יפה מאוד! זו הפעם הראשונה היום.' : `יפה מאוד! היום כבר עשיתם את זה ${count} פעמים.`}</p>
      <p class="ss-hint">טעיתם? יש חצי דקה ללחוץ "טעיתי, לבטל" בהודעה שבראש המסך.</p>
      <div class="modal-actions wiz-actions">
        <button type="button" class="secondary wiz-btn" id="wizDoneAgain">עוד אחת</button>
        <button type="button" class="primary wiz-btn" id="wizDoneClose">סיימתי</button>
      </div>
    </div>`;
  const close = () => { document.removeEventListener('keydown', onKey, true); overlay.remove(); restoreFocus(returnTo); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    trapTab(e, overlay);
  };
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(overlay);
  overlay.querySelector('#wizDoneClose').addEventListener('click', close);
  overlay.querySelector('#wizDoneAgain').addEventListener('click', async () => { close(); await econStartTask(id); });
  const focusEl = overlay.querySelector('#wizDoneClose');
  if (focusEl && typeof focusEl.focus === 'function') focusEl.focus();
}

// ---------- "טעיתי, לבטל" — 30 שניות אחרי שמירה ----------
// רשומה בלי מספר חוקי — הערוץ הקיים של מחיקה / ביטול (הרשאה ויומן בשרת). מסמך ממוספר (קבלה, חשבונית) לא נמחק:
// המסלול החוקי (קבלה מבוטלת / חשבונית זיכוי) ורק אחרי אישור מפורש. perm — כמו permissionFor של הערוץ (נבדק)
const UNDO_MS = 30000;
const UNDO_KINDS = {
  donation: { channel: 'npo:cancelDonation', perm: 'data.delete', numbered: true,
    confirm: (s) => `לבטל את הקבלה${s.label ? ' מספר ' + s.label : ''}? הקבלה לא תימחק — היא תסומן "מבוטלת", והמספר שלה לא ישמש שוב. אם התרומה כבר דווחה לרשות המסים, צריך לדווח גם על הביטול.`,
    run: (s) => window.systemAPI.cancelNpoDonation(s.id), done: 'הקבלה בוטלה (סומנה "מבוטלת")' },
  receipt: { channel: 'acct:unrecordPayment', perm: 'data.delete', numbered: true,
    confirm: () => 'לבטל את הקבלה? היא לא תימחק — תסומן "מבוטלת", תירשם רשומת ביטול ביומן, והחשבונית תחזור להיות פתוחה.',
    run: (s) => window.systemAPI.unrecordPayment(s.invoiceId), done: 'הקבלה בוטלה והחשבונית חזרה להיות פתוחה' },
  invoice: { channel: 'acct:cancelInvoice', perm: 'data.delete', numbered: true,
    confirm: (s) => `לבטל את החשבונית${s.label ? ' מספר ' + s.label : ''}? חשבונית לא נמחקת — תופק חשבונית זיכוי ממוספרת שמבטלת אותה, ואותה צריך למסור ללקוח.`,
    run: (s) => window.systemAPI.cancelInvoice(s.id), done: 'החשבונית בוטלה — הופקה חשבונית זיכוי' },
  paidInvoice: { channel: 'acct:createCreditNote', perm: 'data.edit', numbered: true,
    confirm: (s) => `לבטל את החשבונית${s.label ? ' מספר ' + s.label : ''}? היא כבר סומנה כשולמה, ולכן תופק חשבונית זיכוי מלאה וממוספרת. אם הכסף הוחזר ללקוח — רשמו זאת בנפרד.`,
    run: (s) => window.systemAPI.createCreditNote(s.id, { reason: 'ביטול מיד אחרי ההפקה — טעות בהקלדה', date: today() }), done: 'הופקה חשבונית זיכוי לחשבונית' },
  entry: { channel: 'acct:reverseEntry', perm: 'data.delete', numbered: false,
    run: (s) => window.systemAPI.reverseEntry(s.id), done: 'הרישום בוטל (נרשמה רשומת ביטול)' },
  loanPayment: { channel: 'gemach:reversePayment', perm: 'data.delete', numbered: false,
    run: (s) => window.systemAPI.reverseGemachPayment(s.loanId, s.seq, { from: s.from, to: s.to }), done: 'ההחזר בוטל' },
  gemachLoan: { channel: 'gemach:cancelLoan', perm: 'data.delete', numbered: false,
    run: (s) => window.systemAPI.cancelGemachLoan(s.id), done: 'ההלוואה בוטלה' },
  contact: { channel: 'contacts:delete', perm: 'data.delete', numbered: false,
    run: (s) => window.systemAPI.deleteContact(s.id), done: 'איש הקשר נמחק' }
};
// ביטול אחרי שמירה בטופס הרגיל (לא באשף): המסך ← סוג הביטול לפי מה שהשרת החזיר
const FORM_UNDO = {
  'npo': (r) => r && r.id && r.receipt && Number.isInteger(r.receipt.number) ? { kind: 'donation', id: r.id, label: String(r.receipt.number) } : null,
  'acct-invoices': (r) => r && r.id && r.number ? { kind: r.status === 'paid' ? 'paidInvoice' : 'invoice', id: r.id, label: String(r.number) } : null,
  'acct-journal': (r) => r && r.id ? { kind: 'entry', id: r.id } : null,
  'gemach': (r) => r && r.id ? { kind: 'gemachLoan', id: r.id } : null,
  'contacts': (r) => r && r.id ? { kind: 'contact', id: r.id } : null
};
function formUndoSpec(view, created) {
  const f = Object.prototype.hasOwnProperty.call(FORM_UNDO, view) ? FORM_UNDO[view] : null;
  return f ? f(created) : null;
}
const canUndo = (spec) => !!(spec && UNDO_KINDS[spec.kind] && wizHasPerm(UNDO_KINDS[spec.kind].perm));

function showUndoToast(message, spec) {
  const toast = document.createElement('div');
  toast.className = 'toast undo-toast';
  const text = document.createElement('span');
  text.textContent = message;
  toast.appendChild(text);
  if (canUndo(spec)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'undo-btn';
    btn.textContent = 'טעיתי, לבטל';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const done = await runUndo(spec);
      if (done) toast.remove(); else btn.disabled = false;
    });
    toast.appendChild(btn);
  }
  elements.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), canUndo(spec) ? UNDO_MS : 6000);
  return toast;
}
async function runUndo(spec) {
  const k = UNDO_KINDS[spec.kind];
  if (!k || !canUndo(spec)) { showError('אין לכם הרשאה לבטל — פנו למנהל המערכת.'); return false; }
  if (k.numbered && !(await askConfirm(k.confirm(spec), { danger: true, okText: 'כן, לבטל', cancelText: 'לא, להשאיר' }))) return false;
  try {
    await k.run(spec);
  } catch (error) {
    showError('הביטול לא בוצע — ' + errMsg(error));
    return false;
  }
  showToast(k.done + ' ✓');
  if (state.user) await switchView(state.currentView);
  return true;
}

// ---------- "מה יש לעשות היום" (מצב פשוט, לוח הבקרה) ----------
// agenda מהשרת (core/dashboard.js → agenda): עד 5 פריטים, לכל אחד כפתור "לטפל" אחד. שום דבר לא קורה לבד
function renderAgenda(agenda) {
  const items = agenda && Array.isArray(agenda.items) ? agenda.items : [];
  const total = agenda && Number.isInteger(agenda.total) ? agenda.total : items.length;
  state.agendaItems = items;
  const head = total === 0 ? 'היום אין דברים שמחכים לטיפול ✓'
    : total === 1 ? 'היום יש דבר אחד לטפל בו' : `היום יש ${total} דברים לטפל בהם`;
  return `<section class="card agenda" aria-labelledby="agendaTitle">
    <h2 id="agendaTitle" class="agenda-title">${esc(head)}</h2>
    ${items.length ? `<ul class="agenda-list">${items.map((it, i) => `<li class="agenda-item agenda-${esc(it.level)}">
      <span class="agenda-text"><b>${esc(it.text)}</b>${it.detail ? `<small>${esc(it.detail)}</small>` : ''}</span>
      <button type="button" class="primary agenda-go" data-agenda="${i}" aria-label="לטפל: ${esc(it.text)}">לטפל</button></li>`).join('')}</ul>` : ''}
    ${total > items.length ? `<p class="ss-hint">ועוד ${total - items.length} — ברשימה המלאה למטה.</p>` : ''}
  </section>`;
}
function attachAgendaHandlers() {
  document.querySelectorAll('[data-agenda]').forEach(b => b.addEventListener('click', async () => {
    const it = (state.agendaItems || [])[Number(b.dataset.agenda)];
    if (!it) return;
    // בתוך המודול — מזהה ההלוואה (ref) מדויק יותר מהשם
    const prefill = it.task === 'loanPayment' && it.ref ? { loanId: it.ref } : it.prefill;
    if (it.task && wizardAllowedSync(it.task) && await econStartTask(it.task, prefill)) return;
    if (it.view && Object.prototype.hasOwnProperty.call(viewTitles, it.view)) await switchView(it.view, { focus: true });
  }));
}

// ---------- כפתור "צעד אחר צעד" בראש המסך (מצב רגיל) ----------
function updateWizardBtn(viewName) {
  const btn = elements.wizardBtn;
  if (!btn) return;
  const t = (VIEW_TASKS[viewName] || []).find(x => wizardAllowedSync(x));
  btn.hidden = !t;
  btn.dataset.task = t || '';
  if (t) btn.setAttribute('aria-label', WIZARDS[t].action);
}

// ---------- עזרה בכל מסך: הסבר קצר ו-2–3 פעולות ----------
// פעולה: { task } — אשף; { add } — "＋ הוספת רשומה"; { click: id } — כפתור שקיים במסך; { goto } — מעבר מסך
const HELP_EXTRA = {
  'dashboard': [{ label: 'שאלה לתוכנה במילים פשוטות', goto: 'ai' }, { label: 'חשבוניות מס', goto: 'acct-invoices' }],
  'npo': [{ label: 'הגדרות העמותה (פרטים לקבלה)', click: 'npoSettingsBtn' }, { label: 'ייבוא תרומות מקובץ', click: 'npoImportBtn' }],
  'gemach': [{ label: 'הפקדה לקופה', click: 'gemachDepositBtn' }],
  'acct-invoices': [{ label: 'פרטי העסק שעל החשבונית', goto: 'acct-settings' }],
  'acct-bank': [{ label: 'קליטת דף בנק', click: 'acctBankImport' }],
  'acct-reports': [{ label: 'בחירת תקופה אחרת', click: 'acctPeriodBtn' }],
  'people': [{ label: 'חיפוש אדם', focus: 'peopleQ' }],
  'ai': [{ label: 'כתיבת שאלה', focus: 'aiQuestion' }],
  'settings': [{ label: 'לוח הבקרה', goto: 'dashboard' }],
  'acct-settings': [{ label: 'עריכת פרטי העסק', add: true }]
};
function helpActions(viewName) {
  const list = [];
  for (const t of VIEW_TASKS[viewName] || []) if (wizardAllowedSync(t)) list.push({ label: WIZARDS[t].action, task: t });
  if (!list.length && hasForm(viewName) && !elements.addBtn.hidden) list.push({ label: '＋ הוספת רשומה', add: true });
  for (const a of HELP_EXTRA[viewName] || []) {
    if (a.click && !document.getElementById(a.click)) continue;
    if (a.focus && !document.getElementById(a.focus)) continue;
    if (a.add && (!hasForm(viewName) || list.some(x => x.add))) continue;
    if (a.goto && a.goto === viewName) continue;
    list.push(a);
  }
  if (viewName !== 'dashboard') list.push({ label: 'חזרה ללוח הבקרה', goto: 'dashboard' });
  if (list.length < 2) list.push({ label: 'שאלה לתוכנה במילים פשוטות', goto: 'ai' });
  return list.slice(0, 3);
}
function renderHelpPanel(viewName) {
  const panel = elements.helpPanel;
  if (!panel) return;
  const actions = helpActions(viewName);
  state.helpActions = actions;
  panel.innerHTML = `<h2 id="helpPanelTitle" class="help-title" tabindex="-1">עזרה — ${esc(viewTitles[viewName] || '')}</h2>
    <p class="help-text">${esc(VIEW_HELP[viewName] || 'כאן רואים את הנתונים של המסך הזה.')}</p>
    <p class="ss-hint">מה אפשר לעשות כאן:</p>
    <div class="help-actions">${actions.map((a, i) => `<button type="button" class="${i === 0 ? 'primary' : 'secondary'}" data-help-act="${i}">${esc(a.label)}</button>`).join('')}</div>
    <button type="button" class="link help-close" id="helpClose">סגירת העזרה</button>`;
  panel.querySelectorAll('[data-help-act]').forEach(b => b.addEventListener('click', () => runHelpAction(state.helpActions[Number(b.dataset.helpAct)])));
  panel.querySelector('#helpClose').addEventListener('click', () => toggleHelp(false, true));
}
async function runHelpAction(a) {
  if (!a) return;
  toggleHelp(false);
  if (a.task) await econStartTask(a.task);
  else if (a.add) await handleAdd();
  else if (a.click) { const el = document.getElementById(a.click); if (el) el.click(); }
  else if (a.focus) { const el = document.getElementById(a.focus); if (el && el.focus) el.focus(); }
  else if (a.goto) await switchView(a.goto, { focus: true });
}
function toggleHelp(show, returnFocus = false) {
  const panel = elements.helpPanel;
  const btn = elements.helpBtn;
  if (!panel || !btn) return;
  if (show) renderHelpPanel(state.currentView);
  panel.hidden = !show;
  btn.setAttribute('aria-expanded', show ? 'true' : 'false');
  if (show) { const t = panel.querySelector('#helpPanelTitle'); if (t) t.focus(); }
  else if (returnFocus && typeof btn.focus === 'function') btn.focus();
}
function attachHelpButton() {
  const btn = elements.helpBtn;
  const panel = elements.helpPanel;
  if (!btn || !panel) return;
  btn.addEventListener('click', async () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    if (open) await ensureWizLicense();
    toggleHelp(open);
  });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); toggleHelp(false, true); } });
}
