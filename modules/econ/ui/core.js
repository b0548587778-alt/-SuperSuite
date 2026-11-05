// ממשק המודול הכלכלי — ליבה: מצב, רכיבי DOM, כותרות, אתחול, מעבר בין תצוגות וטעינת נתונים.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

// State management
const state = {
  currentView: 'dashboard',
  user: null,
  data: {},
  loading: false,
  error: null,
  editingId: null,
  fieldValuesBackup: null,
  subForm: null
};

// DOM references
const elements = {
  view: document.getElementById('view'),
  pageTitle: document.getElementById('pageTitle'),
  pageHelp: document.getElementById('pageHelp'),
  announcer: document.getElementById('srAnnounce'),
  today: document.getElementById('today'),
  addBtn: document.getElementById('addBtn'),
  wizardBtn: document.getElementById('wizardBtn'),
  helpBtn: document.getElementById('helpBtn'),
  helpPanel: document.getElementById('helpPanel'),
  userBtn: document.getElementById('userBtn'),
  backupBtn: document.getElementById('backupBtn'),
  restoreBtn: document.getElementById('restoreBtn'),
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modalTitle'),
  modalForm: document.getElementById('modalForm'),
  submitBtn: document.getElementById('submitBtn'),
  cancelBtn: document.getElementById('cancelBtn'),
  closeModal: document.getElementById('closeModal'),
  toastContainer: document.getElementById('toastContainer'),
  alertContainer: document.getElementById('alertContainer'),
  navButtons: document.querySelectorAll('.nav')
};

// View titles mapping
const viewTitles = {
  'dashboard': 'לוח בקרה',
  'finance': 'תכנון פיננסי — תמונת מצב',
  'business': 'עסקים ולקוחות',
  'market-intel': 'מודיעין שוק',
  'mortgage': 'משכנתאות והלוואות',
  'mortgage-advisor': 'ייעוץ משכנתאות — תיקי לקוחות',
  'mortgage-lab': 'מעבדת תמהיל — סימולטור, סלים, מחזור ואופטימייזר',
  'realty': 'נדל"ן ותיווך — נכסים, לקוחות ועסקאות',
  'realestate': 'שמאות מקרקעין — תיקי שומה',
  'npo': 'עמותה — תרומות, קרנות ותמיכות',
  'gemach': 'גמ"ח — הלוואות, ערבים והפקדות',
  'chesed': 'חסד וחלוקות — נזקקים, מתנדבים וסבבי חלוקה',
  'people': 'מאגר אנשים — כרטיס אחד לכל אדם',
  'settings': 'הגדרות ומשתמשים — ייבוא/ייצוא ויומן ביקורת',
  'licensing': 'רישוי ומערכות — רישיון, מערכות בת ומנהל-העל',
  'messages': 'הודעות — תקשורת מאובטחת בין המערכות',
  'ai': 'שאל את התוכנה — עוזר מקומי על נתוני החשבונות, העמותה והשמאות',
  'collect': 'גבייה וקישורי תשלום',
  'personal-finance': 'התוכנית הפיננסית — הגדרה ופריטים',
  'tasks': 'משימות',
  'contacts': 'אנשי קשר',
  'voice-notes': 'הערות קוליות',
  'canvas': 'לוח לבן',
  'acct-reports': 'דוחות כספיים ומע"מ',
  'acct-journal': 'יומן חשבונאי',
  'acct-invoices': 'חשבוניות מס',
  'acct-chart': 'תוכנית חשבונות',
  'acct-settings': 'הגדרות עסק ומע"מ',
  'acct-pricing': 'מחירון ומחשבון תמחור',
  'acct-personal': 'הוצאות אישיות ומשפחתיות',
  'acct-bank': 'התאמת בנק',
  'biz-reports': 'תזרים צפוי, כרטסת לקוחות ומקדמות'
};

