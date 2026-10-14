// Unified UI Renderer - Connects to systemAPI and renders all 11 views
(function() {
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
    'settings': 'הגדרות מתקדמות, משתמשים וייבוא/ייצוא',
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
    'acct-personal': 'הוצאות אישיות ומשפחתיות'
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
          }
          break;
        case 'gemach':
          state.data.gemach = await window.systemAPI.getGemachOverview();
          state.data.gemachFull = [];
          break;
        case 'chesed':
          state.data.chesed = await window.systemAPI.getChesedOverview();
          break;
        case 'settings': {
          const adv = await window.systemAPI.getAdvancedSettings();
          // ניהול משתמשים ויומן ביקורת — למנהל בלבד; למשתמש רגיל לא מבקשים כלל (השרת היה דוחה)
          const [users, audit] = adv && adv.isAdmin
            ? await Promise.all([window.systemAPI.listUsers(), window.systemAPI.listAudit({ limit: 100, action: state.auditFilter || '' })])
            : [[], []];
          state.data.settings = { ...adv, users, audit };
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
          state.data.acctInvoices = { invoices: await window.systemAPI.getInvoices() };
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
    const [finance, tasks, marketIntel, accounting, invoices, products] = await Promise.all([
      window.systemAPI.getPersonalFinance().catch(() => null),
      window.systemAPI.getTasks().catch(() => null),
      window.systemAPI.getMarketIntel().catch(() => null),
      window.systemAPI.getAccountingReports({ from: yearStart(), to: today() }).catch(() => null),
      window.systemAPI.getInvoices().catch(() => []),
      window.systemAPI.getProducts().catch(() => [])
    ]);
    return { finance, tasks, marketIntel, accounting, invoices, products };
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
    'acct-personal': 'acctPersonal'
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
      case 'settings':
        html = renderSettings(data);
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
        <input id="viewSearch" type="search" placeholder="${placeholder}" autocomplete="off">
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
  function renderDashboard(data) {
    const finance = data?.finance;
    const tasks = data?.tasks;
    const marketIntel = data?.marketIntel;
    // דוח חשבונאי חלקי לא מפיל את מסך הבית — מנורמל לאותה צורה מלאה כמו בדוחות.
    const acc = data?.accounting ? normalizeAcctReports(data.accounting) : null;
    const invoices = (Array.isArray(data?.invoices) ? data.invoices : []).slice(0, 5);
    const cash = acc ? (acc.balanceSheet.assets.find(a => a.code === '1000')?.amount || 0) : 0;
    const quick = [
      ['acct-reports', '📈', 'דוחות ומע"מ'], ['acct-journal', '📒', 'יומן חשבונאי'],
      ['acct-invoices', '🧾', 'חשבוניות מס'], ['acct-pricing', '🏷', 'מחירון ותמחור'],
      ['acct-chart', '🗂', 'תוכנית חשבונות'], ['acct-settings', '🏢', 'הגדרות עסק']
    ];

    return `
      <div class="dashboard">
        ${acc ? `
        <section class="hub">
          <div class="hub-head">
            <div>
              <h2>לוח הבקרה של העסק</h2>
              <small>שנת ${new Date().getFullYear()} · עד ${esc(acc.period.to)}${acc.lockDate ? ` · תקופה נעולה עד ${esc(acc.lockDate)}` : ''}</small>
            </div>
            <span class="hub-badge ${acc.balanceSheet.balanced && acc.trialBalance.balanced ? 'ok' : 'bad'}">${acc.balanceSheet.balanced && acc.trialBalance.balanced ? '✓ הספרים מאוזנים' : '⚠ יש בעיית איזון'}</span>
          </div>
          <div class="kpis">
            <div class="kpi"><small>יתרת בנק</small><strong>${money(cash)}</strong></div>
            <div class="kpi"><small>הכנסות מתחילת השנה</small><strong>${money(acc.incomeStatement.totalRevenue)}</strong></div>
            <div class="kpi ${acc.incomeStatement.netProfit < 0 ? 'neg' : 'pos'}"><small>רווח נקי</small><strong>${money(acc.incomeStatement.netProfit)}</strong></div>
            <div class="kpi"><small>חייבים פתוחים</small><strong>${money(acc.openInvoices)}</strong></div>
            <div class="kpi ${acc.vat.netPayable > 0 ? 'neg' : 'pos'}"><small>${acc.vat.netPayable >= 0 ? 'מע"מ לתשלום' : 'מע"מ לזיכוי'}</small><strong>${money(Math.abs(acc.vat.netPayable))}</strong></div>
            <div class="kpi"><small>מוצרים במחירון</small><strong>${(data.products || []).length}</strong></div>
          </div>
          <div class="hub-grid">
            <div class="card">
              <h3>חשבוניות אחרונות</h3>
              ${invoices.length === 0 ? '<p class="muted">עדיין אין חשבוניות</p>' : invoices.map(i => `
                <div class="acct-row"><span>${esc(i.number)} · ${esc(i.customer)}</span><span>${money(i.total)} <small class="muted">${esc({open:'פתוחה',paid:'שולמה',cancelled:'בוטלה'}[i.status] || '')}</small></span></div>`).join('')}
              <button class="secondary" data-goto="acct-invoices">לכל החשבוניות</button>
            </div>
            <div class="card">
              <h3>מסכים מהירים</h3>
              <div class="quick">${quick.map(([v, ic, label]) => `<button class="quick-btn" data-goto="${v}"><span>${ic}</span>${esc(label)}</button>`).join('')}</div>
            </div>
          </div>
        </section>` : ''}
        <section class="modules">
          <h3 class="modules-title">מודולים נוספים בחבילה</h3>
          <div class="modules-grid">
            <button class="module-card" data-module="shamai"><span class="module-ic">💎</span><strong>שמאי</strong><small>תיקי שומה והערכות</small></button>
            <button class="module-card" data-module="trainer"><span class="module-ic">🏋️</span><strong>TrainerPro</strong><small>אימונים וכושר</small></button>
            <button class="module-card" data-module="tools"><span class="module-ic">🧰</span><strong>ארגז כלים</strong><small>13 כלים שימושיים</small></button>
          </div>
        </section>
        <div class="dashboard-grid">
          <div class="card">
            <h3>💰 פיננסים</h3>
            <p>נכסים: ${finance?.incomes?.length || 0}</p>
            <p>הוצאות: ${finance?.expenses?.length || 0}</p>
            <p>השקעות: ${finance?.investments?.length || 0}</p>
          </div>
          <div class="card">
            <h3>📋 משימות</h3>
            <p>סה"כ: ${tasks?.tasks?.length || 0}</p>
            <p>דחופות: ${tasks?.tasks?.filter(t => t.priority === 'high').length || 0}</p>
            <p>דחויות: ${tasks?.tasks?.filter(t => t.isOverdue).length || 0}</p>
          </div>
          <div class="card">
            <h3>📊 מודיעין שוק</h3>
            <p>נתונים: ${marketIntel?.entries?.length || 0}</p>
          </div>
        </div>
      </div>
    `;
  }

  // ממיר סכום ותדירות לסכום חודשי. תדירות לא מוכרת נחשבת חודשית (ברירת המחדל של השירות).
  const MONTHLY_FACTOR = { monthly: 1, yearly: 1 / 12, annual: 1 / 12, weekly: 52 / 12, daily: 365 / 12 };
  function monthlyAmount(amount, frequency) {
    const factor = MONTHLY_FACTOR[String(frequency || 'monthly').toLowerCase()] ?? 1;
    return (Number(amount) || 0) * factor;
  }

  // תכנון פיננסי — תמונת מצב מחושבת: סיכומים, תזרים חודשי נטו ותחזית השקעות.
  // (התוכנית הגולמית — שם, מטבע ורשימת הפריטים — מוצגת ונערכת בתצוגת "התוכנית הפיננסית".)
  function renderFinance(data) {
    const finance = data || {};
    const incomes = Array.isArray(finance.incomes) ? finance.incomes : [];
    const expenses = Array.isArray(finance.expenses) ? finance.expenses : [];
    const investments = Array.isArray(finance.investments) ? finance.investments : [];

    if (incomes.length === 0 && expenses.length === 0 && investments.length === 0) {
      return renderEmpty('אין נתונים בתכנון הפיננסי עדיין — הזן הכנסות והוצאות ב"התוכנית הפיננסית" כדי לראות כאן את התמונה הכוללת') +
        '<div class="acct-actions"><button class="secondary" data-goto="personal-finance">להזנת הכנסות והוצאות ←</button></div>';
    }

    // סיכומים חודשיים — מנרמלים תדירויות שונות לבסיס חודשי אחד.
    // מעוגל לאגורות בדיוק כמו שאר המערכת.
    // כל פריט מומר לסכום חודשי בשלמי אגורות, והסיכום נעשה על שלמים (כלל 1)
    const agMonthly = (x) => Math.round(monthlyAmount(x.amount, x.frequency) * 100);
    const round2 = (ag) => ag / 100;
    const incomeMonthly = incomes.reduce((s, i) => s + agMonthly(i), 0);
    const expenseMonthly = expenses.reduce((s, e) => s + agMonthly(e), 0);
    const netMonthly = incomeMonthly - expenseMonthly;
    const fixedMonthly = expenses.filter(e => e.isFixed !== false).reduce((s, e) => s + agMonthly(e), 0);
    // תחזית השקעה: ריבית דריבית חודשית עם הפקדה, מעוגלת לאגורה בכל חודש
    const projectAg = (inv) => {
      let bal = Math.round((Number(inv.principal) || 0) * 100);
      const dep = Math.round((Number(inv.monthlyContribution) || 0) * 100);
      const r = (Number(inv.annualRate) || 0) / 100 / 12;
      const months = Math.min(1200, Math.max(0, Math.round((Number(inv.years) || 0) * 12)));
      for (let m = 0; m < months; m++) bal = Math.round(bal * (1 + r)) + dep;
      return bal;
    };

    return `
      <div class="finance">
        <div class="kpis">
          <div class="kpi pos"><small>הכנסות בחודש</small><strong>${money(round2(incomeMonthly))}</strong></div>
          <div class="kpi neg"><small>הוצאות בחודש</small><strong>${money(round2(expenseMonthly))}</strong></div>
          <div class="kpi ${netMonthly < 0 ? 'neg' : 'pos'}"><small>תזרים חודשי נטו</small><strong>${money(round2(netMonthly))}</strong></div>
          <div class="kpi"><small>הוצאות קבועות</small><strong>${money(round2(fixedMonthly))}</strong></div>
        </div>
        <div class="section">
          <h3>הכנסות (${incomes.length})</h3>
          ${incomes.length === 0 ? '<div class="acct-row muted">אין הכנסות רשומות</div>' : incomes.map(i => `
            <div class="item">
              <span>${esc(i.source)}</span>
              <span>${money(i.amount)} / ${esc(FREQ_LABELS[i.frequency] || 'חודשי')}</span>
            </div>
          `).join('')}
        </div>
        <div class="section">
          <h3>הוצאות (${expenses.length})</h3>
          ${expenses.length === 0 ? '<div class="acct-row muted">אין הוצאות רשומות</div>' : expenses.map(e => `
            <div class="item">
              <span>${esc(e.category)}${e.isFixed === false ? ' <small class="muted">(משתנה)</small>' : ''}</span>
              <span>${money(e.amount)} / ${esc(FREQ_LABELS[e.frequency] || 'חודשי')}</span>
            </div>
          `).join('')}
        </div>
        <div class="section">
          <h3>השקעות (${investments.length})</h3>
          ${investments.length === 0 ? '<div class="acct-row muted">אין השקעות רשומות</div>' : investments.map(inv => `
            <div class="item">
              <span>${esc(inv.name)} <small class="muted">· ${money(inv.principal)} · ${esc(inv.annualRate)}% · ${esc(inv.years || 0)} שנים</small></span>
              <span>שווי צפוי: ${money(projectAg(inv) / 100)}</span>
            </div>
          `).join('')}
        </div>
        <div class="acct-actions"><button class="secondary" data-goto="personal-finance">עריכת הפריטים בתוכנית ←</button></div>
      </div>
    `;
  }

  // תדירויות בעברית לתצוגה
  const FREQ_LABELS = { monthly: 'חודשי', yearly: 'שנתי', annual: 'שנתי', weekly: 'שבועי', daily: 'יומי' };

  // Render business view
  function renderBusiness(data) {
    const plans = Array.isArray(data?.plans) ? data.plans : [];
    return `
      <div class="business">
        <h3>תוכניות עסקיות (${plans.length})</h3>
        ${plans.length === 0 ? renderEmpty('אין תוכניות עסקיות עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
        ${plans.map(p => `
          <div class="card">
            <h4>${esc(p.name)}</h4>
            <p>${esc(p.description || 'ללא תיאור')}</p>
            <small>תעשייה: ${esc(p.industry || 'לא צוין')}${p.targetMarket ? ' · שוק יעד: ' + esc(p.targetMarket) : ''}</small>
            ${p.startupCost || p.projectedRevenue ? `<div class="acct-row"><span>עלות הקמה ${money(p.startupCost)}</span><span>הכנסה צפויה ${money(p.projectedRevenue)}</span></div>` : ''}
            ${renderCardActions(p.id)}
          </div>
        `).join('')}
      </div>
    `;
  }

  // Render market intelligence view
  function renderMarketIntel(data) {
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    return `
      <div class="market-intel">
        <h3>מודיעין שוק (${entries.length})</h3>
        ${entries.length === 0 ? renderEmpty('אין רשומות מודיעין עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
        ${entries.map(e => `
          <div class="card">
            <h4>${esc(e.title)}</h4>
            <p>${esc(e.description || '')}</p>
            <small>מקור: ${esc(INTEL_LABELS.sourceType[e.sourceType] || e.sourceType)} | אמינות: ${esc(INTEL_LABELS.credibility[e.credibility] || e.credibility)} | כיוון: ${esc(INTEL_LABELS.impactDirection[e.impactDirection] || e.impactDirection)}</small>
            ${renderCardActions(e.id)}
          </div>
        `).join('')}
      </div>
    `;
  }

  // Render mortgage view
  function renderMortgage(data) {
    const scenarios = Array.isArray(data?.scenarios) ? data.scenarios : [];
    return `
      <div class="mortgage">
        <div class="acct-header"><h3>משכנתאות והלוואות (${scenarios.length})</h3><button class="secondary" data-goto="mortgage-advisor">כלי ייעוץ משכנתאות מלא ←</button></div>
        ${scenarios.length === 0 ? renderEmpty('אין תרחישי הלוואה עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
        ${scenarios.map(s => `
          <div class="card">
            <h4>${esc(s.name)}</h4>
            <p>סכום: ₪${s.principal} | ריבית: ${s.annualRate}% | תקופה: ${s.years} שנים</p>
            ${renderCardActions(s.id)}
          </div>
        `).join('')}
      </div>
    `;
  }

  // התוכנית הפיננסית — הגדרת התוכנית והפריטים. כל פריט ניתן לעריכה ולמחיקה;
  // "＋ הוספת רשומה" פותח טופס עם בחירת סוג (הכנסה / הוצאה / השקעה / תנועת תזרים).
  const PF_KINDS = { incomes: 'הכנסה', expenses: 'הוצאה', investments: 'השקעה', cashFlowEntries: 'תנועת תזרים' };
  const PF_INCOME_CATS = { salary: 'משכורת', business: 'עסק', rent: 'שכירות', allowance: 'קצבה', other: 'אחר' };
  const PF_INVEST_TYPES = { 'stocks-etf': 'קרן מחקה / מניות', bonds: 'אג"ח', deposit: 'פיקדון', pension: 'פנסיה / השתלמות', 'real-estate': 'נדל"ן', other: 'אחר' };
  const pfItemActions = (kind, id) => `
    <span class="card-actions inline">
      <button class="icon-btn" data-pf-edit="${esc(kind)}" data-id="${esc(id)}" title="עריכה">✎</button>
      <button class="icon-btn danger" data-pf-del="${esc(kind)}" data-id="${esc(id)}" title="מחיקה">🗑</button>
    </span>`;

  function renderPersonalFinance(data) {
    const finance = data || {};
    const incomes = Array.isArray(finance.incomes) ? finance.incomes : [];
    const expenses = Array.isArray(finance.expenses) ? finance.expenses : [];
    const investments = Array.isArray(finance.investments) ? finance.investments : [];
    const cashFlow = Array.isArray(finance.cashFlowEntries) ? finance.cashFlowEntries : [];
    const empty = incomes.length === 0 && expenses.length === 0 && investments.length === 0 && cashFlow.length === 0;

    return `
      <div class="personal-finance">
        <div class="acct-header">
          <div>
            <h3>${esc(finance.planName || 'התוכנית הפיננסית')}</h3>
            <small>מטבע: ${esc(CURRENCY_LABELS[finance.currency] || finance.currency || 'שקל')} · ${incomes.length} הכנסות · ${expenses.length} הוצאות · ${investments.length} השקעות · ${cashFlow.length} תנועות</small>
          </div>
          <div class="acct-actions">
            <button class="secondary" id="pfPlanBtn">עריכת פרטי התוכנית</button>
            <button class="secondary" data-goto="finance">לתמונת המצב ←</button>
          </div>
        </div>
        ${empty ? renderEmpty('התוכנית הפיננסית ריקה עדיין — לחץ "＋ הוספת רשומה" ובחר הכנסה, הוצאה, השקעה או תנועת תזרים') : ''}
        <div class="section">
          <h3>הכנסות (${incomes.length})</h3>
          ${incomes.length === 0 ? '<div class="acct-row muted">אין הכנסות רשומות</div>' : incomes.map(i => `
            <div class="item">
              <span>${esc(i.source)}${i.category ? ` <small class="muted">· ${esc(PF_INCOME_CATS[i.category] || i.category)}</small>` : ''}</span>
              <span>${money(i.amount)} / ${esc(FREQ_LABELS[i.frequency] || 'חודשי')}${pfItemActions('incomes', i.id)}</span>
            </div>
          `).join('')}
        </div>
        <div class="section">
          <h3>הוצאות (${expenses.length})</h3>
          ${expenses.length === 0 ? '<div class="acct-row muted">אין הוצאות רשומות</div>' : expenses.map(e => `
            <div class="item">
              <span>${esc(e.category)}${e.description ? ` <small class="muted">· ${esc(e.description)}</small>` : ''}${e.isFixed === false ? ' <small class="muted">(משתנה)</small>' : ''}</span>
              <span>${money(e.amount)} / ${esc(FREQ_LABELS[e.frequency] || 'חודשי')}${pfItemActions('expenses', e.id)}</span>
            </div>
          `).join('')}
        </div>
        <div class="section">
          <h3>השקעות (${investments.length})</h3>
          ${investments.length === 0 ? '<div class="acct-row muted">אין השקעות רשומות</div>' : investments.map(inv => `
            <div class="item">
              <span>${esc(inv.name)} <small class="muted">· ${esc(PF_INVEST_TYPES[inv.type] || inv.type || '')}${inv.years ? ` · ${esc(inv.years)} שנים` : ''}</small></span>
              <span>${money(inv.principal)} · ${esc(inv.annualRate)}%${inv.monthlyContribution ? ` · +${money(inv.monthlyContribution)} לחודש` : ''}${pfItemActions('investments', inv.id)}</span>
            </div>
          `).join('')}
        </div>
        <div class="section">
          <h3>תזרים מזומנים (${cashFlow.length})</h3>
          ${cashFlow.length === 0 ? '<div class="acct-row muted">אין תנועות תזרים</div>' : [...cashFlow].sort((x, y) => String(y.date).localeCompare(String(x.date))).map(c => `
            <div class="item">
              <span>${esc(c.description || c.category || 'תנועה')} <small class="muted">${esc(c.date)}</small></span>
              <span class="${c.type === 'expense' ? 'neg' : 'pos'}">${c.type === 'expense' ? '−' : '+'}${money(c.amount)}${pfItemActions('cashFlowEntries', c.id)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  const CURRENCY_LABELS = { ILS: 'שקל (₪)', USD: 'דולר ($)', EUR: 'אירו (€)' };

  const TASK_LABELS = {
    category: { work: 'עבודה', personal: 'אישי', finance: 'כספים', other: 'אחר' },
    priority: { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' },
    status: { todo: 'לביצוע', 'in-progress': 'בתהליך', done: 'הושלם' }
  };
  const INTEL_LABELS = {
    sourceType: { news: 'חדשות', report: 'דוח', social: 'רשתות', internal: 'פנימי', other: 'אחר' },
    credibility: { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' },
    impactDirection: { positive: 'חיובי', neutral: 'ניטרלי', negative: 'שלילי' }
  };

  // Render tasks view
  function renderTasks(data) {
    const tasks = data?.tasks || [];
    return `
      <div class="tasks">
        <h3>משימות (${tasks.length})</h3>
        ${tasks.length === 0 ? renderEmpty('אין משימות עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
        ${tasks.map(t => `
          <div class="card ${t.status === 'done' ? 'done' : ''}">
            <h4>${esc(t.title)}</h4>
            <p>${esc(t.description || '')}</p>
            <small>קטגוריה: ${esc(TASK_LABELS.category[t.category] || t.category)} | עדיפות: ${esc(TASK_LABELS.priority[t.priority] || t.priority)} | סטטוס: ${esc(TASK_LABELS.status[t.status] || t.status)}${t.dueDate ? ' | יעד: ' + esc(t.dueDate) : ''}</small>
            ${t.isOverdue ? '<span class="overdue">דחוי!</span>' : ''}
            ${renderCardActions(t.id)}
          </div>
        `).join('')}
      </div>
    `;
  }

  // Render contacts view
  function renderContacts(data) {
    const contacts = data?.contacts || [];
    return `
      <div class="contacts">
        <h3>אנשי קשר (${contacts.length})</h3>
        ${renderSearchBox('חיפוש לפי שם, דוא"ל או חברה...')}
        ${contacts.length === 0 ? renderEmpty('אין אנשי קשר עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
        ${contacts.map(c => `
          <div class="card">
            <h4>${esc(c.name)}</h4>
            <p>${esc(c.email || '')}</p>
            <small>${esc(c.company || '')} | ${esc(c.role || '')}</small>
            ${renderCardActions(c.id)}
          </div>
        `).join('')}
      </div>
    `;
  }

  // Render fitness view — אימונים, תזונה ומדדים
  const FITNESS_KINDS = {
    workout: { emoji: '🏃', label: 'אימון' },
    nutrition: { emoji: '🍎', label: 'תזונה' },
    metric: { emoji: '⚖️', label: 'מדד' }
  };

  // תרגום ערכי המקרא (השירות שומר באנגלית) לתוויות בעברית
  const FITNESS_WORKOUT_TYPES = {
    cardio: 'אירובי', strength: 'כוח', yoga: 'יוגה',
    walking: 'הליכה', sports: 'ספורט', other: 'אחר'
  };
  const FITNESS_MEAL_TYPES = {
    breakfast: 'בוקר', lunch: 'צהריים', dinner: 'ערב', snack: 'ביניים'
  };

  function renderFitness(data) {
    const fitness = data || {};
    const workouts = fitness.workouts || [];
    const nutrition = fitness.nutrition || [];
    const metrics = fitness.metrics || [];
    const total = workouts.length + nutrition.length + metrics.length;

    // כרטיס אימון
    const workoutCard = (w) => `
      <div class="card">
        <h4>${FITNESS_KINDS.workout.emoji} ${esc(FITNESS_WORKOUT_TYPES[w.type] || w.type || 'אימון')}</h4>
        <p>משך: ${Number(w.durationMinutes) || 0} דקות${w.caloriesBurned ? ` · ${Number(w.caloriesBurned)} קלוריות` : ''}</p>
        ${w.notes ? `<p>${esc(w.notes)}</p>` : ''}
        <small>תאריך: ${esc(w.date || '')}</small>
      </div>`;
    // כרטיס תזונה
    const nutritionCard = (n) => `
      <div class="card">
        <h4>${FITNESS_KINDS.nutrition.emoji} ${esc(FITNESS_MEAL_TYPES[n.mealType] || n.mealType || 'ארוחה')}</h4>
        <p>${Number(n.calories) || 0} קלוריות</p>
        ${n.description ? `<p>${esc(n.description)}</p>` : ''}
        ${n.notes ? `<p>${esc(n.notes)}</p>` : ''}
        <small>תאריך: ${esc(n.date || '')}</small>
      </div>`;
    // כרטיס מדד
    const metricCard = (m) => `
      <div class="card">
        <h4>${FITNESS_KINDS.metric.emoji} מדד</h4>
        ${m.weightKg !== null && m.weightKg !== undefined ? `<p>משקל: ${Number(m.weightKg)} ק"ג</p>` : ''}
        ${m.bodyFatPercent !== null && m.bodyFatPercent !== undefined ? `<p>אחוז שומן: ${Number(m.bodyFatPercent)}%</p>` : ''}
        ${m.notes ? `<p>${esc(m.notes)}</p>` : ''}
        <small>תאריך: ${esc(m.date || '')}</small>
      </div>`;

    const section = (title, items, renderCard) => `
      <div class="section">
        <h4>${title} (${items.length})</h4>
        ${items.length === 0
          ? renderEmpty('אין רשומות עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל')
          : items.map(renderCard).join('')}
      </div>`;

    return `
      <div class="fitness">
        <h3>כושר ובריאות</h3>
        ${total === 0 ? renderEmpty('אין רשומות כושר עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
        ${section('אימונים', workouts, workoutCard)}
        ${section('תזונה', nutrition, nutritionCard)}
        ${section('מדדים', metrics, metricCard)}
      </div>
    `;
  }

  // Render voice notes view
  function renderVoiceNotes(data) {
    const notes = Array.isArray(data?.notes) ? data.notes : [];
    return `
      <div class="voice-notes">
        <h3>הערות קוליות (${notes.length})</h3>
        ${renderSearchBox('חיפוש לפי כותרת או תיאור...')}
        ${notes.length === 0 ? renderEmpty('אין הערות קוליות עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
        ${notes.map(n => `
          <div class="card">
            <h4>${esc(n.title)}</h4>
            <p>${esc(n.description || '')}</p>
            <small>משך: ${n.duration}s | תאריך: ${esc(n.recordedAt)}</small>
            ${renderCardActions(n.id)}
          </div>
        `).join('')}
      </div>
    `;
  }

  // Render canvas view
  function renderCanvas(data) {
    const boards = Array.isArray(data?.boards) ? data.boards : [];
    return `
      <div class="canvas">
        <h3>לוחות (${boards.length})</h3>
        ${boards.length === 0 ? renderEmpty('אין לוחות עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
        ${boards.map(b => `
          <div class="card">
            <h4>${esc(b.boardName)}</h4>
            <p>כרטיסים: ${b.cards?.length || 0} | חיבורים: ${b.connections?.length || 0}</p>
            ${renderCardActions(b.id)}
          </div>
        `).join('')}
      </div>
    `;
  }

  // ============================================================
  // הגדרת טפסים לכל תצוגה — שדה, תווית, סוג, חובה
  // ============================================================
  const formSchemas = {
    'tasks': {
      title: 'משימה חדשה',
      fields: [
        { name: 'title', label: 'כותרת', type: 'text', required: true },
        { name: 'description', label: 'תיאור', type: 'textarea' },
        { name: 'category', label: 'קטגוריה', type: 'select', options: [
          { value: 'work', label: 'עבודה' },
          { value: 'personal', label: 'אישי' },
          { value: 'finance', label: 'כספים' },
          { value: 'other', label: 'אחר' }
        ]},
        { name: 'priority', label: 'עדיפות', type: 'select', options: [
          { value: 'low', label: 'נמוכה' },
          { value: 'medium', label: 'בינונית' },
          { value: 'high', label: 'גבוהה' }
        ]},
        { name: 'status', label: 'סטטוס', type: 'select', options: [
          { value: 'todo', label: 'לביצוע' },
          { value: 'in-progress', label: 'בתהליך' },
          { value: 'done', label: 'הושלם' }
        ]},
        { name: 'dueDate', label: 'תאריך יעד', type: 'date' }
      ],
      create: (data) => window.systemAPI.createTask(data),
      update: (id, data) => window.systemAPI.updateTask(id, data),
      remove: (id) => window.systemAPI.deleteTask(id)
    },
    'contacts': {
      title: 'איש קשר חדש',
      searchable: true,
      fields: [
        { name: 'name', label: 'שם', type: 'text', required: true },
        { name: 'email', label: 'דוא"ל', type: 'email' },
        { name: 'phone', label: 'טלפון', type: 'tel' },
        { name: 'company', label: 'חברה', type: 'text' },
        { name: 'role', label: 'תפקיד', type: 'text' },
        { name: 'address', label: 'כתובת', type: 'text' },
        { name: 'notes', label: 'הערות', type: 'textarea' }
      ],
      create: (data) => window.systemAPI.createContact(data),
      update: (id, data) => window.systemAPI.updateContact(id, data),
      remove: (id) => window.systemAPI.deleteContact(id),
      search: (q) => window.systemAPI.searchContacts(q)
    },
    'business': {
      title: 'תוכנית עסקית חדשה',
      fields: [
        { name: 'name', label: 'שם התוכנית', type: 'text', required: true },
        { name: 'description', label: 'תיאור', type: 'textarea' },
        { name: 'industry', label: 'תעשייה', type: 'text' },
        { name: 'targetMarket', label: 'שוק יעד', type: 'text' },
        { name: 'startupCost', label: 'עלות הקמה (₪)', type: 'number' },
        { name: 'projectedRevenue', label: 'הכנסה צפויה (₪)', type: 'number' }
      ],
      create: (data) => window.systemAPI.saveBusinessPlan(data),
      update: (id, data) => window.systemAPI.updateBusinessPlan(id, data),
      remove: (id) => window.systemAPI.deleteBusinessPlan(id)
    },
    'market-intel': {
      title: 'רשומת מודיעין שוק חדשה',
      fields: [
        { name: 'title', label: 'כותרת', type: 'text', required: true },
        { name: 'description', label: 'תיאור', type: 'textarea' },
        { name: 'sourceType', label: 'סוג מקור', type: 'select', options: [
          { value: 'news', label: 'חדשות' },
          { value: 'report', label: 'דוח' },
          { value: 'social', label: 'רשתות' },
          { value: 'internal', label: 'פנימי' },
          { value: 'other', label: 'אחר' }
        ]},
        { name: 'credibility', label: 'אמינות', type: 'select', options: [
          { value: 'low', label: 'נמוכה' },
          { value: 'medium', label: 'בינונית' },
          { value: 'high', label: 'גבוהה' }
        ]},
        { name: 'impactDirection', label: 'כיוון השפעה', type: 'select', options: [
          { value: 'positive', label: 'חיובי' },
          { value: 'neutral', label: 'ניטרלי' },
          { value: 'negative', label: 'שלילי' }
        ]}
      ],
      create: (data) => window.systemAPI.updateMarketIntel(data),
      // עריכת רשומת מודיעין בודדת — הערוץ marketIntel:updateEntry קיים ב-ipc.js
      // ובשירות (מיזוג שדות), אך ה-UI מעולם לא חיבר אליו כפתור עריכה.
      update: (id, data) => window.systemAPI.updateMarketIntelEntry(id, data),
      remove: (id) => window.systemAPI.deleteMarketIntelEntry(id)
    },
    'mortgage': {
      title: 'תרחיש הלוואה חדש',
      fields: [
        { name: 'name', label: 'שם התרחיש', type: 'text', required: true },
        { name: 'principal', label: 'סכום ההלוואה (₪)', type: 'number', required: true },
        { name: 'annualRate', label: 'ריבית שנתית (%)', type: 'number', required: true },
        { name: 'years', label: 'תקופה (שנים)', type: 'number', required: true }
      ],
      create: (data) => window.systemAPI.saveMortgageScenario(data),
      update: (id, data) => window.systemAPI.updateMortgageScenario(id, data),
      remove: (id) => window.systemAPI.deleteMortgageScenario(id)
    },
    'voice-notes': {
      title: 'הערה קולית חדשה',
      searchable: true,
      fields: [
        { name: 'title', label: 'כותרת', type: 'text', required: true },
        { name: 'description', label: 'תיאור', type: 'textarea' },
        { name: 'duration', label: 'משך (שניות)', type: 'number' },
        { name: 'audioPath', label: 'נתיב קובץ שמע', type: 'text' },
        { name: 'notes', label: 'תמלול / הערות', type: 'textarea' }
      ],
      create: (data) => window.systemAPI.createVoiceNote(data),
      update: (id, data) => window.systemAPI.updateVoiceNote(id, data),
      remove: (id) => window.systemAPI.deleteVoiceNote(id),
      search: (q) => window.systemAPI.searchVoiceNotes(q)
    },
    'canvas': {
      title: 'לוח חדש',
      fields: [
        { name: 'boardName', label: 'שם הלוח', type: 'text', required: true },
        { name: 'description', label: 'תיאור', type: 'textarea' }
      ],
      create: (data) => window.systemAPI.saveCanvasBoard(data),
      update: (id, data) => window.systemAPI.updateCanvasBoard(id, data),
      remove: (id) => window.systemAPI.deleteCanvasBoard(id)
    },
    'fitness': {
      title: 'רשומת כושר חדשה',
      // טופס אחד עם בחירת סוג — השדות מוחלפים לפי הסוג הנבחר
      dynamic: true,
      fields: [
        { name: 'fitnessKind', label: 'סוג הרשומה', type: 'select', required: true, options: [
          { value: 'workout', label: 'אימון' },
          { value: 'nutrition', label: 'תזונה' },
          { value: 'metric', label: 'מדד גוף' }
        ]},
        // אימון
        { name: 'date', label: 'תאריך', type: 'date', required: true, kinds: ['workout', 'nutrition', 'metric'] },
        { name: 'type', label: 'סוג האימון', type: 'select', required: true, kinds: ['workout'], options: [
          { value: 'cardio', label: 'אירובי' },
          { value: 'strength', label: 'כוח' },
          { value: 'yoga', label: 'יוגה' },
          { value: 'walking', label: 'הליכה' },
          { value: 'sports', label: 'ספורט' },
          { value: 'other', label: 'אחר' }
        ]},
        { name: 'durationMinutes', label: 'משך (דקות)', type: 'number', required: true, kinds: ['workout'] },
        { name: 'caloriesBurned', label: 'קלוריות שנשרפו', type: 'number', kinds: ['workout'] },
        // תזונה
        { name: 'mealType', label: 'סוג הארוחה', type: 'select', required: true, kinds: ['nutrition'], options: [
          { value: 'breakfast', label: 'בוקר' },
          { value: 'lunch', label: 'צהריים' },
          { value: 'dinner', label: 'ערב' },
          { value: 'snack', label: 'ביניים' }
        ]},
        { name: 'calories', label: 'קלוריות', type: 'number', required: true, kinds: ['nutrition'] },
        { name: 'description', label: 'תיאור הארוחה', type: 'text', kinds: ['nutrition'] },
        // מדד
        { name: 'weightKg', label: 'משקל (ק"ג)', type: 'number', kinds: ['metric'] },
        { name: 'bodyFatPercent', label: 'אחוז שומן (%)', type: 'number', kinds: ['metric'] },
        // הערות — לכל הסוגים
        { name: 'notes', label: 'הערות', type: 'textarea', kinds: ['workout', 'nutrition', 'metric'] }
      ],
      create: (data) => {
        const kind = data.fitnessKind;
        const base = { date: data.date, notes: data.notes };
        if (kind === 'workout') {
          return window.systemAPI.createWorkout({
            ...base, type: data.type,
            durationMinutes: data.durationMinutes, caloriesBurned: data.caloriesBurned
          });
        }
        if (kind === 'nutrition') {
          return window.systemAPI.createNutrition({
            ...base, mealType: data.mealType,
            calories: data.calories, description: data.description
          });
        }
        return window.systemAPI.createMetric({
          ...base, weightKg: data.weightKg, bodyFatPercent: data.bodyFatPercent
        });
      }
    }
  };

  // תצוגות ללא טופס הוספה (מחושבות/מצטברות בלבד)
  // ============================================================
  // הנהלת חשבונות — דוחות, יומן, חשבוניות ותוכנית חשבונות
  // ============================================================
  const money = (n) => '₪' + Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const isoDate = (d) => d.toISOString().slice(0, 10);
  const yearStart = () => isoDate(new Date(new Date().getFullYear(), 0, 1));
  const today = () => isoDate(new Date());
  const acctPeriod = () => state.acctPeriod || (state.acctPeriod = { from: yearStart(), to: today() });
  const ACCT_STATUS = { open: 'פתוחה', paid: 'שולמה', cancelled: 'בוטלה' };
  const ACCT_TYPE_LABELS = { asset: 'נכס', liability: 'התחייבות', equity: 'הון', revenue: 'הכנסה', expense: 'הוצאה' };

  function accountOptions(chart) {
    return (chart || []).map(a => ({ value: a.code, label: `${a.code} · ${a.name}` }));
  }

  // הגנת עומק לדוחות: דוח חלקי (גרסת נתונים ישנה / תקופה בלי תנועות) לא מפיל את התצוגה.
  // כל שדה נדרש מנורמל כאן, ורק מכאן והלאה הרינדור יכול להניח צורה מלאה.
  function normalizeAcctReports(r) {
    const num = (v) => Number(v) || 0;
    const list = (v) => (Array.isArray(v) ? v : []);
    const o = (v) => (v && typeof v === 'object' ? v : {});
    const summary = o(r.summary), analytics = o(r.analytics),
          incomeStatement = o(r.incomeStatement), balanceSheet = o(r.balanceSheet),
          vat = o(r.vat), aged = o(r.aged), trialBalance = o(r.trialBalance);
    return {
      period: o(r.period),
      lockDate: r.lockDate,
      vatRate: num(r.vatRate),
      openInvoices: num(r.openInvoices),
      summary: { income: num(summary.income), expenses: num(summary.expenses),
                 vatPayable: num(summary.vatPayable), profit: num(summary.profit) },
      analytics: { totalInvoices: num(analytics.totalInvoices), totalRevenue: num(analytics.totalRevenue),
                   customers: num(analytics.customers), repeatShare: num(analytics.repeatShare),
                   repeatCustomers: list(analytics.repeatCustomers), monthly: list(analytics.monthly) },
      incomeStatement: { revenue: list(incomeStatement.revenue), expenses: list(incomeStatement.expenses),
                         totalRevenue: num(incomeStatement.totalRevenue), totalExpenses: num(incomeStatement.totalExpenses),
                         netProfit: num(incomeStatement.netProfit) },
      balanceSheet: { balanced: !!balanceSheet.balanced, assets: list(balanceSheet.assets),
                      liabilities: list(balanceSheet.liabilities), equity: list(balanceSheet.equity),
                      totalAssets: num(balanceSheet.totalAssets), totalLiabilities: num(balanceSheet.totalLiabilities),
                      totalEquity: num(balanceSheet.totalEquity) },
      vat: { outputVat: num(vat.outputVat), inputVat: num(vat.inputVat), netPayable: num(vat.netPayable) },
      aged: { buckets: list(aged.buckets) },
      trialBalance: { rows: list(trialBalance.rows), balanced: !!trialBalance.balanced,
                      totalDebit: num(trialBalance.totalDebit), totalCredit: num(trialBalance.totalCredit) }
    };
  }

  function renderAcctReports(raw) {
    if (!raw) return renderEmpty('אין נתונים להצגה');
    const r = normalizeAcctReports(raw);
    const rows = (list) => (list || []).map(x => `<div class="acct-row"><span>${esc(x.code)} ${esc(x.name)}</span><span>${money(x.amount)}</span></div>`).join('') || '<div class="acct-row muted">אין תנועות</div>';
    const tbRows = r.trialBalance.rows.map(x => `<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td>${money(x.debit)}</td><td>${money(x.credit)}</td><td>${money(x.balance)}</td></tr>`).join('');
    return `
      <div class="acct-header">
        <div>תקופה: ${esc(r.period.from || 'מההתחלה')} — ${esc(r.period.to)} · שיעור מע"מ: ${(r.vatRate * 100).toFixed(2)}%${r.lockDate ? ` · תקופה נעולה עד ${esc(r.lockDate)}` : ''}</div>
        <div class="acct-actions">
          <button class="secondary" id="acctCsvSummary">ייצוא סיכום תקופתי ל-Excel</button>
          <button class="secondary" id="acctCsvTb">ייצוא מאזן בוחן ל-Excel</button>
          <button class="secondary" id="acctPeriodBtn">החלף תקופה</button>
        </div>
      </div>
      <div class="acct-grid">
        <div class="card">
          <h3>סיכום תקופתי</h3>
          <div class="acct-row"><span>הכנסות</span><span>${money(r.summary.income)}</span></div>
          <div class="acct-row"><span>הוצאות</span><span>${money(r.summary.expenses)}</span></div>
          <div class="acct-row"><span>מע"מ לתשלום (עסקאות פחות תשומות)</span><span>${money(r.summary.vatPayable)}</span></div>
          <div class="acct-row acct-big ${r.summary.profit < 0 ? 'neg' : 'pos'}"><span>רווח (הפסד) לפני מע"מ</span><span>${money(r.summary.profit)}</span></div>
        </div>
        <div class="card">
          <h3>ניתוח חשבוניות</h3>
          <div class="acct-row"><span>חשבוניות פעילות</span><span>${r.analytics.totalInvoices}</span></div>
          <div class="acct-row"><span>סה"כ מחזור</span><span>${money(r.analytics.totalRevenue)}</span></div>
          <div class="acct-row"><span>לקוחות שונים / חוזרים</span><span>${r.analytics.customers} / ${r.analytics.repeatCustomers.length} (${r.analytics.repeatShare}%)</span></div>
          <h4>חשבוניות לפי חודש</h4>
          ${r.analytics.monthly.slice(-6).map(m => `<div class="acct-row"><span>${esc(m.month)} <span class="muted">(${m.count})</span></span><span>${money(m.total)}</span></div>`).join('') || '<div class="acct-row muted">אין חשבוניות</div>'}
          <h4>לקוחות חוזרים</h4>
          ${r.analytics.repeatCustomers.slice(0, 5).map(c => `<div class="acct-row"><span>${esc(c.customer)} <span class="muted">(${c.count})</span></span><span>${money(c.total)}</span></div>`).join('') || '<div class="acct-row muted">אין לקוחות חוזרים עדיין</div>'}
        </div>
        <div class="card">
          <h3>רווח והפסד</h3>
          <h4>הכנסות</h4>${rows(r.incomeStatement.revenue)}
          <div class="acct-row acct-total"><span>סה"כ הכנסות</span><span>${money(r.incomeStatement.totalRevenue)}</span></div>
          <h4>הוצאות</h4>${rows(r.incomeStatement.expenses)}
          <div class="acct-row acct-total"><span>סה"כ הוצאות</span><span>${money(r.incomeStatement.totalExpenses)}</span></div>
          <div class="acct-row acct-big ${r.incomeStatement.netProfit < 0 ? 'neg' : 'pos'}"><span>רווח (הפסד) נקי</span><span>${money(r.incomeStatement.netProfit)}</span></div>
        </div>
        <div class="card">
          <h3>מאזן ${r.balanceSheet.balanced ? '<span class="ok">✓ מאוזן</span>' : '<span class="bad">⚠ לא מאוזן</span>'}</h3>
          <h4>נכסים</h4>${rows(r.balanceSheet.assets)}
          <div class="acct-row acct-total"><span>סה"כ נכסים</span><span>${money(r.balanceSheet.totalAssets)}</span></div>
          <h4>התחייבויות</h4>${rows(r.balanceSheet.liabilities)}
          <h4>הון</h4>${rows(r.balanceSheet.equity)}
          <div class="acct-row acct-total"><span>סה"כ התחייבויות והון</span><span>${money(r.balanceSheet.totalLiabilities + r.balanceSheet.totalEquity)}</span></div>
        </div>
        <div class="card">
          <h3>דוח מע"מ לתקופה</h3>
          <div class="acct-row"><span>מע"מ עסקאות (שהוצא)</span><span>${money(r.vat.outputVat)}</span></div>
          <div class="acct-row"><span>מע"מ תשומות (זיכוי)</span><span>${money(r.vat.inputVat)}</span></div>
          <div class="acct-row acct-big ${r.vat.netPayable > 0 ? 'neg' : 'pos'}"><span>${r.vat.netPayable >= 0 ? 'לתשלום לרשות המסים' : 'זכות לקבל'}</span><span>${money(Math.abs(r.vat.netPayable))}</span></div>
        </div>
        <div class="card">
          <h3>גיול חייבים</h3>
          ${r.aged.buckets.map(b => `<div class="acct-row"><span>${esc(b.label)} <span class="muted">(${b.count})</span></span><span>${money(b.total)}</span></div>`).join('')}
          <div class="acct-row acct-big"><span>סה"כ פתוח</span><span>${money(r.openInvoices)}</span></div>
        </div>
        <div class="card acct-wide">
          <h3>מאזן בוחן ${r.trialBalance.balanced ? '<span class="ok">✓ מאוזן</span>' : '<span class="bad">⚠ לא מאוזן</span>'}</h3>
          <div class="acct-scroll"><table class="acct-table">
            <thead><tr><th>קוד</th><th>שם</th><th>חובה</th><th>זכות</th><th>יתרה</th></tr></thead>
            <tbody>${tbRows || '<tr><td colspan="5" class="muted">אין תנועות בתקופה</td></tr>'}</tbody>
            <tfoot><tr><th colspan="2">סה"כ</th><th>${money(r.trialBalance.totalDebit)}</th><th>${money(r.trialBalance.totalCredit)}</th><th></th></tr></tfoot>
          </table></div>
        </div>
      </div>`;
  }

  function renderAcctJournal(d) {
    const entries = Array.isArray(d?.entries) ? d.entries : [];
    const names = Object.fromEntries((d?.chart || []).map(a => [a.code, a.name]));
    return `
      <div class="acct-header"><h3>רשומות יומן (${entries.length})</h3><button class="secondary" id="acctCsvJournal">ייצוא יומן ל-Excel</button></div>
      ${entries.length === 0 ? renderEmpty('אין רשומות יומן עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
      ${entries.map(e => `
        <div class="card ${e.reversedBy || e.reversalOf ? 'muted-card' : ''}">
          <h4>${esc(e.description || 'ללא תיאור')}</h4>
          <small>${esc(e.date)}${e.reversalOf ? ' · רשומת ביטול' : ''}${e.reversedBy ? ' · בוטלה' : ''}</small>
          <div class="acct-lines">${(Array.isArray(e.lines) ? e.lines : []).map(l => `<div class="acct-row"><span>${esc(l.account)} ${esc(names[l.account] || '')}</span><span>${l.debit ? 'חובה ' + money(l.debit) : 'זכות ' + money(l.credit)}</span></div>`).join('')}</div>
          ${!e.reversedBy && !e.reversalOf ? renderCardActions(e.id) : ''}
        </div>`).join('')}`;
  }

  function renderAcctInvoices(d) {
    const invoices = Array.isArray(d?.invoices) ? d.invoices : [];
    return `
      <h3>חשבוניות מס (${invoices.length})</h3>
      ${invoices.length === 0 ? renderEmpty('אין חשבוניות עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
      ${invoices.map(i => `
        <div class="card ${i.status === 'paid' ? 'done' : ''} ${i.status === 'cancelled' ? 'muted-card' : ''}">
          <h4>חשבונית ${esc(i.number)} · ${esc(i.customer)}</h4>
          <p>${(Array.isArray(i.items) ? i.items : []).map(it => esc(it.description)).join(', ')}</p>
          <small>${esc(i.date)} · נטו ${money(i.net)} · מע"מ ${money(i.vat)}${i.vatExempt ? ' (פטור)' : ''}</small>
          <div class="acct-row acct-big"><span>${ACCT_STATUS[i.status] || i.status}</span><span>${money(i.total)}</span></div>
          <div class="card-actions">
            <button class="secondary" data-action="pdf" data-id="${esc(i.id)}">הורד PDF</button>
            ${i.status === 'open' ? `<button class="secondary" data-action="pay" data-id="${esc(i.id)}">סמן כשולמה</button>` : ''}
            ${i.status === 'paid' ? `<button class="danger-outline" data-action="unpay" data-id="${esc(i.id)}">בטל תשלום</button>` : ''}
            ${i.status === 'open' ? `<button class="danger-outline" data-action="cancel" data-id="${esc(i.id)}">בטל (חשבונית זיכוי)</button>` : ''}
          </div>
        </div>`).join('')}`;
  }

  function renderAcctChart(chart) {
    const list = chart || [];
    return `
      <h3>תוכנית חשבונות (${list.length})</h3>
      ${list.map(a => `
        <div class="card">
          <h4>${esc(a.code)} · ${esc(a.name)}</h4>
          <small>${esc(ACCT_TYPE_LABELS[a.type] || a.type)}</small>
        </div>`).join('')}`;
  }

  function renderAcctSettings(st) {
    if (!st) return renderEmpty('אין נתונים להצגה');
    const b = st.business || {};
    const row = (k, v) => `<div class="acct-row"><span>${esc(k)}</span><span>${esc(v || '—')}</span></div>`;
    // שיעור מע"מ חסר/לא מספרי — מציגים "—" ולא "NaN%"
    const vatPct = Number.isFinite(Number(st.vatRate)) ? (Number(st.vatRate) * 100).toFixed(2) + '%' : null;
    return `
      <div class="acct-grid">
        <div class="card">
          <h3>פרטי העסק</h3>
          ${row('שם העסק', b.name)}${row('ע.מ / ח.פ', b.taxId)}${row('כתובת', b.address)}${row('טלפון', b.phone)}${row('דוא"ל', b.email)}
        </div>
        <div class="card">
          <h3>הגדרות חשבונאות</h3>
          ${row('שיעור מע"מ', vatPct)}
          ${row('תקופה נעולה עד', st.lockDate)}
          <p class="muted">אחרי נעילת תקופה לא ניתן לרשום, לבטל או לגבות בתאריך שלפני הנעילה.</p>
        </div>
      </div>`;
  }

  function renderAcctPricing(products) {
    const list = products || [];
    return `
      <div class="acct-grid">
        <div class="card">
          <h3>מחשבון תמחור</h3>
          <label class="field"><span>עלות (₪)</span><input id="calcCost" type="number" min="0" step="0.01" value="100"></label>
          <label class="field"><span>אחוז רווח (%)</span><input id="calcMarkup" type="number" min="0" step="0.5" value="40"></label>
          <label class="field"><span>פטור ממע"מ</span><select id="calcExempt"><option value="no">לא</option><option value="yes">כן</option></select></label>
          <div id="calcOut" class="acct-lines"></div>
        </div>
      </div>
      <div class="acct-header"><h3>מחירון (${list.length})</h3>
        <div class="acct-actions"><button class="secondary" id="acctImportCsv">ייבוא מחירון מ-CSV</button></div></div>
      ${list.length === 0 ? renderEmpty('אין מוצרים או שירותים עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
      ${list.map(p => {
        // מוצר ישן שנשמר בלי בלוק תמחור מחושב — לא מפיל את כל המחירון
        const pr = (p && typeof p.pricing === 'object' && p.pricing) || {};
        return `
        <div class="card">
          <h4>${esc(p.name)}</h4>
          <small>${p.kind === 'service' ? 'שירות' : 'מוצר'}${p.vatExempt ? ' · פטור ממע"מ' : ''}</small>
          <div class="acct-lines">
            <div class="acct-row"><span>עלות</span><span>${money(pr.cost)}</span></div>
            <div class="acct-row"><span>רווח (${esc(p.markupPct)}%)</span><span>${money(pr.profit)}</span></div>
            <div class="acct-row"><span>מחיר לפני מע"מ</span><span>${money(pr.priceEx)}</span></div>
            <div class="acct-row acct-big"><span>מחיר לצרכן</span><span>${money(pr.priceInc)}</span></div>
          </div>
          ${renderCardActions(p.id)}
        </div>`;
      }).join('')}`;
  }

  async function refreshCalculator() {
    const out = document.getElementById('calcOut');
    if (!out) return;
    try {
      const r = await window.systemAPI.calcPrice({
        cost: document.getElementById('calcCost').value,
        markupPct: document.getElementById('calcMarkup').value,
        vatExempt: document.getElementById('calcExempt').value === 'yes'
      });
      out.innerHTML = `
        <div class="acct-row"><span>מחיר לפני מע"מ</span><span>${money(r.priceEx)}</span></div>
        <div class="acct-row"><span>מע"מ</span><span>${money(r.vat)}</span></div>
        <div class="acct-row acct-big"><span>מחיר לצרכן</span><span>${money(r.priceInc)}</span></div>
        <div class="acct-row"><span>רווח נקי</span><span>${money(r.profit)}</span></div>
        <div class="acct-row"><span>שיעור רווח ממחיר המכירה</span><span>${r.marginPct}%</span></div>`;
    } catch (error) {
      out.innerHTML = `<div class="bad">${esc(errMsg(error))}</div>`;
    }
  }

  function renderAcctPersonal(d) {
    const entries = Array.isArray(d?.entries) ? d.entries : [];
    // הגנת עומק: סיכום עשוי לחזור חסר או חסר שדות (גרסת נתונים ישנה / תשובת שרת חלקית).
    // אין להפיל את כל התצוגה בגלל שדה אחד — הכפתור היה מושבת שלא לצורך.
    const raw = d?.summary || {};
    const s = {
      income: Number(raw.income) || 0,
      expense: Number(raw.expense) || 0,
      balance: Number(raw.balance) || 0,
      categories: Array.isArray(raw.categories) ? raw.categories : []
    };
    return `
      <div class="acct-header">
        <div>הוצאות והכנסות אישיות/משפחתיות — <b>נשמרות בנפרד מהיומן העסקי</b> ואינן נכנסות לדוחות המע"מ והרווח של העסק.</div>
        <div class="acct-actions"><button class="secondary" id="acctCsvPersonal">ייצוא ל-Excel</button></div>
      </div>
      <div class="acct-grid">
        <div class="card">
          <h3>סיכום כללי</h3>
          <div class="acct-row"><span>הכנסות</span><span>${money(s.income)}</span></div>
          <div class="acct-row"><span>הוצאות</span><span>${money(s.expense)}</span></div>
          <div class="acct-row acct-big ${s.balance < 0 ? 'neg' : 'pos'}"><span>יתרה</span><span>${money(s.balance)}</span></div>
        </div>
        <div class="card">
          <h3>לפי קטגוריה</h3>
          ${s.categories.map(c => `<div class="acct-row"><span>${c.kind === 'income' ? 'הכנסה' : 'הוצאה'} · ${esc(c.category)}</span><span>${money(c.total)}</span></div>`).join('') || '<div class="acct-row muted">אין רשומות</div>'}
        </div>
      </div>
      <div class="acct-header"><h3>רשומות (${entries.length})</h3></div>
      ${entries.length === 0 ? renderEmpty('אין רשומות עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
      ${entries.map(e => `
        <div class="card">
          <h4>${e.kind === 'income' ? '⬆ הכנסה' : '⬇ הוצאה'} · ${esc(e.category)}</h4>
          <small>${esc(e.date)}${e.note ? ' · ' + esc(e.note) : ''}</small>
          <div class="acct-row acct-big"><span></span><span>${money(e.amount)}</span></div>
          ${renderCardActions(e.id)}
        </div>`).join('')}`;
  }

  async function handleImportCsv() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const r = await window.systemAPI.importProducts(await file.text());
        const failed = r.errors.length ? ` · ${r.errors.length} שורות נדחו (שורה ${r.errors.slice(0, 5).map(e => e.line).join(', ')})` : '';
        showToast(`יובאו ${r.added} מוצרים${failed}`);
        await switchView(state.currentView);
      } catch (error) {
        showError('שגיאה בייבוא: ' + errMsg(error));
      }
    });
    input.click();
  }

  async function handleUnpay(id) {
    if (!(await askConfirm('לבטל את סימון התשלום? תיווצר רשומת ביטול ביומן והחשבונית תחזור לפתוחה.'))) return;
    try {
      await window.systemAPI.unrecordPayment(id);
      showToast('התשלום בוטל');
      await switchView(state.currentView);
    } catch (error) {
      showError('שגיאה בביטול תשלום: ' + errMsg(error));
    }
  }

  async function handleCsv(kind) {
    try {
      const range = kind === 'journal' ? {} : acctPeriod();
      const r = await window.systemAPI.exportAccountingCsv(kind, range);
      if (r.ok) showToast('הקובץ נשמר');
    } catch (error) {
      showError('שגיאה בייצוא: ' + errMsg(error));
    }
  }

  async function handlePdf(id) {
    try {
      const r = await window.systemAPI.exportInvoicePdf(id);
      if (r.ok) showToast('קובץ ה-PDF נשמר');
    } catch (error) {
      showError('שגיאה בהפקת PDF: ' + errMsg(error));
    }
  }

  async function fillAccountSelects(schema) {
    const chart = await window.systemAPI.getChart();
    const opts = accountOptions(chart);
    for (const f of schema.fields) if (f.optionsFrom === 'chart') f.options = opts;
  }

  async function changeAcctPeriod() {
    const values = await askFields('תקופת דוחות (YYYY-MM-DD)', [
      { name: 'from', label: 'מתאריך' },
      { name: 'to', label: 'עד תאריך' }
    ], 'הצג', acctPeriod());
    if (!values) return;
    if (!isoOk(values.from) || !isoOk(values.to) || values.from > values.to) {
      showError('תאריכים לא תקינים — פורמט YYYY-MM-DD ותאריך התחלה לפני סיום');
      return;
    }
    state.acctPeriod = values;
    await switchView('acct-reports');
  }
  const isoOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

  async function handleCancelInvoice(id) {
    if (!(await askConfirm('לבטל את החשבונית? תירשם חשבונית זיכוי שמבטלת את ההכנסה והמע"מ. החשבונית תישאר ברשימה כמבוטלת.'))) return;
    try {
      await window.systemAPI.cancelInvoice(id);
      showToast('החשבונית בוטלה וירשמה חשבונית זיכוי');
      await switchView('acct-invoices');
    } catch (error) {
      showError('שגיאה בביטול: ' + errMsg(error));
    }
  }

  async function handlePay(id) {
    if (!(await askConfirm('לסמן את החשבונית כשולמה? תירשם גביה לבנק.'))) return;
    try {
      await window.systemAPI.recordPayment(id, { date: today() });
      showToast('החשבונית סומנה כשולמה');
      await switchView('acct-invoices');
    } catch (error) {
      showError('שגיאה בסימון תשלום: ' + errMsg(error));
    }
  }

  const acctFormSchemas = {
    'acct-journal': {
      title: 'רשומת יומן חדשה',
      prepare: fillAccountSelects,
      fields: [
        { name: 'date', label: 'תאריך', type: 'date', required: true },
        { name: 'description', label: 'תיאור', type: 'text', required: true },
        { name: 'debitAccount', label: 'חשבון חובה', type: 'select', required: true, optionsFrom: 'chart', options: [] },
        { name: 'creditAccount', label: 'חשבון זכות', type: 'select', required: true, optionsFrom: 'chart', options: [] },
        { name: 'amount', label: 'סכום (₪)', type: 'number', required: true }
      ],
      create: (d) => window.systemAPI.createEntry({
        date: d.date, description: d.description,
        lines: [{ account: d.debitAccount, debit: d.amount }, { account: d.creditAccount, credit: d.amount }]
      }),
      remove: (id) => window.systemAPI.reverseEntry(id),
      confirmText: 'לבטל את הרשומה? תירשם רשומת ביטול הפוכה; הרשומה המקורית נשמרת לביקורת.'
    },
    'acct-invoices': {
      title: 'חשבונית מס חדשה',
      prepare: async (schema) => {
        const products = await window.systemAPI.getProducts();
        const pick = schema.fields.find(f => f.name === 'productId');
        pick.options = [{ value: '', label: '— הזנה ידנית —' }, ...products.map(p => ({ value: p.id, label: `${p.name} · ${money(p.pricing.priceEx)} + מע"מ` }))];
        schema.products = products;
      },
      afterRender: () => {
        const sel = document.getElementById('f_productId');
        if (!sel) return;
        sel.addEventListener('change', () => {
          const p = (formSchemas['acct-invoices'].products || []).find(x => x.id === sel.value);
          if (!p) return;
          document.getElementById('f_description').value = p.name;
          document.getElementById('f_unitPrice').value = p.pricing.priceEx;
          document.getElementById('f_kind').value = p.kind;
          document.getElementById('f_vatExempt').value = p.vatExempt ? 'yes' : 'no';
        });
      },
      fields: [
        { name: 'productId', label: 'בחר מהמחירון (אופציונלי)', type: 'select', options: [] },
        { name: 'customer', label: 'שם לקוח', type: 'text', required: true },
        { name: 'date', label: 'תאריך', type: 'date', required: true },
        { name: 'description', label: 'תיאור פריט', type: 'text', required: true },
        { name: 'quantity', label: 'כמות', type: 'number' },
        { name: 'unitPrice', label: 'מחיר ליחידה לפני מע"מ (₪)', type: 'number', required: true },
        { name: 'kind', label: 'סוג', type: 'select', options: [{ value: 'goods', label: 'מוצר' }, { value: 'service', label: 'שירות' }] },
        { name: 'vatExempt', label: 'מע"מ', type: 'select', options: [{ value: 'no', label: 'כולל מע"מ' }, { value: 'yes', label: 'פטור ממע"מ' }] }
      ],
      create: (d) => window.systemAPI.createInvoice({
        customer: d.customer, date: d.date, vatExempt: d.vatExempt === 'yes',
        items: [{ description: d.description, quantity: d.quantity, unitPrice: d.unitPrice, kind: d.kind || 'goods' }]
      })
    },
    'acct-chart': {
      title: 'חשבון חדש',
      fields: [
        { name: 'code', label: 'קוד חשבון (4-6 ספרות)', type: 'text', required: true },
        { name: 'name', label: 'שם החשבון', type: 'text', required: true },
        { name: 'type', label: 'סוג', type: 'select', required: true, options: Object.entries(ACCT_TYPE_LABELS).map(([value, label]) => ({ value, label })) }
      ],
      create: (d) => window.systemAPI.addAccount(d)
    }
  };
  acctFormSchemas['acct-pricing'] = {
    title: 'מוצר או שירות חדש',
    fields: [
      { name: 'name', label: 'שם המוצר/שירות', type: 'text', required: true },
      { name: 'kind', label: 'סוג', type: 'select', options: [{ value: 'goods', label: 'מוצר' }, { value: 'service', label: 'שירות' }] },
      { name: 'cost', label: 'עלות (₪)', type: 'number', required: true },
      { name: 'markupPct', label: 'אחוז רווח רצוי (%)', type: 'number', required: true },
      { name: 'vatExempt', label: 'מע"מ', type: 'select', options: [{ value: 'no', label: 'כולל מע"מ' }, { value: 'yes', label: 'פטור ממע"מ' }] }
    ],
    create: (d) => window.systemAPI.addProduct({ ...d, vatExempt: d.vatExempt === 'yes' }),
    remove: (id) => window.systemAPI.deleteProduct(id),
    confirmText: 'למחוק את המוצר/השירות מהמחירון?'
  };
  acctFormSchemas['acct-personal'] = {
    title: 'רשומה אישית/משפחתית',
    fields: [
      { name: 'date', label: 'תאריך (YYYY-MM-DD)', type: 'date', required: true, value: new Date().toISOString().slice(0, 10) },
      { name: 'kind', label: 'סוג', type: 'select', options: [{ value: 'expense', label: 'הוצאה' }, { value: 'income', label: 'הכנסה' }] },
      { name: 'amount', label: 'סכום (₪)', type: 'number', required: true },
      { name: 'category', label: 'קטגוריה (למשל: מזון, חשמל, חינוך)', type: 'text', required: true },
      { name: 'note', label: 'הערה', type: 'text' }
    ],
    create: (d) => window.systemAPI.addPersonalEntry(d),
    remove: (id) => window.systemAPI.deletePersonalEntry(id),
    confirmText: 'למחוק את הרשומה האישית?'
  };
  acctFormSchemas['acct-settings'] = {
    title: 'הגדרות עסק ומע"מ',
    prepare: async (schema) => {
      const st = await window.systemAPI.getAccountingSettings();
      const b = st.business || {};
      const values = { name: b.name, taxId: b.taxId, address: b.address, phone: b.phone, email: b.email,
        vatPercent: +(st.vatRate * 100).toFixed(2), lockDate: st.lockDate };
      for (const f of schema.fields) f.value = values[f.name] ?? '';
    },
    fields: [
      { name: 'name', label: 'שם העסק', type: 'text', required: true },
      { name: 'taxId', label: 'ע.מ / ח.פ', type: 'text' },
      { name: 'address', label: 'כתובת', type: 'text' },
      { name: 'phone', label: 'טלפון', type: 'text' },
      { name: 'email', label: 'דוא"ל', type: 'text' },
      { name: 'vatPercent', label: 'שיעור מע"מ (%)', type: 'number', required: true },
      { name: 'lockDate', label: 'נעילת תקופה עד (YYYY-MM-DD, השאר ריק לביטול)', type: 'date' }
    ],
    create: (d) => window.systemAPI.saveAccountingSettings({
      business: { name: d.name, taxId: d.taxId, address: d.address, phone: d.phone, email: d.email },
      vatRate: Number(d.vatPercent) / 100,
      lockDate: d.lockDate || ''
    })
  };
  Object.assign(formSchemas, acctFormSchemas);

  // ============================================================
  // התוכנית הפיננסית — טופס עריכת פרטי התוכנית.
  // טופס "עריכה" במהותו: טוען את התוכנית הקיימת ומעדכן אותה.
  // (ראו TODO-FIXES.md — איחוד תצוגות הכפילות "תכנון פיננסי"/"התוכנית הפיננסית".)
  // ============================================================
  const pfOpts = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));
  formSchemas['personal-finance'] = {
    title: 'פריט חדש בתוכנית הפיננסית',
    editTitle: 'עריכת פריט בתוכנית',
    dynamic: true,
    fields: [
      { name: 'pfKind', label: 'סוג הפריט', type: 'select', required: true, options: pfOpts(PF_KINDS) },
      // הכנסה
      { name: 'source', label: 'מקור ההכנסה', type: 'text', required: true, kinds: ['incomes'] },
      { name: 'incomeCategory', label: 'קטגוריה', type: 'select', kinds: ['incomes'], options: pfOpts(PF_INCOME_CATS) },
      // הוצאה
      { name: 'category', label: 'קטגוריית ההוצאה', type: 'text', required: true, kinds: ['expenses'] },
      { name: 'isFixed', label: 'סוג ההוצאה', type: 'select', kinds: ['expenses'], options: [{ value: 'fixed', label: 'קבועה' }, { value: 'variable', label: 'משתנה' }] },
      // השקעה
      { name: 'name', label: 'שם ההשקעה', type: 'text', required: true, kinds: ['investments'] },
      { name: 'investType', label: 'סוג ההשקעה', type: 'select', kinds: ['investments'], options: pfOpts(PF_INVEST_TYPES) },
      { name: 'principal', label: 'סכום התחלתי (₪)', type: 'number', required: true, kinds: ['investments'] },
      { name: 'monthlyContribution', label: 'הפקדה חודשית (₪)', type: 'number', kinds: ['investments'] },
      { name: 'annualRate', label: 'תשואה שנתית צפויה (%)', type: 'number', required: true, kinds: ['investments'] },
      { name: 'years', label: 'מספר שנים', type: 'number', required: true, kinds: ['investments'] },
      // תנועת תזרים
      { name: 'date', label: 'תאריך', type: 'date', required: true, kinds: ['cashFlowEntries'] },
      { name: 'type', label: 'כיוון', type: 'select', kinds: ['cashFlowEntries'], options: [{ value: 'income', label: 'הכנסה' }, { value: 'expense', label: 'הוצאה' }] },
      // משותף
      { name: 'amount', label: 'סכום (₪)', type: 'number', required: true, kinds: ['incomes', 'expenses', 'cashFlowEntries'] },
      { name: 'frequency', label: 'תדירות', type: 'select', kinds: ['incomes', 'expenses'], options: [{ value: 'monthly', label: 'חודשי' }, { value: 'yearly', label: 'שנתי' }, { value: 'weekly', label: 'שבועי' }, { value: 'daily', label: 'יומי' }] },
      { name: 'description', label: 'תיאור', type: 'text', kinds: ['expenses', 'cashFlowEntries'] },
      { name: 'notes', label: 'הערות', type: 'textarea', kinds: ['incomes', 'expenses', 'investments'] }
    ],
    // שמות השדות בטופס ייחודיים לכל סוג (incomeCategory/investType) — ממופים כאן לשמות ברשומה
    toItem: (d) => {
      const kind = d.pfKind;
      const item = { ...d };
      delete item.pfKind;
      if (kind === 'incomes') { item.category = d.incomeCategory; delete item.incomeCategory; }
      if (kind === 'investments') { item.type = d.investType; delete item.investType; }
      if (kind === 'expenses') item.isFixed = d.isFixed !== 'variable';
      return { kind, item };
    },
    fromItem: (kind, r) => ({
      ...r, pfKind: kind,
      incomeCategory: kind === 'incomes' ? r.category : undefined,
      investType: kind === 'investments' ? r.type : undefined,
      isFixed: kind === 'expenses' ? (r.isFixed === false ? 'variable' : 'fixed') : r.isFixed,
      type: kind === 'cashFlowEntries' ? r.type : undefined
    }),
    create: (d) => { const { kind, item } = formSchemas['personal-finance'].toItem(d); return window.systemAPI.addFinanceItem(kind, item); }
  };

  // עריכת פרטי התוכנית (שם ומטבע) — טופס משני בתצוגה
  const pfPlanSchema = {
    title: 'פרטי התוכנית הפיננסית',
    fields: [
      { name: 'planName', label: 'שם התוכנית', type: 'text', required: true },
      { name: 'currency', label: 'מטבע', type: 'select', options: pfOpts(CURRENCY_LABELS) }
    ],
    create: async (d) => {
      // עדכון פרטי התוכנית בלבד — הפריטים נשמרים כמו שהם
      const plan = await window.systemAPI.getPersonalFinance() || {};
      return window.systemAPI.updatePersonalFinance({ ...plan, planName: d.planName, currency: d.currency });
    }
  };

  function attachPersonalFinanceHandlers() {
    const plan = document.getElementById('pfPlanBtn');
    if (plan) plan.addEventListener('click', () => {
      const p = state.data.personalFinance || {};
      openSubForm(pfPlanSchema, { planName: p.planName || 'התוכנית הפיננסית שלי', currency: p.currency || 'ILS' });
    });
    document.querySelectorAll('[data-pf-edit]').forEach(btn => btn.addEventListener('click', async () => {
      const kind = btn.dataset.pfEdit;
      const list = (state.data.personalFinance || {})[kind];
      const rec = Array.isArray(list) ? list.find(x => x.id === btn.dataset.id) : null;
      if (!rec) return;
      const base = formSchemas['personal-finance'];
      // עריכה: אותו טופס, נעול לסוג הפריט, ושמירה דרך updateFinanceItem
      const schema = {
        ...base,
        title: base.editTitle,
        fields: base.fields.map(f => (f.name === 'pfKind' ? { ...f, options: [{ value: kind, label: PF_KINDS[kind] }] } : f)),
        create: (d) => { const { item } = base.toItem({ ...d, pfKind: kind }); return window.systemAPI.updateFinanceItem(kind, rec.id, item); }
      };
      await openSubForm(schema, base.fromItem(kind, rec));
      attachDynamicFields(schema);
      // אחרי בניית השדות הדינמיים — ממלאים שוב את הערכים של הפריט
      const values = base.fromItem(kind, rec);
      for (const f of schema.fields) {
        const el = document.getElementById('f_' + f.name);
        if (el && values[f.name] !== undefined && values[f.name] !== null) el.value = String(values[f.name]);
      }
    }));
    document.querySelectorAll('[data-pf-del]').forEach(btn => btn.addEventListener('click', async () => {
      if (!(await askConfirm('למחוק את הפריט מהתוכנית?'))) return;
      try { await window.systemAPI.deleteFinanceItem(btn.dataset.pfDel, btn.dataset.id); showToast('הפריט נמחק'); await switchView('personal-finance'); }
      catch (error) { showError('שגיאה במחיקה: ' + errMsg(error)); }
    }));
  }

  // ============================================================
  // טפסים משניים: תצוגה עם יותר מטופס אחד (למשל "הגדרות עמותה" או "הצעת בנק").
  // הטופס המשני עובר באותו מסלול של הטופס הראשי (בנייה, איסוף, שמירה, סגירה).
  // ============================================================
  const currentSchema = () => state.subForm || formSchemas[state.currentView];

  async function openSubForm(schema, values = {}, editingId = null) {
    try {
      if (schema.prepare) await schema.prepare(schema, values);
    } catch (error) {
      showError('שגיאה בטעינת הטופס: ' + errMsg(error));
      return;
    }
    state.subForm = schema;
    state.editingId = editingId;
    showModal(editingId && schema.editTitle ? schema.editTitle : schema.title, buildFormHtml(schema.fields));
    for (const f of schema.fields) {
      const el = document.getElementById('f_' + f.name);
      const v = values[f.name] !== undefined && values[f.name] !== null ? values[f.name] : f.value;
      if (el && v !== undefined && v !== null) el.value = String(v);
    }
  }

  // ============================================================
  // עמותה — תרומות וקבלות סעיף 46, קרנות ייעודיות/כללי, תמיכות ודוח שנתי.
  // נפרד לחלוטין מהיומן העסקי: עמותה אינה עוסק, ותרומה אינה עסקה.
  // ============================================================
  const NPO_METHODS = { cash: 'מזומן', check: 'המחאה', transfer: 'העברה בנקאית', card: 'כרטיס אשראי', standing: 'הוראת קבע' };
  const NPO_GRANT_STATUS = { requested: 'הוגשה בקשה', approved: 'אושרה', paid: 'שולמה', rejected: 'נדחתה' };
  const NPO_VAT = { exempt: 'פטורה ממע"מ', malkar: 'מלכ"ר', osek: 'עוסק מורשה' };
  const npoYear = () => state.npoYear || (state.npoYear = new Date().getFullYear());
  const npoFundOptions = (o) => (Array.isArray(o && o.funds) ? o.funds : [{ id: 'general', name: 'כללי' }])
    .filter(f => !f.archived).map(f => ({ value: f.id, label: f.name + (f.restricted ? ' (ייעודי)' : '') }));
  const opts = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));

  formSchemas['npo'] = {
    title: 'תרומה חדשה — הפקת קבלה',
    prepare: async (schema) => {
      const o = await window.systemAPI.getNpoOverview(npoYear());
      schema.fields.find(f => f.name === 'fundId').options = npoFundOptions(o);
      schema.fields.find(f => f.name === 'date').value = today();
    },
    fields: [
      { name: 'date', label: 'תאריך התרומה', type: 'date', required: true },
      { name: 'donorName', label: 'שם התורם', type: 'text', required: true },
      { name: 'donorId', label: 'ת.ז / ח.פ של התורם', type: 'text' },
      { name: 'amount', label: 'סכום (₪)', type: 'number', required: true },
      { name: 'method', label: 'אמצעי תשלום', type: 'select', options: opts(NPO_METHODS) },
      { name: 'fundId', label: 'קרן', type: 'select', options: [] },
      { name: 'purpose', label: 'ייעוד / הערה לקבלה', type: 'text' },
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
      { name: 'purpose', label: 'ייעוד לקבלה', type: 'text' },
      { name: 'donorPhone', label: 'טלפון', type: 'tel' },
      { name: 'donorAddress', label: 'כתובת', type: 'text' },
      { name: 'notes', label: 'הערות (בלי פרטי אשראי או חשבון)', type: 'textarea' }
    ],
    create: (d) => window.systemAPI.saveNpoStandingOrder(null, { ...d, endMonth: d.endMonth || '' }),
    update: (id, d) => window.systemAPI.saveNpoStandingOrder(id, { ...d, endMonth: d.endMonth || '' })
  };

  function renderNpoStanding(st) {
    if (!st || !Array.isArray(st.rows)) return '';
    const rows = st.rows;
    const monthBtns = (r) => r.status === 'due' || r.status === 'missed' || r.status === 'upcoming'
      ? `<button class="secondary small" data-so-pay="${esc(r.id)}" data-so-month="${esc(st.month)}" title="התקבל — הפקת קבלה">✓ התקבל</button>
         <button class="secondary small" data-so-fail="${esc(r.id)}" data-so-month="${esc(st.month)}" title="החיוב נכשל">✗ נכשל</button>` : '';
    return `<div class="card acct-wide">
      <div class="hub-head"><h3>הוראות קבע — ${esc(st.month)}</h3>
        <div class="acct-actions"><button class="secondary" id="npoStandingAdd">＋ הוראת קבע</button></div></div>
      <p class="muted">מעקב בלבד: החיוב עצמו נעשה בבנק או בחברת האשראי. כאן מסמנים מה התקבל — וקבלה מופקת אוטומטית. פרטי אשראי וחשבון לא נשמרים.</p>
      <div class="kpis">
        <div class="kpi"><small>הוראות פעילות</small><strong>${Number(st.activeCount) || 0}</strong></div>
        <div class="kpi"><small>צפוי החודש</small><strong>${money(st.expected)}</strong></div>
        <div class="kpi pos"><small>התקבל החודש</small><strong>${money(st.received)}</strong></div>
        <div class="kpi${st.missedCount ? ' neg' : ''}"><small>חודשים שלא סומנו</small><strong>${Number(st.missedCount) || 0}</strong></div>
        <div class="kpi${st.atRisk ? ' neg' : ''}"><small>נכשלו פעמיים ברצף ומעלה</small><strong>${Number(st.atRisk) || 0}</strong></div>
      </div>
      ${rows.length === 0 ? renderEmpty('אין הוראות קבע עדיין') : `<div class="acct-scroll"><table class="acct-table">
        <thead><tr><th>תורם</th><th>סכום</th><th>יום</th><th>תקופה</th><th>החודש</th><th>פתוחים</th><th></th></tr></thead>
        <tbody>${rows.map(r => `<tr class="${r.ended ? 'muted' : ''}">
          <td>${esc(r.donorName)}${r.failures >= 2 ? ` <small class="bad">· ${r.failures} כישלונות ברצף</small>` : ''}</td>
          <td>${money(r.amount)}</td><td>${Number(r.dayOfMonth)}</td>
          <td><small>${esc(r.startMonth)}${r.endMonth ? ' – ' + esc(r.endMonth) : ' ואילך'}</small></td>
          <td><small class="${r.status === 'failed' || r.status === 'missed' ? 'bad' : r.status === 'received' ? 'ok' : 'muted'}">${esc(SO_STATUS[r.status] || r.status)}</small> ${monthBtns(r)}</td>
          <td>${(r.openMonths || []).filter(m => m !== st.month).map(m => `<button class="secondary small" data-so-pay="${esc(r.id)}" data-so-month="${esc(m)}" title="סימון התקבל לחודש ${esc(m)}">${esc(m)}</button>`).join(' ') || '—'}</td>
          <td><button class="icon-btn" data-so-edit="${esc(r.id)}" title="עריכה">✎</button>
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
          ${renderNpoStanding(o.standing)}
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
                  <td>${esc(d.receipt && d.receipt.number)}</td><td>${esc(d.date)}</td>
                  <td>${esc(d.donorName)}</td><td>${money(d.amount)}</td>
                  <td>${esc(NPO_METHODS[d.method] || d.method)}</td><td>${esc(funds[d.fundId] || 'כללי')}</td>
                  <td>${d.receipt && d.receipt.sec46 ? '✓' : '—'}</td>
                  <td><small class="${d.taxStatus === 'pending' || d.taxStatus === 'cancel-pending' ? 'bad' : 'muted'}">${esc(NPO_TAX[d.taxStatus] || '')}${d.taxReport && d.taxReport.registrationNumber ? ' · ' + esc(d.taxReport.registrationNumber) : ''}</small>
                    ${d.taxStatus === 'pending' || d.taxStatus === 'cancel-pending' ? `<button class="icon-btn" data-npo-tax="${esc(d.id)}" title="רישום דיווח לרשות המסים">🏛</button>` : ''}</td>
                  <td>${d.status === 'cancelled' ? 'מבוטלת' : ''}
                    <button class="icon-btn" data-npo-pdf="${esc(d.id)}" title="קבלה ל-PDF">📄</button>
                    ${d.status === 'cancelled' ? '' : `<button class="icon-btn danger" data-npo-cancel="${esc(d.id)}" title="ביטול קבלה">✖</button>`}
                  </td>
                </tr>`).join('')}</tbody>
            </table></div>`}
          </div>
          <div class="card">
            <h3>תמיכות ומענקים (${grants.length})</h3>
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
            ${donors.slice(0, 15).map(d => `<div class="acct-row"><span>${esc(d.name)} <small class="muted">${d.count} תרומות · אחרונה ${esc(d.lastDate)}</small></span><span>${money(d.total)} <button class="icon-btn" data-npo-statement="${esc(d.key)}" title="סיכום שנתי לתורם (PDF) — לבקשת החזר מס">📄</button></span></div>`).join('') || '<div class="acct-row muted">אין תורמים עדיין</div>'}
          </div>
        </div>
      </div>`;
  }

  function attachNpoHandlers() {
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    attachNpoStandingHandlers();
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
    document.querySelectorAll('[data-npo-export]').forEach(btn => btn.addEventListener('click', async () => {
      try { const r = await window.systemAPI.exportNpoCsv(btn.dataset.npoExport, npoYear()); if (r && r.ok) showToast('הקובץ נשמר'); }
      catch (error) { showError('שגיאה בייצוא: ' + errMsg(error)); }
    }));
  }

  // ============================================================
  // גמ"ח — קופת גמילות חסדים: הלוואות ללא ריבית, ערבים, לוח סילוקין, הפקדות ופיגורים.
  // נפרד לחלוטין מהעמותה (npo) ומהיומן העסקי: הלוואת גמ"ח אינה תרומה ואינה עסקה.
  // ============================================================
  const GEMACH_LOAN_STATUS = { active: 'פעילה', closed: 'נפרעה', cancelled: 'בוטלה' };
  const GEMACH_TIER_LABEL = {
    exempt: 'מתחת לסף הרישוי — ללא חובת רישוי',
    basic: 'מעל סף הרישוי הבסיסי — נדרש רישוי בסיסי (יש לאמת מול הרשות לשוק ההון)',
    extended: 'מעל סף הרישוי המורחב — נדרש רישוי מורחב (יש לאמת מול הרשות לשוק ההון)'
  };

  formSchemas['gemach'] = {
    title: 'בקשת הלוואה חדשה',
    prepare: (schema) => {
      schema.fields.find(f => f.name === 'issueDate').value = today();
    },
    fields: [
      { name: 'borrowerName', label: 'שם הלווה', type: 'text', required: true },
      { name: 'borrowerId', label: 'ת.ז של הלווה', type: 'text' },
      { name: 'borrowerPhone', label: 'טלפון הלווה', type: 'tel' },
      { name: 'borrowerAddress', label: 'כתובת הלווה', type: 'text' },
      { name: 'amount', label: 'סכום ההלוואה (₪)', type: 'number', required: true },
      { name: 'installments', label: 'מספר תשלומים חודשיים', type: 'number', required: true },
      { name: 'issueDate', label: 'תאריך מתן ההלוואה', type: 'date', required: true },
      { name: 'guarantorsText', label: 'ערבים — שורה לכל ערב: שם, ת.ז, טלפון', type: 'textarea' },
      { name: 'purpose', label: 'מטרת ההלוואה', type: 'text' },
      { name: 'notes', label: 'הערות', type: 'textarea' }
    ],
    create: (d) => window.systemAPI.addGemachLoan(d)
  };

  const gemachSettingsSchema = {
    title: 'הגדרות קופת הגמ"ח',
    fields: [
      { name: 'fundName', label: 'שם הקופה', type: 'text' },
      { name: 'notes', label: 'הערות כלליות', type: 'textarea' }
    ],
    create: (d) => window.systemAPI.saveGemachSettings(d)
  };

  const gemachDepositSchema = {
    title: 'הפקדה חדשה לקופה',
    prepare: (schema) => { schema.fields.find(f => f.name === 'date').value = today(); },
    fields: [
      { name: 'date', label: 'תאריך', type: 'date', required: true },
      { name: 'depositorName', label: 'שם המפקיד', type: 'text', required: true },
      { name: 'amount', label: 'סכום (₪)', type: 'number', required: true },
      { name: 'notes', label: 'הערות', type: 'text' }
    ],
    create: (d) => window.systemAPI.addGemachDeposit(d)
  };

  // טופס תשלום: נבנה בכל פתיחה עם loanId/seq/יתרה סגורים בלולאה, כדי שהשמירה תדע על איזה תשלום מדובר
  function gemachPaymentSchema(loanId, seq, remaining) {
    return {
      title: `רישום תשלום — תשלום מס' ${seq}`,
      prepare: (schema) => {
        schema.fields.find(f => f.name === 'amount').value = remaining;
        schema.fields.find(f => f.name === 'date').value = today();
      },
      fields: [
        { name: 'date', label: 'תאריך התשלום', type: 'date', required: true },
        { name: 'amount', label: `סכום (עד ${money(remaining)})`, type: 'number', required: true }
      ],
      create: (d) => window.systemAPI.recordGemachPayment(loanId, seq, d)
    };
  }

  function renderGemach(o) {
    if (!o || typeof o !== 'object') return renderEmpty('אין נתונים להצגה');
    const s = o.settings || {};
    const ov = o.overview || {};
    const loans = Array.isArray(o.loans) ? o.loans : [];
    const deposits = Array.isArray(o.deposits) ? o.deposits : [];
    const fullLoans = Object.fromEntries((state.data.gemachFull || []).map(l => [l.id, l]));
    return `
      <div class="gemach">
        <div class="acct-header">
          <div>
            <h3>${esc(s.fundName || 'קופת הגמ"ח')}</h3>
            <small class="muted">${esc(GEMACH_TIER_LABEL[ov.licenseTier] || GEMACH_TIER_LABEL.exempt)} · הסכומים להערכה בלבד — יש לאמת מול הרשות לשוק ההון</small>
          </div>
          <div class="acct-actions">
            <button class="secondary" id="gemachSettingsBtn">הגדרות קופה</button>
            <button class="secondary" id="gemachDepositBtn">＋ הפקדה</button>
          </div>
        </div>
        <div class="kpis">
          <div class="kpi"><small>יתרת קופה</small><strong>${money(ov.balance)}</strong></div>
          <div class="kpi"><small>הפקדות (סה"כ)</small><strong>${money(ov.depositsTotal)}</strong></div>
          <div class="kpi"><small>יתרת חוב פתוחה</small><strong>${money(ov.outstandingTotal)}</strong></div>
          <div class="kpi"><small>הלוואות פעילות</small><strong>${Number(ov.activeLoansCount) || 0}</strong></div>
          <div class="kpi${ov.lateLoansCount ? ' neg' : ''}"><small>הלוואות בפיגור</small><strong>${Number(ov.lateLoansCount) || 0}</strong></div>
          <div class="kpi${ov.lateTotal ? ' neg' : ''}"><small>סכום בפיגור</small><strong>${money(ov.lateTotal)}</strong></div>
        </div>
        <div class="acct-grid">
          <div class="card acct-wide">
            <h3>הלוואות (${loans.length})</h3>
            <div class="acct-actions">
              <button class="secondary" data-gemach-export="loans">ייצוא הלוואות</button>
              <button class="secondary" data-gemach-export="arrears">ייצוא פיגורים</button>
            </div>
            ${loans.length === 0 ? renderEmpty('אין הלוואות עדיין — לחץ "＋ הוספת רשומה" לבקשת הלוואה חדשה') : loans.map(l => `
              <details class="gemach-loan">
                <summary>
                  <span>${esc(l.borrowerName)} ${l.borrowerId ? `<small class="muted">ת.ז ${esc(l.borrowerId)}</small>` : ''}
                    <small class="muted">${esc(GEMACH_LOAN_STATUS[l.status] || l.status)}${l.lateCount ? ` · ${l.lateCount} תשלומים בפיגור` : ''}</small>
                  </span>
                  <span>${money(l.outstanding)} / ${money(l.amount)}
                    ${l.status === 'active' && !l.totalPaid ? `<button class="icon-btn danger" data-gemach-cancel="${esc(l.id)}" title="ביטול הלוואה">✖</button>` : ''}
                  </span>
                </summary>
                ${renderGemachSchedule(fullLoans[l.id], l.id)}
              </details>`).join('')}
          </div>
          <div class="card">
            <h3>הפקדות (${deposits.length})</h3>
            <div class="acct-actions"><button class="secondary" data-gemach-export="deposits">ייצוא הפקדות</button></div>
            ${deposits.map(d => `
              <div class="acct-row">
                <span>${esc(d.depositorName)} <small class="muted">${esc(d.date)}${d.notes ? ' · ' + esc(d.notes) : ''}</small></span>
                <span>${money(d.amount)}
                  <button class="icon-btn danger" data-gemach-deposit-del="${esc(d.id)}" title="מחיקה">🗑</button>
                </span>
              </div>`).join('') || '<div class="acct-row muted">אין הפקדות עדיין</div>'}
          </div>
        </div>
      </div>`;
  }

  // לוח סילוקין מלא לא מגיע בסקירה הראשית (כדי לא לטעון את כולה בכל הלוואה) — נטען לפי בקשה כש-<details> נפתח לראשונה
  function renderGemachSchedule(full, loanId) {
    if (!full) return `<div class="acct-scroll" data-gemach-schedule-for="${esc(loanId)}"><button class="secondary" data-gemach-load-schedule="${esc(loanId)}">טעינת לוח סילוקין</button></div>`;
    const rows = (full.schedule || []).map(row => `
      <tr class="${row.status === 'paid' ? 'muted' : ''}">
        <td>${row.seq}</td><td>${esc(row.dueDate)}</td><td>${money(row.amountAg / 100)}</td>
        <td>${money(row.paidAg / 100)}</td>
        <td>${row.status === 'paid' ? '✓ נפרע' : row.status === 'partial' ? 'חלקי' : 'ממתין'}</td>
        <td>${row.status !== 'paid' ? `<button class="icon-btn" data-gemach-pay="${esc(loanId)}" data-gemach-pay-seq="${row.seq}" data-gemach-pay-remaining="${(row.amountAg - row.paidAg) / 100}" title="רישום תשלום">💵</button>` : ''}</td>
      </tr>`).join('');
    const guarantors = (full.guarantors || []).map(g => esc(g.name)).join(', ');
    return `
      ${guarantors ? `<p class="muted">ערבים: ${guarantors}</p>` : ''}
      ${full.purpose ? `<p class="muted">מטרה: ${esc(full.purpose)}</p>` : ''}
      <div class="acct-scroll"><table class="acct-table">
        <thead><tr><th>#</th><th>מועד</th><th>סכום</th><th>שולם</th><th>סטטוס</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  function attachGemachHandlers() {
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('gemachSettingsBtn', () => openSubForm(gemachSettingsSchema, (state.data.gemach && state.data.gemach.settings) || {}));
    on('gemachDepositBtn', () => openSubForm(gemachDepositSchema));
    document.querySelectorAll('[data-gemach-deposit-del]').forEach(btn => btn.addEventListener('click', async () => {
      if (!(await askConfirm('למחוק את ההפקדה?'))) return;
      try { await window.systemAPI.deleteGemachDeposit(btn.dataset.gemachDepositDel); showToast('ההפקדה נמחקה'); await switchView('gemach'); }
      catch (error) { showError('שגיאה במחיקה: ' + errMsg(error)); }
    }));
    document.querySelectorAll('[data-gemach-cancel]').forEach(btn => btn.addEventListener('click', async () => {
      if (!(await askConfirm('לבטל את ההלוואה?'))) return;
      try { await window.systemAPI.cancelGemachLoan(btn.dataset.gemachCancel); showToast('ההלוואה בוטלה'); await switchView('gemach'); }
      catch (error) { showError('שגיאה בביטול: ' + errMsg(error)); }
    }));
    document.querySelectorAll('[data-gemach-export]').forEach(btn => btn.addEventListener('click', async () => {
      try { const r = await window.systemAPI.exportGemachCsv(btn.dataset.gemachExport); if (r && r.ok) showToast('הקובץ נשמר'); }
      catch (error) { showError('שגיאה בייצוא: ' + errMsg(error)); }
    }));
    document.querySelectorAll('[data-gemach-load-schedule]').forEach(btn => btn.addEventListener('click', async () => {
      try {
        const loan = await window.systemAPI.getGemachLoan(btn.dataset.gemachLoadSchedule);
        state.data.gemachFull = [...(state.data.gemachFull || []).filter(l => l.id !== loan.id), loan];
        renderView('gemach');
      } catch (error) { showError('שגיאה בטעינת לוח הסילוקין: ' + errMsg(error)); }
    }));
    document.querySelectorAll('[data-gemach-pay]').forEach(btn => btn.addEventListener('click', () => {
      openSubForm(gemachPaymentSchema(btn.dataset.gemachPay, Number(btn.dataset.gemachPaySeq), Number(btn.dataset.gemachPayRemaining)));
    }));
  }

  // ============================================================
  // חסד וחלוקות — נזקקים (כולל חסויים), מתנדבים וסבבי חלוקה: שיוך, שיבוץ מתנדב ומסירה.
  // פרטי נזקק חסוי מוסתרים כבר בצד השרת למי שאינו מנהל; המסך רק מציג את מה שקיבל.
  // ============================================================
  const CHESED_TIERS = { regular: 'רגיל', confidential: 'חסוי (מתן בסתר)' };
  const CHESED_DIVISIONS = { none: 'ללא הפרדה', men: 'מחלקת גברים', women: 'מחלקת נשים' };
  const CHESED_RULES = { perFamily: 'מנה אחת לכל משפחה', bySize: 'לפי גודל המשפחה' };
  const CHESED_ACTIVE = { yes: 'פעיל', no: 'לא פעיל' };
  const activeVal = (r) => (r && r.active === false ? 'no' : 'yes');

  const chesedBeneficiaryFields = [
    { name: 'familyName', label: 'שם המשפחה', type: 'text', required: true },
    { name: 'headName', label: 'שם ראש המשפחה', type: 'text' },
    { name: 'idNumber', label: 'ת.ז', type: 'text' },
    { name: 'familySize', label: 'מספר נפשות', type: 'number' },
    { name: 'phone', label: 'טלפון', type: 'tel' },
    { name: 'address', label: 'כתובת', type: 'text' },
    { name: 'area', label: 'אזור / שכונה (לחלוקה לפי מסלולים)', type: 'text' },
    { name: 'tier', label: 'רמת חיסיון', type: 'select', options: opts(CHESED_TIERS) },
    { name: 'active', label: 'סטטוס', type: 'select', options: opts(CHESED_ACTIVE) },
    { name: 'notes', label: 'הערות', type: 'textarea' }
  ];

  formSchemas['chesed'] = {
    title: 'נזקק חדש',
    fields: chesedBeneficiaryFields,
    create: (d) => window.systemAPI.addChesedBeneficiary(d)
  };

  const chesedBeneficiaryEditSchema = {
    title: 'נזקק חדש',
    editTitle: 'עריכת נזקק',
    fields: chesedBeneficiaryFields,
    create: (d) => window.systemAPI.addChesedBeneficiary(d),
    update: (id, d) => window.systemAPI.updateChesedBeneficiary(id, d)
  };

  const chesedVolunteerSchema = {
    title: 'מתנדב חדש',
    editTitle: 'עריכת מתנדב',
    fields: [
      { name: 'name', label: 'שם המתנדב', type: 'text', required: true },
      { name: 'phone', label: 'טלפון', type: 'tel' },
      { name: 'division', label: 'מחלקה', type: 'select', options: opts(CHESED_DIVISIONS) },
      { name: 'area', label: 'אזור', type: 'text' },
      { name: 'availability', label: 'זמינות (למשל: ערבי חמישי)', type: 'text' },
      { name: 'active', label: 'סטטוס', type: 'select', options: opts(CHESED_ACTIVE) },
      { name: 'notes', label: 'הערות', type: 'text' }
    ],
    create: (d) => window.systemAPI.addChesedVolunteer(d),
    update: (id, d) => window.systemAPI.updateChesedVolunteer(id, d)
  };

  const chesedRoundSchema = {
    title: 'סבב חלוקה חדש',
    prepare: (schema) => { schema.fields.find(f => f.name === 'date').value = today(); },
    fields: [
      { name: 'name', label: 'שם הסבב (למשל: קמחא דפסחא)', type: 'text', required: true },
      { name: 'date', label: 'תאריך החלוקה', type: 'date', required: true },
      { name: 'item', label: 'מה מחלקים (תיאור המנה)', type: 'text' },
      { name: 'unitValue', label: 'שווי מנה (₪)', type: 'number' },
      { name: 'rule', label: 'כלל שיוך', type: 'select', options: opts(CHESED_RULES) },
      { name: 'personsPerUnit', label: 'נפשות למנה (בכלל "לפי גודל")', type: 'number', value: 4 },
      { name: 'division', label: 'שיבוץ מתנדבים מתוך', type: 'select', options: opts(CHESED_DIVISIONS) },
      { name: 'notes', label: 'הערות', type: 'textarea' }
    ],
    create: (d) => window.systemAPI.addChesedRound(d)
  };

  function renderChesedRound(r, benById, volunteers) {
    const s = r.summary || {};
    const closed = r.status === 'closed';
    const div = r.division && r.division !== 'none' ? r.division : '';
    const pool = volunteers.filter(v => v.active !== false && (!div || v.division === div));
    const rows = (r.allocations || []).map(a => {
      const b = benById[a.beneficiaryId] || { familyName: '(נמחק)', area: '', address: '' };
      const volOpts = ['<option value="">— לא שובץ —</option>']
        .concat(pool.map(v => `<option value="${esc(v.id)}"${v.id === a.volunteerId ? ' selected' : ''}>${esc(v.name)}</option>`));
      // מתנדב ששובץ ואינו במאגר הנוכחי (לא פעיל) — עדיין מוצג כדי לא להיעלם מהרשימה
      if (a.volunteerId && !pool.some(v => v.id === a.volunteerId)) {
        const v = volunteers.find(x => x.id === a.volunteerId);
        volOpts.push(`<option value="${esc(a.volunteerId)}" selected>${esc(v ? v.name + ' (לא פעיל)' : '(נמחק)')}</option>`);
      }
      return `
        <tr>
          <td>${esc(b.familyName)}${b.masked ? ' <small class="muted">🔒</small>' : ''}</td>
          <td>${esc(b.area || '')}</td><td>${esc(b.address || '')}</td><td>${Number(a.units) || 0}</td>
          <td><select data-chesed-assign="${esc(r.id)}" data-ben="${esc(a.beneficiaryId)}"${closed ? ' disabled' : ''}>${volOpts.join('')}</select></td>
          <td><label><input type="checkbox" data-chesed-deliver="${esc(r.id)}" data-ben="${esc(a.beneficiaryId)}"${a.delivered ? ' checked' : ''}${closed ? ' disabled' : ''}> ${a.delivered ? esc(a.deliveredAt) : ''}</label></td>
        </tr>`;
    }).join('');
    return `
      <details class="chesed-round" data-chesed-round="${esc(r.id)}"${state.chesedOpenRound === r.id ? ' open' : ''}>
        <summary>
          <span>${esc(r.name)} <small class="muted">${esc(r.date)}${r.item ? ' · ' + esc(r.item) : ''}${div ? ' · ' + esc(CHESED_DIVISIONS[div]) : ''} · ${closed ? 'סגור' : 'פתוח'}</small></span>
          <span>${Number(s.delivered) || 0}/${Number(s.families) || 0} נמסרו · ${Number(s.units) || 0} מנות${s.totalValue ? ' · ' + money(s.totalValue) : ''}</span>
        </summary>
        <div class="acct-actions">
          ${closed ? '' : `<button class="secondary" data-chesed-allocate="${esc(r.id)}">שיוך כל הנזקקים הפעילים</button>`}
          <button class="secondary" data-chesed-export-round="${esc(r.id)}">ייצוא רשימת חלוקה למתנדבים</button>
          ${closed ? '' : `<button class="secondary" data-chesed-close="${esc(r.id)}">סגירת הסבב</button>`}
          ${s.delivered ? '' : `<button class="icon-btn danger" data-chesed-round-del="${esc(r.id)}" title="מחיקת הסבב">🗑</button>`}
        </div>
        ${s.unassigned && !closed ? `<p class="muted">${s.unassigned} משפחות עדיין לא שובצו למתנדב</p>` : ''}
        ${rows ? `<div class="acct-scroll"><table class="acct-table">
          <thead><tr><th>משפחה</th><th>אזור</th><th>כתובת</th><th>מנות</th><th>מתנדב</th><th>נמסר</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>` : '<p class="muted">עדיין לא שויכו נזקקים — לחץ "שיוך כל הנזקקים הפעילים"</p>'}
      </details>`;
  }

  function renderChesed(o) {
    if (!o || typeof o !== 'object') return renderEmpty('אין נתונים להצגה');
    const bens = Array.isArray(o.beneficiaries) ? o.beneficiaries : [];
    const vols = Array.isArray(o.volunteers) ? o.volunteers : [];
    const rounds = Array.isArray(o.rounds) ? o.rounds : [];
    const benById = Object.fromEntries(bens.map(b => [b.id, b]));
    const activeBens = bens.filter(b => b.active !== false);
    const openRounds = rounds.filter(r => r.status !== 'closed');
    const pending = openRounds.reduce((t, r) => t + ((r.summary && r.summary.families) || 0) - ((r.summary && r.summary.delivered) || 0), 0);
    return `
      <div class="chesed">
        <div class="acct-header">
          <div>
            <h3>חסד וחלוקות</h3>
            <small class="muted">${o.canSeeConfidential ? 'מוצגים כל הפרטים, כולל נזקקים חסויים' : 'פרטי נזקקים חסויים מוסתרים (מוצגים למנהל בלבד)'}</small>
          </div>
          <div class="acct-actions">
            <button class="secondary" id="chesedRoundBtn">＋ סבב חלוקה</button>
            <button class="secondary" id="chesedVolunteerBtn">＋ מתנדב</button>
          </div>
        </div>
        <div class="kpis">
          <div class="kpi"><small>נזקקים פעילים</small><strong>${activeBens.length}</strong></div>
          <div class="kpi"><small>מתוכם חסויים</small><strong>${activeBens.filter(b => b.tier === 'confidential').length}</strong></div>
          <div class="kpi"><small>מתנדבים פעילים</small><strong>${vols.filter(v => v.active !== false).length}</strong></div>
          <div class="kpi"><small>סבבים פתוחים</small><strong>${openRounds.length}</strong></div>
          <div class="kpi${pending ? ' neg' : ''}"><small>משפחות שטרם קיבלו</small><strong>${pending}</strong></div>
        </div>
        <div class="acct-grid">
          <div class="card acct-wide">
            <h3>סבבי חלוקה (${rounds.length})</h3>
            ${rounds.length ? rounds.map(r => renderChesedRound(r, benById, vols)).join('') : renderEmpty('אין סבבי חלוקה — לחץ "＋ סבב חלוקה"')}
          </div>
          <div class="card">
            <div class="acct-header"><h3>נזקקים (${bens.length})</h3><button class="secondary small" data-chesed-export="beneficiaries">ייצוא</button></div>
            ${bens.map(b => `
              <div class="acct-row${b.active === false ? ' muted' : ''}">
                <span>${esc(b.familyName)}${b.headName ? ' · ' + esc(b.headName) : ''}${b.masked ? ' 🔒' : ''}
                  <small class="muted">${Number(b.familySize) || 1} נפשות${b.area ? ' · ' + esc(b.area) : ''}${b.tier === 'confidential' && !b.masked ? ' · חסוי' : ''}${b.active === false ? ' · לא פעיל' : ''}</small></span>
                <span>
                  ${b.masked ? '' : `<button class="icon-btn" data-chesed-ben-edit="${esc(b.id)}" title="עריכה">✎</button>`}
                  <button class="icon-btn danger" data-chesed-ben-del="${esc(b.id)}" title="מחיקה">🗑</button>
                </span>
              </div>`).join('') || '<div class="acct-row muted">אין נזקקים — לחץ "＋ הוספת רשומה"</div>'}
          </div>
          <div class="card">
            <div class="acct-header"><h3>מתנדבים (${vols.length})</h3><button class="secondary small" data-chesed-export="volunteers">ייצוא</button></div>
            ${vols.map(v => `
              <div class="acct-row${v.active === false ? ' muted' : ''}">
                <span>${esc(v.name)} <small class="muted">${esc(CHESED_DIVISIONS[v.division] || '')}${v.area ? ' · ' + esc(v.area) : ''}${v.availability ? ' · ' + esc(v.availability) : ''}${v.phone ? ' · ' + esc(v.phone) : ''}</small></span>
                <span>
                  <button class="icon-btn" data-chesed-vol-edit="${esc(v.id)}" title="עריכה">✎</button>
                  <button class="icon-btn danger" data-chesed-vol-del="${esc(v.id)}" title="מחיקה">🗑</button>
                </span>
              </div>`).join('') || '<div class="acct-row muted">אין מתנדבים עדיין</div>'}
          </div>
        </div>
      </div>`;
  }

  function attachChesedHandlers() {
    const data = state.data.chesed || {};
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    const all = (sel, ev, fn) => document.querySelectorAll(sel).forEach(el => el.addEventListener(ev, () => fn(el)));
    // פעולה שמרעננת את התצוגה — שומרים איזה סבב היה פתוח כדי שלא ייסגר אחרי כל סימון
    const act = async (fn, okMsg, errPrefix) => {
      try { await fn(); if (okMsg) showToast(okMsg); await switchView('chesed'); }
      catch (error) { showError(errPrefix + errMsg(error)); await switchView('chesed'); }
    };
    on('chesedRoundBtn', () => openSubForm(chesedRoundSchema));
    on('chesedVolunteerBtn', () => openSubForm(chesedVolunteerSchema));
    all('[data-chesed-round]', 'toggle', (el) => { if (el.open) state.chesedOpenRound = el.dataset.chesedRound; else if (state.chesedOpenRound === el.dataset.chesedRound) state.chesedOpenRound = null; });
    all('[data-chesed-ben-edit]', 'click', (el) => {
      const b = (data.beneficiaries || []).find(x => x.id === el.dataset.chesedBenEdit);
      if (b) openSubForm(chesedBeneficiaryEditSchema, { ...b, active: activeVal(b) }, b.id);
    });
    all('[data-chesed-ben-del]', 'click', async (el) => {
      if (!(await askConfirm('למחוק את הנזקק?'))) return;
      act(() => window.systemAPI.deleteChesedBeneficiary(el.dataset.chesedBenDel), 'הנזקק נמחק', 'שגיאה במחיקה: ');
    });
    all('[data-chesed-vol-edit]', 'click', (el) => {
      const v = (data.volunteers || []).find(x => x.id === el.dataset.chesedVolEdit);
      if (v) openSubForm(chesedVolunteerSchema, { ...v, active: activeVal(v) }, v.id);
    });
    all('[data-chesed-vol-del]', 'click', async (el) => {
      if (!(await askConfirm('למחוק את המתנדב?'))) return;
      act(() => window.systemAPI.deleteChesedVolunteer(el.dataset.chesedVolDel), 'המתנדב נמחק', 'שגיאה במחיקה: ');
    });
    all('[data-chesed-allocate]', 'click', (el) => act(async () => {
      const r = await window.systemAPI.allocateChesedRound(el.dataset.chesedAllocate);
      showToast(r.added ? `שויכו ${r.added} משפחות` : 'כל הנזקקים הפעילים כבר משויכים');
    }, '', 'שגיאה בשיוך: '));
    all('[data-chesed-assign]', 'change', (el) => act(
      () => window.systemAPI.assignChesedVolunteer(el.dataset.chesedAssign, el.dataset.ben, el.value), '', 'שגיאה בשיבוץ: '));
    all('[data-chesed-deliver]', 'change', (el) => act(
      () => window.systemAPI.markChesedDelivered(el.dataset.chesedDeliver, el.dataset.ben, el.checked, today()), '', 'שגיאה בעדכון מסירה: '));
    all('[data-chesed-close]', 'click', async (el) => {
      if (!(await askConfirm('לסגור את הסבב? לאחר הסגירה לא ניתן לשנות שיבוצים ומסירות.'))) return;
      act(() => window.systemAPI.closeChesedRound(el.dataset.chesedClose), 'הסבב נסגר', 'שגיאה בסגירה: ');
    });
    all('[data-chesed-round-del]', 'click', async (el) => {
      if (!(await askConfirm('למחוק את סבב החלוקה?'))) return;
      act(() => window.systemAPI.deleteChesedRound(el.dataset.chesedRoundDel), 'הסבב נמחק', 'שגיאה במחיקה: ');
    });
    all('[data-chesed-export]', 'click', async (el) => {
      try { const r = await window.systemAPI.exportChesedCsv(el.dataset.chesedExport); if (r && r.ok) showToast('הקובץ נשמר'); }
      catch (error) { showError('שגיאה בייצוא: ' + errMsg(error)); }
    });
    all('[data-chesed-export-round]', 'click', async (el) => {
      try { const r = await window.systemAPI.exportChesedCsv('round', el.dataset.chesedExportRound); if (r && r.ok) showToast('רשימת החלוקה נשמרה'); }
      catch (error) { showError('שגיאה בייצוא: ' + errMsg(error)); }
    });
  }

  // ============================================================
  // ייעוץ משכנתאות — תיקי לקוחות, מחשבון מסלולים, השוואת הצעות בנקים, עמלה ומסמכים
  // ============================================================
  const MADV_STATUS = { preparing: 'בהכנה', submitted: 'הוגש', 'approved-principle': 'אושר עקרונית', 'approved-final': 'אושר סופי' };
  const MADV_TRACKS = [
    ['fixed-indexed', 'קבועה צמודה'], ['fixed-unindexed', 'קבועה לא צמודה'],
    ['variable-5', 'משתנה כל 5 שנים'], ['prime', 'פריים']
  ];
  const trackFields = () => MADV_TRACKS.flatMap(([k, label]) => [
    { name: `${k}_amount`, label: `${label} — סכום (₪)`, type: 'number' },
    { name: `${k}_rate`, label: `${label} — ריבית שנתית (%)`, type: 'number' },
    { name: `${k}_years`, label: `${label} — תקופה (שנים)`, type: 'number' }
  ]);

  formSchemas['mortgage-advisor'] = {
    title: 'תיק לקוח חדש',
    fields: [
      { name: 'name', label: 'שם הלקוח', type: 'text', required: true },
      { name: 'phone', label: 'טלפון', type: 'tel' },
      { name: 'bank', label: 'בנק מוביל', type: 'text' },
      { name: 'requestedAmount', label: 'סכום מבוקש (₪)', type: 'number', required: true },
      { name: 'propertyValue', label: 'שווי הנכס (₪)', type: 'number' },
      { name: 'status', label: 'סטטוס', type: 'select', options: opts(MADV_STATUS) },
      { name: 'feeType', label: 'סוג עמלת ייעוץ', type: 'select', options: [
        { value: 'percent', label: 'אחוז מהסכום המבוקש' },
        { value: 'fixed', label: 'סכום קבוע' }
      ]},
      { name: 'feeValue', label: 'עמלה (% או ₪, לפני מע"מ)', type: 'number' },
      { name: 'notes', label: 'הערות', type: 'textarea' }
    ],
    create: (d) => window.systemAPI.createMortgageClient(d),
    update: (id, d) => window.systemAPI.updateMortgageClient(id, d),
    remove: (id) => window.systemAPI.deleteMortgageClient(id),
    confirmText: 'למחוק את תיק הלקוח וכל הצעות הבנקים שלו? הפעולה אינה ניתנת לביטול.'
  };

  const madvOfferSchema = {
    title: 'הצעת בנק חדשה',
    prepare: async (schema) => {
      const o = state.data.mortgageAdvisor || {};
      schema.fields.find(f => f.name === 'clientId').options = (Array.isArray(o.clients) ? o.clients : []).map(c => ({ value: c.id, label: c.name }));
      schema.fields.find(f => f.name === 'date').value = today();
    },
    fields: [
      { name: 'clientId', label: 'לקוח', type: 'select', required: true, options: [] },
      { name: 'bank', label: 'בנק', type: 'text', required: true },
      { name: 'date', label: 'תאריך ההצעה', type: 'date' },
      { name: 'cpi', label: 'הנחת מדד שנתית למסלול צמוד (%)', type: 'number' },
      ...trackFields(),
      { name: 'notes', label: 'הערות', type: 'textarea' }
    ],
    create: (d) => window.systemAPI.addMortgageOffer(d)
  };

  function madvSummaryHtml(sum, yearly) {
    return `
      <div class="acct-row"><span>סכום ההלוואה</span><span>${money(sum.principal)}</span></div>
      <div class="acct-row"><span>החזר חודשי ראשון</span><span>${money(sum.firstPayment)}</span></div>
      <div class="acct-row"><span>החזר חודשי מקסימלי</span><span>${money(sum.maxPayment)}</span></div>
      <div class="acct-row"><span>סה"כ ריבית</span><span>${money(sum.totalInterest)}</span></div>
      <div class="acct-row"><span>סה"כ הצמדה</span><span>${money(sum.totalIndexation)}</span></div>
      <div class="acct-row acct-big"><span>סה"כ תשלומים</span><span>${money(sum.totalPaid)}</span></div>
      ${Array.isArray(yearly) && yearly.length ? `
      <details><summary>לוח סילוקין שנתי (${yearly.length} שנים)</summary>
        <div class="acct-scroll"><table class="acct-table">
          <thead><tr><th>שנה</th><th>תשלומים</th><th>ריבית</th><th>קרן</th><th>הצמדה</th><th>יתרה</th></tr></thead>
          <tbody>${yearly.map(y => `<tr><td>${y.year}</td><td>${money(y.payment)}</td><td>${money(y.interest)}</td><td>${money(y.principal)}</td><td>${money(y.indexation)}</td><td>${money(y.balance)}</td></tr>`).join('')}</tbody>
        </table></div>
      </details>` : ''}`;
  }

  function renderMortgageAdvisor(o) {
    const clients = Array.isArray(o && o.clients) ? o.clients : [];
    return `
      <div class="mortgage-advisor">
        <div class="card">
          <h3>מחשבון מסלולים</h3>
          <p class="muted">הזן סכום, ריבית ותקופה לכל מסלול רלוונטי. ריבית במשתנה ובפריים מחושבת כקבועה לאורך התקופה; המדד הוא הנחה שלך.</p>
          <div class="acct-scroll"><table class="acct-table">
            <thead><tr><th>מסלול</th><th>סכום (₪)</th><th>ריבית (%)</th><th>שנים</th></tr></thead>
            <tbody>${MADV_TRACKS.map(([k, label]) => `<tr><td>${label}</td>
              <td><input type="number" id="calc_${k}_amount" min="0"></td>
              <td><input type="number" id="calc_${k}_rate" step="0.01" min="0"></td>
              <td><input type="number" id="calc_${k}_years" min="1" max="35"></td></tr>`).join('')}</tbody>
          </table></div>
          <div class="acct-actions">
            <label>מדד שנתי (%) <input type="number" id="calc_cpi" step="0.1" value="2"></label>
            <button id="madvCalcBtn">חשב</button>
            <button class="secondary" data-goto="mortgage-lab">מעבדת תמהיל מלאה ←</button>
            <button class="secondary" id="madvOfferBtn"${clients.length ? '' : ' disabled'}>＋ הצעת בנק ללקוח</button>
          </div>
          <div id="madvCalcOut"></div>
        </div>
        <h3>תיקי לקוחות (${clients.length})</h3>
        ${clients.length === 0 ? renderEmpty('אין תיקי לקוחות עדיין — לחץ "＋ הוספת רשומה" כדי לפתוח תיק') : ''}
        ${clients.map(c => {
          const docs = c.docs && Array.isArray(c.docs.items) ? c.docs : { done: 0, total: 0, items: [] };
          const fee = c.fee || {};
          const cmp = Array.isArray(c.comparison) ? c.comparison : [];
          const offers = Array.isArray(c.offers) ? c.offers : [];
          return `
          <div class="card">
            <div class="acct-header">
              <div>
                <h4>${esc(c.name)}${c.phone ? ` <small class="muted">${esc(c.phone)}</small>` : ''}</h4>
                <small>${c.bank ? esc(c.bank) + ' · ' : ''}מבוקש ${money(c.requestedAmount)}${c.ltv != null ? ` · מימון ${c.ltv}%` : ''}</small>
              </div>
              <div class="acct-actions">
                <select data-madv-status="${esc(c.id)}">${Object.entries(MADV_STATUS).map(([v, l]) => `<option value="${v}"${c.status === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
                ${renderCardActions(c.id)}
              </div>
            </div>
            <div class="acct-grid">
              <div>
                <h4>עמלת ייעוץ</h4>
                <div class="acct-row"><span>לפני מע"מ ${c.feeType === 'percent' ? `(${Number(c.feeValue) || 0}%)` : ''}</span><span>${money(fee.net)}</span></div>
                <div class="acct-row"><span>מע"מ</span><span>${money(fee.vat)}</span></div>
                <div class="acct-row acct-total"><span>סה"כ</span><span>${money(fee.total)}</span></div>
              </div>
              <div>
                <h4>מסמכים (${docs.done}/${docs.total})</h4>
                ${docs.items.map(d => `<label class="doc-check"><input type="checkbox" data-madv-doc="${esc(c.id)}" data-key="${esc(d.key)}"${d.done ? ' checked' : ''}> ${esc(d.label)}</label>`).join('')}
              </div>
            </div>
            <h4>השוואת הצעות (${cmp.length})</h4>
            ${cmp.length === 0 ? '<div class="acct-row muted">אין הצעות עדיין</div>' : `
            <div class="acct-scroll"><table class="acct-table">
              <thead><tr><th>בנק</th><th>החזר ראשון</th><th>החזר מקסימלי</th><th>סה"כ תשלומים</th><th>עלות האשראי</th><th>פער מהזולה</th><th></th></tr></thead>
              <tbody>${cmp.map(r => `<tr>
                <td>${esc(r.bank)}${r.cheapest ? ' <span class="ok">★ הזולה</span>' : ''}${r.lowestFirstPayment ? ' <span class="ok">החזר נמוך</span>' : ''}</td>
                <td>${money(r.firstPayment)}</td><td>${money(r.maxPayment)}</td><td>${money(r.totalPaid)}</td>
                <td>${money(r.costOfCredit)}</td><td>${money(r.diffFromBest)}</td>
                <td><button class="icon-btn" data-madv-export="${esc(r.id)}" title="ייצוא לוח סילוקין">📊</button>
                    <button class="icon-btn danger" data-madv-offer-del="${esc(r.id)}" title="מחיקת הצעה">🗑</button></td>
              </tr>`).join('')}</tbody>
            </table></div>
            ${offers.map(of => `<details><summary>${esc(of.bank)} — פירוט מסלולים</summary>
              ${(of.summary && Array.isArray(of.summary.tracks) ? of.summary.tracks : []).map(t => `<div class="acct-row"><span>${esc(t.label)}</span><span>${money(t.amount)} · ${t.rate}% · ${t.years} שנים</span></div>`).join('')}
              ${of.summary ? madvSummaryHtml(of.summary, of.yearly) : ''}
            </details>`).join('')}`}
            ${c.notes ? `<p class="muted">${esc(c.notes)}</p>` : ''}
          </div>`;
        }).join('')}
      </div>`;
  }

  function attachMadvHandlers() {
    const calcBtn = document.getElementById('madvCalcBtn');
    if (calcBtn) calcBtn.addEventListener('click', async () => {
      const input = { cpi: (document.getElementById('calc_cpi') || {}).value };
      for (const [k] of MADV_TRACKS) for (const p of ['amount', 'rate', 'years']) {
        const el = document.getElementById(`calc_${k}_${p}`);
        if (el && el.value !== '') input[`${k}_${p}`] = Number(el.value);
      }
      const out = document.getElementById('madvCalcOut');
      try {
        const r = await window.systemAPI.calcMortgageTracks(input);
        if (out) out.innerHTML = madvSummaryHtml(r.summary, r.yearly);
      } catch (error) { showError('שגיאה בחישוב: ' + errMsg(error)); }
    });
    const offerBtn = document.getElementById('madvOfferBtn');
    if (offerBtn) offerBtn.addEventListener('click', () => {
      // הערכים שבמחשבון עוברים להצעה — כך מחשבים פעם אחת ושומרים כהצעה ללקוח
      const values = { cpi: (document.getElementById('calc_cpi') || {}).value };
      for (const [k] of MADV_TRACKS) for (const p of ['amount', 'rate', 'years']) {
        const el = document.getElementById(`calc_${k}_${p}`);
        if (el && el.value !== '') values[`${k}_${p}`] = el.value;
      }
      openSubForm(madvOfferSchema, values);
    });
    document.querySelectorAll('[data-madv-status]').forEach(sel => sel.addEventListener('change', async () => {
      try { await window.systemAPI.updateMortgageClient(sel.dataset.madvStatus, { status: sel.value }); showToast('הסטטוס עודכן'); await switchView('mortgage-advisor'); }
      catch (error) { showError('שגיאה בעדכון: ' + errMsg(error)); }
    }));
    document.querySelectorAll('[data-madv-doc]').forEach(cb => cb.addEventListener('change', async () => {
      try { await window.systemAPI.toggleMortgageDoc(cb.dataset.madvDoc, cb.dataset.key); await switchView('mortgage-advisor'); }
      catch (error) { showError('שגיאה בעדכון: ' + errMsg(error)); }
    }));
    document.querySelectorAll('[data-madv-export]').forEach(btn => btn.addEventListener('click', async () => {
      try { const r = await window.systemAPI.exportMortgageSchedule(btn.dataset.madvExport); if (r && r.ok) showToast('לוח הסילוקין נשמר'); }
      catch (error) { showError('שגיאה בייצוא: ' + errMsg(error)); }
    }));
    document.querySelectorAll('[data-madv-offer-del]').forEach(btn => btn.addEventListener('click', async () => {
      if (!(await askConfirm('למחוק את ההצעה?'))) return;
      try { await window.systemAPI.deleteMortgageOffer(btn.dataset.madvOfferDel); showToast('ההצעה נמחקה'); await switchView('mortgage-advisor'); }
      catch (error) { showError('שגיאה במחיקה: ' + errMsg(error)); }
    }));
  }


  // ============================================================
  // מעבדת תמהיל — מנוע התמהיל המלא (הועבר מ-tamhil): תמהיל, סלים אחידים, כושר החזר,
  // מחזור, השוואת אישורים, עמלת פירעון, אופטימייזר, שימור, תרחישים, תחזית וכללים.
  // כל החישובים בצד הראשי (mlab:*); כאן רק טפסים ותצוגה. ריביות באחוזים, תקופות בשנים.
  // ============================================================
  const LAB_TABS = [
    ['mix', 'תמהיל וסימולטור'], ['baskets', 'סלים אחידים'], ['afford', 'כושר החזר'], ['refi', 'מחזור משכנתא'],
    ['approvals', 'השוואת אישורים'], ['prepay', 'עמלת פירעון'], ['opt', 'אופטימייזר'], ['retention', 'שימור'],
    ['scenarios', 'תרחישים שמורים'], ['settings', 'תחזית וכללים']
  ];
  const LAB_TRACK_TYPES = {
    PRIME: 'פריים', FIXED_UNLINKED: 'קבועה לא צמודה', FIXED_LINKED: 'קבועה צמודה',
    VARIABLE_UNLINKED: 'משתנה לא צמודה', VARIABLE_LINKED: 'משתנה צמודה', ELIGIBILITY: 'זכאות', BRIDGE: 'גישור'
  };
  const LAB_REPAY = { SPITZER: 'שפיצר', EQUAL_PRINCIPAL: 'קרן שווה', BULLET: 'בלון' };
  const LAB_BUYERS = { SINGLE_HOME: 'דירה יחידה', HOME_UPGRADER: 'משפר דיור', ADDITIONAL_HOME: 'דירה נוספת' };
  const LAB_OBJECTIVES = { TOTAL_COST: 'עלות כוללת נמוכה', MAX_PAYMENT: 'החזר מקסימלי נמוך (יציבות)', TOTAL_COST_WITH_PAYMENT_CAP: 'עלות נמוכה עם תקרת החזר' };
  // שדות לפי סוג מסלול: מה נדרש בכל סוג
  const LAB_FIELD_FOR = {
    ratePct: (t) => !['PRIME', 'VARIABLE_LINKED', 'VARIABLE_UNLINKED'].includes(t),
    spreadPct: (t) => ['PRIME', 'VARIABLE_LINKED', 'VARIABLE_UNLINKED'].includes(t),
    resetMonths: (t) => ['VARIABLE_LINKED', 'VARIABLE_UNLINKED'].includes(t),
    anchorKey: (t) => ['VARIABLE_LINKED', 'VARIABLE_UNLINKED'].includes(t)
  };

  const labDefaultMix = () => [
    { type: 'FIXED_UNLINKED', repayment: 'SPITZER', amount: 400000, years: 25, ratePct: 4.9 },
    { type: 'PRIME', repayment: 'SPITZER', amount: 400000, years: 25, spreadPct: -0.5 },
    { type: 'VARIABLE_LINKED', repayment: 'SPITZER', amount: 400000, years: 25, spreadPct: 0.2, resetMonths: 60, anchorKey: 'GOV_BOND_5Y' }
  ];
  const labShares = (rows, shares) => rows.map((r, i) => { const { amount: _a, ...rest } = r; return { ...rest, share: shares[i] }; });

  function labState() {
    if (!state.lab) {
      state.lab = {
        tab: 'mix',
        results: {},
        form: { buyerType: 'SINGLE_HOME' },
        editors: {
          mix: labDefaultMix(),
          afford: labShares(labDefaultMix(), [34, 33, 33]),
          refiOld: [{ type: 'FIXED_UNLINKED', repayment: 'SPITZER', amount: 700000, years: 20, ratePct: 5.6 }],
          refiNew: [{ type: 'FIXED_UNLINKED', repayment: 'SPITZER', amount: 350000, years: 20, ratePct: 4.7 }, { type: 'PRIME', repayment: 'SPITZER', amount: 350000, years: 20, spreadPct: -0.6 }],
          opt: labDefaultMix().map(r => ({ ...r, amount: '', minSharePct: '', maxSharePct: '' })),
          prepay: [{ balance: 500000, monthlyPayment: 3100, remainingPayments: 216, contractRatePct: 5.2, averageRatePct: 4.3, isFixedRate: true, isCpiLinked: false, monthsElapsed: 60, noticeGiven: true }]
        },
        approvals: [
          { lender: 'בנק א׳', validUntil: '', fees: 360, maxAmount: '', tracks: labShares(labDefaultMix(), [34, 33, 33]) },
          { lender: 'בנק ב׳', validUntil: '', fees: 0, maxAmount: '', tracks: labShares(labDefaultMix().map(r => ({ ...r, ratePct: r.ratePct && 4.75, spreadPct: r.spreadPct != null ? r.spreadPct + 0.1 : r.spreadPct })), [34, 33, 33]) }
        ]
      };
    }
    return state.lab;
  }

  const pctFmt = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? '—' : (Number(v) * 100).toFixed(d) + '%');
  const labNum = (v) => (v === '' || v == null ? '' : v);

  // ----- עורך מסלולים: שורה לכל מסלול, השדות הרלוונטיים לפי הסוג -----
  function labEditorHtml(id, rows, { shareMode = false, bounds = false, anchors = [] } = {}) {
    const anchorOpts = (sel) => anchors.map(a => `<option value="${esc(a)}"${a === sel ? ' selected' : ''}>${esc(a)}</option>`).join('');
    const inp = (i, f, v, attrs = '') => `<input type="number" data-ed="${id}" data-i="${i}" data-f="${f}" value="${esc(labNum(v))}" ${attrs}>`;
    return `
      <div class="acct-scroll"><table class="acct-table lab-editor">
        <thead><tr><th>סוג</th><th>החזר</th><th>${shareMode ? 'חלק (%)' : 'סכום (₪)'}</th><th>שנים</th><th>ריבית (%)</th><th>מרווח (%)</th><th>שינוי כל (חודשים)</th><th>עוגן</th><th>גרייס (חודשים)</th>${bounds ? '<th>מינ׳ %</th><th>מקס׳ %</th>' : ''}<th></th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr>
          <td><select data-ed="${id}" data-i="${i}" data-f="type">${Object.entries(LAB_TRACK_TYPES).map(([k, l]) => `<option value="${k}"${r.type === k ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
          <td><select data-ed="${id}" data-i="${i}" data-f="repayment">${Object.entries(LAB_REPAY).map(([k, l]) => `<option value="${k}"${(r.repayment || 'SPITZER') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
          <td>${shareMode ? inp(i, 'share', r.share, 'min="0" max="100" step="1"') : (bounds ? '<span class="muted">לפי החלוקה</span>' : inp(i, 'amount', r.amount, 'min="0"'))}</td>
          <td>${inp(i, 'years', r.years, 'min="1" max="50" step="1"')}</td>
          <td>${LAB_FIELD_FOR.ratePct(r.type) ? inp(i, 'ratePct', r.ratePct, 'step="0.01"') : '<span class="muted">—</span>'}</td>
          <td>${LAB_FIELD_FOR.spreadPct(r.type) ? inp(i, 'spreadPct', r.spreadPct, 'step="0.01"') : '<span class="muted">—</span>'}</td>
          <td>${LAB_FIELD_FOR.resetMonths(r.type) ? inp(i, 'resetMonths', r.resetMonths, 'min="1" step="1"') : '<span class="muted">—</span>'}</td>
          <td>${LAB_FIELD_FOR.anchorKey(r.type) ? `<select data-ed="${id}" data-i="${i}" data-f="anchorKey">${anchorOpts(r.anchorKey)}</select>` : '<span class="muted">—</span>'}</td>
          <td>${inp(i, 'graceMonths', r.graceMonths, 'min="0" step="1"')}<select data-ed="${id}" data-i="${i}" data-f="graceType"><option value="PARTIAL"${r.graceType !== 'FULL' ? ' selected' : ''}>חלקי</option><option value="FULL"${r.graceType === 'FULL' ? ' selected' : ''}>מלא</option></select></td>
          ${bounds ? `<td>${inp(i, 'minSharePct', r.minSharePct, 'min="0" max="100"')}</td><td>${inp(i, 'maxSharePct', r.maxSharePct, 'min="0" max="100"')}</td>` : ''}
          <td><button class="icon-btn danger" data-lab-delrow="${id}" data-i="${i}" title="הסרת מסלול">🗑</button></td>
        </tr>`).join('')}</tbody>
      </table></div>
      <button class="secondary" data-lab-addrow="${id}">＋ מסלול</button>`;
  }

  // קריאת כל השדות שעל המסך אל המצב — לפני כל חישוב, החלפת לשונית או רינדור מחדש
  function labCollect() {
    const lab = labState();
    document.querySelectorAll('[data-ed]').forEach(el => {
      const target = el.dataset.ed.startsWith('appr') ? (lab.approvals[Number(el.dataset.ed.slice(4))] || {}).tracks : lab.editors[el.dataset.ed];
      const row = target && target[Number(el.dataset.i)];
      if (!row) return;
      const f = el.dataset.f;
      if (el.type === 'checkbox') row[f] = !!el.checked;
      else if (el.type === 'number') row[f] = el.value === '' ? '' : Number(el.value);
      else row[f] = el.value;
    });
    document.querySelectorAll('[data-lab-form]').forEach(el => {
      lab.form[el.dataset.labForm] = el.type === 'checkbox' ? !!el.checked : el.value;
    });
    document.querySelectorAll('[data-appr]').forEach(el => {
      const o = lab.approvals[Number(el.dataset.appr)];
      if (o) o[el.dataset.f] = el.value;
    });
  }

  function labField(name, label, type = 'number', attrs = '') {
    const v = labState().form[name];
    return `<label>${label} <input type="${type}" data-lab-form="${name}" value="${esc(labNum(v))}" ${attrs}></label>`;
  }
  function labSelect(name, label, map) {
    const v = labState().form[name];
    return `<label>${label} <select data-lab-form="${name}">${Object.entries(map).map(([k, l]) => `<option value="${k}"${v === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
  }
  const labRow = (label, value, cls = '') => `<div class="acct-row ${cls}"><span>${label}</span><span>${value}</span></div>`;

  function labAssumptionsHtml(a) {
    if (!a) return '';
    return `<div class="lab-assumptions muted">
      <b>הנחות החישוב:</b> תחזית "${esc(a.forecastSource)}" (${esc(a.forecastPublishedAt)})${a.forecastNeedsVerification ? ' <span class="warn">⚠ יש לאמת</span>' : ''} ·
      ריבית בנק ישראל בתחילה ${pctFmt(a.boiRateAtStart)} · מרווח פריים ${pctFmt(a.primeSpread)}${a.primeSpreadNeedsVerification ? ' <span class="warn">⚠ יש לאמת</span>' : ''} ·
      מדד בשנה הראשונה ${pctFmt(a.firstYearInflation)} · ריבית חודשית ${a.rateConvention === 'EFFECTIVE' ? 'אפקטיבית' : 'נומינלית (שנתית/12)'} ·
      כללים ${esc(a.rulesVersion)} · מנוע ${esc(a.engineVersion)}. התחזיות אינן ודאיות — התוצאה להמחשה ולא התחייבות.
    </div>`;
  }

  function labWarningsHtml(ws) {
    if (!Array.isArray(ws) || ws.length === 0) return '<div class="acct-row ok">✓ לא נמצאו חריגות מהכללים הרגולטוריים שנבדקו</div>';
    return `<div class="lab-warnings">${ws.map(w => `<div class="acct-row warn"><span>⚠ ${esc(w.label)}</span><span>${w.code === 'TERM' ? `${w.actual} חודשים (מותר ${w.limit})` : `${pctFmt(w.actual, 1)} (סף ${pctFmt(w.limit, 1)})`}${w.needsVerification ? ' · הכלל טרם אומת' : ''}</span></div>`).join('')}</div>`;
  }

  function labSummaryHtml(s) {
    if (!s) return '';
    return [
      labRow('סכום ההלוואה', money(s.principal)),
      labRow('החזר חודשי ראשון', money(s.firstPayment)),
      labRow('החזר חודשי מקסימלי צפוי', `${money(s.maxPayment)} <small class="muted">(חודש ${s.maxPaymentMonth})</small>`),
      labRow('סה"כ ריבית', money(s.totalInterest)),
      labRow('סה"כ הצמדה צפויה', money(s.totalIndexation)),
      labRow('עלות האשראי (ריבית + הצמדה)', money(s.totalCost)),
      labRow('סה"כ תשלומים צפוי', money(s.totalPayments), 'acct-big'),
      labRow('תשואה פנימית שנתית (עלות אפקטיבית)', pctFmt(s.irrAnnual))
    ].join('');
  }

  function labMixResultHtml(r) {
    if (!r) return '';
    return `
      <div class="acct-grid">
        <div><h4>סיכום</h4>${labSummaryHtml(r.summary)}</div>
        <div><h4>בדיקות רגולטוריות</h4>${labWarningsHtml(r.warnings)}</div>
      </div>
      <h4>פירוט מסלולים</h4>
      <div class="acct-scroll"><table class="acct-table">
        <thead><tr><th>מסלול</th><th>סכום</th><th>חודשים</th><th>ריבית התחלתית</th><th>החזר ראשון</th><th>החזר מקסימלי</th><th>סה"כ תשלומים</th></tr></thead>
        <tbody>${(r.tracks || []).map(t => `<tr><td>${esc(t.label)}${t.isCpiLinked ? ' <small class="muted">צמוד</small>' : ''}</td><td>${money(t.principal)}</td><td>${t.termMonths}</td><td>${pctFmt(t.initialRate)}</td><td>${money(t.summary.firstPayment)}</td><td>${money(t.summary.maxPayment)}</td><td>${money(t.summary.totalPayments)}</td></tr>`).join('')}</tbody>
      </table></div>
      ${Array.isArray(r.yearly) && r.yearly.length ? `<details><summary>לוח סילוקין שנתי (${r.yearly.length} שנים)</summary>
        <div class="acct-scroll"><table class="acct-table">
          <thead><tr><th>שנה</th><th>תשלומים</th><th>ריבית</th><th>קרן</th><th>הצמדה</th><th>יתרה</th></tr></thead>
          <tbody>${r.yearly.map(y => `<tr><td>${y.year}</td><td>${money(y.payments)}</td><td>${money(y.interest)}</td><td>${money(y.principal)}</td><td>${money(y.indexation)}</td><td>${money(y.closingBalance)}</td></tr>`).join('')}</tbody>
        </table></div></details>` : ''}
      ${labAssumptionsHtml(r.assumptions)}`;
  }

  function labCheckFields() {
    return `${labField('monthlyNetIncome', 'הכנסה נטו משפחתית (₪)')} ${labField('propertyValue', 'שווי הנכס (₪)')} ${labSelect('buyerType', 'סוג רוכש', LAB_BUYERS)}`;
  }

  // ----- לשוניות -----
  function labTabMix(o, lab) {
    const clients = Array.isArray(o.clients) ? o.clients : [];
    return `<div class="card">
      <h3>תמהיל וסימולטור</h3>
      <p class="muted">פריים מחושב לפי מסלול ריבית בנק ישראל שבתחזית; מסלול משתנה מתעדכן בכל נקודת שינוי לפי העוגן ועוד המרווח; מסלול צמוד מוצמד למדד בכל חודש.</p>
      ${labEditorHtml('mix', lab.editors.mix, { anchors: o.anchorKeys || [] })}
      <div class="acct-actions">${labCheckFields()}</div>
      <div class="acct-actions"><button id="labCalcMix">חשב</button></div>
      <div id="labOut">${labMixResultHtml(lab.results.mix)}</div>
      ${lab.results.mix ? `<div class="card"><h4>שמירה כתרחיש</h4><div class="acct-actions">
        ${labField('scenarioName', 'שם התרחיש', 'text')}
        <label>תיק לקוח <select data-lab-form="scenarioClient"><option value="">ללא</option>${clients.map(c => `<option value="${esc(c.id)}"${lab.form.scenarioClient === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        ${labField('scenarioStart', 'תאריך תחילת ההלוואה (לשימור)', 'date')}
        <button class="secondary" id="labSaveScenario">שמירה</button></div></div>` : ''}
    </div>`;
  }

  function labTabBaskets(o, lab) {
    const rs = lab.results.baskets;
    return `<div class="card">
      <h3>שלושת הסלים האחידים (הוראה 451)</h3>
      <p class="muted">אותו סכום, אותה תקופה ואותו תמחור — כך שההשוואה בין הסלים הוגנת.</p>
      <div class="acct-actions">${labField('bAmount', 'סכום (₪)')} ${labField('bYears', 'שנים')} ${labField('bFixed', 'ריבית קל"צ (%)', 'number', 'step="0.01"')} ${labField('bPrime', 'מרווח פריים (%)', 'number', 'step="0.01"')} ${labField('bVar', 'מרווח משתנה צמודה (%)', 'number', 'step="0.01"')}</div>
      <div class="acct-actions"><button id="labCalcBaskets">השווה סלים</button></div>
      ${Array.isArray(rs) ? `<div class="acct-scroll"><table class="acct-table">
        <thead><tr><th>סל</th><th>החזר ראשון</th><th>החזר מקסימלי</th><th>סה"כ תשלומים</th><th>עלות האשראי</th></tr></thead>
        <tbody>${rs.map(b => `<tr><td>${esc(b.label)}</td><td>${money(b.summary.firstPayment)}</td><td>${money(b.summary.maxPayment)}</td><td>${money(b.summary.totalPayments)}</td><td>${money(b.summary.totalCost)}</td></tr>`).join('')}</tbody>
      </table></div>${labAssumptionsHtml(rs[0] && rs[0].assumptions)}` : ''}
    </div>`;
  }

  function labTabAfford(o, lab) {
    const r = lab.results.afford;
    return `<div class="card">
      <h3>כושר החזר — כמה אפשר לקחת?</h3>
      <p class="muted">מהחזר חודשי רצוי והון עצמי אל ההלוואה ומחיר הנכס המקסימליים, לפי התמהיל המתוכנן (חלקים באחוזים).</p>
      ${labEditorHtml('afford', lab.editors.afford, { shareMode: true, anchors: o.anchorKeys || [] })}
      <div class="acct-actions">${labField('aTarget', 'החזר חודשי רצוי (₪)')} ${labField('aEquity', 'הון עצמי למחיר הנכס (₪)')} ${labSelect('buyerType', 'סוג רוכש', LAB_BUYERS)}
        ${labSelect('aBasis', 'לפי החזר', { MAX: 'המקסימלי הצפוי (שמרני)', FIRST: 'הראשון' })}</div>
      <div class="acct-actions"><button id="labCalcAfford">חשב</button></div>
      ${r ? `<div>${labRow('הלוואה מקסימלית', money(r.maxLoan), 'acct-big')}${labRow('מחיר נכס מקסימלי', money(r.maxPropertyPrice), 'acct-big')}
        ${labRow('המגבלה הקובעת', r.binding === 'PAYMENT' ? 'ההחזר החודשי' : 'שיעור המימון המותר')}
        ${labRow('הלוואה לפי ההחזר בלבד', money(r.loanByPayment))}${labRow('מחיר לפי שיעור המימון', r.priceByLtv == null ? '—' : money(r.priceByLtv))}
        ${labRow('שיעור מימון מותר', pctFmt(r.ltvLimit, 0) + (r.ltvNeedsVerification ? ' · הכלל טרם אומת' : ''))}</div>` : ''}
    </div>`;
  }

  function labTabRefi(o, lab) {
    const r = lab.results.refi;
    return `<div class="card">
      <h3>מחזור משכנתא — כדאיות</h3>
      <p class="muted">המשכנתא הקיימת: יתרה נוכחית, תקופה שנותרה וריבית נוכחית. הסכומים לפי דוח היתרה לסילוק.</p>
      <h4>המשכנתא הקיימת</h4>${labEditorHtml('refiOld', lab.editors.refiOld, { anchors: o.anchorKeys || [] })}
      <h4>ההצעה החדשה</h4>${labEditorHtml('refiNew', lab.editors.refiNew, { anchors: o.anchorKeys || [] })}
      <div class="acct-actions">${labField('rFee', 'עמלת פירעון מוקדם מהדוח (₪) — ריק אם לא ידוע')} ${labField('rCosts', 'עלויות מעבר: שמאי, עו"ד, פתיחת תיק (₪)')}</div>
      <div class="acct-actions"><button id="labCalcRefi">השווה</button></div>
      ${r ? `<div>
        ${labRow('חיסכון נטו צפוי (אחרי עלויות)', money(r.netSavings), 'acct-big ' + (r.netSavings > 0 ? 'ok' : 'warn'))}
        ${labRow('שינוי בהחזר הראשון', money(r.firstPaymentChange))}
        ${labRow('עלות מיידית', money(r.upfrontCost) + (r.prepaymentFeeKnown ? '' : ' <span class="warn">(עמלת הפירעון לא הוזנה)</span>'))}
        ${labRow('נקודת איזון', r.breakEvenMonth ? `חודש ${r.breakEvenMonth}` : 'אין')}
        ${labRow('הפרש קרן (משיכת כסף אם חיובי)', money(r.principalDifference))}
        ${labRow('סה"כ תשלומים — קיימת / חדשה', `${money(r.existing.summary.totalPayments)} / ${money(r.proposed.summary.totalPayments)}`)}
        <p class="muted">הערכה בלבד: רק דוח היתרה לסילוק של הבנק מחייב.</p>${labAssumptionsHtml(r.proposed.assumptions)}</div>` : ''}
    </div>`;
  }

  function labTabApprovals(o, lab) {
    const r = lab.results.approvals;
    const rank = r ? Object.fromEntries((r.byTotalCost || []).map((id, i) => [id, i + 1])) : {};
    return `<div class="card">
      <h3>השוואת אישורים עקרוניים</h3>
      <p class="muted">כל הצעה מוזנת בחלקים מהסכום (%) ומחושבת על אותו סכום ואותה תחזית — כך ההשוואה ישירה.</p>
      ${labField('apAmount', 'סכום ההלוואה להשוואה (₪)')}
      ${lab.approvals.map((ap, k) => `<div class="card">
        <div class="acct-actions">
          <label>בנק <input type="text" data-appr="${k}" data-f="lender" value="${esc(ap.lender)}"></label>
          <label>בתוקף עד <input type="date" data-appr="${k}" data-f="validUntil" value="${esc(ap.validUntil)}"></label>
          <label>עמלות חד-פעמיות (₪) <input type="number" data-appr="${k}" data-f="fees" value="${esc(labNum(ap.fees))}"></label>
          <label>סכום מאושר מקסימלי (₪) <input type="number" data-appr="${k}" data-f="maxAmount" value="${esc(labNum(ap.maxAmount))}"></label>
          <button class="icon-btn danger" data-lab-delappr="${k}" title="הסרת הצעה">🗑</button>
        </div>
        ${labEditorHtml('appr' + k, ap.tracks, { shareMode: true, anchors: o.anchorKeys || [] })}
      </div>`).join('')}
      <div class="acct-actions"><button class="secondary" id="labAddAppr">＋ הצעה</button><button id="labCalcAppr">השווה</button></div>
      ${r ? `<div class="acct-scroll"><table class="acct-table">
        <thead><tr><th>דירוג</th><th>בנק</th><th>החזר ראשון</th><th>החזר מקסימלי</th><th>עלות כולל עמלות</th><th>הערות</th></tr></thead>
        <tbody>${r.offers.map(x => `<tr><td>${rank[x.offer.id] || '—'}</td><td>${esc(x.offer.lender)}</td>
          <td>${x.result ? money(x.result.summary.firstPayment) : '—'}</td><td>${x.result ? money(x.result.summary.maxPayment) : '—'}</td>
          <td>${x.totalCostWithFees == null ? '—' : money(x.totalCostWithFees)}</td>
          <td>${[x.expired ? 'פג תוקף' : '', x.overMax ? 'מעל הסכום המאושר' : '', x.error ? esc(x.error) : ''].filter(Boolean).join(' · ')}</td></tr>`).join('')}</tbody>
      </table></div>` : ''}
    </div>`;
  }

  function labTabPrepay(o, lab) {
    const r = lab.results.prepay;
    const rows = lab.editors.prepay;
    const n = (i, f, v, a = '') => `<input type="number" data-ed="prepay" data-i="${i}" data-f="${f}" value="${esc(labNum(v))}" ${a}>`;
    const c = (i, f, v) => `<input type="checkbox" data-ed="prepay" data-i="${i}" data-f="${f}"${v ? ' checked' : ''}>`;
    return `<div class="card">
      <h3>הערכת עמלת פירעון מוקדם</h3>
      <p class="muted">עמלת היוון (ריבית קבועה), עמלת אי-הודעה ועמלה תפעולית. עמלת הפרשי מדד אינה מחושבת. הערכה בלבד — רק דוח היתרה לסילוק של הבנק מחייב.</p>
      <div class="acct-scroll"><table class="acct-table">
        <thead><tr><th>יתרה (₪)</th><th>החזר חודשי (₪)</th><th>תשלומים שנותרו</th><th>ריבית בחוזה (%)</th><th>ריבית ממוצעת היום (%)</th><th>ריבית קבועה</th><th>צמוד</th><th>חודשים מאז הנטילה</th><th>ניתנה הודעה מוקדמת</th><th></th></tr></thead>
        <tbody>${rows.map((t, i) => `<tr><td>${n(i, 'balance', t.balance)}</td><td>${n(i, 'monthlyPayment', t.monthlyPayment)}</td><td>${n(i, 'remainingPayments', t.remainingPayments, 'step="1"')}</td>
          <td>${n(i, 'contractRatePct', t.contractRatePct, 'step="0.01"')}</td><td>${n(i, 'averageRatePct', t.averageRatePct, 'step="0.01"')}</td>
          <td>${c(i, 'isFixedRate', t.isFixedRate)}</td><td>${c(i, 'isCpiLinked', t.isCpiLinked)}</td><td>${n(i, 'monthsElapsed', t.monthsElapsed, 'step="1"')}</td><td>${c(i, 'noticeGiven', t.noticeGiven)}</td>
          <td><button class="icon-btn danger" data-lab-delrow="prepay" data-i="${i}" title="הסרה">🗑</button></td></tr>`).join('')}</tbody>
      </table></div>
      <div class="acct-actions"><button class="secondary" data-lab-addrow="prepay">＋ מסלול</button><button id="labCalcPrepay">הערך</button></div>
      ${r ? `<div>${r.tracks.map((t, i) => labRow(`מסלול ${i + 1}: היוון ${money(t.capitalizationFee)} · אי-הודעה ${money(t.noticeFee)}`, money(t.total))).join('')}
        ${labRow('עמלה תפעולית', money(r.operationalFee))}${labRow('סה"כ הערכה', money(r.total), 'acct-big')}
        ${(r.gapLabels || []).map(g => `<div class="acct-row warn">⚠ ${esc(g)}</div>`).join('')}</div>` : ''}
    </div>`;
  }

  function labTabOpt(o, lab) {
    const r = lab.results.opt;
    return `<div class="card">
      <h3>אופטימייזר תמהיל — המלצה בלבד</h3>
      <p class="muted">הזן את אבני הבניין שתמחרת (סוג, ריבית/מרווח, תקופה), אפשר עם גבולות לחלק של כל אחת. המערכת בודקת את כל החלוקות, פוסלת חריגות מהכללים ומתקרת ההחזר, ומציגה את המובילות. התחזיות אינן ודאיות — ההחלטה שלך.</p>
      ${labEditorHtml('opt', lab.editors.opt, { bounds: true, anchors: o.anchorKeys || [] })}
      <div class="acct-actions">${labField('oAmount', 'סכום (₪)')} ${labSelect('oObjective', 'מטרה', LAB_OBJECTIVES)} ${labField('oCap', 'תקרת החזר חודשי (₪)')} ${labField('oStep', 'צעד חלוקה (%)', 'number', 'min="1" max="100"')}</div>
      <div class="acct-actions">${labCheckFields()}</div>
      <div class="acct-actions"><button id="labCalcOpt">מצא תמהילים</button></div>
      ${r ? `<p class="muted">נבדקו ${r.evaluated} חלוקות, נפסלו ${r.rejected}.</p>
        ${r.candidates.length === 0 ? '<div class="acct-row warn">לא נמצא תמהיל שעומד בכל המגבלות</div>' : `<div class="acct-scroll"><table class="acct-table">
        <thead><tr><th>#</th><th>חלוקה</th><th>החזר ראשון</th><th>החזר מקסימלי</th><th>סה"כ תשלומים</th><th>אזהרות</th></tr></thead>
        <tbody>${r.candidates.map((cd, i) => `<tr><td>${i + 1}</td><td>${cd.shares.map((s, k) => s > 0 ? `${esc(LAB_TRACK_TYPES[(lab.editors.opt[k] || {}).type] || '')} ${Math.round(s * 100)}%` : '').filter(Boolean).join(' · ')}</td>
          <td>${money(cd.summary.firstPayment)}</td><td>${money(cd.summary.maxPayment)}</td><td>${money(cd.summary.totalPayments)}</td><td>${cd.warnings.map(w => esc(w.label)).join(' · ')}</td></tr>`).join('')}</tbody>
      </table></div>`}` : ''}
    </div>`;
  }

  function labTabRetention(o) {
    const ev = Array.isArray(o.retention) ? o.retention : [];
    return `<div class="card">
      <h3>שימור לקוחות — 180 הימים הקרובים</h3>
      <p class="muted">נגזר מתרחישים שמורים שמשויכים לתיק לקוח ויש להם תאריך תחילה: יום שנה להלוואה ונקודות שינוי ריבית במסלולים משתנים. אלה משימות לך — המערכת לא פונה ללקוח.</p>
      ${ev.length === 0 ? renderEmpty('אין אירועים קרובים. שמור תרחיש עם תיק לקוח ותאריך תחילה כדי לקבל תזכורות.') : `<div class="acct-scroll"><table class="acct-table">
        <thead><tr><th>תאריך</th><th>בעוד</th><th>לקוח</th><th>אירוע</th><th>תרחיש</th></tr></thead>
        <tbody>${ev.map(e => `<tr><td>${esc(e.date)}</td><td>${e.days} ימים</td><td>${esc(e.clientName)}</td><td>${esc(e.label)}</td><td>${esc(e.scenarioName)}</td></tr>`).join('')}</tbody>
      </table></div>`}
    </div>`;
  }

  function labTabScenarios(o) {
    const list = Array.isArray(o.scenarios) ? o.scenarios : [];
    return `<div class="card">
      <h3>תרחישים שמורים (${list.length})</h3>
      ${list.length === 0 ? renderEmpty('אין תרחישים שמורים. חשב תמהיל בלשונית "תמהיל וסימולטור" ושמור אותו.') : `<div class="acct-scroll"><table class="acct-table">
        <thead><tr><th>שם</th><th>לקוח</th><th>תחילה</th><th>סכום</th><th>החזר ראשון</th><th>סה"כ תשלומים</th><th>כללים / תחזית</th><th></th></tr></thead>
        <tbody>${list.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.clientName)}</td><td>${esc(s.startDate || '')}</td>
          <td>${money(s.summary && s.summary.principal)}</td><td>${money(s.summary && s.summary.firstPayment)}</td><td>${money(s.summary && s.summary.totalPayments)}</td>
          <td><small>${esc(s.rulesVersion)} / ${esc(s.forecastId)}</small></td>
          <td><button class="icon-btn" data-lab-load="${esc(s.id)}" title="טעינה לסימולטור">↺</button>
              <button class="icon-btn" data-lab-export="${esc(s.id)}" title="ייצוא לוח סילוקין חודשי">📊</button>
              <button class="icon-btn danger" data-lab-delscn="${esc(s.id)}" title="מחיקה">🗑</button></td></tr>`).join('')}</tbody>
      </table></div>`}
    </div>`;
  }

  function labTabSettings(o, lab) {
    const f = o.forecast || {};
    const rules = Array.isArray(o.rules) ? o.rules : [];
    const fmtVal = (r) => {
      const v = r.value;
      if (Array.isArray(v)) return v.length ? `${v.length} פריטים` : 'לא הוזן';
      if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => `${LAB_BUYERS[k] || k} ${pctFmt(x, 0)}`).join(' · ');
      if (/Months|Days/.test(r.id)) return String(v);
      if (r.id === 'prepayment.operationalFee') return money(v);
      return pctFmt(v, 2);
    };
    return `<div class="card">
      <h3>תחזית שוק</h3>
      ${f.isDemo ? '<div class="acct-row warn">⚠ מוצגים נתוני הדגמה בלבד — יש להזין תחזית ממקור מאומת (למשל תחזית חטיבת המחקר של בנק ישראל וציפיות האינפלציה משוק האג"ח).</div>' : ''}
      ${labRow('מקור', esc(f.source))}${labRow('תאריך פרסום', esc(f.publishedAt))}
      ${labRow('ריבית בנק ישראל (לפי חודש)', esc((f.boiPct || []).join(', ')) + '%')}
      ${labRow('מדד שנתי צפוי (שנה ראשונה)', `${f.inflationAnnualPct}%`)}
      ${Object.entries(f.anchors || {}).map(([k, a]) => labRow(`עוגן ${esc(k)}`, `${a.first}% → ${a.last}% (${a.months} חודשים)`)).join('')}
      <h4>עדכון תחזית</h4>
      <p class="muted">ערכים באחוזים, מופרדים בפסיקים. ריבית בנק ישראל: ערך לכל חודש מהיום. מדד ותשואת העוגן: ערך לכל שנה. הערך האחרון ממשיך הלאה.</p>
      <div class="acct-actions">
        ${labField('fSource', 'מקור (חובה)', 'text')} ${labField('fDate', 'תאריך פרסום', 'date')}
        ${labField('fBoi', 'ריבית בנק ישראל (%)', 'text', 'placeholder="4.25, 4.25, 4"')}
        ${labField('fInfl', 'מדד שנתי (%)', 'text', 'placeholder="2.5, 2.3"')}
        ${labField('fAnchorKey', 'שם העוגן', 'text', 'placeholder="GOV_BOND_5Y"')}
        ${labField('fAnchor', 'תשואת העוגן (%)', 'text', 'placeholder="3, 3, 3, 3, 3, 3.25"')}
        ${labSelect('fConvention', 'חישוב ריבית חודשית', { NOMINAL: 'נומינלית (שנתית/12)', EFFECTIVE: 'אפקטיבית' })}
      </div>
      <div class="acct-actions"><button id="labSaveForecast">שמירת תחזית</button>${f.isDemo ? '' : '<button class="secondary" id="labResetForecast">חזרה לנתוני ההדגמה</button>'}</div>
    </div>
    <div class="card">
      <h3>כללים רגולטוריים (גרסה ${esc(o.rulesVersion)})</h3>
      <p class="muted">כל הערכים הם ערכי התחלה. אימות נרשם ביומן הביקורת, חל על גרסת הכללים הנוכחית בלבד, ומותר למנהל בלבד. אימות מאשר שהערך נבדק — הוא אינו משנה אותו.</p>
      <div class="acct-scroll"><table class="acct-table">
        <thead><tr><th>כלל</th><th>ערך</th><th>מקור</th><th>מצב</th><th></th></tr></thead>
        <tbody>${rules.map(r => `<tr><td>${esc(r.description)}</td><td>${fmtVal(r)}</td><td><small>${esc(r.source)}</small></td>
          <td>${r.needsVerification ? '<span class="warn">⚠ יש לאמת</span>' : `<span class="ok">✓ אומת</span> <small>${esc(String(r.verifiedAt || '').slice(0, 10))} · ${esc(r.verifiedNote)}</small>`}</td>
          <td>${r.needsVerification ? `<button class="secondary" data-lab-verify="${esc(r.id)}">אימות</button>` : `<button class="icon-btn" data-lab-unverify="${esc(r.id)}" title="ביטול אימות">↺</button>`}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  }

  function renderMortgageLab(o) {
    o = o || {};
    const lab = labState();
    const tabs = { mix: labTabMix, baskets: labTabBaskets, afford: labTabAfford, refi: labTabRefi, approvals: labTabApprovals, prepay: labTabPrepay, opt: labTabOpt, retention: labTabRetention, scenarios: labTabScenarios, settings: labTabSettings };
    const unverified = (Array.isArray(o.rules) ? o.rules : []).filter(r => r.needsVerification).length;
    const demo = o.forecast && o.forecast.isDemo;
    return `
      <div class="mortgage-lab">
        ${demo || unverified ? `<div class="card warn-banner">⚠ ${demo ? 'התחזית היא נתוני הדגמה. ' : ''}${unverified ? `${unverified} כללים רגולטוריים טרם אומתו. ` : ''}<button class="secondary" data-lab-tab="settings">לתחזית ולכללים</button></div>` : ''}
        <div class="lab-tabs">${LAB_TABS.map(([k, l]) => `<button class="${lab.tab === k ? 'primary' : 'secondary'}" data-lab-tab="${k}">${l}</button>`).join('')}</div>
        ${(tabs[lab.tab] || labTabMix)(o, lab)}
      </div>`;
  }

  // מסלולים לשליחה: בלי שורות ריקות לגמרי
  const labTracks = (rows) => rows.filter(r => r && r.type);

  async function labRun(key, fn) {
    labCollect();
    const lab = labState();
    try {
      lab.results[key] = await fn(lab);
      renderView('mortgage-lab');
    } catch (error) { showError('שגיאה בחישוב: ' + errMsg(error)); }
  }

  async function labAskNote(title) {
    if (typeof openDialog !== 'function') return null;
    return openDialog((box, done) => {
      box.innerHTML = `<h3>${esc(title)}</h3><p class="muted">ציין את שם ההוראה, הסעיף ותאריך הנוסח שמולו בדקת.</p>
        <textarea id="labNote" rows="3" style="width:100%"></textarea>
        <div class="modal-actions"><button class="secondary" id="labNoteCancel">ביטול</button><button class="primary" id="labNoteOk">אישור</button></div>`;
      box.querySelector('#labNoteOk').addEventListener('click', () => done(box.querySelector('#labNote').value.trim() || null));
      box.querySelector('#labNoteCancel').addEventListener('click', () => done(null));
    });
  }

  function attachLabHandlers() {
    const lab = labState();
    const api = window.systemAPI;
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    const rerender = () => { labCollect(); renderView('mortgage-lab'); };

    document.querySelectorAll('[data-lab-tab]').forEach(b => b.addEventListener('click', () => { labCollect(); lab.tab = b.dataset.labTab; renderView('mortgage-lab'); }));
    // שינוי סוג מסלול משנה את השדות הרלוונטיים — רינדור מחדש
    document.querySelectorAll('[data-f="type"]').forEach(s => s.addEventListener('change', rerender));
    document.querySelectorAll('[data-lab-addrow]').forEach(b => b.addEventListener('click', () => {
      labCollect();
      const id = b.dataset.labAddrow;
      const target = id.startsWith('appr') ? lab.approvals[Number(id.slice(4))].tracks : lab.editors[id];
      if (target.length >= 12) { showError('עד 12 מסלולים'); return; }
      target.push(id === 'prepay' ? { balance: '', monthlyPayment: '', remainingPayments: '', contractRatePct: '', averageRatePct: '', isFixedRate: true } : { type: 'FIXED_UNLINKED', repayment: 'SPITZER', years: 25 });
      renderView('mortgage-lab');
    }));
    document.querySelectorAll('[data-lab-delrow]').forEach(b => b.addEventListener('click', () => {
      labCollect();
      const id = b.dataset.labDelrow;
      const target = id.startsWith('appr') ? lab.approvals[Number(id.slice(4))].tracks : lab.editors[id];
      target.splice(Number(b.dataset.i), 1);
      renderView('mortgage-lab');
    }));

    on('labCalcMix', () => labRun('mix', (l) => api.calcLabMix({ tracks: labTracks(l.editors.mix), monthlyNetIncome: l.form.monthlyNetIncome, propertyValue: l.form.propertyValue, buyerType: l.form.buyerType })));
    on('labCalcBaskets', () => labRun('baskets', (l) => api.calcLabBaskets({ amount: l.form.bAmount, years: l.form.bYears, pricing: { fixedRatePct: l.form.bFixed, primeSpreadPct: l.form.bPrime, variableSpreadPct: l.form.bVar } })));
    on('labCalcAfford', () => labRun('afford', (l) => api.calcLabAffordability({ tracks: labTracks(l.editors.afford), targetPayment: l.form.aTarget, equity: l.form.aEquity, buyerType: l.form.buyerType, basis: l.form.aBasis })));
    on('labCalcRefi', () => labRun('refi', (l) => api.calcLabRefinance({ existing: labTracks(l.editors.refiOld), proposed: labTracks(l.editors.refiNew), prepaymentFee: l.form.rFee, switchingCosts: l.form.rCosts })));
    on('labCalcAppr', () => labRun('approvals', (l) => api.calcLabApprovals({ amount: l.form.apAmount, offers: l.approvals.map((a, i) => ({ ...a, id: 'o' + i, tracks: labTracks(a.tracks) })) })));
    on('labCalcPrepay', () => labRun('prepay', (l) => api.calcLabPrepayment({ tracks: l.editors.prepay })));
    on('labCalcOpt', () => labRun('opt', (l) => api.calcLabOptimize({ amount: l.form.oAmount, blocks: labTracks(l.editors.opt), objective: l.form.oObjective, maxMonthlyPayment: l.form.oCap, stepPct: l.form.oStep, monthlyNetIncome: l.form.monthlyNetIncome, propertyValue: l.form.propertyValue, buyerType: l.form.buyerType })));

    on('labAddAppr', () => { labCollect(); if (lab.approvals.length >= 10) return; lab.approvals.push({ lender: '', validUntil: '', fees: '', maxAmount: '', tracks: labShares(labDefaultMix(), [34, 33, 33]) }); renderView('mortgage-lab'); });
    document.querySelectorAll('[data-lab-delappr]').forEach(b => b.addEventListener('click', () => { labCollect(); lab.approvals.splice(Number(b.dataset.labDelappr), 1); renderView('mortgage-lab'); }));

    on('labSaveScenario', async () => {
      labCollect();
      try {
        await api.saveLabScenario({ name: lab.form.scenarioName, clientId: lab.form.scenarioClient, startDate: lab.form.scenarioStart, tracks: labTracks(lab.editors.mix) });
        showToast('התרחיש נשמר');
        await switchView('mortgage-lab');
      } catch (error) { showError('שגיאה בשמירה: ' + errMsg(error)); }
    });
    document.querySelectorAll('[data-lab-load]').forEach(b => b.addEventListener('click', () => {
      const s = ((state.data.mortgageLab || {}).scenarios || []).find(x => x.id === b.dataset.labLoad);
      if (!s) return;
      lab.editors.mix = s.tracks.map(t => ({ ...t, years: t.years != null ? t.years : Math.round(t.termMonths / 12) }));
      lab.results.mix = null;
      lab.tab = 'mix';
      renderView('mortgage-lab');
    }));
    document.querySelectorAll('[data-lab-export]').forEach(b => b.addEventListener('click', async () => {
      try { const r = await api.exportLabScenario(b.dataset.labExport); if (r && r.ok) showToast('לוח הסילוקין נשמר'); }
      catch (error) { showError('שגיאה בייצוא: ' + errMsg(error)); }
    }));
    document.querySelectorAll('[data-lab-delscn]').forEach(b => b.addEventListener('click', async () => {
      if (!(await askConfirm('למחוק את התרחיש?'))) return;
      try { await api.deleteLabScenario(b.dataset.labDelscn); showToast('התרחיש נמחק'); await switchView('mortgage-lab'); }
      catch (error) { showError('שגיאה במחיקה: ' + errMsg(error)); }
    }));

    on('labSaveForecast', async () => {
      labCollect();
      const f = lab.form;
      try {
        await api.saveLabForecast({ source: f.fSource, publishedAt: f.fDate, boiPct: f.fBoi, inflationAnnualPct: f.fInfl, anchorKey: f.fAnchorKey, anchorPct: f.fAnchor, rateConvention: f.fConvention });
        lab.results = {};
        showToast('התחזית נשמרה');
        await switchView('mortgage-lab');
      } catch (error) { showError('שגיאה בשמירת התחזית: ' + errMsg(error)); }
    });
    on('labResetForecast', async () => {
      if (!(await askConfirm('לחזור לנתוני ההדגמה? התחזית שהוזנה תימחק.'))) return;
      try { await api.resetLabForecast(); lab.results = {}; showToast('חזרה לנתוני ההדגמה'); await switchView('mortgage-lab'); }
      catch (error) { showError('שגיאה: ' + errMsg(error)); }
    });
    document.querySelectorAll('[data-lab-verify]').forEach(b => b.addEventListener('click', async () => {
      const note = await labAskNote('אימות כלל רגולטורי');
      if (!note) return;
      try { await api.verifyLabRule(b.dataset.labVerify, note); showToast('הכלל סומן כמאומת'); await switchView('mortgage-lab'); }
      catch (error) { showError('שגיאה באימות: ' + errMsg(error)); }
    }));
    document.querySelectorAll('[data-lab-unverify]').forEach(b => b.addEventListener('click', async () => {
      if (!(await askConfirm('לבטל את אימות הכלל?'))) return;
      try { await api.unverifyLabRule(b.dataset.labUnverify); showToast('האימות בוטל'); await switchView('mortgage-lab'); }
      catch (error) { showError('שגיאה: ' + errMsg(error)); }
    }));
  }

  // ============================================================
  // ייבוא וייצוא — פס בכל תצוגת נתונים, ומרכז מלא בהגדרות המתקדמות
  // ============================================================
  const PORT_VIEWS = {"contacts":["contacts"],"tasks":["tasks"],"business":["businessPlans"],"market-intel":["marketIntel"],"acct-personal":["personal"],"personal-finance":["financeIncomes","financeExpenses"],"mortgage-advisor":["mortgageClients"]};
  const PORT_LABELS = {
    contacts: 'אנשי קשר', tasks: 'משימות', businessPlans: 'תוכניות עסקיות', marketIntel: 'מודיעין שוק',
    personal: 'הוצאות אישיות', financeIncomes: 'הכנסות', financeExpenses: 'הוצאות', mortgageClients: 'תיקי לקוחות',
    npoGrants: 'תמיכות', products: 'מחירון'
  };
  function renderPortsBar(kinds) {
    const multi = kinds.length > 1;
    return `<div class="ports-bar">${kinds.map(k => `
      <span class="ports-group">${multi ? `<small class="muted">${esc(PORT_LABELS[k] || k)}:</small>` : ''}
        <button class="secondary small" data-port-export="${esc(k)}">⬇ ייצוא ל-Excel</button>
        <button class="secondary small" data-port-import="${esc(k)}">⬆ ייבוא מ-CSV</button>
        <button class="secondary small" data-port-template="${esc(k)}">תבנית</button>
      </span>`).join('')}
      ${kinds.includes('contacts') ? '<button class="secondary small" data-vcard-import>⬆ ייבוא vCard</button><button class="secondary small" data-vcard-export>⬇ ייצוא vCard</button>' : ''}
    </div>`;
  }

  function pickFileText(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return resolve(null);
        if (file.size > 20 * 1024 * 1024) { showError('הקובץ גדול מדי (עד 20MB)'); return resolve(null); }
        resolve(await file.text());
      });
      input.click();
    });
  }

  function importSummary(r) {
    const parts = [`יובאו ${r.added}`];
    if (r.skipped) parts.push(`${r.skipped} כפולים דולגו`);
    if (r.errors && r.errors.length) parts.push(`${r.errors.length} שורות נדחו (${r.errors.slice(0, 3).map(e => 'שורה ' + e.line + ': ' + e.message).join('; ')})`);
    return parts.join(' · ');
  }

  function attachPortsHandlers() {
    document.querySelectorAll('[data-port-export]').forEach(b => b.addEventListener('click', async () => {
      try { const r = await window.systemAPI.exportData(b.dataset.portExport); if (r && r.ok) showToast(`הקובץ נשמר (${r.rows} שורות)`); }
      catch (error) { showError('שגיאה בייצוא: ' + errMsg(error)); }
    }));
    document.querySelectorAll('[data-port-template]').forEach(b => b.addEventListener('click', async () => {
      try { const r = await window.systemAPI.exportDataTemplate(b.dataset.portTemplate); if (r && r.ok) showToast('התבנית נשמרה — מלא אותה ב-Excel וייבא'); }
      catch (error) { showError('שגיאה: ' + errMsg(error)); }
    }));
    document.querySelectorAll('[data-port-import]').forEach(b => b.addEventListener('click', async () => {
      const text = await pickFileText('.csv,text/csv');
      if (text == null) return;
      try { const r = await window.systemAPI.importData(b.dataset.portImport, text); showToast(importSummary(r)); await switchView(state.currentView); }
      catch (error) { showError('שגיאה בייבוא: ' + errMsg(error)); }
    }));
    document.querySelectorAll('[data-vcard-import]').forEach(b => b.addEventListener('click', async () => {
      const text = await pickFileText('.vcf,text/vcard,text/x-vcard');
      if (text == null) return;
      try { const r = await window.systemAPI.importContactsVcard(text); showToast(importSummary(r)); await switchView(state.currentView); }
      catch (error) { showError('שגיאה בייבוא: ' + errMsg(error)); }
    }));
    document.querySelectorAll('[data-vcard-export]').forEach(b => b.addEventListener('click', async () => {
      try { const r = await window.systemAPI.exportContactsVcard(); if (r && r.ok) showToast('אנשי הקשר נשמרו כ-vCard'); }
      catch (error) { showError('שגיאה בייצוא: ' + errMsg(error)); }
    }));
  }

  // ============================================================
  // הגדרות מתקדמות: כללי, משתמשים ותפקידים, יומן ביקורת, מרכז ייבוא/ייצוא
  // ============================================================
  const ROLE_LABELS = { admin: 'מנהל — הכל כולל משתמשים', editor: 'עורך — צפייה, הזנה, ייצוא וגיבוי', viewer: 'צופה — קריאה בלבד' };
  const START_LABELS = { dashboard: 'לוח בקרה', 'acct-reports': 'דוחות ומע"מ', 'acct-invoices': 'חשבוניות מס', 'acct-journal': 'יומן חשבונאי',
    'personal-finance': 'התוכנית הפיננסית', finance: 'תכנון פיננסי', contacts: 'אנשי קשר', tasks: 'משימות', npo: 'עמותה ותרומות', gemach: 'גמ"ח', chesed: 'חסד וחלוקות', 'mortgage-advisor': 'ייעוץ משכנתאות', 'mortgage-lab': 'מעבדת תמהיל' };

  const advGeneralSchema = {
    title: 'הגדרות כלליות',
    fields: [
      { name: 'idleMinutes', label: 'ניתוק אוטומטי אחרי (דקות ללא פעילות, 5–240)', type: 'number', required: true },
      { name: 'startView', label: 'מסך פתיחה אחרי כניסה', type: 'select', options: Object.entries(START_LABELS).map(([value, label]) => ({ value, label })) }
    ],
    create: (d) => window.systemAPI.saveAdvancedSettings(d)
  };
  const advUserSchema = {
    title: 'משתמש חדש',
    fields: [
      { name: 'username', label: 'שם משתמש (אותיות לועזיות, ספרות, . _ -)', type: 'text', required: true },
      { name: 'password', label: 'סיסמה ראשונית (לפחות 12 תווים)', type: 'password', required: true },
      { name: 'role', label: 'תפקיד', type: 'select', options: Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })) }
    ],
    create: (d) => window.systemAPI.createUser(d)
  };

  function renderSettings(d) {
    const st = d && typeof d === 'object' ? d : {};
    const users = Array.isArray(st.users) ? st.users : [];
    const audit = Array.isArray(st.audit) ? st.audit : [];
    const kinds = Array.isArray(st.kinds) ? st.kinds : [];
    const counts = st.counts || {};
    return `
      <div class="settings">
        <div class="acct-grid">
          <div class="card">
            <h3>כללי</h3>
            <div class="acct-row"><span>ניתוק אוטומטי</span><span>${esc(st.idleMinutes || 15)} דקות</span></div>
            <div class="acct-row"><span>מסך פתיחה</span><span>${esc(START_LABELS[st.startView] || 'לוח בקרה')}</span></div>
            <div class="acct-row"><span>משתמש מחובר</span><span>${esc(st.me && st.me.username || '')}</span></div>
            ${st.isAdmin ? '<button class="secondary" id="advGeneralBtn">עריכת הגדרות כלליות</button>' : '<p class="muted">שינוי הגדרות — למנהל בלבד.</p>'}
          </div>
          <div class="card">
            <h3>גיבוי ושמירת נתונים</h3>
            <p class="muted">כל הנתונים נשמרים במחשב בלבד ונכללים בגיבוי המוצפן. גיבוי ידני ושחזור — בכפתורים שבסרגל העליון. יעד גיבוי אוטומטי (כונן USB) נקבע במסך הראשי של החבילה.</p>
          </div>
        </div>

        <div class="card">
          <h3>ייבוא וייצוא נתונים</h3>
          <p class="muted">ייצוא לקובץ CSV שנפתח ב-Excel בעברית. בייבוא: שורה ראשונה = כותרות (כמו בתבנית); רשומות כפולות מדולגות ושורות שגויות מדווחות.</p>
          <div class="acct-scroll"><table class="acct-table">
            <thead><tr><th>סוג נתונים</th><th>רשומות</th><th></th></tr></thead>
            <tbody>${kinds.map(k => `<tr><td>${esc(k.label)}</td><td>${Number(counts[k.id]) || 0}</td><td>
              <button class="secondary small" data-port-export="${esc(k.id)}">ייצוא</button>
              <button class="secondary small" data-port-import="${esc(k.id)}">ייבוא</button>
              <button class="secondary small" data-port-template="${esc(k.id)}">תבנית</button>
              ${k.id === 'contacts' ? '<button class="secondary small" data-vcard-import>ייבוא vCard</button><button class="secondary small" data-vcard-export>ייצוא vCard</button>' : ''}
            </td></tr>`).join('')}</tbody>
          </table></div>
        </div>

        ${st.isAdmin ? `
        <div class="card">
          <div class="acct-header"><h3>משתמשים ותפקידים (${users.length})</h3><button class="secondary" id="advAddUserBtn">＋ משתמש חדש</button></div>
          <div class="acct-scroll"><table class="acct-table">
            <thead><tr><th>משתמש</th><th>תפקיד</th><th>מצב</th><th></th></tr></thead>
            <tbody>${users.map(u => `<tr class="${u.active ? '' : 'muted'}">
              <td>${esc(u.username)}${st.me && st.me.id === u.id ? ' <small class="muted">(אתה)</small>' : ''}</td>
              <td><select data-user-role="${esc(u.id)}"${st.me && st.me.id === u.id ? ' disabled' : ''}>${Object.keys(ROLE_LABELS).map(r => `<option value="${r}"${u.role === r ? ' selected' : ''}>${esc(ROLE_LABELS[r].split(' — ')[0])}</option>`).join('')}</select></td>
              <td>${u.active ? (u.locked ? 'נעול זמנית' : 'פעיל') : 'חסום'}</td>
              <td>${st.me && st.me.id === u.id ? '' : `<button class="secondary small" data-user-toggle="${esc(u.id)}" data-active="${u.active ? '1' : '0'}">${u.active ? 'חסימה' : 'הפעלה'}</button>`}
                <button class="secondary small" data-user-reset="${esc(u.id)}">איפוס סיסמה</button></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>

        <div class="card">
          <div class="acct-header"><h3>יומן ביקורת</h3>
            <div class="acct-actions">
              <select id="auditFilter">
                ${[['', 'הכל'], ['acct', 'הנהלת חשבונות'], ['npo', 'עמותה'], ['gemach', 'גמ"ח'], ['chesed', 'חסד וחלוקות'], ['madv', 'ייעוץ משכנתאות'], ['users', 'משתמשים'], ['ports', 'ייבוא/ייצוא'], ['data', 'גיבוי ושחזור'], ['settings', 'הגדרות']]
                  .map(([v, l]) => `<option value="${v}"${(state.auditFilter || '') === v ? ' selected' : ''}>${l}</option>`).join('')}
              </select>
              <button class="secondary" id="auditExportBtn">ייצוא יומן</button>
            </div>
          </div>
          <div class="acct-scroll"><table class="acct-table">
            <thead><tr><th>מועד</th><th>משתמש</th><th>פעולה</th><th>פרטים</th></tr></thead>
            <tbody>${audit.map(a => `<tr><td>${esc(String(a.at).slice(0, 16).replace('T', ' '))}</td><td>${esc(a.user)}</td><td>${esc(a.action)}</td><td><small>${esc(String(a.details).slice(0, 120))}</small></td></tr>`).join('') || '<tr><td colspan="4" class="muted">אין אירועים</td></tr>'}</tbody>
          </table></div>
        </div>` : ''}
      </div>`;
  }

  function attachSettingsHandlers() {
    const st = state.data.settings || {};
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('advGeneralBtn', () => openSubForm(advGeneralSchema, { idleMinutes: st.idleMinutes, startView: st.startView }));
    on('advAddUserBtn', () => openSubForm(advUserSchema, { role: 'editor' }));
    on('auditExportBtn', async () => {
      try { const r = await window.systemAPI.exportAudit({ action: state.auditFilter || '' }); if (r && r.ok) showToast('היומן נשמר'); }
      catch (error) { showError('שגיאה בייצוא: ' + errMsg(error)); }
    });
    const filter = document.getElementById('auditFilter');
    if (filter) filter.addEventListener('change', () => { state.auditFilter = filter.value; switchView('settings'); });
    document.querySelectorAll('[data-user-role]').forEach(sel => sel.addEventListener('change', async () => {
      try { await window.systemAPI.updateUser(sel.dataset.userRole, { role: sel.value }); showToast('התפקיד עודכן — המשתמש יידרש להתחבר מחדש'); }
      catch (error) { showError('שגיאה: ' + errMsg(error)); }
      await switchView('settings');
    }));
    document.querySelectorAll('[data-user-toggle]').forEach(b => b.addEventListener('click', async () => {
      const activate = b.dataset.active !== '1';
      if (!activate && !(await askConfirm('לחסום את המשתמש? הוא ינותק מיד ולא יוכל להתחבר.'))) return;
      try { await window.systemAPI.updateUser(b.dataset.userToggle, { active: activate }); showToast(activate ? 'המשתמש הופעל' : 'המשתמש נחסם'); await switchView('settings'); }
      catch (error) { showError('שגיאה: ' + errMsg(error)); }
    }));
    document.querySelectorAll('[data-user-reset]').forEach(b => b.addEventListener('click', async () => {
      const v = await askFields('איפוס סיסמה', [{ name: 'pass', label: 'סיסמה חדשה (לפחות 12 תווים)', type: 'password' }], 'איפוס');
      if (!v) return;
      try { await window.systemAPI.resetUserPassword(b.dataset.userReset, v.pass); showToast('הסיסמה אופסה'); }
      catch (error) { showError('שגיאה: ' + errMsg(error)); }
    }));
  }

  // תצוגות ללא טופס הוספה — מחושבות/מצטברות בלבד.
  // נגזר מ-formSchemas כדי שלא ייווצר פער בין הרשימה לסכימות בפועל.
  const hasForm = (viewName) => !!formSchemas[viewName];

  // Attach view-specific handlers
  function attachViewHandlers(viewName) {
    // כפתור הוספה — מושבת רק בתצוגות שאין להן טופס מוגדר
    elements.addBtn.disabled = !hasForm(viewName);

    // כפתורי מחיקה בכרטיסים
    document.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => handleDelete(btn.dataset.id));
    });

    // כפתורי עריכה בכרטיסים
    document.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const record = findRecordById(id);
        if (record) await handleEdit(id, record);
      });
    });

    document.querySelectorAll('[data-action="cancel"]').forEach(btn => {
      btn.addEventListener('click', () => handleCancelInvoice(btn.dataset.id));
    });
    document.querySelectorAll('[data-action="pay"]').forEach(btn => {
      btn.addEventListener('click', () => handlePay(btn.dataset.id));
    });
    document.querySelectorAll('[data-module]').forEach(btn => {
      btn.addEventListener('click', () => window.systemAPI.openModule(btn.dataset.module).catch(e => showError('שגיאה בפתיחת המודול: ' + errMsg(e))));
    });
    document.querySelectorAll('[data-goto]').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.goto));
    });
    const periodBtn = document.getElementById('acctPeriodBtn');
    if (periodBtn) periodBtn.addEventListener('click', changeAcctPeriod);
    const calc = ['calcCost', 'calcMarkup', 'calcExempt'].map(id => document.getElementById(id)).filter(Boolean);
    calc.forEach(el => el.addEventListener('input', refreshCalculator));
    if (calc.length) refreshCalculator();
    const csvTb = document.getElementById('acctCsvTb');
    if (csvTb) csvTb.addEventListener('click', () => handleCsv('trialBalance'));
    const csvSum = document.getElementById('acctCsvSummary');
    if (csvSum) csvSum.addEventListener('click', () => handleCsv('summary'));
    const csvPer = document.getElementById('acctCsvPersonal');
    if (csvPer) csvPer.addEventListener('click', () => handleCsv('personal'));
    const imp = document.getElementById('acctImportCsv');
    if (imp) imp.addEventListener('click', handleImportCsv);
    document.querySelectorAll('[data-action="unpay"]').forEach(btn => {
      btn.addEventListener('click', () => handleUnpay(btn.dataset.id));
    });
    const csvJ = document.getElementById('acctCsvJournal');
    if (csvJ) csvJ.addEventListener('click', () => handleCsv('journal'));
    document.querySelectorAll('[data-action="pdf"]').forEach(btn => {
      btn.addEventListener('click', () => handlePdf(btn.dataset.id));
    });

    if (viewName === 'npo') attachNpoHandlers();
    if (viewName === 'gemach') attachGemachHandlers();
    if (viewName === 'chesed') attachChesedHandlers();
    if (viewName === 'personal-finance') attachPersonalFinanceHandlers();
    if (viewName === 'settings') attachSettingsHandlers();
    attachPortsHandlers();
    if (viewName === 'mortgage-advisor') attachMadvHandlers();
    if (viewName === 'mortgage-lab') attachLabHandlers();

    // תיבת חיפוש
    const searchInput = document.getElementById('viewSearch');
    if (searchInput) {
      let debounce;
      searchInput.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => performSearch(searchInput.value.trim()), 300);
      });
    }
  }

  // Handle add action — פותח את הטופס המתאים לתצוגה
  async function handleAdd() {
    const schema = formSchemas[state.currentView];
    if (!schema) {
      showToast('בתצוגה זו אין טופס הוספה');
      return;
    }
    try {
      if (schema.prepare) await schema.prepare(schema);
    } catch (error) {
      showError('שגיאה בטעינת הטופס: ' + errMsg(error));
      return;
    }
    showModal(schema.title, buildFormHtml(schema.fields));
    if (schema.dynamic) attachDynamicFields(schema);
    if (schema.afterRender) schema.afterRender();
  }

  // שדות פעילים לפי הסוג הנבחר (לטופס דינמי עם בחירת סוג)
  function activeFields(schema) {
    if (!schema.dynamic) return schema.fields;
    const kindEl = document.getElementById('f_' + schema.fields[0].name);
    const kind = kindEl ? kindEl.value : schema.fields[0].options[0].value;
    return schema.fields.filter(f => !f.kinds || f.kinds.includes(kind));
  }

  // טופס דינמי: החלפת השדות בכל שינוי בסוג הרשומה
  function attachDynamicFields(schema) {
    const kindName = schema.fields[0].name;
    const kindEl = document.getElementById('f_' + kindName);
    if (!kindEl) return;
    const fieldsWrap = document.getElementById('formFields');
    if (!fieldsWrap) return;

    const refresh = () => {
      // שמירת הערכים שכבר הוזנו, כדי לא לאבד אותם במעבר בין סוגים
      const prev = {};
      for (const f of schema.fields) {
        const el = document.getElementById('f_' + f.name);
        if (el && f.name !== kindName) prev[f.name] = el.value;
      }
      fieldsWrap.innerHTML = buildFormHtml(activeFields(schema).filter(f => f.name !== kindName));
      // שחזור ערכים תואמים
      for (const [name, value] of Object.entries(prev)) {
        const el = document.getElementById('f_' + name);
        if (el) el.value = value;
      }
    };
    kindEl.addEventListener('change', refresh);
    refresh();
  }

  // בניית HTML של טופס לפי סכימה
  function buildFormHtml(fields) {
    // טופס דינמי: שדה הסוג נשאר בחוץ, שאר השדות נעטפים ב-wrapper שמתחלף
    const schema = currentSchema();
    if (!schema || !schema.dynamic) return fields.map(renderField).join('');

    const kindName = schema.fields[0].name;
    const isKind = (f) => f.name === kindName;
    const head = fields.filter(isKind).map(renderField).join('');
    const rest = fields.filter(f => !isKind(f));
    return head + `<div id="formFields">${rest.map(renderField).join('')}</div>`;
  }

  // רינדור שדה בודד
  function renderField(f) {
    const req = f.required ? 'required' : '';
    let input;
    if (f.type === 'textarea') {
      input = `<textarea id="f_${esc(f.name)}" name="${esc(f.name)}" rows="3" ${req}>${esc(f.value ?? '')}</textarea>`;
    } else if (f.type === 'select') {
      const opts = (f.options || [])
        .map(o => `<option value="${esc(o.value)}"${String(o.value) === String(f.value ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
      input = `<select id="f_${esc(f.name)}" name="${esc(f.name)}" ${req}>${opts}</select>`;
    } else {
      const val = f.value !== undefined && f.value !== null ? ` value="${esc(f.value)}"` : '';
      input = `<input id="f_${esc(f.name)}" name="${esc(f.name)}" type="${esc(f.type)}"${val} ${req}>`;
    }
    return `<label class="field">
      <span>${esc(f.label)}${f.required ? ' *' : ''}</span>
      ${input}
    </label>`;
  }

  // איסוף ערכי הטופס — בטופס דינמי נאספים רק השדות הפעילים לסוג הנבחר
  function collectFormData(fields) {
    const schema = currentSchema();
    const relevant = (schema && schema.dynamic) ? activeFields(schema) : fields;
    const data = {};
    for (const f of relevant) {
      const el = document.getElementById('f_' + f.name);
      if (!el) continue;
      let value = el.value.trim();
      if (f.required && !value) {
        throw new Error(`השדה "${f.label}" הוא שדה חובה`);
      }
      if (f.type === 'number' && value !== '') {
        value = Number(value);
        if (Number.isNaN(value)) {
          throw new Error(`השדה "${f.label}" חייב להיות מספר`);
        }
      }
      if (value !== '') data[f.name] = value;
    }
    return data;
  }

  // Handle user action
  async function handleUser() {
    try {
      if (state.user) {
        await window.systemAPI.logout();
        state.user = null;
        showToast('התנתקת מהמערכת');
        await loginUser();
      } else {
        await loginUser();
      }
    } catch (error) {
      showError('שגיאה בניהול משתמש: ' + error.message);
    }
  }

  // Handle backup — גיבוי מוצפן בלבד: ההצפנה במסגרת הראשית, והקובץ שנשמר הוא SSBK1: בלבד
  async function handleBackup() {
    try {
      const f = await askFields('גיבוי מוצפן', [{ name: 'pass', label: 'סיסמת גיבוי (לפחות 8 תווים)', type: 'password' }], 'צור גיבוי');
      if (!f) return;
      if (f.pass.length < 8) { showError('סיסמת הגיבוי חייבת להכיל לפחות 8 תווים'); return; }
      showToast('יוצר גיבוי מוצפן...');
      const text = await window.systemAPI.backupEncrypted(f.pass);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const filename = `גיבוי-מערכת-כלכלית-${stamp}.ssbk`;
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('הגיבוי המוצפן נשמר: ' + filename);
    } catch (error) {
      showError('שגיאה בגיבוי: ' + errMsg(error));
    }
  }

  // Handle restore — מזהה גיבוי מוצפן (SSBK1:) ומבקש סיסמה; גיבוי ישן (JSON) נתמך לשחזור בלבד
  async function handleRestore() {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.ssbk,.json,application/json';
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          if (!(await askConfirm('השחזור יחליף את כל הנתונים הכלכליים הקיימים. להמשיך?'))) return;
          if (text.startsWith('SSBK1:')) {
            const f = await askFields('שחזור מגיבוי מוצפן', [{ name: 'pass', label: 'סיסמת הגיבוי', type: 'password' }], 'שחזר');
            if (!f) return;
            await window.systemAPI.restoreEncrypted(text, f.pass);
          } else {
            await window.systemAPI.restoreData(JSON.parse(text));
          }
          showToast('השחזור הושלם בהצלחה');
          await switchView(state.currentView);
        } catch (error) {
          showError('שגיאה בשחזור: ' + errMsg(error));
        }
      });
      input.click();
    } catch (error) {
      showError('שגיאה בשחזור: ' + errMsg(error));
    }
  }

  // Handle form submission — יוצר או מעדכן רשומה בפועל
  async function handleSubmit() {
    const schema = currentSchema();
    if (!schema) {
      closeModal();
      return;
    }

    let data;
    try {
      data = collectFormData(schema.fields);
    } catch (error) {
      showError(error.message);
      return;
    }

    try {
      elements.submitBtn.disabled = true;
      if (state.editingId && schema.update) {
        await schema.update(state.editingId, data);
        showToast('הרשומה עודכנה בהצלחה');
      } else {
        await schema.create(data);
        showToast('הרשומה נשמרה בהצלחה');
      }
      state.editingId = null;
      closeModal();
      await switchView(state.currentView);
    } catch (error) {
      showError('שגיאה בשמירה: ' + error.message);
    } finally {
      elements.submitBtn.disabled = false;
    }
  }

  // Handle delete — מוחק רשומה עם אישור
  async function handleDelete(id) {
    const schema = formSchemas[state.currentView];
    if (!schema || !schema.remove) return;
    if (!(await askConfirm(schema.confirmText || 'האם למחוק את הרשומה? הפעולה אינה ניתנת לביטול.'))) return;

    try {
      await schema.remove(id);
      showToast('הרשומה נמחקה');
      await switchView(state.currentView);
    } catch (error) {
      showError('שגיאה במחיקה: ' + error.message);
    }
  }

  // Handle edit — פותח טופס עם הנתונים הקיימים.
  // שדות הטופס אינם שמות הרשומה בהכרח: סכימות מסוימות (למשל הגדרות מע"מ) שומרות
  // vatRate (0.17) בעוד שהשדה הוא vatPercent (17). לכן המילוי עובר דרך prepare של
  // הסכימה — בדיוק כמו בפתיחת טופס "הוספה" — ולא בהעתקה עיוורת של שדות הרשומה.
  async function handleEdit(id, record) {
    const schema = formSchemas[state.currentView];
    if (!schema || !schema.update) {
      showToast('בתצוגה זו אין עריכה');
      return;
    }
    state.editingId = id;
    // שמירת ערכי הטופס שהיו לסכימה לפני העריכה — כדי שטופס "הוספה" הבא
    // לא ייפתח מלא בנתונים של הרשומה האחרונה שערכנו.
    state.fieldValuesBackup = schema.fields.map(f => f.value);
    try {
      if (typeof schema.prepare === 'function') {
        await schema.prepare(schema);
      } else {
        for (const f of schema.fields) {
          const v = record ? record[f.name] : undefined;
          if (v !== undefined && v !== null) f.value = v;
        }
      }
    } catch (error) {
      showError('שגיאה בטעינת הרשומה לעריכה: ' + errMsg(error));
      state.editingId = null;
      state.fieldValuesBackup = null;
      return;
    }
    showModal('עריכת ' + schema.title.replace(' חדשה', ''), buildFormHtml(schema.fields));
    for (const f of schema.fields) {
      const el = document.getElementById('f_' + f.name);
      if (el && f.value !== undefined && f.value !== null) el.value = f.value;
    }
    if (typeof schema.afterRender === 'function') schema.afterRender();
  }

  // חיפוש בתצוגות נתמכות
  async function performSearch(query) {
    const schema = formSchemas[state.currentView];
    if (!schema || !schema.search) return;

    try {
      if (!query) {
        await switchView(state.currentView);
        return;
      }
      const results = await schema.search(query);
      const key = { contacts: 'contacts', 'voice-notes': 'notes' }[state.currentView];
      state.data[state.currentView] = { [key]: results };
      renderView(state.currentView);
      const input = document.getElementById('viewSearch');
      if (input) {
        input.value = query;
        input.focus();
      }
    } catch (error) {
      showError('שגיאה בחיפוש: ' + error.message);
    }
  }

  // ===== דיאלוגים בתוך האפליקציה (prompt/confirm לא נתמכים ב-Electron) =====
  // מונע הזרקת HTML מטקסט שהמשתמש הזין (XSS)
  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function errMsg(error) {
    const raw = String((error && error.message) || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    const known = {
      'Invalid credentials': 'שם משתמש או סיסמה שגויים',
      'Admin user already exists': 'כבר קיים מנהל במערכת',
      'Password must be at least 12 characters': 'הסיסמה חייבת להכיל לפחות 12 תווים'
    };
    return known[raw] || raw;
  }

  function openDialog(build) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      const card = document.createElement('div');
      card.className = 'modal-card';
      card.style.maxWidth = '420px';
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        resolve(value);
      };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(null); } };
      document.addEventListener('keydown', onKey, true);
      build(card, finish);
    });
  }

  function askConfirm(message) {
    return openDialog((card, finish) => {
      const h = document.createElement('h2');
      h.textContent = 'אישור';
      const p = document.createElement('p');
      p.textContent = message;
      p.style.padding = '0 1.5rem';
      const actions = document.createElement('div');
      actions.className = 'modal-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'secondary';
      cancel.textContent = 'ביטול';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'danger';
      ok.textContent = 'אישור';
      cancel.addEventListener('click', () => finish(false));
      ok.addEventListener('click', () => finish(true));
      actions.append(cancel, ok);
      card.append(h, p, actions);
      ok.focus();
    });
  }

  function askFields(title, fields, submitText, initial = {}) {
    return openDialog((card, finish) => {
      const h = document.createElement('h2');
      h.textContent = title;
      const form = document.createElement('form');
      form.className = 'modal-form';
      form.noValidate = true;
      const inputs = {};
      for (const f of fields) {
        const label = document.createElement('label');
        label.textContent = f.label;
        const input = document.createElement('input');
        input.type = f.type || 'text';
        input.name = f.name;
        input.autocomplete = f.type === 'password' ? 'current-password' : 'username';
        input.value = initial[f.name] || '';
        label.appendChild(input);
        form.appendChild(label);
        inputs[f.name] = input;
      }
      const err = document.createElement('div');
      err.style.color = '#b91c1c';
      err.style.fontSize = '0.9rem';
      const actions = document.createElement('div');
      actions.className = 'modal-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'secondary';
      cancel.textContent = 'ביטול';
      const ok = document.createElement('button');
      ok.type = 'submit';
      ok.className = 'primary';
      ok.textContent = submitText;
      actions.append(cancel, ok);
      form.append(err, actions);
      card.append(h, form);

      cancel.addEventListener('click', () => finish(null));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const values = {};
        for (const f of fields) {
          const raw = inputs[f.name].value;
          const v = f.type === 'password' ? raw : raw.trim();
          if (!v) {
            err.textContent = 'יש למלא את השדה: ' + f.label;
            inputs[f.name].focus();
            return;
          }
          values[f.name] = v;
        }
        finish(values);
      });
      const first = Object.values(inputs)[0];
      if (first) first.focus();
    });
  }

  // Setup admin
  async function setupAdmin() {
    const values = await askFields('יצירת מנהל ראשון', [
      { name: 'username', label: 'שם משתמש' },
      { name: 'password', label: 'סיסמה (לפחות 12 תווים)', type: 'password' }
    ], 'צור מנהל');
    if (!values) return;
    try {
      state.user = await window.systemAPI.setupAdmin(values.username, values.password);
      showToast('מנהל נוצר בהצלחה');
    } catch (error) {
      showError('שגיאה ביצירת מנהל: ' + errMsg(error));
    }
  }

  // Login user — שומר את שם המשתמש האחרון אחרי ניסיון כושל
  let lastLoginUser = '';
  async function loginUser() {
    const values = await askFields('התחברות למערכת', [
      { name: 'username', label: 'שם משתמש' },
      { name: 'password', label: 'סיסמה', type: 'password' }
    ], 'התחבר', { username: lastLoginUser });
    if (!values) return;
    lastLoginUser = values.username;
    try {
      state.user = await window.systemAPI.login(values.username, values.password);
      showToast('התחברות בהצלחה');
    } catch (error) {
      showError('שגיאה בהתחברות: ' + errMsg(error));
    }
  }

  // Close modal
  function closeModal() {
    elements.modal.classList.add('hidden');
    elements.modalForm.innerHTML = '';
    // עריכת רשומה דרסה את ערכי השדות שבסכימה; מחזירים אותם כדי שטופס "הוספה"
    // הבא ייפתח נקי. כל יציאה מהחלון (ביטול / × / שמירה) עוברת כאן.
    const schema = formSchemas[state.currentView];
    state.subForm = null;
    if (schema && state.fieldValuesBackup) {
      schema.fields.forEach((f, i) => { f.value = state.fieldValuesBackup[i]; });
    }
    state.fieldValuesBackup = null;
    state.editingId = null;
  }

  // Show modal
  function showModal(title, formHtml) {
    elements.modalTitle.textContent = title;
    elements.modalForm.innerHTML = formHtml;
    elements.modal.classList.remove('hidden');
  }

  // Show toast notification
  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    elements.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // Show error notification
  // פגישה שפגה (חוסר פעילות): מציגים שוב את מסך הכניסה ואחר כך טוענים מחדש את התצוגה
  let reloginPending = false;
  function maybeRelogin(message) {
    if (!String(message).includes('נדרשת כניסה') || reloginPending) return;
    reloginPending = true;
    state.user = null;
    loginUser().then(() => {
      if (state.user) switchView(state.currentView);
    }).finally(() => { reloginPending = false; });
  }

  function showError(message) {
    maybeRelogin(message);
    const toast = document.createElement('div');
    toast.className = 'toast danger';
    toast.textContent = message;
    elements.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();