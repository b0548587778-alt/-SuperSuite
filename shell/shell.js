// המעטפת האחידה: סרגל אחד לכל התוכנה, מסך בית, חיפוש מהיר, גיבוי ושחזור.
// כל הפריטים מגיעים מ-catalog.js — המשתמש רואה תחומים, לא מודולים.
const CAT = window.SUITE_CATALOG;
const HC = window.SUITE_HEBCAL;
// הגדרות הלוח העברי (עיר, דקות הדלקה, מצב שבת) — נטענות מ-main.js; עד אז ברירות המחדל
let cal = HC.resolveSettings({});
// רשימות עבודה: הקטלוג + תצוגות חדשות שזוהו אוטומטית (נטענות אחרי העלייה)
const GROUPS = [...CAT.GROUPS];
const ITEMS = [...CAT.ITEMS];
const BY_KEY = new Map(ITEMS.map(it => [it.key, it]));
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// views — התצוגה הפעילה בכל מודול שיש לו מסכים בסרגל (כלכלי, אימונים)
const ui = { active: null, views: {}, query: '' };
const VIEW_MODS = ['econ', 'trainer'];
// מצב הרישוי מ-main.js: level ok / limited (קריאה בלבד) / blocked (נעול), ואילו מודולים פתוחים
let lic = { level: 'ok', message: '', modules: {} };
const ALWAYS_OPEN_VIEWS = ['licensing', 'messages'];
const itemOpen = it => lic.modules[it.mod] !== false || (it.mod === 'econ' && ALWAYS_OPEN_VIEWS.includes(it.view));

/* ---------- ניווט ---------- */
function currentKey() {
  if (!ui.active) return 'home';
  if (VIEW_MODS.includes(ui.active)) return ui.views[ui.active] ? ui.active + ':' + ui.views[ui.active] : null;
  return ui.active;
}

// התאמה לחיפוש: שם, תיאור או כותרת התחום; כל המילים שהוקלדו חייבות להופיע
function matches(it, q) {
  if (!q) return true;
  const hay = (it.name + ' ' + it.desc + ' ' + groupTitle(it.group)).toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}
function groupTitle(id) { const g = GROUPS.find(x => x.id === id); return g ? g.title : ''; }

function navItem(it) {
  const off = !itemOpen(it);
  return `<button class="it hue-${it.hue}${off ? ' off' : ''}" data-key="${esc(it.key)}" title="${esc(off ? lic.message || 'אינו כלול ברישיון' : it.desc)}">` +
    `<span class="ic">${esc(it.icon)}</span><span class="nm">${esc(it.name)}</span></button>`;
}

function renderNav() {
  const q = ui.query.trim();
  let html = q ? '' : '<button class="it home" data-key="home"><span class="ic">⌂</span><span class="nm">מסך הבית</span></button>';
  let found = 0;
  for (const g of GROUPS) {
    const items = ITEMS.filter(it => it.group === g.id && matches(it, q));
    if (!items.length) continue;
    found += items.length;
    html += `<div class="grp"><div class="grp-t">${esc(g.title)}</div>${items.map(navItem).join('')}</div>`;
  }
  if (q && !found) html = '<div class="none">לא נמצא דבר. נסה מילה אחרת.</div>';
  $('nav').innerHTML = html;
  mark();
}

function mark() {
  const key = currentKey();
  $('nav').querySelectorAll('.it').forEach(b => b.classList.toggle('on', b.dataset.key === key));
}

function open(key) {
  if (key === 'home') { goHome(); return; }
  const it = BY_KEY.get(key);
  if (!it) return;
  if (!itemOpen(it)) { flashLicense(); return; }
  ui.active = it.mod;
  if (it.view) ui.views[it.mod] = it.view;
  mark();
  pushRecent(key);
  const api = window.shellAPI;
  if (api.open) api.open(it.mod, it.view || null); else api.switchTo(it.mod);
}

function goHome() {
  ui.active = null;
  mark();
  renderHome();
  window.shellAPI.goHome();
}

$('nav').onclick = e => {
  const b = e.target.closest('.it');
  if (b) open(b.dataset.key);
};

