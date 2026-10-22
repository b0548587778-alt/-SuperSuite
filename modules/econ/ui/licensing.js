// ממשק המודול הכלכלי — רישוי ומערכות.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

// ============================================================
// רישוי ומערכות (docs/LICENSING-DESIGN.md): הרישיון של המערכת, מערכות בת, ומצב מנהל-העל.
// כל פעולה בכפתור; הקבצים (בקשה / רישיון / אישור / הודעות) נשמרים ונפתחים בבוחר קבצים.
// ============================================================
const LIC_STATUS = { active: 'פעילה', pending_payment: 'ממתינה לתשלום', suspended: 'מושבתת זמנית', locked: 'נעולה', terminated: 'הסתיימה', trial_ended: 'תקופת הניסיון הסתיימה' };
// תקופת ניסיון (PLAN.md 4.2): כל התחומים פתוחים עד הסוף, ואחר כך קריאה, ייצוא וגיבוי בלבד
function licTrialRows(t) {
  if (!t) return '';
  const left = Number(t.daysLeft) || 0;
  const text = left > 0 ? `נותרו ${left === 1 ? 'יום אחד' : left + ' ימים'} (עד ${esc(licDate(t.endsAt))})` : `הסתיימה ב-${esc(licDate(t.endsAt))} — אפשר לצפות, לייצא ולגבות`;
  return `<div class="acct-row"><span>תקופת ניסיון</span><span class="${left > 0 && !t.warn ? 'good' : 'bad'}">${text}</span></div>
    <p class="muted">להמשך עבודה אחרי תקופת הניסיון: "הפקת בקשת רישיון", שליחה לספק, והתקנת קובץ הרישיון שיחזור. הנתונים נשמרים.</p>`;
}
const LIC_HOLD_KINDS = { suspended: 'השבתה זמנית', locked: 'נעילה', pending_payment: 'ממתין לתשלום' };
const LIC_FEATURES = [
  ['econ', 'מערכת כלכלית (בסיס)'], ['econ.accounting', 'הנהלת חשבונות'], ['econ.npo', 'עמותה ותרומות'], ['econ.gemach', 'גמ"ח'],
  ['econ.chesed', 'חסד וחלוקות'], ['econ.mortgage', 'משכנתאות'], ['econ.mortgage-advisor', 'ייעוץ משכנתאות'], ['econ.mortgage-lab', 'מעבדת תמהיל'], ['econ.realestate', 'נדל"ן (שמאות מקרקעין, תיווך ויזמים)'],
  ['shamai', 'שמאות'], ['trainer', 'ניהול אימונים'], ['tools', 'ארגז כלים'],
  ['ai', 'עוזר חכם — מקומי'], ['ai.cloud', 'עוזר חכם — שדרוג ענן']
];
const licFeatureLabel = (f) => (LIC_FEATURES.find(x => x[0] === f) || [f, f])[1];
const licDate = (ms) => (ms ? new Date(ms).toLocaleDateString('he-IL') : '');
const licBadge = (st) => `<span class="${st === 'active' ? 'good' : 'bad'}">${esc(LIC_STATUS[st] || st)}</span>`;
const licLimits = (l) => l ? `עד ${Number(l.maxUsers)} משתמשים · ${Number(l.maxChildren)} מערכות בת · ${Number(l.maxStorageMb)}MB` : '';

// תנאי ההפעלה (shell/licensing/activation.js): רישיון שנתי וחיבור לשרת — מה חסר ומה עושים
function renderActivationCard(act, d) {
  if (!act || !act.required) return '';
  const isAdmin = !!d.isAdmin;
  const remoteOn = !!(d.remote && d.remote.url);
  const syncBtn = '<button class="primary small" id="licActSyncBtn">🔄 התחברות לשרת עכשיו</button>';
  const fix = {
    license: isAdmin ? '<button class="primary small" id="licActInstallBtn">📥 התקנת קובץ רישיון</button>' : '<small class="muted">פנו למנהל המערכת</small>',
    server: !isAdmin ? '<small class="muted">פנו למנהל המערכת</small>'
      : remoteOn ? syncBtn
        : '<small class="muted">יש להגדיר שרת רישוי ("עבודה מרחוק" למטה)</small>',
  };
  const rows = (act.steps || []).map(s => `<tr>
    <td>${s.ok ? '<span class="ok">✔</span>' : '<span class="bad">✖</span>'} ${esc(s.label)}</td>
    <td>${s.ok ? (s.until ? `<small class="muted">${s.id === 'license' ? 'בתוקף עד' : 'נדרש שוב עד'} ${esc(licDate(s.until))}</small>` : '') : `<small class="bad">${esc(s.reason)}</small>`}</td>
    <td>${s.ok ? '' : fix[s.id] || ''}</td></tr>`).join('');
  return `<div class="card">
    <div class="acct-header"><h3>הפעלת המערכת</h3><span>${act.ok ? '<span class="ok">✔ המערכת פעילה</span>' : '<span class="bad">נדרשת השלמה — עד אז המערכת נעולה</span>'}</span></div>
    <table class="acct-table"><tbody>${rows}</tbody></table>
    ${act.ok && act.dueSoon ? `<p class="bad">⏰ יש להתחבר לשרת הרישוי עד ${esc(licDate(act.nextDue))} — אחרת המערכת תינעל. הנתונים לא נמחקים.</p>${isAdmin && remoteOn ? syncBtn : ''}`
      : act.ok && act.nextDue ? `<p class="muted">כדי שהמערכת תישאר פתוחה: חיבור לשרת הרישוי לפחות פעם בחודש (אוטומטי כשיש אינטרנט). המועד הקרוב: ${esc(licDate(act.nextDue))}.</p>`
      : '<p class="muted">מערכת ברישיון נפתחת עם רישיון שנתי בתוקף וחיבור לשרת הרישוי, שחוזר לפחות פעם בחודש. כניסה עם Google אינה חובה.</p>'}
  </div>`;
}

// ---------- כרטיס המצב (PLAN.md 4.3): מצב אחד ברור, עד מתי, מה עושים ----------
const LIC_EXPIRING_DAYS = 30;
const LIC_DAY_MS = 24 * 60 * 60 * 1000;
const licDaysText = (n) => (n === 1 ? 'יום אחד' : n + ' ימים');

