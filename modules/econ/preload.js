// Preload script for Electron context bridging
const { contextBridge, ipcRenderer } = require('electron');

// בקשת ניווט מהסרגל האחיד של המעטפת. אם הגיעה לפני שהממשק נרשם — נשמרת ונמסרת ברישום
let pendingGoto = null;
let gotoListener = null;
ipcRenderer.on('econ:goto', (_e, view) => {
  if (typeof view !== 'string') return;
  if (gotoListener) gotoListener(view); else pendingGoto = view;
});

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('systemAPI', {
  // Authentication
  authStatus: () => ipcRenderer.invoke('auth:status'),
  setupAdmin: (username, password) => ipcRenderer.invoke('auth:setup', username, password),
  login: (username, password) => ipcRenderer.invoke('auth:login', username, password),
  logout: () => ipcRenderer.invoke('auth:logout'),
  changePassword: (currentPassword, newPassword) => ipcRenderer.invoke('auth:change-password', currentPassword, newPassword),

  // Financial
  calculateFinancialMetrics: (data) => ipcRenderer.invoke('financial:calculateMetrics', data),
  exportToCSV: (data, filename) => ipcRenderer.invoke('financial:exportCSV', data, filename),

  // Market Intelligence
  getMarketIntel: () => ipcRenderer.invoke('marketIntel:get'),
  updateMarketIntel: (intelData) => ipcRenderer.invoke('marketIntel:update', intelData),
  deleteMarketIntelEntry: (entryId) => ipcRenderer.invoke('marketIntel:deleteEntry', entryId),
  updateMarketIntelEntry: (entryId, updates) => ipcRenderer.invoke('marketIntel:updateEntry', entryId, updates),

  // Personal Finance
  getPersonalFinance: () => ipcRenderer.invoke('personalFinance:get'),
  updatePersonalFinance: (financeData) => ipcRenderer.invoke('personalFinance:update', financeData),
  calculateLoan: (loanData) => ipcRenderer.invoke('personalFinance:calculateLoan', loanData),
  // הוספת פריט בודד לתוכנית — במקום לדרוס את כל האוסף דרך updatePersonalFinance
  addPersonalIncome: (incomeData) => ipcRenderer.invoke('personalFinance:addIncome', incomeData),
  addPersonalExpense: (expenseData) => ipcRenderer.invoke('personalFinance:addExpense', expenseData),
  addPersonalInvestment: (investmentData) => ipcRenderer.invoke('personalFinance:addInvestment', investmentData),
  addPersonalCashFlowEntry: (cashFlowData) => ipcRenderer.invoke('personalFinance:addCashFlowEntry', cashFlowData),
  addFinanceItem: (kind, data) => ipcRenderer.invoke('personalFinance:addItem', kind, data),
  updateFinanceItem: (kind, id, data) => ipcRenderer.invoke('personalFinance:updateItem', kind, id, data),
  deleteFinanceItem: (kind, id) => ipcRenderer.invoke('personalFinance:deleteItem', kind, id),

  // Mortgage
  getMortgageScenarios: () => ipcRenderer.invoke('mortgage:getScenarios'),
  saveMortgageScenario: (scenarioData) => ipcRenderer.invoke('mortgage:saveScenario', scenarioData),
  deleteMortgageScenario: (scenarioId) => ipcRenderer.invoke('mortgage:deleteScenario', scenarioId),
  updateMortgageScenario: (scenarioId, updates) => ipcRenderer.invoke('mortgage:updateScenario', scenarioId, updates),
  calculateMortgageLoan: (loanData) => ipcRenderer.invoke('mortgage:calculateLoan', loanData),

  // Business
  getBusinessPlans: () => ipcRenderer.invoke('business:getPlans'),
  saveBusinessPlan: (planData) => ipcRenderer.invoke('business:savePlan', planData),
  deleteBusinessPlan: (planId) => ipcRenderer.invoke('business:deletePlan', planId),
  updateBusinessPlan: (planId, updates) => ipcRenderer.invoke('business:updatePlan', planId, updates),

  // Canvas/Whiteboard
  getCanvasBoards: () => ipcRenderer.invoke('canvas:getBoards'),
  saveCanvasBoard: (boardData) => ipcRenderer.invoke('canvas:saveBoard', boardData),
  deleteCanvasBoard: (boardId) => ipcRenderer.invoke('canvas:deleteBoard', boardId),
  updateCanvasBoard: (boardId, updates) => ipcRenderer.invoke('canvas:updateBoard', boardId, updates),

  // Tasks
  getTasks: () => ipcRenderer.invoke('tasks:get'),
  createTask: (taskData) => ipcRenderer.invoke('tasks:create', taskData),
  updateTask: (taskId, updates) => ipcRenderer.invoke('tasks:update', taskId, updates),
  deleteTask: (taskId) => ipcRenderer.invoke('tasks:delete', taskId),
  getOverdueTasks: () => ipcRenderer.invoke('tasks:getOverdueTasks'),
  getTasksByCategory: (category) => ipcRenderer.invoke('tasks:getTasksByCategory', category),
  getTasksByPriority: (priority) => ipcRenderer.invoke('tasks:getTasksByPriority', priority),

  // Contacts
  getContacts: () => ipcRenderer.invoke('contacts:get'),
  createContact: (contactData) => ipcRenderer.invoke('contacts:create', contactData),
  updateContact: (contactId, updates) => ipcRenderer.invoke('contacts:update', contactId, updates),
  deleteContact: (contactId) => ipcRenderer.invoke('contacts:delete', contactId),
  searchContacts: (query) => ipcRenderer.invoke('contacts:search', query),

  // Fitness
  getFitnessData: () => ipcRenderer.invoke('fitness:get'),
  createWorkout: (workoutData) => ipcRenderer.invoke('fitness:createWorkout', workoutData),
  createNutrition: (nutritionData) => ipcRenderer.invoke('fitness:createNutrition', nutritionData),
  createMetric: (metricData) => ipcRenderer.invoke('fitness:createMetric', metricData),
  getWorkoutsByType: (type) => ipcRenderer.invoke('fitness:getWorkoutsByType', type),
  getMetricsByDateRange: (startDate, endDate) => ipcRenderer.invoke('fitness:getMetricsByDateRange', startDate, endDate),

  // Voice Notes
  getVoiceNotes: () => ipcRenderer.invoke('voiceNotes:get'),
  createVoiceNote: (noteData) => ipcRenderer.invoke('voiceNotes:create', noteData),
  updateVoiceNote: (noteId, updates) => ipcRenderer.invoke('voiceNotes:update', noteId, updates),
  deleteVoiceNote: (noteId) => ipcRenderer.invoke('voiceNotes:delete', noteId),
  searchVoiceNotes: (query) => ipcRenderer.invoke('voiceNotes:search', query),
  // Modules: מעבר בין מודולי החבילה מתוך לוח הבקרה
  openModule: (id) => ipcRenderer.invoke('shell:open-module', id),
  // סרגל אחיד: קבלת בקשות מעבר תצוגה, ודיווח על התצוגה הפעילה לסימון בסרגל
  onGoto: (cb) => {
    gotoListener = cb;
    if (pendingGoto) { const v = pendingGoto; pendingGoto = null; cb(v); }
  },
  reportView: (view) => ipcRenderer.invoke('shell:econ-view', view),

  // Accounting
  getChart: () => ipcRenderer.invoke('acct:getChart'),
  addAccount: (account) => ipcRenderer.invoke('acct:addAccount', account),
  getJournal: (range) => ipcRenderer.invoke('acct:getJournal', range),
  createEntry: (entry) => ipcRenderer.invoke('acct:createEntry', entry),
  reverseEntry: (entryId) => ipcRenderer.invoke('acct:reverseEntry', entryId),
  getInvoices: () => ipcRenderer.invoke('acct:getInvoices'),
  createInvoice: (invoice) => ipcRenderer.invoke('acct:createInvoice', invoice),
  recordPayment: (invoiceId, payment) => ipcRenderer.invoke('acct:recordPayment', invoiceId, payment),
  getAccountingReports: (range) => ipcRenderer.invoke('acct:getReports', range),
  setVatRate: (rate) => ipcRenderer.invoke('acct:setVatRate', rate),
  getAccountingSettings: () => ipcRenderer.invoke('acct:getSettings'),
  cancelInvoice: (invoiceId) => ipcRenderer.invoke('acct:cancelInvoice', invoiceId),
  getProducts: () => ipcRenderer.invoke('acct:getProducts'),
  addProduct: (product) => ipcRenderer.invoke('acct:addProduct', product),
  deleteProduct: (productId) => ipcRenderer.invoke('acct:deleteProduct', productId),
  calcPrice: (input) => ipcRenderer.invoke('acct:calcPrice', input),
  saveAccountingSettings: (input) => ipcRenderer.invoke('acct:saveSettings', input),
  exportInvoicePdf: (invoiceId) => ipcRenderer.invoke('acct:exportInvoicePdf', invoiceId),
  exportAccountingCsv: (kind, range) => ipcRenderer.invoke('acct:exportCsv', kind, range),

  getPeriodSummary: (range) => ipcRenderer.invoke('acct:getPeriodSummary', range),
  getInvoiceAnalytics: () => ipcRenderer.invoke('acct:getInvoiceAnalytics'),
  importProducts: (csvText) => ipcRenderer.invoke('acct:importProducts', csvText),
  unrecordPayment: (invoiceId) => ipcRenderer.invoke('acct:unrecordPayment', invoiceId),
  getPersonalEntries: (range) => ipcRenderer.invoke('personal:getEntries', range),
  getPersonalSummary: (range) => ipcRenderer.invoke('personal:getSummary', range),
  addPersonalEntry: (entry) => ipcRenderer.invoke('personal:addEntry', entry),
  deletePersonalEntry: (entryId) => ipcRenderer.invoke('personal:deleteEntry', entryId),

  // עמותות
  getNpoOverview: (year) => ipcRenderer.invoke('npo:getOverview', year),
  saveNpoSettings: (input) => ipcRenderer.invoke('npo:saveSettings', input),
  addNpoDonation: (input) => ipcRenderer.invoke('npo:addDonation', input),
  cancelNpoDonation: (id) => ipcRenderer.invoke('npo:cancelDonation', id),
  addNpoGrant: (input) => ipcRenderer.invoke('npo:addGrant', input),
  updateNpoGrant: (id, input) => ipcRenderer.invoke('npo:updateGrant', id, input),
  deleteNpoGrant: (id) => ipcRenderer.invoke('npo:deleteGrant', id),
  toggleNpoGrantDocument: (id, index) => ipcRenderer.invoke('npo:toggleGrantDocument', id, index),
  recordNpoTaxReport: (id, input) => ipcRenderer.invoke('npo:recordTaxReport', id, input),
  exportNpoDonorStatementPdf: (donorKey, year) => ipcRenderer.invoke('npo:exportDonorStatementPdf', donorKey, year),
  getNpoMemorials: (today, days) => ipcRenderer.invoke('npo:getMemorials', today, days),
  saveNpoMemorial: (id, input) => ipcRenderer.invoke('npo:saveMemorial', id, input),
  deleteNpoMemorial: (id) => ipcRenderer.invoke('npo:deleteMemorial', id),
  exportNpoMemorialsCsv: () => ipcRenderer.invoke('npo:exportMemorialsCsv'),
  previewNpoImport: (csvText, source) => ipcRenderer.invoke('npo:previewImport', csvText, source),
  importNpoDonations: (csvText, options) => ipcRenderer.invoke('npo:importDonations', csvText, options),
  getNpoStandingOrders: (today) => ipcRenderer.invoke('npo:getStandingOrders', today),
  saveNpoStandingOrder: (id, input) => ipcRenderer.invoke('npo:saveStandingOrder', id, input),
  recordNpoStandingPayment: (id, month, status, date) => ipcRenderer.invoke('npo:recordStandingPayment', id, month, status, date),
  deleteNpoStandingOrder: (id) => ipcRenderer.invoke('npo:deleteStandingOrder', id),
  exportNpoCsv: (kind, year) => ipcRenderer.invoke('npo:exportCsv', kind, year),
  exportNpoReceiptPdf: (id) => ipcRenderer.invoke('npo:exportReceiptPdf', id),

  // גמ"ח
  getGemachOverview: (asOf) => ipcRenderer.invoke('gemach:getOverview', asOf),
  getGemachLoan: (id) => ipcRenderer.invoke('gemach:getLoan', id),
  saveGemachSettings: (input) => ipcRenderer.invoke('gemach:saveSettings', input),
  addGemachLoan: (input) => ipcRenderer.invoke('gemach:addLoan', input),
  recordGemachPayment: (loanId, seq, input) => ipcRenderer.invoke('gemach:recordPayment', loanId, seq, input),
  cancelGemachLoan: (loanId) => ipcRenderer.invoke('gemach:cancelLoan', loanId),
  addGemachDeposit: (input) => ipcRenderer.invoke('gemach:addDeposit', input),
  deleteGemachDeposit: (id) => ipcRenderer.invoke('gemach:deleteDeposit', id),
  exportGemachCsv: (kind) => ipcRenderer.invoke('gemach:exportCsv', kind),

  // חסד וחלוקות
  getChesedOverview: () => ipcRenderer.invoke('chesed:getOverview'),
  addChesedBeneficiary: (input) => ipcRenderer.invoke('chesed:addBeneficiary', input),
  updateChesedBeneficiary: (id, input) => ipcRenderer.invoke('chesed:updateBeneficiary', id, input),
  deleteChesedBeneficiary: (id) => ipcRenderer.invoke('chesed:deleteBeneficiary', id),
  addChesedVolunteer: (input) => ipcRenderer.invoke('chesed:addVolunteer', input),
  updateChesedVolunteer: (id, input) => ipcRenderer.invoke('chesed:updateVolunteer', id, input),
  deleteChesedVolunteer: (id) => ipcRenderer.invoke('chesed:deleteVolunteer', id),
  addChesedRound: (input) => ipcRenderer.invoke('chesed:addRound', input),
  allocateChesedRound: (roundId) => ipcRenderer.invoke('chesed:allocateRound', roundId),
  assignChesedVolunteer: (roundId, beneficiaryId, volunteerId) => ipcRenderer.invoke('chesed:assignVolunteer', roundId, beneficiaryId, volunteerId),
  markChesedDelivered: (roundId, beneficiaryId, delivered, date) => ipcRenderer.invoke('chesed:markDelivered', roundId, beneficiaryId, delivered, date),
  closeChesedRound: (roundId) => ipcRenderer.invoke('chesed:closeRound', roundId),
  deleteChesedRound: (roundId) => ipcRenderer.invoke('chesed:deleteRound', roundId),
  exportChesedCsv: (kind, roundId) => ipcRenderer.invoke('chesed:exportCsv', kind, roundId),

  // ייעוץ משכנתאות
  getMortgageAdvisor: () => ipcRenderer.invoke('madv:getOverview'),
  calcMortgageTracks: (input) => ipcRenderer.invoke('madv:calcTracks', input),
  createMortgageClient: (input) => ipcRenderer.invoke('madv:createClient', input),
  updateMortgageClient: (id, input) => ipcRenderer.invoke('madv:updateClient', id, input),
  deleteMortgageClient: (id) => ipcRenderer.invoke('madv:deleteClient', id),
  toggleMortgageDoc: (id, key) => ipcRenderer.invoke('madv:toggleDoc', id, key),
  addMortgageOffer: (input) => ipcRenderer.invoke('madv:addOffer', input),
  deleteMortgageOffer: (id) => ipcRenderer.invoke('madv:deleteOffer', id),
  exportMortgageSchedule: (offerId) => ipcRenderer.invoke('madv:exportSchedule', offerId),
  getMortgageLab: () => ipcRenderer.invoke('mlab:getOverview'),
  calcLabMix: (input) => ipcRenderer.invoke('mlab:calcMix', input),
  calcLabBaskets: (input) => ipcRenderer.invoke('mlab:calcBaskets', input),
  calcLabAffordability: (input) => ipcRenderer.invoke('mlab:calcAffordability', input),
  calcLabRefinance: (input) => ipcRenderer.invoke('mlab:calcRefinance', input),
  calcLabApprovals: (input) => ipcRenderer.invoke('mlab:calcApprovals', input),
  calcLabPrepayment: (input) => ipcRenderer.invoke('mlab:calcPrepayment', input),
  calcLabOptimize: (input) => ipcRenderer.invoke('mlab:calcOptimize', input),
  saveLabForecast: (input) => ipcRenderer.invoke('mlab:saveForecast', input),
  resetLabForecast: () => ipcRenderer.invoke('mlab:resetForecast'),
  verifyLabRule: (ruleId, note) => ipcRenderer.invoke('mlab:verifyRule', ruleId, note),
  unverifyLabRule: (ruleId) => ipcRenderer.invoke('mlab:unverifyRule', ruleId),
  saveLabScenario: (input) => ipcRenderer.invoke('mlab:saveScenario', input),
  deleteLabScenario: (id) => ipcRenderer.invoke('mlab:deleteScenario', id),
  exportLabScenario: (id) => ipcRenderer.invoke('mlab:exportScenario', id),

  // הגדרות מתקדמות, משתמשים ויומן ביקורת
  getAdvancedSettings: () => ipcRenderer.invoke('settings:getAdvanced'),
  saveAdvancedSettings: (input) => ipcRenderer.invoke('settings:saveAdvanced', input),
  listUsers: () => ipcRenderer.invoke('users:list'),
  createUser: (input) => ipcRenderer.invoke('users:create', input),
  updateUser: (id, input) => ipcRenderer.invoke('users:update', id, input),
  resetUserPassword: (id, password) => ipcRenderer.invoke('users:resetPassword', id, password),
  listAudit: (filter) => ipcRenderer.invoke('audit:list', filter),
  exportAudit: (filter) => ipcRenderer.invoke('audit:export', filter),

  // ייבוא וייצוא
  listDataKinds: () => ipcRenderer.invoke('ports:listKinds'),
  exportData: (kind) => ipcRenderer.invoke('ports:export', kind),
  exportDataTemplate: (kind) => ipcRenderer.invoke('ports:exportTemplate', kind),
  importData: (kind, csvText) => ipcRenderer.invoke('ports:import', kind, csvText),
  importContactsVcard: (text) => ipcRenderer.invoke('ports:importVcard', text),
  exportContactsVcard: () => ipcRenderer.invoke('ports:exportVcard'),

  // Backup and Restore — רק טקסט מוצפן (SSBK1:) עובר לממשק; גיבוי גלוי לא קיים
  backupEncrypted: (passphrase) => ipcRenderer.invoke('data:backupEncrypted', passphrase),
  restoreEncrypted: (text, passphrase) => ipcRenderer.invoke('data:restoreEncrypted', text, passphrase),
  restoreData: (backupData) => ipcRenderer.invoke('data:restore', backupData) // גיבוי ישן (JSON) בלבד
});