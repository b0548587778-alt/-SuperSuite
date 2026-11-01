// ממשק המודול הכלכלי — עמותה: תרומות, קבלות, קמפיינים, הנצחות, הוראות קבע.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

// ============================================================
// עמותה — תרומות וקבלות סעיף 46, קרנות ייעודיות/כללי, תמיכות ודוח שנתי.
// נפרד לחלוטין מהיומן העסקי: עמותה אינה עוסק, ותרומה אינה עסקה.
// ============================================================
const NPO_DONOR_TYPES = { israeli: 'תושב ישראל', anonymous: 'בעילום שם / בלי ת.ז', foreign: 'תושב חוץ' };
const NPO_METHODS = { cash: 'מזומן', check: 'המחאה', transfer: 'העברה בנקאית', card: 'כרטיס אשראי', standing: 'הוראת קבע' };
const NPO_GRANT_STATUS = { requested: 'הוגשה בקשה', approved: 'אושרה', paid: 'שולמה', rejected: 'נדחתה' };
const NPO_VAT = { exempt: 'פטורה ממע"מ', malkar: 'מלכ"ר', osek: 'עוסק מורשה' };
const npoYear = () => state.npoYear || (state.npoYear = new Date().getFullYear());
const npoFundOptions = (o) => (Array.isArray(o && o.funds) ? o.funds : [{ id: 'general', name: 'כללי' }])
  .filter(f => !f.archived).map(f => ({ value: f.id, label: f.name + (f.restricted ? ' (ייעודי)' : '') }));
const opts = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));

// תשלום תמורת שירות אינו תרומה — הסבר בטופס התרומה ובהוראת הקבע (PLAN שלב 10, 10.1ה; הנוסח לאישור הבעלים, ה15)
const TUITION_HINT = 'שכר לימוד, דמי רישום או תשלום תמורת שירות אינם תרומה — אין לרשום אותם כאן (קבלה לפי סעיף 46 ניתנת רק על תרומה בלי תמורה).';

formSchemas['npo'] = {
  title: 'תרומה חדשה — הפקת קבלה',
  prepare: async (schema) => {
    const o = await window.systemAPI.getNpoOverview(npoYear());
    schema.fields.find(f => f.name === 'fundId').options = npoFundOptions(o);
    schema.fields.find(f => f.name === 'campaignId').options = openCampaignOptions(o);
    schema.fields.find(f => f.name === 'ambassadorId').options = [{ value: '', label: '— ללא —' }, ...(o.campaigns || []).filter(x => !x.closed && x.status !== 'ended')
      .flatMap(x => (x.ambassadors || []).map(a => ({ value: a.id, label: `${a.name} (${x.name})` })))];
    schema.fields.find(f => f.name === 'date').value = today();
  },
  fields: [
    { name: 'date', label: 'תאריך התרומה', type: 'date', required: true },
    { name: 'donorName', label: 'שם התורם', type: 'text', required: true },
    { name: 'donorType', label: 'סוג התורם (לדיווח ל"תרומות ישראל")', type: 'select', options: opts(NPO_DONOR_TYPES) },
    { name: 'donorId', label: 'ת.ז / ח.פ של התורם (לתושב ישראל)', type: 'text' },
    { name: 'amount', label: 'סכום (₪) — בתרומה במטבע זר יחושב לפי השער', type: 'number' },
    ...CURRENCY_FIELDS,
    { name: 'method', label: 'אמצעי תשלום', type: 'select', options: opts(NPO_METHODS) },
    { name: 'fundId', label: 'קרן', type: 'select', options: [] },
    { name: 'campaignId', label: 'קמפיין', type: 'select', options: [] },
    { name: 'ambassadorId', label: 'שגריר בקמפיין', type: 'select', options: [] },
    { name: 'purpose', label: 'ייעוד / הערה לקבלה', type: 'text', hint: TUITION_HINT },
    { name: 'reference', label: 'אסמכתא (מס\' המחאה / העברה)', type: 'text' },
    { name: 'donorAddress', label: 'כתובת התורם', type: 'text' },
    { name: 'donorPhone', label: 'טלפון התורם', type: 'tel' }
  ],
  create: (d) => window.systemAPI.addNpoDonation(d)
};

const npoSettingsSchema = {
  title: 'הגדרות עמותה',
  fields: [
    { name: 'orgName', label: 'שם העמותה', type: 'text', required: true },
    { name: 'regNumber', label: 'מספר עמותה (ע"ר, 9 ספרות)', type: 'text' },
    { name: 'address', label: 'כתובת', type: 'text' },
    { name: 'phone', label: 'טלפון', type: 'tel' },
    { name: 'sec46Number', label: 'מספר אישור סעיף 46', type: 'text' },
    { name: 'sec46ValidUntil', label: 'תוקף אישור סעיף 46', type: 'date' },
    { name: 'vatStatus', label: 'מעמד מע"מ', type: 'select', options: [
      { value: 'exempt', label: 'עמותה פטורה ממע"מ (ברירת מחדל)' },
      { value: 'malkar', label: 'מלכ"ר' },
      { value: 'osek', label: 'עוסק מורשה' }
    ]},
    { name: 'vatNumber', label: 'מספר עוסק (רק לעוסק מורשה)', type: 'text' },
    { name: 'largeDonorThreshold', label: 'סף "תורם גדול" לדוח השנתי (₪)', type: 'number' },
    { name: 'fundsText', label: 'קרנות ייעודיות — שורה לכל קרן ("כללי" קיימת תמיד)', type: 'textarea' }
  ],
  // ריקון שדה הקרנות פירושו "אין קרנות ייעודיות" — לכן נשלח תמיד, גם כשהוא ריק
  create: (d) => window.systemAPI.saveNpoSettings({ ...d, fundsText: d.fundsText || '' })
};

const npoGrantSchema = {
  title: 'תמיכה / מענק חדש',
  editTitle: 'עריכת תמיכה',
  prepare: async (schema) => {
    const o = await window.systemAPI.getNpoOverview(npoYear());
    schema.fields.find(f => f.name === 'fundId').options = npoFundOptions(o);
    schema.fields.find(f => f.name === 'year').value = npoYear();
  },
  fields: [
    { name: 'source', label: 'גורם מממן (משרד / רשות)', type: 'text', required: true },
    { name: 'program', label: 'שם התמיכה / התוכנית', type: 'text' },
    { name: 'year', label: 'שנה', type: 'number', required: true },
    { name: 'status', label: 'סטטוס', type: 'select', options: opts(NPO_GRANT_STATUS) },
    { name: 'approved', label: 'סכום שאושר (₪)', type: 'number' },
    { name: 'received', label: 'סכום שהתקבל (₪)', type: 'number' },
    { name: 'fundId', label: 'קרן', type: 'select', options: [] },
    { name: 'reference', label: 'מספר תיק / בקשה', type: 'text' },
    { name: 'deadline', label: 'מועד אחרון להגשה', type: 'date' },
    { name: 'matchingPercent', label: 'מימון תואם נדרש (% מהסכום שאושר)', type: 'number' },
    { name: 'documentsText', label: 'מסמכים נדרשים — שורה לכל מסמך', type: 'textarea' },
    { name: 'notes', label: 'הערות', type: 'textarea' }
  ],
  // רשימת המסמכים נשלחת תמיד — ריקון השדה פירושו "אין מסמכים נדרשים"
  create: (d) => window.systemAPI.addNpoGrant({ ...d, documentsText: d.documentsText || '' }),
  update: (id, d) => window.systemAPI.updateNpoGrant(id, { ...d, documentsText: d.documentsText || '' })
};
// הוראות קבע — מעקב בלבד. אין כאן שדות לפרטי אשראי/חשבון בכוונה
const SO_METHODS = { standing: 'הוראת קבע בנקאית', card: 'הוראת קבע באשראי' };
const SO_STATUS = { received: 'התקבל', failed: 'נכשל', missed: 'לא סומן', due: 'צפוי החודש', upcoming: 'צפוי', ended: 'הסתיימה', future: 'טרם התחילה' };
const npoStandingSchema = {
  title: 'הוראת קבע חדשה',
  editTitle: 'עריכת הוראת קבע',
  prepare: async (schema) => {
    const o = await window.systemAPI.getNpoOverview(npoYear());
    schema.fields.find(f => f.name === 'fundId').options = npoFundOptions(o);
    schema.fields.find(f => f.name === 'startMonth').value = today().slice(0, 7);
    schema.fields.find(f => f.name === 'dayOfMonth').value = 1;
  },
  fields: [
    { name: 'donorName', label: 'שם התורם', type: 'text', required: true },
    { name: 'donorId', label: 'ת.ז / ח.פ של התורם', type: 'text' },
    { name: 'amount', label: 'סכום חודשי (₪)', type: 'number', required: true },
    { name: 'dayOfMonth', label: 'יום החיוב בחודש (1–31)', type: 'number', required: true },
    { name: 'startMonth', label: 'חודש התחלה (YYYY-MM)', type: 'text', required: true },
    { name: 'endMonth', label: 'חודש סיום (ריק = ללא הגבלה)', type: 'text' },
    { name: 'method', label: 'סוג', type: 'select', options: opts(SO_METHODS) },
    { name: 'fundId', label: 'קרן', type: 'select', options: [] },
    { name: 'purpose', label: 'ייעוד לקבלה', type: 'text', hint: TUITION_HINT },
    { name: 'donorPhone', label: 'טלפון', type: 'tel' },
    { name: 'donorAddress', label: 'כתובת', type: 'text' },
    { name: 'notes', label: 'הערות (בלי פרטי אשראי או חשבון)', type: 'textarea' }
  ],
  create: (d) => window.systemAPI.saveNpoStandingOrder(null, { ...d, endMonth: d.endMonth || '' }),
  update: (id, d) => window.systemAPI.saveNpoStandingOrder(id, { ...d, endMonth: d.endMonth || '' })
};