// ארבעה מצבים למשתמש: ניסיון / פעיל / עומד לפוג / נעול (או צפייה בלבד). now מוזרק לבדיקות
function licSummary(st, now = Date.now()) {
  if (!st || st.mode === 'unlicensed') return { kind: 'unlicensed', icon: '✔', title: 'פועלת ללא רישוי', detail: 'ההתקנה הזו פועלת ללא רישוי — כל התחומים פתוחים.' };
  const t = st.trial;
  if (t && st.status === 'active') {
    const left = Number(t.daysLeft) || 0;
    return { kind: t.warn ? 'expiring' : 'trial', icon: '⏳', title: 'תקופת ניסיון', detail: `נותרו ${licDaysText(left)} — עד ${licDate(t.endsAt)}. כל התחומים פתוחים.` };
  }
  if (st.status === 'active') {
    const act = st.activation || {};
    if (st.graceUntil) return { kind: 'expiring', icon: '⏰', title: 'הרישיון עומד לפוג', detail: `תוקף הרישיון הסתיים. תקופת חסד עד ${licDate(st.graceUntil)} — יש לחדש.` };
    if (st.expiresAt && st.expiresAt - now <= LIC_EXPIRING_DAYS * LIC_DAY_MS) {
      return { kind: 'expiring', icon: '⏰', title: 'הרישיון עומד לפוג',
        detail: `בתוקף עד ${licDate(st.expiresAt)} (עוד ${licDaysText(Math.max(0, Math.ceil((st.expiresAt - now) / LIC_DAY_MS)))}) — יש לחדש.` };
    }
    if (act.dueSoon) return { kind: 'expiring', icon: '⏰', title: 'נדרש חיבור לשרת', detail: `יש להתחבר לשרת הרישוי עד ${licDate(act.nextDue)} — אחרת המערכת תינעל.` };
    return { kind: 'active', icon: '✔', title: 'הרישיון פעיל', detail: st.expiresAt ? `בתוקף עד ${licDate(st.expiresAt)}.` : 'המערכת פעילה.' };
  }
  const readOnly = ['pending_payment', 'suspended', 'trial_ended'].includes(st.status);
  const r = (st.reasons || [])[0];
  const title = st.status === 'trial_ended' ? 'תקופת הניסיון הסתיימה'
    : readOnly ? 'צפייה בלבד — ' + (LIC_STATUS[st.status] || st.status)
      : st.status === 'terminated' ? 'השימוש במערכת הסתיים' : 'המערכת נעולה';
  return { kind: readOnly ? 'limited' : 'locked', icon: readOnly ? '⏸' : '🔒', title,
    detail: (readOnly ? 'אפשר לצפות בנתונים, לייצא ולגבות. יצירה ועריכה חסומות. ' : '') + (r && r.reason ? r.reason : '') };
}

// מה עושים — לפי הסיבה. מחזיר רשימת צעדים (טקסט); הכפתורים בכרטיס
function licFixSteps(st, d) {
  if (!st || st.mode === 'unlicensed' || st.status === 'active') return [];
  const remoteOn = !!(d.remote && d.remote.url);
  const r = (st.reasons || [])[0] || {};
  const install = 'כשהרישיון מגיע מהספק — "טעינת קובץ רישיון" או "הדבקת קוד רישיון".';
  const sync = remoteOn ? 'כשיש אינטרנט, העדכון מהספק מגיע לבד.' : 'הספק ישלח קובץ עדכון — "קבלת עדכון סטטוס" בהגדרות המתקדמות.';
  if (st.status === 'trial_ended') {
    return [remoteOn ? 'לחצו "קניית רישיון", בחרו תכנית ושלמו בדף המאובטח — הרישיון יגיע לבד.' : 'בהגדרות המתקדמות: "הפקת בקשת רישיון", ושלחו את הקובץ לספק.', install];
  }
  if (r.source === 'activation') {
    return r.step === 'server'
      ? [remoteOn ? 'התחברו לאינטרנט ולחצו "התחברות לשרת עכשיו" בכרטיס "הפעלת המערכת".' : 'יש להגדיר שרת רישוי בהגדרות המתקדמות ("עבודה מרחוק").']
      : ['הרישיון השנתי חסר או שפג. פנו לספק לחידוש.', install];
  }
  if (st.status === 'pending_payment') return r.source === 'billing' ? ['תוקף הרישיון הסתיים. פנו לספק לחידוש.', install] : ['יש להסדיר את התשלום מול הספק.', sync];
  if (st.status === 'suspended') return ['המערכת הושבתה זמנית על ידי הספק או המערכת שמעליה. פנו אליהם לבירור.', sync];
  if (st.status === 'terminated') return ['לפרטים — פנו לספק.'];
  if (/הודעות סטטוס/.test(r.reason || '')) return ['קובץ הרישוי שונה מחוץ לתוכנה.', sync];
  if (/קובץ הרישוי|מפתח המערכת/.test(r.reason || '')) return ['יש להתקין שוב את קובץ הרישיון מהספק. אם הבעיה חוזרת — פנו לספק.', install];
  return ['פנו לספק לבירור.', install];
}

