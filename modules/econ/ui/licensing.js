// ממשק המודול הכלכלי — רישוי ומערכות.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

// ============================================================
// רישוי ומערכות (docs/LICENSING-DESIGN.md): הרישיון של המערכת, מערכות בת, ומצב מנהל-העל.
// כל פעולה בכפתור; הקבצים (בקשה / רישיון / אישור / הודעות) נשמרים ונפתחים בבוחר קבצים.
// ============================================================
const LIC_STATUS = { active: 'פעילה', pending_payment: 'ממתינה לתשלום', suspended: 'מושבתת זמנית', locked: 'נעולה', terminated: 'הסתיימה', trial_ended: 'תקופת הניסיון הסתיימה', offline: 'צפייה בלבד — אין חיבור לשרת הרישוי' };
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
  ['shamai', 'שמאות'], ['tools', 'ארגז כלים'],
  ['ai', 'עוזר חכם — כללים'], ['ai.local', 'עוזר חכם — מודל במחשב'], ['ai.cloud', 'עוזר חכם — שדרוג ענן'],
  // מודולי הלימוד — במהדורה המלאה
  ['trainer', 'ניהול אימונים'], ['english', 'אנגלית'], ['math', 'חשבון'], ['school', 'ניהול מוסד']
];
// תחומים מרישיונות ישנים שאינם במוצר הזה — מוצגים בשם קריא, ולא מוצעים בהנפקה (כרגע אין)
const LIC_LEGACY_FEATURES = {};
const licFeatureLabel = (f) => (LIC_FEATURES.find(x => x[0] === f) || [f, LIC_LEGACY_FEATURES[f] || f])[1];
// מרכז הרישוי (shell/licensing/products.js): הקטלוג מגיע ממצב מנהל-העל (owner:getState → products).
// לכל תוכנה תחומים משלה — ושמות תחומים חוזרים בין תוכנות, ולכן שם תחום תמיד לפי התוכנה
const licProducts = (cat) => (cat && Array.isArray(cat.products) ? cat.products : []);
const licProductName = (cat, id) => (licProducts(cat).find(p => p.id === id) || { name: id || '' }).name;
const licProductFeatures = (cat, id) => (licProducts(cat).find(p => p.id === id) || { features: id ? [] : LIC_FEATURES }).features;
const licScopes = (cat) => (cat && Array.isArray(cat.scopes) ? cat.scopes : []);
const licScopeName = (cat, s) => (licScopes(cat).find(x => x.id === s) || { name: s || '' }).name;
const licProductFeatureLabel = (cat, pid, f) => ((licProductFeatures(cat, pid) || []).find(x => x[0] === f) || [f, licFeatureLabel(f)])[1];
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
    <div class="acct-header"><h3>הפעלת המערכת</h3><span>${act.ok ? '<span class="ok">✔ המערכת פעילה</span>' : act.readOnly ? `<span class="bad">צפייה בלבד עד החיבור — נעילה מלאה ב-${esc(licDate(act.lockAt))}</span>` : '<span class="bad">נדרשת השלמה — עד אז המערכת נעולה</span>'}</span></div>
    <table class="acct-table"><tbody>${rows}</tbody></table>
    ${act.ok && act.dueSoon ? `<p class="bad">⏰ יש להתחבר לשרת הרישוי עד ${esc(licDate(act.nextDue))} — אחרת המערכת תעבור לצפייה בלבד, ו-30 יום אחר כך תינעל. הנתונים לא נמחקים.</p>${isAdmin && remoteOn ? syncBtn : ''}`
      : act.ok && act.nextDue ? `<p class="muted">כדי שהמערכת תישאר פתוחה: חיבור לשרת הרישוי לפחות פעם בחודש (אוטומטי כשיש אינטרנט). המועד הקרוב: ${esc(licDate(act.nextDue))}.</p>`
      : act.readOnly ? `<p class="bad">⏸ אין חיבור לשרת הרישוי יותר מ-30 יום — אפשר לצפות, לייצא ולגבות. בלי חיבור עד ${esc(licDate(act.lockAt))} המערכת תינעל. במחשב מסונן — בקשו מספק הסינון היתר לכתובת שרת הרישוי.</p>`
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
    if (act.dueSoon) return { kind: 'expiring', icon: '⏰', title: 'נדרש חיבור לשרת', detail: `יש להתחבר לשרת הרישוי עד ${licDate(act.nextDue)} — אחרת המערכת תעבור לצפייה בלבד.` };
    return { kind: 'active', icon: '✔', title: 'הרישיון פעיל', detail: st.expiresAt ? `בתוקף עד ${licDate(st.expiresAt)}.` : 'המערכת פעילה.' };
  }
  // סיום — קריאה בלבד (סעיף 8 בהסכם הרישיון), אלא אם יש גם נעילה (כמו isReadOnly ב-gate.js)
  const readOnly = ['pending_payment', 'suspended', 'trial_ended', 'offline'].includes(st.status)
    || (st.status === 'terminated' && !(st.reasons || []).some(x => x && x.kind === 'locked'));
  const r = (st.reasons || [])[0];
  const title = st.status === 'trial_ended' ? 'תקופת הניסיון הסתיימה'
    : st.status === 'terminated' ? (readOnly ? 'השימוש במערכת הסתיים — צפייה בלבד' : 'השימוש במערכת הסתיים')
      : st.status === 'offline' ? LIC_STATUS.offline
        : readOnly ? 'צפייה בלבד — ' + (LIC_STATUS[st.status] || st.status) : 'המערכת נעולה';
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
    const act = st.activation || {};
    const lock = st.status === 'offline' && act.lockAt ? [`בלי חיבור עד ${licDate(act.lockAt)} המערכת תינעל לגמרי (עד אז — צפייה, ייצוא וגיבוי).`] : [];
    return r.step === 'server'
      ? [remoteOn ? 'התחברו לאינטרנט ולחצו "התחברות לשרת עכשיו" בכרטיס "הפעלת המערכת".' : 'יש להגדיר שרת רישוי בהגדרות המתקדמות ("עבודה מרחוק").',
        'במחשב מסונן (נטפרי וכדומה) — בקשו מספק הסינון היתר לכתובת שרת הרישוי.', ...lock]
      : ['הרישיון השנתי חסר או שפג. פנו לספק לחידוש.', install];
  }
  if (st.status === 'pending_payment') return r.source === 'billing' ? ['תוקף הרישיון הסתיים. פנו לספק לחידוש.', install] : ['יש להסדיר את התשלום מול הספק.', sync];
  if (st.status === 'suspended') return ['המערכת הושבתה זמנית על ידי הספק או המערכת שמעליה. פנו אליהם לבירור.', sync];
  if (st.status === 'terminated') return ['השימוש במערכת הסתיים. אפשר לצפות בנתונים, לייצא אותם ולגבות. לפרטים — פנו לספק.'];
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
  const signupCard = showSignup ? renderSignupCard(d.signup, licOnAndroid(d)) : '';
  const advanced = `${isAdmin ? renderRemoteCard(d.remote, st) : ''}${myCard}${childCard}${isAdmin ? renderOwnerPanel(d.owner, d.inbox, d.remote, d.releases, d.ownerOffer, d.signups, d.ownerPayment) : ''}`;
  const advOpen = st.mode === 'unlicensed' || !!(d.owner && d.owner.unlocked);
  return `<div class="settings">${renderStatusCard(st, d)}${licCertWarning(d)}${renderActivationCard(st.activation, d)}${signupCard}${renderUpdateCard(d.update, isAdmin)}
    <details class="lic-advanced"${advOpen ? ' open' : ''}><summary>הגדרות מתקדמות — פרטי הרישיון, שרת, מערכות בת</summary>${advanced}</details></div>`;
}