// קמפיינים — יעד, תקופה ותורם מכפיל. ההכפלה מוצגת כחישוב; כסף המכפיל נרשם כתרומה רגילה כשהוא מתקבל
const CMP_STATUS = { active: 'פעיל', upcoming: 'טרם התחיל', ended: 'הסתיים', closed: 'סגור' };
const campaignSchema = {
  title: 'קמפיין חדש',
  editTitle: 'עריכת קמפיין',
  prepare: async (schema) => {
    const o = await window.systemAPI.getNpoOverview(npoYear());
    schema.fields.find(f => f.name === 'fundId').options = npoFundOptions(o);
    schema.fields.find(f => f.name === 'startDate').value = today();
  },
  fields: [
    { name: 'name', label: 'שם הקמפיין', type: 'text', required: true },
    { name: 'goal', label: 'יעד (₪)', type: 'number', required: true },
    { name: 'startDate', label: 'תאריך התחלה', type: 'date', required: true },
    { name: 'endDate', label: 'תאריך סיום', type: 'date', required: true },
    { name: 'fundId', label: 'קרן', type: 'select', options: [] },
    { name: 'matchDonor', label: 'שם התורם המכפיל — בדיוק כפי שנרשם בתרומות (חובה כשיש הכפלה)', type: 'text' },
    { name: 'matchRatio', label: 'יחס הכפלה (1 = כל שקל מוכפל, 2 = משולש; ריק = בלי)', type: 'number' },
    { name: 'matchCap', label: 'תקרת ההכפלה — הסכום שהמכפיל התחייב אליו (₪)', type: 'number' },
    { name: 'ambassadorsText', label: 'שגרירים — שורה לכל שגריר: שם, קוד, יעד אישי (קוד ויעד לא חובה)', type: 'textarea' },
    { name: 'closed', label: 'מצב', type: 'select', options: [{ value: 'false', label: 'פתוח לשיוך תרומות' }, { value: 'true', label: 'סגור' }] },
    { name: 'notes', label: 'הערות', type: 'textarea' }
  ],
  create: (d) => window.systemAPI.saveNpoCampaign(null, campaignInput(d)),
  update: (id, d) => window.systemAPI.saveNpoCampaign(id, campaignInput(d))
};
function campaignInput(d) {
  const out = { ...d };
  for (const k of ['matchDonor', 'matchRatio', 'matchCap', 'notes', 'ambassadorsText']) if (out[k] === undefined) out[k] = '';
  return out;
}
const openCampaignOptions = (o) => [{ value: '', label: '— ללא —' },
  ...(Array.isArray(o && o.campaigns) ? o.campaigns : []).filter(c => !c.closed && c.status !== 'ended')
    .map(c => ({ value: c.id, label: `${c.name} (${c.startDate} – ${c.endDate})` }))];

function renderNpoCampaigns(list) {
  if (!Array.isArray(list)) return '';
  const bar = (p) => `<div style="background:var(--border);border-radius:6px;height:10px;overflow:hidden"><div style="width:${Math.min(100, Math.max(0, Number(p) || 0))}%;height:100%;background:var(--ss-cat-teal)"></div></div>`;
  return `<div class="card acct-wide">
    <div class="hub-head"><h3>קמפיינים (${list.length})</h3>
      <div class="acct-actions"><button class="secondary" id="npoCampaignAdd">＋ קמפיין</button></div></div>
    ${list.length === 0 ? renderEmpty('אין קמפיינים. קמפיין מרכז תרומות סביב יעד ותקופה — אפשר גם עם תורם מכפיל.') : list.map(c => `
      <div class="acct-row" style="display:block">
        <div style="display:flex;justify-content:space-between;gap:1rem">
          <span><strong>${esc(c.name)}</strong> <small class="${c.status === 'active' ? 'ok' : 'muted'}">${esc(CMP_STATUS[c.status] || c.status)}${c.daysLeft !== null && c.daysLeft !== undefined ? ' · עוד ' + Number(c.daysLeft) + ' ימים' : ''}</small>
            <small class="muted">· ${esc(c.startDate)} – ${esc(c.endDate)}</small></span>
          <span>${money(c.total)} / ${money(c.goal)} <small>(${Number(c.percent)}%)</small>
            <button class="icon-btn" data-cmp-edit="${esc(c.id)}" title="עריכה">✎</button>
            ${c.donationsCount ? '' : `<button class="icon-btn danger" data-cmp-del="${esc(c.id)}" title="מחיקה">🗑</button>`}</span>
        </div>
        ${bar(c.percent)}
        <small class="muted">${Number(c.donationsCount)} תרומות · ${Number(c.donorsCount)} תורמים · נאסף ${money(c.raised)}${c.matchRatio ? ` · הכפלה${c.matchDonor ? ' של ' + esc(c.matchDonor) : ''}: ${money(c.matched)} (נותרו ${money(c.matchLeft)} מתוך ${money(c.matchCap)})` : ''}${c.matchRatio && !c.matchDonorMissing ? ` · מהמכפיל התקבלו ${money(c.matcherRaised)} (${Number(c.matcherCount) || 0} תרומות)` : ''}${c.remaining ? ' · חסר ' + money(c.remaining) : ' · היעד הושג ✓'}</small>
        ${c.matchDonorMissing ? '<div><small class="bad">⚠ חסר שם התורם המכפיל — כספו לא מזוהה בתרומות, וההכפלה עלולה להיספר פעמיים. יש לערוך את הקמפיין ולרשום את השם.</small></div>' : ''}
        ${c.ambassadorRows && c.ambassadorRows.length ? `<details><summary><small>שגרירים (${c.ambassadorRows.length})</small></summary>${c.ambassadorRows.map(a => `<div class="acct-row"><span>${esc(a.name)} <small class="muted">קוד ${esc(a.code)} · ${Number(a.count)} תרומות</small></span><span>${money(a.raised)}${a.goal ? ` / ${money(a.goal)} <small>(${Number(a.percent)}%)</small>` : ''}</span></div>`).join('')}</details>` : ''}
        ${c.topDonors && c.topDonors.length ? `<div><small class="muted">מובילים: ${c.topDonors.map(t => esc(t.name) + ' ' + money(t.amount)).join(' · ')}</small></div>` : ''}
      </div>`).join('')}
  </div>`;
}

function attachNpoCampaignHandlers() {
  const list = (state.data.npo && state.data.npo.campaigns) || [];
  const add = document.getElementById('npoCampaignAdd');
  if (add) add.addEventListener('click', () => openSubForm(campaignSchema, { closed: 'false' }));
  document.querySelectorAll('[data-cmp-edit]').forEach(b => b.addEventListener('click', () => {
    const c = list.find(x => x.id === b.dataset.cmpEdit);
    if (c) openSubForm(campaignSchema, { ...c, closed: c.closed ? 'true' : 'false', matchRatio: c.matchRatio || '', matchCap: c.matchCap || '',
      ambassadorsText: (c.ambassadors || []).map(a => [a.name, a.code, a.goal || ''].join(', ').replace(/, $/, '')).join('\n') }, c.id);
  }));
  document.querySelectorAll('[data-cmp-del]').forEach(b => b.addEventListener('click', async () => {
    if (!(await askConfirm('למחוק את הקמפיין?'))) return;
    try { await window.systemAPI.deleteNpoCampaign(b.dataset.cmpDel); showToast('הקמפיין נמחק'); await switchView('npo'); }
    catch (error) { showError('שגיאה במחיקה: ' + errMsg(error)); }
  }));
}

// הנצחות ויארצייטים — רישום לפי תאריך פטירה אזרחי (מומר לעברי) או ישירות לפי תאריך עברי
const MEM_MONTHS = [['Tishri', 'תשרי'], ['Heshvan', 'חשוון'], ['Kislev', 'כסלו'], ['Tevet', 'טבת'], ['Shevat', 'שבט'],
  ['Adar', 'אדר (שנה פשוטה)'], ['Adar I', 'אדר א׳'], ['Adar II', 'אדר ב׳'], ['Nisan', 'ניסן'], ['Iyar', 'אייר'],
  ['Sivan', 'סיוון'], ['Tamuz', 'תמוז'], ['Av', 'אב'], ['Elul', 'אלול']];
