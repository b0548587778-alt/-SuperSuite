// מקבילה ל-main.js בגרסת אנדרואיד: ניווט בין המודולים, היסטוריה, לוח עברי, רישוי, גיבוי ושחזור מוצפנים.
// רץ בחלון המעטפת (WebView ראשי); כל מודול הוא iframe ב-origin נפרד (host.js מנהל אותם).
// אין גיבוי אוטומטי: באנדרואיד אין DPAPI, והוחלט על גיבוי ידני מוצפן בלבד (כלל 5 — אין כתיבה לא מוצפנת).
// רישוי (החלטת הבעלים 23.10.2026): כמו בשולחן העבודה — שער המודולים (shell/licensing/gate.js) והחיבור לשרת
// הרישוי בלבד (relay-fetch.js). שאר האפליקציה בלי רשת.
'use strict';
const BK = require('../../modules/econ/core/backupCrypto');
const Catalog = require('../../shell/catalog');
const Hebcal = require('../../shell/hebcal');
const NavHistory = require('../../shell/history');
const { canShellNavigate, canModuleOpen } = require('../../shell/nav-guard');
const LoginGate = require('../../shell/login-gate');
const Legacy = require('../../shell/legacy-modules');
const BackupScope = require('../../shell/backup-scope'); // סימוני הרישוי רק מגיבוי מוצפן של התוכנה הזו, כמו main.js
const ModCounters = require('../../shell/module-counters');
const Chat = require('../../shell/licensing/chat');
const UsersBk = require('../../modules/econ/core/usersBackup'); // משתמשים ויומן הפעולות בגיבוי המלא
const LG = require('../../shell/licensing/gate');
const Display = require('../../shell/display'); // תצוגה ונגישות (data-ss-*), כמו main.js
const Tasks = require('../../shell/tasks'); // "מה תרצה לעשות?" — אימות המטען, כמו main.js
const { issuedAfter } = require('../../modules/econ/core/database');
const { createRelayFetch } = require('./relay-fetch');

// מודול האימונים (trainer) עבר למוצר החינוכי הנפרד — כמו ב-main.js
const MODS = ['econ', 'shamai', 'tools'];
const LS_MODS = ['shamai', 'tools'];
const MOD_NAMES = { shamai: 'השמאות', tools: 'ארגז הכלים', chat: 'תיבת ההודעות' };
// localStorage מלא (WebView): אותו זיהוי כמו ב-frame.js
const isQuotaError = e => !!e && (e.name === 'QuotaExceededError' || e.code === 22);
const ENTRY = {
  econ: '/views/index.html?embedded=1',
  shamai: '/index.html',
  tools: '/index.html'
};
const LS_VALUE_MAX = 5 * 1024 * 1024;

// ערוצים שכל מודול (iframe) רשאי להפעיל — כמו ה-preload שלו בשולחן העבודה. לשמאות ולארגז הכלים אין preload,
// ולכן אין להם אף ערוץ (למשל: מודול לא ינסה כניסה בשם המנהל וינעל אותו). ערוצי המעטפת — רק מהמעטפת
const SHELL_ONLY = /^(shell|sync|display):/;
const MODULE_CHANNELS = {
  econ: ch => !SHELL_ONLY.test(ch) || ch === 'shell:econ-view' || ch === 'shell:open-module',
};
const moduleMayInvoke = (id, channel) => !!(MODULE_CHANNELS[id] && MODULE_CHANNELS[id](String(channel)));

// ערוצים בממשק המעטפת (shell/preload.js) שאין להם מקבילה באנדרואיד — הודעה ברורה בעברית
const NOT_ON_ANDROID = {
  'shell:plain-backup-encrypt': 'הצפנת גיבויים ישנים', 'shell:plain-backup-delete': 'מחיקת גיבויים ישנים',
  'shell:save-crash-report': 'דוח תקלה', 'shell:open-user-guide': 'מדריך המשתמש', 'shell:save-user-guide-pdf': 'מדריך המשתמש',
  ...Object.fromEntries(['status', 'set-enabled', 'rename', 'set-port', 'create-invite', 'cancel-invite', 'join', 'approve',
    'reject', 'connect', 'ping', 'revoke', 'reset-identity'].map(op => ['sync:' + op, 'סנכרון בין מכשירים'])),
};

