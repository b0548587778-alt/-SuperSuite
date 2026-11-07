// רשת ביטחון לקריסות (PLAN.md 2.1): שגיאה שלא נתפסה בתהליך הראשי, מסך (מודול) שקרס או נתקע.
// המשתמש רואה הודעה בעברית עם פעולה ברורה, והחלון לא נעלם. כל אירוע נרשם ביומן (shell/logger.js).
// ההודעות לא נערמות: כל עוד דיאלוג פתוח, אירוע נוסף נרשם ביומן בלבד.
'use strict';

const MODULE_NAMES = { shell: 'המסך הראשי', econ: 'המערכת הכלכלית', shamai: 'השמאות', tools: 'ארגז הכלים',
  trainer: 'האימונים', english: 'האנגלית', math: 'החשבון', school: 'ניהול המוסד' };
const pad = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// beforeExit — לפני app.exit בהפעלה מחדש (שם will-quit לא נורה): כתיבת המחסנים המוצפנים לדיסק
function createCrashGuard({ logger, dialog, getWin, app, version = '', fs = require('fs'), beforeExit = () => {} }) {
  let busy = false;
  // מסך שקרס בזמן שדיאלוג אחר פתוח — נטען מחדש כשהדיאלוג נסגר; בלי זה הוא נשאר ריק עד סוף ההפעלה
  // (סקירת קוד 2.11.2026). לפי שם המסך — קריסה כפולה של אותו מסך נטענת פעם אחת
  const pendingReloads = new Map();
  function flushPending() {
    const list = [...pendingReloads.entries()];
    pendingReloads.clear();
    for (const [name, reload] of list) { try { reload(); } catch (e) { logger.error('render:' + name, e); } }
  }

  const parent = () => { const w = getWin(); return w && !w.isDestroyed() ? w : undefined; };

  // דוח תקלה לשמירה ושליחה לתמיכה — היומן בלבד, בלי נתונים
  async function saveReport() {
    const stamp = localDay(new Date()); // תאריך מקומי, לא UTC (בין חצות ל-03:00 — התאריך של אתמול)
    const r = await dialog.showSaveDialog(parent(), { title: 'שמירת דוח תקלה', defaultPath: `SuperSuite-דוח-תקלה-${stamp}.txt`,
      filters: [{ name: 'קובץ טקסט', extensions: ['txt'] }] });
    if (!r || r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, '﻿' + logger.report({ version }));
    await dialog.showMessageBox(parent(), { type: 'info', message: 'דוח התקלה נשמר', detail: r.filePath + '\n\nאפשר לצרף אותו לפנייה לתמיכה. אין בו נתונים מהתוכנה.' });
    return true;
  }

  // דיאלוג אחד בכל פעם. buttons — [{ label, run }], הראשון ברירת המחדל
  async function ask({ type = 'error', message, detail, buttons }) {
    if (busy) return null;
    busy = true;
    try {
      const r = await dialog.showMessageBox(parent(), { type, message, detail, buttons: buttons.map(b => b.label), defaultId: 0, cancelId: buttons.length - 1, noLink: true });
      const chosen = buttons[r && Number.isInteger(r.response) ? r.response : buttons.length - 1];
      if (chosen && chosen.run) await chosen.run();
      return chosen ? chosen.label : null;
    } catch (e) {
      logger.error('crash-dialog', e);
      return null;
    } finally { busy = false; flushPending(); }
  }

  function onUncaught(err) {
    logger.error('main', err);
    return ask({
      message: 'אירעה תקלה בלתי צפויה',
      detail: 'התוכנה ממשיכה לפעול והנתונים שמורים. אם התקלה חוזרת — שמרו דוח תקלה ושלחו לתמיכה, או הפעילו את התוכנה מחדש.',
      buttons: [
        { label: 'המשך לעבוד' },
        { label: 'שמירת דוח תקלה', run: saveReport },
        { label: 'הפעלה מחדש', run: () => {
          // app.exit מדלג על will-quit: בלי זה כתיבות מה-300ms האחרונים בשמאי אבדו
          try { beforeExit(); } catch (e) { logger.error('crash-exit', e); }
          app.relaunch(); app.exit(0);
        } },
      ],
    });
  }

  // דחייה שלא טופלה: נרשמת ביומן בלבד — לרוב זו פעולת רקע (סנכרון, הודעות), והודעה הייתה מטרידה בלי סיבה
  function onRejection(reason) { logger.warn('main:unhandled-rejection', reason); }

  // קריסה של מסך: טעינה מחדש של אותו מסך בלבד, שאר התוכנה ממשיכה
  function onRenderGone(name, details, reload) {
    const reason = details && details.reason;
    if (reason === 'clean-exit') return null;
    logger.error('render:' + name, `render-process-gone: ${reason} (exitCode ${details && details.exitCode})`);
    if (busy) { pendingReloads.set(name, reload); return null; }
    const label = MODULE_NAMES[name] || name;
    return ask({
      message: `${label} נסגר בגלל תקלה`,
      detail: 'הנתונים שמורים. אפשר לטעון את המסך מחדש ולהמשיך מאותו מקום.',
      buttons: [
        { label: 'טעינה מחדש', run: reload },
        { label: 'שמירת דוח תקלה', run: async () => { await saveReport(); reload(); } },
      ],
    });
  }

  function onUnresponsive(name, reload) {
    logger.warn('render:' + name, 'unresponsive');
    const label = MODULE_NAMES[name] || name;
    return ask({
      type: 'warning',
      message: `${label} אינו מגיב`,
      detail: 'אפשר להמתין עוד רגע, או לטעון את המסך מחדש. פעולה שלא הסתיימה לא תישמר.',
      buttons: [{ label: 'המתנה' }, { label: 'טעינה מחדש', run: reload }],
    });
  }

  // שגיאת JavaScript בתוך מסך (console-message ברמת שגיאה) — ליומן בלבד
  function onConsoleError(name, message, source, line) {
    logger.warn('render:' + name, `${message} (${source || '?'}:${line || 0})`);
  }

  // חיבור לתהליך — נקרא פעם אחת
  function installProcessHandlers(proc = process) {
    proc.on('uncaughtException', (err) => { onUncaught(err); });
    proc.on('unhandledRejection', (reason) => { onRejection(reason); });
  }

  // חיבור ל-webContents של מסך. reload — פונקציה שטוענת את המסך מחדש
  function wireContents(name, wc, reload) {
    wc.on('render-process-gone', (_e, details) => { onRenderGone(name, details, reload); });
    wc.on('unresponsive', () => { onUnresponsive(name, reload); });
    // Electron 35+: הפרטים על האירוע (level: 'error'); גרסאות קודמות: ארגומנטים (level 3 = error)
    wc.on('console-message', (e, level, message, line, source) => {
      const ev = e && typeof e.level === 'string' ? e : null;
      if (ev ? ev.level === 'error' : level >= 3) onConsoleError(name, ev ? ev.message : message, ev ? ev.sourceId : source, ev ? ev.lineNumber : line);
    });
  }

  return { installProcessHandlers, wireContents, onUncaught, onRejection, onRenderGone, onUnresponsive, onConsoleError, saveReport, isBusy: () => busy };
}

module.exports = { createCrashGuard, MODULE_NAMES };
