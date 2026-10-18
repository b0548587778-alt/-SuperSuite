// מקבילה ל-main.js בגרסת אנדרואיד: ניווט בין המודולים, היסטוריה, לוח עברי, גיבוי ושחזור מוצפנים.
// רץ בחלון המעטפת (WebView ראשי); כל מודול הוא iframe ב-origin נפרד (host.js מנהל אותם).
// אין גיבוי אוטומטי: באנדרואיד אין DPAPI, והוחלט על גיבוי ידני מוצפן בלבד (כלל 5 — אין כתיבה לא מוצפנת).
'use strict';
const BK = require('../../modules/econ/core/backupCrypto');
const Catalog = require('../../shell/catalog');
const Hebcal = require('../../shell/hebcal');
const NavHistory = require('../../shell/history');
const { canShellNavigate, canModuleOpen } = require('../../shell/nav-guard');
const LoginGate = require('../../shell/login-gate');
const TrainerCheck = require('../../shell/trainer-backup-check');

const MODS = ['econ', 'shamai', 'trainer', 'tools'];
const LS_MODS = ['shamai', 'trainer', 'tools'];
const ENTRY = {
  econ: '/views/index.html?embedded=1',
  shamai: '/index.html',
  trainer: '/index.html',
  tools: '/index.html'
};
const LS_VALUE_MAX = 5 * 1024 * 1024;