// הרשמה: מערכת חדשה בוחרת תכנית, חותמת על התקנון ומשלמת בדף המאובטח של חברת הסליקה
const SIGNUP_STATUS = { pending: 'ממתין לתשלום', failed: 'התשלום לא הושלם', submitted: 'ההרשמה התקבלה — הרישיון יגיע בסנכרון' };
// אנדרואיד — לפי מצב העדכונים (update:getStatus → platform). שם אין פתיחת דף תשלום ואין התקנת עדכון מהתוכנה
const licOnAndroid = (d) => !!(d && d.update && d.update.platform === 'android');
const LIC_PAY_DESKTOP_ONLY = '<p class="muted">באנדרואיד אין מעבר לדף התשלום — התשלום נפתח רק בגרסת המחשב.</p>';
function renderSignupCard(su, android = false) {
  return `<div class="card signup-card">
    <h3>📝 הרשמה למערכת</h3>
    ${su ? `<div class="acct-row"><span>תכנית</span><span>${esc(su.planName)} · ${esc(agorotText(su.priceAgorot))}</span></div>
      <div class="acct-row"><span>מצב</span><span>${esc(SIGNUP_STATUS[su.status] || su.status)}</span></div>
      ${su.status === 'pending' && android ? LIC_PAY_DESKTOP_ONLY : ''}
      <div class="acct-actions">
        ${su.status === 'pending' ? (android ? '' : '<button class="primary" id="signupPayBtn">💳 מעבר לתשלום מאובטח</button>') + '<button class="secondary" id="signupCheckBtn">🔄 בדיקת מצב התשלום</button>' : ''}
        ${su.status === 'submitted' ? '<button class="primary" id="licRemoteSyncBtn2">🔄 סנכרון — קבלת הרישיון</button>' : ''}
        ${su.status !== 'submitted' ? '<button class="secondary" id="signupStartBtn">הרשמה מחדש</button>' : ''}
      </div>`
    : `<p>בחירת תכנית, חתימה על התקנון ותשלום — הכול מכאן. בסיום הרישיון מגיע אוטומטית.</p>
      <div class="acct-actions"><button class="primary" id="signupStartBtn">📝 התחלת הרשמה</button></div>${android ? LIC_PAY_DESKTOP_ONLY : ''}`}
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
      err.setAttribute('role', 'alert'); // שגיאה מוקראת מיד (r4 נגישות)
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
  // באנדרואיד אין הורדה (רק שרת הרישוי), אין בחירת קובץ ואין הפעלת מתקין (update:install) — ה-APK מותקן ידנית
  const android = u.platform === 'android';
  return `<div class="card update-card">
    <div class="acct-header"><h3>🔄 עדכוני גרסה</h3>
      ${isAdmin && !android ? '<div class="acct-actions"><button class="secondary small" id="updFileBtn">📂 התקנה מקובץ (USB)</button></div>' : ''}
    </div>
    <div class="acct-row"><span>גרסה מותקנת</span><span dir="ltr">${esc(u.currentVersion)}</span></div>
    ${av ? `<div class="acct-row"><span>גרסה חדשה זמינה</span><span><b dir="ltr">${esc(av.version)}</b> <small class="muted">(${esc(licDate(av.issuedAt))})</small></span></div>
      ${av.notes ? `<p class="update-notes">${esc(av.notes)}</p>` : ''}
      ${isAdmin && android ? '<p class="muted">באנדרואיד מתקינים את קובץ ה-APK של הגרסה החדשה ידנית — ההורדה וההתקנה מכאן זמינות רק בגרסת המחשב.</p>'
      : isAdmin ? `<div class="acct-actions">
        ${ready ? '<button class="primary" id="updInstallBtn">⬆ התקנת הגרסה עכשיו</button>'
          : (av.url ? '<button class="primary" id="updDownloadBtn">⬇ הורדה ובדיקה</button>' : '<span class="muted">לעדכון הזה אין קישור — התקינו מקובץ</span>')}
      </div>` : '<p class="muted">ההתקנה — על ידי מנהל המערכת.</p>'}`
    : '<p class="muted">המערכת מעודכנת. עדכונים מגיעים בסנכרון עם השרת, או מקובץ.</p>'}
    <p class="muted">כל עדכון חתום על ידי הספק ונבדק לפני ההתקנה — קובץ שאינו תואם לחתימה נדחה.</p>
  </div>`;
}

// תפוגת התעודה של שרת הרישוי (סקירת אבטחה 24.10.2026, ממצא 4): אחרי התפוגה הסנכרון כבר לא מאריך את ההפעלה, וכל
// המערכות ננעלות 30 יום אחר כך. אזהרה מ-60 יום לפני — למנהל המערכת, ולמנהל-העל (במצב פתוח) עם מה לעשות
const LIC_CERT_WARN_DAYS = 60;
function licCertWarning(d, now = Date.now()) {
  const exp = d && d.isAdmin && d.remote ? Number(d.remote.certExpiresAt) : 0;
  if (!exp || !Number.isFinite(exp)) return '';
  const days = Math.ceil((exp - now) / (24 * 60 * 60 * 1000));
  if (days > LIC_CERT_WARN_DAYS) return '';
  const when = days > 0 ? `תפוג בעוד ${days} ימים (${licDate(exp)})` : `פגה ב-${licDate(exp)}`;
  const what = d.owner && d.owner.unlocked
    ? 'יש להנפיק תעודה חדשה למפתח השרת (relay-cert) ולהתקין אותה בשרת — docs/LICENSING-ACTIVATION.md, שלב 7, "חידוש". בלי זה כל המערכות יינעלו 30 יום אחרי התפוגה.'
    : 'בלי חידוש התעודה אצל הספק, המערכת תינעל 30 יום אחרי התפוגה. פנו לספק התוכנה.';
  return `<div class="ss-card ss-card-warning lic-cert-warn" role="alert"><p><b>⚠ התעודה של שרת הרישוי ${esc(when)}.</b> ${esc(what)}</p></div>`;
}

// עבודה מרחוק: כשמוגדר שרת רישוי, הבקשות, האישורים והעדכונים עוברים בלחיצה — בלי להעביר קבצים
function renderRemoteCard(r, st) {
  if (!r) return '';
  const pending = Array.isArray(r.pending) ? r.pending : [];
  const canIssue = st.mode === 'licensed' && st.status === 'active' && st.limits && st.limits.maxChildren > 0;
  // תקופת ניסיון היא mode 'licensed' בלי רישיון — גם בה שולחים בקשה דרך השרת (25.10.2026)
  const hasLicense = st.mode === 'licensed' && !st.trial;
  return `<div class="card">
    <div class="acct-header"><h3>🌐 עבודה מרחוק</h3>
      <div class="acct-actions"><button class="secondary small" id="licRemoteSetBtn">${r.url ? 'שינוי שרת' : 'הגדרת שרת רישוי'}</button></div>
    </div>
    ${r.url ? `
      <div class="acct-row"><span>שרת</span><span dir="ltr">${esc(r.url)}</span></div>
      <div class="acct-row"><span>סנכרון אחרון</span><span>${r.lastSync ? esc(new Date(r.lastSync).toLocaleString('he-IL')) : 'עדיין לא'}</span></div>
      ${r.checkinError ? `<div class="acct-row"><span>אימות השרת</span><span>⚠ ${esc(r.checkinError)}</span></div>` : ''}
      ${r.pendingLicense ? `<div class="ss-card ss-card-warning" role="alert"><p><b>⚠ התקבל רישיון ממערכת מנפיקה אחרת${r.pendingLicense.name ? ` („${esc(r.pendingLicense.name)}")` : ''}.</b>
        הוא לא הותקן: התקנתו תעביר את המערכת לניהול של המנפיק החדש. יש לוודא מול הספק לפני ההתקנה.</p>
        <div class="acct-actions"><button class="secondary small" id="licPendingInstallBtn">התקנת הרישיון שהתקבל</button></div></div>` : ''}
      ${r.myCode ? `<div class="acct-row"><span>קוד המערכת (למערכות בת)</span><span dir="ltr"><b>${esc(r.myCode)}</b></span></div>` : ''}
      <div class="acct-actions">
        <button class="primary" id="licRemoteSyncBtn">🔄 סנכרון עכשיו</button>
        ${hasLicense ? '' : '<button class="secondary" id="licRemoteRequestBtn">📤 שליחת בקשת רישיון לספק</button>'}
        ${hasLicense ? '' : '<button class="secondary" id="licRemoteParentBtn">📤 בקשה ממערכת מנפיקה (קוד)</button>'}
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
      <p class="muted">השרת משמש רק להעברה: כל רישיון, אישור ועדכון חתומים, והתוכנה בודקת אותם בעצמה. בלי חיבור — הכול ממשיך לעבוד, ואת אישור החיבור (פעם ב-30 יום) מעבירים בקובץ:</p>
      <ol class="muted">
        <li>במחשב בלי חיבור: "שמירת בקשת אישור" — לדיסק-און-קי.</li>
        <li>במחשב מחובר עם SuperSuite: "העברת בקשה של מחשב אחר" — בוחרים את הבקשה ושומרים את האישור.</li>
        <li>במחשב בלי חיבור: "טעינת אישור" — בוחרים את קובץ האישור. אותו קובץ טוב עד 14 יום מיום הבקשה.</li>
      </ol>
      <div class="acct-actions">
        <button class="secondary" id="licOfflineReqBtn">💾 שמירת בקשת אישור</button>
        <button class="secondary" id="licOfflineRelayBtn">🔁 העברת בקשה של מחשב אחר</button>
        <button class="secondary" id="licOfflineImportBtn">📥 טעינת אישור</button>
      </div>`
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
function renderOwnerPanel(o, inbox, remote, releases, ownerOffer, signups, ownerPayment) {
  if (!o) return '';
  if (!o.initialized) {
    return `<div class="card"><h3>מצב מנהל-העל</h3>
      <p class="muted">${o.rootConfigured
        ? 'לספק התוכנה בלבד: העברת מפתח מנהל-העל למחשב הזה מקודי השחזור או מהגיבוי המלא.'
        : 'למנהל-העל (הספק) בלבד: יצירת מפתח שורש שממנו מונפקים כל הרישיונות. המפתח נשמר מוצפן בסיסמה במחשב הזה.'}</p>
      <div class="acct-actions">${o.rootConfigured ? '' : '<button class="secondary" id="ownerInitBtn">🔑 הגדרת מצב מנהל-העל</button>'}
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
      <thead><tr><th>#</th><th>לקוח</th><th>תוכנה</th><th>מצב</th><th>בתוקף עד</th><th>מכסות</th><th></th></tr></thead>
      <tbody>${tenants.map(t => `<tr>
        <td>${Number(t.slot)}</td><td><b>${esc(t.name)}</b></td>
        <td>${esc(licProductName(o.products, t.product))}${t.bundleId ? '<br><small class="muted">בחבילה</small>' : ''}</td>
        <td>${licBadge(t.status)}${(t.holds || []).map(h => `<br><small>${esc(LIC_HOLD_KINDS[h.kind] || h.kind)}: ${esc(h.reason)}</small>`).join('')}</td>
        <td>${esc(licDate(t.expiresAt))}</td><td><small>${esc(licLimits(t.limits))}</small></td>
        <td>
          ${(t.holds || []).map(h => `<button class="secondary small" data-owner-release="${esc(t.id)}" data-hold="${esc(h.holdId)}">החזרה לפעילות</button>`).join('')}
          <button class="secondary small" data-owner-hold="${esc(t.id)}">השבתה</button>
          <button class="secondary small" data-owner-notices="${esc(t.id)}" data-name="${esc(t.name)}">קובץ עדכון</button>
          ${t.status === 'terminated' ? '' : `<button class="danger-outline" data-owner-terminate="${esc(t.id)}">סיום</button>`}
        </td></tr>
        ${(t.children || []).map(c => `<tr class="${c.revoked ? 'muted' : ''}">
          <td></td><td>↳ ${esc(c.name)} <small class="muted">(מערכת בת ${Number(c.slot)})</small></td><td></td>
          <td>${c.revoked || c.terminated ? licBadge('terminated') : ((c.holds || []).length ? licBadge((c.holds[0] || {}).kind) : '<span class="muted">לפי הלקוח</span>')}</td>
          <td><small>אושרה ${esc(licDate(c.approvedAt))}</small></td><td></td>
          <td>${c.revoked ? '' : `
            ${(c.holds || []).map(h => `<button class="secondary small" data-owner-release="${esc(c.id)}" data-hold="${esc(h.holdId)}">החזרה</button>`).join('')}
            <button class="secondary small" data-owner-hold="${esc(c.id)}">השבתה</button>
            <button class="danger-outline" data-owner-revoke="${esc(c.id)}">ביטול אישור</button>`}</td>
        </tr>`).join('')}`).join('') || '<tr><td colspan="7" class="muted">עדיין לא הונפקו רישיונות. לקוח חדש: "פתיחת בקשה מלקוח"</td></tr>'}</tbody>
    </table></div>
    ${renderOwnerBundles(o.bundles, o.products)}
    <p class="muted">שינוי סטטוס נכנס לתוקף אצל הלקוח כשהוא מקבל "קובץ עדכון" (או בהתקנת רישיון מחודש). השבתה של לקוח משביתה גם את כל מערכות הבת שלו.</p>
    ${renderOwnerSignups(ownerOffer, signups, remote, ownerPayment, o.products)}
    ${renderOwnerReleases(releases, remote)}
  </div>`;
}

// חבילות ששולמו (תכנית שמכסה כמה תוכנות): מה כבר הונפק ומה מחכה לבקשה מהתוכנה
function renderOwnerBundles(bundles, cat) {
  const list = Array.isArray(bundles) ? bundles : [];
  if (!list.length) return '';
  return `<h4>חבילות ששולמו</h4>
    <div class="acct-scroll"><table class="acct-table">
      <thead><tr><th>לקוח</th><th>תכנית</th><th>הונפק</th><th>ממתין לבקשה מהתוכנה</th></tr></thead>
      <tbody>${list.map(b => `<tr><td><b>${esc(b.customer)}</b></td><td>${esc(b.planName)}<br><small class="muted">${esc(b.scopeName || licScopeName(cat, b.scope))}</small></td>
        <td><small>${b.products.filter(p => b.issued && b.issued[p]).map(p => esc(licProductName(cat, p))).join(', ') || '—'}</small></td>
        <td><small>${(b.pending || []).map(p => esc(licProductName(cat, p))).join(', ') || '<span class="ok">הכול הונפק</span>'}</small></td></tr>`).join('')}</tbody>
    </table></div>
    <p class="muted">בקשה שמגיעה מתוכנה בחבילה — "הנפקה" ובחירה "לפי חבילה ששולמה": התחומים, המכסות והתקופה כפי ששולמו, בלי תשלום נוסף.</p>`;
}

// אימות התשלום של הרשמה מול Cardcom (במחשב של מנהל-העל) — שורת מצב בטבלה
const PAY_CHECK = { verified: ['ok', '✔ אומת מול Cardcom'], mismatch: ['bad', '✖ לא תואם'], unpaid: ['bad', '✖ לא שולם'], unavailable: ['muted', '⚠ לא נבדק'] };
function signupPayCheckHtml(x) {
  const c = x && x.paymentCheck;
  const p = x && x.payment;
  // האישור החתום של שרת הרישוי (נבדק בקליטת ההרשמה). הרשמה מלפני האישור החתום — בלי השדה, ובלי שורה
  const signed = !p || !(p.amountAgorot > 0) || typeof p.verified !== 'boolean' ? ''
    : p.verified ? '<br><small class="ok">✔ אישור חתום של שרת הרישוי</small>' : '<br><small class="bad">⚠ בלי אישור חתום של שרת הרישוי</small>';
  if (!c || !PAY_CHECK[c.status]) return signed;
  const [cls, label] = PAY_CHECK[c.status];
  return signed + `<br><small class="${cls}" title="${esc(c.message || '')}">${label}</small>${c.status === 'verified' ? '' : '<br><small>' + esc(c.message || '') + '</small>'}`;
}
// הרשמה בתשלום, בלי חשבונית ובלי אימות מוצלח — נבדקת מול Cardcom לפני ההנפקה
const signupNeedsCheck = (x, cardcomOn) => !!(cardcomOn && x && x.payment && x.payment.amountAgorot > 0 && !x.invoice
  && !(x.paymentCheck && x.paymentCheck.status === 'verified'));
// פרטי המסוף של Cardcom — רק "מוגדר" ומספר המסוף (שם ה-API לא יוצא מהתהליך הראשי)
function renderOwnerCardcom(p) {
  const c = p && p.cardcom;
  if (!c) return '';
  return `<div class="acct-row"><span>💳 אימות תשלומים מול Cardcom: ${c.configured
    ? `<b>מוגדר</b> (מסוף <span dir="ltr">${esc(c.terminal)}</span>) — לפני הנפקה בתשלום התוכנה בודקת את העסקה ב-Cardcom`
    : '<b>לא מוגדר</b> — לפני הנפקה בתשלום יש לבדוק את התשלום במערכת חברת הסליקה ולאשר ידנית'}</span>
    <span><button class="secondary small" id="ownerCardcomBtn">${c.configured ? '✎ עדכון פרטי המסוף' : '＋ הגדרת פרטי המסוף'}</button>
    ${c.configured ? '<button class="secondary small danger" id="ownerCardcomClearBtn">הסרה</button>' : ''}</span></div>`;
}

function renderOwnerSignups(offer, list, remote, payment, cat) {
  if (!offer || !Array.isArray(offer.plans) || !offer.terms) offer = null;
  const rows = (Array.isArray(list) ? list : []).slice().reverse();
  const cardcomOn = !!(payment && payment.cardcom && payment.cardcom.configured);
  return `<div class="acct-header"><h4>הרשמה, תכניות ותקנון</h4>
      <div class="acct-actions"><button class="secondary small" id="ownerOfferBtn">${offer ? '✎ עריכת תכניות ותקנון' : '＋ הגדרת תכניות ותקנון'}</button>
      ${offer && remote && remote.url ? '<button class="primary small" id="ownerOfferPublishBtn">📤 פרסום בשרת</button>' : ''}</div></div>
    ${offer ? `<p class="muted">תקנון גרסה ${esc(offer.terms.version)} · ${offer.plans.map(p => esc(p.name) + ' ' + esc(agorotText(p.priceAgorot)) + (p.scope ? ' (' + esc(licScopeName(cat, p.scope)) + ')' : '')).join(' · ')}</p>` : '<p class="muted">עדיין לא הוגדרו תכניות. מערכות חדשות יוכלו להירשם ולשלם אחרי פרסום בשרת.</p>'}
    ${renderOwnerCardcom(payment)}
    ${rows.length ? `<div class="acct-scroll"><table class="acct-table">
      <thead><tr><th>התקבלה</th><th>לקוח</th><th>תכנית</th><th>תשלום</th><th>מצב</th><th></th></tr></thead>
      <tbody>${rows.map(x => `<tr><td><small>${esc(new Date(x.receivedAt).toLocaleString('he-IL'))}</small></td>
        <td><b>${esc(x.customer.org)}</b><br><small>${esc(x.customer.contact)} · <span dir="ltr">${esc(x.customer.phone)}</span></small></td>
        <td>${esc(x.planName)}${x.product ? '<br><small class="muted">' + esc(licProductName(cat, x.product)) + (x.bundle ? ' · ' + esc(licScopeName(cat, x.bundle.scope)) : '') + '</small>' : ''}</td><td>${x.payment ? esc(agorotText(x.payment.amountAgorot)) + '<br><small dir="ltr">' + esc(x.payment.providerRef || '') + '</small>' + signupPayCheckHtml(x) : 'ללא תשלום'}</td>
        <td>${x.status === 'issued' ? '<span class="ok">הונפק</span>' : x.status === 'review' ? '<b>לבדיקה</b><br><small>' + esc(x.problem || '') + '</small>' : '<b>חדשה</b>'}${x.invoice ? `<br><small>חשבונית ${Number(x.invoice.number)}</small>` : ''}</td>
        <td>${x.status === 'issued' ? '' : `<button class="primary small" data-owner-signup-issue="${esc(x.id)}"${signupNeedsCheck(x, cardcomOn) ? ' data-owner-verify-first="1"' : ''}>✔ הנפקה ושליחה</button>`}
          ${cardcomOn && x.status !== 'issued' && x.payment && x.payment.amountAgorot > 0 && !x.invoice ? `<button class="secondary small" data-owner-signup-verify="${esc(x.id)}">🔍 בדיקת התשלום ב-Cardcom</button>` : ''}
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

// עורך תכניות ותקנון (מנהל-העל) — מרכז הרישוי: לכל תכנית היקף (תוכנה אחת, חבילת משפחה או כל התוכנות) ותחומים
// לכל תוכנה בהיקף. נשמרת הצעה ראשית אחת, וממנה נחתמת הצעה לכל תוכנה (shell/licensing/offer.js — splitMaster).
// editions — { choices, templates } מ-owner:offerEditions: מהדורה (shell/edition.js; ריק = כל המהדורות) היא מאפיין של
// התכנית ב-SuperSuite בלבד, ולכן נבחרת רק בתכנית שההיקף שלה כולל את SuperSuite; ו"תכנית אחת לכל מוצר" — בלי מחיר,
// הבעלים מקליד
const LIC_THIS_PRODUCT = 'supersuite';
// תכנית מגרסה קודמת: features מערך ובלי scope — של SuperSuite
const licPlanFeatures = (p) => (Array.isArray(p.features) ? { [LIC_THIS_PRODUCT]: p.features } : { ...(p.features || {}) });
function offerEditor(cur, cat, editions) {
  const edChoices = (editions && Array.isArray(editions.choices)) ? editions.choices : [];
  const edTemplates = (editions && Array.isArray(editions.templates)) ? editions.templates : [];
  return openDialog((card, finish) => {
    card.style.maxWidth = '760px';
    const fresh = (n) => ({ id: n > 1 ? 'plan' + n : 'basic', name: n > 1 ? '' : 'בסיסי', priceAgorot: 0, months: 12, scope: LIC_THIS_PRODUCT,
      features: { [LIC_THIS_PRODUCT]: ['econ'] }, limits: { maxUsers: 3, maxChildren: 0 } });
    const plans = (cur && cur.plans ? cur.plans : [fresh(1)])
      .map(p => ({ ...p, scope: p.scope || LIC_THIS_PRODUCT, features: licPlanFeatures(p), limits: { ...p.limits } }));
    const scopes = licScopes(cat).length ? licScopes(cat) : [{ id: LIC_THIS_PRODUCT, name: 'SuperSuite', products: [LIC_THIS_PRODUCT] }];
    const scopeProducts = (s) => (scopes.find(x => x.id === s) || { products: [] }).products;
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
          const i = document.createElement('input'); i.type = type || 'text'; i.value = val == null || Number.isNaN(val) ? '' : val; l.append(sp, i); fsx.appendChild(l); return i; };
        const out = { id: f('מזהה (אנגלית)', p.id), name: f('שם', p.name), desc: f('תיאור', p.desc), price: f('מחיר ב-₪ (0 = חינם)', p.priceAgorot == null ? '' : p.priceAgorot / 100, 'number'),
          months: f('תקופה (חודשים)', p.months, 'number'), users: f('משתמשים', p.limits.maxUsers, 'number'), children: f('מערכות בת', p.limits.maxChildren, 'number'), feats: [] };
        // היקף: תוכנה אחת או חבילה. שינוי ההיקף מצייר מחדש את התחומים (מה שסומן נשמר)
        const sl = document.createElement('label'); sl.className = 'field';
        const ssp = document.createElement('span'); ssp.textContent = 'תוכנה / חבילה';
        const sel = document.createElement('select');
        for (const s of scopes) { const op = document.createElement('option'); op.value = s.id; op.textContent = s.name; sel.appendChild(op); }
        sel.value = p.scope;
        sl.append(ssp, sel); fsx.appendChild(sl);
        sel.onchange = () => { collect(); plans[idx].scope = sel.value; render(); };
        out.scope = sel;
        // מהדורה — רק בתכנית שכוללת את SuperSuite (לתוכנות האחרות אין מהדורות; השרת דוחה מהדורה בתכנית אחרת)
        if (edChoices.length && scopeProducts(p.scope).includes(LIC_THIS_PRODUCT)) {
          const l = document.createElement('label'); l.className = 'field'; const sp = document.createElement('span'); sp.textContent = 'מהדורה של SuperSuite (התוכנה שבה התכנית מוצעת)';
          const esel = document.createElement('select');
          for (const [val, label] of [['', 'כל המהדורות'], ...edChoices.map(c => [c.id, c.name])]) {
            const o = document.createElement('option'); o.value = val; o.textContent = label; esel.appendChild(o);
          }
          esel.value = p.edition || '';
          l.append(sp, esel); fsx.appendChild(l); out.edition = esel;
        }
        for (const pid of scopeProducts(p.scope)) {
          const box = document.createElement('div'); box.className = 'checks';
          box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'תחומים — ' + licProductName(cat, pid));
          if (scopeProducts(p.scope).length > 1) { const h = document.createElement('b'); h.textContent = licProductName(cat, pid) + ':'; box.appendChild(h); }
          for (const [val, label] of licProductFeatures(cat, pid)) { const l = document.createElement('label'); const c = document.createElement('input'); c.type = 'checkbox'; c.value = val; c.dataset.product = pid;
            c.checked = (p.features[pid] || []).includes(val);
            l.append(c, document.createTextNode(' ' + label)); box.appendChild(l); out.feats.push(c); }
          fsx.appendChild(box);
        }
        return out;
      });
      const add = document.createElement('button'); add.type = 'button'; add.className = 'secondary small'; add.textContent = '＋ תכנית נוספת';
      add.onclick = () => { collect(); plans.push(fresh(plans.length + 1)); render(); };
      card.appendChild(add);
      if (edTemplates.length) {
        const addEd = document.createElement('button'); addEd.type = 'button'; addEd.className = 'secondary small'; addEd.textContent = '＋ תכנית אחת לכל מוצר (עמותות, נדל"ן, חשבונאות)';
        addEd.onclick = () => {
          collect();
          // התבנית במבנה של תכנית SuperSuite (features מערך) — כאן היא הופכת לתכנית של ההצעה הראשית: היקף SuperSuite
          for (const t of edTemplates) if (!plans.some(p => p.id === t.id)) plans.push({ ...t, scope: LIC_THIS_PRODUCT, features: licPlanFeatures(t), limits: { ...t.limits } });
          render();
        };
        card.appendChild(addEd);
      }
      const tv = mk('גרסת התקנון (למשל 1.0) — שינוי נוסח מחייב גרסה חדשה', cur && cur.terms ? cur.terms.version : '1.0');
      const tt = mk('כותרת התקנון', cur && cur.terms ? cur.terms.title : 'תקנון ותנאי שימוש');
      const tx = mk('נוסח התקנון המלא', cur && cur.terms ? cur.terms.text : '', 'textarea');
      tx.rows = 12;
      const err = document.createElement('div'); err.className = 'bad'; err.setAttribute('role', 'alert');
      const actions = document.createElement('div'); actions.className = 'modal-actions';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = 'ביטול'; cancel.onclick = () => finish(null);
      const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'primary'; ok.textContent = 'חתימה ושמירה';
      // שדה מספרי ריק ← NaN ולא 0: מחיר ריק לא הופך בשקט לתכנית חינם
      const num = (el) => (String(el.value).trim() === '' ? NaN : Number(el.value));
      function collect() {
        inputs.forEach((x, i) => { Object.assign(plans[i], { id: x.id.value.trim(), name: x.name.value.trim(), desc: x.desc.value.trim(),
          priceAgorot: Math.round(num(x.price) * 100), months: num(x.months), scope: x.scope.value,
          features: Object.fromEntries(scopeProducts(x.scope.value).map(pid => [pid, x.feats.filter(c => c.checked && c.dataset.product === pid).map(c => c.value)])),
          limits: { ...plans[i].limits, maxUsers: num(x.users), maxChildren: num(x.children), maxDepth: num(x.children) > 0 ? 2 : 1 } });
          // מהדורה: נשמרת רק כשההיקף כולל את SuperSuite. היקף שהוחלף לתוכנה אחרת — המהדורה נמחקת מהתכנית.
          // בלי רשימת מהדורות (העורך נפתח בלי owner:offerEditions) — מהדורה קיימת בתכנית נשארת כמו שהיא
          if (!scopeProducts(x.scope.value).includes(LIC_THIS_PRODUCT)) delete plans[i].edition;
          else if (x.edition) { if (x.edition.value) plans[i].edition = x.edition.value; else delete plans[i].edition; } });
      }
      ok.onclick = () => {
        collect();
        const bad = plans.findIndex(p => !Number.isSafeInteger(p.priceAgorot) || p.priceAgorot < 0 || !Number.isInteger(p.months)
          || !Number.isInteger(p.limits.maxUsers) || p.limits.maxUsers < 0 || !Number.isInteger(p.limits.maxChildren) || p.limits.maxChildren < 0);
        if (bad >= 0) { err.textContent = `תכנית ${bad + 1}: יש להקליד מחיר (0 = חינם), תקופה, משתמשים ומערכות בת — מספרים שלמים`; return; }
        err.textContent = '';
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
      <div class="acct-actions"><button class="small" id="ownerModelSignBtn">חתימת מודל AI</button> <button class="primary small" id="ownerReleaseBtn">＋ שחרור גרסה חדשה</button></div></div>
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