function renderStatusCard(st, d) {
  const isAdmin = !!d.isAdmin;
  const s = licSummary(st);
  // קנייה: רק כשאין רישיון אמיתי (ניסיון), יש שרת, ולא התחילה הרשמה (אז מוצג כרטיס ההרשמה)
  const canBuy = isAdmin && st.mode === 'licensed' && !!st.trial && !!(d.remote && d.remote.url) && !d.signup;
  const steps = licFixSteps(st, d);
  const buttons = !isAdmin ? '<p class="muted">ניהול הרישיון — למנהל בלבד.</p>'
    : st.mode !== 'licensed' ? ''
      : `<div class="acct-actions">
      ${canBuy ? '<button class="primary" id="licBuyBtn">🛒 קניית רישיון</button>' : ''}
      <button class="${canBuy ? 'secondary' : 'primary'}" id="licInstallBtn">📥 טעינת קובץ רישיון</button>
      <button class="secondary" id="licPasteBtn">📋 הדבקת קוד רישיון</button>
    </div>`;
  return `<div class="card lic-status lic-${s.kind}">
    <div class="lic-status-head"><span class="lic-status-icon">${s.icon}</span><div><h3>${esc(s.title)}</h3><p>${esc(s.detail)}</p></div></div>
    ${steps.length ? `<div class="lic-fix"><strong>מה לעשות:</strong><ol>${steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
      <p>הנתונים שלכם שמורים במחשב ולא נמחקו.</p>
      <button class="secondary small" id="licGoMessagesBtn">💬 הודעה לספק</button></div>` : ''}
    ${buttons}
  </div>`;
}

function renderLicensing(d) {
  const st = (d && d.status) || { mode: 'unlicensed', status: 'active' };
  const isAdmin = !!(d && d.isAdmin);
  const children = Array.isArray(d && d.children) ? d.children : [];
  const reasons = Array.isArray(st.reasons) ? st.reasons : [];
  const mine = st.mode === 'unlicensed'
    ? `<p class="muted">ההתקנה הזו פועלת ללא רישוי — כל התחומים פתוחים.</p>`
    : st.trial ? `<div class="acct-row"><span>מצב</span><span>${st.status === 'active' ? '<span class="good">תקופת ניסיון — כל התחומים פתוחים</span>' : licBadge(st.status)}</span></div>${licTrialRows(st.trial)}`
    : `<div class="acct-row"><span>מצב</span><span>${licBadge(st.status)}</span></div>
       ${reasons.map(r => `<div class="acct-row"><span>${esc(LIC_STATUS[r.kind] || r.kind)}</span><span>${esc(r.reason)}</span></div>`).join('')}
       ${st.graceUntil ? `<div class="acct-row"><span>תקופת חסד</span><span class="bad">עד ${esc(licDate(st.graceUntil))} — יש לחדש</span></div>` : ''}
       ${(st.features || []).length ? `<div class="acct-row"><span>תחומים פתוחים</span><span>${(st.features || []).map(f => esc(licFeatureLabel(f))).join(' · ')}</span></div>` : ''}
       ${st.limits && st.limits.maxUsers != null ? `<div class="acct-row"><span>מכסות</span><span>${esc(licLimits(st.limits))}</span></div>` : ''}`;

  // במערכת שמוגדרת לרישוי — כפתורי ההתקנה בכרטיס המצב; כאן הבקשה הידנית ועדכון הסטטוס
  const myCard = `<div class="card">
    <h3>פרטי הרישיון</h3>
    ${mine}
    ${isAdmin ? `<div class="acct-actions">
      <button class="secondary" id="licRequestBtn">📤 הפקת בקשת רישיון</button>
      ${st.mode === 'licensed' ? '' : '<button class="primary" id="licInstallBtn">📥 טעינת קובץ רישיון</button>'}
      <button class="secondary" id="licNoticesBtn">📥 קבלת עדכון סטטוס</button>
    </div>
    <p class="muted">בלי חיבור לשרת: "הפקת בקשת רישיון" יוצרת מפתח שנשמר במכשיר הזה בלבד. שלחו את הקובץ לספק, וטענו את קובץ הרישיון שיחזור.</p>` : ''}
  </div>`;

  const canIssue = isAdmin && st.mode === 'licensed' && st.status === 'active' && st.limits && st.limits.maxChildren > 0;
  const childCard = isAdmin && st.mode === 'licensed' && !st.trial ? `<div class="card">
    <div class="acct-header"><h3>מערכות בת (${children.length}${st.limits && st.limits.maxChildren != null ? ' מתוך ' + Number(st.limits.maxChildren) : ''})</h3>
      ${canIssue ? `<div class="acct-actions">
        <button class="secondary" id="licChildPayBtn">💳 דרישת תשלום למערכת בת</button>
        <button class="secondary" id="licChildRequestBtn">＋ בקשת אישור למערכת בת</button>
        <button class="primary" id="licChildIssueBtn">✔ הנפקה לפי אישור</button>
      </div>` : ''}
    </div>
    ${canIssue ? '<p class="muted">מערכת בת נפתחת רק באישור מנהל-העל ואחרי תשלום שנתי למערכת הזו: (1) במכשיר החדש — "הפקת בקשת רישיון"; (2) כאן — "דרישת תשלום" עם קובץ הבקשה, וכשהתשלום מתקבל מסמנים "שולם" במסך הגבייה; (3) "בקשת אישור", בוחרים את הבקשה והתנאים ושולחים לספק; (4) עם קובץ האישור שחוזר — "הנפקה לפי אישור", ומעבירים את קובץ הרישיון למכשיר החדש.</p>' : ''}
    <div class="acct-scroll"><table class="acct-table">
      <thead><tr><th>#</th><th>שם</th><th>מצב</th><th>בתוקף עד</th><th>תחומים</th><th></th></tr></thead>
      <tbody>${children.map(c => `<tr>
        <td>${Number(c.slot)}</td><td>${esc(c.name)}</td><td>${licBadge(c.status)}${(c.holds || []).map(h => `<br><small>${esc(LIC_HOLD_KINDS[h.kind] || h.kind)}: ${esc(h.reason)}</small>`).join('')}</td>
        <td>${esc(licDate(c.expiresAt))}</td><td><small>${(c.features || []).map(f => esc(licFeatureLabel(f))).join(', ')}</small></td>
        <td>${c.status === 'terminated' ? '' : `
          ${(c.holds || []).map(h => `<button class="secondary small" data-lic-child-release="${esc(c.id)}" data-hold="${esc(h.holdId)}">החזרה לפעילות</button>`).join('')}
          <button class="secondary small" data-lic-child-hold="${esc(c.id)}">השבתה</button>
          <button class="danger-outline" data-lic-child-terminate="${esc(c.id)}">סיום</button>`}
        </td></tr>`).join('') || '<tr><td colspan="6" class="muted">לא הונפקו מערכות בת</td></tr>'}</tbody>
    </table></div>
  </div>` : '';

  // הרשמה: בלי רישוי — כמו קודם; בניסיון — רק אחרי שהתחילה (ההתחלה: "קניית רישיון" בכרטיס המצב)
  const showSignup = isAdmin && d.remote && d.remote.url && (st.mode !== 'licensed' || (st.trial && d.signup));
  const signupCard = showSignup ? renderSignupCard(d.signup) : '';
  const advanced = `${isAdmin ? renderRemoteCard(d.remote, st) : ''}${myCard}${childCard}${isAdmin ? renderOwnerPanel(d.owner, d.inbox, d.remote, d.releases, d.ownerOffer, d.signups) : ''}`;
  const advOpen = st.mode === 'unlicensed' || !!(d.owner && d.owner.unlocked);
  return `<div class="settings">${renderStatusCard(st, d)}${renderActivationCard(st.activation, d)}${signupCard}${renderUpdateCard(d.update, isAdmin)}
    <details class="lic-advanced"${advOpen ? ' open' : ''}><summary>הגדרות מתקדמות — פרטי הרישיון, שרת, מערכות בת</summary>${advanced}</details></div>`;
}

// הרשמה: מערכת חדשה בוחרת תכנית, חותמת על התקנון ומשלמת בדף המאובטח של חברת הסליקה
const SIGNUP_STATUS = { pending: 'ממתין לתשלום', failed: 'התשלום לא הושלם', submitted: 'ההרשמה התקבלה — הרישיון יגיע בסנכרון' };
function renderSignupCard(su) {
  return `<div class="card signup-card">
    <h3>📝 הרשמה למערכת</h3>
    ${su ? `<div class="acct-row"><span>תכנית</span><span>${esc(su.planName)} · ${esc(agorotText(su.priceAgorot))}</span></div>
      <div class="acct-row"><span>מצב</span><span>${esc(SIGNUP_STATUS[su.status] || su.status)}</span></div>
      <div class="acct-actions">
        ${su.status === 'pending' ? '<button class="primary" id="signupPayBtn">💳 מעבר לתשלום מאובטח</button><button class="secondary" id="signupCheckBtn">🔄 בדיקת מצב התשלום</button>' : ''}
        ${su.status === 'submitted' ? '<button class="primary" id="licRemoteSyncBtn2">🔄 סנכרון — קבלת הרישיון</button>' : ''}
        ${su.status !== 'submitted' ? '<button class="secondary" id="signupStartBtn">הרשמה מחדש</button>' : ''}
      </div>`
    : `<p>בחירת תכנית, חתימה על התקנון ותשלום — הכול מכאן. בסיום הרישיון מגיע אוטומטית.</p>
      <div class="acct-actions"><button class="primary" id="signupStartBtn">📝 התחלת הרשמה</button></div>`}
    <p class="muted">פרטי האשראי מוקלדים רק בדף המאובטח של חברת הסליקה — לא בתוכנה ולא בשרת שלנו.</p>
  </div>`;
}
const agorotText = (a) => (Number(a) === 0 ? 'ללא תשלום' : '₪' + (Number(a) / 100).toLocaleString('he-IL', { maximumFractionDigits: 2 }));

// אשף ההרשמה: תכנית ← פרטים ← תקנון (גלילה + הסכמה + חתימה)
function signupWizard(offerResp) {
  const offer = offerResp.offer;
  return openDialog((card, finish) => {
    card.style.maxWidth = '640px';
    card.classList.add('signup-wizard');
    const v = { planId: offer.plans[0].id, customer: {}, scrolled: false, accepted: false, signed: false };
    const step = (n) => {
      card.innerHTML = '';
      const h = document.createElement('h2');
      h.textContent = ['בחירת תכנית', 'פרטי הלקוח', offer.terms.title + ' — גרסה ' + offer.terms.version][n];
      const steps = document.createElement('div');
      steps.className = 'signup-steps';
      steps.textContent = 'שלב ' + (n + 1) + ' מתוך 3';
      card.append(h, steps);
      const err = document.createElement('div');
      err.className = 'bad';
      const actions = document.createElement('div');
      actions.className = 'modal-actions';
      const btn = (text, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; b.onclick = fn; actions.appendChild(b); return b; };
      if (n === 0) {
        const list = document.createElement('div');
        list.className = 'signup-plans';
        for (const p of offer.plans) {
          const l = document.createElement('label');
          l.className = 'signup-plan';
          const r = document.createElement('input');
          r.type = 'radio'; r.name = 'plan'; r.value = p.id; r.checked = p.id === v.planId;
          r.onchange = () => { v.planId = p.id; };
          const t = document.createElement('div');
          t.innerHTML = `<b>${esc(p.name)}</b> — <b>${esc(agorotText(p.priceAgorot))}</b> ל-${Number(p.months)} חודשים<br>
            <small>${esc(p.desc || '')}</small><br><small class="muted">${(p.features || []).map(f => esc(licFeatureLabel(f))).join(' · ')} · עד ${Number(p.limits.maxUsers)} משתמשים</small>`;
          l.append(r, t);
          list.appendChild(l);
        }
        card.appendChild(list);
        btn('ביטול', 'secondary', () => finish(null));
        btn('המשך', 'primary', () => step(1));
      } else if (n === 1) {
        const fields = [['org', 'שם הארגון / העסק *'], ['contact', 'איש קשר *'], ['phone', 'טלפון *'], ['email', 'דוא"ל'], ['taxId', 'ת.ז / ח"פ']];
        for (const [k, label] of fields) {
          const l = document.createElement('label'); l.className = 'field';
          const sp = document.createElement('span'); sp.textContent = label;
          const i = document.createElement('input'); i.value = v.customer[k] || ''; i.oninput = () => { v.customer[k] = i.value.trim(); };
          if (k === 'phone' || k === 'taxId') i.inputMode = 'numeric';
          if (k === 'email') i.type = 'email';
          l.append(sp, i); card.appendChild(l);
        }
        btn('חזרה', 'secondary', () => step(0));
        btn('המשך', 'primary', () => {
          if (!v.customer.org || !v.customer.contact || !v.customer.phone) { err.textContent = 'יש למלא את השדות המסומנים'; return; }
          step(2);
        });
      } else {
        const box = document.createElement('div');
        box.className = 'signup-terms';
        box.tabIndex = 0;
        box.textContent = offer.terms.text;
        const hint = document.createElement('p');
        hint.className = 'muted';
        hint.textContent = 'יש לגלול עד סוף התקנון';
        const chkL = document.createElement('label'); chkL.className = 'chk';
        const chk = document.createElement('input'); chk.type = 'checkbox'; chk.disabled = true;
        chkL.append(chk, document.createTextNode(' קראתי את התקנון ואני מסכים לכל תנאיו'));
        box.addEventListener('scroll', () => {
          if (box.scrollTop + box.clientHeight >= box.scrollHeight - 8) { v.scrolled = true; chk.disabled = false; hint.textContent = ''; }
        });
        chk.onchange = () => { v.accepted = chk.checked; };
        // תקנון קצר שאינו נגלל — נחשב כנקרא
        setTimeout(() => { if (box.scrollHeight <= box.clientHeight + 8) { v.scrolled = true; chk.disabled = false; hint.textContent = ''; } }, 0);
        const sigLabel = document.createElement('p'); sigLabel.textContent = 'חתימה (בעכבר או באצבע):';
        const canvas = document.createElement('canvas');
        canvas.width = 480; canvas.height = 140; canvas.className = 'signup-sig';
        const ctx = canvas.getContext && canvas.getContext('2d');
        let drawing = false, strokes = 0;
        const pos = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height]; };
        if (ctx) {
          ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#0b2a5b';
          canvas.addEventListener('pointerdown', (e) => { drawing = true; canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); });
          canvas.addEventListener('pointermove', (e) => { if (!drawing) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); strokes++; });
          canvas.addEventListener('pointerup', () => { drawing = false; v.signed = strokes > 10; });
        }
        const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'secondary small'; clear.textContent = 'ניקוי החתימה';
        clear.onclick = () => { if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); strokes = 0; v.signed = false; };
        const plan = offer.plans.find(p => p.id === v.planId);
        const sum = document.createElement('p');
        sum.innerHTML = `לתשלום: <b>${esc(agorotText(plan.priceAgorot))}</b> — ${esc(plan.name)}, ${Number(plan.months)} חודשים`;
        card.append(box, hint, chkL, sigLabel, canvas, clear, sum);
        btn('חזרה', 'secondary', () => step(1));
        btn(plan.priceAgorot > 0 ? 'חתימה ומעבר לתשלום' : 'חתימה ושליחה', 'primary', () => {
          if (!v.scrolled) { err.textContent = 'יש לקרוא את התקנון עד סופו'; return; }
          if (!v.accepted) { err.textContent = 'יש לסמן הסכמה לתקנון'; return; }
          if (!v.signed) { err.textContent = 'יש לחתום בתיבת החתימה'; return; }
          finish({ offerText: offerResp.text, planId: v.planId, customer: v.customer, signatureImage: canvas.toDataURL('image/png'), scrolledToEnd: true, accepted: true });
        });
      }
      card.append(err, actions);
    };
    step(0);
  });
}