// ctx: { ipcMain, econ, frames, emitShell, bridgeAsync, SHELL_ID, senderOf, ui, alert, confirm, exit, econExtras }
function start(ctx) {
  const { ipcMain, econ, frames, emitShell, bridgeAsync, SHELL_ID } = ctx;
  const ECON_EXTRAS = Array.isArray(ctx.econExtras) ? ctx.econExtras : [];
  const ECON_VIEWS = [...Catalog.ECON_VIEWS, ...ECON_EXTRAS.map(x => x.view)];
  const TRAINER_VIEWS = Catalog.TRAINER_VIEWS;
  const TRAINER_BY_LABEL = Object.fromEntries(Object.entries(Catalog.TRAINER_LABELS).map(([v, l]) => [l, v]));
  const moduleHasView = (id, view) => (id === 'econ' && ECON_VIEWS.includes(view)) || (id === 'trainer' && TRAINER_VIEWS.includes(view));

  const history = NavHistory.create();
  let replaying = false;
  let active = null;
  let overlay = false;

  const isShell = e => canShellNavigate(e.sender.id, SHELL_ID);

  function recordNav(loc) {
    if (!replaying) history.push(loc);
    emitShell('shell:history', history.state());
  }
  function navigateHistory(delta) {
    const loc = history.go(delta);
    if (!loc) return false;
    replaying = true;
    try {
      if (!loc.mod) goHome();
      else { switchTo(loc.mod); if (loc.view) openModuleView(loc.mod, loc.view); }
    } finally { replaying = false; }
    emitShell('shell:history', history.state());
    return true;
  }
  function show() { for (const id of MODS) frames.setVisible(id, !overlay && id === active); }
  // שמאי ואימונים — רק אחרי כניסה (shell/login-gate.js). באנדרואיד אין בדיקה תקופתית:
  // אין דרך לדעת על פעילות בתוך המודול, ובלי זה הניתוק האוטומטי היה מוציא באמצע עבודה
  const loginGate = LoginGate.createLoginGate({
    isLoggedIn: () => frames.exists('econ') && !!(econ.hasSession && econ.hasSession(ctx.senderOf('econ'))) });
  function showLoginForLocked() {
    switchTo('econ');
    frames.whenReady('econ').then(() => frames.send('econ', 'econ:auth-check'));
  }
  if (econ.onAuthChange) econ.onAuthChange(() => {
    if (loginGate.mustLeave(active)) { showLoginForLocked(); return; }
    const p = loginGate.takePending();
    if (p && (active === 'econ' || active === null)) { switchTo(p.id); if (p.view) openModuleView(p.id, p.view); }
  });
  function switchTo(id) {
    if (!MODS.includes(id)) return;
    if (loginGate.route(id) !== id) { showLoginForLocked(); return; }
    frames.ensure(id, ENTRY[id]);
    active = id;
    show();
    emitShell('shell:active', id);
    recordNav({ mod: id, view: null });
  }
  function goHome() {
    loginGate.clear();
    active = null;
    overlay = false;
    show();
    emitShell('shell:active', null);
    recordNav({ mod: null, view: null });
  }
  function openModuleView(id, view) {
    if (id === 'econ' && ECON_VIEWS.includes(view)) {
      frames.ensure('econ', ENTRY.econ);
      frames.whenReady('econ').then(() => frames.send('econ', 'econ:goto', view));
      return true;
    }
    if (id === 'trainer' && TRAINER_VIEWS.includes(view)) {
      if (loginGate.pending && loginGate.pending.id === 'trainer') { loginGate.setPendingView('trainer', view); return true; }
      frames.ensure('trainer', ENTRY.trainer);
      frames.whenReady('trainer').then(() => frames.send('trainer', 'trainer:goto', Catalog.TRAINER_LABELS[view]));
      return true;
    }
    return false;
  }

  /* ---------- לוח עברי ---------- */
  const calendarSettings = () => Hebcal.resolveSettings((ctx.ui.load().calendar) || {});
  function sanitizeCalendar(input) {
    const s = input && typeof input === 'object' ? input : {};
    const out = {};
    if (Hebcal.CITIES.some(c => c.id === s.city)) out.city = s.city;
    if (s.candles === null || (Number.isInteger(s.candles) && s.candles >= 0 && s.candles <= 60)) out.candles = s.candles;
    if (typeof s.shabbatMode === 'boolean') out.shabbatMode = s.shabbatMode;
    if (typeof s.diaspora === 'boolean') out.diaspora = s.diaspora;
    return out;
  }

  /* ---------- גיבוי ושחזור ---------- */
  const econSenderId = () => (frames.exists('econ') ? ctx.senderOf('econ') : -1);
  function shellGuard(e, permission) {
    if (!isShell(e)) throw new Error('הפעולה מותרת מתוך המעטפת בלבד');
    econ.assertAccess(econSenderId(), permission);
  }
  function econLoggedIn() {
    if (!frames.exists('econ')) return false;
    try { econ.assertAccess(ctx.senderOf('econ'), 'data.view'); return true; } catch { return false; }
  }
  async function collectBackup(scope = 'all') {
    const out = { suite: 'SuperSuite', version: 2, scope, createdAt: new Date().toISOString(), econ: null, localStorage: {} };
    if (scope === 'all' || scope === 'econ') {
      try { out.econ = await econ.getDb().backup(); } catch (e) { out.econError = String(e.message || e); }
    }
    for (const id of LS_MODS) {
      if (scope !== 'all' && scope !== id) continue;
      frames.ensure(id, ENTRY[id]);
      try { out.localStorage[id] = await frames.request(id, 'ls-dump'); } catch { out.localStorage[id] = {}; }
    }
    return out;
  }
  async function backupAll(passphrase, scope = 'all') {
    if (typeof passphrase !== 'string' || passphrase.length < BK.MIN_PASSPHRASE) throw new Error(`סיסמת הגיבוי חייבת להכיל לפחות ${BK.MIN_PASSPHRASE} תווים`);
    const out = await collectBackup(scope);
    // ההצפנה לפני כל כתיבה — לא נשמר טקסט גלוי
    const text = BK.encryptBackup(JSON.stringify(out), passphrase);
    const stamp = new Date().toLocaleDateString('sv-SE'); // תאריך מקומי YYYY-MM-DD, לא UTC
    const r = await bridgeAsync('saveText', `SuperSuite-${scope}-${stamp}.ssbk`, 'application/octet-stream', text);
    if (!r || !r.ok) return { ok: false };
    ctx.alert('הגיבוי נשמר ומוצפן\n' + (r.name || ''));
    return { ok: true };
  }
  async function restoreAll(passphrase) {
    const f = await bridgeAsync('openText');
    if (!f || typeof f.text !== 'string') return { ok: false };
    let data;
    try {
      if (!BK.isEncryptedBackup(f.text)) data = JSON.parse(f.text); // גיבוי ישן (JSON גלוי) — נקרא בלבד
      else if (!passphrase) throw new Error('הקובץ מוצפן — הזן את סיסמת הגיבוי כדי לשחזר');
      else data = JSON.parse(BK.decryptBackup(f.text, passphrase));
    } catch (e) {
      ctx.alert('שגיאה: ' + (e.message || 'הקובץ אינו גיבוי תקין'));
      return { ok: false };
    }
    // קובץ JSON ישן מכפתור הייצוא של מודול האימונים (לפני PLAN.md 3.4)
    data = TrainerCheck.legacyTrainerBackup(data) || data;
    if (!data || data.suite !== 'SuperSuite') { ctx.alert('שגיאה: הקובץ אינו גיבוי של SuperSuite'); return { ok: false }; }
    // נתוני האימונים נבדקים לפני האישור ולפני כל מחיקה — קובץ פגום לא נוגע בשום דבר
    let trainerItems = null;
    if (data.localStorage && data.localStorage.trainer) {
      const t = TrainerCheck.checkTrainerItems(data.localStorage.trainer);
      if (!t.ok) { ctx.alert('שגיאה: ' + t.error + '. לא שוחזר דבר, והנתונים הקיימים לא השתנו.'); return { ok: false }; }
      trainerItems = t.clean;
    }
    const scopeText = data.legacy ? '(גיבוי ישן של ניהול האימונים)' : data.scope && data.scope !== 'all' ? `(גיבוי של מודול: ${data.scope})` : '(גיבוי מלא)';
    if (!ctx.confirm('השחזור יחליף את הנתונים הקיימים ' + scopeText + '\nמומלץ לבצע גיבוי לפני כן. להמשיך?')) return { ok: false };
    try { if (data.econ) await econ.getDb().restore(data.econ); } catch (e) { ctx.alert('שגיאה בשחזור המערכת הכלכלית: ' + String(e.message || e)); }
    for (const id of LS_MODS) {
      const items = id === 'trainer' ? trainerItems : data.localStorage && data.localStorage[id];
      if (!items || typeof items !== 'object' || Array.isArray(items)) continue;
      const clean = {};
      for (const [k, val] of Object.entries(items)) {
        if (typeof k !== 'string' || k.length > 256) continue;
        if (typeof val !== 'string' || val.length > LS_VALUE_MAX) continue;
        clean[k] = val;
      }
      if (!Object.keys(clean).length) continue;
      frames.ensure(id, ENTRY[id]);
      await frames.request(id, 'ls-restore', clean);
    }
    frames.reloadAll();
    ctx.alert('השחזור הושלם');
    return { ok: true };
  }

  /* ---------- ערוצים ---------- */
  ipcMain.handle('shell:switch', (e, id) => { if (!isShell(e)) return false; switchTo(id); return true; });
  ipcMain.handle('shell:open-module', (e, id) => {
    if (!canModuleOpen(e.sender.id, frames.moduleSenderIds(), id, MODS)) return false;
    switchTo(id);
    return true;
  });
  ipcMain.handle('shell:open', (e, id, view) => {
    if (!isShell(e) || !MODS.includes(id)) return false;
    if (view != null && !moduleHasView(id, view)) return false;
    switchTo(id);
    if (view) openModuleView(id, view);
    return true;
  });
  ipcMain.handle('shell:catalog-extras', e => (isShell(e) ? ECON_EXTRAS.map(x => ({ ...x })) : []));
  ipcMain.handle('shell:get-calendar', e => {
    if (!isShell(e)) return null;
    const { cityObj, ...s } = calendarSettings();
    return s;
  });
  ipcMain.handle('shell:save-calendar', (e, input) => {
    if (!isShell(e)) return null;
    const ui = ctx.ui.load();
    ctx.ui.save({ ...ui, calendar: { ...(ui.calendar || {}), ...sanitizeCalendar(input) } });
    const { cityObj, ...s } = calendarSettings();
    return s;
  });
  ipcMain.handle('shell:overlay', (e, on) => { if (!isShell(e)) return false; overlay = !!on; show(); return true; });
  ipcMain.handle('shell:econ-view', (e, view) => {
    if (!frames.exists('econ') || e.sender.id !== ctx.senderOf('econ') || !ECON_VIEWS.includes(view)) return false;
    emitShell('shell:active-view', view, 'econ');
    if (active === 'econ') recordNav({ mod: 'econ', view });
    return true;
  });
  ipcMain.handle('shell:trainer-view', (e, label) => {
    if (!frames.exists('trainer') || e.sender.id !== ctx.senderOf('trainer')) return false;
    const view = typeof label === 'string' ? TRAINER_BY_LABEL[label] : undefined;
    if (!view) return false;
    emitShell('shell:active-view', view, 'trainer');
    if (active === 'trainer') recordNav({ mod: 'trainer', view });
    return true;
  });
  ipcMain.handle('shell:history-go', (e, delta) => (isShell(e) ? navigateHistory(delta === 1 ? 1 : -1) : false));
  ipcMain.handle('shell:home', e => { if (!isShell(e)) return false; goHome(); return true; });
  ipcMain.handle('shell:quit', e => { if (!isShell(e)) return false; ctx.exit(); return true; });
  ipcMain.handle('shell:is-logged-in', e => (isShell(e) ? econLoggedIn() : false));
  ipcMain.handle('shell:backup-all', (e, pass, scope) => { shellGuard(e, 'data.backup'); return backupAll(pass, scope || 'all'); });
  ipcMain.handle('shell:restore-all', (e, pass) => { shellGuard(e, 'data.restore'); return restoreAll(pass); });
  // אין גיבוי אוטומטי באנדרואיד: null = "אין יעד להציג" (המעטפת לא מציגה טקסט יעד)
  ipcMain.handle('shell:get-backup-target', e => { if (!isShell(e)) throw new Error('הפעולה מותרת מתוך המעטפת בלבד'); return null; });
  ipcMain.handle('shell:get-backup-status', e => { if (!isShell(e)) throw new Error('הפעולה מותרת מתוך המעטפת בלבד'); return null; });
  ipcMain.handle('shell:pick-backup-target', e => {
    shellGuard(e, 'data.backup');
    throw new Error('באנדרואיד אין גיבוי אוטומטי — השתמש בגיבוי הידני המוצפן (⬇)');
  });
  // קוד שחזור שייך לגיבוי האוטומטי — שאינו קיים כאן. גיבוי ידני נפתח בסיסמה שלו בכל מכשיר
  for (const ch of ['shell:get-recovery-code', 'shell:recovery-code-saved']) {
    ipcMain.handle(ch, e => {
      shellGuard(e, 'data.backup');
      throw new Error('באנדרואיד אין גיבוי אוטומטי, ולכן אין קוד שחזור — הגיבוי הידני (⬇) נפתח בסיסמה שלו בכל מכשיר');
    });
  }

  return { switchTo, goHome, navigateHistory, get active() { return active; } };
}

module.exports = { start, MODS, ENTRY };