const MEM_ADAR = { '': '—', adar1: 'באדר א׳', adar2: 'באדר ב׳', both: 'בשניהם' };
const memorialSchema = {
  title: 'הנצחה חדשה',
  editTitle: 'עריכת הנצחה',
  fields: [
    { name: 'name', label: 'שם הנפטר/ת', type: 'text', required: true },
    { name: 'parentName', label: 'בן/בת (שם האב או האם)', type: 'text' },
    { name: 'deathDate', label: 'תאריך פטירה לועזי (אם ידוע — התאריך העברי יחושב)', type: 'date' },
    { name: 'afterSunset', label: 'הפטירה הייתה אחרי השקיעה?', type: 'select', options: [{ value: '0', label: 'לא' }, { value: '1', label: 'כן — היום העברי כבר התחלף' }] },
    { name: 'hebrewDay', label: 'או: יום בחודש העברי (1–30)', type: 'number' },
    { name: 'hebrewMonth', label: 'חודש עברי', type: 'select', options: [{ value: '', label: '—' }, ...MEM_MONTHS.map(([v, l]) => ({ value: v, label: l }))] },
    { name: 'hebrewYear', label: 'שנה עברית (למשל 5786, לא חובה)', type: 'number' },
    { name: 'adarRule', label: 'נפטר באדר של שנה פשוטה — בשנה מעוברת מציינים', type: 'select', options: Object.entries(MEM_ADAR).map(([v, l]) => ({ value: v, label: l })) },
    { name: 'contactName', label: 'איש קשר במשפחה', type: 'text' },
    { name: 'contactPhone', label: 'טלפון', type: 'tel' },
    { name: 'contactId', label: 'ת.ז של איש הקשר', type: 'text' },
    { name: 'plaque', label: 'מיקום הלוח / הנר', type: 'text' },
    { name: 'notes', label: 'הערות', type: 'textarea' }
  ],
  create: (d) => window.systemAPI.saveNpoMemorial(null, memorialInput(d)),
  update: (id, d) => window.systemAPI.saveNpoMemorial(id, memorialInput(d))
};
// שדה שרוקן בעריכה נשלח ריק במפורש, כדי שהערך הקודם לא יישאר
function memorialInput(d) {
  const out = { ...d };
  for (const k of ['deathDate', 'hebrewYear', 'adarRule', 'parentName', 'contactName', 'contactPhone', 'contactId', 'plaque', 'notes']) if (out[k] === undefined) out[k] = '';
  return out;
}

function renderNpoMemorials(m) {
  if (!m || !Array.isArray(m.list)) return '';
  const soon = (m.rows || []).filter(r => r.daysLeft <= 30);
  const when = (r) => r.daysLeft === 0 ? 'היום' : r.daysLeft === 1 ? 'מחר' : `בעוד ${Number(r.daysLeft)} ימים`;
  return `<div class="card acct-wide">
    <div class="hub-head"><h3>הנצחות ויארצייטים (${m.list.length})</h3>
      <div class="acct-actions">
        <button class="secondary" id="npoMemorialAdd">＋ הנצחה</button>
        ${m.list.length ? '<button class="secondary" id="npoMemorialExport">ייצוא</button>' : ''}
      </div></div>
    ${m.available === false ? '<p class="bad">הלוח העברי אינו זמין במחשב זה — לא ניתן לחשב יארצייטים.</p>' : ''}
    <h4>ב-30 הימים הקרובים</h4>
    ${soon.length ? soon.map(r => `<div class="acct-row">
        <span>${esc(r.name)}${r.parentName ? ' ' + esc(r.parentName) : ''} <small class="muted">${esc(r.hebrew)} · ${esc(r.date)}${r.years ? ' · ' + Number(r.years) + ' שנים' : ''}${r.plaque ? ' · ' + esc(r.plaque) : ''}</small>
          ${r.uncertain ? '<small class="bad" title="אין יום ל׳ בחודש זה השנה — יש לברר עם המשפחה או עם הרב באיזה יום מציינים">· לבירור</small>' : ''}</span>
        <span>${when(r)}${r.contactPhone ? ` <small class="muted">${esc(r.contactName)} ${esc(r.contactPhone)}</small>` : ''}</span>
      </div>`).join('') : '<div class="acct-row muted">אין יארצייטים בחודש הקרוב</div>'}
    ${m.list.length ? `<details><summary>כל הרשומות</summary>
      ${m.list.map(x => `<div class="acct-row"><span>${esc(x.name)}${x.parentName ? ' ' + esc(x.parentName) : ''} <small class="muted">${esc(x.hebrewLabel)}</small></span>
        <span><button class="icon-btn" data-mem-edit="${esc(x.id)}" title="עריכה">✎</button>
          <button class="icon-btn danger" data-mem-del="${esc(x.id)}" title="מחיקה">🗑</button></span></div>`).join('')}
    </details>` : ''}
  </div>`;
}

function attachNpoMemorialHandlers() {
  const m = state.data.npo && state.data.npo.memorials;
  const add = document.getElementById('npoMemorialAdd');
  if (add) add.addEventListener('click', () => openSubForm(memorialSchema, { afterSunset: '0' }));
  const exp = document.getElementById('npoMemorialExport');
  if (exp) exp.addEventListener('click', async () => {
    try { const r = await window.systemAPI.exportNpoMemorialsCsv(); if (r && r.ok) showToast('הקובץ נשמר'); }
    catch (error) { showError('שגיאה בייצוא: ' + errMsg(error)); }
  });
  document.querySelectorAll('[data-mem-edit]').forEach(b => b.addEventListener('click', () => {
    const x = m && m.list.find(r => r.id === b.dataset.memEdit);
    if (x) openSubForm(memorialSchema, { ...x, afterSunset: x.afterSunset ? '1' : '0', hebrewYear: x.hebrewYear ?? '' }, x.id);
  }));
  document.querySelectorAll('[data-mem-del]').forEach(b => b.addEventListener('click', async () => {
    if (!(await askConfirm('למחוק את רשומת ההנצחה?'))) return;
    try { await window.systemAPI.deleteNpoMemorial(b.dataset.memDel); showToast('הרשומה נמחקה'); await switchView('npo'); }
    catch (error) { showError('שגיאה במחיקה: ' + errMsg(error)); }
  }));
}