// נגישות ושפה פשוטה (r4): "מה עושים כאן" — משפט אחד לכל מסך, ומה לוחצים קודם.
// מוצג מתחת לכותרת (#pageHelp), ונמסר גם כ-data-ss-help לבועת "?" של המעטפת
const VIEW_HELP = {
  'dashboard': 'כאן רואים במבט אחד מה קורה: הכנסות, משימות ומה דורש טיפול היום. לחצו על כרטיס כדי לעבור למסך שלו.',
  'ai': 'כאן כותבים שאלה במילים פשוטות (למשל "כמה תרומות היו החודש?") ומקבלים תשובה מהנתונים שלכם. הכול נשאר במחשב.',
  'finance': 'כאן רואים תמונת מצב של הכסף המשפחתי: הכנסות, הוצאות וחיסכון. את הפריטים עצמם מוסיפים במסך "התוכנית הפיננסית".',
  'business': 'כאן שומרים תוכניות לעסק: עלות הקמה והכנסה צפויה. להתחלה — לחצו "＋ הוספת רשומה".',
  'acct-reports': 'כאן רואים את הדוחות של העסק: כמה נכנס, כמה יצא, וכמה מע"מ לשלם. לבחירת חודשים אחרים — "החלף תקופה".',
  'biz-reports': 'כאן רואים כמה כסף צפוי להיכנס ולצאת בחודשים הקרובים, מי חייב לכם כסף, וכמה מקדמות מס לשלם.',
  'acct-journal': 'כאן רושמים הכנסה או הוצאה שאינן חשבונית שהוצאתם — למשל קבלה מספק. להתחלה — לחצו "＋ הוספת רשומה".',
  'collect': 'כאן שולחים ללקוח בקשת תשלום עם קישור לתשלום, ורואים מי כבר שילם.',
  'acct-invoices': 'כאן מוציאים חשבונית ללקוח, רואים מי שילם ומדפיסים. להתחלה — לחצו "＋ הוספת רשומה" ומלאו שם לקוח, פריט וסכום.',
  'acct-bank': 'כאן משווים את דף הבנק לרישומים שלכם. להתחלה — "📥 קליטת דף בנק" (קובץ CSV שמורידים מאתר הבנק).',
  'acct-chart': 'רשימת "הקופות" של הנהלת החשבונות (חשבונות). בדרך כלל אין צורך לשנות כאן דבר.',
  'acct-settings': 'כאן ממלאים את פרטי העסק שיודפסו על החשבוניות, ואת סוג העוסק (מורשה או פטור). כדאי למלא לפני החשבונית הראשונה.',
  'acct-pricing': 'כאן שומרים מוצרים ושירותים עם מחיר קבוע, כדי לבחור אותם מהר בחשבונית. המחשבון עוזר לקבוע מחיר.',
  'acct-personal': 'כאן רושמים הוצאות והכנסות של הבית והמשפחה — בנפרד מהעסק. להתחלה — לחצו "＋ הוספת רשומה".',
  'market-intel': 'כאן שומרים מידע על השוק: ידיעות, דוחות והערות. להתחלה — לחצו "＋ הוספת רשומה".',
  'mortgage': 'כאן מחשבים הלוואה או משכנתא: כמה תשלמו כל חודש וכמה בסך הכול. להתחלה — לחצו "＋ הוספת רשומה".',
  'mortgage-advisor': 'כאן מנהלים תיקי לקוחות של ייעוץ משכנתאות: פרטים, מסלולים, מסמכים ותשלום.',
  'mortgage-lab': 'כאן בונים ומשווים תמהילי משכנתא בפירוט. מסך למתקדמים — לחישוב פשוט השתמשו ב"משכנתאות והלוואות".',
  'realty': 'כאן מנהלים נכסים, לקוחות ועסקאות בתיווך. בחרו לשונית למעלה (נכסים, לקוחות, עסקאות) ואז "＋ הוספת רשומה".',
  'realestate': 'כאן מכינים שומת מקרקעין (הערכת שווי של דירה או נכס) ומדפיסים דוח.',
  'npo': 'כאן רושמים תרומות ומוציאים קבלות לתורמים. להתחלה — לחצו "＋ הוספת רשומה" ומלאו שם תורם וסכום.',
  'gemach': 'כאן מנהלים את הגמ"ח: הלוואות, ערבים, החזרים והפקדות. להתחלה — לחצו "＋ הוספת רשומה".',
  'chesed': 'כאן מנהלים נזקקים, מתנדבים וסבבי חלוקה. להתחלה — הוסיפו נזקק, ואחר כך פתחו סבב חלוקה.',
  'people': 'כאן מחפשים אדם ורואים במקום אחד את כל מה שקשור אליו: תרומות, הלוואות וחלוקות. הקלידו שם או מספר זהות.',
  'personal-finance': 'כאן מגדירים את התוכנית הפיננסית של המשפחה: הכנסות, הוצאות, חסכונות והלוואות. להתחלה — "＋ הוספת רשומה".',
  'tasks': 'כאן רושמים דברים שצריך לעשות ומסמנים כשסיימתם. להתחלה — לחצו "＋ הוספת רשומה".',
  'contacts': 'כאן שומרים אנשי קשר: שם, טלפון וכתובת. להתחלה — לחצו "＋ הוספת רשומה".',
  'voice-notes': 'כאן שומרים הערות ורשימות קצרות. להתחלה — לחצו "＋ הוספת רשומה".',
  'canvas': 'כאן שומרים לוחות לרעיונות ולתכנון. להתחלה — לחצו "＋ הוספת רשומה".',
  'settings': 'כאן קובעים הגדרות כלליות, מוסיפים משתמשים ומעבירים נתונים מקובץ או אל קובץ.',
  'licensing': 'כאן רואים אם הרישיון פעיל ומה לעשות אם לא. בדרך כלל אין צורך להיכנס לכאן.',
  'messages': 'כאן קוראים ושולחים הודעות בין המערכות של הארגון.'
};

// בקשה מהמעטפת: תצוגה, או משימה מתיבת "מה תרצה לעשות?" ({ view, task, prefill } — shell/tasks.js).
// econStartTask (אם קיים) פותח את הטופס מלא מראש ו**לא שומר** — המשתמש בודק ושומר בעצמו; אחרת — התצוגה בלבד
function openShellRequest(req) {
  if (req.task && typeof window.econStartTask === 'function') return window.econStartTask(req.task, req.prefill || {}, req.view);
  return switchView(req.view, { focus: true });
}

