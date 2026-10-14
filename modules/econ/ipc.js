// Main Electron Application Entry Point
const { ipcMain, dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const X = require('./core/exports');
const { initializeDatabase } = require('./core/database');
const { AuthService: authService } = require('./services/authService');
const { FinancialService: financialService } = require('./services/financialService');
const { MarketIntelService: marketIntelService } = require('./services/marketIntelService');
const { PersonalFinanceService: personalFinanceService } = require('./services/personalFinanceService');
const { MortgageService: mortgageService } = require('./services/mortgageService');
const { BusinessService: businessService } = require('./services/businessService');
const { CanvasService: canvasService } = require('./services/canvasService');
const { TasksService: tasksService } = require('./services/tasksService');
const { ContactsService: contactsService } = require('./services/contactsService');
const { FitnessService: fitnessService } = require('./services/fitnessService');
const { VoiceNotesService: voiceNotesService } = require('./services/voiceNotesService');
const { AccountingService: accountingService } = require('./services/accountingService');
const { NpoService: npoService } = require('./services/npoService');
const { MortgageAdvisorService: mortgageAdvisorService } = require('./services/mortgageAdvisorService');
const BK = require('./core/backupCrypto');

let db;

async function initEcon(userDataPath) {
  db = await initializeDatabase(userDataPath);
  authService.initialize(db);
  financialService.initialize(db);
  marketIntelService.initialize(db);
  personalFinanceService.initialize(db);
  mortgageService.initialize(db);
  businessService.initialize(db);
  canvasService.initialize(db);
  tasksService.initialize(db);
  contactsService.initialize(db);
  fitnessService.initialize(db);
  voiceNotesService.initialize(db);
  accountingService.initialize(db);
  npoService.initialize(db);
  mortgageAdvisorService.initialize(db);
  registerIpcHandlers();
  return db;
}

// כל ערוץ (מלבד כניסה/יציאה/סטטוס) דורש משתמש מחובר בצד השרת — לא רק במסך ה-UI
const PUBLIC_CHANNELS = new Set(['auth:status', 'auth:setup', 'auth:login', 'auth:logout']);

// כל הפעולות על מסד הנתונים רצות אחת-אחת: כל פעולה טוענת את כל הנתונים, משנה ושומרת.
// הרצה במקביל גורמת לעדכונים שהולכים לאיבוד ולשגיאות טרנזקציה של SQLite.
let dbQueue = Promise.resolve();
function enqueue(task) {
  const run = dbQueue.then(task);
  dbQueue = run.catch(() => {});
  return run;
}

// הרשאה נדרשת לפי סוג הפעולה. ערוצי auth דורשים רק כניסה. ברירת מחדל לכתיבה: data.edit
function permissionFor(channel) {
  const name = channel.includes(':') ? channel.split(':')[1] : channel;
  if (channel.startsWith('auth:')) return null;
  if (/backup/i.test(name)) return 'data.backup';
  if (/restore/i.test(name)) return 'data.restore';
  if (/export/i.test(name)) return 'data.export';
  if (/^(delete|remove|reverse|cancel|unrecord)/i.test(name) || /delete/i.test(name)) return 'data.delete';
  if (/^(get|calc|search|list|report)/i.test(name)) return 'data.view';
  return 'data.edit';
}

// בדיקת גישה לפי מזהה חלון (ה-session נשמר לפי מזהה ה-webContents שבו בוצעה הכניסה).
// משמשת קוד שלא עובר דרך handle — למשל גיבוי/שחזור מהמעטפת.
function assertAccess(senderId, permission) {
  if (!authService.getSession(senderId)) throw new Error('נדרשת כניסה למערכת (או שהפגישה פגה לאחר חוסר פעילות)');
  if (permission && !authService.hasPermission(senderId, permission)) throw new Error('אין הרשאה לפעולה זו');
  return authService.getSession(senderId);
}

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => enqueue(async () => {
    if (PUBLIC_CHANNELS.has(channel)) return fn(event, ...args);
    if (!authService.getSession(event.sender.id)) {
      throw new Error('נדרשת כניסה למערכת (או שהפגישה פגה לאחר חוסר פעילות)');
    }
    const perm = permissionFor(channel);
    if (perm && !authService.hasPermission(event.sender.id, perm)) {
      throw new Error('אין הרשאה לפעולה זו');
    }
    return fn(event, ...args);
  }));
}