// הגדרות הלוח העברי מתוך ui-settings (localStorage של המעטפת)
const calendarFrom = ui => Hebcal.resolveSettings((ui.load().calendar) || {});
// שבת ויום טוב (כשמצב שבת פעיל): אין סנכרון עם שרת הרישוי — כמו syncPaused ב-main.js
function restTime(ui, now = Date.now()) {
  const cal = calendarFrom(ui);
  return !!(cal.shabbatMode && Hebcal.shabbatStatus(now, cal).active);
}
// אפשרויות ל-initEcon באנדרואיד: fetch לשרת הרישוי בלבד, שבת, גרסה, ורשימת המודולים לעוזר לפי הרישיון
function econOptions({ ui, bridgeAsync, version, licenseState }) {
  return {
    fetchImpl: createRelayFetch(bridgeAsync),
    isRestTime: () => restTime(ui),
    appVersion: version || undefined,
    moduleLicensed: mod => LG.moduleAllowed(licenseState ? licenseState() : { mode: 'unlicensed' }, mod),
  };
}

// קריאה בלבד לפי הרישיון בשמאות — חלק הרישוי של secureWriteBlock ב-main.js (האכיפה ב-frame.js).
// null = מותר, אחרת ההודעה שנזרקת בעמוד בכל כתיבה ל-localStorage
const WRITE_GUARDED = ['shamai'];
function licenseWriteBlock(lic, mod) {
  if (!lic || lic.mode === 'unlicensed') return null;
  if (!LG.moduleAllowed(lic, mod)) return 'השינוי לא נשמר: המודול אינו כלול ברישיון';
  if (lic.status !== 'active') return 'השינוי לא נשמר: ' + LG.statusMessage(lic);
  return null;
}