// Initialize application
async function init() {
  try {
    // בתוך התוכנה המאוחדת: הניווט כולו בסרגל של המעטפת, והסרגל הפנימי מוסתר
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('embedded') === '1') {
      document.documentElement.classList.add('embedded');
    }
    // בקשת מעבר מהסרגל האחיד. לפני כניסה — נשמרת ונפתחת מיד אחרי הכניסה
    if (typeof window.systemAPI.onGoto === 'function') {
      window.systemAPI.onGoto(msg => {
        const req = typeof msg === 'string' ? { view: msg } : msg;
        if (!req || !Object.prototype.hasOwnProperty.call(viewTitles, req.view)) return;
        if (state.user) openShellRequest(req);
        else { state.requestedView = req.view; state.requestedTask = req.task ? req : null; }
      });
    }
    // אשף "צעד אחר צעד" לבקשה מהמעטפת (openShellRequest) — הקלט לא מהימן ונבדק שוב ב-sanitizePrefill (ui/wizards.js)
    window.econStartTask = econStartTask;
    // פגישה שפגה בשקט: הממשק עוד "מחובר" — מציגים שוב את מסך הכניסה
    if (typeof window.systemAPI.onAuthCheck === 'function') {
      window.systemAPI.onAuthCheck(async () => {
        if (!state.user) return; // מסך הכניסה כבר מוצג
        const st = await window.systemAPI.authStatus().catch(() => null);
        if (st && !st.user) {
          // מסתירים את הנתונים שעל המסך לפני חלון הכניסה (PLAN.md 3.3)
          if (elements.view) elements.view.innerHTML = '';
          maybeRelogin('נדרשת כניסה');
        }
      });
    }

    elements.today.textContent = new Date().toLocaleDateString('he-IL', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    // רישום הכפתורים קודם — גם אם מסך ההתחברות נכשל, הממשק נשאר מגיב
    elements.navButtons.forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view, { focus: true }));
    });
    elements.addBtn.addEventListener('click', () => handleAdd());
    if (elements.wizardBtn) elements.wizardBtn.addEventListener('click', () => { if (elements.wizardBtn.dataset.task) econStartTask(elements.wizardBtn.dataset.task); });
    attachHelpButton();
    elements.userBtn.addEventListener('click', () => handleUser());
    elements.backupBtn.addEventListener('click', () => handleBackup());
    elements.restoreBtn.addEventListener('click', () => handleRestore());
    elements.closeModal.addEventListener('click', closeModal);
    elements.cancelBtn.addEventListener('click', closeModal);
    elements.submitBtn.addEventListener('click', handleSubmit);
    // Enter בטופס עם שדה אחד שולח GET ומרענן את המודול (הנתונים ו-?embedded=1 אובדים) — בולמים.
    // גם ה-CSP חוסם (form-action 'none'); השמירה — בכפתור
    if (elements.modalForm) elements.modalForm.addEventListener('submit', (e) => e.preventDefault());
    watchViewA11y();

    // מסך כניסה: לא ממשיכים בלי משתמש מחובר
    const authStatus = await window.systemAPI.authStatus();
    if (authStatus.user) state.user = authStatus.user;
    while (!state.user) {
      if (!authStatus.configured) {
        await setupAdmin();
      } else {
        await loginUser();
      }
    }

    let start = 'dashboard';
    try { const adv = await window.systemAPI.getAdvancedSettings(); if (adv && adv.startView) start = adv.startView; } catch { /* ברירת מחדל */ }
    // תצוגה שנבחרה בסרגל האחיד לפני הכניסה גוברת על מסך הפתיחה
    if (state.requestedView) { start = state.requestedView; state.requestedView = null; }
    const task = state.requestedTask && state.requestedTask.view === start ? state.requestedTask : null;
    state.requestedTask = null;
    await switchView(start);
    if (task) await openShellRequest(task);
    showToast('מערכת מאוחדת נטענה בהצלחה');
  } catch (error) {
    showError('שגיאה באתחול המערכת: ' + errMsg(error));
  }
}

// התוכנית הפיננסית וההוצאות האישיות — למנהל בלבד, גם צפייה (requiresAdmin ב-ipc.js). למשתמש אחר — הודעה, בלי פנייה לשרת
const ADMIN_ONLY_VIEWS = ['personal-finance', 'finance', 'acct-personal'];
function isAdminUser() {
  return !!(state.user && Array.isArray(state.user.permissions) && state.user.permissions.includes('users.manage'));
}

// Switch between views
// opts.focus — המעבר התחיל בלחיצה של המשתמש: המיקוד עובר לכותרת המסך, וקורא המסך מקריא אותה (r4 נגישות)
async function switchView(viewName, opts = {}) {
  // מונה מעברים: טעינה איטית של מסך קודם לא מתרנדרת מעל מסך שנפתח אחריה
  const seq = state.viewSeq = (state.viewSeq || 0) + 1;
  try {
    state.currentView = viewName;
    state.loading = true;
    state.error = null;
    // חלון העזרה שייך למסך הקודם
    toggleHelp(false);

    // Update navigation
    elements.navButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
      if (btn.dataset.view === viewName) btn.setAttribute('aria-current', 'page');
      else if (btn.removeAttribute) btn.removeAttribute('aria-current');
    });

    // Update title
    elements.pageTitle.textContent = viewTitles[viewName] || viewName;
    setPageHelp(viewName);

    // סימון התצוגה בסרגל האחיד (גם כשהמעבר התחיל מקישור פנימי בלוח הבקרה)
    if (typeof window.systemAPI.reportView === 'function') {
      Promise.resolve(window.systemAPI.reportView(viewName)).catch(() => {});
    }

    if (ADMIN_ONLY_VIEWS.includes(viewName) && !isAdminUser()) {
      elements.view.innerHTML = renderEmpty('למנהל המערכת בלבד — התוכנית הפיננסית וההוצאות האישיות והמשפחתיות פתוחות רק למנהל');
      elements.addBtn.disabled = true;
      elements.addBtn.hidden = true;
      state.loading = false;
      return;
    }

    // Clear view — "טוען" מוקרא (aria-busy על אזור התוכן)
    elements.view.innerHTML = '<div class="loading" role="status">טוען… רגע אחד</div>';
    if (elements.view.setAttribute) elements.view.setAttribute('aria-busy', 'true');

    // Load view data
    await loadViewData(viewName);
    if (seq !== state.viewSeq) return;

    // Render view
    renderView(viewName);
    if (elements.view.removeAttribute) elements.view.removeAttribute('aria-busy');
    if (opts.focus) focusPageTitle();

    state.loading = false;
  } catch (error) {
    if (seq !== state.viewSeq) return;
    state.loading = false;
    state.error = errMsg(error);
    // במקום "טוען…" שנשאר לעד: הסבר במסך עצמו וכפתור "נסו שוב" (r4 נגישות)
    if (elements.view && elements.view.setAttribute) {
      elements.view.removeAttribute('aria-busy');
      elements.view.innerHTML = '<div role="alert">' +
        renderEmpty('המסך לא נפתח — ' + esc(state.error) + '. אפשר ללחוץ "נסו שוב"; אם זה חוזר — סגרו ופתחו את התוכנה.', '⚠') +
        '<button type="button" class="primary empty-add" data-view-retry>נסו שוב</button></div>';
      const retry = elements.view.querySelector && elements.view.querySelector('[data-view-retry]');
      if (retry) retry.addEventListener('click', () => switchView(viewName, { focus: true }));
    }
    showError('שגיאה בטעינת התצוגה: ' + errMsg(error));
  }
}

