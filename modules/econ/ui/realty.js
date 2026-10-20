// ממשק המודול הכלכלי — נדל"ן ותיווך: נכסים, לקוחות, התאמה ועסקאות.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

const RLTY_TABS = [['properties', 'נכסים'], ['clients', 'לקוחות'], ['deals', 'עסקאות']];
const rltyUi = { tab: 'properties', matches: null };
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

const RLTY_SCHEMAS = { properties: rltyPropertySchema, clients: rltyClientSchema, deals: rltyDealSchema };

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
  const count = { properties: (o.properties || []).length, clients: (o.clients || []).length, deals: (o.deals || []).length };
  return `<div class="lab-tabs" role="tablist">${RLTY_TABS.map(([id, label]) => `<button class="${rltyUi.tab === id ? '' : 'secondary'}" data-rlty-tab="${id}" aria-pressed="${rltyUi.tab === id}">${label} (${count[id]})</button>`).join('')}</div>`;
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

function rltyDealsHtml(o) {
  const board = o.board || [];
  const up = o.upcoming || [];
  if (!(o.deals || []).length) return renderEmpty('אין עסקאות עדיין — לחץ "＋ הוספת רשומה" כדי לפתוח עסקה על נכס', '🤝');
  return `
    ${up.length ? `<div class="card"><h3>מועדים קרובים</h3><ul>${up.map(u => `<li${u.overdue ? ' class="warn"' : ''}>${esc(u.date)} — ${esc(u.label)}${u.mortgage ? ' <span class="ss-badge ss-badge-warn">תלוי במשכנתא</span>' : ''}${u.overdue ? ' (עבר)' : ''}</li>`).join('')}</ul></div>` : ''}
    <div class="ss-board">${board.map(col => `
      <div class="ss-board-col${col.closed ? ' is-closed' : ''}">
        <h4><span>${esc(col.label)}</span><span>${col.cards.length}</span></h4>
        ${col.cards.map(d => `<div class="ss-board-card">
          <strong>${esc(d.propertyTitle)}</strong>
          <span>${money(d.price)}</span><br>
          <small>${esc(d.buyerName)}${d.sellerName ? ' ← ' + esc(d.sellerName) : ''}</small>
          ${d.dependsOnMortgage ? '<br><small>תלוי במשכנתא</small>' : ''}${d.lostReason ? `<br><small>${esc(d.lostReason)}</small>` : ''}
          <div><button class="icon-btn" data-rlty-edit="deals" data-id="${esc(d.id)}" title="עריכת עסקה">✏</button>
            <button class="icon-btn danger" data-rlty-del="deals" data-id="${esc(d.id)}" title="מחיקת עסקה">🗑</button></div>
        </div>`).join('')}
      </div>`).join('')}
    </div>`;
}

function renderRealty(o) {
  const d = o || {};
  const body = rltyUi.tab === 'clients' ? rltyClientsHtml(d) : rltyUi.tab === 'deals' ? rltyDealsHtml(d) : rltyPropertiesHtml(d);
  return `<div class="realty mortgage-lab">${rltyTabsHtml(d)}${rltyMatchesHtml()}${body}</div>`;
}

// ערכי טופס מתוך רשומה בתצוגה (שקלים)
function rltyFormValues(tab, rec) {
  if (tab === 'clients') return { ...rec, areas: rec.areasText || '', types: (rec.types || [])[0] || '', needsMortgage: rec.needsMortgage ? 'yes' : '' };
  if (tab === 'deals') return { ...rec, dependsOnMortgage: rec.dependsOnMortgage ? 'yes' : '' };
  return rec;
}

function attachRealtyHandlers() {
  const o = rltyData();
  const listOf = { properties: o.properties || [], clients: o.clients || [], deals: o.deals || [] };
  document.querySelectorAll('[data-rlty-tab]').forEach(b => b.addEventListener('click', () => { rltyUi.tab = b.dataset.rltyTab; rltyUi.matches = null; renderView('realty'); }));
  document.querySelectorAll('[data-rlty-edit]').forEach(b => b.addEventListener('click', async () => {
    const tab = b.dataset.rltyEdit;
    const rec = listOf[tab].find(x => x.id === b.dataset.id);
    if (rec) await openSubForm(RLTY_SCHEMAS[tab], rltyFormValues(tab, rec), rec.id);
  }));
  const del = {
    properties: ['למחוק את הנכס?', (id) => window.systemAPI.deleteRealtyProperty(id)],
    clients: ['למחוק את הלקוח?', (id) => window.systemAPI.deleteRealtyClient(id)],
    deals: ['למחוק את העסקה?', (id) => window.systemAPI.deleteRealtyDeal(id)]
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