// עדכוני גרסה: גרסה מותקנת, עדכון חתום שהתקבל, והורדה / התקנה בלחיצה
function renderUpdateCard(u, isAdmin) {
  if (!u) return '';
  const av = u.available;
  const ready = u.downloaded && av && u.downloaded.version === av.version;
  return `<div class="card update-card">
    <div class="acct-header"><h3>🔄 עדכוני גרסה</h3>
      ${isAdmin ? '<div class="acct-actions"><button class="secondary small" id="updFileBtn">📂 התקנה מקובץ (USB)</button></div>' : ''}
    </div>
    <div class="acct-row"><span>גרסה מותקנת</span><span dir="ltr">${esc(u.currentVersion)}</span></div>
    ${av ? `<div class="acct-row"><span>גרסה חדשה זמינה</span><span><b dir="ltr">${esc(av.version)}</b> <small class="muted">(${esc(licDate(av.issuedAt))})</small></span></div>
      ${av.notes ? `<p class="update-notes">${esc(av.notes)}</p>` : ''}
      ${isAdmin ? `<div class="acct-actions">
        ${ready ? '<button class="primary" id="updInstallBtn">⬆ התקנת הגרסה עכשיו</button>'
          : (av.url ? '<button class="primary" id="updDownloadBtn">⬇ הורדה ובדיקה</button>' : '<span class="muted">לעדכון הזה אין קישור — התקינו מקובץ</span>')}
      </div>` : '<p class="muted">ההתקנה — על ידי מנהל המערכת.</p>'}`
    : '<p class="muted">המערכת מעודכנת. עדכונים מגיעים בסנכרון עם השרת, או מקובץ.</p>'}
    <p class="muted">כל עדכון חתום על ידי הספק ונבדק לפני ההתקנה — קובץ שאינו תואם לחתימה נדחה.</p>
  </div>`;
}