// הסבר "מה עושים כאן" מתחת לכותרת, וגם data-ss-help לבועת "?" של המעטפת
function setPageHelp(viewName) {
  const help = VIEW_HELP[viewName] || '';
  const el = elements.pageHelp;
  if (el) { el.textContent = help; el.hidden = !help; }
  if (elements.pageTitle && elements.pageTitle.setAttribute) {
    if (help) elements.pageTitle.setAttribute('data-ss-help', help);
    else if (elements.pageTitle.removeAttribute) elements.pageTitle.removeAttribute('data-ss-help');
  }
}

// מיקוד בכותרת המסך אחרי מעבר — המשתמש במקלדת מתחיל מראש המסך, וקורא המסך מקריא את שמו
function focusPageTitle() {
  const t = elements.pageTitle;
  if (!t || typeof t.focus !== 'function') return;
  if (t.setAttribute) t.setAttribute('tabindex', '-1');
  t.focus();
}

// Load data for current view
async function loadViewData(viewName) {
  try {
    // נתוני דוגמה (1.5): המצב מתעדכן בכל כניסה למסך שבו הם מופיעים
    if (SAMPLE_VIEWS.includes(viewName)) await refreshSampleStatus();
    switch (viewName) {
      case 'dashboard':
        state.data.dashboard = await loadDashboardData();
        break;
      case 'finance':
        state.data.finance = await loadFinanceData();
        break;
      case 'business':
        state.data.business = await loadBusinessData();
        break;
      case 'market-intel':
        state.data.marketIntel = await window.systemAPI.getMarketIntel();
        break;
      case 'mortgage':
        state.data.mortgage = await window.systemAPI.getMortgageScenarios();
        break;
      case 'personal-finance':
        state.data.personalFinance = await window.systemAPI.getPersonalFinance();
        break;
      case 'mortgage-advisor':
        state.data.mortgageAdvisor = await window.systemAPI.getMortgageAdvisor();
        break;
      case 'realestate':
        state.data.realEstate = await window.systemAPI.getRealEstate();
        break;
      case 'mortgage-lab':
        state.data.mortgageLab = await window.systemAPI.getMortgageLab();
        break;
      case 'realty':
        state.data.realty = await window.systemAPI.getRealty();
        break;
      case 'npo':
        state.data.npo = await window.systemAPI.getNpoOverview(npoYear());
        // הוראות קבע — כרטיס נפרד; כשל בטעינתן לא מפיל את מסך העמותה
        if (state.data.npo && typeof state.data.npo === 'object') {
          try { state.data.npo.standing = window.systemAPI.getNpoStandingOrders ? await window.systemAPI.getNpoStandingOrders() : null; }
          catch { state.data.npo.standing = null; }
          try { state.data.npo.memorials = window.systemAPI.getNpoMemorials ? await window.systemAPI.getNpoMemorials() : null; }
          catch { state.data.npo.memorials = null; }
        }
        break;
      case 'gemach':
        state.data.gemach = await window.systemAPI.getGemachOverview();
        state.data.gemachFull = [];
        break;
      case 'chesed':
        state.data.chesed = await window.systemAPI.getChesedOverview();
        break;
      case 'people':
        state.data.people = await window.systemAPI.searchPeople(state.peopleQuery || '');
        break;
      case 'settings': {
        const adv = await window.systemAPI.getAdvancedSettings();
        // ניהול משתמשים ויומן ביקורת — למנהל בלבד; למשתמש רגיל לא מבקשים כלל (השרת היה דוחה)
        const [users, audit] = adv && adv.isAdmin
          ? await Promise.all([window.systemAPI.listUsers(), window.systemAPI.listAudit({ limit: 100, action: state.auditFilter || '' })])
          : [[], []];
        let privacy = null;
        if (adv && adv.isAdmin && window.systemAPI.getPrivacyMap) { try { privacy = await window.systemAPI.getPrivacyMap(); } catch { privacy = null; } }
        const google = window.systemAPI.googleStatus ? await window.systemAPI.googleStatus().catch(() => null) : null;
        const googleCfg = adv && adv.isAdmin && window.systemAPI.getGoogleSettings ? await window.systemAPI.getGoogleSettings().catch(() => null) : null;
        state.data.settings = { ...adv, users, audit, privacy, google, googleCfg };
        break;
      }
      case 'licensing': {
        const status = await window.systemAPI.getLicenseStatus();
        const adv = await window.systemAPI.getAdvancedSettings();
        const isAdmin = !!(adv && adv.isAdmin);
        const [children, owner] = isAdmin
          ? await Promise.all([
            status.mode === 'licensed' ? window.systemAPI.listLicenseChildren().catch(() => []) : [],
            window.systemAPI.getOwnerState().catch(() => null)])
          : [[], null];
        const remote = isAdmin ? await window.systemAPI.getLicenseRemote().catch(() => null) : null;
        const inbox = isAdmin && owner && owner.unlocked ? await window.systemAPI.ownerInbox().catch(() => []) : [];
        const update = window.systemAPI.getUpdateStatus ? await window.systemAPI.getUpdateStatus().catch(() => null) : null;
        const releases = isAdmin && owner && owner.unlocked && window.systemAPI.ownerReleases ? await window.systemAPI.ownerReleases().catch(() => []) : [];
        // הרשמה (קניית רישיון): בלי רישיון מותקן — גם בתקופת ניסיון
        const signup = isAdmin && remote && remote.url && (status.mode !== 'licensed' || status.trial) ? await window.systemAPI.licenseSignupStatus().catch(() => null) : null;
        const ownerOffer = isAdmin && owner && owner.unlocked ? await window.systemAPI.ownerGetOffer().catch(() => null) : null;
        const signups = isAdmin && owner && owner.unlocked ? await window.systemAPI.ownerSignups().catch(() => []) : [];
        const ownerPayment = isAdmin && owner && owner.unlocked && window.systemAPI.ownerGetPaymentProvider ? await window.systemAPI.ownerGetPaymentProvider().catch(() => null) : null;
        state.data.licensing = { status, isAdmin, children, owner, remote, inbox, update, releases, signup, ownerOffer, signups, ownerPayment };
        break;
      }
      case 'collect':
        state.data.collect = await window.systemAPI.collectOverview();
        break;
      case 'messages': {
        const as = state.chatAs || '';
        let overview;
        const filter = state.chatFilter || 'all';
        try { overview = await window.systemAPI.chatOverview(as, filter); }
        catch (e) { if (as) { state.chatAs = ''; overview = await window.systemAPI.chatOverview('', filter); } else throw e; }
        const t = state.chatPeer ? await window.systemAPI.chatThread(state.chatPeer, state.chatAs || '') : null;
        const thread = Array.isArray(t) ? { messages: t, meta: {} } : (t || { messages: [], meta: {} });
        const owner = await window.systemAPI.getOwnerState().catch(() => null);
        const adv = await window.systemAPI.getAdvancedSettings().catch(() => null);
        let panel = null;
        if (state.chatPanel === 'settings' || state.chatPanel === 'broadcast') {
          panel = await window.systemAPI.chatGetSettings(state.chatAs || '').catch((e) => { showError(errMsg(e)); state.chatPanel = null; return null; });
        } else if (state.chatPanel === 'starred') {
          panel = { starred: await window.systemAPI.chatStarred(state.chatAs || '').catch(() => []) };
        }
        state.data.messages = { ...overview, thread: thread.messages || [], meta: thread.meta || {}, now: thread.now || Date.now(), panel,
          peer: state.chatPeer || null, as: state.chatAs || '', ownerUnlocked: !!(owner && owner.unlocked), isAdmin: !!(adv && adv.isAdmin) };
        break;
      }
      case 'ai': {
        // העוזר המקומי: המצב, התחומים הפתוחים ודוגמאות שאלות — במקביל, בלי רשת
        const [status, samples, prefs] = await Promise.all([
          window.systemAPI.aiStatus(),
          window.systemAPI.aiSample(),
          window.systemAPI.aiPrefsGet()
        ]);
        state.data.ai = { status, samples, prefs };
        break;
      }
      case 'tasks':
        state.data.tasks = await window.systemAPI.getTasks();
        break;
      case 'contacts':
        state.data.contacts = await window.systemAPI.getContacts();
        break;
      case 'voice-notes':
        state.data.voiceNotes = await window.systemAPI.getVoiceNotes();
        break;
      case 'canvas':
        state.data.canvas = await window.systemAPI.getCanvasBoards();
        break;
      case 'acct-reports': {
        const range = acctPeriod();
        const [reports, summary, analytics] = await Promise.all([
          window.systemAPI.getAccountingReports(range),
          window.systemAPI.getPeriodSummary(range),
          window.systemAPI.getInvoiceAnalytics()
        ]);
        state.data.acctReports = { ...reports, summary, analytics };
        break;
      }
      case 'acct-personal': {
        const [entries, summary] = await Promise.all([window.systemAPI.getPersonalEntries({}), window.systemAPI.getPersonalSummary({})]);
        state.data.acctPersonal = { entries, summary };
        break;
      }
      case 'acct-journal': {
        const [entries, chart] = await Promise.all([window.systemAPI.getJournal({}), window.systemAPI.getChart()]);
        state.data.acctJournal = { entries, chart };
        break;
      }
      case 'acct-invoices':
        {
          const [invoices, docs, recurring] = await Promise.all([window.systemAPI.getInvoices(), window.systemAPI.getSalesDocs(), window.systemAPI.getRecurring()]);
          state.data.acctInvoices = { invoices, docs, recurring };
        }
        break;
      case 'acct-bank': {
        const [bank, chart] = await Promise.all([window.systemAPI.getBankLines(), window.systemAPI.getChart()]);
        state.data.acctBank = { ...bank, chart };
        break;
      }
      case 'biz-reports':
        state.data.bizReports = await loadBizReports();
        break;
      case 'acct-chart':
        state.data.acctChart = await window.systemAPI.getChart();
        break;
      case 'acct-settings':
        state.data.acctSettings = await window.systemAPI.getAccountingSettings();
        break;
      case 'acct-pricing':
        state.data.acctPricing = await window.systemAPI.getProducts();
        break;
    }
  } catch (error) {
    console.error('Error loading view data:', error);
    throw error;
  }
}

