// Preload script for Electron context bridging
const { contextBridge, ipcRenderer } = require('electron');

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
  exportNpoCsv: (kind, year) => ipcRenderer.invoke('npo:exportCsv', kind, year),
  exportNpoReceiptPdf: (id) => ipcRenderer.invoke('npo:exportReceiptPdf', id),

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

  // Backup and Restore — רק טקסט מוצפן (SSBK1:) עובר לממשק; גיבוי גלוי לא קיים
  backupEncrypted: (passphrase) => ipcRenderer.invoke('data:backupEncrypted', passphrase),
  restoreEncrypted: (text, passphrase) => ipcRenderer.invoke('data:restoreEncrypted', text, passphrase),
  restoreData: (backupData) => ipcRenderer.invoke('data:restore', backupData) // גיבוי ישן (JSON) בלבד
});