// עבודה מרחוק: כשמוגדר שרת רישוי, הבקשות, האישורים והעדכונים עוברים בלחיצה — בלי להעביר קבצים
function renderRemoteCard(r, st) {
  if (!r) return '';
  const pending = Array.isArray(r.pending) ? r.pending : [];
  const canIssue = st.mode === 'licensed' && st.status === 'active' && st.limits && st.limits.maxChildren > 0;
  return `<div class="card">
    <div class="acct-header"><h3>🌐 עבודה מרחוק</h3>
      <div class="acct-actions"><button class="secondary small" id="licRemoteSetBtn">${r.url ? 'שינוי שרת' : 'הגדרת שרת רישוי'}</button></div>
    </div>
    ${r.url ? `
      <div class="acct-row"><span>שרת</span><span dir="ltr">${esc(r.url)}</span></div>
      <div class="acct-row"><span>סנכרון אחרון</span><span>${r.lastSync ? esc(new Date(r.lastSync).toLocaleString('he-IL')) : 'עדיין לא'}</span></div>
      ${r.myCode ? `<div class="acct-row"><span>קוד המערכת (למערכות בת)</span><span dir="ltr"><b>${esc(r.myCode)}</b></span></div>` : ''}
      <div class="acct-actions">
        <button class="primary" id="licRemoteSyncBtn">🔄 סנכרון עכשיו</button>
        ${st.mode === 'licensed' ? '' : '<button class="secondary" id="licRemoteRequestBtn">📤 שליחת בקשת רישיון לספק</button>'}
        ${st.mode === 'licensed' ? '' : '<button class="secondary" id="licRemoteParentBtn">📤 בקשה ממערכת מנפיקה (קוד)</button>'}
      </div>
      ${pending.length ? `<h4>מערכות בת שביקשו רישיון (${pending.length})</h4>
        <div class="acct-scroll"><table class="acct-table"><tbody>${pending.map(p => `<tr>
          <td>${esc(p.name)}</td><td><small>${esc(new Date(p.at).toLocaleString('he-IL'))}</small></td>
          <td>${licPayCell(p.payment)}</td>
          <td>${!canIssue ? '' : p.payment && p.payment.ready
            ? `<button class="primary small" data-lic-remote-forward="${esc(p.keyId)}" data-name="${esc(p.name)}">שליחה לאישור</button>`
            : p.payment ? `<button class="secondary small" data-lic-pay-msg="${esc(p.payment.id)}">📋 הודעת תשלום</button>`
              : `<button class="primary small" data-lic-remote-pay="${esc(p.keyId)}" data-name="${esc(p.name)}">💳 דרישת תשלום</button>`}
            <button class="secondary small" data-lic-remote-dismiss="${esc(p.keyId)}">התעלמות</button></td></tr>`).join('')}</tbody></table></div>` : ''}
      <p class="muted">השרת משמש רק להעברה: כל רישיון, אישור ועדכון חתומים, והתוכנה בודקת אותם בעצמה. בלי חיבור — הכול ממשיך לעבוד, ואפשר להעביר קבצים ידנית.</p>`
    : '<p class="muted">בלי שרת — העברת קבצים ידנית (הכפתורים למטה). עם שרת — בקשות, אישורים ועדכוני השבתה עוברים בלחיצה, גם למחשב מרוחק.</p>'}
  </div>`;
}

// מצב התשלום של מערכת בת למערכת הזו (דרישה במסך הגבייה)
function licPayCell(pay) {
  if (!pay) return '<small class="muted">טרם שולם</small>';
  const sum = `${esc(pay.ref)} · ${Number(pay.amount).toLocaleString('he-IL')} ₪ · ${Number(pay.months)} חודשים`;
  return pay.ready ? `<small>✔ שולם (${sum})</small>` : `<small class="muted">ממתין לתשלום (${sum})</small>`;
}

