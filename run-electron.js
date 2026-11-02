// הרצת האפליקציה בפיתוח (npm start) גם כש-node_modules/electron/path.txt חסר.
// בסביבה מסוננת סקריפט ההתקנה של electron נכשל בהורדה ולא כותב path.txt, ואז
// `electron .` נופל ב-"Electron failed to install correctly" למרות ש-electron.exe קיים.
// מריצים את הקובץ ישירות, בלי shell (נתיב הפרויקט מכיל רווח).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function resolveElectronExe(root, platform = process.platform) {
  const dir = path.join(root, 'node_modules', 'electron');
  const pathFile = path.join(dir, 'path.txt');
  if (fs.existsSync(pathFile)) {
    const rel = fs.readFileSync(pathFile, 'utf8').trim();
    const exe = path.join(dir, 'dist', rel);
    if (rel && fs.existsSync(exe)) return exe;
  }
  const name = platform === 'win32' ? 'electron.exe' : platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
  const exe = path.join(dir, 'dist', name);
  return fs.existsSync(exe) ? exe : null;
}

// מ-Electron 42 החבילה לא מורידה את עצמה ב-postinstall (גם npm install --ignore-scripts עובד) — הקובץ נפרס
// בהפעלה הראשונה דרך install.js של החבילה, מהמטמון המקומי (%LOCALAPPDATA%\electron\Cache) אם הארכיון שם
// (שדרוג ל-Electron 45, סקירת קוד 2.11.2026)
function ensureElectronExe(root, { spawnSync = require('child_process').spawnSync, platform = process.platform } = {}) {
  const found = resolveElectronExe(root, platform);
  if (found) return found;
  const installer = path.join(root, 'node_modules', 'electron', 'install.js');
  if (!fs.existsSync(installer)) return null;
  spawnSync(process.execPath, [installer], { cwd: root, stdio: 'inherit' });
  return resolveElectronExe(root, platform);
}

if (require.main === module) {
  const exe = ensureElectronExe(__dirname);
  if (!exe) {
    console.error('electron.exe לא נמצא ב-node_modules/electron/dist, והפריסה מהמטמון נכשלה. יש להריץ npm install ואז ' +
      'node node_modules/electron/install.js במחשב עם גישה לחבילות (או עם ארכיון Electron במטמון).');
    process.exit(1);
  }
  const child = spawn(exe, ['.', ...process.argv.slice(2)], { cwd: __dirname, stdio: 'inherit', windowsHide: false });
  child.on('exit', code => process.exit(code == null ? 1 : code));
}

module.exports = { resolveElectronExe, ensureElectronExe };