// Load dashboard data
async function loadDashboardData() {
  const [finance, tasks, marketIntel, accounting, invoices, products, brief, biz] = await Promise.all([
    isAdminUser() ? window.systemAPI.getPersonalFinance().catch(() => null) : null,
    window.systemAPI.getTasks().catch(() => null),
    window.systemAPI.getMarketIntel().catch(() => null),
    window.systemAPI.getAccountingReports({ from: yearStart(), to: today() }).catch(() => null),
    window.systemAPI.getInvoices({ limit: 5 }).catch(() => []),
    window.systemAPI.getProducts().catch(() => []),
    // לוח הבוקר (עמותה, גמ"ח, חסד) — תחום סגור ברישיון או תקלה לא מפילים את מסך הבית
    typeof window.systemAPI.getMorningBrief === 'function' ? window.systemAPI.getMorningBrief().catch(() => null) : null,
    // תזרים, חייבים ותשלומים לרשויות (9.5) — בלי רישיון לחשבונות פשוט לא מוצג
    typeof window.systemAPI.getBizDashboard === 'function' ? window.systemAPI.getBizDashboard().catch(() => null) : null
  ]);
  return { finance, tasks, marketIntel, accounting, invoices, products, brief, biz };
}

// Load finance data
async function loadFinanceData() {
  return await window.systemAPI.getPersonalFinance();
}