// מצב מנהל-העל: נפתח בסיסמה. ממנו מנפיקים ללקוחות ומאשרים מערכות בת
function renderOwnerPanel(o, inbox, remote, releases, ownerOffer, signups) {
  if (!o) return '';
  if (!o.initialized) {
    return `<div class="card"><h3>מצב מנהל-העל</h3>
      <p class="muted">למנהל-העל (הספק) בלבד: יצירת מפתח שורש שממנו מונפקים כל הרישיונות. המפתח נשמר מוצפן בסיסמה במחשב הזה.</p>
      <div class="acct-actions"><button class="secondary" id="ownerInitBtn">🔑 הגדרת מצב מנהל-העל</button>
      <button class="secondary" id="ownerRecoverBtn">♻ שחזור מקודי שחזור</button>
      <button class="secondary" id="ownerImportBtn">📥 שחזור מגיבוי מלא</button></div></div>`;
  }
  if (!o.unlocked) {
    return `<div class="card"><h3>מצב מנהל-העל</h3>
      <div class="acct-actions"><button class="primary" id="ownerUnlockBtn">🔓 כניסה למצב מנהל-העל</button>
      <button class="secondary small" id="ownerRecoverBtn">♻ שכחתי סיסמה — שחזור מקודים</button></div></div>`;
  }
  const tenants = Array.isArray(o.tenants) ? o.tenants : [];
  const globalHolds = Array.isArray(o.globalHolds) ? o.globalHolds : [];
  return `<div class="card owner-panel">
    <div class="acct-header"><h3>מנהל-העל — כל המערכות (${tenants.length} לקוחות)</h3>
      <div class="acct-actions">
        <button class="primary" id="ownerOpenBtn">📂 פתיחת בקשה מלקוח</button>
        ${globalHolds.length
          ? globalHolds.map(h => `<button class="secondary" data-owner-release="*" data-hold="${esc(h.holdId)}">ביטול נעילה גלובלית</button>`).join('')
          : '<button class="danger-outline" id="ownerKillBtn">⛔ נעילת כל המערכות</button>'}
        <button class="secondary" id="ownerLockBtn">🔒 יציאה ממצב מנהל-העל</button>
      </div>
    </div>
    ${o.recovery ? '' : `<div class="owner-warn" role="alert"><b>⚠ אין גיבוי למפתח מנהל-העל.</b> אם המחשב הזה ייפגע או שהסיסמה תישכח — לא ניתן יהיה לנהל את הלקוחות.
      <button class="primary small" id="ownerCodesBtn">יצירת קודי שחזור עכשיו</button></div>`}
    <details class="owner-keys"><summary>🛡 שמירה על המפתח</summary>
      <div class="acct-actions">
        <button class="secondary small" id="ownerCodesBtn2">🧩 קודי שחזור${o.recovery ? ' (נוצרו ' + esc(licDate(o.recovery.createdAt)) + ', ' + Number(o.recovery.k) + ' מתוך ' + Number(o.recovery.n) + ')' : ''}</button>
        <button class="secondary small" id="ownerExportBtn">💾 גיבוי מלא מוצפן</button>
        <button class="secondary small" id="ownerPassBtn">🔑 החלפת סיסמה</button>
      </div>
      <p class="muted">קודי שחזור: המפתח מחולק לכמה קודים, וכל מספר מסוים מהם משחזר אותו. מוסרים אותם לאנשים או למקומות שונים — כל אחד לבד אינו מגלה דבר.</p>
    </details>
    ${remote && remote.url ? `<div class="acct-actions">
      <button class="primary" id="ownerRemoteReceiveBtn">📥 בדיקת בקשות חדשות</button>
      <button class="secondary" id="ownerRemotePushBtn">📤 שליחת עדכוני סטטוס לכל המערכות</button>
    </div>` : ''}
    ${renderOwnerInbox(inbox)}
    ${o.configured ? '' : `<p class="bad">המפתח הציבורי שלך עדיין לא מוגדר בתוכנה (shell/licensing/root-keys.js), ולכן הרישוי אינו נאכף בהתקנות. <button class="secondary small" id="ownerCopyKeyBtn">שמירת המפתח הציבורי לקובץ</button></p>`}
    ${globalHolds.map(h => `<p class="bad">נעילה גלובלית פעילה: ${esc(h.reason)}</p>`).join('')}
    <div class="acct-scroll"><table class="acct-table">
      <thead><tr><th>#</th><th>לקוח</th><th>מצב</th><th>בתוקף עד</th><th>מכסות</th><th></th></tr></thead>
      <tbody>${tenants.map(t => `<tr>
        <td>${Number(t.slot)}</td><td><b>${esc(t.name)}</b></td>
        <td>${licBadge(t.status)}${(t.holds || []).map(h => `<br><small>${esc(LIC_HOLD_KINDS[h.kind] || h.kind)}: ${esc(h.reason)}</small>`).join('')}</td>
        <td>${esc(licDate(t.expiresAt))}</td><td><small>${esc(licLimits(t.limits))}</small></td>
        <td>
          ${(t.holds || []).map(h => `<button class="secondary small" data-owner-release="${esc(t.id)}" data-hold="${esc(h.holdId)}">החזרה לפעילות</button>`).join('')}
          <button class="secondary small" data-owner-hold="${esc(t.id)}">השבתה</button>
          <button class="secondary small" data-owner-notices="${esc(t.id)}" data-name="${esc(t.name)}">קובץ עדכון</button>
          ${t.status === 'terminated' ? '' : `<button class="danger-outline" data-owner-terminate="${esc(t.id)}">סיום</button>`}
        </td></tr>
        ${(t.children || []).map(c => `<tr class="${c.revoked ? 'muted' : ''}">
          <td></td><td>↳ ${esc(c.name)} <small class="muted">(מערכת בת ${Number(c.slot)})</small></td>
          <td>${c.revoked || c.terminated ? licBadge('terminated') : ((c.holds || []).length ? licBadge((c.holds[0] || {}).kind) : '<span class="muted">לפי הלקוח</span>')}</td>
          <td><small>אושרה ${esc(licDate(c.approvedAt))}</small></td><td></td>
          <td>${c.revoked ? '' : `
            ${(c.holds || []).map(h => `<button class="secondary small" data-owner-release="${esc(c.id)}" data-hold="${esc(h.holdId)}">החזרה</button>`).join('')}
            <button class="secondary small" data-owner-hold="${esc(c.id)}">השבתה</button>
            <button class="danger-outline" data-owner-revoke="${esc(c.id)}">ביטול אישור</button>`}</td>
        </tr>`).join('')}`).join('') || '<tr><td colspan="6" class="muted">עדיין לא הונפקו רישיונות. לקוח חדש: "פתיחת בקשה מלקוח"</td></tr>'}</tbody>
    </table></div>
    <p class="muted">שינוי סטטוס נכנס לתוקף אצל הלקוח כשהוא מקבל "קובץ עדכון" (או בהתקנת רישיון מחודש). השבתה של לקוח משביתה גם את כל מערכות הבת שלו.</p>
    ${renderOwnerSignups(ownerOffer, signups, remote)}
    ${renderOwnerReleases(releases, remote)}
  </div>`;
}

