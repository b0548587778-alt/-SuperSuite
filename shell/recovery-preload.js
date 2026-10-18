// חלון קוד השחזור (PLAN.md 3.1): נפתח רק כשהנתונים מוצפנים והמפתח אינו זמין במחשב הזה
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('recoveryAPI', {
  info: () => ipcRenderer.invoke('recovery:info'),
  submit: (code) => ipcRenderer.invoke('recovery:submit', code)
});
