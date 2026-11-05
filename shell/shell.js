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
/* ---------- סט אייקונים אחד למעטפת: קווי, 24×24, עובי אחיד (.ss-icon ב-ui-kit.css). ציור מקורי, בלי רכיב צד שלישי.
   הקטלוג שומר אמוג'י לכל פריט; כאן המיפוי מפריט/תחום/פרופיל לאייקון ---------- */
const IC = (function () {
  const P = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
    'arrow-right': '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    'arrow-left': '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
    'chevron-left': '<path d="m14 6-6 6 6 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
    upload: '<path d="M12 20V9"/><path d="m7 14 5-5 5 5"/><path d="M5 4h14"/>',
    drive: '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5.5 13 8 5h8l2.5 8"/><path d="M7 16.5h.01"/><path d="M11 16.5h6"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9"/><path d="m17 6 3 3"/><path d="m14.5 8.5 2 2"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.5-1.9-.3-1 .4-2.1 1.5-2.1H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17h.01"/>',
    power: '<path d="M12 3v9"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    sparkles: '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8Z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z"/>',
    send: '<path d="M21 3 3 10.5l7 2.5 2.5 7Z"/><path d="m10 13 4.5-4.5"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
    sunset: '<path d="M3 18h18M6 21h12"/><path d="M7 18a5 5 0 0 1 10 0"/><path d="M12 3v6M9 6l3 3 3-3"/>',
    star: '<path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6l-5.4 2.9 1.2-6-4.5-4.2 6.1-.7Z"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
    candle: '<path d="M12 3c1.5 1.6 2 2.8 2 3.8a2 2 0 0 1-4 0c0-1 .5-2.2 2-3.8Z"/><rect x="9" y="11" width="6" height="10" rx="1"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    alert: '<path d="M12 3.5 2.5 20h19Z"/><path d="M12 10v4.5M12 17.5h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    'trend-up': '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    'trend-down': '<path d="m3 7 6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
    invoice: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v4c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M9 14v3c0 1.7 2.7 3 6 3s6-1.3 6-3v-5c0-1.6-2.4-2.9-5.5-3"/>',
    'hand-coin': '<circle cx="15" cy="7" r="3"/><path d="M3 15h3l4 3h5a1.5 1.5 0 0 0 0-3h-3"/><path d="M6 15c1-1.5 2.5-2.5 4.5-2.5H14"/><path d="M3 21h3"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    wallet: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18v4"/><rect x="3.5" y="8" width="17" height="12" rx="2"/><path d="M16 14h.01"/>',
    building: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10.5 21v-3h3v3"/>',
    bank: '<path d="M3 9.5 12 4l9 5.5"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 20.5h18"/>',
    'chart-line': '<path d="M4 20V4M4 20h16"/><path d="m7 15 4-4 3 3 5-6"/>',
    'chart-bar': '<path d="M4 20V4M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-3"/>',
    dashboard: '<rect x="3.5" y="3.5" width="7" height="9" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="15.5" width="7" height="5" rx="1.5"/>',
    card: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>',
    droplet: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>',
    book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5Z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="M9 7h6"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8Z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 12.5h18"/>',
    store: '<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5 12v8h14v-8M10 20v-4h4v4"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/>',
    shekel: '<path d="M6 19V5h6a3 3 0 0 1 3 3v7"/><path d="M10 9v10h6a3 3 0 0 0 3-3V5"/>',
    heart: '<path d="M12 20s-7-4.4-7-9.5A4 4 0 0 1 12 8a4 4 0 0 1 7 2.5C19 15.6 12 20 12 20Z"/>',
    package: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5Z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
    'home-lock': '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><circle cx="12" cy="14" r="2"/><path d="M12 16v2"/>',
    calculator: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15v3M8 18h4"/>',
    realty: '<path d="M3 21V11l6-5 6 5v10"/><path d="M15 21V9l3-2.5L21 9v12"/><path d="M2 21h20M7.5 21v-4h3v4"/>',
    ruler: '<path d="M3.5 16.5 16.5 3.5l4 4-13 13Z"/><path d="m7 13 1.5 1.5M10 10l1.5 1.5M13 7l1.5 1.5"/>',
    gem: '<path d="M6 4h12l3 5-9 11L3 9Z"/><path d="M3 9h18M9.5 4 8 9l4 11 4-11-1.5-5"/>',
    checklist: '<path d="m4 6 1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17"/><path d="M11 6.5h9M11 12.5h9M11 18.5h9"/>',
    contacts: '<rect x="4" y="3" width="15" height="18" rx="2"/><circle cx="11.5" cy="10" r="2.5"/><path d="M7.5 17a4 4 0 0 1 8 0M19 7h2M19 11h2M19 15h2"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    pen: '<path d="m4 20 1-4L16 5l3 3L8 19Z"/><path d="m14 7 3 3"/>',
    toolbox: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8M3 13h18M10 13v2h4v-2"/>',
    ticket: '<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4Z"/><path d="M14 7v2M14 11v2M14 15v2"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    clipboard: '<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 3h6v3H9ZM9 11h6M9 15h4"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    leaf: '<path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15Z"/><path d="m5 19 8-8"/>',
    'book-open': '<path d="M12 6.5C10 5 7 4.5 3 5v14c4-.5 7 0 9 1.5 2-1.5 5-2 9-1.5V5c-4-.5-7 0-9 1.5Z"/><path d="M12 6.5v14"/>',
    wrench: '<path d="M15 4a5 5 0 0 0-4.6 6.9L4 17.3V20h2.7l6.4-6.4A5 5 0 0 0 20 9l-3 1-3-3 1-3Z"/>',
    message: '<path d="M4 5h16v11H9l-5 4Z"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    access: '<circle cx="12" cy="4.5" r="1.8"/><path d="M5 8.5l7 1.5 7-1.5M12 10v4.5M12 14.5 8.5 21M12 14.5l3.5 6.5"/>',
  };

  // פריט בקטלוג ← אייקון. פריט חדש בלי מיפוי מקבל את האייקון של התחום שלו
  const BY_KEY = {
    'econ:dashboard': 'dashboard', 'econ:acct-invoices': 'invoice', 'econ:collect': 'card', 'econ:acct-reports': 'chart-line',
    'econ:biz-reports': 'droplet', 'econ:acct-bank': 'bank', 'econ:acct-journal': 'book', 'econ:acct-chart': 'folder',
    'econ:acct-pricing': 'tag', 'econ:business': 'store', 'econ:market-intel': 'target', 'econ:acct-settings': 'building',
    'econ:personal-finance': 'wallet', 'econ:finance': 'shekel', 'econ:acct-personal': 'home', 'econ:npo': 'heart',
    'econ:gemach': 'hand-coin', 'econ:chesed': 'package', 'econ:people': 'users', 'econ:mortgage': 'home-lock',
    'econ:mortgage-advisor': 'briefcase', 'econ:mortgage-lab': 'calculator', 'econ:realty': 'realty', 'econ:realestate': 'ruler',
    shamai: 'gem', 'econ:tasks': 'checklist', 'econ:contacts': 'contacts', 'econ:voice-notes': 'mic', 'econ:canvas': 'pen',
    tools: 'toolbox', 'econ:ai': 'sparkles',
    'econ:settings': 'sliders', 'econ:licensing': 'key', 'econ:messages': 'message',
  };
  const BY_GROUP = { money: 'coins', home: 'home', realty: 'realty', org: 'briefcase', system: 'sliders' };
  const BY_PROFILE = { npo: 'heart', gemach: 'hand-coin', chesed: 'package', business: 'store', household: 'home', mortgage: 'home-lock', appraiser: 'gem' };

  // svg(name): סימון מוכן להכנסה ל-innerHTML. השמות קבועים מהטבלה — לעולם לא טקסט מהמשתמש
  function svg(name, cls) {
    const body = P[name];
    if (!body) return '';
    return `<svg class="ss-icon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
  }
  const nameForItem = (it) => (it && (BY_KEY[it.key] || BY_GROUP[it.group])) || 'sparkles';
  const forItem = (it, cls) => svg(nameForItem(it), cls);
  const forProfile = (id, cls) => svg(BY_PROFILE[id] || 'sparkles', cls);
  // אייקונים בסימון הקבוע: <span data-icon="home"></span>
  function hydrate(root) {
    const scope = root && root.querySelectorAll ? root : null;
    if (!scope) return;
    for (const el of scope.querySelectorAll('[data-icon]')) if (P[el.dataset.icon]) el.innerHTML = svg(el.dataset.icon);
  }

  return { svg, forItem, forProfile, hydrate };
})();
const svg = (name) => (IC ? IC.svg(name) : '');
const itemIcon = (it) => (IC ? IC.forItem(it) : esc(it.icon));
if (IC && document.querySelectorAll) IC.hydrate(document);

// views — התצוגה הפעילה בכל מודול שיש לו מסכים בסרגל (הכלכלי)
const ui = { active: null, views: {}, query: '' };
// מצב פשוט (נגישות, סבב 4): simple — מההגדרות (display.simple); simpleAll — "הצגת כל המסכים" במסך הבית;
// navMore — "עוד מסכים" בסרגל. מוגדר כאן (לפני הרינדור הראשון), ומתעדכן ב-applyA11yState
ui.simple = false; ui.simpleAll = false; ui.navMore = false;
const SIMPLE = window.SUITE_SIMPLE || null;
const VIEW_MODS = ['econ'];
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
    `<span class="ic">${itemIcon(it)}</span><span class="nm">${esc(it.name)}</span></button>`;
}

// תחומים מקופלים בסרגל — העדפה של המשתמש בלבד (localStorage), נקראת כקלט לא מהימן.
// בחיפוש כל התחומים פתוחים, והתחום של המסך הפעיל נפתח תמיד.
const NAV_FOLD_KEY = 'suite.navFolded';
function loadFolded() {
  try {
    const v = JSON.parse(localStorage.getItem(NAV_FOLD_KEY) || '[]');
    return new Set(Array.isArray(v) ? v.filter(x => typeof x === 'string' && GROUPS.some(g => g.id === x)) : []);
  } catch { return new Set(); }
}
const folded = loadFolded();
function saveFolded() { try { localStorage.setItem(NAV_FOLD_KEY, JSON.stringify([...folded])); } catch { /* העדפה בלבד */ } }
function toggleGroup(id) {
  if (folded.has(id)) folded.delete(id); else folded.add(id);
  saveFolded();
  renderNav();
}

// משימות מצב פשוט שפתוחות למשתמש הזה (רישיון ומנהל)
function simpleTasks() {
  if (!SIMPLE) return [];
  return SIMPLE.tasksFor({ has: k => BY_KEY.has(k), open: k => itemOpen(BY_KEY.get(k)), admin: shellAdmin });
}
function renderNav() {
  const q = ui.query.trim();
  let html = q ? '' : `<button class="it home" data-key="home"><span class="ic">${IC ? svg('home') : '⌂'}</span><span class="nm">מסך הבית</span></button>`;
  let found = 0;
  const activeIt = BY_KEY.get(currentKey());
  // מצב פשוט: רק המסכים של המשימות והאחרונים; כל השאר מאחורי "עוד מסכים"
  const simpleNav = ui.simple && !q && SIMPLE;
  if (simpleNav) {
    const common = SIMPLE.sidebarKeys(simpleTasks(), getRecent()).map(k => BY_KEY.get(k)).filter(Boolean);
    html += `<div class="grp"><div class="grp-b">${common.map(navItem).join('')}</div></div>` +
      `<button type="button" class="it more" data-more aria-expanded="${ui.navMore}">${ui.navMore ? 'פחות מסכים' : 'עוד מסכים'}</button>`;
  }
  for (const g of (simpleNav && !ui.navMore ? [] : GROUPS)) {
    const items = ITEMS.filter(it => it.group === g.id && matches(it, q));
    if (!items.length) continue;
    found += items.length;
    const shut = !q && folded.has(g.id) && !(activeIt && activeIt.group === g.id);
    html += `<div class="grp${shut ? ' shut' : ''}"><button type="button" class="grp-t" data-grp="${esc(g.id)}" aria-expanded="${shut ? 'false' : 'true'}">` +
      `<span>${esc(g.title)}</span><span class="cnt">${items.length}</span><span class="chev" aria-hidden="true"></span></button>` +
      `<div class="grp-b">${shut ? '' : items.map(navItem).join('')}</div></div>`;
  }
  if (q && !found) html = '<div class="none">לא נמצא דבר. נסה מילה אחרת.</div>';
  $('nav').innerHTML = html;
  mark();
}

function mark() {
  const key = currentKey();
  $('nav').querySelectorAll('.it').forEach(b => b.classList.toggle('on', b.dataset.key === key));
  // "חזרה למסך הבית" בראש הסרגל — כשמסך פתוח (מוצג רק במצב פשוט: .ss-simple-only)
  $('simpleHome').hidden = !ui.active;
}

function open(key) {
  if (key === 'home') { goHome(); return; }
  const it = BY_KEY.get(key);
  if (!it) return;
  if (!itemOpen(it)) { flashLicense(); return; }
  ui.active = it.mod;
  if (it.view) ui.views[it.mod] = it.view;
  if (folded.has(it.group)) renderNav(); else mark();
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
  const more = e.target.closest('[data-more]');
  if (more && more.dataset && more.dataset.more !== undefined) {
    ui.navMore = !ui.navMore;
    renderNav();
    const b = $('nav').querySelector('[data-more]');
    if (b) b.focus();
    return;
  }
  const t = e.target.closest('.grp-t');
  if (t && t.dataset && t.dataset.grp) { toggleGroup(t.dataset.grp); return; }
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

/* ---------- אשף התחלה: "המסכים שלי" וצעדים ראשונים ---------- */
const OB = window.SUITE_ONBOARDING;
const OB_KEY = 'suite.onboarding';
// צעדים ומסכים של מנהל בלבד (יעד גיבוי, קוד שחזור, משתמשים, התוכנית הפיננסית) — לא מוצעים למשתמש אחר.
// לפני כניסה — כמו קודם (מוצגים); מתעדכן ב-refreshAdminFlag
let shellAdmin = true;
function obState() {
  try { return OB.normalizeState(JSON.parse(localStorage.getItem(OB_KEY) || 'null')); } catch { return OB.normalizeState(null); }
}
function obSave(patch) {
  try { localStorage.setItem(OB_KEY, JSON.stringify({ ...obState(), ...patch })); } catch { /* אין אחסון — לא קריטי */ }
  if (!ui.active) renderHome();
}
function obMarkDone(stepId) {
  const st = obState();
  if (OB && st.completed && !st.done.includes(stepId)) obSave({ done: [...st.done, stepId] });
}
function renderOnboarding() {
  if (!OB) return;
  const st = obState();
  $('obInvite').hidden = st.completed || st.dismissed;
  const p = OB.plan(st.profiles, [...BY_KEY.keys()], { admin: shellAdmin });
  const mine = st.completed ? p.screens.map(k => BY_KEY.get(k)).filter(Boolean) : [];
  $('mineSec').hidden = !mine.length;
  $('mine').innerHTML = mine.map(card).join('');
  const show = st.completed && !st.dismissed && p.steps.length;
  $('obSteps').hidden = !show;
  if (!show) return;
  const done = new Set(st.done);
  const doneCount = p.steps.filter(s => done.has(s.id)).length;
  const pct = Math.round(doneCount / p.steps.length * 100);
  $('obProgress').textContent = `${doneCount} מתוך ${p.steps.length}`;
  $('obMeter').style.width = pct + '%';
  $('obMeterBar').setAttribute('aria-valuenow', String(pct));
  $('obSteps').classList.toggle('all-done', doneCount === p.steps.length);
  $('obList').innerHTML = p.steps.map(s => `<li class="${done.has(s.id) ? 'done' : ''}">` +
    `<button type="button" data-ob-step="${esc(s.id)}">${esc(s.title)}</button>` +
    `<label><input type="checkbox" data-ob-done="${esc(s.id)}"${done.has(s.id) ? ' checked' : ''}> בוצע</label>` +
    `<small>${esc(s.detail)}</small></li>`).join('');
}
function openOnboarding() {
  const dlg = $('obDlg');
  const st = obState();
  $('obErr').textContent = '';
  $('obChoices').innerHTML = OB.PROFILES.map(p => `<label><input type="checkbox" name="ob" value="${esc(p.id)}"${st.profiles.includes(p.id) ? ' checked' : ''}>` +
    `<span class="ob-check" aria-hidden="true">${IC ? svg('check') : '✓'}</span><span class="ob-icon" aria-hidden="true">${IC ? IC.forProfile(p.id) : esc(p.icon)}</span><b>${esc(p.name)}</b><small>${esc(p.desc)}</small></label>`).join('');
  const count = () => {
    const n = $('obChoices').querySelectorAll('input[name="ob"]:checked').length;
    $('obCount').textContent = n ? (n === 1 ? 'נבחרה אפשרות אחת' : `נבחרו ${n} אפשרויות`) : 'עדיין לא נבחר דבר';
  };
  $('obChoices').onchange = count;
  count();
  const done = () => { $('obForm').onsubmit = null; dlg.oncancel = null; closeDialog(dlg); };
  $('obForm').onsubmit = (e) => {
    e.preventDefault();
    const picked = [...$('obChoices').querySelectorAll('input[name="ob"]:checked')].map(i => i.value);
    if (!picked.length) { $('obErr').textContent = 'בחרו לפחות אפשרות אחת'; return; }
    done();
    obSave({ profiles: picked, completed: true, dismissed: false });
    // אחרי הבחירה הראשונה — סיור קצר של 3 שלבים (פעם אחת; אפשר שוב מ"צעדים ראשונים")
    if (!tourSeen()) startTour();
  };
  $('obCancel').onclick = done;
  dlg.oncancel = (e) => { e.preventDefault(); done(); };
  showDialog(dlg);
}
if (OB) {
  $('obStart').onclick = openOnboarding;
  $('obEdit').onclick = openOnboarding;
  $('obLater').onclick = () => obSave({ dismissed: true });
  $('obHide').onclick = () => obSave({ dismissed: true });
  $('tourAgain').onclick = () => startTour();
  $('obList').onclick = (e) => {
    const b = e.target.closest('[data-ob-step]');
    if (!b) return;
    const s = OB.plan(obState().profiles, [...BY_KEY.keys()], { admin: shellAdmin }).steps.find(x => x.id === b.dataset.obStep);
    if (!s) return;
    if (s.action === 'backup-target') $('tg').click();
    else if (s.action === 'recovery-code') showRecoveryCode();
    else if (s.key) open(s.key);
  };
  $('obList').onchange = (e) => {
    const c = e.target.closest('[data-ob-done]');
    if (!c) return;
    const st = obState();
    obSave({ done: c.checked ? [...new Set([...st.done, c.dataset.obDone])] : st.done.filter(x => x !== c.dataset.obDone) });
  };
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
    `<span class="ic" aria-hidden="true">${itemIcon(it)}</span><span><b>${esc(it.name)}</b><small>${esc(it.desc)}</small></span></button>`;
}
// מה שמסך הבית מציג ותלוי בשעה: הברכה, התאריך האזרחי והתאריך העברי (מתחלף בשקיעה). שינוי ← renderHome מלא
// (סקירת קוד 2.11.2026: בשקיעה רק כרטיס הזמנים התעדכן — הברכה, שורת התאריך ותג "היום" נשארו של היום הקודם)
let homeStamp = '';
function homeStampAt(ms) {
  const d = new Date(ms);
  const h = HC.hebrewToday(ms, cal);
  return [greeting(d.getHours()), d.getFullYear(), d.getMonth(), d.getDate(), h ? h.text + (h.night ? '*' : '') : ''].join('|');
}
function renderHome() {
  const now = new Date();
  homeStamp = homeStampAt(now.getTime());
  $('greet').textContent = greeting(now.getHours());
  const greg = now.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const heb = HC.hebrewToday(now.getTime(), cal);
  $('dates').innerHTML = heb ? `<b>${esc(heb.text)}</b>${heb.night ? ' <i>(אור ליום ' + esc(HC.WEEKDAYS[heb.weekday]) + ')</i>' : ''} · ${esc(greg)}` : esc(greg);
  renderDay(now.getTime());
  $('todayDate').textContent = heb ? heb.text : greg;
  renderKpis();
  renderToday(now);
  renderLicense();
  renderOnboarding();

  const recent = getRecent().slice(0, 4).map(k => BY_KEY.get(k));
  $('recentSec').hidden = !recent.length;
  $('recent').innerHTML = recent.map(card).join('');

  renderSimpleHome();
  $('groups').innerHTML = GROUPS.map(g =>
    `<section class="sec hue-${g.hue}"><h2>${esc(g.title)}</h2><div class="cards">` +
    ITEMS.filter(it => it.group === g.id).map(card).join('') + '</div></section>').join('');
}
$('home').onclick = e => {
  const c = e.target.closest('.card, .lic-go, .kpi, .t-item');
  if (c) open(c.dataset.key);
};

/* ---------- מצב פשוט: משימות גדולות בפעלים (נגישות, סבב 4) ---------- */
function renderSimpleHome() {
  // במצב פשוט רשימת כל המסכים מוסתרת (ss-advanced) עד "הצגת כל המסכים"
  $('groups').classList.toggle('ss-advanced', !ui.simpleAll);
  $('simpleAll').setAttribute('aria-expanded', String(ui.simpleAll));
  $('simpleAll').textContent = ui.simpleAll ? 'הסתרת שאר המסכים' : 'הצגת כל המסכים';
  if (!ui.simple) { $('simpleTasks').innerHTML = ''; return; }
  $('simpleTasks').innerHTML = simpleTasks().map(t => `<button type="button" class="task" data-task="${esc(t.id)}">` +
    `<span class="t-ic" aria-hidden="true">${IC ? svg(t.icon) : ''}</span><span><b>${esc(t.verb)}</b><small>${esc(t.hint)}</small></span></button>`).join('');
}
$('simpleTasks').onclick = e => {
  const b = e.target.closest('[data-task]');
  const t = b && SIMPLE ? SIMPLE.TASKS.find(x => x.id === b.dataset.task) : null;
  if (!t) return;
  if (t.action === 'search') focusSearch();
  else if (t.action === 'backup') runBackup();
  else if (t.action === 'help') showGuide();
  else if (t.task && window.shellAPI.startTask && taskAllowed(t.task)) runCommandTask({ id: t.task, prefill: {} });
  else if (t.key) open(t.key);
};
$('simpleAll').onclick = () => { ui.simpleAll = !ui.simpleAll; renderSimpleHome(); };
$('simpleOff').onclick = () => saveA11y({ simple: 'off' }, 'מצב פשוט: כבוי');
$('simpleHome').onclick = () => goHome();

/* ---------- מסך הבית: מדדים ו"היום" (יארצייטים, הלוואות לפירעון, חשבוניות פתוחות) ----------
   הנתונים מגיעים מ-shellAPI.getHomeSummary (קריאה בלבד, לפי הרשאות ורישיון — main.js). כשאין ערוץ או שאין כניסה
   למערכת הכספים — המדדים מוצגים ריקים עם הסבר, ולחיצה פותחת את המסך המתאים. סכומים באגורות. */
let homeData = null;
const nis = (ag) => '₪' + (Math.round(Number(ag) || 0) / 100).toLocaleString('he-IL', { maximumFractionDigits: 0 });
const count = (n) => (Number.isFinite(Number(n)) ? Math.max(0, Math.round(Number(n))).toLocaleString('he-IL') : '—');
const KPIS = [
  { id: 'income', key: 'econ:acct-reports', hue: 'blue', icon: 'trend-up', label: 'הכנסות החודש',
    value: (k) => nis(k.incomeMonth), sub: (k) => deltaHtml(k.incomeMonth, k.incomePrevMonth), has: (k) => k.incomeMonth != null },
  { id: 'invoices', key: 'econ:acct-invoices', hue: 'gold', icon: 'invoice', label: 'חשבוניות פתוחות',
    value: (k) => count(k.openInvoices), sub: (k) => (k.openInvoicesAmount ? esc(nis(k.openInvoicesAmount)) + ' לגבייה' : 'הכול נגבה'), has: (k) => k.openInvoices != null },
  { id: 'donations', key: 'econ:npo', hue: 'green', icon: 'heart', label: 'תרומות החודש',
    value: (k) => nis(k.donationsMonth), sub: () => 'עמותה וצדקה', has: (k) => k.donationsMonth != null },
  { id: 'loans', key: 'econ:gemach', hue: 'purple', icon: 'hand-coin', label: 'הלוואות פעילות בגמ"ח',
    value: (k) => count(k.activeLoans), sub: () => 'ללא ריבית', has: (k) => k.activeLoans != null },
];
// שינוי מול החודש הקודם — חץ ומילים, לא רק צבע
function deltaHtml(cur, prev) {
  const a = Number(cur), b = Number(prev);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return 'מתחילת החודש';
  const pct = Math.round((a - b) / b * 100);
  if (!pct) return '<span class="ss-delta">ללא שינוי מהחודש הקודם</span>';
  const up = pct > 0;
  return `<span class="ss-delta ${up ? 'ss-delta-up' : 'ss-delta-down'}">${up ? '▲' : '▼'} ${Math.abs(pct)}%</span> מול החודש הקודם`;
}
function renderKpis() {
  const k = (homeData && homeData.kpis) || {};
  $('kpis').innerHTML = KPIS.map(d => {
    const it = BY_KEY.get(d.key);
    if (!it) return '';
    const has = d.has(k);
    return `<button type="button" class="kpi hue-${d.hue}${has ? '' : ' empty'}${itemOpen(it) ? '' : ' off'}" data-key="${esc(d.key)}">` +
      `<span class="k-top"><span>${esc(d.label)}</span><span class="k-ic" aria-hidden="true">${svg(d.icon)}</span></span>` +
      `<span class="k-val">${has ? esc(d.value(k)) : '—'}</span>` +
      `<span class="k-sub">${has ? d.sub(k) : 'אחרי כניסה לכספים'}</span></button>`;
  }).join('');
}

// 'YYYY-MM-DD' ← ימים מהיום (תאריך מקומי, לא UTC)
function daysFrom(day, now) {
  const m = String(day || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const a = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86400000);
}
const shortDate = (day) => { const m = String(day || '').match(/^\d{4}-(\d{2})-(\d{2})$/); return m ? `${Number(m[2])}.${Number(m[1])}` : ''; };
function whenBadge(days, late) {
  if (late || days < 0) return '<span class="ss-badge ss-badge-danger">באיחור</span>';
  if (days === 0) return '<span class="ss-badge ss-badge-warning">היום</span>';
  if (days === 1) return '<span class="ss-badge ss-badge-info">מחר</span>';
  return `<span class="ss-badge">בעוד ${days} ימים</span>`;
}
const TODAY_COLS = [
  { id: 'yahrzeits', key: 'econ:npo', hue: 'gold', icon: 'candle', title: 'יארצייטים', none: 'אין יארצייט בשבוע הקרוב',
    row: (r, now) => ({ title: r.parentName ? `${r.name} ב"ר ${r.parentName}` : r.name, detail: r.hebrew || '', badge: whenBadge(Number(r.daysLeft) || 0, false) }) },
  { id: 'loans', key: 'econ:gemach', hue: 'purple', icon: 'hand-coin', title: 'הלוואות לפירעון', none: 'אין תשלומים קרובים',
    row: (r, now) => ({ title: r.borrowerName, detail: `${nis(r.amount)} · ${shortDate(r.dueDate)}`, badge: whenBadge(daysFrom(r.dueDate, now) ?? 0, r.late) }) },
  { id: 'invoices', key: 'econ:acct-invoices', hue: 'blue', icon: 'invoice', title: 'חשבוניות פתוחות', none: 'אין חשבוניות פתוחות',
    row: (r, now) => ({ title: r.customer, detail: `${r.number ? 'מס׳ ' + r.number + ' · ' : ''}${nis(r.amount)}`, badge: whenBadge(daysFrom(r.dueDate, now) ?? 0, r.late) }) },
];
function renderToday(now) {
  const box = $('todayCols');
  if (!homeData) {
    const it = BY_KEY.get('econ:dashboard');
    box.innerHTML = `<div class="t-empty">${svg('calendar')}<span><b>המשימות של היום יופיעו כאן</b><br>יארצייטים, הלוואות לפירעון וחשבוניות פתוחות — אחרי כניסה למערכת הכספים.</span>` +
      (it ? `<button type="button" class="t-item t-cta" data-key="econ:dashboard">כניסה ללוח הבקרה</button>` : '') + '</div>';
    return;
  }
  box.innerHTML = TODAY_COLS.map(c => {
    const rows = Array.isArray(homeData[c.id]) ? homeData[c.id].slice(0, 4) : [];
    const items = rows.map(r => c.row(r, now)).map(r =>
      `<button type="button" class="t-item" data-key="${esc(c.key)}"><span class="t-txt"><b>${esc(r.title)}</b><small>${esc(r.detail)}</small></span>${r.badge}</button>`).join('');
    return `<div class="t-col hue-${c.hue}"><h3><span class="t-ic" aria-hidden="true">${svg(c.icon)}</span>${esc(c.title)}<span class="n">${rows.length || ''}</span></h3>` +
      `<div class="t-list">${items || `<div class="t-none">${esc(c.none)}</div>`}</div></div>`;
  }).join('');
}
async function loadHome() {
  loadTaskAccess();
  if (!window.shellAPI.getHomeSummary) return;
  try {
    const d = await window.shellAPI.getHomeSummary();
    homeData = d && typeof d === 'object' ? d : null;
  } catch { homeData = null; }
  if (!ui.active) { renderKpis(); renderToday(new Date()); }
}

/* ---------- שאל את התוכנה: תיבת השאלה במסך הבית ----------
   העוזר עצמו ב-shell/ai (מנוע כללים מקומי, בלי רשת). כשיש ערוץ למעטפת (shellAPI.aiAsk) — התשובה מוצגת כאן;
   עד אז השאלה פותחת את מסך "שאל את התוכנה" במערכת הכספים. */
const ASK_SAMPLES = ['כמה גביתי החודש?', 'מי לא שילם?', 'מה דוח המע"מ של החודש?', 'אילו תורמים תרמו השנה?'];
$('askSugg').innerHTML = ASK_SAMPLES.map(q => `<button type="button" data-ask="${esc(q)}">${esc(q)}</button>`).join('');
$('askSugg').onclick = (e) => {
  const b = e.target.closest('[data-ask]');
  if (!b) return;
  $('askQ').value = b.dataset.ask;
  ask(b.dataset.ask);
};
$('askForm').onsubmit = (e) => { e.preventDefault(); ask($('askQ').value); };
function askOut(html) {
  const out = $('askOut');
  out.innerHTML = html;
  out.hidden = !html;
  const x = out.querySelector('[data-ask-close]');
  if (x) x.onclick = () => { askOut(''); $('askQ').focus(); };
}
// מונה שאלות: תשובה שהגיעה אחרי סוף הפגישה (או אחרי שאלה חדשה) לא מוצגת (סקירת קוד 2.11.2026)
let askSeq = 0;
async function ask(raw) {
  const q = String(raw || '').trim().slice(0, 500);
  if (!q) { $('askQ').focus(); return; }
  // "מה תרצה לעשות?": בקשה (משימה / מסך) ← אישור או "התכוונת ל...?"; רק שאלה ממשיכה לעוזר
  if (CMD_INTENTS && CMD_TASKS) {
    const r = CMD_INTENTS.parse(q, { today: localToday() });
    if (r.kind !== 'question') { askSeq++; $('askGo').disabled = false; showCommand(r, q); return; }
  }
  const head = (label) => `<div class="a-head"><span class="ss-badge">${svg('sparkles')} ${esc(label)}</span>` +
    `<button type="button" class="ss-btn-ghost ss-btn-sm" data-ask-close aria-label="סגירת התשובה">${svg('x')}</button></div><p class="a-q">${esc(q)}</p>`;
  if (!window.shellAPI.aiAsk) {
    askOut(head('שאל את התוכנה') + '<p class="a-text">פותחים את מסך "שאל את התוכנה" — הקלידו שם את השאלה.</p>');
    open('econ:ai');
    return;
  }
  const seq = ++askSeq;
  $('askGo').disabled = true;
  askOut(head('חושב…') + '<span class="ss-skeleton"></span><span class="ss-skeleton short"></span>');
  try {
    const r = await window.shellAPI.aiAsk(q);
    if (seq !== askSeq) return;
    askOut(head(r && r.engineLabel ? 'ענה: ' + r.engineLabel : 'תשובה') + `<p class="a-text ss-pre">${esc((r && r.text) || 'אין תשובה')}</p>`);
  } catch (e) {
    if (seq !== askSeq) return;
    // Electron מוסיף לשגיאת IPC קידומת אנגלית — מציגים רק את העברית (כמו ב-devices.js)
    const msg = String((e && e.message) || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    askOut(head('לא נענה') + `<p class="a-text">${esc(msg || 'העוזר אינו זמין כרגע')}</p>`);
  } finally { if (seq === askSeq) $('askGo').disabled = false; }
}
/* ---------- "מה תרצה לעשות?" — בקשה במילים פשוטות (תיבת הפקודה) ----------
   shell/intents.js מבין את הבקשה (בלי רשת ובלי מודל), shell/tasks.js — רשימת המשימות והאימות.
   כלל הבטיחות: **לא נשמר כלום מכאן**. מוצג מה הובן (שם, סכום, תאריך) ← "כן" ← הטופס נפתח מלא במסך שלו,
   והמשתמש בודק ושומר בעצמו. לא הובן — עד 3 הצעות "התכוונת ל...?", בלי הודעת שגיאה. */
const CMD_TASKS = window.SUITE_TASKS || null;
const CMD_INTENTS = window.SUITE_INTENTS || null;
// המשימות שהתהליך הראשי מתיר (רישיון ותפקיד, shell:task-access); null — לא ידוע (בלי ערוץ)
let taskAccess = null;
async function loadTaskAccess() {
  if (!window.shellAPI.taskAccess) return;
  try { const r = await window.shellAPI.taskAccess(); taskAccess = Array.isArray(r) ? r.filter(x => typeof x === 'string') : null; }
  catch { taskAccess = null; }
}
function allowedTasks() {
  if (!CMD_TASKS) return [];
  return CMD_TASKS.tasksFor({ has: k => BY_KEY.has(k), open: k => itemOpen(BY_KEY.get(k)), admin: shellAdmin, allowed: taskAccess });
}
const taskAllowed = (id) => allowedTasks().some(t => t.id === id);
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
let cmdPending = null;   // המשימה שמחכה ל"כן"
let cmdOptions = [];     // ההצעות שעל המסך
function cmdHead(label, q) {
  return `<div class="a-head"><span class="ss-badge">${svg('sparkles')} ${esc(label)}</span>` +
    `<button type="button" class="ss-btn-ghost ss-btn-sm" data-ask-close aria-label="סגירה">${svg('x')}</button></div><p class="a-q">${esc(q)}</p>`;
}
function optionLabel(o) {
  if (o.type === 'task') { const t = CMD_TASKS.getTask(o.id); return t ? t.verb : ''; }
  const it = BY_KEY.get(o.key);
  return it ? 'לפתוח את המסך: ' + it.name : '';
}
// הצעות: רק משימות ומסכים שפתוחים למשתמש
function choicesHtml(list) {
  cmdOptions = list.filter(o => (o.type === 'task' ? taskAllowed(o.id) : BY_KEY.has(o.key) && itemOpen(BY_KEY.get(o.key)))).slice(0, 3);
  return `<div class="cmd-choices" role="group" aria-label="התכוונת ל...?">` + cmdOptions.map((o, i) =>
    `<button type="button" class="ss-btn ss-btn-secondary" data-cmd-opt="${i}">${esc(optionLabel(o))}</button>`).join('') + '</div>';
}
function suggestionsFor(q) {
  return CMD_INTENTS.suggest(q, { tasks: allowedTasks(), items: ITEMS.filter(itemOpen), limit: 3 });
}
function showCommand(r, q) {
  cmdPending = null;
  if (r.kind === 'task') {
    const t = CMD_TASKS.getTask(r.task);
    if (!t) return showCommand({ kind: 'unknown' }, q);
    if (!taskAllowed(t.id)) {
      const sg = suggestionsFor(q);
      askOut(cmdHead('אי אפשר כאן', q) + `<p class="a-text">את הפעולה „${esc(t.label)}” אי אפשר לעשות כאן — היא אינה כלולה ברישיון או בהרשאה שלכם.</p>` +
        (sg.list.length ? '<p class="a-text">אפשר לבחור:</p>' + choicesHtml(sg.list) : ''));
      return;
    }
    cmdPending = { id: t.id, prefill: r.prefill || {} };
    const rows = CMD_TASKS.describe(t.id, cmdPending.prefill);
    const labels = (r.missing || []).map(k => CMD_TASKS.FIELDS[k] && CMD_TASKS.FIELDS[k].label).filter(Boolean);
    const unclear = (r.unclear || []).includes('amount') ? '<p class="a-text">לא הבנתי איזה סכום — ממלאים אותו בטופס.</p>' : '';
    const isBackup = t.action === 'backup';
    askOut(cmdHead('הבנתי', q) + `<p class="a-text"><b>${esc(t.label)}</b></p>` +
      (rows.length ? '<dl class="cmd-fields">' + rows.map(x => `<div style="display:contents"><dt>${esc(x.label)}</dt><dd>${esc(x.value)}</dd></div>`).join('') + '</dl>' : '') +
      unclear + (labels.length ? `<p class="a-text">את ה${esc(labels.join(' ואת ה'))} ממלאים בטופס.</p>` : '') +
      `<p class="a-text ask-small">${isBackup ? 'הגיבוי מתחיל רק אחרי שבוחרים סיסמה ומקום לשמירה.' : 'שום דבר עוד לא נשמר. הטופס ייפתח מלא — בודקים ולוחצים „שמירה”.'}</p>` +
      `<div class="cmd-actions"><button type="button" class="ss-btn ss-btn-primary" data-cmd-yes>${isBackup ? 'כן, לגבות' : 'כן, לפתוח את הטופס'}</button>` +
      '<button type="button" class="ss-btn ss-btn-secondary" data-cmd-no>לא, לתקן</button></div>');
    return;
  }
  if (r.kind === 'screen') {
    askOut(cmdHead('הבנתי', q) + '<p class="a-text">נראה שמחפשים את המסך הזה:</p>' + choicesHtml([{ type: 'screen', key: r.key }]));
    return;
  }
  if (r.kind === 'choose') {
    const list = r.options || [];
    askOut(cmdHead('התכוונת ל...?', q) + '<p class="a-text">יש כאן כמה אפשרויות. מה מתאים?</p>' + choicesHtml(list));
    if (cmdOptions.length) return;
  }
  // לא הובן — הצעות קרובות, או המשימות הנפוצות. בלי הודעת שגיאה
  const sg = suggestionsFor(q);
  askOut(cmdHead('התכוונת ל...?', q) + `<p class="a-text">${sg.guess ? 'לא בטוח שהבנתי. אפשר לכתוב במילים אחרות, למשל „לרשום תרומה”, או לבחור כאן:' : 'אולי התכוונתם לאחד מאלה:'}</p>` +
    choicesHtml(sg.list));
}
async function runCommandTask(p) {
  const t = p && CMD_TASKS.getTask(p.id);
  if (!t) return;
  if (t.action === 'backup') { askOut(''); runBackup(); return; }
  if (!window.shellAPI.startTask) { askOut(''); open(t.key); return; }
  try {
    const r = await window.shellAPI.startTask(t.id, p.prefill || {});
    if (r && r.ok) {
      askOut('');
      $('askQ').value = '';
      ui.active = 'econ'; ui.views.econ = t.view; mark(); pushRecent(t.key);
      return;
    }
    askOut(cmdHead('לא נפתח', t.label) + `<p class="a-text">${r && r.reason === 'not-allowed'
      ? 'הפעולה הזו אינה כלולה ברישיון או בהרשאה שלכם.' : 'לא הצלחתי לפתוח את הטופס עם הפרטים האלה. אפשר לפתוח אותו בלעדיהם:'}</p>` +
      choicesHtml([{ type: 'screen', key: t.key }]));
  } catch { askOut(''); open(t.key); }
}
$('askOut').addEventListener('click', (e) => {
  const yes = e.target.closest('[data-cmd-yes]');
  if (yes) { const p = cmdPending; cmdPending = null; runCommandTask(p); return; }
  if (e.target.closest('[data-cmd-no]')) { cmdPending = null; askOut(''); $('askQ').focus(); if ($('askQ').select) $('askQ').select(); return; }
  const opt = e.target.closest('[data-cmd-opt]');
  const o = opt ? cmdOptions[Number(opt.dataset.cmdOpt)] : null;
  if (!o) return;
  if (o.type === 'screen') { askOut(''); open(o.key); return; }
  showCommand({ kind: 'task', task: o.id, prefill: o.prefill || {}, missing: [] }, $('askQ').value || optionLabel(o));
});
// דיבור: רק ההכתבה של מערכת ההפעלה (Win+H / מיקרופון במקלדת) — הטקסט נכנס לתיבה כרגיל. אין זיהוי דיבור
// בתוכנה: זיהוי הדיבור של הדפדפן שולח את הקול לשרת חיצוני (כלל ברזל 6)
if (window.__ssBuildInfo) { $('voiceWin').hidden = true; $('voiceAndroid').hidden = false; }
$('askMic').onclick = () => {
  const show = $('askVoice').hidden;
  $('askVoice').hidden = !show;
  $('askMic').setAttribute('aria-expanded', String(show));
  $('askQ').focus();
};
// סוף פגישה (יציאה או ניתוק שקט): התשובה ונתוני מסך הבית של המשתמש הקודם לא נשארים גלויים
if (window.shellAPI.onSession) {
  window.shellAPI.onSession((on) => {
    if (on) { loadHome(); return; }
    askSeq++;
    cmdPending = null; taskAccess = null; loadTaskAccess();
    askOut('');
    $('askQ').value = '';
    $('askGo').disabled = false;
    homeData = null;
    if (!ui.active) { renderKpis(); renderToday(new Date()); }
  });
}

/* ---------- סיור קצר: 3 שלבים אחרי אשף ההתחלה ----------
   חלון מודאלי אחד על כל המסך (מיקוד נשאר בתוכו, Esc סוגר), עם "חור" סביב האזור שמוסבר. */
const TOUR_KEY = 'suite.tour';
const TOUR = (OB && OB.TOUR) || [];
function tourSeen() { try { return localStorage.getItem(TOUR_KEY) === 'done'; } catch { return true; } }
function startTour() {
  if (!TOUR.length) return;
  const dlg = $('tourDlg');
  let i = 0;
  const place = () => {
    const s = TOUR[i];
    $('tourStep').textContent = `שלב ${i + 1} מתוך ${TOUR.length}`;
    $('tourTitle').textContent = s.title;
    $('tourText').textContent = s.text;
    $('tourBack').hidden = i === 0;
    $('tourNext').textContent = i === TOUR.length - 1 ? 'סיום' : 'הבא';
    if (dlg.querySelectorAll) dlg.querySelectorAll('#tourDots i').forEach((d, n) => d.classList.toggle('on', n === i));
    const el = document.querySelector(s.sel);
    const r = el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    const W = window.innerWidth || 0, H = window.innerHeight || 0;
    if (!r || !W) return;
    const pad = 6, hole = $('tourHole').style, card = $('tourCard').style;
    hole.top = (r.top - pad) + 'px'; hole.left = (r.left - pad) + 'px';
    hole.width = (r.width + pad * 2) + 'px'; hole.height = (Math.min(r.height, H - 24) + pad * 2) + 'px';
    const cw = Math.min(340, W - 32), ch = 230;
    // ליד האזור: משמאל לסרגל (שבצד ימין), או מתחת לאזור במסך הבית
    const side = r.left > W / 2;
    const left = side ? r.left - cw - 20 : r.left + Math.max(0, (r.width - cw) / 2);
    const top = side ? Math.min(Math.max(16, r.top + 20), H - ch - 16) : Math.min(r.bottom + 18, H - ch - 16);
    card.left = Math.max(16, Math.min(left, W - cw - 16)) + 'px';
    card.top = Math.max(16, top) + 'px';
  };
  const done = () => {
    $('tourNext').onclick = $('tourBack').onclick = $('tourSkip').onclick = null; dlg.oncancel = null;
    try { localStorage.setItem(TOUR_KEY, 'done'); } catch { /* לא קריטי */ }
    if (dlg.open) closeDialog(dlg);
  };
  $('tourNext').onclick = () => { if (i < TOUR.length - 1) { i++; place(); $('tourNext').focus(); } else done(); };
  $('tourBack').onclick = () => { if (i > 0) { i--; place(); $('tourNext').focus(); } };
  $('tourSkip').onclick = done;
  dlg.oncancel = (e) => { e.preventDefault(); done(); };
  showDialog(dlg);
  place();
  $('tourNext').focus();
}

/* ---------- רישוי: מסך "מערכת מושבתת" ---------- */
function renderLicense() {
  const bar = $('licBar'), block = $('licBlock');
  if (lic.level === 'ok') {
    block.hidden = true;
    // תקופת ניסיון: הודעה במידע, ואזהרה בשבוע האחרון
    const t = lic.trial;
    bar.hidden = !t;
    if (t) {
      const left = Math.max(0, Number(t.daysLeft) || 0);
      bar.className = 'trial' + (t.warn ? ' warn' : '');
      bar.textContent = 'תקופת ניסיון — ' + (left === 1 ? 'נותר יום אחד' : 'נותרו ' + left + ' ימים') + (t.warn ? '. להמשך עבודה יש להתקין רישיון (רישוי ומערכות)' : '');
    }
    return;
  }
  const blocked = lic.level === 'blocked';
  bar.hidden = false;
  bar.className = blocked ? 'blocked' : '';
  bar.textContent = blocked ? lic.message : lic.message + ' — צפייה, ייצוא וגיבוי בלבד';
  block.hidden = false;
  block.className = 'lic-block' + (blocked ? '' : ' limited');
  block.innerHTML = `<h2>${IC ? svg(blocked ? 'lock' : 'pause') : (blocked ? '🔒' : '⏸')} ${esc(lic.message)}</h2>` +
    (blocked ? '<p>התוכנה אינה זמינה לעבודה כרגע.</p>' : `<p>אפשר לצפות בנתונים, לייצא ולגבות. ${lic.status === 'terminated' ? 'יצירה ועריכה אינן אפשריות עוד' : 'יצירה ועריכה חסומות עד ' + (lic.status === 'trial_ended' ? 'להתקנת רישיון' : 'לחידוש')}.</p>`) +
    '<p>הנתונים שלך שמורים במחשב ולא נמחקו. לחידוש הפעילות פנו לספק, או קלטו רישיון / עדכון סטטוס.</p>' +
    `<button type="button" class="lic-go" data-key="econ:licensing">${IC ? svg('key') : '🔑'} רישוי ומערכות</button>` +
    `<button type="button" class="lic-go" data-key="econ:messages">${IC ? svg('message') : '💬'} הודעה לספק</button>`;
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
  const t = st.trial && typeof st.trial === 'object' ? { daysLeft: Number(st.trial.daysLeft) || 0, warn: !!st.trial.warn } : null;
  lic = { level: st.level || 'ok', status: String(st.status || ''), message: String(st.message || ''), modules: st.modules || {}, trial: t };
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
loadHome();

window.shellAPI.onActive(id => {
  ui.active = id || null;
  if (!id) { renderHome(); loadHome(); }
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
// המיקוד חוזר בסגירה לרכיב שפתח את החלון (גם כשהחלון נסגר בקוד ולא ב-Esc)
function showDialog(dlg) {
  if (window.shellAPI.setOverlay) window.shellAPI.setOverlay(true);
  dlg.__ssReturn = document.activeElement || null;
  dlg.showModal();
}
function closeDialog(dlg) {
  dlg.close();
  const back = dlg.__ssReturn;
  dlg.__ssReturn = null;
  if (back && back.isConnected && typeof back.focus === 'function' && !document.querySelector('dialog[open]')) back.focus();
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
      if (!optional && v.length < 12) { err.textContent = 'הסיסמה חייבת להכיל לפחות 12 תווים'; return; }
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
  const r = await askPassphrase({ title: 'גיבוי מוצפן', text: 'בחר מה לגבות והזן סיסמה. לפחות 12 תווים — משפט קצר שקל לזכור טוב יותר ממילה מסובכת. בלי הסיסמה לא ניתן לשחזר את הקובץ.', scopes: true });
  if (r === null) return;
  try { await window.shellAPI.backupAll(r.pass, r.scope); }
  catch (e) { await ssDialog.alert(e.message || 'שגיאה בגיבוי', { title: 'הגיבוי לא הצליח' }); }
}
async function runRestore() {
  const r = await askPassphrase({ title: 'שחזור מגיבוי', text: 'אם הגיבוי מוצפן, הזן את סיסמת הגיבוי. גיבוי אוטומטי מהמחשב הזה — השאר ריק; ממחשב אחר — הזן את קוד השחזור (🔑).', optional: true });
  if (r === null) return;
  try { await window.shellAPI.restoreAll(r.pass); }
  catch (e) { await ssDialog.alert(e.message || 'שגיאה בשחזור', { title: 'השחזור לא הצליח' }); }
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
if ($('ds')) $('ds').onclick = openDisplaySettings;
$('guideOk').onclick = () => closeDialog($('guide'));
// דוח תקלה לתמיכה (PLAN.md 2.2) — נשמר מהתהליך הראשי, היומן בלבד
// אודות ומדריך המשתמש (PLAN.md 5.1, 1.6) — באנדרואיד הערוצים לא קיימים, והכפתורים מוסתרים
const ABOUT = { eula: 'הסכם הרישיון למשתמש', notices: 'רכיבי קוד פתוח' };
let aboutCache = null;
async function aboutData() {
  if (!aboutCache && window.shellAPI.getAbout) aboutCache = await window.shellAPI.getAbout().catch(() => null);
  return aboutCache;
}
async function showDoc(kind) {
  const a = await aboutData();
  if (!a) return;
  $('docTitle').textContent = ABOUT[kind];
  $('docText').textContent = a[kind] || 'הקובץ לא נמצא';
  showDialog($('docDlg'));
}
$('docOk').onclick = () => closeDialog($('docDlg'));
$('eulaBtn').onclick = () => showDoc('eula');
$('noticesBtn').onclick = () => showDoc('notices');
$('userGuideBtn').onclick = () => { if (window.shellAPI.openUserGuide) window.shellAPI.openUserGuide().catch(() => {}); };
$('userGuidePdfBtn').onclick = () => { if (window.shellAPI.saveUserGuidePdf) window.shellAPI.saveUserGuidePdf().catch(() => {}); };
if (!window.shellAPI.getAbout) for (const id of ['eulaBtn', 'noticesBtn', 'userGuideBtn', 'userGuidePdfBtn']) $(id).hidden = true;
aboutData().then(a => { if (a) $('aboutText').textContent = 'SuperSuite כלכלה גרסה ' + a.version + ' · © 2026 Bunim Seller. כל הזכויות שמורות. הנתונים נשמרים במחשב שלך בלבד.'; });
$('crashReportBtn').onclick = () => { if (window.shellAPI.saveCrashReport) window.shellAPI.saveCrashReport().catch(() => {}); };
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
$('qt').onclick = async () => {
  if (await ssDialog.confirm('לצאת מהמערכת ולסגור את החלון?', { okText: 'יציאה' })) window.shellAPI.quit();
};

$('tg').onclick = async () => {
  try {
    const t = await window.shellAPI.pickBackupTarget();
    if (t) { $('tgInfo').textContent = 'גיבוי אוטומטי ליעד: ' + t; obMarkDone('backup-target'); }
  } catch (e) { await ssDialog.alert(e.message || 'נדרשת כניסה למערכת כדי להגדיר יעד גיבוי'); }
};
// קוד שחזור: בלעדיו גיבוי אוטומטי נפתח רק במחשב שבו נוצר
async function showRecoveryCode() {
  const dlg = $('rkDlg');
  let code;
  // הקוד פותח את כל הגיבויים והמסד — רק אחרי הקלדה חוזרת של הסיסמה (גם אחרי כניסה עם Google; סקירת קוד 2.11.2026)
  const password = await ssDialog.prompt('כדי להציג את קוד השחזור, הקלידו שוב את הסיסמה שלכם (של המנהל המחובר):', '', { title: 'קוד שחזור', type: 'password', okText: 'הצג' });
  if (password == null) return;
  try { code = await window.shellAPI.getRecoveryCode(password); }
  catch (e) {
    // בלי הקידומת האנגלית של Electron — "הסיסמה שגויה" בעברית
    const msg = String((e && e.message) || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    await ssDialog.alert(msg || 'קוד השחזור מוצג למנהל בלבד — יש להיכנס כמנהל'); return;
  }
  $('rkCode').textContent = code;
  $('rkErr').textContent = '';
  const close = () => { dlg.oncancel = null; closeDialog(dlg); };
  $('rkClose').onclick = close;
  dlg.oncancel = (e) => { e.preventDefault(); close(); };
  // אין העתקה ללוח: הלוח נשמר בהיסטוריה של Windows ועלול להסתנכרן לענן, והקוד פותח את כל הנתונים — רושמים על נייר
  $('rkSaved').onclick = async () => {
    try { await window.shellAPI.recoveryCodeSaved(); } catch { /* לא קריטי */ }
    close();
    obMarkDone('recovery-code');
    targetShown = false;
    refreshTargetIfLoggedIn();
  };
  showDialog(dlg);
}
$('rk').onclick = showRecoveryCode;

// יעד הגיבוי תלוי בהרשאת גיבוי, ולכן לפני הכניסה אין מה לבקש אותו.
// שואלים קודם (בשקט) אם יש כניסה, ורק אז מבקשים את היעד — כדי לא לייצר חריגה בכל הפעלה.
// בכל מעבר לחלק הכספי מנסים שוב, עד שהמשתמש מתחבר והטקסט מתעדכן.
let targetShown = false;
async function refreshAdminFlag() {
  if (!window.shellAPI.isAdmin) return; // אנדרואיד
  try {
    if (!(await window.shellAPI.isLoggedIn())) return;
    const admin = (await window.shellAPI.isAdmin()) === true;
    if (admin !== shellAdmin) { shellAdmin = admin; if (!ui.active) renderHome(); }
  } catch { /* נעדכן במעבר הבא */ }
}
async function refreshTargetIfLoggedIn() {
  refreshAdminFlag();
  if (targetShown) return;
  try {
    if (!(await window.shellAPI.isLoggedIn())) return;
    const t = await window.shellAPI.getBackupTarget();
    targetShown = true;
    $('tgInfo').textContent = t ? 'גיבוי אוטומטי ליעד: ' + t : 'גיבוי אוטומטי: תיקיית המסמכים';
    // סטטוס הגיבוי האחרון: כשל שקט (אין הצפנת מערכת / כונן מנותק) חייב להיות גלוי למשתמש
    const st = window.shellAPI.getBackupStatus ? await window.shellAPI.getBackupStatus() : '';
    if (st) $('tgInfo').textContent += ' · ' + st;
    refreshPlainBackups();
  } catch { /* נעדכן במעבר הבא */ }
}

// גיבויים ישנים לא מוצפנים בתיקיית הגיבוי (PLAN.md 3.6): אזהרה מתחת לסטטוס, ולחיצה פותחת את הרשימה.
// בלי הרשאת גיבוי (או באנדרואיד, שאין בו תיקיית גיבוי) — אין אזהרה
async function refreshPlainBackups() {
  const btn = $('tgWarn');
  let r = null;
  try { r = window.shellAPI.plainBackups ? await window.shellAPI.plainBackups() : null; } catch { r = null; }
  btn.hidden = !(r && r.files.length);
  if (r && r.files.length) btn.textContent = r.warning + ' — לטיפול';
  return r;
}
async function showPlainBackups() {
  const dlg = $('pbDlg');
  const render = async () => {
    const r = await refreshPlainBackups();
    const files = (r && r.files) || [];
    $('pbDir').textContent = r ? r.dir : '';
    const list = $('pbList');
    list.textContent = '';
    for (const f of files) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = f.name;
      name.dir = 'ltr';
      li.appendChild(name);
      // גיבוי של מודול האימונים (עבר ל-SuperSuite לימוד) — נתוני בריאות של מתאמנים
      if (f.trainer) {
        const tag = document.createElement('small');
        tag.className = 'pb-tag';
        tag.textContent = 'נתוני אימונים ובריאות';
        li.appendChild(tag);
      }
      if (r.canEncrypt) li.appendChild(actionBtn('הצפן', () => window.shellAPI.plainBackupEncrypt(f.name)));
      li.appendChild(actionBtn('מחק', async () => {
        if (!(await ssDialog.confirm(`למחוק את ${f.name}?\nהקובץ יימחק לצמיתות.`, { danger: true, okText: 'מחיקה' }))) return null;
        return window.shellAPI.plainBackupDelete(f.name);
      }));
      list.appendChild(li);
    }
    $('pbAll').hidden = !r || !r.canEncrypt || files.length < 2;
    $('pbTrainer').hidden = !files.some(f => f.trainer);
    if (!files.length) { $('pbErr').textContent = ''; close(); }
    else if (r && !r.canEncrypt) $('pbErr').textContent = 'הצפנת Windows אינה זמינה בחשבון הזה — אפשר רק למחוק.';
    return files;
  };
  // פעולה על קובץ: שגיאה מוצגת בחלון, ואחריה הרשימה נטענת מחדש מהדיסק
  const actionBtn = (label, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = async () => {
      $('pbErr').textContent = '';
      try { await fn(); } catch (e) { $('pbErr').textContent = e.message || 'הפעולה נכשלה'; }
      await render();
    };
    return b;
  };
  const close = () => { dlg.oncancel = null; if (dlg.open) closeDialog(dlg); };
  $('pbClose').onclick = close;
  dlg.oncancel = (e) => { e.preventDefault(); close(); };
  $('pbAll').onclick = async () => {
    $('pbErr').textContent = '';
    const errs = [];
    for (const name of [...$('pbList').querySelectorAll('li span')].map(s => s.textContent)) {
      try { await window.shellAPI.plainBackupEncrypt(name); } catch (e) { errs.push(`${name}: ${e.message}`); }
    }
    await render();
    if (errs.length) $('pbErr').textContent = errs.join(' · ');
  };
  $('pbErr').textContent = '';
  showDialog(dlg);
  await render();
}
$('tgWarn').onclick = showPlainBackups;
window.shellAPI.onActive(id => { if (id === 'econ') refreshTargetIfLoggedIn(); else if (!id) refreshAdminFlag(); });

// פקודות מקלדת שמטופלות במעטפת (F1, Ctrl+K, Ctrl+Shift+B/R)
window.shellAPI.onCmd(cmd => {
  if (cmd === 'help') showGuide();
  if (cmd === 'search') focusSearch();
  if (cmd === 'backup') runBackup();
  if (cmd === 'restore') runRestore();
  if (cmd === 'a11y') openA11y();
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
  const t = (icon, label, time) => `<span>${svg(icon)}${esc(label)}<b>${HC.formatTime(time)}</b></span>`;
  $('day').innerHTML =
    `<div class="day-t">${svg('calendar')}לוח עברי · ${esc(cal.cityObj.name)}</div>` +
    (chips ? `<div class="chips">${chips}</div>` : '') +
    `<div class="zm">${t('sun', 'זריחה', z.sunrise)}${t('sunset', 'שקיעה', z.sunset)}${t('star', 'צאת הכוכבים', z.tzeit)}</div>` +
    (next ? `<div class="shab"><div class="day-t">${svg('candle')}${esc(next.name)} הקרובה</div>` +
      `<div class="zm big">${t('candle', 'הדלקת נרות', next.candles)}${t('moon', 'צאת ' + (next.name.startsWith('שבת') ? 'השבת' : 'החג'), next.tzeit)}${t('star', 'ר"ת', next.tzeitRT)}</div></div>` : '') +
    `<button class="day-set" id="calSet" type="button" title="הגדרות לוח ושבת" aria-label="הגדרות לוח ושבת">${IC ? svg('sliders') : '⚙'}</button>`;
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

/* ---------- תצוגה (PLAN.md 7.4): ערכה, צבע הדגשה, צפיפות, טקסט, פינות, ניגודיות, תנועה ----------
   ההגדרות נשמרות בתהליך הראשי ומגיעות לכל המסכים דרך display-preload.js. כאן — החלון, עם תצוגה מקדימה במעטפת */
const DSP = window.SUITE_DISPLAY;
let display = DSP ? { ...DSP.DEFAULTS } : null;
const DS_LABELS = { theme: 'ערכת צבע', accent: 'צבע הדגשה', density: 'צפיפות', text: 'גודל טקסט', shape: 'פינות', contrast: 'ניגודיות', motion: 'אנימציות ותנועה',
  simple: 'מצב פשוט', targets: 'גודל כפתורים', links: 'קישורים', font: 'גופן' };
const DS_ICONS = IC ? { classic: svg('building'), night: svg('moon'), office: svg('chart-bar'), easy: svg('search'), calm: svg('leaf'), access: svg('access') }
  : { classic: '🏛', night: '🌙', office: '📊', easy: '🔍', calm: '🌿', access: '♿' };
// צבע הנקודה ליד כל צבע הדגשה — מתוך שפת העיצוב, דרך המאפיין עצמו
const dsPreview = (s) => DSP.applyTo(document, DSP.attrsFor(s, systemDark()));
async function loadDisplay() {
  if (!DSP || !window.shellAPI.getDisplay) { for (const id of ['ds', 'a11yBtn']) { const b = $(id); if (b) b.hidden = true; } return; }
  try { display = DSP.sanitize(await window.shellAPI.getDisplay()); } catch { /* נשאר ברירת המחדל */ }
  applyA11yState();
  maybeAskA11y();
}
// מצב פשוט: הסרגל ומסך הבית נבנים מחדש לפי ההגדרות
function applyA11yState() {
  const simple = !!(display && display.simple === 'on');
  if (simple !== ui.simple) { ui.simple = simple; ui.simpleAll = false; ui.navMore = false; }
  renderNav();
  if (!ui.active) renderHome();
}

/* ---------- חלון "♿ נגישות" (סבב 4): מתגים גדולים, כל שינוי נשמר מיד ופועל בכל המסכים ---------- */
const A11Y_SWITCHES = [
  { k: 'simple', on: 'on', off: 'off', name: 'מצב פשוט', desc: 'רק הפעולות הנפוצות, משימות גדולות במסך הבית וכפתורים גדולים' },
  { k: 'contrast', on: 'high', off: 'normal', name: 'ניגודיות גבוהה', desc: 'טקסט וקווים כהים וחזקים יותר' },
  { k: 'motion', on: 'reduced', off: 'normal', name: 'עצירת אנימציות', desc: 'בלי תנועה ומעברים במסך' },
  { k: 'targets', on: 'large', off: 'normal', name: 'כפתורים גדולים', desc: 'קל יותר ללחוץ — גם במסך מגע' },
  { k: 'links', on: 'underline', off: 'normal', name: 'קו תחתון לקישורים', desc: 'רואים מיד מה אפשר ללחוץ' },
  { k: 'font', on: 'readable', off: 'normal', name: 'גופן קריא', desc: 'אותיות פשוטות ורווחים גדולים בין אותיות ושורות' },
  { k: 'theme', on: 'dark', off: 'light', name: 'רקע כהה', desc: 'נוח לעיניים בערב ובתאורה חלשה' },
];
const A11Y_SIZES = ['sm', 'md', 'lg', 'xl', 'xxl'];
function a11yAnnounce(text) {
  const live = $('a11yLive');
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 50);
}
async function saveA11y(patch, announce) {
  if (!DSP || !window.shellAPI.saveDisplay) return;
  const next = DSP.sanitize({ ...display, ...patch });
  try { display = DSP.sanitize(await window.shellAPI.saveDisplay(next)); } catch { display = next; }
  dsPreview(display);
  applyA11yState();
  if (announce) a11yAnnounce(announce);
}
const systemDark = () => { try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; } };
function renderA11y() {
  const sizeName = (id) => (DSP.OPTIONS.text.find(o => o.id === id) || {}).name || id;
  const sw = A11Y_SWITCHES.map(o => {
    const on = display[o.k] === o.on || (o.k === 'theme' && display.theme === 'system' && systemDark());
    return `<div class="a11y-row"><span><b id="a11y-${o.k}">${esc(o.name)}</b><small id="a11y-${o.k}-d">${esc(o.desc)}</small></span>` +
      `<button type="button" class="a11y-sw" role="switch" aria-checked="${on}" aria-labelledby="a11y-${o.k}" aria-describedby="a11y-${o.k}-d" data-a11y="${o.k}">${on ? 'פועל' : 'כבוי'}</button></div>`;
  });
  const sizes = '<div class="a11y-row"><span><b id="a11y-text">גודל הטקסט</b><small>חמישה גדלים — מהקטן ועד הענק</small></span>' +
    `<div class="a11y-sizes" role="group" aria-labelledby="a11y-text">${A11Y_SIZES.map(id =>
      `<button type="button" data-size="${id}" aria-pressed="${display.text === id}" aria-label="א — ${esc(sizeName(id))}" title="${esc(sizeName(id))}">א</button>`).join('')}</div></div>`;
  $('a11yOpts').innerHTML = sw[0] + sizes + sw.slice(1).join('');
}
function openA11y() {
  if (!DSP || !display) return;
  const dlg = $('a11yDlg');
  if (dlg.open) return;
  renderA11y();
  const done = () => { dlg.oncancel = null; closeDialog(dlg); };
  $('a11yOpts').onclick = async (e) => {
    const b = e.target.closest('[data-a11y], [data-size]');
    if (!b) return;
    let patch, msg;
    if (b.dataset.size) {
      patch = { text: b.dataset.size };
      msg = 'גודל הטקסט: ' + ((DSP.OPTIONS.text.find(o => o.id === b.dataset.size) || {}).name || '');
    } else {
      const o = A11Y_SWITCHES.find(x => x.k === b.dataset.a11y);
      if (!o) return;
      const turnOn = b.getAttribute('aria-checked') !== 'true';
      patch = { [o.k]: turnOn ? o.on : o.off };
      msg = o.name + ': ' + (turnOn ? 'פועל' : 'כבוי');
    }
    const focusKey = b.dataset.size ? `[data-size="${b.dataset.size}"]` : `[data-a11y="${b.dataset.a11y}"]`;
    await saveA11y(patch, msg);
    renderA11y();
    const again = $('a11yOpts').querySelector(focusKey);
    if (again) again.focus();
  };
  $('a11yDone').onclick = done;
  $('a11yAll').onclick = async () => { await saveA11y({ ...DSP.A11Y_FULL }, 'כל הגדרות הנגישות פועלות'); renderA11y(); };
  $('a11yReset').onclick = async () => { await saveA11y(DSP.resetA11y(display), 'חזרה למצב הרגיל'); renderA11y(); };
  dlg.oncancel = (e) => { e.preventDefault(); done(); };
  showDialog(dlg);
  const first = $('a11yOpts').querySelector('button');
  if (first) first.focus();
}
if ($('a11yBtn')) $('a11yBtn').onclick = openA11y;

// שאלה אחת בהפעלה הראשונה: "רוצה שהתוכנה תהיה פשוטה יותר וגדולה יותר?" — רק כשכל הגדרות הנגישות רגילות,
// לא במצב שבת, ופעם אחת (התשובה נשמרת ב-localStorage של המעטפת)
const A11Y_ASKED_KEY = 'suite.a11yAsked';
function maybeAskA11y() {
  let asked = true;
  try { asked = !!localStorage.getItem(A11Y_ASKED_KEY); } catch { /* אין אחסון — לא שואלים */ }
  if (asked || shabbatOn || !DSP.isPlain(display)) return;
  const dlg = $('a11yAsk');
  if (dlg.open || document.querySelector('dialog[open]')) return;
  const answer = async (what) => {
    try { localStorage.setItem(A11Y_ASKED_KEY, what); } catch { /* בפעם הבאה נשאל שוב */ }
    $('a11yAskYes').onclick = $('a11yAskNo').onclick = $('a11yAskPick').onclick = null;
    dlg.oncancel = null;
    closeDialog(dlg);
    if (what === 'yes') await saveA11y({ ...DSP.A11Y_EASY }, 'מצב פשוט וטקסט גדול — פועלים');
    if (what === 'pick') openA11y();
  };
  $('a11yAskYes').onclick = () => answer('yes');
  $('a11yAskNo').onclick = () => answer('no');
  $('a11yAskPick').onclick = () => answer('pick');
  dlg.oncancel = (e) => { e.preventDefault(); answer('no'); };
  showDialog(dlg);
  $('a11yAskYes').focus();
}
function openDisplaySettings() {
  const dlg = $('dsDlg');
  let cur = { ...display };
  const render = () => {
    const presetOf = DSP.PRESETS.find(p => DSP.KEYS.every(k => DSP.applyPreset(p.id)[k] === cur[k]));
    $('dsPresets').innerHTML = DSP.PRESETS.map(p => `<button type="button" data-preset="${esc(p.id)}" aria-pressed="${presetOf && presetOf.id === p.id}"><b>${DS_ICONS[p.id] || ''} ${esc(p.name)}</b><small>${esc(p.desc)}</small></button>`).join('');
    $('dsGroups').innerHTML = DSP.KEYS.map(k => `<div class="ds-group" role="group" aria-label="${esc(DS_LABELS[k])}"><span>${esc(DS_LABELS[k])}</span><div class="ds-seg">${DSP.OPTIONS[k].map(o =>
      `<button type="button" data-k="${esc(k)}" data-v="${esc(o.id)}" aria-pressed="${cur[k] === o.id}"${o.desc ? ` title="${esc(o.desc)}"` : ''}>${k === 'accent' ? `<i data-ss-swatch="${esc(o.id)}"></i>` : ''}${esc(o.name)}</button>`).join('')}</div></div>`).join('');
    document.querySelectorAll('#dsPresets [data-preset]').forEach(b => b.onclick = () => { cur = DSP.applyPreset(b.dataset.preset); dsPreview(cur); render(); });
    document.querySelectorAll('#dsGroups [data-k]').forEach(b => b.onclick = () => { cur = DSP.sanitize({ ...cur, [b.dataset.k]: b.dataset.v }); dsPreview(cur); render(); });
  };
  const done = (keep) => {
    $('dsSave').onclick = $('dsCancel').onclick = $('dsReset').onclick = null; dlg.oncancel = null;
    if (!keep) dsPreview(display);
    closeDialog(dlg);
  };
  $('dsSave').onclick = async () => {
    try { display = DSP.sanitize(await window.shellAPI.saveDisplay(cur)); } catch { display = cur; }
    done(true);
  };
  $('dsCancel').onclick = () => done(false);
  $('dsReset').onclick = () => { cur = { ...DSP.DEFAULTS }; dsPreview(cur); render(); };
  dlg.oncancel = (e) => { e.preventDefault(); done(false); };
  render();
  showDialog(dlg);
}
loadDisplay();
setInterval(() => {
  tickShabbat();
  if (ui.active) return;
  const now = Date.now();
  if (homeStampAt(now) === homeStamp) { renderDay(now); return; }
  // יום אזרחי חדש — גם הנתונים ("היום", יארצייטים) מהשרת
  const newDay = homeStamp.split('|').slice(1, 4).join('|') !== homeStampAt(now).split('|').slice(1, 4).join('|');
  renderHome();
  if (newDay) loadHome();
}, 60000);