function renderOwnerSignups(offer, list, remote) {
  if (!offer || !Array.isArray(offer.plans) || !offer.terms) offer = null;
  const rows = (Array.isArray(list) ? list : []).slice().reverse();
  return `<div class="acct-header"><h4>הרשמה, תכניות ותקנון</h4>
      <div class="acct-actions"><button class="secondary small" id="ownerOfferBtn">${offer ? '✎ עריכת תכניות ותקנון' : '＋ הגדרת תכניות ותקנון'}</button>
      ${offer && remote && remote.url ? '<button class="primary small" id="ownerOfferPublishBtn">📤 פרסום בשרת</button>' : ''}</div></div>
    ${offer ? `<p class="muted">תקנון גרסה ${esc(offer.terms.version)} · ${offer.plans.map(p => esc(p.name) + ' ' + esc(agorotText(p.priceAgorot))).join(' · ')}</p>` : '<p class="muted">עדיין לא הוגדרו תכניות. מערכות חדשות יוכלו להירשם ולשלם אחרי פרסום בשרת.</p>'}
    ${rows.length ? `<div class="acct-scroll"><table class="acct-table">
      <thead><tr><th>התקבלה</th><th>לקוח</th><th>תכנית</th><th>תשלום</th><th>מצב</th><th></th></tr></thead>
      <tbody>${rows.map(x => `<tr><td><small>${esc(new Date(x.receivedAt).toLocaleString('he-IL'))}</small></td>
        <td><b>${esc(x.customer.org)}</b><br><small>${esc(x.customer.contact)} · <span dir="ltr">${esc(x.customer.phone)}</span></small></td>
        <td>${esc(x.planName)}</td><td>${x.payment ? esc(agorotText(x.payment.amountAgorot)) + '<br><small dir="ltr">' + esc(x.payment.providerRef || '') + '</small>' : 'ללא תשלום'}</td>
        <td>${x.status === 'issued' ? '<span class="ok">הונפק</span>' : '<b>חדשה</b>'}${x.invoice ? `<br><small>חשבונית ${Number(x.invoice.number)}</small>` : ''}</td>
        <td>${x.status === 'issued' ? '' : `<button class="primary small" data-owner-signup-issue="${esc(x.id)}">✔ הנפקה ושליחה</button>`}
          <button class="secondary small" data-owner-signup-doc="${esc(x.id)}">📄 תקנון חתום (PDF)</button>
          ${x.invoice ? `<button class="secondary small" data-owner-signup-invoice="${esc(x.invoice.id)}">🧾 חשבונית (PDF)</button>` : ''}</td></tr>`).join('')}</tbody>
    </table></div>` : ''}`;
}

// קודי שחזור: מוצגים פעם אחת. הדפסה / העתקה, ואישור שנשמרו
function showRecoveryCodes(r) {
  return openDialog((card, finish) => {
    card.style.maxWidth = '640px';
    card.innerHTML = `<h2>קודי שחזור — ${Number(r.k)} מתוך ${Number(r.n)}</h2>
      <p>כל <b>${Number(r.k)}</b> קודים משחזרים את מפתח מנהל-העל, גם במחשב חדש. פחות מזה — אינם מגלים דבר.</p>
      <p class="bad">הקודים מוצגים פעם אחת בלבד. רשמו או הדפיסו אותם, ומסרו כל קוד לאדם / מקום אחר (כספת, עו"ד, בן משפחה). אל תשמרו את כולם יחד.</p>
      <ol class="recovery-codes">${r.codes.map(c => `<li dir="ltr"><code>${esc(c)}</code></li>`).join('')}</ol>`;
    const chkL = document.createElement('label'); chkL.className = 'chk';
    const chk = document.createElement('input'); chk.type = 'checkbox';
    chkL.append(chk, document.createTextNode(' רשמתי את כל הקודים ושמרתי אותם במקומות נפרדים'));
    const actions = document.createElement('div'); actions.className = 'modal-actions';
    const print = document.createElement('button'); print.type = 'button'; print.className = 'secondary'; print.textContent = '🖨 הדפסה';
    print.onclick = () => window.print();
    const done = document.createElement('button'); done.type = 'button'; done.className = 'primary'; done.textContent = 'סיום'; done.disabled = true;
    chk.onchange = () => { done.disabled = !chk.checked; };
    done.onclick = () => finish(true);
    actions.append(print, done);
    card.append(chkL, actions);
  });
}