// ctx: { ipcMain, econ, frames, emitShell, bridgeAsync, SHELL_ID, senderOf, ui, alert, confirm, exit, econExtras, version, about, setInterval }
function start(ctx) {
  const { ipcMain, econ, frames, emitShell, bridgeAsync, SHELL_ID } = ctx;
  const ECON_EXTRAS = Array.isArray(ctx.econExtras) ? ctx.econExtras : [];
  const ECON_VIEWS = [...Catalog.ECON_VIEWS, ...ECON_EXTRAS.map(x => x.view)];
  const moduleHasView = (id, view) => id === 'econ' && ECON_VIEWS.includes(view);

  const history = NavHistory.create();
  let replaying = false;
  let active = null;
  let overlay = false;
  let econView = null;

  const isShell = e => canShellNavigate(e.sender.id, SHELL_ID);

  /* ---------- רישוי (כמו main.js) ---------- */
  // מודול שאינו ברישיון או מערכת נעולה — לא נפתחים. במערכת הכלכלית "רישוי ומערכות" ו"הודעות" נשארים פתוחים
  const licenseFailed = () => ({ mode: 'licensed', status: 'locked', features: [], limits: {}, reasons: [{ kind: 'locked', reason: 'לא ניתן לחשב את מצב הרישוי — יש להפעיל מחדש את התוכנה או לפנות לספק הרישיון' }] });
  function licenseNow() {
    try { return econ.licenseState ? econ.licenseState() : { mode: 'unlicensed' }; } catch { return licenseFailed(); }
  }
  const sendLicenseToShell = st => emitShell('shell:license', LG.shellState(st));
  // מי רשאי לשנות נתונים בשמאות — כמו secureWriteBlock ב-main.js (ממצא 24): כניסה פעילה עם data.edit
  // (צופה ורואה חשבון — קריאה בלבד), ואחר כך הרישיון. בדיקה שקטה: לא מאריכה את הפגישה (הפעילות — onActivity למטה)
  function sessionWriteBlock() {
    const sid = frames.exists('econ') ? ctx.senderOf('econ') : -1;
    if (!(econ.hasSession && econ.hasSession(sid))) return 'השינוי לא נשמר: הכניסה למערכת פגה — יש להיכנס שוב';
    if (!(econ.sessionCan && econ.sessionCan(sid, 'data.edit'))) return 'השינוי לא נשמר: לתפקיד שלך יש הרשאת צפייה בלבד';
    return null;
  }
  // מצב הכתיבה בשמאות (host.js ← frame.js) — נשלח רק כשהשתנה. גם שינוי בתחומים בלי שינוי סטטוס
  // (שאינו מפעיל את onLicenseChange) נקלט — בכל פתיחת מודול, בכל כניסה / יציאה ובבדיקה של כל דקה
  const writeBlockSent = {};
  function syncWriteBlocks(st) {
    if (typeof frames.setWriteBlock !== 'function') return;
    const session = sessionWriteBlock();
    for (const id of WRITE_GUARDED) {
      const m = session || licenseWriteBlock(st, id);
      if (writeBlockSent[id] === m) continue;
      writeBlockSent[id] = m;
      frames.setWriteBlock(id, m);
    }
  }
  // שינוי סטטוס: עדכון המעטפת ומצב הכתיבה, ויציאה ממודול שנחסם
  function enforceLicense(st) {
    sendLicenseToShell(st);
    syncWriteBlocks(st);
    if (!active) return;
    if (active === 'econ') { if (!LG.viewAllowed(st, 'econ', econView)) openEconView('licensing'); }
    else if (!LG.moduleAllowed(st, active)) goHome();
  }
  if (econ.onLicenseChange) econ.onLicenseChange(enforceLicense);
  syncWriteBlocks(licenseNow());

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
  // שמאי — רק אחרי כניסה (shell/login-gate.js). עבודה בהם (לחיצה, מקש, מגע, גלילה — frame.js) מאריכה
  // את הפגישה, כמו touchActivity ב-main.js; לכן הבדיקה של כל דקה (למטה) מוציאה למסך הכניסה רק אחרי זמן הניתוק בלי שום פעולה
  const loginGate = LoginGate.createLoginGate({
    isLoggedIn: () => frames.exists('econ') && !!(econ.hasSession && econ.hasSession(ctx.senderOf('econ'))) });
  function showLoginForLocked() {
    switchTo('econ');
    frames.whenReady('econ').then(() => frames.send('econ', 'econ:auth-check'));
  }
  if (typeof frames.onActivity === 'function') frames.onActivity(id => {
    if (loginGate.isLocked(id) && frames.exists('econ') && econ.touchSession) econ.touchSession(ctx.senderOf('econ'));
  });
  // הפגישה נגמרה (יציאה, "👤 משתמש", ניתוק אוטומטי) — גם כשהמסך הכלכלי הוא הפעיל: הוא מתרוקן ומציג את מסך
  // הכניסה, כמו reloadLockedViewsOnSessionChange ב-main.js (סקירת קוד 2.11.2026)
  let econSessionWas = null;
  function econAuthCheckOnEnd() {
    if (!frames.exists('econ')) return;
    const now = !!(econ.hasSession && econ.hasSession(ctx.senderOf('econ')));
    const ended = econSessionWas === true && !now;
    econSessionWas = now;
    if (ended) frames.whenReady('econ').then(() => frames.send('econ', 'econ:auth-check'));
  }
  if (econ.onAuthChange) econ.onAuthChange(() => {
    econAuthCheckOnEnd();
    // כניסה / יציאה / החלפת משתמש — מצב הכתיבה מתעדכן מיד (כניסה עם הרשאת עריכה משחררת את החסימה)
    syncWriteBlocks(licenseNow());
    if (loginGate.mustLeave(active)) { showLoginForLocked(); return; }
    const p = loginGate.takePending();
    if (p && (active === 'econ' || active === null)) { switchTo(p.id); if (p.view) openModuleView(p.id, p.view); }
  });
  function switchTo(id) {
    if (!MODS.includes(id)) return;
    const lic = licenseNow();
    syncWriteBlocks(lic);
    if (id !== 'econ' && !LG.moduleAllowed(lic, id)) {
      sendLicenseToShell(lic);
      emitShell('shell:active', active);
      return;
    }
    // אחרי הרישוי: מודול שלא ברישיון לא מבקש כניסה
    if (loginGate.route(id) !== id) { showLoginForLocked(); return; }
    frames.ensure(id, ENTRY[id]);
    active = id;
    show();
    emitShell('shell:active', id);
    recordNav({ mod: id, view: null });
    if (id === 'econ' && !LG.moduleAllowed(lic, 'econ')) openEconView('licensing');
  }
  function goHome() {
    loginGate.clear();
    active = null;
    overlay = false;
    show();
    emitShell('shell:active', null);
    recordNav({ mod: null, view: null });
  }
  // תצוגה במודול הכלכלי שאינה ברישיון ← מסך הרישוי
  // task — משימה מתיבת "מה תרצה לעשות?" שכבר עברה validateTask (כמו main.js): { view, task, prefill }
  function openEconView(view, task = null) {
    if (!ECON_VIEWS.includes(view)) return false;
    if (!LG.viewAllowed(licenseNow(), 'econ', view)) { view = 'licensing'; task = null; }
    const msg = task ? { view, task: task.task.id, prefill: { ...task.prefill } } : view;
    frames.ensure('econ', ENTRY.econ);
    frames.whenReady('econ').then(() => frames.send('econ', 'econ:goto', msg));
    return true;
  }
  function openModuleView(id, view) {
    if (id === 'econ') return openEconView(view);
    return false;
  }

  /* ---------- לוח עברי ---------- */
  const calendarSettings = () => calendarFrom(ctx.ui);
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
  // כשל בקריאת הכספים = כשל של הגיבוי כולו (כמו main.js): לא נשמר קובץ בלי הכספים שנראה כגיבוי תקין
  async function collectBackup(scope = 'all') {
    // product — המוצר שיצר את הגיבוי (shell/backup-scope.js), כמו main.js
    const out = { suite: 'SuperSuite', product: BackupScope.PRODUCT, version: 2, scope, createdAt: new Date().toISOString(), econ: null, localStorage: {} };
    // סימוני הרישוי בכל גיבוי — שחזור להתקנה נקייה לא מתחיל ניסיון חדש (ipc.js, ממצא 29)
    if (econ.licenseMarks) out.licenseMarks = econ.licenseMarks();
    if (scope === 'all' || scope === 'econ') {
      try {
        out.econ = await econ.getDb().backup();
        // משתמשים, תפקידים, קישורי Google ויומן הפעולות — בגיבוי המלא, כמו main.js (סקירת קוד 2.11.2026)
        if (scope === 'all' && typeof econ.usersBackup === 'function') out.users = await econ.usersBackup();
      }
      catch (e) {
        const err = new Error('לא ניתן היה לקרוא את הנתונים הכספיים, ולכן הגיבוי לא נשמר. נסו שוב בעוד רגע.');
        err.code = 'econ-read-failed';
        throw err;
      }
    }
    for (const id of LS_MODS) {
      if (scope !== 'all' && scope !== id) continue;
      frames.ensure(id, ENTRY[id]);
      // כשל במודול = כשל של הגיבוי כולו (כמו בכספים) — לא קובץ שנראה שלם בלי נתוני המודול
      try { out.localStorage[id] = await frames.request(id, 'ls-dump'); }
      catch {
        const err = new Error(`לא ניתן היה לקרוא את נתוני ${MOD_NAMES[id] || id}, ולכן הגיבוי לא נשמר. נסו שוב בעוד רגע.`);
        err.code = 'module-read-failed';
        throw err;
      }
    }
    // תיבת ההודעות של המערכת — בגיבוי המלא, כמו main.js (הודעות, תוויות, הערות פנימיות, הגדרות העסק; תוכן הקבצים
    // עד Chat.BACKUP_ATTACHMENT_CHARS). כשל בקריאה = כשל של הגיבוי כולו. תיבת מנהל-העל — לא בגיבוי
    if (scope === 'all' && typeof econ.chatBackup === 'function') {
      try { out.chat = econ.chatBackup({ attachmentChars: Chat.BACKUP_ATTACHMENT_CHARS }); }
      catch {
        const err = new Error(`לא ניתן היה לקרוא את נתוני ${MOD_NAMES.chat}, ולכן הגיבוי לא נשמר. נסו שוב בעוד רגע.`);
        err.code = 'module-read-failed';
        throw err;
      }
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
  // ערכי מודול מקובץ גיבוי (קלט חיצוני): רק מחרוזות בגודל סביר. null — אין מה לשחזר
  function restoreItems(data, id) {
    const items = data.localStorage && data.localStorage[id];
    if (!items || typeof items !== 'object' || Array.isArray(items)) return null;
    const clean = {};
    for (const [k, val] of Object.entries(items)) {
      if (typeof k !== 'string' || k.length > 256) continue;
      if (typeof val !== 'string' || val.length > LS_VALUE_MAX) continue;
      clean[k] = val;
    }
    return Object.keys(clean).length ? clean : null;
  }
  // previous — הנתונים של המודולים לפני השחזור. מודול שנתוניו גדולים מהמקום ב-localStorage של המכשיר (quota)
  // לא מבטל את כל השחזור (גיבוי ממחשב עובר לטלפון — android/README.md): המודול חוזר לנתונים הקודמים שלו,
  // ושאר הנתונים משוחזרים. מחזיר את רשימת המודולים שדולגו. כל כשל אחר — שגיאה (והחזרה של הכול למצב הקודם).
  // chat — { data, except, previous } לתיבת ההודעות (chat.js → restoreMailbox); אותו כלל: אין מקום ← התיבה חוזרת
  // למצב שלפני (previous, בלי מה שהגיע מהגיבוי) ונרשמת כמדולגת
  async function applyRestore(econData, modItems, previous, chat = null) {
    if (econData) await econ.getDb().restore(econData);
    const skipped = [];
    for (const [id, clean] of modItems) {
      frames.ensure(id, ENTRY[id]);
      const r = await frames.request(id, 'ls-restore', clean);
      if (r === true) continue;
      if (previous && r && r.quota) {
        const back = await frames.request(id, 'ls-restore', previous[id] || {});
        if (back !== true) throw new Error(`לא היה מקום לנתוני ${MOD_NAMES[id] || id}, וגם הנתונים הקודמים שלו לא נשמרו מחדש`);
        skipped.push(id);
        continue;
      }
      throw new Error('המודול לא שמר את הנתונים' + (r && r.error ? ' (' + r.error + ')' : ''));
    }
    if (chat && chat.data) {
      try { econ.chatRestore(chat.data, chat.except ? { except: chat.except } : undefined); }
      catch (e) {
        if (!(chat.previous && isQuotaError(e))) throw new Error('לא ניתן היה לשמור את תיבת ההודעות' + (e && e.code ? ` (${e.code})` : '') + '.');
        econ.chatRestore(chat.previous, { except: chat.data }); // גם זה נכשל ← נזרק, והכול חוזר למצב שלפני
        skipped.push('chat');
      }
    }
    return skipped;
  }
  async function restoreAll(passphrase) {
    const f = await bridgeAsync('openText');
    if (!f || typeof f.text !== 'string') return { ok: false };
    let data;
    const encrypted = BK.isEncryptedBackup(f.text);
    try {
      if (!encrypted) data = JSON.parse(f.text); // גיבוי ישן (JSON גלוי) — נקרא בלבד
      else if (!passphrase) throw new Error('הקובץ מוצפן — הזן את סיסמת הגיבוי כדי לשחזר');
      else data = JSON.parse(BK.decryptBackup(f.text, passphrase));
    } catch (e) {
      ctx.alert('שגיאה: ' + (e.message || 'הקובץ אינו גיבוי תקין'));
      return { ok: false };
    }
    if (!data || data.suite !== 'SuperSuite') { ctx.alert('שגיאה: הקובץ אינו גיבוי של SuperSuite'); return { ok: false }; }
    // נתוני מודול האימונים (עבר למוצר נפרד) לא משוחזרים — שאר הגיבוי כן (shell/legacy-modules.js)
    const legacyData = Legacy.hasLegacyModuleData(data);
    // תיבת ההודעות (גיבוי מלא מגרסה שכוללת אותה) — נבדקת לפני האישור ולפני כל מחיקה. גיבוי ישן בלי chat לא נוגע בתיבה
    let chatData = null;
    if (data.chat != null) {
      try { chatData = Chat.mailboxFromBackup(data.chat); }
      catch (e) { ctx.alert('שגיאה: ' + e.message + '. לא שוחזר דבר, והנתונים הקיימים לא השתנו.'); return { ok: false }; }
    }
    // המשתמשים ויומן הפעולות — נבדקים לפני האישור; גיבוי ישן בלי users לא נוגע בהם (כמו main.js)
    let usersData = null;
    if (data.users != null && econ.usersFromBackup) {
      try { usersData = econ.usersFromBackup(data.users); }
      catch (e) { ctx.alert('שגיאה: ' + e.message + '. לא שוחזר דבר, והנתונים הקיימים לא השתנו.'); return { ok: false }; }
    }
    const scopeText = data.scope && data.scope !== 'all' ? `(גיבוי של מודול: ${data.scope})` : '(גיבוי מלא)';
    // מה שהשחזור יחליף נשמר קודם בזיכרון: כשל באמצע מחזיר הכול למצב שלפני (כמו main.js).
    // נקרא לפני האישור — גם לאזהרה על מסמכים שהופקו אחרי הגיבוי (בדיקת קוד 22.10.2026, ממצא 5)
    const mods = LS_MODS.filter(id => restoreItems(data, id));
    // אין מה לשחזר (למשל גיבוי של מודול האימונים בלבד) — לא "השחזור הושלם" כשלא שוחזר דבר
    if (!data.econ && !mods.length && !chatData) { ctx.alert('שגיאה: ' + (legacyData ? Legacy.LEGACY_ONLY : '') + 'אין בקובץ נתונים לשחזור — הנתונים הקיימים לא השתנו'); return { ok: false }; }
    let before;
    try {
      before = { econ: data.econ ? await econ.getDb().backup() : null, localStorage: {}, chat: chatData ? econ.chatBackup() : null };
      for (const id of mods) { frames.ensure(id, ENTRY[id]); before.localStorage[id] = await frames.request(id, 'ls-dump'); }
    } catch (e) { ctx.alert('שגיאה: לא ניתן לשמור את המצב הנוכחי לפני השחזור, ולכן לא שוחזר דבר.'); return { ok: false }; }
    const missingItems = data.econ && before.econ ? issuedAfter(data.econ, before.econ) : [];
    for (const id of mods) missingItems.push(...ModCounters.moduleIssuedAfter(id, restoreItems(data, id), before.localStorage[id]));
    const missing = ModCounters.issuedAfterText(missingItems);
    const chatNote = chatData ? '\nתיבת ההודעות תשוחזר מהגיבוי; הודעות שהתקבלו או נשלחו אחרי הגיבוי יישארו בה.' : '';
    const usersNote = usersData ? '\n' + UsersBk.restoreNote(usersData) : '';
    if (!ctx.confirm('השחזור יחליף את הנתונים הקיימים ' + scopeText + (missing ? '\n⚠ ' + missing : '') + chatNote + usersNote + (legacyData ? '\n' + Legacy.LEGACY_NOTE : '') + '\nמומלץ לבצע גיבוי לפני כן. להמשיך?')) return { ok: false };
    let skipped;
    try {
      skipped = await applyRestore(data.econ, mods.map(id => [id, ModCounters.keepModuleCounters(id, restoreItems(data, id), before.localStorage[id])]), before.localStorage,
        chatData && { data: chatData, previous: before.chat });
    } catch (e) {
      let back = 'הנתונים הוחזרו למצב שלפני השחזור.';
      // התיבה חוזרת למצב שלפני, בלי מה שהגיע מהגיבוי — אבל עם הודעה שהתקבלה בינתיים (chat.js → restoreMailbox)
      try { await applyRestore(before.econ, mods.map(id => [id, before.localStorage[id] || {}]), null, before.chat && { data: before.chat, except: chatData }); }
      catch { back = 'גם ההחזרה למצב הקודם נכשלה — שחזרו מגיבוי אחר.'; }
      frames.reloadAll();
      ctx.alert('השחזור נכשל: ' + String(e.message || e) + ' ' + back);
      return { ok: false };
    }
    // סימוני הרישוי מהגיבוי — רק מחמירים (ipc.js, ממצא 29), ורק מקובץ מוצפן של התוכנה הזו (shell/backup-scope.js)
    const marks = BackupScope.licenseMarksToMerge(data, { encrypted });
    try { if (marks && econ.mergeLicenseMarks) econ.mergeLicenseMarks(marks); } catch { /* לא מבטל את השחזור */ }
    // משתמשים ויומן הפעולות — מיזוג (משתמש קיים לא משתנה); כשל לא מבטל את השחזור, ומדווח
    let usersMsg = '';
    if (usersData) {
      try { usersMsg = '\n' + UsersBk.resultNote(await econ.usersRestore(usersData)); }
      catch { usersMsg = '\nהמשתמשים ויומן הפעולות מהגיבוי לא שוחזרו — המשתמשים הקיימים נשארו כמו שהיו.'; }
    }
    frames.reloadAll();
    if (skipped.length) {
      const names = skipped.map(id => MOD_NAMES[id] || id).join(', ');
      ctx.alert(`השחזור הושלם, חוץ מנתוני ${names}: אין להם מספיק מקום באחסון של המכשיר, ולכן הנתונים הקודמים שלהם נשארו כמו שהיו.\n` +
        'אפשר לפנות מקום (למשל למחוק תמונות ישנות במודול) ולשחזר שוב.' + usersMsg);
      return { ok: true, skipped };
    }
    ctx.alert('השחזור הושלם' + usersMsg);
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
  // "מה תרצה לעשות?" — אותם כללים כמו main.js: רישיון ותפקיד (בדיקה שקטה), ומטען מאומת. לא נשמר כלום
  const taskAccess = () => {
    const sid = econSenderId();
    const lic = licenseNow();
    const logged = frames.exists('econ') && !!(econ.hasSession && econ.hasSession(sid));
    const can = perm => !!(econ.sessionCan && econ.sessionCan(sid, perm));
    return Tasks.TASKS.filter(t => {
      if (t.admin) return logged && can('users.manage');
      if (!ECON_VIEWS.includes(t.view) || !LG.viewAllowed(lic, 'econ', t.view)) return false;
      if (LG.checkChannel(lic, `${t.domain}:startTask`, t.perm)) return false;
      return !logged || can(t.perm);
    }).map(t => t.id);
  };
  ipcMain.handle('shell:task-access', e => (isShell(e) ? taskAccess() : []));
  ipcMain.handle('shell:start-task', (e, id, prefill) => {
    if (!isShell(e)) return { ok: false, reason: 'sender' };
    const t = Tasks.validateTask(id, prefill);
    if (!t || !t.task.view) return { ok: false, reason: 'invalid' };
    if (!taskAccess().includes(t.task.id)) return { ok: false, reason: 'not-allowed' };
    switchTo('econ');
    openEconView(t.task.view, t);
    return { ok: true };
  });
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
  // תצוגה ונגישות (סבב 4): כמו main.js — נשמר ב-ui-settings → display, ומגיע לכל מסך כמאפייני data-ss-*
  // (המעטפת — applyShellDisplay; כל מודול — frames.setDisplay ← frame.js), כולל data-ss-simple של מצב פשוט
  const displaySettings = () => Display.stored(ctx.ui.load() || {});
  const broadcastDisplay = () => {
    const attrs = Display.attrsFor(displaySettings(), typeof ctx.systemDark === 'function' && !!ctx.systemDark());
    if (typeof ctx.applyShellDisplay === 'function') ctx.applyShellDisplay(attrs);
    if (typeof frames.setDisplay === 'function') frames.setDisplay(attrs);
    return attrs;
  };
  broadcastDisplay();
  ipcMain.handle('shell:get-display', e => (isShell(e) ? displaySettings() : null));
  ipcMain.handle('shell:save-display', (e, input) => {
    if (!isShell(e)) return null;
    const ui = ctx.ui.load() || {};
    ctx.ui.save(Display.withSaved(ui, input));
    broadcastDisplay();
    return displaySettings();
  });
  ipcMain.handle('shell:econ-view', (e, view) => {
    if (!frames.exists('econ') || e.sender.id !== ctx.senderOf('econ') || !ECON_VIEWS.includes(view)) return false;
    econView = view;
    if (!LG.viewAllowed(licenseNow(), 'econ', view)) { openEconView('licensing'); return false; }
    emitShell('shell:active-view', view, 'econ');
    if (active === 'econ') recordNav({ mod: 'econ', view });
    return true;
  });
  ipcMain.handle('shell:history-go', (e, delta) => (isShell(e) ? navigateHistory(delta === 1 ? 1 : -1) : false));
  ipcMain.handle('shell:home', e => { if (!isShell(e)) return false; goHome(); return true; });
  ipcMain.handle('shell:quit', e => { if (!isShell(e)) return false; ctx.exit(); return true; });
  ipcMain.handle('shell:is-logged-in', e => (isShell(e) ? econLoggedIn() : false));
  // מנהל? — המעטפת מציגה גיבוי ושחזור רק למנהל (החלטת הבעלים 23.10.2026), כמו main.js
  ipcMain.handle('shell:is-admin', e => (isShell(e) ? !!(econ.sessionCan && econ.sessionCan(econSenderId(), 'users.manage')) : false));
  ipcMain.handle('shell:backup-all', (e, pass, scope) => { shellGuard(e, 'data.backup'); return backupAll(pass, scope || 'all'); });
  ipcMain.handle('shell:restore-all', (e, pass) => { shellGuard(e, 'data.restore'); return restoreAll(pass); });
  // אין גיבוי אוטומטי באנדרואיד: null = "אין יעד להציג" (המעטפת לא מציגה טקסט יעד)
  ipcMain.handle('shell:get-backup-target', e => { if (!isShell(e)) throw new Error('הפעולה מותרת מתוך המעטפת בלבד'); return null; });
  ipcMain.handle('shell:get-backup-status', e => { if (!isShell(e)) throw new Error('הפעולה מותרת מתוך המעטפת בלבד'); return null; });
  // יעד הגיבוי וקוד השחזור — מנהל בלבד, כמו בשולחן העבודה (החלטת הבעלים 23.10.2026)
  ipcMain.handle('shell:pick-backup-target', e => {
    shellGuard(e, 'users.manage');
    throw new Error('באנדרואיד אין גיבוי אוטומטי — השתמש בגיבוי הידני המוצפן (⬇)');
  });
  // קוד שחזור שייך לגיבוי האוטומטי — שאינו קיים כאן. גיבוי ידני נפתח בסיסמה שלו בכל מכשיר
  for (const ch of ['shell:get-recovery-code', 'shell:recovery-code-saved']) {
    ipcMain.handle(ch, e => {
      shellGuard(e, 'users.manage');
      throw new Error('באנדרואיד אין גיבוי אוטומטי, ולכן אין קוד שחזור — הגיבוי הידני (⬇) נפתח בסיסמה שלו בכל מכשיר');
    });
  }
  // אין תיקיית גיבוי באנדרואיד — אין גיבויים ישנים גלויים להציג (null = בלי אזהרה במסך הבית)
  ipcMain.handle('shell:plain-backups', e => { if (!isShell(e)) throw new Error('הפעולה מותרת מתוך המעטפת בלבד'); return null; });

  // מצב הרישוי למעטפת (סרגל, נעילת מודולים) — כמו main.js
  ipcMain.handle('shell:license-state', e => (isShell(e) ? LG.shellState(licenseNow()) : null));
  // מסך הבית: מדדים ושאלה לעוזר — בשם המודול הכלכלי, דרך אותו שומר (כניסה, הרשאה, רישיון) כמו main.js
  const econAlive = () => frames.exists('econ') && !!(econ.hasSession && econ.hasSession(econSenderId()));
  ipcMain.handle('shell:get-home-summary', e => {
    if (!isShell(e)) throw new Error('הפעולה מותרת מתוך המעטפת בלבד');
    if (!econAlive()) return null;
    return econ.shellCall('dashboard:getHomeSummary', econSenderId());
  });
  ipcMain.handle('shell:ai-ask', (e, question) => {
    if (!isShell(e)) throw new Error('הפעולה מותרת מתוך המעטפת בלבד');
    if (!econAlive()) throw new Error('כדי לשאול את העוזר יש להיכנס למערכת הכספים');
    return econ.shellCall('ai:run', econSenderId(), String(question || ''));
  });
  // אודות: גרסה, רישיון, הסכם ורכיבי צד שלישי — הטקסטים נארזים ב-build-info.js (android/build-apk.js)
  ipcMain.handle('shell:get-about', e => {
    if (!isShell(e)) return null;
    const a = ctx.about && typeof ctx.about === 'object' ? ctx.about : {};
    const txt = v => (typeof v === 'string' ? v : '');
    return { version: txt(ctx.version), license: txt(a.license), eula: txt(a.eula), notices: txt(a.notices) };
  });
  for (const [ch, label] of Object.entries(NOT_ON_ANDROID)) {
    ipcMain.handle(ch, e => {
      if (!isShell(e)) throw new Error('הפעולה מותרת מתוך המעטפת בלבד');
      throw new Error(`האפשרות "${label}" אינה זמינה בגרסת אנדרואיד`);
    });
  }

  // שינוי מצב הרישוי עם הזמן (פקיעה, סוף ניסיון) ופגישה שפגה (ניתוק אוטומטי, משתמש שנחסם) נבדקים כל דקה:
  // מצב הכתיבה, ומודול נעול פתוח בלי כניסה ← מסך הכניסה (ה-iframe נשאר, ואחרי הכניסה חוזרים אליו — כמו main.js).
  // סנכרון עם שרת הרישוי כל 3 דקות — רק במערכת ברישיון או כשהופעלה קבלת הודעות אוטומטית, ולא בשבת ויום טוב
  // (נבדק ב-chatAutoFetch שב-ipc.js)
  const every = typeof ctx.setInterval === 'function' ? ctx.setInterval : setInterval;
  const unref = t => { if (t && typeof t.unref === 'function') t.unref(); };
  unref(every(() => {
    econAuthCheckOnEnd();
    syncWriteBlocks(licenseNow());
    if (loginGate.mustLeave(active)) showLoginForLocked();
  }, 60 * 1000));
  if (econ.chatAutoFetch) unref(every(() => { econ.chatAutoFetch().catch(() => {}); }, 3 * 60 * 1000));

  return { switchTo, goHome, navigateHistory, licenseNow, get active() { return active; } };
}

module.exports = { start, MODS, ENTRY, NOT_ON_ANDROID, moduleMayInvoke, econOptions, restTime, licenseWriteBlock };
