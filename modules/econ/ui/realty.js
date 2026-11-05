// ממשק המודול הכלכלי — נדל"ן ותיווך: נכסים, לקוחות, התאמה ועסקאות.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

const RLTY_TABS = [['properties', 'נכסים'], ['clients', 'לקוחות'], ['deals', 'עסקאות'], ['orders', 'הזמנות תיווך'], ['invest', 'כדאיות ומס רכישה'], ['project', 'תזרים יזם']];
const rltyUi = { tab: 'properties', matches: null, deal: null, inv: {}, invResult: null, analysisId: '', table: null, proj: null, projResult: null };
const rltyData = () => state.data.realty || {};
const rltyOpts = (map, blank) => [...(blank ? [{ value: '', label: blank }] : []), ...Object.entries(map || {}).map(([value, label]) => ({ value, label }))];

const rltyPropertySchema = {
  title: 'נכס חדש',
  editTitle: 'עריכת נכס',
  prepare: async (schema) => {
    const o = rltyData();
    const f = (n) => schema.fields.find(x => x.name === n);
    f('type').options = rltyOpts(o.propertyTypes);
    f('listing').options = rltyOpts(o.listings);
    f('status').options = rltyOpts(o.propertyStatuses);
    f('ownerClientId').options = [{ value: '', label: 'ללא שיוך' }, ...(o.clients || []).filter(c => c.role === 'seller' || c.role === 'landlord').map(c => ({ value: c.id, label: c.name }))];
  },
  fields: [
    { name: 'listing', label: 'מכירה או השכרה', type: 'select', options: [] },
    { name: 'type', label: 'סוג הנכס', type: 'select', options: [] },
    { name: 'city', label: 'עיר', type: 'text', required: true },
    { name: 'neighborhood', label: 'שכונה', type: 'text' },
    { name: 'street', label: 'רחוב ומספר', type: 'text' },
    { name: 'rooms', label: 'חדרים', type: 'number' },
    { name: 'areaSqm', label: 'שטח (מ"ר)', type: 'number' },
    { name: 'floor', label: 'קומה', type: 'number' },
    { name: 'asking', label: 'מחיר מבוקש (₪; בהשכרה — לחודש)', type: 'number', required: true },
    { name: 'status', label: 'מצב', type: 'select', options: [] },
    { name: 'ownerClientId', label: 'בעלים (מוכר / משכיר)', type: 'select', options: [] },
    { name: 'exclusiveUntil', label: 'בלעדיות עד', type: 'date' },
    { name: 'features', label: 'מאפיינים (מעלית, חניה, מרפסת...)', type: 'text' },
    { name: 'notes', label: 'הערות', type: 'textarea' }
  ],
  create: (d) => window.systemAPI.createRealtyProperty(d),
  update: (id, d) => window.systemAPI.updateRealtyProperty(id, d)
};

const rltyClientSchema = {
  title: 'לקוח חדש',
  editTitle: 'עריכת לקוח',
  prepare: async (schema) => {
    const o = rltyData();
    schema.fields.find(x => x.name === 'role').options = rltyOpts(o.clientRoles);
    schema.fields.find(x => x.name === 'types').options = rltyOpts(o.propertyTypes, 'כל סוג');
  },
  fields: [
    { name: 'role', label: 'סוג הלקוח', type: 'select', options: [] },
    { name: 'name', label: 'שם', type: 'text', required: true },
    { name: 'phone', label: 'טלפון', type: 'tel' },
    { name: 'email', label: 'דוא"ל', type: 'email' },
    { name: 'idNumber', label: 'מספר זהות (לא חובה)', type: 'text' },
    { name: 'areas', label: 'אזורים מבוקשים, מופרדים בפסיק (לקונה / שוכר)', type: 'text' },
    { name: 'types', label: 'סוג נכס מבוקש (לקונה / שוכר)', type: 'select', options: [] },
    { name: 'minRooms', label: 'חדרים — מינימום (לקונה / שוכר)', type: 'number' },
    { name: 'maxRooms', label: 'חדרים — מקסימום (לקונה / שוכר)', type: 'number' },
    { name: 'budgetMin', label: 'תקציב מינימלי (₪)', type: 'number' },
    { name: 'budgetMax', label: 'תקציב מקסימלי (₪)', type: 'number' },
    { name: 'needsMortgage', label: 'צריך משכנתא?', type: 'select', options: [{ value: '', label: 'לא ידוע / לא' }, { value: 'yes', label: 'כן' }] },
    { name: 'notes', label: 'הערות', type: 'textarea' }
  ],
  create: (d) => window.systemAPI.createRealtyClient(d),
  update: (id, d) => window.systemAPI.updateRealtyClient(id, d)
};

const rltyDealSchema = {
  title: 'עסקה חדשה',
  editTitle: 'עריכת עסקה',
  prepare: async (schema) => {
    const o = rltyData();
    const f = (n) => schema.fields.find(x => x.name === n);
    const clients = o.clients || [];
    f('propertyId').options = (o.properties || []).map(p => ({ value: p.id, label: `${p.title} (${p.listingLabel})` }));
    f('buyerClientId').options = clients.filter(c => c.role === 'buyer' || c.role === 'tenant').map(c => ({ value: c.id, label: c.name }));
    f('sellerClientId').options = [{ value: '', label: 'הבעלים הרשום בנכס' }, ...clients.filter(c => c.role === 'seller' || c.role === 'landlord').map(c => ({ value: c.id, label: c.name }))];
    f('stage').options = rltyOpts(o.dealStages);
  },
  fields: [
    { name: 'propertyId', label: 'נכס', type: 'select', required: true, options: [] },
    { name: 'buyerClientId', label: 'קונה / שוכר', type: 'select', required: true, options: [] },
    { name: 'sellerClientId', label: 'מוכר / משכיר', type: 'select', options: [] },
    { name: 'stage', label: 'שלב', type: 'select', options: [] },
    { name: 'price', label: 'מחיר מוסכם (₪; ריק — המחיר המבוקש)', type: 'number' },
    { name: 'signDate', label: 'מועד חתימה מתוכנן', type: 'date' },
    { name: 'handoverDate', label: 'מועד מסירה', type: 'date' },
    { name: 'dependsOnMortgage', label: 'העסקה תלויה במשכנתא?', type: 'select', options: [{ value: '', label: 'לא' }, { value: 'yes', label: 'כן' }] },
    { name: 'lostReason', label: 'סיבה (אם בוטלה)', type: 'text' },
    { name: 'notes', label: 'הערות', type: 'textarea' }
  ],
  create: (d) => window.systemAPI.createRealtyDeal(d),
  update: (id, d) => window.systemAPI.updateRealtyDeal(id, d)
};

const rltyOrderSchema = {
  title: 'הזמנת שירותי תיווך',
  editTitle: 'עריכת הזמנת שירותי תיווך',
  prepare: async (schema) => {
    const o = rltyData();
    const f = (n) => schema.fields.find(x => x.name === n);
    f('clientId').options = (o.clients || []).map(c => ({ value: c.id, label: `${c.name} (${c.roleLabel})` }));
    f('propertyId').options = [{ value: '', label: 'ללא נכס מסוים (תיאור בהמשך)' }, ...(o.properties || []).map(p => ({ value: p.id, label: p.title }))];
    f('transaction').options = rltyOpts(o.transactions, 'לבחירה');
    f('feeType').options = rltyOpts(o.feeTypes);
    // בכל פתיחה מחדש — לא התאריך של הפתיחה הראשונה בהפעלה (סקירת קוד 2.11.2026); בעריכה ערך הרשומה גובר
    f('date').value = madvToday();
  },
  fields: [
    { name: 'clientId', label: 'לקוח', type: 'select', required: true, options: [] },
    { name: 'transaction', label: 'סוג העסקה', type: 'select', options: [] },
    { name: 'propertyId', label: 'נכס', type: 'select', options: [] },
    { name: 'propertyDescription', label: 'תיאור הנכס (אם אין נכס ברשימה)', type: 'text' },
    { name: 'clientAddress', label: 'כתובת הלקוח', type: 'text' },
    { name: 'price', label: 'מחיר מבוקש / מוצע (₪)', type: 'number' },
    { name: 'feeType', label: 'סוג דמי התיווך', type: 'select', options: [] },
    { name: 'feeValue', label: 'דמי התיווך (% או ₪, לפני מע"מ)', type: 'number' },
    { name: 'date', label: 'תאריך ההזמנה', type: 'date', required: true },
    { name: 'exclusive', label: 'בלעדיות?', type: 'select', options: [{ value: '', label: 'לא' }, { value: 'yes', label: 'כן' }] },
    { name: 'exclusiveUntil', label: 'בלעדיות עד', type: 'date' },
    { name: 'marketing', label: 'פעולות שיווק (בבלעדיות)', type: 'textarea' },
    { name: 'signedDate', label: 'הלקוח חתם בתאריך', type: 'date' },
    { name: 'notes', label: 'הערות', type: 'textarea' }
  ],
  create: (d) => window.systemAPI.saveRealtyOrder('', d),
  update: (id, d) => window.systemAPI.saveRealtyOrder(id, d)
};