// Load business data
async function loadBusinessData() {
  return await window.systemAPI.getBusinessPlans();
}

// מיפוי שם התצוגה למפתח הנתונים ב-state.data
// (חלק מהמפתחות שונים משם התצוגה — marketIntel, personalFinance, voiceNotes)
const DATA_KEYS = {
  'dashboard': 'dashboard',
  'finance': 'finance',
  'business': 'business',
  'market-intel': 'marketIntel',
  'mortgage': 'mortgage',
  'mortgage-advisor': 'mortgageAdvisor',
  'mortgage-lab': 'mortgageLab',
  'realty': 'realty',
  'realestate': 'realEstate',
  'npo': 'npo',
  'gemach': 'gemach',
  'chesed': 'chesed',
  'people': 'people',
  'settings': 'settings',
  'personal-finance': 'personalFinance',
  'tasks': 'tasks',
  'contacts': 'contacts',
  'voice-notes': 'voiceNotes',
  'canvas': 'canvas',
  'acct-reports': 'acctReports',
  'acct-journal': 'acctJournal',
  'acct-invoices': 'acctInvoices',
  'acct-chart': 'acctChart',
  'acct-settings': 'acctSettings',
  'acct-pricing': 'acctPricing',
  'acct-personal': 'acctPersonal',
  'acct-bank': 'acctBank',
  'biz-reports': 'bizReports',
  'ai': 'ai'
};

// Render current view
function renderView(viewName) {
  elements.view.classList.toggle('royal', String(viewName).startsWith('acct-') || viewName === 'dashboard' || viewName === 'biz-reports');
  const data = state.data[DATA_KEYS[viewName] || viewName];
  let html = '';

  switch (viewName) {
    case 'dashboard':
      // מצב פשוט: המסך מתחיל ב"מה יש לעשות היום" (ui/wizards.js)
      html = (isSimpleMode() && data && data.brief && data.brief.agenda ? renderAgenda(data.brief.agenda) : '') + renderSampleOffer() + renderDashboard(data);
      break;
    case 'finance':
      html = renderFinance(data);
      break;
    case 'business':
      html = renderBusiness(data);
      break;
    case 'market-intel':
      html = renderMarketIntel(data);
      break;
    case 'mortgage':
      html = renderMortgage(data);
      break;
    case 'personal-finance':
      html = renderPersonalFinance(data);
      break;
    case 'mortgage-advisor':
      html = renderMortgageAdvisor(data);
      break;
    case 'mortgage-lab':
      html = renderMortgageLab(data);
      break;
    case 'realty':
      html = renderRealty(data);
      break;
    case 'realestate':
      html = renderRealEstate(data);
      break;
    case 'npo':
      html = renderNpo(data);
      break;
    case 'gemach':
      html = renderGemach(data);
      break;
    case 'chesed':
      html = renderChesed(data);
      break;
    case 'people':
      html = renderPeople(data);
      break;
    case 'settings':
      html = renderSettings(data);
      break;
    case 'licensing':
      html = renderLicensing(data);
      break;
    case 'messages':
      html = renderMessages(data);
      break;
    case 'collect':
      html = renderCollect(data);
      break;
    case 'tasks':
      html = renderTasks(data);
      break;
    case 'contacts':
      html = renderContacts(data);
      break;
    case 'voice-notes':
      html = renderVoiceNotes(data);
      break;
    case 'canvas':
      html = renderCanvas(data);
      break;
    case 'acct-reports':
      html = renderAcctReports(data);
      break;
    case 'acct-journal':
      html = renderAcctJournal(data);
      break;
    case 'acct-invoices':
      html = renderAcctInvoices(data);
      break;
    case 'acct-chart':
      html = renderAcctChart(data);
      break;
    case 'acct-settings':
      html = renderAcctSettings(data);
      break;
    case 'acct-pricing':
      html = renderAcctPricing(data);
      break;
    case 'acct-personal':
      html = renderAcctPersonal(data);
      break;
    case 'acct-bank':
      html = renderAcctBank(data);
      break;
    case 'biz-reports':
      html = renderBizReports(data);
      break;
    case 'ai':
      html = renderAi(data);
      break;
    default:
      html = renderEmpty('לא נמצאו נתונים');
  }

  const ports = PORT_VIEWS[viewName];
  if (ports) html = renderPortsBar(ports) + html;
  html = renderSampleBanner(viewName) + html;
  elements.view.innerHTML = html;
  attachViewHandlers(viewName);
  elements.view.querySelectorAll('[data-empty-add]').forEach(b => b.addEventListener('click', () => handleAdd()));
  attachSampleHandlers(elements.view);
  labelIconButtons(elements.view);
  enhanceA11y(elements.view);
}

// נגישות (7.3): כפתור שכל התוכן שלו אייקון (🗑, ✎...) — הכותרת שלו הופכת לשם שקורא המסך מקריא
function labelIconButtons(root) {
  root.querySelectorAll('button[title]:not([aria-label])').forEach(b => {
    if (!/[֐-׿A-Za-z]{2,}/.test(b.textContent || '')) b.setAttribute('aria-label', b.getAttribute('title'));
  });
}

