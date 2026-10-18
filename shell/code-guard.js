// הגנה על הקוד בגרסת הפצה (PLAN.md 3.5): בלי כלי מפתחים ובלי חיבור דיבוג מבחוץ.
// בפיתוח (npm start, app.isPackaged=false) — הכול פתוח כמו קודם.
// אין כאן הגנה מוחלטת: המטרה להקשות, לא לחסום מתכנת נחוש (ראו PLAN.md).

// פרמטרים שפותחים את התוכנה לדיבוג מבחוץ (Chromium / Node)
const DEBUG_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe', 'remote-allow-origins', 'inspect', 'inspect-brk', 'inspect-port', 'js-flags'];

function debugSwitchIn(argv) {
  for (const a of argv || []) {
    const name = String(a).replace(/^--?/, '').split('=')[0].toLowerCase();
    if (String(a).startsWith('-') && DEBUG_SWITCHES.includes(name)) return name;
  }
  return null;
}

// webPreferences לכל חלון ותצוגה: devTools כבוי בגרסת הפצה
function guardPrefs(prefs, packaged) {
  return packaged ? { ...prefs, devTools: false } : prefs;
}

// רשת ביטחון: אם כלי המפתחים נפתחו בכל זאת — נסגרים מיד
function wireDevToolsGuard(wc, packaged) {
  if (!packaged || !wc || typeof wc.on !== 'function') return;
  wc.on('devtools-opened', () => { try { wc.closeDevTools(); } catch { /* החלון נסגר */ } });
}

// בדיקה בעלייה: גרסת הפצה עם פרמטר דיבוג — לא עולה. מחזיר את שם הפרמטר או null
function startupCheck({ argv, packaged, hasSwitch }) {
  if (!packaged) return null;
  const fromArgv = debugSwitchIn(argv);
  if (fromArgv) return fromArgv;
  if (typeof hasSwitch === 'function') for (const s of DEBUG_SWITCHES) { try { if (hasSwitch(s)) return s; } catch { /* אין מתג */ } }
  return null;
}

module.exports = { DEBUG_SWITCHES, debugSwitchIn, guardPrefs, wireDevToolsGuard, startupCheck };
