const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('shellAPI', {
  switchTo: id => ipcRenderer.invoke('shell:switch', id),
  backupAll: (passphrase, scope) => ipcRenderer.invoke('shell:backup-all', passphrase, scope),
  restoreAll: (passphrase) => ipcRenderer.invoke('shell:restore-all', passphrase),
  isLoggedIn: () => ipcRenderer.invoke('shell:is-logged-in'),
  getBackupTarget: () => ipcRenderer.invoke('shell:get-backup-target'),
  pickBackupTarget: () => ipcRenderer.invoke('shell:pick-backup-target'),
  goHome: () => ipcRenderer.invoke('shell:home'),
  quit: () => ipcRenderer.invoke('shell:quit'),
  onActive: cb => ipcRenderer.on('shell:active', (_e, id) => cb(id)),
  onCmd: cb => ipcRenderer.on('shell:cmd', (_e, cmd) => cb(cmd))
});