// טבלת מדרגות מס רכישה — מוקלדת (או נטענת מקובץ בכפתור נפרד). אין ערכים מובנים בתוכנה
const rltyTaxTableSchema = {
  title: 'טבלת מס רכישה',
  editTitle: 'עריכת טבלת מס רכישה',
  prepare: async (schema) => {
    schema.fields.find(x => x.name === 'kind').options = rltyOpts(rltyData().taxKinds);
    const y = schema.fields.find(x => x.name === 'year');
    y.value = new Date().getFullYear();
  },
  fields: [
    { name: 'year', label: 'שנת תוקף', type: 'number', required: true },
    { name: 'kind', label: 'סוג רוכש', type: 'select', options: [] },
    { name: 'validFrom', label: 'בתוקף מתאריך (לא חובה)', type: 'date' },
    { name: 'bracketsText', label: 'מדרגות — שורה לכל מדרגה: "עד סכום, שיעור%". בשורה האחרונה: "מעל, שיעור"', type: 'textarea', required: true },
    { name: 'source', label: 'מקור (מאיפה הועתקו המדרגות)', type: 'text' }
  ],
  create: (d) => window.systemAPI.saveRealtyTaxTable(d),
  // המזהה נשלח — עריכה משנה את הטבלה הזו, לא טבלה אחרת עם אותה שנה וסוג
  update: (id, d) => window.systemAPI.saveRealtyTaxTable({ ...d, id })
};

// ---------- תזרים פרויקט ליזם ----------
const RLTY_PROJ_DEFAULT_PLAN = '20, 0\n40, 12\n40, 24';
const rltyProjBlank = () => ({ name: '', startMonth: madvToday().slice(0, 7), months: 24, deficitRate: '', equity: '', planText: RLTY_PROJ_DEFAULT_PLAN, notes: '',
  costs: [{ category: 'land', label: '', amount: '', from: 1, spread: 1 }, { category: 'build', label: '', amount: '', from: 3, spread: 18 }],
  sales: [{ label: '', units: 1, price: '', month: 6 }] });

// הפרויקט החדש מכפתור "＋ הוספת רשומה": שם, חודש התחלה ומשך — והשאר נערך בלשונית
const rltyProjectSchema = {
  title: 'פרויקט יזמי חדש',
  prepare: async (schema) => {
    const m = schema.fields.find(x => x.name === 'startMonth');
    m.value = madvToday().slice(0, 7);
  },
  fields: [
    { name: 'name', label: 'שם הפרויקט', type: 'text', required: true },
    { name: 'startMonth', label: 'חודש התחלה (שנה-חודש, למשל 2027-01)', type: 'text', required: true },
    { name: 'months', label: 'משך בחודשים', type: 'number', required: true, value: 24 }
  ],
  create: async (d) => {
    const p = await window.systemAPI.saveRealtyProject('', { ...rltyProjBlank(), ...d, costs: [], sales: [] });
    rltyUi.proj = { ...p, costs: rltyProjBlank().costs, sales: rltyProjBlank().sales };
    rltyUi.projResult = null;
    return p;
  }
};
const RLTY_SCHEMAS = { properties: rltyPropertySchema, clients: rltyClientSchema, deals: rltyDealSchema, orders: rltyOrderSchema, invest: rltyTaxTableSchema, project: rltyProjectSchema };

// כפתור "＋ הוספת רשומה" — לפי הלשונית הפתוחה
formSchemas['realty'] = {
  title: 'נכס חדש',
  fields: rltyPropertySchema.fields,
  prepare: async (schema) => {
    const s = RLTY_SCHEMAS[rltyUi.tab];
    await s.prepare(s);
    schema.title = s.title;
    schema.fields = s.fields;
  },
  create: (d) => RLTY_SCHEMAS[rltyUi.tab].create(d)
};


function rltyTabsHtml(o) {
  const count = { properties: (o.properties || []).length, clients: (o.clients || []).length, deals: (o.deals || []).length, orders: (o.orders || []).length, invest: (o.analyses || []).length, project: (o.projects || []).length };
  return `<div class="lab-tabs" role="group" aria-label="בחירת רשימה">${RLTY_TABS.map(([id, label]) => `<button class="${rltyUi.tab === id ? '' : 'secondary'}" data-rlty-tab="${id}" aria-pressed="${rltyUi.tab === id}">${label} (${count[id]})</button>`).join('')}</div>`;
}

