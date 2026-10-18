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
  today: document.getElementById('today'),
  addBtn: document.getElementById('addBtn'),
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
  'npo': 'עמותה — תרומות, קרנות ותמיכות',
  'gemach': 'גמ"ח — הלוואות, ערבים והפקדות',
  'chesed': 'חסד וחלוקות — נזקקים, מתנדבים וסבבי חלוקה',
  'people': 'מאגר אנשים — כרטיס אחד לכל אדם',
  'settings': 'הגדרות ומשתמשים — ייבוא/ייצוא ויומן ביקורת',
  'licensing': 'רישוי ומערכות — רישיון, מערכות בת ומנהל-העל',
  'messages': 'הודעות — תקשורת מאובטחת בין המערכות',
  'collect': 'גבייה וקישורי תשלום',
  'personal-finance': 'התוכנית הפיננסית — הגדרה ופריטים',
  'tasks': 'משימות',
  'contacts': 'אנשי קשר',
  'fitness': 'כושר ובריאות',
  'voice-notes': 'הערות קוליות',
  'canvas': 'לוח לבן',
  'acct-reports': 'דוחות כספיים ומע"מ',
  'acct-journal': 'יומן חשבונאי',
  'acct-invoices': 'חשבוניות מס',
  'acct-chart': 'תוכנית חשבונות',
  'acct-settings': 'הגדרות עסק ומע"מ',
  'acct-pricing': 'מחירון ומחשבון תמחור',
  'acct-personal': 'הוצאות אישיות ומשפחתיות',
  'acct-bank': 'התאמת בנק'
};

// Initialize application
async function init() {
  try {
    // בתוך התוכנה המאוחדת: הניווט כולו בסרגל של המעטפת, והסרגל הפנימי מוסתר
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('embedded') === '1') {
      document.documentElement.classList.add('embedded');
    }
    // בקשת מעבר מהסרגל האחיד. לפני כניסה — נשמרת ונפתחת מיד אחרי הכניסה
    if (typeof window.systemAPI.onGoto === 'function') {
      window.systemAPI.onGoto(view => {
        if (!Object.prototype.hasOwnProperty.call(viewTitles, view)) return;
        if (state.user) switchView(view); else state.requestedView = view;
      });
    }
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
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
    elements.addBtn.addEventListener('click', () => handleAdd());
    elements.userBtn.addEventListener('click', () => handleUser());
    elements.backupBtn.addEventListener('click', () => handleBackup());
    elements.restoreBtn.addEventListener('click', () => handleRestore());
    elements.closeModal.addEventListener('click', closeModal);
    elements.cancelBtn.addEventListener('click', closeModal);
    elements.submitBtn.addEventListener('click', handleSubmit);

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
    await switchView(start);
    showToast('מערכת מאוחדת נטענה בהצלחה');
  } catch (error) {
    showError('שגיאה באתחול המערכת: ' + errMsg(error));
  }
}

// Switch between views
async function switchView(viewName) {
  try {
    state.currentView = viewName;
    state.loading = true;
    state.error = null;

    // Update navigation
    elements.navButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    // Update title
    elements.pageTitle.textContent = viewTitles[viewName] || viewName;

    // סימון התצוגה בסרגל האחיד (גם כשהמעבר התחיל מקישור פנימי בלוח הבקרה)
    if (typeof window.systemAPI.reportView === 'function') {
      Promise.resolve(window.systemAPI.reportView(viewName)).catch(() => {});
    }

    // Clear view
    elements.view.innerHTML = '<div class="loading">טוען...</div>';

    // Load view data
    await loadViewData(viewName);

    // Render view
    renderView(viewName);

    state.loading = false;
  } catch (error) {
    state.loading = false;
    state.error = error.message;
    showError('שגיאה בטעינת התצוגה: ' + error.message);
  }
}

// Load data for current view
async function loadViewData(viewName) {
  try {
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
      case 'mortgage-lab':
        state.data.mortgageLab = await window.systemAPI.getMortgageLab();
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
        state.data.licensing = { status, isAdmin, children, owner, remote, inbox, update, releases, signup, ownerOffer, signups };
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
      case 'tasks':
        state.data.tasks = await window.systemAPI.getTasks();
        break;
      case 'contacts':
        state.data.contacts = await window.systemAPI.getContacts();
        break;
      case 'fitness':
        state.data.fitness = await window.systemAPI.getFitnessData();
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
  const [finance, tasks, marketIntel, accounting, invoices, products, brief] = await Promise.all([
    window.systemAPI.getPersonalFinance().catch(() => null),
    window.systemAPI.getTasks().catch(() => null),
    window.systemAPI.getMarketIntel().catch(() => null),
    window.systemAPI.getAccountingReports({ from: yearStart(), to: today() }).catch(() => null),
    window.systemAPI.getInvoices().catch(() => []),
    window.systemAPI.getProducts().catch(() => []),
    // לוח הבוקר (עמותה, גמ"ח, חסד) — תחום סגור ברישיון או תקלה לא מפילים את מסך הבית
    typeof window.systemAPI.getMorningBrief === 'function' ? window.systemAPI.getMorningBrief().catch(() => null) : null
  ]);
  return { finance, tasks, marketIntel, accounting, invoices, products, brief };
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
  'npo': 'npo',
  'gemach': 'gemach',
  'chesed': 'chesed',
  'people': 'people',
  'settings': 'settings',
  'personal-finance': 'personalFinance',
  'tasks': 'tasks',
  'contacts': 'contacts',
  'fitness': 'fitness',
  'voice-notes': 'voiceNotes',
  'canvas': 'canvas',
  'acct-reports': 'acctReports',
  'acct-journal': 'acctJournal',
  'acct-invoices': 'acctInvoices',
  'acct-chart': 'acctChart',
  'acct-settings': 'acctSettings',
  'acct-pricing': 'acctPricing',
  'acct-personal': 'acctPersonal',
  'acct-bank': 'acctBank'
};

// Render current view
function renderView(viewName) {
  elements.view.classList.toggle('royal', String(viewName).startsWith('acct-') || viewName === 'dashboard');
  const data = state.data[DATA_KEYS[viewName] || viewName];
  let html = '';

  switch (viewName) {
    case 'dashboard':
      html = renderDashboard(data);
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
    case 'fitness':
      html = renderFitness(data);
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
    default:
      html = '<div class="empty">לא נמצאו נתונים</div>';
  }

  const ports = PORT_VIEWS[viewName];
  if (ports) html = renderPortsBar(ports) + html;
  elements.view.innerHTML = html;
  attachViewHandlers(viewName);
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

// הוספת רשימה ריקה — הודעה ידידותית במקום מסך ריק
function renderEmpty(message) {
  return `<div class="empty">${message}</div>`;
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