// ===== נגישות (r4): מעבר אחד על כל מסך שרונדר — מה שקורא מסך ומקלדת צריכים, בלי לגעת בכל מסך בנפרד =====
const cleanText = (el) => String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
// הכותרת הקרובה שמעל רכיב: בתוך הכרטיס / האזור שלו, אחרת כותרת המסך
function nearestHeading(el) {
  for (let box = el.parentNode; box && box.querySelector; box = box.parentNode) {
    const h = box.querySelector('h2, h3, h4, h5, legend, .ss-section-title');
    if (h && !el.contains(h) && cleanText(h)) return cleanText(h);
    if (box === elements.view) break;
  }
  return cleanText(elements.pageTitle);
}
let a11ySeq = 0;
function enhanceA11y(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  // טבלאות: שם לטבלה (מהכותרת שמעליה) ו-scope לכותרות העמודות והשורות
  root.querySelectorAll('table').forEach(t => {
    if (!t.querySelector('caption') && !t.getAttribute('aria-label') && !t.getAttribute('aria-labelledby')) t.setAttribute('aria-label', nearestHeading(t));
    t.querySelectorAll('th').forEach(th => {
      if (th.getAttribute('scope')) return;
      const row = th.parentNode;
      const inHead = !!(row && row.parentNode && row.parentNode.tagName === 'THEAD');
      // שורה שכולה כותרות = כותרות עמודה; th בודד בתחילת שורת נתונים = כותרת השורה
      const allTh = !!row && [...row.children].every(c => c.tagName === 'TH');
      th.setAttribute('scope', inHead || allTh ? 'col' : 'row');
    });
  });
  // שדה בלי תווית: שם מכותרת העמודה (בטבלת עריכה), מ-placeholder או מ-title
  root.querySelectorAll('input, select, textarea').forEach(f => {
    if (f.type === 'hidden' || f.getAttribute('aria-label') || f.getAttribute('aria-labelledby')) return;
    if (f.closest('label')) return;
    if (f.id && root.querySelector(`label[for="${String(f.id).replace(/"/g, '')}"]`)) return;
    let name = '';
    const td = f.closest('td');
    if (td && td.parentNode) {
      const row = td.parentNode;
      const idx = [...row.children].indexOf(td);
      const table = td.closest('table');
      const head = table && table.querySelector('thead tr');
      const col = head && head.children[idx] ? cleanText(head.children[idx]) : '';
      const first = row.children[0] && row.children[0] !== td ? cleanText(row.children[0]) : '';
      name = [col, first].filter(Boolean).join(' — ');
    }
    if (!name) name = f.getAttribute('placeholder') || f.getAttribute('title') || '';
    if (name) f.setAttribute('aria-label', name);
  });
  // כפתור אייקון שחוזר בכל שורה ("עריכה", "מחיקה") — השם כולל את השורה: "מחיקה — משה כהן"
  root.querySelectorAll('button[aria-label]').forEach(b => {
    if (b.dataset.a11yCtx) return;
    if (/[֐-׿A-Za-z]{2,}/.test(b.textContent || '')) return;
    const tr = b.closest('tr');
    const card = !tr && b.closest('.card, .ss-card, .ss-list-row');
    let ctx = '';
    if (tr && tr.children[0] && !tr.children[0].contains(b)) ctx = cleanText(tr.children[0]);
    else if (card) { const h = card.querySelector('h3, h4, strong, b'); ctx = h ? cleanText(h) : ''; }
    if (ctx && !b.getAttribute('aria-label').includes(ctx)) b.setAttribute('aria-label', b.getAttribute('aria-label') + ' — ' + ctx.slice(0, 60));
    b.dataset.a11yCtx = '1';
  });
  // כותרות: המסך מתחיל ב-h1 (#pageTitle); כותרות המסך מתחילות ברמה 2, בלי לדלג על רמות
  const heads = [...root.querySelectorAll('h2, h3, h4, h5, h6')];
  const levels = heads.map(h => Number(h.tagName.slice(1)));
  if (levels.length) {
    const min = Math.min(...levels);
    // רמה אפקטיבית: הקטנה ביותר הופכת ל-2, וכל רמה אחרת — לכל היותר אחת מעל הקודמת
    let prev = 1;
    heads.forEach((h, i) => {
      let lvl = levels[i] - (min - 2);
      if (lvl > prev + 1) lvl = prev + 1;
      if (lvl !== levels[i]) { h.setAttribute('role', 'heading'); h.setAttribute('aria-level', String(lvl)); }
      prev = lvl;
    });
  }
  // הסבר (data-ss-help) גם לקורא מסך, בלי תלות בבועת "?" של המעטפת
  root.querySelectorAll('[data-ss-help]').forEach(el => describeWithHelp(el));
  // רכיב לחיץ שאינו כפתור (data-goto על div וכו') — גם במקלדת
  root.querySelectorAll('[data-goto]:not(button):not(a), [data-clickable]').forEach(el => makeKeyboardClickable(el));
}
// חלק מהמסך שמתרנדר מחדש בלי renderView (תוצאות חיפוש, סיכום מחושב, פרטי תיק) — עובר את אותו מעבר נגישות.
// רק childList: השינויים של enhanceA11y עצמו הם מאפיינים, והוספת ההסבר הנסתר קורית פעם אחת לכל רכיב
function watchViewA11y() {
  if (typeof MutationObserver !== 'function' || !elements.view) return;
  let pending = false;
  const obs = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    const run = () => { pending = false; labelIconButtons(elements.view); enhanceA11y(elements.view); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else setTimeout(run, 0);
  });
  obs.observe(elements.view, { childList: true, subtree: true });
}
// הסבר נסתר-ויזואלית שמקושר ב-aria-describedby
function describeWithHelp(el) {
  const text = el.getAttribute('data-ss-help');
  if (!text || el.getAttribute('data-ss-help-linked')) return;
  const span = document.createElement('span');
  span.className = 'sr-only';
  span.id = 'ssHelp' + (++a11ySeq);
  span.textContent = text;
  // אחרי הרכיב (או אחרי התווית שעוטפת אותו) — לא בתוכו, כדי שלא ייכנס לשם עצמו
  const anchor = (el.closest && el.closest('label')) || el;
  if (!anchor.parentNode || typeof anchor.parentNode.insertBefore !== 'function') return;
  anchor.parentNode.insertBefore(span, anchor.nextSibling);
  const prev = el.getAttribute('aria-describedby');
  el.setAttribute('aria-describedby', (prev ? prev + ' ' : '') + span.id);
  el.setAttribute('data-ss-help-linked', '1');
}
function makeKeyboardClickable(el) {
  if (el.getAttribute('data-kb')) return;
  if (!el.getAttribute('role')) el.setAttribute('role', 'button');
  if (el.getAttribute('tabindex') === null) el.setAttribute('tabindex', '0');
  el.setAttribute('data-kb', '1');
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
  });
}