// רישום ביקורת: מי עשה מה ומתי (נשמר בטבלת audit_events)
async function auditEvent(event, action, details) {
  const user = authService.getSession(event.sender.id);
  try { await db.audit(user && user.id, action, JSON.stringify(details || {})); } catch (e) { console.error('audit failed', e); }
}

// הפקת PDF מ-HTML: רינדור בחלון נסתר בלי JavaScript, ואז שמירה במקום שהמשתמש בוחר
async function saveHtmlAsPdf(html, defaultPath) {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
  try {
    await win.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(html, 'utf8').toString('base64'));
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
    const r = await dialog.showSaveDialog({ defaultPath, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return { ok: false };
    fs.writeFileSync(r.filePath, pdf);
    return { ok: true, path: r.filePath };
  } finally {
    win.destroy();
  }
}

async function saveCsv({ headers, rows, name }) {
  const r = await dialog.showSaveDialog({ defaultPath: `${name}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  fs.writeFileSync(r.filePath, X.toCsv(headers, rows), 'utf8');
  return { ok: true, path: r.filePath, rows: rows.length };
}

function registerIpcHandlers() {
  // Auth handlers
  handle('auth:status', async (event) => {
    return await authService.getStatus(event.sender.id);
  });
  
  handle('auth:setup', async (event, username, password) => {
    return await authService.setupAdmin(username, password);
  });
  
handle('auth:login', async (event, username, password) => {
    const user = await authService.login(username, password);
    authService.setSession(event.sender.id, user);
    return user;
  });
  
  handle('auth:logout', async (event) => {
    return await authService.logout(event.sender.id);
  });
  
  handle('auth:change-password', async (event, currentPassword, newPassword) => {
    const user = authService.getSession(event.sender.id);
    return await authService.changePassword(user.id, currentPassword, newPassword);
  });

  // Financial handlers
  handle('financial:calculateMetrics', async (event, data) => {
    return await financialService.calculateMetrics(data);
  });
  
  handle('financial:exportCSV', async (event, data, filename) => {
    return await financialService.exportToCSV(data, filename);
  });

  // Market Intelligence handlers
  handle('marketIntel:get', async (event) => {
    return await marketIntelService.getIntel(event.sender.id);
  });
  
  handle('marketIntel:update', async (event, intelData) => {
    return await marketIntelService.updateIntel(event.sender.id, intelData);
  });

  // Personal Finance handlers
  handle('personalFinance:get', async (event) => {
    return await personalFinanceService.getFinance(event.sender.id);
  });
  
  handle('personalFinance:update', async (event, financeData) => {
    return await personalFinanceService.updateFinance(event.sender.id, financeData);
  });
  
  handle('personalFinance:calculateLoan', async (event, loanData) => {
    return await personalFinanceService.calculateLoan(loanData);
  });
  
  handle('personalFinance:addIncome', async (event, incomeData) => {
    return await personalFinanceService.addIncome(event.sender.id, incomeData);
  });
  
  handle('personalFinance:addExpense', async (event, expenseData) => {
    return await personalFinanceService.addExpense(event.sender.id, expenseData);
  });
  
  handle('personalFinance:addInvestment', async (event, investmentData) => {
    return await personalFinanceService.addInvestment(event.sender.id, investmentData);
  });
  
  handle('personalFinance:addCashFlowEntry', async (event, cashFlowData) => {
    return await personalFinanceService.addCashFlowEntry(event.sender.id, cashFlowData);
  });

  // Mortgage handlers
  handle('mortgage:getScenarios', async (event) => {
    return await mortgageService.getScenarios(event.sender.id);
  });
  
  handle('mortgage:saveScenario', async (event, scenarioData) => {
    return await mortgageService.saveScenario(event.sender.id, scenarioData);
  });
  
  handle('mortgage:deleteScenario', async (event, scenarioId) => {
    return await mortgageService.deleteScenario(event.sender.id, scenarioId);
  });
  
  handle('mortgage:calculateLoan', async (event, loanData) => {
    return await mortgageService.calculateLoan(loanData);
  });

  // Business handlers
  handle('business:getPlans', async (event) => {
    return await businessService.getBusinessPlans(event.sender.id);
  });
  
  handle('business:savePlan', async (event, planData) => {
    return await businessService.saveBusinessPlan(event.sender.id, planData);
  });
  
  handle('business:deletePlan', async (event, planId) => {
    return await businessService.deleteBusinessPlan(event.sender.id, planId);
  });
  
  handle('business:updatePlan', async (event, planId, updates) => {
    return await businessService.updateBusinessPlan(event.sender.id, planId, updates);
  });

  // Canvas handlers
  handle('canvas:getBoards', async (event) => {
    return await canvasService.getBoards(event.sender.id);
  });
  
  handle('canvas:saveBoard', async (event, boardData) => {
    return await canvasService.saveBoard(event.sender.id, boardData);
  });
  
  handle('canvas:deleteBoard', async (event, boardId) => {
    return await canvasService.deleteBoard(event.sender.id, boardId);
  });
  
  handle('canvas:updateBoard', async (event, boardId, updates) => {
    return await canvasService.updateBoard(event.sender.id, boardId, updates);
  });

  // Tasks handlers
  handle('tasks:get', async (event) => {
    return await tasksService.getTasks(event.sender.id);
  });
  
  handle('tasks:create', async (event, taskData) => {
    return await tasksService.createTask(event.sender.id, taskData);
  });
  
  handle('tasks:update', async (event, taskId, updates) => {
    return await tasksService.updateTask(event.sender.id, taskId, updates);
  });
  
  handle('tasks:delete', async (event, taskId) => {
    return await tasksService.deleteTask(event.sender.id, taskId);
  });

  handle('tasks:getOverdueTasks', async (event) => {
    return await tasksService.getOverdueTasks(event.sender.id);
  });

  handle('tasks:getTasksByCategory', async (event, category) => {
    return await tasksService.getTasksByCategory(event.sender.id, category);
  });

  handle('tasks:getTasksByPriority', async (event, priority) => {
    return await tasksService.getTasksByPriority(event.sender.id, priority);
  });

  // Contacts handlers
  handle('contacts:get', async (event) => {
    return await contactsService.getContacts(event.sender.id);
  });
  
  handle('contacts:create', async (event, contactData) => {
    return await contactsService.createContact(event.sender.id, contactData);
  });
  
  handle('contacts:update', async (event, contactId, updates) => {
    return await contactsService.updateContact(event.sender.id, contactId, updates);
  });
  
  handle('contacts:delete', async (event, contactId) => {
    return await contactsService.deleteContact(event.sender.id, contactId);
  });

  handle('contacts:search', async (event, query) => {
    return await contactsService.searchContacts(event.sender.id, query);
  });

  // Fitness handlers
  handle('fitness:get', async (event) => {
    return await fitnessService.getFitnessData(event.sender.id);
  });
  
  handle('fitness:createWorkout', async (event, workoutData) => {
    return await fitnessService.createWorkout(event.sender.id, workoutData);
  });
  
  handle('fitness:createNutrition', async (event, nutritionData) => {
    return await fitnessService.createNutrition(event.sender.id, nutritionData);
  });
  
  handle('fitness:createMetric', async (event, metricData) => {
    return await fitnessService.createMetric(event.sender.id, metricData);
  });
  
  handle('fitness:getWorkoutsByType', async (event, type) => {
    return await fitnessService.getWorkoutsByType(event.sender.id, type);
  });
  
  handle('fitness:getMetricsByDateRange', async (event, startDate, endDate) => {
    return await fitnessService.getMetricsByDateRange(event.sender.id, startDate, endDate);
  });

  // Voice Notes handlers
  handle('voiceNotes:get', async (event) => {
    return await voiceNotesService.getVoiceNotes(event.sender.id);
  });
  
  handle('voiceNotes:create', async (event, noteData) => {
    return await voiceNotesService.createVoiceNote(event.sender.id, noteData);
  });
  
  handle('voiceNotes:update', async (event, noteId, updates) => {
    return await voiceNotesService.updateVoiceNote(event.sender.id, noteId, updates);
  });
  
  handle('voiceNotes:delete', async (event, noteId) => {
    return await voiceNotesService.deleteVoiceNote(event.sender.id, noteId);
  });

  handle('voiceNotes:search', async (event, query) => {
    return await voiceNotesService.searchVoiceNotes(event.sender.id, query);
  });

  // Market Intelligence: delete and update entry
  handle('marketIntel:deleteEntry', async (event, entryId) => {
    return await marketIntelService.deleteEntry(event.sender.id, entryId);
  });
  handle('marketIntel:updateEntry', async (event, entryId, updates) => {
    return await marketIntelService.updateEntry(event.sender.id, entryId, updates);
  });
  
  // Mortgage: update scenario
  handle('mortgage:updateScenario', async (event, scenarioId, updates) => {
    return await mortgageService.updateScenario(event.sender.id, scenarioId, updates);
  });

  // Accounting: תוכנית חשבונות, יומן, חשבוניות, דוחות ומע"מ
  handle('acct:getChart', async () => accountingService.getChart());
  handle('acct:addAccount', async (event, account) => {
    const result = await accountingService.addAccount(account);
    await auditEvent(event, 'acct.account.add', { id: result && (result.id || result.number) });
    return result;
  });
  handle('acct:getJournal', async (event, range) => accountingService.getJournal(range || {}));
  handle('acct:createEntry', async (event, entry) => {
    const result = await accountingService.createEntry(entry);
    await auditEvent(event, 'acct.entry.create', { id: result && (result.id || result.number) });
    return result;
  });
  handle('acct:reverseEntry', async (event, entryId) => {
    const result = await accountingService.reverseEntry(entryId);
    await auditEvent(event, 'acct.entry.reverse', { id: result && (result.id || result.number) });
    return result;
  });
  handle('acct:getInvoices', async () => accountingService.getInvoices());
  handle('acct:createInvoice', async (event, invoice) => {
    const result = await accountingService.createInvoice(invoice);
    await auditEvent(event, 'acct.invoice.create', { id: result && (result.id || result.number) });
    return result;
  });
  handle('acct:recordPayment', async (event, invoiceId, payment) => {
    const result = await accountingService.recordPayment(invoiceId, payment || {});
    await auditEvent(event, 'acct.invoice.paid', { id: result && (result.id || result.number) });
    return result;
  });
  handle('acct:getReports', async (event, range) => accountingService.getReports(range || {}));
  handle('acct:setVatRate', async (event, rate) => accountingService.setVatRate(rate));
  handle('acct:getSettings', async () => accountingService.getSettings());
  handle('acct:getProducts', async () => accountingService.getProducts());
  handle('acct:importProducts', async (event, csvText) => {
    const result = await accountingService.importProducts(csvText);
    await auditEvent(event, 'acct.product.import', { added: result.added, errors: result.errors.length });
    return result;
  });
  handle('acct:getPeriodSummary', async (event, range) => accountingService.getPeriodSummary(range || {}));
  handle('acct:getInvoiceAnalytics', async () => accountingService.getInvoiceAnalytics());
  handle('acct:unrecordPayment', async (event, invoiceId) => {
    const result = await accountingService.unrecordPayment(invoiceId);
    await auditEvent(event, 'acct.invoice.unpaid', { number: result.number });
    return result;
  });

  // הוצאות אישיות/משפחתיות — רשימה נפרדת מהיומן העסקי
  handle('personal:getEntries', async (event, range) => accountingService.getPersonal(range || {}));
  handle('personal:getSummary', async (event, range) => accountingService.getPersonalSummary(range || {}));
  handle('personal:addEntry', async (event, entry) => {
    const result = await accountingService.addPersonal(entry);
    await auditEvent(event, 'personal.entry.add', { id: result.id });
    return result;
  });
  handle('personal:deleteEntry', async (event, entryId) => {
    await accountingService.deletePersonal(entryId);
    await auditEvent(event, 'personal.entry.delete', { id: entryId });
    return true;
  });
  handle('acct:addProduct', async (event, product) => {
    const result = await accountingService.addProduct(product);
    await auditEvent(event, 'acct.product.add', { id: result.id });
    return result;
  });
  handle('acct:deleteProduct', async (event, productId) => {
    await accountingService.deleteProduct(productId);
    await auditEvent(event, 'acct.product.delete', { id: productId });
    return true;
  });
  handle('acct:calcPrice', async (event, input) => accountingService.calcPrice(input));
  handle('acct:cancelInvoice', async (event, invoiceId) => {
    const result = await accountingService.cancelInvoice(invoiceId);
    await auditEvent(event, 'acct.invoice.cancel', { number: result.number });
    return result;
  });
  handle('acct:saveSettings', async (event, input) => {
    const saved = await accountingService.saveSettings(input);
    await auditEvent(event, 'acct.settings.save', { lockDate: saved.lockDate, vatRate: saved.vatRate });
    return saved;
  });
  handle('acct:exportInvoicePdf', async (event, invoiceId) => {
    const inv = await accountingService.getInvoice(invoiceId);
    const { business } = await accountingService.getSettings();
    const html = X.renderInvoiceHtml(inv, business);
    // רינדור במופע חלון נסתר ואז הדפסה ל-PDF, כך שהפלט זהה למה שרואים
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
    try {
      await win.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(html, 'utf8').toString('base64'));
      const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
      const r = await dialog.showSaveDialog({ defaultPath: `חשבונית-${inv.number}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (r.canceled || !r.filePath) return { ok: false };
      fs.writeFileSync(r.filePath, pdf);
      await auditEvent(event, 'acct.invoice.pdf', { number: inv.number });
      return { ok: true, path: r.filePath };
    } finally {
      win.destroy();
    }
  });
  handle('acct:exportCsv', async (event, kind, range) => {
    const { headers, rows, name } = await accountingService.getExportData(kind, range || {});
    const r = await dialog.showSaveDialog({ defaultPath: `${name}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled || !r.filePath) return { ok: false };
    fs.writeFileSync(r.filePath, X.toCsv(headers, rows), 'utf8');
    await auditEvent(event, 'acct.export.csv', { kind, rows: rows.length });
    return { ok: true, path: r.filePath };
  });

  // עמותות: תרומות וקבלות סעיף 46, קרנות, תמיכות ודוח שנתי — נפרד מהיומן העסקי
  handle('npo:getOverview', async (event, year) => npoService.getOverview(year));
  handle('npo:saveSettings', async (event, input) => {
    const saved = await npoService.saveSettings(input || {});
    await auditEvent(event, 'npo.settings.save', { vatStatus: saved.vatStatus, funds: saved.funds.length });
    return saved;
  });
  handle('npo:addDonation', async (event, input) => {
    const d = await npoService.addDonation(input);
    await auditEvent(event, 'npo.donation.add', { receipt: d.receipt.number });
    return d;
  });
  handle('npo:cancelDonation', async (event, id) => {
    const d = await npoService.cancelDonation(id);
    await auditEvent(event, 'npo.donation.cancel', { receipt: d.receipt.number });
    return d;
  });
  handle('npo:addGrant', async (event, input) => {
    const g = await npoService.addGrant(input);
    await auditEvent(event, 'npo.grant.add', { id: g.id });
    return g;
  });
  handle('npo:updateGrant', async (event, id, input) => {
    const g = await npoService.updateGrant(id, input || {});
    await auditEvent(event, 'npo.grant.update', { id });
    return g;
  });
  handle('npo:deleteGrant', async (event, id) => {
    await npoService.deleteGrant(id);
    await auditEvent(event, 'npo.grant.delete', { id });
    return true;
  });
  handle('npo:exportCsv', async (event, kind, year) => {
    const r = await saveCsv(await npoService.getExportData(kind, year));
    if (r.ok) await auditEvent(event, 'npo.export.csv', { kind, year, rows: r.rows });
    return r;
  });
  handle('npo:exportReceiptPdf', async (event, id) => {
    const d = await npoService.getDonation(id);
    const r = await saveHtmlAsPdf(X.renderDonationReceiptHtml(d), `קבלה-${d.receipt.number}.pdf`);
    if (r.ok) await auditEvent(event, 'npo.receipt.pdf', { receipt: d.receipt.number });
    return r;
  });

  // ייעוץ משכנתאות: תיקים, הצעות, השוואה, עמלה ומסמכים
  handle('madv:getOverview', async () => mortgageAdvisorService.getOverview());
  handle('madv:calcTracks', async (event, input) => mortgageAdvisorService.calcTracks(input || {}));
  handle('madv:createClient', async (event, input) => {
    const c = await mortgageAdvisorService.createClient(input);
    await auditEvent(event, 'madv.client.create', { id: c.id });
    return c;
  });
  handle('madv:updateClient', async (event, id, input) => {
    const c = await mortgageAdvisorService.updateClient(id, input || {});
    await auditEvent(event, 'madv.client.update', { id, status: c.status });
    return c;
  });
  handle('madv:deleteClient', async (event, id) => {
    await mortgageAdvisorService.deleteClient(id);
    await auditEvent(event, 'madv.client.delete', { id });
    return true;
  });
  handle('madv:toggleDoc', async (event, id, key) => mortgageAdvisorService.toggleDoc(id, key));
  handle('madv:addOffer', async (event, input) => {
    const o = await mortgageAdvisorService.addOffer(input);
    await auditEvent(event, 'madv.offer.add', { id: o.id, clientId: o.clientId });
    return o;
  });
  handle('madv:deleteOffer', async (event, id) => {
    await mortgageAdvisorService.deleteOffer(id);
    await auditEvent(event, 'madv.offer.delete', { id });
    return true;
  });
  handle('madv:exportSchedule', async (event, offerId) => {
    const r = await saveCsv(await mortgageAdvisorService.getScheduleExport(offerId));
    if (r.ok) await auditEvent(event, 'madv.export.schedule', { offerId });
    return r;
  });

  // גיבוי ושחזור: ההצפנה נעשית כאן, והממשק מקבל ומחזיר רק טקסט מוצפן (SSBK1:)
  handle('data:backupEncrypted', async (event, passphrase) => {
    const plain = JSON.stringify(await db.backup());
    const out = BK.encryptBackup(plain, passphrase);
    await auditEvent(event, 'data.backup', { encrypted: true });
    return out;
  });
  handle('data:restoreEncrypted', async (event, text, passphrase) => {
    if (!BK.isEncryptedBackup(text)) throw new Error('הקובץ אינו גיבוי מוצפן של המערכת');
    const data = JSON.parse(BK.decryptBackup(text, passphrase));
    await db.restore(data);
    await auditEvent(event, 'data.restore', { encrypted: true });
    return true;
  });
  // ערוץ גיבוי גלוי הוסר: גיבוי לא מוצפן לא יוצא מהמערכת
  handle('data:restore', async (event, backupData) => {
    await auditEvent(event, 'data.restore', { encrypted: false });
    return await db.restore(backupData);
  });
}
module.exports = { initEcon, getDb: () => db, isLoggedIn: () => authService.sessions.size > 0, assertAccess };