/* ---------- חיפוש ---------- */
const q = $('q');
q.addEventListener('input', () => { ui.query = q.value; renderNav(); });
q.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const first = $('nav').querySelector('.it');
    if (first) { open(first.dataset.key); q.value = ''; ui.query = ''; renderNav(); }
  } else if (e.key === 'Escape') {
    q.value = ''; ui.query = ''; renderNav(); q.blur();
  }
});
function focusSearch() { q.focus(); if (q.select) q.select(); }
$('cta').onclick = focusSearch;

/* ---------- אחרונים ---------- */
const RECENT_KEY = 'suite.recent';
function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter(k => BY_KEY.has(k)); } catch { return []; }
}
function pushRecent(key) {
  try {
    const list = [key, ...getRecent().filter(k => k !== key)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch { /* אין אחסון — לא קריטי */ }
}

/* ---------- מסך הבית ---------- */
function greeting(h) {
  if (h < 5) return 'לילה טוב';
  if (h < 12) return 'בוקר טוב';
  if (h < 17) return 'צהריים טובים';
  if (h < 21) return 'ערב טוב';
  return 'לילה טוב';
}
function card(it) {
  return `<button class="card hue-${it.hue}${itemOpen(it) ? '' : ' off'}" data-key="${esc(it.key)}" type="button">` +
    `<span class="ic">${esc(it.icon)}</span><span><b>${esc(it.name)}</b><small>${esc(it.desc)}</small></span></button>`;
}
function renderHome() {
  const now = new Date();
  $('greet').textContent = greeting(now.getHours());
  const greg = now.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const heb = HC.hebrewToday(now.getTime(), cal);
  $('dates').innerHTML = heb ? `<b>${esc(heb.text)}</b>${heb.night ? ' <i>(אור ליום ' + esc(HC.WEEKDAYS[heb.weekday]) + ')</i>' : ''} · ${esc(greg)}` : esc(greg);
  renderDay(now.getTime());
  renderLicense();

  const recent = getRecent().slice(0, 4).map(k => BY_KEY.get(k));
  $('recentSec').hidden = !recent.length;
  $('recent').innerHTML = recent.map(card).join('');

  $('groups').innerHTML = GROUPS.map(g =>
    `<section class="sec hue-${g.hue}"><h2>${esc(g.title)}</h2><div class="cards">` +
    ITEMS.filter(it => it.group === g.id).map(card).join('') + '</div></section>').join('');
}
$('home').onclick = e => {
  const c = e.target.closest('.card, .lic-go');
  if (c) open(c.dataset.key);
};

/* ---------- רישוי: מסך "מערכת מושבתת" ---------- */
function renderLicense() {
  const bar = $('licBar'), block = $('licBlock');
  if (lic.level === 'ok') { bar.hidden = true; block.hidden = true; return; }
  const blocked = lic.level === 'blocked';
  bar.hidden = false;
  bar.className = blocked ? 'blocked' : '';
  bar.textContent = blocked ? lic.message : lic.message + ' — צפייה, ייצוא וגיבוי בלבד';
  block.hidden = false;
  block.className = 'lic-block' + (blocked ? '' : ' limited');
  block.innerHTML = `<h2>${blocked ? '🔒' : '⏸'} ${esc(lic.message)}</h2>` +
    (blocked ? '<p>התוכנה אינה זמינה לעבודה כרגע.</p>' : '<p>אפשר לצפות בנתונים, לייצא ולגבות. יצירה ועריכה חסומות עד לחידוש.</p>') +
    '<p>הנתונים שלך שמורים במחשב ולא נמחקו. לחידוש הפעילות פנו לספק, או קלטו רישיון / עדכון סטטוס.</p>' +
    '<button type="button" class="lic-go" data-key="econ:licensing">🔑 רישוי ומערכות</button>' +
    '<button type="button" class="lic-go" data-key="econ:messages">💬 הודעה לספק</button>';
}
function flashLicense() {
  if (!ui.active) { renderHome(); }
  const bar = $('licBar');
  if (bar.hidden) return;
  bar.classList.add('flash');
  setTimeout(() => bar.classList.remove('flash'), 1200);
}
function applyLicense(st) {
  if (!st || typeof st !== 'object') return;
  lic = { level: st.level || 'ok', message: String(st.message || ''), modules: st.modules || {} };
  document.body.classList.toggle('lic-blocked', lic.level === 'blocked');
  renderNav();
  if (!ui.active) renderHome(); else renderLicense();
}
if (window.shellAPI.getLicenseState) window.shellAPI.getLicenseState().then(applyLicense).catch(() => {});
if (window.shellAPI.onLicense) window.shellAPI.onLicense(applyLicense);

renderNav();
renderHome();

// סנכרון: מסכים שנוספו למודול הכלכלי ועדיין לא לקטלוג מופיעים תחת "נוספו לאחרונה"
async function loadExtras() {
  if (!window.shellAPI.getCatalogExtras) return;
  try {
    const extras = (await window.shellAPI.getCatalogExtras() || [])
      .filter(x => x && typeof x.key === 'string' && !BY_KEY.has(x.key));
    if (!extras.length) return;
    if (!GROUPS.some(g => g.id === CAT.NEW_GROUP.id)) GROUPS.push(CAT.NEW_GROUP);
    for (const x of extras) { ITEMS.push(x); BY_KEY.set(x.key, x); }
    renderNav();
    if (!ui.active) renderHome();
  } catch { /* הסרגל הבסיסי ממשיך לעבוד */ }
}
loadExtras();

window.shellAPI.onActive(id => {
  ui.active = id || null;
  if (!id) renderHome();
  mark();
  updateWhere();
});
if (window.shellAPI.onActiveView) {
  window.shellAPI.onActiveView((view, mod = 'econ') => {
    if (!VIEW_MODS.includes(mod)) return;
    ui.views[mod] = view;
    if (ui.active === mod) { pushRecent(mod + ':' + view); mark(); updateWhere(); }
  });
}

/* ---------- דיאלוגים ----------
   תצוגת המודול מצוירת מעל המעטפת, ולכן בזמן שדיאלוג פתוח מסתירים אותה (shell:overlay) */
function showDialog(dlg) {
  if (window.shellAPI.setOverlay) window.shellAPI.setOverlay(true);
  dlg.showModal();
}
function closeDialog(dlg) {
  dlg.close();
  // במצב שבת מסך המנוחה נשאר מעל הכול — לא מחזירים את המודול
  if (window.shellAPI.setOverlay && !shabbatOn) window.shellAPI.setOverlay(false);
}

// חלון סיסמת גיבוי: מחזיר {pass, scope} או null בביטול. scopes=true מציג בחירת היקף (לגיבוי)
function askPassphrase({ title, text, optional, scopes }) {
  const dlg = $('pp');
  const input = $('ppInput');
  const err = $('ppErr');
  const scopeSel = $('ppScope');
  $('ppTitle').textContent = title;
  $('ppText').textContent = text;
  input.value = ''; err.textContent = '';
  input.required = !optional;
  scopeSel.hidden = !scopes;
  scopeSel.value = 'all';
  return new Promise(resolve => {
    const form = $('ppForm');
    const cancel = $('ppCancel');
    const done = (value) => { form.onsubmit = null; cancel.onclick = null; dlg.oncancel = null; closeDialog(dlg); resolve(value); };
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = input.value;
      if (!optional && v.length < 8) { err.textContent = 'הסיסמה חייבת להכיל לפחות 8 תווים'; return; }
      done({ pass: v, scope: scopeSel.value });
    };
    cancel.onclick = () => done(null);
    // Esc סוגר את הדיאלוג — מטפלים בו כביטול כדי שהמודול יחזור להיות גלוי
    dlg.oncancel = (e) => { e.preventDefault(); done(null); };
    showDialog(dlg);
    input.focus();
  });
}

async function runBackup() {
  const r = await askPassphrase({ title: 'גיבוי מוצפן', text: 'בחר מה לגבות והזן סיסמה. בלי הסיסמה לא ניתן לשחזר את הקובץ.', scopes: true });
  if (r === null) return;
  try { await window.shellAPI.backupAll(r.pass, r.scope); }
  catch (e) { alert(e.message || 'שגיאה בגיבוי'); }
}
async function runRestore() {
  const r = await askPassphrase({ title: 'שחזור מגיבוי', text: 'אם הגיבוי מוצפן, הזן את סיסמת הגיבוי. בגיבוי אוטומטי השאר ריק.', optional: true });
  if (r === null) return;
  try { await window.shellAPI.restoreAll(r.pass); }
  catch (e) { alert(e.message || 'שגיאה בשחזור'); }
}
function showGuide() {
  const g = $('guide');
  g.oncancel = (e) => { e.preventDefault(); closeDialog(g); };
  showDialog(g);
  // המיקוד עובר לכפתור "סגור" שבתחתית וגולל לסוף — מחזירים לראש המדריך
  g.scrollTop = 0;
}

$('bk').onclick = runBackup;
$('rs').onclick = runRestore;
$('hp').onclick = showGuide;
$('guideOk').onclick = () => closeDialog($('guide'));
$('hm').onclick = goHome;

/* ---------- אחורה / קדימה ---------- */
$('navBack').onclick = () => window.shellAPI.historyGo && window.shellAPI.historyGo(-1);
$('navFwd').onclick = () => window.shellAPI.historyGo && window.shellAPI.historyGo(1);
if (window.shellAPI.onHistory) {
  window.shellAPI.onHistory(st => {
    $('navBack').disabled = !(st && st.canBack);
    $('navFwd').disabled = !(st && st.canForward);
  });
}
// "איפה אני": שם המסך הנוכחי ליד הכפתורים
function updateWhere() {
  const key = currentKey();
  const it = key && key !== 'home' ? BY_KEY.get(key) : null;
  $('navWhere').textContent = key === 'home' ? 'מסך הבית' : it ? it.name : '';
}
$('qt').onclick = () => {
  if (confirm('לצאת מהמערכת ולסגור את החלון?')) window.shellAPI.quit();
};

$('tg').onclick = async () => {
  try {
    const t = await window.shellAPI.pickBackupTarget();
    if (t) $('tgInfo').textContent = 'גיבוי אוטומטי ליעד: ' + t;
  } catch (e) { alert(e.message || 'נדרשת כניסה למערכת כדי להגדיר יעד גיבוי'); }
};
// יעד הגיבוי תלוי בהרשאת גיבוי, ולכן לפני הכניסה אין מה לבקש אותו.
// שואלים קודם (בשקט) אם יש כניסה, ורק אז מבקשים את היעד — כדי לא לייצר חריגה בכל הפעלה.
// בכל מעבר לחלק הכספי מנסים שוב, עד שהמשתמש מתחבר והטקסט מתעדכן.
let targetShown = false;
async function refreshTargetIfLoggedIn() {
  if (targetShown) return;
  try {
    if (!(await window.shellAPI.isLoggedIn())) return;
    const t = await window.shellAPI.getBackupTarget();
    targetShown = true;
    $('tgInfo').textContent = t ? 'גיבוי אוטומטי ליעד: ' + t : 'גיבוי אוטומטי: תיקיית המסמכים';
    // סטטוס הגיבוי האחרון: כשל שקט (אין הצפנת מערכת / כונן מנותק) חייב להיות גלוי למשתמש
    const st = window.shellAPI.getBackupStatus ? await window.shellAPI.getBackupStatus() : '';
    if (st) $('tgInfo').textContent += ' · ' + st;
  } catch { /* נעדכן במעבר הבא */ }
}
window.shellAPI.onActive(id => { if (id === 'econ') refreshTargetIfLoggedIn(); });

// פקודות מקלדת שמטופלות במעטפת (F1, Ctrl+K, Ctrl+Shift+B/R)
window.shellAPI.onCmd(cmd => {
  if (cmd === 'help') showGuide();
  if (cmd === 'search') focusSearch();
  if (cmd === 'backup') runBackup();
  if (cmd === 'restore') runRestore();
});

/* ---------- לוח עברי, זמני היום ושבת ---------- */
// כרטיס "היום" במסך הבית: מועדים, זמני היום והשבת הקרובה
function renderDay(nowMs) {
  const today = HC.civilAt(nowMs);
  const z = HC.zmanim(today, cal);
  const events = HC.holidays(today, cal).concat(HC.holidays(today + 86400000, cal)
    .filter(e => e.kind === 'yomtov' || e.kind === 'fast').map(e => ({ name: 'מחר: ' + e.name, kind: 'info' })));
  const next = HC.nextHoly(nowMs, cal);
  const chips = events.map(e => `<span class="chip ${esc(e.kind)}">${esc(e.name)}</span>`).join('');
  $('day').innerHTML =
    `<div class="day-col"><div class="day-t">היום · ${esc(cal.cityObj.name)}</div>` +
    (chips ? `<div class="chips">${chips}</div>` : '') +
    `<div class="zm"><span>זריחה <b>${HC.formatTime(z.sunrise)}</b></span><span>שקיעה <b>${HC.formatTime(z.sunset)}</b></span><span>צאת הכוכבים <b>${HC.formatTime(z.tzeit)}</b></span></div></div>` +
    (next ? `<div class="day-col shab"><div class="day-t">${esc(next.name)} הקרובה</div>` +
      `<div class="zm big"><span>הדלקת נרות <b>${HC.formatTime(next.candles)}</b></span><span>צאת ${esc(next.name.startsWith('שבת') ? 'השבת' : 'החג')} <b>${HC.formatTime(next.tzeit)}</b></span><span>ר"ת <b>${HC.formatTime(next.tzeitRT)}</b></span></div></div>` : '') +
    `<button class="day-set" id="calSet" type="button" title="הגדרות לוח ושבת">⚙</button>`;
  $('calSet').onclick = openCalendarSettings;
  $('sideDate').textContent = (HC.hebrewToday(nowMs, cal) || {}).short || '';
}

// מצב שבת: מסך מנוחה מעל הכול, בלי פעולות. מתעדכן כל דקה; נעלם מעצמו בצאת
let shabbatOn = false;
function tickShabbat() {
  const now = Date.now();
  const st = cal.shabbatMode ? HC.shabbatStatus(now, cal) : { active: false };
  if (st.active !== shabbatOn) {
    shabbatOn = st.active;
    document.body.classList.toggle('shabbat', shabbatOn);
    if (window.shellAPI.setOverlay) window.shellAPI.setOverlay(shabbatOn);
  }
  if (st.active) {
    $('shTitle').textContent = st.name === 'שבת קודש' ? 'שבת שלום' : (st.name.startsWith('שבת') ? 'שבת שלום ומבורך' : 'חג שמח');
    $('shName').textContent = st.name;
    $('shEnd').textContent = 'התוכנה תחזור לפעול בצאת, בשעה ' + HC.formatTime(st.endsAt);
  }
}

// דיאלוג הגדרות הלוח
function openCalendarSettings() {
  const dlg = $('calDlg');
  $('calCity').innerHTML = HC.CITIES.map(c => `<option value="${esc(c.id)}">${esc(c.name)} (${c.candles} דק׳)</option>`).join('');
  $('calCity').value = cal.city;
  $('calCandles').value = cal.candles;
  $('calShabbat').checked = !!cal.shabbatMode;
  $('calDiaspora').checked = !!cal.diaspora;
  $('calCity').onchange = () => { const c = HC.CITIES.find(x => x.id === $('calCity').value); if (c) $('calCandles').value = c.candles; };
  const done = () => { $('calForm').onsubmit = null; $('calCancel').onclick = null; dlg.oncancel = null; closeDialog(dlg); };
  $('calForm').onsubmit = async (e) => {
    e.preventDefault();
    const n = parseInt($('calCandles').value, 10);
    const input = { city: $('calCity').value, candles: Number.isInteger(n) ? Math.max(0, Math.min(60, n)) : null,
      shabbatMode: $('calShabbat').checked, diaspora: $('calDiaspora').checked };
    try {
      const saved = window.shellAPI.saveCalendar ? await window.shellAPI.saveCalendar(input) : input;
      cal = HC.resolveSettings(saved || input);
    } catch { cal = HC.resolveSettings(input); }
    done();
    renderHome();
    tickShabbat();
  };
  $('calCancel').onclick = done;
  dlg.oncancel = (e) => { e.preventDefault(); done(); };
  showDialog(dlg);
}

async function loadCalendar() {
  try {
    if (window.shellAPI.getCalendar) { const s = await window.shellAPI.getCalendar(); if (s) cal = HC.resolveSettings(s); }
  } catch { /* ברירות המחדל */ }
  if (!ui.active) renderHome(); else renderDay(Date.now());
  tickShabbat();
}
loadCalendar();
setInterval(() => { tickShabbat(); if (!ui.active) renderDay(Date.now()); }, 60000);