// הודעה לקורא המסך (אזור aria-live שקט) — בלי חלון ובלי טוסט
function announce(message) {
  const a = elements.announcer;
  if (!a) return;
  a.textContent = '';
  setTimeout(() => { a.textContent = String(message || ''); }, 30);
}

// תיבת חיפוש — מוצגת רק בתצוגות שתומכות בחיפוש
function renderSearchBox(placeholder) {
  const schema = formSchemas[state.currentView];
  if (!schema || !schema.search) return '';
  return `
    <div class="search-box">
      <input id="viewSearch" type="search" placeholder="${esc(placeholder)}" autocomplete="off">
    </div>
  `;
}

// כפתורי עריכה ומחיקה לכרטיס
function renderCardActions(id) {
  const schema = formSchemas[state.currentView];
  if (!schema) return '';
  const canEdit = !!schema.update;
  const canDelete = !!schema.remove;
  if (!canEdit && !canDelete) return '';
  return `
    <div class="card-actions">
      ${canEdit ? `<button class="icon-btn" data-action="edit" data-id="${id}" title="עריכה">✎</button>` : ''}
      ${canDelete ? `<button class="icon-btn danger" data-action="delete" data-id="${id}" title="מחיקה">🗑</button>` : ''}
    </div>
  `;
}

// רשימה ריקה (PLAN.md 7.2): אייקון, משפט, הסבר קצר ופעולה הבאה — במקום מסך ריק.
// message — טקסט קבוע מהקוד (לא קלט משתמש). "כותרת — הסבר" מתפצל לשתי שורות;
// הזכרה של "＋ הוספת רשומה" בתצוגה שיש לה טופס ← כפתור אמיתי (data-empty-add).
function emptyIcon(view) {
  const btn = [...(elements.navButtons || [])].find(b => b.dataset && b.dataset.view === view);
  const icon = btn && btn.firstChild && String(btn.firstChild.textContent || '').trim();
  // הטקסט נקרא מהסרגל — עובר esc לפני שהוא נכנס ל-HTML
  return esc(icon || '📭');
}
function renderEmpty(message, icon) {
  const raw = String(message);
  const [title, ...rest] = raw.split(' — ');
  let hint = rest.join(' — ');
  // "לחץ ... כדי להתחיל" — הכפתור עצמו אומר את זה
  if (/^לחץ "＋ הוספת רשומה" כדי להתחיל$/.test(hint) && formSchemas[state.currentView]) hint = '';
  const canAdd = /＋ הוספת רשומה/.test(raw) && !!formSchemas[state.currentView];
  return `<div class="empty"><div class="empty-icon" aria-hidden="true">${icon || emptyIcon(state.currentView)}</div>` +
    `<div class="empty-title">${title}</div>${hint ? `<div class="empty-hint">${hint}</div>` : ''}` +
    `${canAdd ? '<button type="button" class="primary empty-add" data-empty-add>＋ הוספת רשומה</button>' : ''}</div>`;
}

// איתור רשומה לפי מזהה בנתונים הטעונים של התצוגה הנוכחית
function findRecordById(id) {
  const data = state.data[DATA_KEYS[state.currentView] || state.currentView];
  if (!data) return null;

  // תצוגות שמחזירות אובייקט עם מערך פנימי
  const wrappers = {
    'tasks': 'tasks',
    'contacts': 'contacts',
    'business': 'plans',
    'market-intel': 'entries',
    'mortgage': 'scenarios',
    'mortgage-advisor': 'clients',
    'voice-notes': 'notes',
    'canvas': 'boards'
  };
  const key = wrappers[state.currentView];
  const list = key ? data[key] : data;

  if (!Array.isArray(list)) return null;
  return list.find(r => r.id === id) || null;
}

// Render dashboard view

// מטבע זר בתרומות ובהפקדות לגמ"ח (core/currency.js): שלושה שדות לטופס. ההמרה לשקלים רק בשרת
const CURRENCY_FIELDS = [
  { name: 'currency', label: 'מטבע', type: 'select', options: [
    { value: 'ILS', label: '₪ שקל' }, { value: 'USD', label: '$ דולר' }, { value: 'EUR', label: '€ אירו' }, { value: 'GBP', label: '£ לירה שטרלינג' }] },
  { name: 'foreignAmount', label: 'סכום במטבע הזר (רק כשהמטבע אינו שקל)', type: 'number' },
  { name: 'rate', label: 'שער: כמה שקלים ל-1 יחידה (רק כשהמטבע אינו שקל)', type: 'number' }
];
const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£' };
// הערה קטנה ליד סכום בשקלים: "1,000.00 $"
function currencyNote(f) {
  if (!f || !CURRENCY_SYMBOLS[f.currency]) return '';
  const n = (Number(f.amountMinor) / 100).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return ` <small class="muted" title="שער ${esc(Number(f.rateE4) / 10000)}">${esc(n)} ${CURRENCY_SYMBOLS[f.currency]}</small>`;
}
