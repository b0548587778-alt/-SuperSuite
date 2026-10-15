const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('shellAPI', {
  switchTo: id => ipcRenderer.invoke('shell:switch', id),
  // פתיחת פריט מהסרגל האחיד (מודול + תצוגה פנימית אופציונלית)
  open: (id, view) => ipcRenderer.invoke('shell:open', id, view),
  setOverlay: on => ipcRenderer.invoke('shell:overlay', !!on),
  getCatalogExtras: () => ipcRenderer.invoke('shell:catalog-extras'),
  getCalendar: () => ipcRenderer.invoke('shell:get-calendar'),
  saveCalendar: (s) => ipcRenderer.invoke('shell:save-calendar', s),
  onActiveView: cb => ipcRenderer.on('shell:active-view', (_e, view) => cb(view)),
  backupAll: (passphrase, scope) => ipcRenderer.invoke('shell:backup-all', passphrase, scope),
  restoreAll: (passphrase) => ipcRenderer.invoke('shell:restore-all', passphrase),
  isLoggedIn: () => ipcRenderer.invoke('shell:is-logged-in'),
  getBackupTarget: () => ipcRenderer.invoke('shell:get-backup-target'),
  getBackupStatus: () => ipcRenderer.invoke('shell:get-backup-status'),
  pickBackupTarget: () => ipcRenderer.invoke('shell:pick-backup-target'),
  goHome: () => ipcRenderer.invoke('shell:home'),
  historyGo: (delta) => ipcRenderer.invoke('shell:history-go', delta),
  onHistory: cb => ipcRenderer.on('shell:history', (_e, st) => cb(st)),
  quit: () => ipcRenderer.invoke('shell:quit'),
  onActive: cb => ipcRenderer.on('shell:active', (_e, id) => cb(id)),
  onCmd: cb => ipcRenderer.on('shell:cmd', (_e, cmd) => cb(cmd)),
  getLicenseState: () => ipcRenderer.invoke('shell:license-state'),
  onLicense: cb => ipcRenderer.on('shell:license', (_e, st) => cb(st))
});
