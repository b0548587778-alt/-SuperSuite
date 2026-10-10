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
    editingId: null
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
    'finance': 'תכנון פיננסי',
    'business': 'עסקים ולקוחות',
    'market-intel': 'מודיעין שוק',
    'mortgage': 'משכנתאות והלוואות',
    'personal-finance': 'התוכנית הפיננסית',
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

      await switchView('dashboard');
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
    const acc = data?.accounting;
    const invoices = (data?.invoices || []).slice(0, 5);
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

  // Render finance view
  function renderFinance(data) {
    const finance = data || {};
    const incomes = finance.incomes || [];
    const expenses = finance.expenses || [];
    const investments = finance.investments || [];

    return `
      <div class="finance">
        <div class="section">
          <h3>הכנסות (${incomes.length})</h3>
          ${incomes.map(i => `
            <div class="item">
              <span>${esc(i.source)}</span>
              <span>₪${i.amount} / ${esc(i.frequency)}</span>
            </div>
          `).join('')}
        </div>
        <div class="section">
          <h3>הוצאות (${expenses.length})</h3>
          ${expenses.map(e => `
            <div class="item">
              <span>${esc(e.category)}</span>
              <span>₪${e.amount} / ${esc(e.frequency)}</span>
            </div>
          `).join('')}
        </div>
        <div class="section">
          <h3>השקעות (${investments.length})</h3>
          ${investments.map(inv => `
            <div class="item">
              <span>${esc(inv.name)}</span>
              <span>₪${inv.principal} @ ${inv.annualRate}%</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Render business view
  function renderBusiness(data) {
    const plans = data?.plans || [];
    return `
      <div class="business">
        <h3>תוכניות עסקיות (${plans.length})</h3>
        ${plans.length === 0 ? renderEmpty('אין תוכניות עסקיות עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
        ${plans.map(p => `
          <div class="card">
            <h4>${esc(p.name)}</h4>
            <p>${esc(p.description || 'ללא תיאור')}</p>
            <small>תעשייה: ${esc(p.industry || 'לא צוין')}</small>
            ${renderCardActions(p.id)}
          </div>
        `).join('')}
      </div>
    `;
  }

  // Render market intelligence view
  function renderMarketIntel(data) {
    const entries = data?.entries || [];
    return `
      <div class="market-intel">
        <h3>מודיעין שוק (${entries.length})</h3>
        ${entries.length === 0 ? renderEmpty('אין רשומות מודיעין עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
        ${entries.map(e => `
          <div class="card">
            <h4>${esc(e.title)}</h4>
            <p>${esc(e.description || '')}</p>
            <small>מקור: ${esc(e.sourceType)} | אמינות: ${esc(e.credibility)} | כיוון: ${esc(e.impactDirection)}</small>
            ${renderCardActions(e.id)}
          </div>
        `).join('')}
      </div>
    `;
  }

  // Render mortgage view
  function renderMortgage(data) {
    const scenarios = data?.scenarios || [];
    return `
      <div class="mortgage">
        <h3>משכנתאות והלוואות (${scenarios.length})</h3>
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

  // Render personal finance view
  function renderPersonalFinance(data) {
    const finance = data || {};
    return `
      <div class="personal-finance">
        <h3>${esc(finance.planName || 'התוכנית הפיננסית')}</h3>
        <p>מטבע: ${esc(finance.currency || 'ILS')}</p>
        <div class="section">
          <h4>הכנסות: ${finance.incomes?.length || 0}</h4>
          <h4>הוצאות: ${finance.expenses?.length || 0}</h4>
          <h4>השקעות: ${finance.investments?.length || 0}</h4>
        </div>
      </div>
    `;
  }

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
            <small>קטגוריה: ${esc(t.category)} | עדיפות: ${esc(t.priority)} | סטטוס: ${esc(t.status)}</small>
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

  // Render fitness view
  function renderFitness(data) {
    const fitness = data || {};
    return `
      <div class="fitness">
        <h3>כושר ובריאות</h3>
        <div class="section">
          <h4>אימונים: ${fitness.workouts?.length || 0}</h4>
          <h4>תזונה: ${fitness.nutrition?.length || 0}</h4>
          <h4>מדדים: ${fitness.metrics?.length || 0}</h4>
        </div>
      </div>
    `;
  }

  // Render voice notes view
  function renderVoiceNotes(data) {
    const notes = data?.notes || [];
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
    const boards = data?.boards || [];
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

  function renderAcctReports(r) {
    if (!r) return renderEmpty('אין נתונים להצגה');
    const rows = (list) => list.map(x => `<div class="acct-row"><span>${esc(x.code)} ${esc(x.name)}</span><span>${money(x.amount)}</span></div>`).join('') || '<div class="acct-row muted">אין תנועות</div>';
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
    const entries = d?.entries || [];
    const names = Object.fromEntries((d?.chart || []).map(a => [a.code, a.name]));
    return `
      <div class="acct-header"><h3>רשומות יומן (${entries.length})</h3><button class="secondary" id="acctCsvJournal">ייצוא יומן ל-Excel</button></div>
      ${entries.length === 0 ? renderEmpty('אין רשומות יומן עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
      ${entries.map(e => `
        <div class="card ${e.reversedBy || e.reversalOf ? 'muted-card' : ''}">
          <h4>${esc(e.description || 'ללא תיאור')}</h4>
          <small>${esc(e.date)}${e.reversalOf ? ' · רשומת ביטול' : ''}${e.reversedBy ? ' · בוטלה' : ''}</small>
          <div class="acct-lines">${e.lines.map(l => `<div class="acct-row"><span>${esc(l.account)} ${esc(names[l.account] || '')}</span><span>${l.debit ? 'חובה ' + money(l.debit) : 'זכות ' + money(l.credit)}</span></div>`).join('')}</div>
          ${!e.reversedBy && !e.reversalOf ? renderCardActions(e.id) : ''}
        </div>`).join('')}`;
  }

  function renderAcctInvoices(d) {
    const invoices = d?.invoices || [];
    return `
      <h3>חשבוניות מס (${invoices.length})</h3>
      ${invoices.length === 0 ? renderEmpty('אין חשבוניות עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל') : ''}
      ${invoices.map(i => `
        <div class="card ${i.status === 'paid' ? 'done' : ''} ${i.status === 'cancelled' ? 'muted-card' : ''}">
          <h4>חשבונית ${esc(i.number)} · ${esc(i.customer)}</h4>
          <p>${i.items.map(it => esc(it.description)).join(', ')}</p>
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
    return `
      <div class="acct-grid">
        <div class="card">
          <h3>פרטי העסק</h3>
          ${row('שם העסק', b.name)}${row('ע.מ / ח.פ', b.taxId)}${row('כתובת', b.address)}${row('טלפון', b.phone)}${row('דוא"ל', b.email)}
        </div>
        <div class="card">
          <h3>הגדרות חשבונאות</h3>
          ${row('שיעור מע"מ', (st.vatRate * 100).toFixed(2) + '%')}
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
      ${list.map(p => `
        <div class="card">
          <h4>${esc(p.name)}</h4>
          <small>${p.kind === 'service' ? 'שירות' : 'מוצר'}${p.vatExempt ? ' · פטור ממע"מ' : ''}</small>
          <div class="acct-lines">
            <div class="acct-row"><span>עלות</span><span>${money(p.pricing.cost)}</span></div>
            <div class="acct-row"><span>רווח (${esc(p.markupPct)}%)</span><span>${money(p.pricing.profit)}</span></div>
            <div class="acct-row"><span>מחיר לפני מע"מ</span><span>${money(p.pricing.priceEx)}</span></div>
            <div class="acct-row acct-big"><span>מחיר לצרכן</span><span>${money(p.pricing.priceInc)}</span></div>
          </div>
          ${renderCardActions(p.id)}
        </div>`).join('')}`;
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
    const entries = d?.entries || [];
    const s = d?.summary || { income: 0, expense: 0, balance: 0, categories: [] };
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

  const readOnlyViews = ['dashboard', 'finance', 'personal-finance', 'fitness', 'acct-reports'];

  // Attach view-specific handlers
  function attachViewHandlers(viewName) {
    // כפתור הוספה — מושבת בתצוגות ללא טופס
    elements.addBtn.disabled = readOnlyViews.includes(viewName);

    // כפתורי מחיקה בכרטיסים
    document.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => handleDelete(btn.dataset.id));
    });

    // כפתורי עריכה בכרטיסים
    document.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const record = findRecordById(id);
        if (record) handleEdit(id, record);
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
    if (schema.afterRender) schema.afterRender();
  }

  // בניית HTML של טופס לפי סכימה
  function buildFormHtml(fields) {
    return fields.map(f => {
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
    }).join('');
  }

  // איסוף ערכי הטופס
  function collectFormData(fields) {
    const data = {};
    for (const f of fields) {
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
    const schema = formSchemas[state.currentView];
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

  // Handle edit — פותח טופס עם הנתונים הקיימים
  function handleEdit(id, record) {
    const schema = formSchemas[state.currentView];
    if (!schema || !schema.update) {
      showToast('בתצוגה זו אין עריכה');
      return;
    }
    state.editingId = id;
    showModal('עריכת ' + schema.title.replace(' חדשה', ''), buildFormHtml(schema.fields));
    for (const f of schema.fields) {
      const el = document.getElementById('f_' + f.name);
      if (el && record[f.name] !== undefined && record[f.name] !== null) {
        el.value = record[f.name];
      }
    }
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