function rltyMatchesHtml() {
  const m = rltyUi.matches;
  if (!m) return '';
  const rows = m.rows.map(r => {
    const who = r.property ? `${esc(r.property.title)} · ${money(r.property.asking)}` : `${esc(r.client.name)}${r.client.phone ? ' · ' + esc(r.client.phone) : ''} (${esc(r.client.roleLabel)})`;
    return `<tr><td>${who}</td><td>${r.score}</td><td>${esc([...r.reasons, ...r.misses.map(x => '⚠ ' + x)].join(' · '))}</td></tr>`;
  }).join('');
  return `<div class="card">
    <div class="acct-header"><h3>התאמות ל${esc(m.title)}</h3><button class="secondary" id="rltyMatchClose">סגירה</button></div>
    ${m.rows.length ? `<div class="acct-scroll"><table class="acct-table"><thead><tr><th>${m.kind === 'client' ? 'נכס' : 'לקוח'}</th><th>ציון</th><th>למה</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<p class="muted">לא נמצאו התאמות מעל הסף.</p>'}
    <p class="muted">ההתאמה לפי סוג העסקה, תקציב (עד 5% מעליו), אזור, חדרים וסוג נכס. היא כלי עזר — לא פוסלת נכס שלא הוזנו בו פרטים.</p>
  </div>`;
}

function rltyPropertiesHtml(o) {
  const list = o.properties || [];
  if (!list.length) return renderEmpty('אין נכסים עדיין — לחץ "＋ הוספת רשומה" כדי להוסיף נכס', '🏘');
  return `<div class="acct-scroll"><table class="acct-table">
    <thead><tr><th>נכס</th><th>סוג עסקה</th><th>מחיר</th><th>מצב</th><th>התאמות</th><th></th></tr></thead>
    <tbody>${list.map(p => `<tr${p.status === 'withdrawn' ? ' class="muted"' : ''}>
      <td>${esc(p.title)}${p.areaSqm ? ` <small class="muted">${esc(p.areaSqm)} מ"ר</small>` : ''}${p.exclusiveUntil ? `<br><small>בלעדיות עד ${esc(p.exclusiveUntil)}</small>` : ''}</td>
      <td>${esc(p.listingLabel)}</td><td>${money(p.asking)}</td>
      <td><span class="ss-badge">${esc(p.statusLabel)}</span></td>
      <td>${p.matchCount ? `<button class="secondary" data-rlty-match="property" data-id="${esc(p.id)}">${p.matchCount} לקוחות</button>` : '—'}</td>
      <td><button class="icon-btn" data-rlty-edit="properties" data-id="${esc(p.id)}" title="עריכה">✏</button>
          <button class="icon-btn danger" data-rlty-del="properties" data-id="${esc(p.id)}" title="מחיקת נכס">🗑</button></td></tr>`).join('')}</tbody>
  </table></div>`;
}

function rltyClientsHtml(o) {
  const list = o.clients || [];
  if (!list.length) return renderEmpty('אין לקוחות עדיין — לחץ "＋ הוספת רשומה" כדי להוסיף קונה או מוכר', '👥');
  return `<div class="acct-scroll"><table class="acct-table">
    <thead><tr><th>שם</th><th>סוג</th><th>דרישות</th><th>התאמות</th><th></th></tr></thead>
    <tbody>${list.map(c => `<tr${c.active === false ? ' class="muted"' : ''}>
      <td>${esc(c.name)}${c.phone ? ` <small class="muted">${esc(c.phone)}</small>` : ''}</td>
      <td>${esc(c.roleLabel)}${c.needsMortgage ? ' <span class="ss-badge">משכנתא</span>' : ''}</td>
      <td>${c.areasText !== undefined ? esc([c.areasText, c.minRooms || c.maxRooms ? `${c.minRooms || ''}–${c.maxRooms || ''} חד׳` : '', c.budgetMax ? `עד ${money(c.budgetMax)}` : ''].filter(Boolean).join(' · ')) || '—' : '—'}</td>
      <td>${c.matchCount ? `<button class="secondary" data-rlty-match="client" data-id="${esc(c.id)}">${c.matchCount} נכסים</button>` : '—'}</td>
      <td><button class="icon-btn" data-rlty-edit="clients" data-id="${esc(c.id)}" title="עריכה">✏</button>
          <button class="icon-btn danger" data-rlty-del="clients" data-id="${esc(c.id)}" title="מחיקת לקוח">🗑</button></td></tr>`).join('')}</tbody>
  </table></div>`;
}

// מצב המשכנתא בכרטיס העסקה: שלב התיק המקושר, האישור שנבחר והתראה כשהחתימה קרובה
function rltyDealMortgageHtml(card, o) {
  const d = (o.deals || []).find(x => x.id === card.id) || card;
  const m = d.mortgage;
  const canOpen = o.canMortgage && !(m && m.linked) && d.listing !== 'rent' && !['closed', 'lost'].includes(d.stage);
  let line = '';
  if (m && m.linked && m.missing) line = `<small class="muted">משכנתא: ${esc(m.label)}</small>`;
  else if (m && m.linked) line = `<small>משכנתא: <span class="ss-badge${m.approved ? ' ss-badge-success' : m.lost ? ' ss-badge-danger' : ''}">${esc(m.stageLabel)}</span>${m.chosen ? ` · ${esc(m.chosen.lender)}${m.chosen.expired ? ' (פג תוקף)' : ''}` : ''}</small>
    <button class="icon-btn" data-goto="mortgage-advisor" title="מעבר לייעוץ משכנתאות">↗</button>
    ${o.canMortgage ? `<button class="icon-btn" data-rlty-mtg-unlink="${esc(d.id)}" title="ניתוק הקישור לתיק">⛓</button>` : ''}`;
  else if (d.dependsOnMortgage) line = '<small>תלוי במשכנתא</small>';
  return `${line ? '<br>' + line : ''}${m && m.alert ? `<br><small class="warn">⚠ ${esc(m.alert)}</small>` : ''}
    ${canOpen ? `<br><button class="secondary ss-btn-sm" data-rlty-mtg-open="${esc(d.id)}">פתח תיק משכנתא</button>` : ''}`;
}

function rltyDealsHtml(o) {
  const board = o.board || [];
  const up = o.upcoming || [];
  const alerts = (o.deals || []).filter(d => d.mortgage && d.mortgage.alert);
  if (!(o.deals || []).length) return renderEmpty('אין עסקאות עדיין — לחץ "＋ הוספת רשומה" כדי לפתוח עסקה על נכס', '🤝');
  const t = o.commissionTotals;
  return `
    ${t && t.total ? `<div class="card"><div class="acct-row"><span>עמלות בעסקאות פעילות וסגורות</span><span>${money(t.total)}</span></div>
      <div class="acct-row"><span>התקבל</span><span>${money(t.paid)}</span></div><div class="acct-row acct-total"><span>יתרה לגבייה</span><span>${money(t.balance)}</span></div></div>` : ''}
    ${alerts.length ? `<div class="card"><h3>עסקאות שממתינות למשכנתא</h3><ul>${alerts.map(d => `<li class="warn">${esc(d.propertyTitle)} — ${esc(d.mortgage.alert)}</li>`).join('')}</ul></div>` : ''}
    ${up.length ? `<div class="card"><h3>מועדים קרובים</h3><ul>${up.map(u => `<li${u.overdue ? ' class="warn"' : ''}>${esc(u.date)} — ${esc(u.label)}${u.mortgage ? ' <span class="ss-badge ss-badge-warning">תלוי במשכנתא</span>' : ''}${u.overdue ? ' (עבר)' : ''}</li>`).join('')}</ul></div>` : ''}
    <div class="ss-board">${board.map(col => `
      <div class="ss-board-col${col.closed ? ' is-closed' : ''}">
        <h4><span>${esc(col.label)}</span><span>${col.cards.length}</span></h4>
        ${col.cards.map(d => `<div class="ss-board-card">
          <strong>${esc(d.propertyTitle)}</strong>
          <span>${money(d.price)}</span><br>
          <small>${esc(d.buyerName)}${d.sellerName ? ' ← ' + esc(d.sellerName) : ''}</small>
          ${rltyDealMortgageHtml(d, o)}${d.lostReason ? `<br><small>${esc(d.lostReason)}</small>` : ''}
          ${d.commission && d.commission.total ? `<br><small>עמלה ${money(d.commission.total)} · יתרה ${money(d.commission.balance)}</small>` : ''}
          <div><button class="icon-btn" data-rlty-deal="${esc(d.id)}" title="עמלות תיווך">₪</button>
            <button class="icon-btn" data-rlty-edit="deals" data-id="${esc(d.id)}" title="עריכת עסקה">✏</button>
            <button class="icon-btn danger" data-rlty-del="deals" data-id="${esc(d.id)}" title="מחיקת עסקה">🗑</button></div>
        </div>`).join('')}
      </div>`).join('')}
    </div>`;
}

// עמלות העסקה שנבחרה: גובה לכל צד, מצב גבייה, תשלומים וחשבונית
function rltyCommissionHtml(o) {
  const d = (o.deals || []).find(x => x.id === rltyUi.deal);
  if (!d) return '';
  const c = d.commission || { sides: [] };
  const fees = d.commissionFees || {};
  const sides = o.sides || {};
  const states = o.payStates || {};
  const methods = o.payMethods || {};
  const feeRow = (side) => `<tr><td>${esc(sides[side])}</td>
    <td><select id="rltyFeeType_${side}" aria-label="סוג העמלה — ${esc(sides[side])}">${Object.entries(o.feeTypes || {}).map(([v, l]) => `<option value="${v}"${(fees[side] || {}).type === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></td>
    <td><input type="number" step="0.01" min="0" id="rltyFeeValue_${side}" aria-label="גובה העמלה — ${esc(sides[side])}" value="${fees[side] ? esc(fees[side].value) : ''}"></td></tr>`;
  return `<div class="card">
    <div class="acct-header"><h3>עמלות תיווך — ${esc(d.propertyTitle)} · ${money(d.price)}</h3><button class="secondary" id="rltyDealClose">סגירה</button></div>
    <div class="acct-scroll"><table class="acct-table"><thead><tr><th>צד</th><th>סוג</th><th>גובה (לפני מע"מ)</th></tr></thead>
      <tbody>${Object.keys(sides).map(feeRow).join('')}</tbody></table></div>
    <div class="acct-actions"><button id="rltyFeeSave">שמירת העמלות</button></div>
    ${c.sides.length ? `<div class="acct-scroll"><table class="acct-table"><thead><tr><th>צד</th><th>עמלה</th><th>סה"כ</th><th>שולם</th><th>יתרה</th><th>מצב</th></tr></thead>
      <tbody>${c.sides.map(s => `<tr><td>${esc(s.label)}</td><td>${esc(s.feeText)}</td><td>${money(s.total)}</td><td>${money(s.paid)}</td><td>${money(s.balance)}</td>
        <td><span class="ss-badge${s.state === 'paid' ? '' : ' ss-badge-warning'}">${esc(states[s.state] || s.state)}${s.overpaid ? ` (${money(s.overpaid)})` : ''}</span></td></tr>`).join('')}</tbody></table></div>
      <h4>תשלומים</h4>
      ${(d.commissionPayments || []).map(p => `<div class="acct-row"><span>${esc(p.date)} · ${esc(sides[p.side] || '')} · ${esc(methods[p.method] || '')}${p.note ? ' · ' + esc(p.note) : ''}</span><span>${money(p.amount)}
        ${p.invoiceNumber ? `<small>חשבונית ${esc(p.invoiceNumber)}</small>` : `${p.cancelledInvoice ? `<small class="muted">חשבונית ${esc(p.cancelledInvoice)} בוטלה</small>` : ''}${o.canInvoice ? `<button class="icon-btn" data-rlty-invoice="${esc(p.id)}" title="הפקת חשבונית מס/קבלה">🧾</button>` : ''}
        <button class="icon-btn danger" data-rlty-paydel="${esc(p.id)}" title="מחיקת תשלום">🗑</button>`}</span></div>`).join('') || '<p class="muted">עוד לא נרשמו תשלומים.</p>'}
      <div class="acct-actions"><button class="secondary" id="rltyPayAdd">＋ תשלום שהתקבל</button></div>` : '<p class="muted">הזינו עמלה לפחות לצד אחד כדי לעקוב אחרי הגבייה.</p>'}
  </div>`;
}

function rltyOrdersHtml(o) {
  const list = o.orders || [];
  const intro = `<p class="muted">הזמנת שירותי תיווך בכתב. התוכנה מציגה מה חסר בהזמנה — היא לא קובעת אם מגיעים דמי תיווך. רשימת השדות ${esc(o.unverified || 'לא מאומתת')}, לבדיקת עורך דין.</p>`;
  if (!list.length) return intro + renderEmpty('אין הזמנות עדיין — לחץ "＋ הוספת רשומה" כדי ליצור הזמנת שירותי תיווך', '📝');
  return intro + list.map(r => `<div class="card">
    <div class="acct-header">
      <div><h4>${esc(r.clientName)}${r.transactionLabel ? ` · ${esc(r.transactionLabel)}` : ''}</h4><small>${esc(r.date)}${r.feeText ? ' · ' + esc(r.feeText) : ''}${r.exclusive ? ' · בלעדיות' : ''}${r.signedDate ? ` · נחתם ${esc(r.signedDate)}` : ''}</small></div>
      <div class="acct-actions">
        <span class="ss-badge${r.check.complete ? '' : ' ss-badge-warning'}">${r.check.complete ? 'כל השדות מולאו' : `חסרים ${r.check.missing.length}`}</span>
        <button class="icon-btn" data-rlty-order-pdf="${esc(r.id)}" title="טופס להחתמה (PDF)">📄</button>
        <button class="icon-btn" data-rlty-edit="orders" data-id="${esc(r.id)}" title="עריכה">✏</button>
        <button class="icon-btn danger" data-rlty-del="orders" data-id="${esc(r.id)}" title="מחיקת הזמנה">🗑</button>
      </div>
    </div>
    ${r.check.missing.length ? `<p><strong>חסר:</strong> ${esc(r.check.missing.join(' · '))}</p>` : ''}
    ${r.check.warnings.map(w => `<p class="warn">⚠ ${esc(w)}</p>`).join('')}
  </div>`).join('');
}

function rltySettingsHtml(o) {
  if (!o.isManager) return '';
  const s = o.settings || {};
  const f = (k, label) => `<label>${label} <input type="text" class="ss-input" id="rltySet_${k}" value="${esc(s[k] || '')}"></label>`;
  return `<details class="card"><summary>פרטי המשרד להזמנות ולחשבוניות</summary>
    ${f('brokerName', 'שם המתווך / המשרד')} ${f('licenseNo', 'מספר רישיון תיווך')} ${f('phone', 'טלפון')} ${f('address', 'כתובת')}
    <label><input type="checkbox" id="rltySet_vatExempt"${s.vatExempt ? ' checked' : ''}> עוסק פטור (בלי מע"מ על העמלה)</label>
    <div class="acct-actions"><button id="rltySaveSettings">שמירה</button></div>
  </details>`;
}

function renderRealty(o) {
  const d = o || {};
  const body = rltyUi.tab === 'clients' ? rltyClientsHtml(d) : rltyUi.tab === 'deals' ? rltyCommissionHtml(d) + rltyDealsHtml(d) : rltyUi.tab === 'orders' ? rltySettingsHtml(d) + rltyOrdersHtml(d) : rltyUi.tab === 'invest' ? rltyInvestHtml(d) : rltyUi.tab === 'project' ? rltyProjectHtml(d) : rltyPropertiesHtml(d);
  return `<div class="realty mortgage-lab">${rltyTabsHtml(d)}${rltyMatchesHtml()}${body}</div>`;
}

// חלון תשלום עמלה: צד, תאריך, סכום (ברירת מחדל — היתרה של הצד), אמצעי והערה
function rltyAskPayment(deal) {
  const o = rltyData();
  const open = (deal.commission.sides || []).filter(s => s.balance > 0);
  const list = open.length ? open : deal.commission.sides;
  return openDialog((card, finish) => {
    const h = document.createElement('h2');
    h.textContent = 'תשלום דמי תיווך שהתקבל';
    h.id = 'rltyPayTitle';
    card.parentNode.setAttribute('aria-labelledby', h.id);
    const form = document.createElement('form');
    form.className = 'modal-form';
    form.noValidate = true;
    const field = (label, el) => { const l = document.createElement('label'); l.textContent = label; l.appendChild(el); form.appendChild(l); return el; };
    const mk = (type, value) => { const i = document.createElement('input'); i.type = type; i.value = value; return i; };
    const side = field('מאיזה צד', document.createElement('select'));
    side.innerHTML = list.map(s => `<option value="${esc(s.side)}">${esc(s.label)}</option>`).join('');
    const date = field('תאריך', mk('date', madvToday()));
    const amount = field('סכום (₪, כולל מע"מ)', mk('number', list[0] ? list[0].balance || '' : ''));
    amount.min = '0'; amount.step = '0.01';
    side.addEventListener('change', () => { const s = list.find(x => x.side === side.value); if (s) amount.value = s.balance || ''; });
    const method = field('אמצעי תשלום', document.createElement('select'));
    method.innerHTML = Object.entries(o.payMethods || {}).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    const note = field('הערה (לא חובה)', mk('text', ''));
    const err = document.createElement('div');
    err.setAttribute('role', 'alert'); // שגיאה מוקראת מיד (r4 נגישות)
    err.style.color = 'var(--ss-danger)';
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = 'ביטול';
    const ok = document.createElement('button');
    ok.type = 'submit'; ok.className = 'primary'; ok.textContent = 'שמירה';
    actions.append(cancel, ok);
    form.append(err, actions);
    card.append(h, form);
    cancel.addEventListener('click', () => finish(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!date.value) { dialogFieldError(err, date, 'חסר תאריך התשלום. בחרו תאריך ונסו שוב.'); return; }
      if (!(Number(amount.value) > 0)) { dialogFieldError(err, amount, 'הסכום חסר או אינו נכון. כתבו סכום גדול מאפס (למשל 1500).'); return; }
      finish({ side: side.value, date: date.value, amount: Number(amount.value), method: method.value, note: note.value.trim() });
    });
    amount.focus();
  });
}

// שדה הלקוח בחלון הפקת חשבונית העמלה (גם בייעוץ המשכנתאות)
const RLTY_TAX_ID_LABEL = 'מספר עוסק / ת"ז של הלקוח (לבדוק)';
// ת"ז / ע.מ מכרטיס הלקוח של הצד ששילם (קונה / מוכר) — כמו commissionPaymentForInvoice בשרת; אין — ריק
function rltyInvoiceTaxId(o, deal, paymentId) {
  const p = ((deal && deal.commissionPayments) || []).find(x => x.id === paymentId);
  if (!p) return '';
  const clientId = p.side === 'buyer' ? deal.buyerClientId : deal.sellerClientId;
  const c = ((o && o.clients) || []).find(x => x.id === clientId);
  return c && c.idNumber ? String(c.idNumber) : '';
}

function attachRealtyCommissionHandlers() {
  const o = rltyData();
  document.querySelectorAll('[data-rlty-deal]').forEach(b => b.addEventListener('click', () => { rltyUi.deal = b.dataset.rltyDeal; renderView('realty'); }));
  const close = document.getElementById('rltyDealClose');
  if (close) close.addEventListener('click', () => { rltyUi.deal = null; renderView('realty'); });
  const deal = (o.deals || []).find(x => x.id === rltyUi.deal);
  const save = document.getElementById('rltyFeeSave');
  if (save && deal) save.addEventListener('click', async () => {
    const input = {};
    for (const side of Object.keys(o.sides || {})) {
      input[side] = { type: document.getElementById('rltyFeeType_' + side).value, value: document.getElementById('rltyFeeValue_' + side).value };
    }
    try { await window.systemAPI.setRealtyCommissions(deal.id, input); showToast('העמלות נשמרו'); await switchView('realty'); }
    catch (error) { showError('שגיאה בשמירה: ' + errMsg(error)); }
  });
  const add = document.getElementById('rltyPayAdd');
  if (add && deal) add.addEventListener('click', async () => {
    const v = await rltyAskPayment(deal);
    if (!v) return;
    try { await window.systemAPI.addRealtyCommissionPayment(deal.id, v); showToast('התשלום נרשם'); await switchView('realty'); }
    catch (error) { showError('שגיאה ברישום התשלום: ' + errMsg(error)); }
  });
  document.querySelectorAll('[data-rlty-paydel]').forEach(b => b.addEventListener('click', async () => {
    if (!(await askConfirm('למחוק את התשלום?'))) return;
    try { await window.systemAPI.deleteRealtyCommissionPayment(deal.id, b.dataset.rltyPaydel); showToast('התשלום נמחק'); await switchView('realty'); }
    catch (error) { showError('שגיאה במחיקה: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-rlty-invoice]').forEach(b => b.addEventListener('click', async () => {
    // מספר עוסק / ת"ז של הלקוח — ממולא מכרטיס הלקוח של הצד ששילם, וניתן לעריכה ולמחיקה (החלטת הבעלים 5.11.2026)
    const v = await askDocFields('להפיק חשבונית על התשלום? היא תירשם בהנהלת החשבונות ותקבל מספר', [
      { name: 'customerTaxId', label: RLTY_TAX_ID_LABEL, value: rltyInvoiceTaxId(o, deal, b.dataset.rltyInvoice) }], 'הפקת החשבונית');
    if (!v) return;
    try { const r = await window.systemAPI.issueRealtyCommissionInvoice(deal.id, b.dataset.rltyInvoice, { confirmed: true, customerTaxId: v.customerTaxId || '' }); showToast(`הופקה חשבונית מספר ${r.number}`); await switchView('realty'); }
    catch (error) { showError('שגיאה בהפקת החשבונית: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-rlty-order-pdf]').forEach(b => b.addEventListener('click', async () => {
    try { const r = await window.systemAPI.exportRealtyOrder(b.dataset.rltyOrderPdf); if (r && r.ok) showToast('הטופס נשמר'); }
    catch (error) { showError('שגיאה בהפקת הטופס: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-rlty-mtg-open]').forEach(b => b.addEventListener('click', async () => {
    const d = (o.deals || []).find(x => x.id === b.dataset.rltyMtgOpen);
    if (!d) return;
    const v = await askFields(`תיק משכנתא ל${d.buyerName || 'קונה'}`, [
      { name: 'requestedAmount', label: `סכום המשכנתא המבוקש (₪; מחיר העסקה ${money(d.price)})`, type: 'number' }
    ], 'פתיחת התיק');
    if (!v) return;
    try {
      await window.systemAPI.openRealtyMortgageCase(d.id, { requestedAmount: v.requestedAmount });
      showToast('נפתח תיק משכנתא מקושר לעסקה');
      await switchView('realty');
    } catch (error) { showError('שגיאה בפתיחת התיק: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-rlty-mtg-unlink]').forEach(b => b.addEventListener('click', async () => {
    if (!(await askConfirm('לנתק את הקישור בין העסקה לתיק המשכנתא? התיק והעסקה נשארים.'))) return;
    try { await window.systemAPI.unlinkRealtyMortgageCase(b.dataset.rltyMtgUnlink); showToast('הקישור נותק'); await switchView('realty'); }
    catch (error) { showError('שגיאה: ' + errMsg(error)); }
  }));
  const set = document.getElementById('rltySaveSettings');
  if (set) set.addEventListener('click', async () => {
    const val = (k) => (document.getElementById('rltySet_' + k) || {}).value || '';
    try {
      await window.systemAPI.saveRealtySettings({ brokerName: val('brokerName'), licenseNo: val('licenseNo'), phone: val('phone'), address: val('address'), vatExempt: document.getElementById('rltySet_vatExempt').checked });
      showToast('הפרטים נשמרו');
      await switchView('realty');
    } catch (error) { showError('שגיאה בשמירה: ' + errMsg(error)); }
  });
}

// ---------- כדאיות השקעה ומס רכישה ----------
const RLTY_INV_FIELDS = [
  ['price', 'מחיר הנכס (₪)'], ['lawyer', 'עורך דין (₪)'], ['brokerage', 'דמי תיווך (₪)'], ['renovation', 'שיפוץ (₪)'], ['otherCosts', 'עלויות אחרות (₪)'],
  ['loan', 'משכנתא (₪)'], ['loanRate', 'ריבית שנתית (%)'], ['loanYears', 'שנים'],
  ['monthlyRent', 'שכר דירה חודשי (₪)'], ['occupiedMonths', 'חודשי השכרה בשנה'], ['monthlyExpenses', 'הוצאות חודשיות — ועד, ביטוח, תחזוקה (₪)'],
  ['manualTax', 'מס רכישה ידני (₪; ריק — לפי טבלה)']
];

function rltyInvestResultHtml(r) {
  if (!r) return '';
  const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
  const row = (l, v, cls) => `<div class="acct-row${cls ? ' ' + cls : ''}"><span>${l}</span><span>${v}</span></div>`;
  return `<div class="card">
    ${r.warnings.map(w => `<p class="warn">⚠ ${esc(w)}</p>`).join('')}
    ${row('מס רכישה' + (r.taxSource === 'unverified' ? ' (הערכה)' : r.taxSource === 'manual' ? ' (ידני)' : ''), `${money(r.tax.tax)} · ${pct(r.tax.effectivePct)}`)}
    ${r.tax.lines.length ? `<div class="acct-scroll"><table class="acct-table"><thead><tr><th>מ-</th><th>עד</th><th>שיעור</th><th>מס</th></tr></thead>
      <tbody>${r.tax.lines.map(l => `<tr><td>${money(l.from)}</td><td>${money(l.to)}</td><td>${l.ratePct}%</td><td>${money(l.tax)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${row('עלות כוללת', money(r.totalCost), 'acct-total')}
    ${row('הון עצמי נדרש', money(r.equity))}
    ${row('שיעור מימון', pct(r.ltvPct))}
    ${row('החזר חודשי', money(r.payment))}
    ${row('הכנסה שנתית משכירות', money(r.annualRent))}
    ${row('הכנסה נטו לפני מימון (NOI)', money(r.noi))}
    ${row('תזרים שנתי אחרי החזר', money(r.cashFlow), 'acct-total')}
    ${row('תשואה ברוטו', pct(r.grossYieldPct))}
    ${row('תשואה נטו (על העלות הכוללת)', pct(r.netYieldPct))}
    ${row('תשואה על ההון העצמי', pct(r.cashOnCashPct))}
    <p class="muted">${esc(r.assumptions)}</p>
  </div>`;
}

function rltyInvestHtml(o) {
  const v = rltyUi.inv;
  const kinds = o.taxKinds || {};
  const years = [...new Set((o.taxTables || []).map(t => t.year))];
  const analyses = o.analyses || [];
  const tables = o.taxTables || [];
  return `
    <div class="card">
      <h3>מחשבון כדאיות</h3>
      <div class="acct-actions">
        <label>נכס <select id="rltyInvProperty" aria-label="נכס"><option value="">ללא</option>${(o.properties || []).filter(p => p.listing === 'sale').map(p => `<option value="${esc(p.id)}"${v.propertyId === p.id ? ' selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>
        <label>שנת מס <select id="rltyInv_taxYear" aria-label="שנת מס"><option value="">ללא טבלה</option>${years.map(y => `<option${String(v.taxYear) === String(y) ? ' selected' : ''}>${y}</option>`).join('')}</select></label>
        <label>סוג רוכש <select id="rltyInv_taxKind" aria-label="סוג רוכש">${Object.entries(kinds).map(([k, l]) => `<option value="${k}"${v.taxKind === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      </div>
      <div class="acct-actions">${RLTY_INV_FIELDS.map(([k, l]) => `<label>${l} <input type="number" step="any" min="0" id="rltyInv_${k}" value="${esc(v[k] ?? '')}"></label>`).join('')}</div>
      <div class="acct-actions">
        <button id="rltyInvCalc">חישוב</button>
        <button class="secondary" id="rltyInvSave">${rltyUi.analysisId ? 'עדכון הניתוח' : 'שמירה כניתוח'}</button>
        ${rltyUi.analysisId ? '<button class="secondary" id="rltyInvNew">ניתוח חדש</button>' : ''}
      </div>
    </div>
    ${rltyInvestResultHtml(rltyUi.invResult)}
    ${analyses.length ? `<div class="card"><h3>ניתוחים שמורים</h3>${analyses.map(a => `<div class="acct-row"><span>${esc(a.name)}</span><span>
      <button class="secondary" data-rlty-analysis="${esc(a.id)}">פתיחה</button>
      <button class="icon-btn danger" data-rlty-analysis-del="${esc(a.id)}" title="מחיקת ניתוח">🗑</button></span></div>`).join('')}</div>` : ''}
    <div class="card">
      <div class="acct-header"><h3>טבלאות מס רכישה</h3><button class="secondary" id="rltyTaxFile">טעינה מקובץ…</button></div>
      <p class="muted">אין בתוכנה מדרגות מובנות. מקלידים את הטבלה מאתר רשות המסים (או טוענים מקובץ CSV: "עד סכום, שיעור" בכל שורה), ומנהל מסמן "אומת" אחרי בדיקה. חישוב עם טבלה שלא אומתה מוצג כהערכה.</p>
      ${tables.length ? `<div class="acct-scroll"><table class="acct-table"><thead><tr><th>שנה</th><th>סוג</th><th>מדרגות</th><th>מצב</th><th></th></tr></thead>
        <tbody>${tables.map(t => `<tr><td>${t.year}</td><td>${esc(t.kindLabel)}</td>
          <td><small>${t.brackets.map(b => `${b.upTo === null ? 'מעל ' + money(b.from) : 'עד ' + money(b.upTo)}: ${b.ratePct}%`).join(' · ')}</small>${t.source ? `<br><small class="muted">${esc(t.source)}</small>` : ''}</td>
          <td><span class="ss-badge${t.verified ? '' : ' ss-badge-warning'}">${esc(t.statusLabel)}</span>${t.verifyNote ? `<br><small>${esc(t.verifyNote)}</small>` : ''}</td>
          <td><button class="icon-btn" data-rlty-tax-edit="${esc(t.id)}" title="עריכה">✏</button>
            ${o.isManager ? (t.verified ? `<button class="icon-btn" data-rlty-tax-unverify="${esc(t.id)}" title="ביטול האימות">↺</button>` : `<button class="icon-btn" data-rlty-tax-verify="${esc(t.id)}" title="סימון כמאומת">✓</button>`) : ''}
            <button class="icon-btn danger" data-rlty-tax-del="${esc(t.id)}" title="מחיקת טבלה">🗑</button></td></tr>`).join('')}</tbody></table></div>`
        : renderEmpty('אין טבלאות מס רכישה — לחץ "＋ הוספת רשומה" כדי להקליד טבלה', '🧾')}
    </div>`;
}

function rltyInvCollect() {
  const v = {};
  const p = document.getElementById('rltyInvProperty');
  if (p) v.propertyId = p.value;
  for (const k of ['taxYear', 'taxKind', ...RLTY_INV_FIELDS.map(f => f[0])]) {
    const el = document.getElementById('rltyInv_' + k);
    if (el && el.value !== '') v[k] = el.value;
  }
  rltyUi.inv = v;
  return v;
}

function attachRealtyInvestHandlers() {
  const o = rltyData();
  const prop = document.getElementById('rltyInvProperty');
  if (prop) prop.addEventListener('change', () => {
    const v = rltyInvCollect();
    const p = (o.properties || []).find(x => x.id === v.propertyId);
    if (p) { v.price = p.asking; renderView('realty'); }
  });
  const calc = document.getElementById('rltyInvCalc');
  if (calc) calc.addEventListener('click', async () => {
    try { rltyUi.invResult = await window.systemAPI.calcRealtyInvestment(rltyInvCollect()); renderView('realty'); }
    catch (error) { showError('שגיאה בחישוב: ' + errMsg(error)); }
  });
  const save = document.getElementById('rltyInvSave');
  if (save) save.addEventListener('click', async () => {
    const input = rltyInvCollect();
    const cur = (o.analyses || []).find(a => a.id === rltyUi.analysisId);
    const v = await askFields('שם לניתוח', [{ name: 'name', label: 'שם' }], 'שמירה', { name: cur ? cur.name : '' });
    if (!v) return;
    try {
      const a = await window.systemAPI.saveRealtyAnalysis(rltyUi.analysisId, { name: v.name, propertyId: input.propertyId || '', input });
      rltyUi.analysisId = a.id;
      showToast('הניתוח נשמר');
      await switchView('realty');
    } catch (error) { showError('שגיאה בשמירה: ' + errMsg(error)); }
  });
  const fresh = document.getElementById('rltyInvNew');
  if (fresh) fresh.addEventListener('click', () => { rltyUi.analysisId = ''; rltyUi.inv = {}; rltyUi.invResult = null; renderView('realty'); });
  document.querySelectorAll('[data-rlty-analysis]').forEach(b => b.addEventListener('click', () => {
    const a = (o.analyses || []).find(x => x.id === b.dataset.rltyAnalysis);
    if (!a) return;
    rltyUi.analysisId = a.id;
    rltyUi.inv = { ...a.input, propertyId: a.propertyId };
    rltyUi.invResult = null;
    renderView('realty');
  }));
  document.querySelectorAll('[data-rlty-analysis-del]').forEach(b => b.addEventListener('click', async () => {
    if (!(await askConfirm('למחוק את הניתוח?'))) return;
    try { await window.systemAPI.deleteRealtyAnalysis(b.dataset.rltyAnalysisDel); if (rltyUi.analysisId === b.dataset.rltyAnalysisDel) rltyUi.analysisId = ''; showToast('נמחק'); await switchView('realty'); }
    catch (error) { showError('שגיאה במחיקה: ' + errMsg(error)); }
  }));
  const tables = o.taxTables || [];
  document.querySelectorAll('[data-rlty-tax-edit]').forEach(b => b.addEventListener('click', async () => {
    const t = tables.find(x => x.id === b.dataset.rltyTaxEdit);
    if (t) await openSubForm(rltyTaxTableSchema, t, t.id);
  }));
  const file = document.getElementById('rltyTaxFile');
  if (file) file.addEventListener('click', async () => {
    try {
      // הקובץ נקרא במסך (UTF-8 או windows-1255) — כך זה עובד גם באנדרואיד; הבדיקה והפענוח בשרת
      const text = await pickFileText('.csv,.txt');
      if (text === null) return;
      const r = await window.systemAPI.parseRealtyTaxTableText(text);
      await openSubForm(rltyTaxTableSchema, { bracketsText: r.text });
    } catch (error) { showError('שגיאה בקריאת הקובץ: ' + errMsg(error)); }
  });
  document.querySelectorAll('[data-rlty-tax-verify]').forEach(b => b.addEventListener('click', async () => {
    const v = await askFields('אימות טבלת מס רכישה', [{ name: 'note', label: 'מאיפה נבדקה הטבלה (למשל: אתר רשות המסים, תאריך)' }], 'סימון כמאומת');
    if (!v) return;
    try { await window.systemAPI.verifyRealtyTaxTable(b.dataset.rltyTaxVerify, v.note); showToast('הטבלה סומנה כמאומתת'); await switchView('realty'); }
    catch (error) { showError('שגיאה: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-rlty-tax-unverify]').forEach(b => b.addEventListener('click', async () => {
    try { await window.systemAPI.unverifyRealtyTaxTable(b.dataset.rltyTaxUnverify); showToast('האימות בוטל'); await switchView('realty'); }
    catch (error) { showError('שגיאה: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-rlty-tax-del]').forEach(b => b.addEventListener('click', async () => {
    if (!(await askConfirm('למחוק את הטבלה?'))) return;
    try { await window.systemAPI.deleteRealtyTaxTable(b.dataset.rltyTaxDel); showToast('נמחק'); await switchView('realty'); }
    catch (error) { showError('שגיאה במחיקה: ' + errMsg(error)); }
  }));
}


// עמודות היתרה המצטברת לפי חודש: מעל הקו — עודף, מתחת — גירעון (SVG, בלי ספרייה)
function rltyBalanceChart(rows) {
  const vals = rows.map(r => r.balanceAg);
  const max = Math.max(1, ...vals.map(Math.abs));
  const h = 90, w = Math.max(4, Math.min(22, Math.floor(720 / rows.length) - 2)), gap = 2;
  const pos = Math.max(0, ...vals) > 0, neg = Math.min(0, ...vals) < 0;
  const top = pos ? h : 0, total = (pos ? h : 0) + (neg ? h : 0) || h;
  const bars = rows.map((r, i) => {
    const bh = Math.max(1, Math.round(Math.abs(r.balanceAg) / max * h));
    const y = r.balanceAg >= 0 ? top + 10 - bh : top + 10;
    return `<rect class="${r.balanceAg >= 0 ? 'biz-in' : 'rlty-neg'}" x="${10 + i * (w + gap)}" y="${y}" width="${w}" height="${bh}" rx="1"><title>${esc(r.month)}: ${money(r.balance)}</title></rect>`;
  }).join('');
  const width = 20 + rows.length * (w + gap);
  return `<svg class="biz-chart rlty-chart" viewBox="0 0 ${width} ${total + 20}" role="img" aria-label="יתרה מצטברת לפי חודש">
    <line x1="5" y1="${top + 10}" x2="${width - 5}" y2="${top + 10}" class="biz-axis"/>${bars}</svg>
    <div class="biz-legend"><span class="biz-dot biz-in" aria-hidden="true"></span>יתרה חיובית <span class="biz-dot rlty-neg" aria-hidden="true"></span>גירעון</div>`;
}

function rltyProjectResultHtml(r) {
  if (!r) return '';
  const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
  const row = (l, v, cls) => `<div class="acct-row${cls ? ' ' + cls : ''}"><span>${l}</span><span>${v}</span></div>`;
  return `
    <div class="ss-kpis">
      <div class="ss-kpi"><small>רווח</small><strong>${money(r.profit)}</strong></div>
      <div class="ss-kpi"><small>רווח על העלות</small><strong>${pct(r.profitOnCostPct)}</strong></div>
      <div class="ss-kpi"><small>שיא הגירעון</small><strong>${money(r.peakDeficit)}</strong></div>
      <div class="ss-kpi"><small>יתרה חוזרת לחיובית</small><strong>${esc(r.breakEvenMonth || '—')}</strong></div>
    </div>
    <div class="card">
      ${r.warnings.map(w => `<p class="warn">⚠ ${esc(w)}</p>`).join('')}
      ${row('הכנסות ממכירות', money(r.revenue))}
      ${r.costByCategory.map(c => row(esc(c.label), money(c.amount))).join('')}
      ${r.interest ? row('ריבית על הגירעון', money(r.interest)) : ''}
      ${row('עלות כוללת', money(r.totalCost), 'acct-total')}
      ${row('רווח', money(r.profit), 'acct-total')}
      ${row('רווח מההכנסות', pct(r.profitOnRevenuePct))}
      ${row('שיא הגירעון' + (r.peakMonth ? ` (${esc(r.peakMonth)})` : ''), money(r.peakDeficit))}
      ${r.equity ? row('הון עצמי', money(r.equity)) : ''}
      ${r.fundingGap ? row('חסר מימון מעבר להון העצמי', money(r.fundingGap)) : ''}
      ${rltyBalanceChart(r.rows)}
      <details><summary>טבלה חודשית (${r.horizon} חודשים)</summary>
        <div class="acct-scroll"><table class="acct-table"><thead><tr><th>#</th><th>חודש</th><th>עלויות</th><th>הכנסות</th><th>ריבית</th><th>נטו</th><th>יתרה מצטברת</th></tr></thead>
          <tbody>${r.rows.map(m => `<tr${m.balanceAg < 0 ? ' class="warn"' : ''}><td>${m.index}</td><td>${esc(m.month)}</td><td>${money(m.cost)}</td><td>${money(m.income)}</td><td>${m.interest ? money(m.interest) : ''}</td><td>${money(m.net)}</td><td>${money(m.balance)}</td></tr>`).join('')}</tbody></table></div>
      </details>
      <p class="muted">${esc(r.assumptions)}</p>
    </div>`;
}

function rltyProjectHtml(o) {
  const p = rltyUi.proj || (rltyUi.proj = rltyProjBlank());
  const cats = o.costCategories || {};
  const projects = o.projects || [];
  const inp = (id, value, attrs = '') => `<input class="ss-input" id="${id}" value="${esc(value ?? '')}" ${attrs}>`;
  const costRow = (c, i) => `<tr>
    <td><select id="rltyPc_category_${i}" aria-label="סוג">${Object.entries(cats).map(([k, l]) => `<option value="${k}"${c.category === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></td>
    <td>${inp('rltyPc_label_' + i, c.label, 'type="text" aria-label="תיאור"')}</td>
    <td>${inp('rltyPc_amount_' + i, c.amount, 'type="number" min="0" step="any" aria-label="סכום"')}</td>
    <td>${inp('rltyPc_from_' + i, c.from, 'type="number" min="1" step="1" aria-label="מחודש"')}</td>
    <td>${inp('rltyPc_spread_' + i, c.spread, 'type="number" min="1" step="1" aria-label="על פני חודשים"')}</td>
    <td><button class="icon-btn danger" data-rlty-pc-del="${i}" title="הסרת השורה">✕</button></td></tr>`;
  const saleRow = (s, i) => `<tr>
    <td>${inp('rltyPs_label_' + i, s.label, 'type="text" aria-label="יחידה"')}</td>
    <td>${inp('rltyPs_units_' + i, s.units, 'type="number" min="1" step="1" aria-label="כמות"')}</td>
    <td>${inp('rltyPs_price_' + i, s.price, 'type="number" min="0" step="any" aria-label="מחיר ליחידה"')}</td>
    <td>${inp('rltyPs_month_' + i, s.month, 'type="number" min="1" step="1" aria-label="חודש המכירה"')}</td>
    <td><button class="icon-btn danger" data-rlty-ps-del="${i}" title="הסרת השורה">✕</button></td></tr>`;
  return `
    <div class="card">
      <h3>${p.id ? esc(p.name) : 'פרויקט חדש'}</h3>
      <div class="acct-actions">
        <label>שם ${inp('rltyP_name', p.name, 'type="text"')}</label>
        <label>חודש התחלה ${inp('rltyP_startMonth', p.startMonth, 'type="month"')}</label>
        <label>משך (חודשים) ${inp('rltyP_months', p.months, 'type="number" min="1" max="120" step="1"')}</label>
        <label>הון עצמי (₪) ${inp('rltyP_equity', p.equity, 'type="number" min="0" step="any"')}</label>
        <label>ריבית שנתית על גירעון (%) ${inp('rltyP_deficitRate', p.deficitRate, 'type="number" min="0" max="30" step="any"')}</label>
      </div>
      <h4>עלויות</h4>
      <p class="muted">כל עלות נפרסת שווה בשווה מהחודש שלה על פני מספר החודשים (חודש 1 = חודש ההתחלה).</p>
      <div class="acct-scroll"><table class="acct-table"><thead><tr><th>סוג</th><th>תיאור</th><th>סכום (₪)</th><th>מחודש</th><th>על פני חודשים</th><th></th></tr></thead>
        <tbody>${p.costs.map(costRow).join('')}</tbody></table></div>
      <div class="acct-actions"><button class="secondary" id="rltyPcAdd">＋ עלות</button></div>
      <h4>מכירות</h4>
      <div class="acct-scroll"><table class="acct-table"><thead><tr><th>יחידה</th><th>כמות</th><th>מחיר ליחידה (₪)</th><th>חודש המכירה</th><th></th></tr></thead>
        <tbody>${p.sales.map(saleRow).join('')}</tbody></table></div>
      <div class="acct-actions"><button class="secondary" id="rltyPsAdd">＋ מכירה</button></div>
      <label>לוח תשלומים של הקונים — שורה לכל תשלום: "אחוז, חודשים מהמכירה" (0 = בחודש המכירה; סה"כ 100%)
        <textarea class="ss-input" id="rltyP_planText" rows="4">${esc(p.planText)}</textarea></label>
      <label>הערות <textarea class="ss-input" id="rltyP_notes" rows="2">${esc(p.notes)}</textarea></label>
      <div class="acct-actions">
        <button id="rltyPCalc">חישוב התזרים</button>
        <button class="secondary" id="rltyPSave">${p.id ? 'עדכון הפרויקט' : 'שמירת הפרויקט'}</button>
        ${p.id ? '<button class="secondary" id="rltyPNew">פרויקט חדש</button>' : ''}
      </div>
    </div>
    ${rltyProjectResultHtml(rltyUi.projResult)}
    ${projects.length ? `<div class="card"><h3>פרויקטים שמורים</h3>${projects.map(x => `<div class="acct-row"><span>${esc(x.name)} <small class="muted">${esc(x.startMonth)} · ${x.months} חודשים</small></span><span>
      <button class="secondary" data-rlty-project="${esc(x.id)}">פתיחה</button>
      <button class="icon-btn danger" data-rlty-project-del="${esc(x.id)}" title="מחיקת פרויקט">🗑</button></span></div>`).join('')}</div>` : ''}`;
}

// קריאת הטופס אל rltyUi.proj (לפני כל רינדור מחדש, כדי לא לאבד הקלדה)
function rltyProjCollect() {
  const p = rltyUi.proj || rltyProjBlank();
  const val = (id) => { const el = document.getElementById(id); return el ? el.value : undefined; };
  for (const k of ['name', 'startMonth', 'months', 'equity', 'deficitRate', 'planText', 'notes']) {
    const v = val('rltyP_' + k);
    if (v !== undefined) p[k] = v;
  }
  p.costs = p.costs.map((c, i) => Object.fromEntries(['category', 'label', 'amount', 'from', 'spread'].map(k => [k, val(`rltyPc_${k}_${i}`) ?? c[k]])));
  p.sales = p.sales.map((s, i) => Object.fromEntries(['label', 'units', 'price', 'month'].map(k => [k, val(`rltyPs_${k}_${i}`) ?? s[k]])));
  rltyUi.proj = p;
  return p;
}

function attachRealtyProjectHandlers() {
  const o = rltyData();
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  on('rltyPcAdd', () => { const p = rltyProjCollect(); const last = p.costs[p.costs.length - 1]; p.costs.push({ category: 'other', label: '', amount: '', from: last ? last.from : 1, spread: 1 }); renderView('realty'); });
  on('rltyPsAdd', () => { const p = rltyProjCollect(); const last = p.sales[p.sales.length - 1]; p.sales.push({ label: '', units: 1, price: last ? last.price : '', month: last ? last.month : 1 }); renderView('realty'); });
  document.querySelectorAll('[data-rlty-pc-del]').forEach(b => b.addEventListener('click', () => { const p = rltyProjCollect(); p.costs.splice(Number(b.dataset.rltyPcDel), 1); renderView('realty'); }));
  document.querySelectorAll('[data-rlty-ps-del]').forEach(b => b.addEventListener('click', () => { const p = rltyProjCollect(); p.sales.splice(Number(b.dataset.rltyPsDel), 1); renderView('realty'); }));
  on('rltyPCalc', async () => {
    const p = rltyProjCollect();
    try { rltyUi.projResult = await window.systemAPI.calcRealtyProject({ ...p, name: p.name || 'ללא שם' }); renderView('realty'); }
    catch (error) { showError('שגיאה בחישוב: ' + errMsg(error)); }
  });
  on('rltyPSave', async () => {
    const p = rltyProjCollect();
    try {
      const saved = await window.systemAPI.saveRealtyProject(p.id || '', p);
      rltyUi.proj = { ...saved };
      showToast('הפרויקט נשמר');
      await switchView('realty');
    } catch (error) { showError('שגיאה בשמירה: ' + errMsg(error)); }
  });
  on('rltyPNew', () => { rltyUi.proj = rltyProjBlank(); rltyUi.projResult = null; renderView('realty'); });
  document.querySelectorAll('[data-rlty-project]').forEach(b => b.addEventListener('click', () => {
    const x = (o.projects || []).find(p => p.id === b.dataset.rltyProject);
    if (!x) return;
    rltyUi.proj = JSON.parse(JSON.stringify(x));
    rltyUi.projResult = null;
    renderView('realty');
  }));
  document.querySelectorAll('[data-rlty-project-del]').forEach(b => b.addEventListener('click', async () => {
    if (!(await askConfirm('למחוק את הפרויקט?'))) return;
    try {
      await window.systemAPI.deleteRealtyProject(b.dataset.rltyProjectDel);
      if (rltyUi.proj && rltyUi.proj.id === b.dataset.rltyProjectDel) { rltyUi.proj = rltyProjBlank(); rltyUi.projResult = null; }
      showToast('נמחק');
      await switchView('realty');
    } catch (error) { showError('שגיאה במחיקה: ' + errMsg(error)); }
  }));
}

// ערכי טופס מתוך רשומה בתצוגה (שקלים)
function rltyFormValues(tab, rec) {
  if (tab === 'orders') return { ...rec, exclusive: rec.exclusive ? 'yes' : '' };
  if (tab === 'clients') return { ...rec, areas: rec.areasText || '', types: (rec.types || [])[0] || '', needsMortgage: rec.needsMortgage ? 'yes' : '' };
  if (tab === 'deals') return { ...rec, dependsOnMortgage: rec.dependsOnMortgage ? 'yes' : '' };
  return rec;
}

function attachRealtyHandlers() {
  const o = rltyData();
  const listOf = { properties: o.properties || [], clients: o.clients || [], deals: o.deals || [], orders: o.orders || [] };
  document.querySelectorAll('[data-rlty-tab]').forEach(b => b.addEventListener('click', () => { rltyUi.tab = b.dataset.rltyTab; rltyUi.matches = null; rltyUi.deal = null; renderView('realty'); }));
  attachRealtyCommissionHandlers();
  attachRealtyInvestHandlers();
  attachRealtyProjectHandlers();
  document.querySelectorAll('[data-rlty-edit]').forEach(b => b.addEventListener('click', async () => {
    const tab = b.dataset.rltyEdit;
    const rec = listOf[tab].find(x => x.id === b.dataset.id);
    if (rec) await openSubForm(RLTY_SCHEMAS[tab], rltyFormValues(tab, rec), rec.id);
  }));
  const del = {
    properties: ['למחוק את הנכס?', (id) => window.systemAPI.deleteRealtyProperty(id)],
    clients: ['למחוק את הלקוח?', (id) => window.systemAPI.deleteRealtyClient(id)],
    deals: ['למחוק את העסקה?', (id) => window.systemAPI.deleteRealtyDeal(id)],
    orders: ['למחוק את ההזמנה?', (id) => window.systemAPI.deleteRealtyOrder(id)]
  };
  document.querySelectorAll('[data-rlty-del]').forEach(b => b.addEventListener('click', async () => {
    const [msg, fn] = del[b.dataset.rltyDel];
    if (!(await askConfirm(msg))) return;
    try { await fn(b.dataset.id); showToast('נמחק'); await switchView('realty'); }
    catch (error) { showError('שגיאה במחיקה: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-rlty-match]').forEach(b => b.addEventListener('click', async () => {
    const kind = b.dataset.rltyMatch;
    try {
      const rows = await window.systemAPI.getRealtyMatches(kind, b.dataset.id);
      const rec = (kind === 'client' ? listOf.clients : listOf.properties).find(x => x.id === b.dataset.id) || {};
      rltyUi.matches = { kind, title: kind === 'client' ? rec.name : rec.title, rows };
      renderView('realty');
    } catch (error) { showError('שגיאה בהתאמה: ' + errMsg(error)); }
  }));
  const close = document.getElementById('rltyMatchClose');
  if (close) close.addEventListener('click', () => { rltyUi.matches = null; renderView('realty'); });
}
