// סימולציה של addJavascriptInterface: window.SuperSuiteBridge עם קריאות סינכרוניות (כמו ב-WebView)
'use strict';
const { ipcRenderer } = require('electron');
const METHODS = ['randomBytes', 'scrypt', 'aesGcm', 'dbOpen', 'dbExec', 'dbRun', 'dbAll', 'writeUri', 'printHtml', 'exit',
  'createDocument', 'saveBytes', 'saveText', 'openText'];
const bridge = {};
for (const m of METHODS) bridge[m] = (...args) => ipcRenderer.sendSync('sim-bridge', m, ...args);
window.SuperSuiteBridge = bridge;
// במצב אוטומטי אין מי שילחץ "אישור": alert/confirm נרשמים ללוג במקום לחסום
if (process.argv.some(a => a === '--ss-sim-auto')) {
  window.alert = m => console.log('[alert] ' + m);
  window.confirm = m => { console.log('[confirm] ' + m); return true; };
}