function renderNpoStanding(st) {
  if (!st || !Array.isArray(st.rows)) return '';
  const rows = st.rows;
  const monthBtns = (r) => r.status === 'due' || r.status === 'missed' || r.status === 'upcoming'
    ? `<button class="secondary small" data-so-pay="${esc(r.id)}" data-so-month="${esc(st.month)}" title="התקבל — הפקת קבלה">✓ התקבל</button>
       <button class="secondary small" data-so-fail="${esc(r.id)}" data-so-month="${esc(st.month)}" title="החיוב נכשל">✗ נכשל</button>` : '';
  return `<div class="card acct-wide">
    <div class="hub-head"><h3>הוראות קבע — ${esc(st.month)}</h3>
      <div class="acct-actions"><button class="secondary" id="npoStandingAdd">＋ הוראת קבע</button></div></div>
    <p class="muted">החיוב נעשה בבנק או בחברת האשראי. כאן מסמנים מה התקבל — וקבלה מופקת אוטומטית. פרטי אשראי לא נשמרים; בהוראה בנקאית אפשר לשמור חשבון לחיוב בקובץ מס"ב (🏦).</p>
    <div class="kpis">
      <div class="kpi"><small>הוראות פעילות</small><strong>${Number(st.activeCount) || 0}</strong></div>
      <div class="kpi"><small>צפוי החודש</small><strong>${money(st.expected)}</strong></div>
      <div class="kpi ${tone(st.received)}"><small>התקבל החודש</small><strong>${money(st.received)}</strong></div>
      <div class="kpi${st.missedCount ? ' neg' : ''}"><small>חודשים שלא סומנו</small><strong>${Number(st.missedCount) || 0}</strong></div>
      <div class="kpi${st.atRisk ? ' neg' : ''}"><small>נכשלו פעמיים ברצף ומעלה</small><strong>${Number(st.atRisk) || 0}</strong></div>
    </div>
    ${rows.length === 0 ? renderEmpty('אין הוראות קבע עדיין') : `<div class="acct-scroll"><table class="acct-table">
      <thead><tr><th>תורם</th><th>סכום</th><th>יום</th><th>תקופה</th><th>החודש</th><th>פתוחים</th><th></th></tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.ended ? 'muted' : ''}">
        <td>${esc(r.donorName)}${r.failures >= 2 ? ` <small class="bad">· ${r.failures} כישלונות ברצף</small>` : ''}${r.bankMasked ? ` <small class="muted">· 🏦 ${esc(r.bankMasked)}</small>` : ''}${r.masavStopped ? ` <small class="bad">· מס"ב נעצר: ${esc(r.masavStopped)}</small>` : ''}</td>
        <td>${money(r.amount)}</td><td>${Number(r.dayOfMonth)}</td>
        <td><small>${esc(r.startMonth)}${r.endMonth ? ' – ' + esc(r.endMonth) : ' ואילך'}</small></td>
        <td><small class="${r.status === 'failed' || r.status === 'missed' ? 'bad' : r.status === 'received' ? 'ok' : 'muted'}">${esc(SO_STATUS[r.status] || r.status)}</small> ${monthBtns(r)}</td>
        <td>${(r.openMonths || []).filter(m => m !== st.month).map(m => `<button class="secondary small" data-so-pay="${esc(r.id)}" data-so-month="${esc(m)}" title="סימון התקבל לחודש ${esc(m)}">${esc(m)}</button>`).join(' ') || '—'}</td>
        <td><button class="icon-btn" data-so-edit="${esc(r.id)}" title="עריכה">✎</button>
          ${r.method === 'standing' && !r.ended ? `<button class="icon-btn" data-so-bank="${esc(r.id)}" title="חשבון לחיוב במס&quot;ב">🏦</button>` : ''}
          ${r.receivedCount ? '' : `<button class="icon-btn danger" data-so-del="${esc(r.id)}" title="מחיקה">🗑</button>`}</td>
      </tr>`).join('')}</tbody></table></div>`}
  </div>`;
}

function attachNpoStandingHandlers() {
  const st = state.data.npo && state.data.npo.standing;
  const add = document.getElementById('npoStandingAdd');
  if (add) add.addEventListener('click', () => openSubForm(npoStandingSchema));
  const record = async (id, month, status) => {
    try {
      const r = await window.systemAPI.recordNpoStandingPayment(id, month, status);
      showToast(status === 'received' ? `נרשם — קבלה ${r.donation && r.donation.receipt ? r.donation.receipt.number : ''}` : 'נרשם ככישלון');
      await switchView('npo');
    } catch (error) { showError('שגיאה ברישום: ' + errMsg(error)); }
  };
  document.querySelectorAll('[data-so-pay]').forEach(b => b.addEventListener('click', () => record(b.dataset.soPay, b.dataset.soMonth, 'received')));
  document.querySelectorAll('[data-so-fail]').forEach(b => b.addEventListener('click', () => record(b.dataset.soFail, b.dataset.soMonth, 'failed')));
  document.querySelectorAll('[data-so-edit]').forEach(b => b.addEventListener('click', () => {
    const o = st && st.rows.find(x => x.id === b.dataset.soEdit);
    if (o) openSubForm(npoStandingSchema, o, o.id);
  }));
  document.querySelectorAll('[data-so-bank]').forEach(b => b.addEventListener('click', async () => {
    const o = st && st.rows.find(x => x.id === b.dataset.soBank);
    try {
      if (await masavBankForm(`חשבון לחיוב — ${o ? o.donorName : ''}`, o && o.bankMasked, (v) => window.systemAPI.setNpoStandingBank(b.dataset.soBank, v))) await switchView('npo');
    } catch (error) { showError('שגיאה בשמירת החשבון: ' + errMsg(error)); }
  }));
  attachMasavHandlers(st && st.masav);
  document.querySelectorAll('[data-so-del]').forEach(b => b.addEventListener('click', async () => {
    if (!(await askConfirm('למחוק את הוראת הקבע?'))) return;
    try { await window.systemAPI.deleteNpoStandingOrder(b.dataset.soDel); showToast('הוראת הקבע נמחקה'); await switchView('npo'); }
    catch (error) { showError('שגיאה במחיקה: ' + errMsg(error)); }
  }));
}

const NPO_TAX = { pending: 'ממתין לדיווח', reported: 'דווח', 'cancel-pending': 'ביטול ממתין', 'cancel-reported': 'ביטול דווח', 'not-required': '—' };
function npoTaxSchema(d) {
  const cancel = d.taxStatus === 'cancel-pending';
  return {
    title: cancel ? `אישור דיווח ביטול — קבלה ${d.receipt.number}` : `רישום דיווח ל"תרומות ישראל" — קבלה ${d.receipt.number}`,
    fields: cancel
      ? [{ name: 'confirm', label: 'הביטול דווח במערכת רשות המסים (הקלד "כן")', type: 'text', required: true }]
      : [{ name: 'registrationNumber', label: 'מספר הרישום שהתקבל מרשות המסים', type: 'text', required: true }],
    create: (v) => {
      if (cancel && String(v.confirm).trim() !== 'כן') throw new Error('יש להקליד "כן" לאישור');
      return window.systemAPI.recordNpoTaxReport(d.id, cancel ? {} : { registrationNumber: v.registrationNumber });
    }
  };
}

function renderNpo(o) {
  if (!o || typeof o !== 'object') return renderEmpty('אין נתונים להצגה');
  const s = o.settings || {};
  const r = o.report || {};
  const fs = o.fundSummary && Array.isArray(o.fundSummary.funds) ? o.fundSummary : { funds: [], restrictedTotal: 0, generalTotal: 0 };
  const year = o.year || npoYear();
  const donations = (Array.isArray(o.donations) ? o.donations : []).filter(d => String(d.date).startsWith(String(year)));
  const grants = (Array.isArray(o.grants) ? o.grants : []).filter(g => Number(g.year) === Number(year));
  const donors = Array.isArray(o.donors) ? o.donors : [];
  const funds = Object.fromEntries((Array.isArray(o.funds) ? o.funds : []).map(f => [f.id, f.name]));
  const alerts = Array.isArray(o.grantAlerts) ? o.grantAlerts : [];
  const tax = o.tax && typeof o.tax === 'object' ? o.tax : { counts: {}, toReport: 0 };
  const s46Expired = s.sec46Number && s.sec46ValidUntil && s.sec46ValidUntil < today();
  const s46 = !s.sec46Number ? '<span class="bad">אין אישור סעיף 46</span>'
    : s46Expired ? `<span class="bad">אישור סעיף 46 פג ב-${esc(s.sec46ValidUntil)}</span>`
    : `<span class="ok">סעיף 46 · ${esc(s.sec46Number)}${s.sec46ValidUntil ? ' · עד ' + esc(s.sec46ValidUntil) : ''}</span>`;
  return `
    <div class="npo">
      <div class="acct-header">
        <div>
          <h3>${esc(s.orgName || 'העמותה')}${s.regNumber ? ` <small class="muted">ע"ר ${esc(s.regNumber)}</small>` : ''}</h3>
          <small>${esc(NPO_VAT[s.vatStatus] || NPO_VAT.exempt)} · ${s46}</small>
        </div>
        <div class="acct-actions">
          <button class="secondary" id="npoPrevYear">‹ ${year - 1}</button>
          <strong>שנת ${year}</strong>
          <button class="secondary" id="npoNextYear">${year + 1} ›</button>
          <button class="secondary" id="npoSettingsBtn">הגדרות עמותה</button>
          <button class="secondary" id="npoGrantBtn">＋ תמיכה / מענק</button>
          <button class="secondary" id="npoImportBtn" title="ייבוא תרומות מקובץ של נדרים פלוס, קהילות, Charidy וכדומה">⬆ ייבוא תרומות</button>
          <button class="secondary" id="npoChequesBtn" title="המחאות דחויות — קבלה נפרדת לכל שנת מס לפי תאריך הפירעון">＋ המחאות דחויות</button>
        </div>
      </div>
      ${s.orgName ? '' : `<div class="card"><h4>כדי להפיק קבלות יש להגדיר תחילה את פרטי העמותה</h4><p class="muted">שם, מספר עמותה, אישור סעיף 46 ומעמד מע"מ — בכפתור "הגדרות עמותה".</p></div>`}
      <div class="kpis">
        <div class="kpi"><small>תרומות בשנה</small><strong>${money(r.donationsTotal)}</strong></div>
        <div class="kpi"><small>מתוכן עם קבלת סעיף 46</small><strong>${money(r.sec46Total)}</strong></div>
        <div class="kpi"><small>תמיכות שהתקבלו</small><strong>${money(r.grantsReceived)}</strong></div>
        <div class="kpi"><small>קרנות ייעודיות</small><strong>${money(fs.restrictedTotal)}</strong></div>
        <div class="kpi"><small>כללי</small><strong>${money(fs.generalTotal)}</strong></div>
        <div class="kpi"><small>תורמים בשנה</small><strong>${Number(r.donorsCount) || 0}</strong></div>
        <div class="kpi${tax.toReport ? ' neg' : ''}"><small>ממתינים לדיווח לרשות המסים</small><strong>${Number(tax.toReport) || 0}</strong></div>
      </div>
      ${alerts.length ? `<div class="card">
        <h3>תמיכות — מועדים ומסמכים</h3>
        ${alerts.map(a => `<div class="acct-row"><span>${esc(a.source)}${a.program ? ' · ' + esc(a.program) : ''}
          <small class="${a.overdue ? 'bad' : 'muted'}">${a.overdue ? 'מועד ההגשה עבר' : a.deadline ? 'הגשה עד ' + esc(a.deadline) : ''}${a.missingDocuments ? ' · ' + a.missingDocuments + ' מסמכים חסרים' : ''}</small></span>
          <span>${a.matchingRequired ? 'מימון תואם ' + money(a.matchingRequired) : ''}</span></div>`).join('')}
      </div>` : ''}
      ${tax.toReport || tax.counts && tax.counts.reported ? `<div class="card">
        <h3>דיווח ל"תרומות ישראל"</h3>
        <p class="muted">עמותה עם אישור סעיף 46 מדווחת לרשות המסים על כל תרומה, כולל ביטולים. כאן נשמר מעקב בלבד — הדיווח עצמו נעשה במערכת רשות המסים, ואת מספר הרישום שמתקבל רושמים בטבלת התרומות (כפתור 🏛).</p>
        <div class="acct-row"><span>ממתינות לדיווח</span><span>${Number(tax.counts && tax.counts.pending) || 0}</span></div>
        <div class="acct-row"><span>ביטולים שממתינים לדיווח</span><span>${Number(tax.counts && tax.counts['cancel-pending']) || 0}</span></div>
        ${tax.missingDonorId ? `<div class="acct-row"><span class="bad">תרומות ממתינות בלי ת.ז/ח.פ של התורם (נדרש לשיוך הזיכוי)</span><span>${Number(tax.missingDonorId)}</span></div>` : ''}
        ${tax.invalidDonorId ? `<div class="acct-row"><span class="bad">תרומות ממתינות עם ת.ז/ח.פ שגוי (ספרת ביקורת) — השיוך ייכשל</span><span>${Number(tax.invalidDonorId)}</span></div>` : ''}
        <div class="acct-actions"><button class="secondary" data-npo-export="tax">ייצוא רשימת עבודה לדיווח</button></div>
      </div>` : ''}
      <div class="acct-grid">
        ${renderNpoCampaigns(o.campaigns)}
        ${renderNpoStanding(o.standing)}
        ${renderMasavPanel('npo', o.standing && o.standing.masav)}
        ${renderNpoMemorials(o.memorials)}
        <div class="card">
          <h3>הכנסות לפי קרן</h3>
          ${fs.funds.map(f => `<div class="acct-row"><span>${esc(f.name)} <small class="muted">${f.restricted ? 'ייעודי' : 'כללי'}${f.archived ? ' · ארכיון' : ''}</small></span><span>${money(f.total)}</span></div>`).join('') || '<div class="acct-row muted">אין קרנות</div>'}
        </div>
        <div class="card">
          <h3>דוח שנתי לרשם העמותות — נתוני בסיס</h3>
          <p class="muted">ייצוא מסודר בלבד. ההגשה עצמה נעשית ידנית מול רשם העמותות.</p>
          <div class="acct-actions">
            <button class="secondary" data-npo-export="summary">ריכוז שנתי</button>
            <button class="secondary" data-npo-export="donations">רשימת תרומות</button>
            <button class="secondary" data-npo-export="grants">תמיכות</button>
            <button class="secondary" data-npo-export="funds">קרנות</button>
            <button class="secondary" data-npo-narrative id="npoNarrativeBtn" title="נרטיב מילולי לדוח מתוך נתוני השנה — טיוטה לעריכה">📝 נרטיב לדוח</button>
          </div>
          <h4>תורמים מעל ${money(r.largeDonorThreshold)}</h4>
          ${(Array.isArray(r.largeDonors) ? r.largeDonors : []).map(d => `<div class="acct-row"><span>${esc(d.name)}</span><span>${money(d.total)}</span></div>`).join('') || '<div class="acct-row muted">אין</div>'}
        </div>
        <div class="card acct-wide">
          <h3>תרומות וקבלות (${donations.length})</h3>
          ${donations.length === 0 ? renderEmpty('אין תרומות בשנה זו — לחץ "＋ הוספת רשומה" כדי לרשום תרומה ולהפיק קבלה') : `
          <div class="acct-scroll"><table class="acct-table">
            <thead><tr><th>קבלה</th><th>תאריך</th><th>תורם</th><th>סכום</th><th>אמצעי</th><th>קרן</th><th>סעיף 46</th><th>דיווח</th><th></th></tr></thead>
            <tbody>${donations.map(d => `
              <tr class="${d.status === 'cancelled' ? 'muted' : ''}">
                <td>${d.receipt && d.receipt.external ? `<small class="muted" title="הקבלה הופקה בערוץ התרומה">${esc(NPO_IMPORT_SOURCES[d.receipt.source] || 'חיצונית')}${d.receipt.externalNumber ? ' ' + esc(d.receipt.externalNumber) : ''}</small>` : esc(d.receipt && d.receipt.number)}</td><td>${esc(d.date)}</td>
                <td>${esc(d.donorName)}</td><td>${money(d.amount)}${currencyNote(d.foreign)}</td>
                <td>${esc(NPO_METHODS[d.method] || d.method)}${Array.isArray(d.cheques) && d.cheques.length ? ` <small class="muted" title="${esc(d.cheques.map(c => c.number + ' · ' + c.dueDate).join('\n'))}">${d.cheques.length} דחויות</small>` : ''}${d.bouncedCheque ? ' <small class="bad">חזרה</small>' : ''}</td><td>${esc(funds[d.fundId] || 'כללי')}</td>
                <td>${d.receipt && d.receipt.sec46 ? '✓' : '—'}</td>
                <td><small class="${d.taxStatus === 'pending' || d.taxStatus === 'cancel-pending' ? 'bad' : 'muted'}">${esc(NPO_TAX[d.taxStatus] || '')}${d.taxReport && d.taxReport.registrationNumber ? ' · ' + esc(d.taxReport.registrationNumber) : ''}</small>
                  ${d.taxStatus === 'pending' || d.taxStatus === 'cancel-pending' ? `<button class="icon-btn" data-npo-tax="${esc(d.id)}" title="רישום דיווח לרשות המסים">🏛</button>` : ''}</td>
                <td>${d.status === 'cancelled' ? 'מבוטלת' : ''}
                  ${d.receipt && d.receipt.external ? '' : `<button class="icon-btn" data-npo-pdf="${esc(d.id)}" title="קבלה ל-PDF">📄</button>`}
                  ${d.status !== 'cancelled' && Array.isArray(d.cheques) && d.cheques.length ? `<button class="icon-btn danger" data-npo-bounce="${esc(d.id)}" title="המחאה שחזרה">↩</button>` : ''}
                  ${d.status === 'cancelled' ? '' : `<button class="icon-btn danger" data-npo-cancel="${esc(d.id)}" title="ביטול קבלה">✖</button>`}
                </td>
              </tr>`).join('')}</tbody>
          </table></div>`}
        </div>
        <div class="card">
          <h3>תמיכות ומענקים (${grants.length})</h3>
          <div class="acct-actions"><button class="secondary" data-npo-grant-draft id="npoGrantDraftBtn" title="טיוטת מכתב בקשת מענק — לפי נתוני השנה; אין בה התחייבות או נתונים שאין בכוחינו להציג">📝 טיוטת בקשת מענק</button></div>
          ${grants.map(g => `
            <div class="acct-row">
              <span>${esc(g.source)}${g.program ? ' · ' + esc(g.program) : ''} <small class="muted">${esc(NPO_GRANT_STATUS[g.status] || '')}${g.deadline ? ' · הגשה עד ' + esc(g.deadline) : ''}${Number(g.matchingPercent) ? ' · מימון תואם ' + Number(g.matchingPercent) + '%' : ''}</small>
                ${(Array.isArray(g.documents) ? g.documents : []).map((doc, i) => `<button class="secondary small" data-npo-doc="${esc(g.id)}" data-doc-index="${i}" title="סימון הוגש / לא הוגש">${doc.done ? '✓' : '○'} ${esc(doc.name)}</button>`).join(' ')}</span>
              <span>${money(g.received)} / ${money(g.approved)}
                <button class="icon-btn" data-npo-grant-edit="${esc(g.id)}" title="עריכה">✎</button>
                <button class="icon-btn danger" data-npo-grant-del="${esc(g.id)}" title="מחיקה">🗑</button>
              </span>
            </div>`).join('') || '<div class="acct-row muted">אין תמיכות בשנה זו</div>'}
        </div>
        <div class="card">
          <h3>תורמים (${donors.length})</h3>
          <div class="acct-actions">
            <button type="button" class="secondary small" data-npo-yearend="pdf" title="סיכום שנתי לכל התורמים בקובץ PDF אחד — עמוד לכל תורם, לבקשת החזר מס">📦 חבילת סוף שנה (PDF)</button>
            <button type="button" class="secondary small" data-npo-yearend="csv" title="רשימת התורמים לשנה עם כתובת וסכומים — לדיוור ולמיזוג מכתבים">📋 רשימת דיוור (CSV)</button>
          </div>
          ${donors.slice(0, 15).map(d => `<div class="acct-row"><span>${esc(d.name)} <small class="muted">${d.count} תרומות · אחרונה ${esc(d.lastDate)}</small></span><span>${money(d.total)} <button class="icon-btn" data-npo-statement="${esc(d.key)}" title="סיכום שנתי לתורם (PDF) — לבקשת החזר מס" aria-label="סיכום שנתי לתורם">📄</button> <button class="icon-btn" data-npo-thankyou="${esc(d.key)}" title="מכתב תודה לתורם — טיוטה לפי תרומות השנה, ל-PDF" aria-label="מכתב תודה לתורם">💌</button> <button class="icon-btn" data-npo-donor-file="${esc(d.key)}" title="תיק תורם (PDF) — הסיכום השנתי וכל הקבלות בקובץ אחד" aria-label="תיק תורם">🗂️</button></span></div>`).join('') || '<div class="acct-row muted">אין תורמים עדיין</div>'}
        </div>
      </div>
    </div>`;
}

// ייבוא תרומות מקובץ של ערוץ חיצוני. קבצים מאקסל בעברית שמורים לעתים ב-windows-1255 — מזהים לפי תקינות UTF-8
const NPO_IMPORT_SOURCES = { nedarim: 'נדרים פלוס', kehilot: 'קהילות', charidy: 'Charidy', causematch: 'CauseMatch', bank: 'דף בנק', other: 'אחר' };
// שער לשורות במטבע זר בלי עמודת שער — ההמרה בשרת (core/donationImport.js)
const NPO_IMPORT_RATES = { USD: 'דולר', EUR: 'אירו', GBP: 'לירה שטרלינג' };

// הזיהוי (UTF-8 או windows-1255) — ב-pickFileText (ui/ports.js), משותף לכל ייבוא CSV
function pickCsvAnyEncoding() {
  return pickFileText('.csv,text/csv');
}

async function importNpoDonations() {
  const s = (state.data.npo && state.data.npo.settings) || {};
  if (!s.orgName) return showError('יש להגדיר תחילה את פרטי העמותה (כפתור "הגדרות עמותה")');
  const text = await pickCsvAnyEncoding();
  if (!text) return;
  let source = 'nedarim';
  let pv;
  try { pv = await window.systemAPI.previewNpoImport(text, source); }
  catch (error) { return showError('לא ניתן לקרוא את הקובץ: ' + errMsg(error)); }
  const funds = ((state.data.npo && state.data.npo.funds) || []).filter(fd => !fd.archived);
  const rates = {};

  const options = await openDialog((card, finish) => {
    card.style.maxWidth = '760px';
    const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
    const draw = () => {
      card.innerHTML = `
        <h2>ייבוא תרומות מקובץ</h2>
        <form class="modal-form" novalidate>
          <p class="muted">${Number(pv.total)} שורות בקובץ. בדוק שכל שדה מותאם לעמודה הנכונה — ההתאמה תישמר לפעם הבאה מאותו ערוץ. תרומה שכבר יובאה (אותו מספר עסקה) תדולג.</p>
          <label>ערוץ התרומה<select name="source">${Object.entries(NPO_IMPORT_SOURCES).map(([k, v]) => opt(k, v, k === source)).join('')}</select></label>
          <label>קבלות<select name="receipts">
            ${opt('external', 'הערוץ כבר הפיק קבלה לתורם — לא להפיק כאן', true)}
            ${opt('issue', 'להפיק כאן קבלה רגילה לכל תרומה (מספור רץ)', false)}
          </select></label>
          <label>קרן<select name="fundId">${funds.map(fd => opt(fd.id, fd.name, fd.id === 'general')).join('')}</select></label>
          <label>קמפיין (לכל השורות)<select name="campaignId">${openCampaignOptions(state.data.npo).map(x => opt(x.value, x.label, !x.value)).join('')}</select></label>
          <div class="acct-grid">${Object.entries(pv.fields).map(([k, fd]) => `
            <label>${esc(fd.label)}${fd.required ? ' *' : ''}<select name="map_${esc(k)}">
              ${opt('', '— ללא —', !pv.mapping[k])}${pv.headers.map(h => opt(h, h, pv.mapping[k] === h)).join('')}
            </select></label>`).join('')}</div>
          <p class="muted">תרומה במטבע זר (עמודת מטבע, או $ / € / £ בסכום) נרשמת בשקלים לפי השער. אם אין בקובץ עמודת שער — יש להזין כאן את השער מהבנק:</p>
          <div class="acct-grid">${Object.entries(NPO_IMPORT_RATES).map(([c, he]) => `
            <label>שער ${esc(he)} (₪ ל-1)<input name="rate_${c}" type="text" inputmode="decimal" value="${esc(rates[c] || '')}"></label>`).join('')}</div>
          <div class="acct-scroll"><table class="acct-table">
            <thead><tr>${pv.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
            <tbody>${pv.sample.map(r => `<tr>${pv.headers.map((h, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
          </table></div>
          <div class="npo-import-err" style="color:var(--ss-danger);font-size:.9rem"></div>
          <div class="modal-actions"><button type="button" class="secondary" data-act="cancel">ביטול</button><button type="submit" class="primary">ייבוא</button></div>
        </form>`;
      const form = card.querySelector('form');
      const err = card.querySelector('.npo-import-err');
      form.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(null));
      for (const c of Object.keys(NPO_IMPORT_RATES)) form.elements['rate_' + c].addEventListener('input', (e) => { rates[c] = e.target.value; });
      form.elements.source.addEventListener('change', async () => {
        source = form.elements.source.value;
        try { pv = await window.systemAPI.previewNpoImport(text, source); draw(); }
        catch (error) { err.textContent = errMsg(error); }
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const mapping = {};
        for (const k of Object.keys(pv.fields)) mapping[k] = form.elements['map_' + k].value;
        const missing = Object.entries(pv.fields).find(([k, fd]) => fd.required && !mapping[k]);
        if (missing) { err.textContent = 'יש לבחור עמודה עבור: ' + missing[1].label; return; }
        finish({ source, mapping, receipts: form.elements.receipts.value, fundId: form.elements.fundId.value, campaignId: form.elements.campaignId.value, rates: { ...rates } });
      });
    };
    draw();
  });
  if (!options) return;
  try {
    const r = await window.systemAPI.importNpoDonations(text, options);
    const failed = r.errors.filter(e => !e.warning);
    const warned = r.errors.filter(e => e.warning);
    const parts = [`יובאו ${r.imported} תרומות (${money(r.total)})`];
    if (r.skipped) parts.push(`${r.skipped} כבר קיימות ודולגו`);
    if (warned.length) parts.push(`${warned.length} נשמרו בלי ת.ז (מספר שגוי בקובץ)`);
    if (failed.length) parts.push(`${failed.length} שורות נדחו`);
    showToast(parts.join(' · '));
    if (r.errors.length) {
      await openDialog((card, finish) => {
        card.innerHTML = `<h2>שורות לבדיקה</h2>
          <div class="acct-scroll" style="max-height:50vh">${r.errors.map(e => `<div class="acct-row"><span>שורה ${Number(e.line)}</span><span class="${e.warning ? 'muted' : 'bad'}">${esc(e.message)}</span></div>`).join('')}</div>
          <div class="modal-actions"><button type="button" class="primary">סגירה</button></div>`;
        card.querySelector('button').addEventListener('click', () => finish(true));
      });
    }
    await switchView('npo');
  } catch (error) {
    showError('שגיאה בייבוא: ' + errMsg(error));
  }
}