// עורך תכניות ותקנון (מנהל-העל)
function offerEditor(cur) {
  return openDialog((card, finish) => {
    card.style.maxWidth = '720px';
    const plans = (cur && cur.plans ? cur.plans : [{ id: 'basic', name: 'בסיסי', priceAgorot: 0, months: 12, features: ['econ'], limits: { maxUsers: 3, maxChildren: 0 } }])
      .map(p => ({ ...p, limits: { ...p.limits } }));
    const render = () => {
      card.innerHTML = '<h2>תכניות ותקנון</h2>';
      const mk = (label, value, type = 'text') => { const l = document.createElement('label'); l.className = 'field'; const sp = document.createElement('span'); sp.textContent = label;
        const i = document.createElement(type === 'textarea' ? 'textarea' : 'input'); if (type !== 'textarea') i.type = type; i.value = value == null ? '' : value; l.append(sp, i); card.appendChild(l); return i; };
      const seller = mk('שם הספק (מופיע בתקנון)', cur && cur.seller ? cur.seller.name : '');
      const sellerId = mk('ח"פ / עוסק', cur && cur.seller ? cur.seller.taxId : '');
      const inputs = plans.map((p, idx) => {
        const fsx = document.createElement('fieldset');
        fsx.innerHTML = `<legend>תכנית ${idx + 1}</legend>`;
        card.appendChild(fsx);
        const f = (label, val, type) => { const l = document.createElement('label'); l.className = 'field'; const sp = document.createElement('span'); sp.textContent = label;
          const i = document.createElement('input'); i.type = type || 'text'; i.value = val == null ? '' : val; l.append(sp, i); fsx.appendChild(l); return i; };
        const out = { id: f('מזהה (אנגלית)', p.id), name: f('שם', p.name), desc: f('תיאור', p.desc), price: f('מחיר ב-₪ (0 = חינם)', (p.priceAgorot || 0) / 100, 'number'),
          months: f('תקופה (חודשים)', p.months, 'number'), users: f('משתמשים', p.limits.maxUsers, 'number'), children: f('מערכות בת', p.limits.maxChildren, 'number'), feats: [] };
        const box = document.createElement('div'); box.className = 'checks';
        for (const [val, label] of LIC_FEATURES) { const l = document.createElement('label'); const c = document.createElement('input'); c.type = 'checkbox'; c.value = val; c.checked = (p.features || []).includes(val);
          l.append(c, document.createTextNode(' ' + label)); box.appendChild(l); out.feats.push(c); }
        fsx.appendChild(box);
        return out;
      });
      const add = document.createElement('button'); add.type = 'button'; add.className = 'secondary small'; add.textContent = '＋ תכנית נוספת';
      add.onclick = () => { collect(); plans.push({ id: 'plan' + (plans.length + 1), name: '', priceAgorot: 0, months: 12, features: ['econ'], limits: { maxUsers: 3, maxChildren: 0 } }); render(); };
      card.appendChild(add);
      const tv = mk('גרסת התקנון (למשל 1.0) — שינוי נוסח מחייב גרסה חדשה', cur && cur.terms ? cur.terms.version : '1.0');
      const tt = mk('כותרת התקנון', cur && cur.terms ? cur.terms.title : 'תקנון ותנאי שימוש');
      const tx = mk('נוסח התקנון המלא', cur && cur.terms ? cur.terms.text : '', 'textarea');
      tx.rows = 12;
      const err = document.createElement('div'); err.className = 'bad';
      const actions = document.createElement('div'); actions.className = 'modal-actions';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = 'ביטול'; cancel.onclick = () => finish(null);
      const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'primary'; ok.textContent = 'חתימה ושמירה';
      function collect() {
        inputs.forEach((x, i) => { Object.assign(plans[i], { id: x.id.value.trim(), name: x.name.value.trim(), desc: x.desc.value.trim(),
          priceAgorot: Math.round(Number(x.price.value || 0) * 100), months: Number(x.months.value), features: x.feats.filter(c => c.checked).map(c => c.value),
          limits: { ...plans[i].limits, maxUsers: Number(x.users.value), maxChildren: Number(x.children.value), maxDepth: Number(x.children.value) > 0 ? 2 : 1 } }); });
      }
      ok.onclick = () => {
        collect();
        finish({ seller: { name: seller.value.trim(), taxId: sellerId.value.trim() }, plans, terms: { version: tv.value.trim(), title: tt.value.trim(), text: tx.value } });
      };
      actions.append(cancel, ok);
      card.append(err, actions);
    };
    render();
  });
}

function renderOwnerReleases(list, remote) {
  const rows = (Array.isArray(list) ? list : []).slice().reverse();
  return `<div class="acct-header"><h4>שחרור גרסאות</h4>
      <div class="acct-actions"><button class="primary small" id="ownerReleaseBtn">＋ שחרור גרסה חדשה</button></div></div>
    <div class="acct-scroll"><table class="acct-table">
      <thead><tr><th>גרסה</th><th>מערכת</th><th>קובץ</th><th>שוחררה</th><th></th></tr></thead>
      <tbody>${rows.map(r => `<tr><td dir="ltr"><b>${esc(r.version)}</b></td><td>${r.platform === 'android' ? 'אנדרואיד' : 'מחשב'}</td>
        <td><small dir="ltr">${esc(r.fileName)}</small>${r.url ? '' : ' <small class="muted">(קובץ בלבד)</small>'}</td><td><small>${esc(licDate(r.issuedAt))}</small></td>
        <td>${remote && remote.url ? `<button class="secondary small" data-owner-publish="${esc(r.version)}" data-platform="${esc(r.platform)}">📤 שליחה לכל המערכות</button>` : ''}</td></tr>`).join('')
        || '<tr><td colspan="5" class="muted">עדיין לא שוחררו גרסאות</td></tr>'}</tbody>
    </table></div>
    <p class="muted">שחרור: בוחרים את קובץ ההתקנה (EXE / APK) — נחתמת תעודת גרסה ונשמרת לידו (.ssupdate). מעבירים את שני הקבצים ב-USB, או שולחים לכל המערכות דרך השרת עם קישור הורדה.</p>`;
}

function renderOwnerInbox(inbox) {
  const list = Array.isArray(inbox) ? inbox : [];
  if (!list.length) return '';
  return `<h4>בקשות ממתינות (${list.length})</h4>
    <div class="acct-scroll"><table class="acct-table">
      <thead><tr><th>התקבלה</th><th>בקשה</th><th>פרטים</th><th></th></tr></thead>
      <tbody>${list.map(m => {
        const sm = m.summary || {};
        const what = sm.kind === 'license' ? (sm.renewal ? 'חידוש רישיון' : 'לקוח חדש') : sm.kind === 'approval' ? 'מערכת בת' : 'לא תקינה';
        const detail = sm.kind === 'license' ? esc(sm.name)
          : sm.kind === 'approval' ? `"${esc(sm.name)}" של ${esc(sm.parentName)} · ${(sm.features || []).map(f => esc(licFeatureLabel(f))).join(', ')} · מכסה ${Number(sm.quota && sm.quota.used)}/${Number(sm.quota && sm.quota.max)}${sm.problem ? ` · <span class="bad">${esc(sm.problem)}</span>` : ''}`
          : `<span class="bad">${esc(sm.error || '')}</span>`;
        const actions = sm.kind === 'license' ? `<button class="primary small" data-owner-inbox-issue="${esc(m.id)}">הנפקה</button>`
          : sm.kind === 'approval' && !sm.problem ? `<button class="primary small" data-owner-inbox-approve="${esc(m.id)}">✔ אישור</button>` : '';
        return `<tr><td><small>${esc(new Date(m.at).toLocaleString('he-IL'))}</small></td><td>${what}</td><td><small>${detail}</small></td>
          <td>${actions} <button class="danger-outline" data-owner-inbox-reject="${esc(m.id)}">✖ דחייה</button></td></tr>`;
      }).join('')}</tbody>
    </table></div>`;
}