function attachNpoHandlers() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  attachNpoStandingHandlers();
  attachNpoCampaignHandlers();
  attachNpoMemorialHandlers();
  attachNpoChequeHandlers();
  document.querySelectorAll('[data-npo-doc]').forEach(btn => btn.addEventListener('click', async () => {
    try { await window.systemAPI.toggleNpoGrantDocument(btn.dataset.npoDoc, Number(btn.dataset.docIndex)); await switchView('npo'); }
    catch (error) { showError('שגיאה בעדכון המסמך: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-npo-tax]').forEach(btn => btn.addEventListener('click', () => {
    const d = ((state.data.npo && state.data.npo.donations) || []).find(x => x.id === btn.dataset.npoTax);
    if (d) openSubForm(npoTaxSchema(d));
  }));
  on('npoPrevYear', () => { state.npoYear = npoYear() - 1; switchView('npo'); });
  on('npoNextYear', () => { state.npoYear = npoYear() + 1; switchView('npo'); });
  on('npoSettingsBtn', () => {
    const s = (state.data.npo && state.data.npo.settings) || {};
    const fundsText = (Array.isArray(s.funds) ? s.funds : []).filter(f => !f.archived).map(f => f.name).join('\n');
    openSubForm(npoSettingsSchema, { ...s, fundsText });
  });
  on('npoGrantBtn', () => openSubForm(npoGrantSchema));
  on('npoImportBtn', () => importNpoDonations());
  document.querySelectorAll('[data-npo-grant-edit]').forEach(btn => btn.addEventListener('click', () => {
    const g = ((state.data.npo && state.data.npo.grants) || []).find(x => x.id === btn.dataset.npoGrantEdit);
    if (g) openSubForm(npoGrantSchema, { ...g, documentsText: (Array.isArray(g.documents) ? g.documents : []).map(x => x.name).join('\n') }, g.id);
  }));
  document.querySelectorAll('[data-npo-grant-del]').forEach(btn => btn.addEventListener('click', async () => {
    if (!(await askConfirm('למחוק את רשומת התמיכה?'))) return;
    try { await window.systemAPI.deleteNpoGrant(btn.dataset.npoGrantDel); showToast('התמיכה נמחקה'); await switchView('npo'); }
    catch (error) { showError('שגיאה במחיקה: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-npo-cancel]').forEach(btn => btn.addEventListener('click', async () => {
    if (!(await askConfirm('לבטל את הקבלה? המספר לא ישומש שוב, והקבלה תישאר ברשימה כמבוטלת.'))) return;
    try { await window.systemAPI.cancelNpoDonation(btn.dataset.npoCancel); showToast('הקבלה בוטלה'); await switchView('npo'); }
    catch (error) { showError('שגיאה בביטול: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-npo-pdf]').forEach(btn => btn.addEventListener('click', async () => {
    try { const r = await window.systemAPI.exportNpoReceiptPdf(btn.dataset.npoPdf); if (r && r.ok) showToast('הקבלה נשמרה כ-PDF'); }
    catch (error) { showError('שגיאה בהפקת הקבלה: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-npo-statement]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      const r = await window.systemAPI.exportNpoDonorStatementPdf(btn.dataset.npoStatement, npoYear());
      if (r && r.ok) showToast('הסיכום השנתי נשמר כ-PDF');
    } catch (error) { showError('שגיאה בהפקת הסיכום: ' + errMsg(error)); }
  }));
  // חבילת סוף שנה: סינון (סכום מינימלי, רק סעיף 46) ואז קובץ אחד לכל התורמים של השנה המוצגת
  document.querySelectorAll('[data-npo-yearend]').forEach(btn => btn.addEventListener('click', async () => {
    const year = npoYear();
    const v = await askFields(`חבילת סוף שנה לתורמים — ${year}`, [
      { name: 'minTotal', label: 'סכום מינימלי לשנה (₪)', type: 'number', hint: '0 = כל התורמים. תורמים בעילום שם אינם נכללים' }
    ], btn.dataset.npoYearend === 'pdf' ? 'המשך להפקת PDF' : 'המשך להפקת הרשימה', { minTotal: '0' });
    if (!v) return;
    const onlySec46 = await askConfirm('לכלול רק תורמים שיש להם תרומות המוכרות לסעיף 46? (ביטול = כל התורמים)');
    const opts = { minTotal: v.minTotal, onlySec46 };
    btn.disabled = true;
    try {
      const r = btn.dataset.npoYearend === 'pdf'
        ? await window.systemAPI.exportNpoYearEndPackPdf(year, opts)
        : await window.systemAPI.exportNpoYearEndListCsv(year, opts);
      if (r && r.ok) showToast(btn.dataset.npoYearend === 'pdf' ? `החבילה נשמרה — ${r.donors} תורמים` : 'רשימת הדיוור נשמרה');
    } catch (error) { showError('שגיאה בהפקת החבילה: ' + errMsg(error)); }
    finally { btn.disabled = false; }
  }));
  document.querySelectorAll('[data-npo-donor-file]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      const r = await window.systemAPI.exportNpoDonorFilePdf(btn.dataset.npoDonorFile, npoYear());
      if (r && r.ok) showToast('תיק התורם נשמר כ-PDF');
    } catch (error) { showError('שגיאה בהפקת תיק התורם: ' + errMsg(error)); }
  }));
  document.querySelectorAll('[data-npo-export]').forEach(btn => btn.addEventListener('click', async () => {
    try { const r = await window.systemAPI.exportNpoCsv(btn.dataset.npoExport, npoYear()); if (r && r.ok) showToast('הקובץ נשמר'); }
    catch (error) { showError('שגיאה בייצוא: ' + errMsg(error)); }
  }));
  // מכתבים ותבניות (שלב 3) — טיוטה לתצוגה; ה-PDF נשמר לקובץ שהמשתמש בוחר
  document.querySelectorAll('[data-npo-thankyou]').forEach(btn => btn.addEventListener('click', () => openThankYouLetter(btn.dataset.npoThankyou)));
  on('npoNarrativeBtn', () => openAnnualNarrative());
  on('npoGrantDraftBtn', () => openGrantDraft());
}

// ---------- מכתבים ותבניות (שלב 3): מכתב תודה, נרטיב לדוח, בקשת מענק ----------
// הטיוטה נוצרת בשרת מנתוני השנה (core/npoLetters.js), מוצגת כאן בלבד, ולא נשמרת לשום מקום.
// "שמירה" = קובץ PDF שהמשתמש בוחר היכן לשמור — אין כתיבה אוטומטית לנתוני העמותה.
// חלון "ביטול"/"סגירה" — הטופס המשני חייב להיות null, אחרת handleSubmit יחשוב שמדובר בטופס רשומה
function openLettersDialog(title, html) {
  state.subForm = null;
  showModal(title, html);
}

// שדות "תוספת אישית" — הטקסט נשלח לשרת רק כשמפיקים את המכתב; אינו נשמר בשום מקום
function letterMessageValue() {
  const el = document.getElementById('letterMessage');
  return el ? el.value : '';
}
// בוחר חלון "הפקה" לפני שהתצוגה מוחלפת — מחזיר { btn, close }
// החלון משתמש ב"ביטול" הקבוע (core.js → closeModal); אין לקשור כאן מאזין נוסף — הקישור עם { once } היה נשאר תלוי
// ב-DOM ונשאר פתוח אחרי החלפת התצוגה. מחזיר רק את כפתור "הצגת הטיוטה", אם קיים
function letterDialogRefs() {
  const btn = document.getElementById('letterDraftBtn');
  return { btn, close: null };
}

// תצוגת טיוטה לקריאה בלבד; onPdf(message) מפיק את הקובץ (התוספת עוברת לשרת רק בהפקה)
function showLetterPreview(title, text, onPdf) {
  openLettersDialog(title, `<label class="field">
      <span>טיוטה — לעיון לפני המסירה (לא ניתנת לעריכה כאן; העריכה אחרי ההפקה)</span>
      <textarea id="letterText" rows="14" readonly>${esc(text)}</textarea>
    </label>
    <label class="field">
      <span>תוספת אישית לברכה (אופציונלי)</span>
      <input id="letterMessage" type="text" maxlength="1200">
    </label>
    <div class="acct-actions">
      <button type="button" class="primary" id="letterPdf">שמירה כ-PDF</button>
    </div>
    <p class="muted">הטיוטה אינה נשמרת בתוכנה ואינה מוזנת לנתוני העמותה. יש לעבור על הנוסח לפני המסירה — הוא אינו מחליף מסמך חתום.</p>`);
  const btn = document.getElementById('letterPdf');
  if (btn) btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const r = await onPdf();
      if (r && r.ok) showToast('הטיוטה נשמרה כ-PDF');
    } catch (error) { showError('שגיאה בהפקת ה-PDF: ' + errMsg(error)); }
    finally { btn.disabled = false; }
  });
}

// טופס פרטי המכתב: השדות בשרת, והתוצאה מוצגת בתצוגת טיוטה עם "שמירה כ-PDF"
// הטופס הוא #modalForm עצמו — לכן אין להשתמש ב-openSubForm (schemas[view] של npo מכיל את שדות התרומה)
function showLetterForm(title, fields, blank, build, exportFn) {
  openLettersDialog(title, buildFormHtml(fields) + `<div class="acct-actions">
      <button type="button" class="primary" id="letterDraftBtn">הצגת הטיוטה</button>
    </div>
    <p class="muted">הטיוטה מחושבת מנתוני העמותה של השנה, להצגה בלבד. לא נשמר בשרת דבר מתוך הטופס.</p>`);
  fields.forEach(f => { const el = document.getElementById('f_' + f.name); if (el) el.value = blank[f.name] == null ? '' : blank[f.name]; });
  const { btn } = letterDialogRefs();
  if (btn) btn.addEventListener('click', async () => {
    // השדות בשרת: collectFormData של הטופס הראשי עובר על formSchemas['npo'] — כאן קוראים רק את שדות המכתב
    const input = {};
    for (const f of fields) {
      const el = document.getElementById('f_' + f.name);
      if (!el) continue;
      const value = el.value.trim();
      if (value !== '') input[f.name] = f.type === 'number' ? Number(value) : value;
    }
    btn.disabled = true;
    try {
      if (!input.fundName) throw new Error('יש להזין את שם הקרן או הגוף שמבקשים ממנו את המענק');
      const { letter } = await build(input);
      showLetterPreview(letter.title, letter.text, () => exportFn(input));
    } catch (error) { showError('שגיאה בהכנת הטיוטה: ' + errMsg(error)); }
    finally { btn.disabled = false; }
  });
}

async function openThankYouLetter(donorKey) {
  try {
    const year = npoYear();
    const { letter } = await window.systemAPI.getNpoThankYouLetter(donorKey, year);
    showLetterPreview(letter.title, letter.text,
      async () => window.systemAPI.exportNpoThankYouPdf(donorKey, year, { message: letterMessageValue() }));
  } catch (error) { showError('שגיאה בהכנת מכתב התודה: ' + errMsg(error)); }
}

async function openAnnualNarrative() {
  try {
    const year = npoYear();
    const { letter } = await window.systemAPI.getNpoAnnualNarrative(year);
    showLetterPreview(letter.title, letter.text,
      async () => window.systemAPI.exportNpoAnnualNarrativePdf(year, { message: letterMessageValue() }));
  } catch (error) { showError('שגיאה בהכנת הנרטיב: ' + errMsg(error)); }
}

// טיוטת בקשת מענק — השדות מפורטים לגמרי, והתוצאה היא הצעה בלבד; אינה נשמרת ברשימת התמיכות
function openGrantDraft() {
  const fields = [
    { name: 'fundName', label: 'שם הקרן או הגוף שמבקשים ממנו', type: 'text', required: true },
    { name: 'amount', label: 'הסכום המבוקש (₪)', type: 'number' },
    { name: 'program', label: 'תכנית או מטרה', type: 'text' },
    { name: 'purpose', label: 'ייעודי התמיכה — שורה לכל ייעוד (עד 10)', type: 'textarea' },
    { name: 'period', label: 'תקופה (למשל: שנת תשפ״ז)', type: 'text' },
    { name: 'contactName', label: 'שם איש הקשר', type: 'text' },
    { name: 'contactPhone', label: 'טלפון איש הקשר', type: 'text' }
  ];
  const year = npoYear();
  showLetterForm('טיוטת בקשת מענק', fields, {},
    input => window.systemAPI.getNpoGrantDraft(year, input),
    input => window.systemAPI.exportNpoGrantDraftPdf(year, input));
}

// ---------- מס"ב (PLAN.md 9.17): קובץ חיובים וקליטת החזרות — משותף לעמותה ולגמ"ח ----------
const MASAV_BATCH_STATUS = { open: 'נשלחה — ממתינה להחזרות', closed: 'נסגרה', cancelled: 'בוטלה' };
const MASAV_VIEW = { npo: 'npo', gemach: 'gemach' };

function renderMasavPanel(domain, m) {
  if (!m) return '';
  const batches = Array.isArray(m.batches) ? m.batches : [];
  const ag = (n) => money((Number(n) || 0) / 100);
  return `<div class="card acct-wide masav-panel">
    <div class="hub-head"><h3>מס"ב — חיוב בהרשאה</h3>
      <div class="acct-actions">
        <button class="secondary" data-masav-settings="${domain}">הגדרות מוסד</button>
        ${m.configured ? `<button class="secondary" data-masav-file="${domain}">📤 קובץ חיובים</button>
        <button class="secondary" data-masav-returns="${domain}">📥 קליטת החזרות</button>` : ''}
      </div></div>
    <p class="muted">קובץ בלבד, בלי חיבור לבנק: מעלים את הקובץ לבנק או לחברת הגבייה, ואחרי מועד החיוב קולטים את קובץ ההחזרות.
      מה שלא הוחזר מאשרים ב"סגירת אצווה". ${m.configured ? `מוסד ${esc(m.settings.institution)} · ${esc(m.settings.name)}` : '<b>יש להגדיר תחילה את קוד המוסד שקיבלתם ממס"ב.</b>'}</p>
    ${batches.length ? `<div class="acct-scroll"><table class="acct-table">
      <thead><tr><th>תאריך חיוב</th><th>חודש</th><th>חיובים</th><th>סכום</th><th>הוחזרו</th><th>מצב</th><th></th></tr></thead>
      <tbody>${batches.map(b => `<tr class="${b.status === 'cancelled' ? 'muted' : ''}">
        <td>${esc(b.chargeDate)}</td><td>${esc(b.month)}</td><td>${Number(b.count) || 0}</td><td>${ag(b.totalAg)}</td>
        <td>${(b.returned || []).length ? `<small class="bad" title="${esc(b.returned.map(r => `${r.label}: ${r.reason}`).join('\n'))}">${b.returned.length}</small>` : '—'}
          ${(b.manual || []).length ? `<small class="bad" title="${esc(b.manual.map(r => `${r.label}: ${r.why}`).join('\n'))}">⚠ ${b.manual.length} לטיפול ידני</small>` : ''}</td>
        <td><small>${esc(MASAV_BATCH_STATUS[b.status] || b.status)}</small></td>
        <td>${b.status === 'open' ? `<button class="secondary small" data-masav-close="${esc(b.id)}" data-domain="${domain}" title="כל מה שלא הוחזר נרשם כהתקבל">✓ סגירת אצווה (${Number(b.pending) || 0})</button>
          ${b.paid || (b.returned || []).length ? '' : `<button class="icon-btn danger" data-masav-cancel="${esc(b.id)}" data-domain="${domain}" title="ביטול אצווה שלא נשלחה">✖</button>`}` : ''}</td>
      </tr>`).join('')}</tbody></table></div>` : ''}
  </div>`;
}

// קובץ החזרות: נקרא כבתים (תו לכל בית), כי השדות במיקום קבוע והעברית בקובץ אינה UTF-8
function pickMasavFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.msv,.dat,text/plain';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      if (file.size > 20 * 1024 * 1024) { showError('הקובץ גדול מדי (עד 20MB)'); return resolve(null); }
      const bytes = new Uint8Array(await file.arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      resolve(s);
    });
    input.click();
  });
}

async function masavSettingsForm(domain, cur) {
  const s = cur || {};
  const v = await licForm('הגדרות מס"ב', [
    { name: 'institution', label: 'קוד מוסד / נושא (8 ספרות, ניתן על ידי מס"ב) *', value: s.institution || '' },
    { name: 'sender', label: 'קוד מוסד שולח (5 ספרות) *', value: s.sender || '' },
    { name: 'name', label: 'שם המוסד בקובץ (עד 30 תווים) *', value: s.name || '' },
    { name: 'hebrew', label: 'קידוד העברית בקובץ', type: 'select', value: s.hebrew || 'oldcode',
      options: [['oldcode', 'קוד ישן — 7 ביט (ברירת מחדל)'], ['cp862', 'DOS — CP862']] }
  ], 'שמירה', 'הפרטים מופיעים במכתב ההצטרפות של מס"ב או אצל הבנק. את קידוד העברית יש לברר מול הבנק או חברת הגבייה.');
  if (!v) return false;
  await window.systemAPI.saveMasavSettings(domain, v);
  showToast('הגדרות מס"ב נשמרו');
  return true;
}

async function masavCreateFile(domain) {
  const d = new Date();
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const month = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  const v = await licForm('קובץ חיובים למס"ב', [
    { name: 'month', label: 'חודש החיוב (YYYY-MM) *', value: month },
    { name: 'chargeDate', label: 'תאריך החיוב בבנק *', type: 'date', value: `${month}-10` }
  ], '📤 הפקת הקובץ', 'ייכללו רק חיובים עם פרטי חשבון שעוד לא נכללו בקובץ קודם לאותו חודש. בודקים את הקובץ בסימולטור של הבנק לפני השליחה הראשונה.');
  if (!v) return false;
  const r = await window.systemAPI.createMasavFile(domain, v);
  if (!r || !r.ok) return false;
  showToast(`נשמר קובץ עם ${r.count} חיובים, ${money(r.totalAg / 100)}`);
  return true;
}

async function masavImportReturns(domain) {
  const text = await pickMasavFile();
  if (!text) return false;
  const r = await window.systemAPI.importMasavReturns(domain, text);
  showToast(`נקלטו ${r.returned} החזרות${r.skipped ? `, ${r.skipped} כבר נקלטו קודם` : ''}`);
  const problems = [...(r.manual || []).map(u => `${u.label}: ${u.why}`), ...(r.errors || []).map(e => `שורה ${e.line}: ${e.message}`),
    ...(r.unmatched || []).map(u => `אסמכתה ${u.reference}, ${money(u.amountAg / 100)}: ${u.why}`)];
  if (problems.length) showError(problems.slice(0, 5).join(' · '));
  return true;
}

// פרטי חשבון לחיוב: בנק, סניף וחשבון. ריק בכל השדות — הסרה
async function masavBankForm(title, current, save) {
  const v = await licForm(title, [
    { name: 'bank', label: 'קוד בנק (2 ספרות)', value: '' },
    { name: 'branch', label: 'מספר סניף (3 ספרות)', value: '' },
    { name: 'account', label: 'מספר חשבון (עד 9 ספרות)', value: '' }
  ], 'שמירה', (current ? `החשבון השמור: ${current}. ` : '') + 'הפרטים לפי טופס ההרשאה לחיוב שהלקוח חתם עליו בבנק. כל השדות ריקים — הסרת החשבון.');
  if (!v) return false;
  const empty = !v.bank && !v.branch && !v.account;
  if (empty && !current) return false;
  await save(empty ? null : v);
  showToast(empty ? 'פרטי החשבון הוסרו' : 'פרטי החשבון נשמרו');
  return true;
}

function attachMasavHandlers(cur) {
  const act = (domain, fn) => async () => {
    let changed = false;
    try { changed = await fn(); } catch (error) { showError(errMsg(error)); return; }
    if (changed !== false) await switchView(MASAV_VIEW[domain]);
  };
  document.querySelectorAll('[data-masav-settings]').forEach(b => b.addEventListener('click', act(b.dataset.masavSettings, () => masavSettingsForm(b.dataset.masavSettings, cur && cur.settings))));
  document.querySelectorAll('[data-masav-file]').forEach(b => b.addEventListener('click', act(b.dataset.masavFile, () => masavCreateFile(b.dataset.masavFile))));
  document.querySelectorAll('[data-masav-returns]').forEach(b => b.addEventListener('click', act(b.dataset.masavReturns, () => masavImportReturns(b.dataset.masavReturns))));
  document.querySelectorAll('[data-masav-close]').forEach(b => b.addEventListener('click', act(b.dataset.domain, async () => {
    if (!(await askConfirm('לסגור את האצווה? כל חיוב שלא הוחזר יירשם כהתקבל בתאריך החיוב (בעמותה — עם קבלה). כדאי לקלוט קודם את קובץ ההחזרות.'))) return false;
    const r = await window.systemAPI.closeMasavBatch(b.dataset.domain, b.dataset.masavClose);
    showToast(`האצווה נסגרה — ${r.paid} תשלומים נרשמו`);
    if ((r.manual || []).length) showError(r.manual.slice(0, 5).map(u => `${u.label}: ${u.why}`).join(' · '));
  })));
  document.querySelectorAll('[data-masav-cancel]').forEach(b => b.addEventListener('click', act(b.dataset.domain, async () => {
    if (!(await askConfirm('לבטל את האצווה? יש לבטל רק אצווה שלא נשלחה לבנק. החיובים יחזרו לקובץ הבא.'))) return false;
    await window.systemAPI.cancelMasavBatch(b.dataset.domain, b.dataset.masavCancel);
    showToast('האצווה בוטלה');
  })));
}
