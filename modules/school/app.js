// מודול ניהול מוסד — הממשק. כל טקסט של משתמש נכנס דרך textContent (h()), בלי innerHTML.
(function () {
  'use strict';
  const L = window.SchoolLogic;
  const UI_KEY = 'school:ui';
  const $ = id => document.getElementById(id);

  // ---------- מצב ----------
  // stored — מה שיש עכשיו באחסון (מפתח ← JSON), כדי לכתוב רק מפתחות שהשתנו (הנתונים מפוצלים — L.splitData)
  let stored = {};
  let data = load();
  const ui = Object.assign({
    tab: 'dash', q: '', classFilter: '', statusFilter: 'active', specialOnly: false,
    attDay: L.localDay(), attClass: '', attSlot: '', attMonth: L.localDay().slice(0, 7),
    gClass: '', gTerm: '', gView: 'tests', gAssess: '', gStudent: '',
    tView: 'accounts', tClass: '', tq: '', year: ''
  }, loadUi());

  function readStored() {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (L.isDataKey(k)) o[k] = localStorage.getItem(k);
    }
    return o;
  }
  function load() {
    let d;
    try { stored = readStored(); d = L.joinData(stored); } catch (e) { stored = {}; return L.emptyData(); }
    // המבנה הישן (מפתח אחד) — המרה למפתחות המפוצלים. בלי הרשאת כתיבה (צופה) — נשאר כמו שהוא, וננסה שוב בפתיחה הבאה
    if (Object.prototype.hasOwnProperty.call(stored, L.LEGACY_KEY)) { try { persist(d); } catch (e) { /* קריאה בלבד */ } }
    return d;
  }
  // כתיבה עקבית של כמה מפתחות: קודם התשלומים, המבחנים והנוכחות, אחר כך school:core (עם מונה הקבלות), ובסוף
  // מחיקת מפתחות שהתרוקנו ושל המבנה הישן. כשל באמצע ← מה שכבר נכתב חוזר לערך הקודם, והשגיאה נזרקת.
  // המרה מהמבנה הישן שנכשלה על מכסה (f4): באנדרואיד ובלי הצפנת Windows הנתונים ב-localStorage של הדפדפן,
  // שהמכסה שלו לכל המקור — ושני עותקים מלאים (school:data והמפתחות החדשים) לא נכנסים בו. אז ניסיון שני:
  // קודם מחיקת school:data (הנתונים בזיכרון), ואז הכתיבה; כשל ← המפתחות החדשים נמחקים ו-school:data חוזר
  function persist(d) {
    const next = L.splitData(d);
    const ops = [];
    for (const k of Object.keys(next)) if (stored[k] !== next[k] && k !== L.STORAGE_KEY) ops.push([k, next[k]]);
    if (stored[L.STORAGE_KEY] !== next[L.STORAGE_KEY]) ops.push([L.STORAGE_KEY, next[L.STORAGE_KEY]]);
    for (const k of Object.keys(stored)) if (!(k in next) && k !== L.LEGACY_KEY) ops.push([k, null]);
    const legacy = L.LEGACY_KEY in stored;
    try {
      runOps(legacy ? ops.concat([[L.LEGACY_KEY, null]]) : ops);
    } catch (e) {
      if (!legacy || !e || e.name !== 'QuotaExceededError') throw e;
      runOps([[L.LEGACY_KEY, null]].concat(ops));
    }
    stored = next;
  }
  function runOps(ops) {
    const done = [];
    try {
      for (const [k, v] of ops) {
        if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
        done.push(k);
      }
    } catch (e) {
      for (const k of done.reverse()) {
        try { if (stored[k] === undefined) localStorage.removeItem(k); else localStorage.setItem(k, stored[k]); } catch (e2) { /* הטעינה הבאה מתקנת (המונה = הגבוה ביותר) */ }
      }
      throw e;
    }
  }
  // הרשאות הפגישה (מהמעטפת: secure-store:load בשולחן העבודה, frame.js באנדרואיד). בלי מידע — אין ייצוא ואין מחיקה
  function perms() {
    const p = window.ssModulePerms;
    return { exp: !!(p && p.export === true), del: !!(p && p.delete === true), user: p && typeof p.user === 'string' ? p.user.slice(0, 80) : '' };
  }
  const denyExport = () => ssDialog.alert('לתפקיד שלך אין הרשאת ייצוא נתונים. אפשר לבקש ממנהל המערכת.', { title: 'ייצוא' });
  const denyDelete = () => ssDialog.alert('לתפקיד שלך אין הרשאת מחיקה וביטול. אפשר לבקש ממנהל המערכת.', { title: 'אין הרשאה' });
  function loadUi() {
    try {
      const v = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
      const out = {};
      if (v && typeof v === 'object') {
        if (typeof v.tab === 'string' && /^[a-z]{2,12}$/.test(v.tab)) out.tab = v.tab;
        if (typeof v.statusFilter === 'string' && /^(active|left|all)$/.test(v.statusFilter)) out.statusFilter = v.statusFilter;
      }
      return out;
    } catch (e) { return {}; }
  }
  function saveUi() {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ tab: ui.tab, statusFilter: ui.statusFilter })); } catch (e) { /* העדפת תצוגה בלבד */ }
  }
  function saveErrorText(e) {
    const n = e && e.name;
    if (n === 'QuotaExceededError') return 'אין מספיק מקום לשמירת הנתונים. מחקו נתונים ישנים ונסו שוב.';
    if (n === 'SecurityError') return 'השמירה נדחתה — ייתכן שאין כניסה פעילה, הרשאת עריכה או רישיון פעיל.';
    return 'השמירה נכשלה. הנתונים לא נשמרו.';
  }
  // שינוי נתונים: הפעולה רצה, ואם השמירה נכשלה — חזרה למצב הקודם והודעה בעברית
  function commit(fn, { render: doRender = true } = {}) {
    const before = JSON.stringify(data);
    let result;
    try { result = fn(data); } catch (e) {
      data = L.normalizeData(before);
      ssDialog.alert(e && e.message ? e.message : 'הפעולה נכשלה', { title: 'שגיאה' });
      return { ok: false };
    }
    try { persist(data); } catch (e) {
      data = L.normalizeData(before);
      ssDialog.alert(saveErrorText(e), { title: 'לא נשמר' });
      if (doRender) render();
      return { ok: false };
    }
    if (doRender) render();
    return { ok: true, result };
  }

  // ---------- עזרי DOM ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const k of Object.keys(props)) {
      const v = props[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const btn = (text, onclick, cls = 'ss-btn', extra = {}) => h('button', Object.assign({ type: 'button', class: cls, onclick }, extra), text);
  const badge = (text, kind = '') => h('span', { class: 'ss-badge' + (kind ? ' ss-badge-' + kind : '') }, text);
  const money = ag => h('span', { class: 'sc-num' }, L.fmtMoney(ag));
  const card = (title, actions, ...body) => h('section', { class: 'ss-card' },
    title ? h('div', { class: 'sc-card-head' }, h('h2', { text: title }), actions ? h('div', { class: 'ss-actions' }, actions) : null) : null, ...body);
  const empty = text => h('div', { class: 'ss-empty' }, text);
  const table = (head, rows, cls = '') => h('div', { class: 'ss-scroll' },
    h('table', { class: 'ss-table ' + cls }, h('thead', null, h('tr', null, head.map(x => typeof x === 'string' ? h('th', { scope: 'col', text: x }) : x))), h('tbody', null, rows)));
  const numTh = t => h('th', { scope: 'col', class: 'ss-num', text: t });
  const numTd = (v, cls = '') => h('td', { class: 'ss-num ' + cls }, v);
  let uid = 0;
  const fid = () => 'f' + (++uid);
  // הודעה קופצת: 6 שניות לפחות (ארוכה — יותר). עם undo — 10 שניות וכפתור "ביטול". שגיאות — ssDialog.alert (נשארות)
  let undoFn = null;
  // הודעה שנעלמה מתרוקנת: כפתור "ביטול" / "סגירה" שקוף לא נשאר בסדר ה-Tab ולא נקרא בקורא מסך
  function hideToast() { clearTimeout(toast.tm); undoFn = null; const t = $('toast'); t.classList.remove('on'); t.classList.remove('sc-toast-action'); t.textContent = ''; }
  function toast(msg, undo) {
    const t = $('toast');
    clearTimeout(toast.tm);
    undoFn = typeof undo === 'function' ? undo : null;
    t.textContent = msg;
    const fn = undoFn;
    // כפתור של הודעה קודמת לא מפעיל ביטול של פעולה אחרת
    if (fn) t.append(btn('ביטול', () => { if (undoFn !== fn) return; hideToast(); fn(); }, 'ss-btn ss-btn-sm'));
    t.classList.add('on');
    if (undoFn) t.classList.add('sc-toast-action'); else t.classList.remove('sc-toast-action');
    toast.tm = setTimeout(hideToast, undoFn ? 10000 : Math.max(6000, String(msg).length * 90));
  }
  // שינוי שאפשר לבטל ב-10 השניות הבאות (מחיקה, ניקוי יום, "כולם נוכחים"): הנתונים שלפני נשמרים בזיכרון.
  // הביטול רק אם לא היה שינוי אחר מאז — אחרת הוא היה מוחק גם אותו (ומונה הקבלות לא חוזר אחורה)
  function commitUndo(fn, msg) {
    const before = JSON.stringify(data);
    const r = commit(fn);
    if (!r.ok) return r;
    const after = JSON.stringify(data);
    const text = typeof msg === 'function' ? msg(r.result) : msg;
    if (!text) return r;
    toast(text, () => {
      if (JSON.stringify(data) !== after) { ssDialog.alert('אי אפשר לבטל: היו שינויים נוספים מאז.', { title: 'ביטול' }); return; }
      const u = commit(d => { const prev = L.normalizeData(before); for (const k of Object.keys(d)) delete d[k]; Object.assign(d, prev); });
      if (u.ok) toast('בוטל — הנתונים חזרו כמו שהיו');
    });
    return r;
  }
  const pctText = p => (p === null || p === undefined ? '—' : p + '%');
  function pctBar(p, low) {
    const v = p === null ? 0 : Math.max(0, Math.min(100, p));
    const bar = h('div', { class: 'sc-bar' + (p !== null && p < low ? ' is-low' : ''), role: 'img', 'aria-label': 'נוכחות ' + pctText(p) }, h('i'));
    bar.firstChild.style.width = v + '%';
    return bar;
  }
  function fmtDay(d) {
    if (!L.isDay(d)) return '';
    const [y, m, dd] = d.split('-');
    return `${dd}.${m}.${y}`;
  }
  const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const hebrewDate = L.hebrewDate;

  // מינוח לפי סוג המוסד
  const terms = () => L.termsFor(data.settings.type);
  const isKollel = () => data.settings.type === 'kollel';
  const lowPct = () => (isKollel() ? data.settings.kollelMinPct : data.settings.lowAttendancePct);
  const classOptions = (sel, allLabel) => [allLabel !== undefined ? h('option', { value: '', text: allLabel }) : null,
    ...data.classes.map(c => h('option', { value: c.id, text: c.name, selected: c.id === sel }))];
  const studentById = id => data.students.find(s => s.id === id);
  // שנת לימודים לצפייה (שכר לימוד וציונים): הנוכחית, או שנה קודמת לקריאה בלבד
  const viewYear = () => L.yearInfo(data, ui.year) || L.yearInfo(data, data.yearId);
  const viewingCurrent = () => viewYear().id === data.yearId;
  const yearLabel = y => (y.name || 'ללא שם') + (y.current ? ' (נוכחית)' : '');
  function yearSelect() {
    if (!data.years.length) return null;
    const cur = viewYear().id;
    const sel = h('select', { class: 'ss-input', 'aria-label': 'שנת לימודים', onchange: e => { ui.year = e.target.value === data.yearId ? '' : e.target.value; ui.gAssess = ''; render(); } },
      L.yearsList(data).map(y => h('option', { value: y.id, text: yearLabel(y), selected: y.id === cur })));
    sel.style.width = 'auto';
    return sel;
  }
  const teacherName = id => { const t = data.teachers.find(x => x.id === id); return t ? t.name : ''; };

  // ---------- תפריט "עוד" (details) ----------
  // נסגר ב-Escape (המיקוד חוזר לכפתור התפריט) ובלחיצה מחוץ לו — כמו תפריט רגיל
  function moreMenu(label, ...items) {
    const sum = h('summary', { class: 'ss-btn ss-btn-sm' }, label);
    const d = h('details', { class: 'sc-more' }, sum, ...items);
    d.addEventListener('keydown', e => { if (e.key === 'Escape' && d.open) { e.preventDefault(); d.open = false; sum.focus(); } });
    return d;
  }
  const inside = (box, node) => { for (let n = node; n; n = n.parentNode) if (n === box) return true; return false; };
  document.body.addEventListener('click', e => {
    for (const d of document.body.querySelectorAll('details.sc-more')) if (d.open && !inside(d, e.target)) d.open = false;
  });

  // ---------- חלון טופס (dialog) ----------
  let dlgResolve = null;
  function closeDlg(value) {
    const d = $('dlg');
    if (d.open) d.close();
    const r = dlgResolve; dlgResolve = null;
    if (r) r(value);
  }
  $('dlgClose').addEventListener('click', () => closeDlg(null));
  $('dlg').addEventListener('cancel', e => { e.preventDefault(); closeDlg(null); });

  function openDlg(title, bodyNodes, footNodes) {
    if (dlgResolve) closeDlg(null);
    $('dlgTitle').textContent = title;
    $('dlgBody').replaceChildren(...bodyNodes);
    $('dlgFoot').replaceChildren(...footNodes);
    const d = $('dlg');
    try { d.showModal(); } catch (e) { d.setAttribute('open', ''); }
    return new Promise(res => { dlgResolve = res; });
  }

  // fields: [{ name, label, type, value, options, required, wide, hint, placeholder, more, openWhen }]
  // more — בתוך "פרטים נוספים" המקופל; openWhen: [שדה, ערך] — נפתח כשהשדה מקבל את הערך (למשל המחאה)
  // validate(values) ← מחרוזת שגיאה או null. מחזיר ערכים או null
  function formDialog(title, fields, { submitText = 'שמירה', validate, extra } = {}) {
    const inputs = {};
    const mainGrid = h('div', { class: 'ss-form-grid' });
    let moreBox = null, moreGrid = null;
    let grid = mainGrid;
    for (const f of fields) {
      if (f.more && !moreGrid) {
        moreGrid = h('div', { class: 'ss-form-grid' });
        moreBox = h('details', { class: 'ss-wide sc-more-fields' }, h('summary', { class: 'ss-label', text: 'פרטים נוספים' }), moreGrid);
      }
      grid = f.more ? moreGrid : mainGrid;
      if (f.type === 'section') { grid.append(h('h4', { class: 'ss-section-title ss-wide', text: f.label })); continue; }
      const id = fid();
      let input;
      if (f.type === 'select') {
        input = h('select', { id, class: 'ss-input' }, f.options.map(o => h('option', { value: o.value, text: o.label, selected: String(o.value) === String(f.value ?? '') })));
      } else if (f.type === 'textarea') {
        input = h('textarea', { id, class: 'ss-input', value: f.value || '', maxlength: f.max || 1000 });
      } else if (f.type === 'checkbox') {
        input = h('input', { id, type: 'checkbox', checked: !!f.value });
        inputs[f.name] = input;
        grid.append(h('div', { class: 'ss-field' + (f.wide ? ' ss-wide' : '') }, h('label', { class: 'ss-check', for: id }, input, f.label), f.hint ? h('p', { class: 'ss-hint', text: f.hint }) : null));
        continue;
      } else {
        input = h('input', { id, class: 'ss-input', type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder, maxlength: f.max || 200, inputmode: f.inputmode, min: f.min, max: f.maxNum, step: f.step });
      }
      inputs[f.name] = input;
      grid.append(h('div', { class: 'ss-field' + (f.wide || f.type === 'textarea' ? ' ss-wide' : '') },
        h('label', { class: 'ss-label', for: id, text: f.label + (f.required ? ' *' : '') }), input, f.hint ? h('p', { class: 'ss-hint', text: f.hint }) : null));
    }
    grid = mainGrid;
    if (moreBox) {
      grid.append(moreBox);
      for (const f of fields) {
        if (!f.openWhen || !inputs[f.openWhen[0]]) continue;
        const src = inputs[f.openWhen[0]];
        const sync = () => { if (String(src.value) === String(f.openWhen[1])) moreBox.open = true; };
        src.addEventListener('change', sync);
        sync();
      }
    }
    const err = h('div', { class: 'sc-err', role: 'alert' });
    const read = () => {
      const v = {};
      for (const f of fields) {
        if (!inputs[f.name]) continue;
        v[f.name] = f.type === 'checkbox' ? inputs[f.name].checked : String(inputs[f.name].value).trim();
      }
      return v;
    };
    const submit = () => {
      const v = read();
      for (const f of fields) if (f.required && inputs[f.name] && !v[f.name]) { if (f.more && moreBox) moreBox.open = true; err.textContent = `יש למלא: ${f.label}`; inputs[f.name].focus(); return; }
      const msg = validate ? validate(v) : null;
      if (msg) { err.textContent = msg; for (const f of fields) if (f.openWhen && moreBox && String(v[f.openWhen[0]]) === String(f.openWhen[1])) moreBox.open = true; return; }
      closeDlg(v);
    };
    grid.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submit(); } });
    const p = openDlg(title, [grid, extra || null, err].filter(Boolean),
      [btn(submitText, submit, 'ss-btn-primary'), btn('ביטול', () => closeDlg(null))]);
    const first = fields.find(f => inputs[f.name]);
    if (first) setTimeout(() => inputs[first.name].focus(), 30);
    return p;
  }

  // ---------- הדפסה ----------
  // מסמך מודפס תמיד בערכה הבהירה (f170: בערכה הכהה הטקסט הבהיר יצא כמעט לבן על הנייר)
  function printNode(node) {
    const area = $('printArea');
    const root = document.documentElement;
    const theme = root.getAttribute('data-ss-theme');
    area.replaceChildren(node);
    document.body.classList.add('sc-printing');
    if (theme && theme !== 'light') root.setAttribute('data-ss-theme', 'light');
    try { window.print(); } catch (e) { ssDialog.alert('ההדפסה אינה זמינה במסך הזה.'); }
    setTimeout(() => {
      document.body.classList.remove('sc-printing');
      area.replaceChildren();
      if (theme && theme !== 'light' && root.getAttribute('data-ss-theme') === 'light') root.setAttribute('data-ss-theme', theme);
    }, 500);
  }

  // ---------- CSV (Blob + הורדה, בלי רשת) ----------
  // f31: ייצוא רק עם הרשאת data.export (צופה — לא). f107: ההודעה לא קובעת היכן נשמר — חלון השמירה נפתח
  function download(name, text) {
    if (!perms().exp) { denyExport(); return; }
    try {
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      toast('בחרו בחלון השמירה היכן לשמור את הקובץ');
    } catch (e) {
      ssDialog.alert('לא ניתן לשמור קובץ מהמסך הזה. אפשר להשתמש בגיבוי של התוכנה.', { title: 'ייצוא' });
    }
  }
  const stamp = () => L.localDay();

  // ---------- כותרת ולשוניות ----------
  function tabsList() {
    const T = terms();
    const list = [['dash', 'לוח בקרה'], ['students', T.many], ['classes', `${T.classes} ו${T.teachers}`], ['att', 'נוכחות'], ['grades', 'ציונים ומבחנים']];
    if (!isKollel()) list.push(['tuition', 'שכר לימוד']);
    list.push(['settings', 'הגדרות']);
    return list;
  }
  function renderHead() {
    const s = data.settings;
    $('instName').textContent = s.name || 'ניהול מוסד';
    document.title = s.name ? s.name + ' — ניהול מוסד' : 'ניהול מוסד';
    const sub = [L.INSTITUTION_TYPES[s.type], s.year ? 'שנת הלימודים ' + s.year : '', hebrewDate(L.localDay())].filter(Boolean).join(' · ');
    $('instSub').textContent = sub;
    const acts = [];
    if (data.students.some(x => x.demo)) acts.push(badge('נתוני דוגמה', 'warning'), btn('הסרת נתוני הדוגמה', removeDemo, 'ss-btn ss-btn-sm'));
    if (!viewingCurrent()) acts.push(badge('צפייה בשנה קודמת: ' + (viewYear().name || ''), 'info'));
    $('headActions').replaceChildren(...acts);
    const list = tabsList();
    if (!list.some(t => t[0] === ui.tab)) ui.tab = 'dash';
    // הלשונית הפעילה נותנת שם לאזור התוכן (role=tabpanel ב-index.html)
    $('view').setAttribute('aria-labelledby', 'tab-' + ui.tab);
    $('tabs').replaceChildren(...list.map(([id, label]) => h('button', {
      type: 'button', id: 'tab-' + id, class: 'ss-tab' + (ui.tab === id ? ' active' : ''), role: 'tab', 'aria-selected': ui.tab === id ? 'true' : 'false',
      'aria-controls': 'view', tabindex: ui.tab === id ? '0' : '-1', 'data-tab': id, onclick: () => go(id)
    }, label)));
  }
  function go(tab) { ui.tab = tab; saveUi(); render(); $('view').focus({ preventScroll: true }); }
  // לשוניות מהמקלדת: חצים (RTL — שמאלה = הבאה), Home / End; המיקוד נשאר על הלשונית
  $('tabs').addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const ids = tabsList().map(t => t[0]);
    const i = Math.max(0, ids.indexOf(ui.tab));
    const n = e.key === 'Home' ? ids[0] : e.key === 'End' ? ids[ids.length - 1] : ids[(i + (e.key === 'ArrowLeft' ? 1 : -1) + ids.length) % ids.length];
    e.preventDefault();
    ui.tab = n; saveUi(); render();
    const b = $('tabs').querySelector('[data-tab="' + n + '"]');
    if (b) b.focus();
  });

  function render() {
    renderHead();
    const v = $('view');
    const fn = { dash: viewDash, students: viewStudents, classes: viewClasses, att: viewAttendance, grades: viewGrades, tuition: viewTuition, settings: viewSettings }[ui.tab] || viewDash;
    v.replaceChildren(...[].concat(fn()));
  }

  // ---------- נתוני דוגמה ----------
  // אחרי תשלום אמיתי — אין טעינת דוגמה (היא תופסת מספרי אישור ברצף; L.loadDemo)
  const canLoadDemo = () => !data.payments.some(p => !p.demo);
  async function loadDemo() {
    if (data.students.some(s => s.demo)) return;
    const ok = await ssDialog.confirm('לטעון נתוני דוגמה? (3 כיתות, 12 תלמידים, נוכחות, מבחנים ושכר לימוד). כל רשומה מסומנת כדוגמה, ואפשר להסיר את כולן בלחיצה אחת.', { title: 'נתוני דוגמה', okText: 'טעינה' });
    if (!ok) return;
    const r = commit(d => L.loadDemo(d));
    if (r.ok) toast('נתוני הדוגמה נטענו');
  }
  async function removeDemo() {
    const ok = await ssDialog.confirm('להסיר את כל נתוני הדוגמה? הנתונים שהזנתם בעצמכם יישארו — גם כיתה, מבחן או תלמיד לדוגמה שקשרתם אליהם נתונים אמיתיים (הם יהפכו לרגילים).', { title: 'הסרת נתוני הדוגמה', okText: 'הסרה', danger: true });
    if (!ok) return;
    const r = commit(d => L.removeDemo(d));
    if (r.ok) toast('נתוני הדוגמה הוסרו');
  }

  // ---------- לוח בקרה ----------
  function viewDash() {
    const T = terms();
    const today = L.localDay();
    const active = L.activeStudents(data);
    const todayStats = L.attendanceStats(data, { from: today, to: today, sids: active.map(s => s.id) });
    const month = today.slice(0, 7);
    const low = L.lowAttendance(data, month);
    const sum = L.tuitionSummary(data, today);
    const debt = L.debtors(data, today);
    const bdays = L.upcomingBirthdays(data, today, 14);
    const out = [];

    if (!data.students.length) {
      out.push(h('section', { class: 'ss-card ss-card-info' },
        h('div', { class: 'sc-card-head' }, h('h2', { text: 'ברוכים הבאים לניהול המוסד' })),
        h('p', { class: 'ss-hint', text: 'מתחילים בהגדרות המוסד (שם, סוג, שנת לימודים ומקצועות), ואז מוסיפים כיתות ותלמידים. אפשר גם לטעון נתוני דוגמה כדי להכיר את המסכים — הם מסומנים ונמחקים בלחיצה.' }),
        h('div', { class: 'ss-toolbar' }, btn('להגדרות המוסד', () => go('settings'), 'ss-btn-primary'), btn(`הוספת ${T.one}`, () => editStudent(null)), canLoadDemo() ? btn('טעינת נתוני דוגמה', loadDemo, 'ss-btn-secondary') : null)));
    }

    const kpi = (label, value, note, tab) => h('button', { type: 'button', class: 'ss-kpi sc-kpi-btn', onclick: () => go(tab) },
      h('small', { text: label }), h('strong', null, value), note ? h('span', { class: 'sc-kpi-note', text: note }) : null);
    const kpis = [
      kpi(T.many + ' פעילים', String(active.length), data.students.length - active.length ? `${data.students.length - active.length} עזבו` : '', 'students'),
      kpi('נוכחות היום', pctText(todayStats.pct), todayStats.total ? `${todayStats.P + todayStats.L} נוכחים, ${todayStats.A} נעדרים` : 'טרם סומנה נוכחות', 'att'),
      kpi(T.classes, String(data.classes.length), `${data.teachers.length} ${T.teachers}`, 'classes')
    ];
    if (!isKollel()) kpis.push(kpi('פיגור בשכר לימוד', L.fmtMoney(sum.arrearsAg), debt.length ? `${debt.length} משפחות בפיגור` : 'אין פיגורים', 'tuition'));
    kpis.push(kpi('ימי הולדת קרובים', String(bdays.length), 'ב-14 הימים הקרובים', 'students'));
    out.push(h('div', { class: 'ss-kpis' }, kpis));

    // התראות
    const alerts = [];
    const addAlert = (kind, text, action) => alerts.push(h('div', { class: 'sc-alert sc-alert-' + kind }, h('span', { text }), action || null));
    // נפח: פריט שמתקרב לתקרת האחסון (70%) — מזהירים לפני שהשמירה נחסמת
    for (const w of L.sizeWarnings(stored)) addAlert('danger', `${w.label} תופסים ${w.pct}% מהנפח המרבי לשמירה. מומלץ לפתוח שנת לימודים חדשה (בהגדרות) או לפנות לתמיכה.`);
    if (!data.settings.name) addAlert('warn', 'שם המוסד לא הוגדר.', btn('להגדרות', () => go('settings'), 'ss-btn ss-btn-sm'));
    const noClass = active.filter(s => !s.classId || !data.classes.some(c => c.id === s.classId));
    if (noClass.length && data.classes.length) addAlert('warn', `${noClass.length} ${T.many} בלי ${T.cls}.`, btn('לשיבוץ', () => go('classes'), 'ss-btn ss-btn-sm'));
    if (active.length && !todayStats.total && L.dayOfWeek(today) !== 6) addAlert('warn', 'טרם סומנה נוכחות היום.', btn('לסימון', () => { ui.attDay = today; go('att'); }, 'ss-btn ss-btn-sm'));
    if (low.length) addAlert('danger', `${low.length} ${T.many} עם נוכחות מתחת ל-${lowPct()}% החודש.`, btn('לרשימה', () => { ui.attMonth = month; go('att'); }, 'ss-btn ss-btn-sm'));
    if (isKollel()) {
      for (const c of L.kollelDayCheck(data, today)) if (!c.ok) addAlert('danger', `${c.name}: ${c.present} נוכחים — מתחת למינימום של ${c.min}.`);
    }
    if (!isKollel() && debt.length) addAlert('warn', `${debt.length} ${T.many} בפיגור בשכר לימוד, סך ${L.fmtMoney(sum.arrearsAg)}.`, btn('לרשימת החייבים', () => { ui.tView = 'debtors'; go('tuition'); }, 'ss-btn ss-btn-sm'));
    if (!alerts.length && data.students.length) addAlert('ok', 'אין התראות פתוחות.');

    const bdayList = bdays.length ? h('div', { class: 'ss-list' }, bdays.map(b => h('div', { class: 'ss-list-row' },
      h('span', { class: 'ss-grow' }, h('span', { class: 'sc-name', text: L.fullName(b.student) }), ' · ', h('span', { class: 'ss-muted', text: L.className(data, b.student.classId) })),
      badge(b.inDays === 0 ? 'היום' : b.inDays === 1 ? 'מחר' : `בעוד ${b.inDays} ימים`, b.inDays === 0 ? 'success' : 'info'),
      h('span', { class: 'ss-muted', text: `${fmtDay(b.date)} · בן ${b.age}` })))) : empty('אין ימי הולדת בשבועיים הקרובים.');

    // נוכחות לפי כיתה (החודש)
    const clsRows = data.classes.map(c => {
      const s = L.monthSummary(data, month, c.id);
      return h('tr', null, h('td', { class: 'sc-name', text: c.name }), h('td', { text: teacherName(c.teacherId) || '—' }),
        numTd(String(s.rows.length)), numTd(pctText(s.class.pct)), h('td', null, pctBar(s.class.pct, lowPct())));
    });

    out.push(h('div', { class: 'ss-grid' },
      card('התראות', null, alerts.length ? h('div', { class: 'sc-alerts' }, alerts) : empty('אין עדיין נתונים.')),
      card('ימי הולדת קרובים', null, bdayList)));
    if (data.classes.length) out.push(card(`נוכחות לפי ${T.cls} — החודש`, null,
      table([T.cls, T.teacher, numTh(T.many), numTh('נוכחות'), ''], clsRows)));
    return out;
  }

  // ---------- תלמידים ----------
  function viewStudents() {
    const T = terms();
    const list = L.searchStudents(data, { q: ui.q, classId: ui.classFilter, status: ui.statusFilter, specialEd: ui.specialOnly });
    const search = h('input', { type: 'search', class: 'ss-input', placeholder: 'חיפוש לפי שם, ת"ז, הורה או טלפון', 'aria-label': 'חיפוש', value: ui.q });
    search.addEventListener('input', () => { ui.q = search.value; const pos = search.selectionStart; render(); const s = $('view').querySelector('input[type=search]'); if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch (e) { /* */ } } });
    const cls = h('select', { class: 'ss-input', 'aria-label': 'סינון לפי ' + T.cls, onchange: e => { ui.classFilter = e.target.value; render(); } }, classOptions(ui.classFilter, `כל ה${T.classes}`));
    cls.style.width = 'auto';
    const st = h('select', { class: 'ss-input', 'aria-label': 'מצב', onchange: e => { ui.statusFilter = e.target.value; saveUi(); render(); } },
      [['active', 'פעילים'], ['left', 'עזבו'], ['all', 'כולם']].map(([v, l]) => h('option', { value: v, text: l, selected: ui.statusFilter === v })));
    st.style.width = 'auto';
    const sp = h('label', { class: 'ss-check' }, h('input', { type: 'checkbox', checked: ui.specialOnly, onchange: e => { ui.specialOnly = e.target.checked; render(); } }), 'חינוך מיוחד בלבד');

    const rows = list.map(s => {
      const idBad = s.idNum && !L.isValidIsraeliId(s.idNum);
      const tags = [s.specialEd ? badge('חינוך מיוחד', 'info') : null, s.status === 'left' ? badge('עזב', 'danger') : null, s.demo ? badge('דוגמה', 'warning') : null];
      return h('tr', { class: 'sc-row-click', onclick: e => { if (!e.target.closest('button')) editStudent(s); } },
        h('td', null, h('span', { class: 'sc-name', text: L.fullName(s) }), ' ', tags),
        h('td', { text: L.className(data, s.classId) || '—' }),
        h('td', { class: 'sc-num' }, s.idNum || '—', idBad ? ' ' : '', idBad ? badge('ספרת ביקורת', 'danger') : null),
        h('td', { class: 'sc-num', text: s.birth ? fmtDay(s.birth) : '—' }),
        h('td', { text: [s.father, s.mother].filter(Boolean).join(' / ') || '—' }),
        h('td', { class: 'sc-num', text: s.phone1 || '—' }),
        h('td', null, h('div', { class: 'ss-actions' },
          btn('עריכה', () => editStudent(s), 'ss-btn ss-btn-sm'),
          btn('🗑', () => deleteStudent(s), 'ss-btn-ghost ss-btn-sm ss-btn-icon', { 'aria-label': 'מחיקת ' + L.fullName(s), title: 'מחיקה' }))));
    });
    return [
      h('div', { class: 'ss-toolbar' }, search, cls, st, sp,
        h('div', { class: 'ss-push ss-actions' }, perms().exp ? btn('ייצוא CSV', () => download(`students-${stamp()}.csv`, L.studentsCsv(data))) : null, btn(`＋ ${T.one} חדש`, () => editStudent(null), 'ss-btn-primary'))),
      card(`${T.many} (${list.length})`, null,
        list.length ? table(['שם', T.cls, 'ת"ז', 'תאריך לידה', 'הורים', 'טלפון', ''], rows) : empty(data.students.length ? 'לא נמצאו רשומות מתאימות.' : `עדיין אין ${T.many}. לחצו "＋ ${T.one} חדש".`))
    ];
  }

  async function editStudent(s) {
    const T = terms();
    const isNew = !s;
    s = s || {};
    const v = await formDialog(isNew ? `${T.one} חדש` : L.fullName(s), [
      { name: 'first', label: 'שם פרטי', value: s.first, required: true, max: 50 },
      { name: 'last', label: 'שם משפחה', value: s.last, required: true, max: 50 },
      { name: 'idNum', label: 'מספר זהות', value: s.idNum, inputmode: 'numeric', max: 9, hint: 'רשות. נבדקת ספרת ביקורת.' },
      { name: 'birth', label: 'תאריך לידה', type: 'date', value: s.birth },
      { name: 'classId', label: T.cls, type: 'select', value: s.classId || ui.classFilter || '', options: [{ value: '', label: '— ללא —' }, ...data.classes.map(c => ({ value: c.id, label: c.name }))] },
      { name: 'status', label: 'מצב', type: 'select', value: s.status || 'active', options: [{ value: 'active', label: 'פעיל' }, { value: 'left', label: 'עזב' }] },
      { name: 'leftOn', label: 'תאריך עזיבה', type: 'date', value: s.leftOn, hint: 'למי שעזב: החיוב בשכר הלימוד נעצר בחודש הזה (ריק בסימון עזיבה חדש = היום)' },
      { type: 'section', label: 'הורים ויצירת קשר' },
      { name: 'father', label: T.father, value: s.father, max: 80 },
      { name: 'mother', label: T.mother, value: s.mother, max: 80 },
      { name: 'phone1', label: 'טלפון', type: 'tel', value: s.phone1, max: 30 },
      { name: 'phone2', label: 'טלפון נוסף', type: 'tel', value: s.phone2, max: 30 },
      { name: 'address', label: 'כתובת', value: s.address, wide: true, max: 160 },
      { type: 'section', label: 'נוסף' },
      { name: 'joined', label: 'תאריך הצטרפות', type: 'date', value: s.joined },
      { name: 'specialEd', label: 'חינוך מיוחד', type: 'checkbox', value: s.specialEd, hint: 'פטור משכר לימוד ודמי רישום כברירת מחדל' },
      { name: 'notes', label: 'הערות', type: 'textarea', value: s.notes }
    ], {
      validate: v => L.idError(v.idNum) || (v.idNum && data.students.some(x => x.id !== s.id && x.idNum && L.normalizeId(x.idNum) === L.normalizeId(v.idNum)) ? 'מספר הזהות כבר רשום אצל ' + T.one + ' אחר' : null)
    });
    if (!v) return;
    // עזב (f33): בלי תאריך — היום; חזר להיות פעיל — התאריך נמחק
    // תאריך ריק: סימון עזיבה חדש ← היום; תלמיד שכבר עזב בלי תאריך (נתונים ישנים) ← נשאר ריק, לא ממציאים (f33)
    const leftOn = v.status === 'left' ? (L.isDay(v.leftOn) ? v.leftOn : s.status === 'left' ? (s.leftOn || '') : L.localDay()) : '';
    const rec = L.normStudent(Object.assign({}, s, v, { id: s.id || L.newId('s'), demo: !!s.demo, leftOn }));
    if (!rec) return;
    const r = commit(d => {
      const i = d.students.findIndex(x => x.id === rec.id);
      if (i >= 0) d.students[i] = rec; else { L.assertRoom(d, 'students'); d.students.push(rec); }
    });
    if (r.ok) toast(isNew ? 'נוסף' : 'נשמר');
  }
  async function deleteStudent(s) {
    if (data.payments.some(p => p.sid === s.id)) {
      const ok = await ssDialog.confirm(`ל${L.fullName(s)} רשומים תשלומים, ולכן אי אפשר למחוק את הכרטיס (התיעוד נשמר). לסמן "עזב"?`, { title: 'מחיקה', okText: 'סימון "עזב"' });
      if (ok) commit(d => { const x = d.students.find(y => y.id === s.id); if (x && x.status !== 'left') { x.status = 'left'; x.leftOn = L.localDay(); } });
      return;
    }
    const ok = await ssDialog.confirm(`למחוק את ${L.fullName(s)}? יימחקו גם הנוכחות, הציונים ותוכנית שכר הלימוד. אפשר לבטל ב-10 השניות הקרובות.`, { title: 'מחיקה', okText: 'מחיקה', danger: true });
    if (ok) commitUndo(d => L.deleteStudent(d, s.id), 'נמחק: ' + L.fullName(s));
  }

  // ---------- כיתות ומלמדים ----------
  function viewClasses() {
    const T = terms();
    const month = L.localDay().slice(0, 7);
    const crow = data.classes.map(c => {
      const n = L.activeStudents(data, c.id).length;
      const pct = L.monthSummary(data, month, c.id).class.pct;
      return h('tr', null, h('td', { class: 'sc-name', text: c.name }), h('td', { text: c.grade || '—' }), h('td', { text: teacherName(c.teacherId) || '—' }),
        numTd(String(n)), numTd(pctText(pct)),
        h('td', null, h('div', { class: 'ss-actions' }, btn('עריכה ושיבוץ', () => editClass(c), 'ss-btn ss-btn-sm'), btn('🗑', () => deleteClass(c), 'ss-btn-ghost ss-btn-sm ss-btn-icon', { 'aria-label': 'מחיקת ' + c.name, title: 'מחיקה' }))));
    });
    const trow = data.teachers.map(t => h('tr', null, h('td', { class: 'sc-name', text: t.name }), h('td', { text: t.role || '—' }), h('td', { class: 'sc-num', text: t.phone || '—' }),
      h('td', { text: data.classes.filter(c => c.teacherId === t.id).map(c => c.name).join(', ') || '—' }),
      h('td', null, h('div', { class: 'ss-actions' }, btn('עריכה', () => editTeacher(t), 'ss-btn ss-btn-sm'), btn('🗑', () => deleteTeacher(t), 'ss-btn-ghost ss-btn-sm ss-btn-icon', { 'aria-label': 'מחיקת ' + t.name, title: 'מחיקה' })))));
    return [
      card(`${T.classes} (${data.classes.length})`, btn(`＋ ${T.cls} חדשה`, () => editClass(null), 'ss-btn-primary ss-btn-sm'),
        data.classes.length ? table([T.cls, 'שכבה', T.teacher, numTh(T.many), numTh('נוכחות החודש'), ''], crow) : empty(`אין עדיין ${T.classes}.`)),
      card(`${T.teachers} (${data.teachers.length})`, btn(`＋ ${T.teacher} חדש`, () => editTeacher(null), 'ss-btn-primary ss-btn-sm'),
        data.teachers.length ? table(['שם', 'תפקיד', 'טלפון', T.classes, ''], trow) : empty(`אין עדיין ${T.teachers}.`))
    ];
  }
  async function editClass(c) {
    const T = terms();
    const isNew = !c;
    c = c || {};
    // שיבוץ: רשימת כל הפעילים, מסומנים אלה שבכיתה
    const boxes = L.activeStudents(data).map(s => {
      const cb = h('input', { type: 'checkbox', checked: !!c.id && s.classId === c.id, 'data-sid': s.id });
      const other = s.classId && s.classId !== c.id ? L.className(data, s.classId) : '';
      return h('label', { class: 'ss-check' }, cb, L.fullName(s), other ? h('span', { class: 'ss-muted', text: ` (${other})` }) : null);
    });
    const extra = h('div', null, h('h4', { class: 'ss-section-title', text: `שיבוץ ${T.many}` }),
      boxes.length ? h('div', { class: 'sc-checklist' }, boxes) : h('p', { class: 'ss-hint', text: `אין ${T.many} פעילים.` }),
      h('p', { class: 'ss-hint', text: `סימון ${T.one} שנמצא ב${T.cls} אחרת יעביר אותו לכאן.` }));
    const v = await formDialog(isNew ? `${T.cls} חדשה` : c.name, [
      { name: 'name', label: 'שם', value: c.name, required: true, max: 60 },
      { name: 'grade', label: 'שכבה', value: c.grade, max: 30 },
      { name: 'teacherId', label: T.teacher, type: 'select', value: c.teacherId || '', options: [{ value: '', label: '— ללא —' }, ...data.teachers.map(t => ({ value: t.id, label: t.name }))] }
    ], { extra });
    if (!v) return;
    const id = c.id || L.newId('c');
    const picked = new Set(boxes.map(b => b.querySelector('input')).filter(i => i.checked).map(i => i.getAttribute('data-sid')));
    commit(d => {
      const rec = { id, name: v.name.slice(0, 60), grade: v.grade.slice(0, 30), teacherId: v.teacherId, demo: !!c.demo };
      const i = d.classes.findIndex(x => x.id === id);
      if (i >= 0) d.classes[i] = rec; else { L.assertRoom(d, 'classes'); d.classes.push(rec); }
      for (const s of d.students) {
        if (s.status !== 'active') continue;
        if (picked.has(s.id)) s.classId = id;
        else if (s.classId === id) s.classId = '';
      }
    });
  }
  // f32: המבחנים של הכיתה נמחקים במפורש (עם האזהרה), ולא נשארים יתומים ונסתרים
  async function deleteClass(c) {
    const T = terms();
    const n = data.students.filter(s => s.classId === c.id).length;
    const a = data.assessments.filter(x => x.classId === c.id).length;
    const parts = [n ? `${n} ${T.many} יישארו בלי ${T.cls}.` : '', a ? `יימחקו גם ${a} מבחנים של ה${T.cls} עם כל הציונים שבהם (גם משנים קודמות), והם לא יופיעו בתעודות.` : ''].filter(Boolean);
    const ok = await ssDialog.confirm(`למחוק את ${c.name}? ${parts.join(' ')}`.trim(), { title: 'מחיקה', okText: 'מחיקה', danger: true });
    if (ok) commit(d => L.deleteClass(d, c.id));
  }
  async function editTeacher(t) {
    const T = terms();
    t = t || {};
    const v = await formDialog(t.id ? t.name : `${T.teacher} חדש`, [
      { name: 'name', label: 'שם', value: t.name, required: true, max: 80 },
      { name: 'role', label: 'תפקיד', value: t.role || T.teacher, max: 40 },
      { name: 'phone', label: 'טלפון', type: 'tel', value: t.phone, max: 30 },
      { name: 'notes', label: 'הערות', type: 'textarea', value: t.notes }
    ]);
    if (!v) return;
    const id = t.id || L.newId('t');
    commit(d => {
      const rec = { id, name: v.name.slice(0, 80), role: v.role.slice(0, 40), phone: v.phone.slice(0, 30), notes: v.notes.slice(0, 500), demo: !!t.demo };
      const i = d.teachers.findIndex(x => x.id === id);
      if (i >= 0) d.teachers[i] = rec; else { L.assertRoom(d, 'teachers'); d.teachers.push(rec); }
    });
  }
  async function deleteTeacher(t) {
    const ok = await ssDialog.confirm(`למחוק את ${t.name}?`, { title: 'מחיקה', okText: 'מחיקה', danger: true });
    if (ok) commit(d => { d.teachers = d.teachers.filter(x => x.id !== t.id); d.classes.forEach(c => { if (c.teacherId === t.id) c.teacherId = ''; }); });
  }

  // ---------- נוכחות ----------
  const ATT_ICONS = { P: '✓', A: '✗', L: '◷', E: '✎' };
  function viewAttendance() {
    const T = terms();
    const slots = L.slotsFor(data.settings);
    if (!slots.includes(ui.attSlot)) ui.attSlot = slots[0];
    if (ui.attClass && !data.classes.some(c => c.id === ui.attClass)) ui.attClass = '';
    const day = L.isDay(ui.attDay) ? ui.attDay : L.localDay();
    const studs = L.activeStudents(data, ui.attClass);
    const marks = (data.attendance[day] && data.attendance[day][ui.attSlot]) || {};

    const dayIn = h('input', { type: 'date', class: 'ss-input', value: day, 'aria-label': 'תאריך', onchange: e => { if (L.isDay(e.target.value)) { ui.attDay = e.target.value; render(); } } });
    dayIn.style.width = 'auto';
    const shift = k => { const [y, m, d] = day.split('-').map(Number); ui.attDay = L.localDay(new Date(y, m - 1, d + k)); render(); };
    const cls = h('select', { class: 'ss-input', 'aria-label': T.cls, onchange: e => { ui.attClass = e.target.value; render(); } }, classOptions(ui.attClass, `כל ה${T.classes}`));
    cls.style.width = 'auto';
    const slotSel = slots.length > 1 ? h('select', { class: 'ss-input', 'aria-label': 'סדר', onchange: e => { ui.attSlot = e.target.value; render(); } },
      slots.map((s, i) => h('option', { value: s, text: data.settings.sessions[i], selected: ui.attSlot === s }))) : null;
    if (slotSel) slotSel.style.width = 'auto';

    const counts = () => {
      const m = (data.attendance[day] && data.attendance[day][ui.attSlot]) || {};
      const c = { P: 0, A: 0, L: 0, E: 0 };
      studs.forEach(s => { if (m[s.id]) c[m[s.id]]++; });
      return c;
    };
    const summary = h('div', { class: 'ss-checks' });
    const paintSummary = () => {
      const c = counts();
      summary.replaceChildren(badge(`נוכחים ${c.P}`, 'success'), badge(`איחור ${c.L}`, 'warning'), badge(`נעדרים ${c.A}`, 'danger'), badge(`מוצדק ${c.E}`, 'info'), badge(`לא סומנו ${studs.length - c.P - c.L - c.A - c.E}`));
    };
    paintSummary();

    const rows = studs.map(s => {
      const group = h('div', { class: 'sc-att', role: 'group', 'aria-label': 'נוכחות ' + L.fullName(s) });
      const paint = () => {
        const cur = ((data.attendance[day] || {})[ui.attSlot] || {})[s.id] || '';
        group.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.getAttribute('data-code') === cur ? 'true' : 'false'));
      };
      for (const code of Object.keys(L.ATT_CODES)) {
        // סמל + מילה, לא רק צבע
        group.append(h('button', { type: 'button', 'data-code': code, 'aria-pressed': marks[s.id] === code ? 'true' : 'false', onclick: () => {
          const cur = ((data.attendance[day] || {})[ui.attSlot] || {})[s.id];
          const r = commit(d => L.setMark(d, day, ui.attSlot, s.id, cur === code ? '' : code), { render: false });
          if (r.ok) { paint(); paintSummary(); refreshMonthly(); }
        } }, h('span', { class: 'sc-att-ico', 'aria-hidden': 'true', text: ATT_ICONS[code] }), L.ATT_CODES[code]));
      }
      return h('tr', null, h('td', null, h('span', { class: 'sc-name', text: L.fullName(s) })), h('td', { text: L.className(data, s.classId) || '—' }), h('td', null, group));
    });

    const allPresent = async () => {
      if (!studs.length) return;
      const r = commitUndo(d => L.markAll(d, day, ui.attSlot, studs.map(s => s.id), 'P'), n => (n ? `סומנו ${n} נוכחים` : ''));
      if (r.ok && !r.result) toast('כולם כבר סומנו');
    };
    const clearDay = async () => {
      const ok = await ssDialog.confirm('לנקות את כל הסימונים של היום הזה (ברשימה המוצגת)? אפשר לבטל ב-10 השניות הקרובות.', { title: 'ניקוי', okText: 'ניקוי', danger: true });
      if (ok) commitUndo(d => studs.forEach(s => L.setMark(d, day, ui.attSlot, s.id, '')), 'הסימונים של היום נוקו');
    };

    const dow = L.dayOfWeek(day);
    const notes = [];
    if (dow === 6) notes.push(h('div', { class: 'sc-alert sc-alert-warn' }, 'יום שבת — אין לימודים בדרך כלל.'));
    if (isKollel()) {
      for (const c of L.kollelDayCheck(data, day)) {
        notes.push(h('div', { class: 'sc-alert ' + (c.marked ? (c.ok ? 'sc-alert-ok' : 'sc-alert-danger') : '') },
          `${c.name}: ${c.present} נוכחים (מינימום ${c.min})${c.marked ? '' : ' — טרם סומן'}`));
      }
    }

    let monthly = monthlyAttendanceCard();
    const refreshMonthly = () => { const n = monthlyAttendanceCard(); monthly.replaceWith(n); monthly = n; };
    const out = [
      h('div', { class: 'ss-toolbar' },
        btn('→', () => shift(-1), 'ss-btn ss-btn-icon', { 'aria-label': 'היום הקודם', title: 'היום הקודם' }), dayIn,
        btn('←', () => shift(1), 'ss-btn ss-btn-icon', { 'aria-label': 'היום הבא', title: 'היום הבא' }),
        btn('היום', () => { ui.attDay = L.localDay(); render(); }, 'ss-btn'),
        h('span', { class: 'ss-muted', text: `יום ${WEEKDAYS[dow]} · ${hebrewDate(day)}` }), cls, slotSel,
        h('div', { class: 'ss-push ss-actions' }, btn('✓ כולם נוכחים', allPresent, 'ss-btn-primary'),
          // פעולה שמוחקת סימונים — לא ליד "כולם נוכחים", אלא בתפריט "עוד"
          moreMenu('עוד ▾', btn('ניקוי הסימונים של היום', clearDay, 'ss-btn-ghost ss-btn-sm')))),
      notes.length ? h('div', { class: 'sc-alerts' }, notes) : null,
      card('סימון יומי', summary,
        studs.length ? table(['שם', T.cls, 'סימון'], rows, 'sc-table-tight') : empty(`אין ${T.many} פעילים${ui.attClass ? ' ב' + T.cls + ' הזו' : ''}.`)),
      monthly
    ];
    return out.filter(Boolean);
  }
  function monthlyAttendanceCard() {
    const T = terms();
    const month = L.isMonth(ui.attMonth) ? ui.attMonth : L.localDay().slice(0, 7);
    const sum = L.monthSummary(data, month, ui.attClass);
    const low = lowPct();
    const mIn = h('input', { type: 'month', class: 'ss-input', value: month, 'aria-label': 'חודש', onchange: e => { if (L.isMonth(e.target.value)) { ui.attMonth = e.target.value; render(); } } });
    mIn.style.width = 'auto';
    const rows = sum.rows.map(r => h('tr', null, h('td', { class: 'sc-name', text: L.fullName(r.student) }), h('td', { text: L.className(data, r.student.classId) || '—' }),
      numTd(String(r.stats.P)), numTd(String(r.stats.L)), numTd(String(r.stats.A)), numTd(String(r.stats.E)),
      numTd(pctText(r.stats.pct), r.stats.pct !== null && r.stats.pct < low ? 'sc-neg' : ''), h('td', null, pctBar(r.stats.pct, low))));
    const lowList = sum.rows.filter(r => r.stats.pct !== null && r.stats.pct < low);
    return card(`סיכום חודשי${ui.attClass ? ' — ' + L.className(data, ui.attClass) : ''}`,
      [mIn, perms().exp ? btn('ייצוא CSV', () => download(`attendance-${month}.csv`, L.attendanceCsv(data, month)), 'ss-btn ss-btn-sm') : null],
      h('div', { class: 'ss-checks' }, badge(`נוכחות ${ui.attClass ? T.cls : 'כללית'}: ${pctText(sum.class.pct)}`, sum.class.pct !== null && sum.class.pct < low ? 'danger' : 'success'),
        badge(`${lowList.length} מתחת ל-${low}%`, lowList.length ? 'danger' : '')),
      h('p', { class: 'ss-hint', text: 'אחוז הנוכחות = נוכח ואיחור, מתוך נוכח, איחור ונעדר. היעדרות מוצדקת לא נספרת.' + (isKollel() ? ' בכולל הנוכחות נספרת בכל הסדרים.' : '') }),
      sum.rows.length ? table(['שם', T.cls, numTh('נוכח'), numTh('איחור'), numTh('נעדר'), numTh('מוצדק'), numTh('אחוז'), ''], rows, 'sc-table-tight') : empty('אין נתונים לחודש הזה.'));
  }

  // ---------- ציונים ----------
  function viewGrades() {
    const T = terms();
    const s = data.settings;
    if (ui.gClass && !data.classes.some(c => c.id === ui.gClass)) ui.gClass = '';
    if (!ui.gClass && data.classes.length) ui.gClass = data.classes[0].id;
    if (ui.gTerm && !s.terms.includes(ui.gTerm)) ui.gTerm = '';
    const cls = h('select', { class: 'ss-input', 'aria-label': T.cls, onchange: e => { ui.gClass = e.target.value; ui.gAssess = ''; render(); } }, classOptions(ui.gClass));
    cls.style.width = 'auto';
    const term = h('select', { class: 'ss-input', 'aria-label': 'תקופה', onchange: e => { ui.gTerm = e.target.value; render(); } },
      h('option', { value: '', text: 'כל השנה' }), s.terms.map(t => h('option', { value: t, text: t, selected: ui.gTerm === t })));
    term.style.width = 'auto';
    const views = [['tests', 'מבחנים והזנת ציונים'], ['sheet', 'גיליון ציונים'], ['report', 'תעודה']];
    const chips = h('div', { class: 'sc-chips', role: 'group', 'aria-label': 'תצוגה' }, views.map(([id, l]) =>
      h('button', { type: 'button', class: 'ss-chip' + (ui.gView === id ? ' sc-chip-on' : ''), 'aria-pressed': ui.gView === id ? 'true' : 'false', onclick: () => { ui.gView = id; render(); } }, l)));
    if (!data.classes.length) return [card('ציונים ומבחנים', null, empty(`כדי להזין ציונים יש להגדיר קודם ${T.classes}.`), h('div', { class: 'ss-toolbar' }, btn('ל' + T.classes, () => go('classes'), 'ss-btn-primary')))];
    const head = h('div', { class: 'ss-toolbar' }, yearSelect(), cls, term, chips, viewingCurrent() ? h('div', { class: 'ss-push' }, btn('＋ מבחן חדש', () => editAssessment(null), 'ss-btn-primary')) : null);
    const body = ui.gView === 'sheet' ? gradeSheet() : ui.gView === 'report' ? reportCardView() : testsView();
    return [head, ...[].concat(body)];
  }
  function classAssessments() {
    const y = viewYear().id;
    return data.assessments.filter(a => a.classId === ui.gClass && (a.yearId || data.yearId) === y && (!ui.gTerm || a.term === ui.gTerm))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }
  function testsView() {
    const list = classAssessments();
    if (ui.gAssess && !list.some(a => a.id === ui.gAssess)) ui.gAssess = '';
    const studs = L.activeStudents(data, ui.gClass);
    const rows = list.map(a => {
      const vals = studs.map(s => a.scores[s.id]).filter(v => typeof v === 'number');
      const avg = vals.length ? Math.round((vals.reduce((x, y) => x + y, 0) / vals.length / a.max) * 1000) / 10 : null;
      return h('tr', { class: 'sc-row-click' + (ui.gAssess === a.id ? ' sc-sel' : ''), onclick: e => { if (!e.target.closest('button')) { ui.gAssess = a.id; render(); } } },
        h('td', null, h('span', { class: 'sc-name', text: a.title }), ui.gAssess === a.id ? ' ' : '', ui.gAssess === a.id ? badge('נבחר', 'info') : null),
        h('td', { text: a.subject }), h('td', { text: a.term || '—' }), h('td', { class: 'sc-num', text: a.date ? fmtDay(a.date) : '—' }),
        numTd(String(a.weight)), numTd(String(a.max)), numTd(`${vals.length}/${studs.length}`), numTd(avg === null ? '—' : avg + '%'),
        h('td', null, h('div', { class: 'ss-actions' }, btn('ציונים', () => { ui.gAssess = a.id; render(); }, 'ss-btn ss-btn-sm'),
          viewingCurrent() ? btn('עריכה', () => editAssessment(a), 'ss-btn ss-btn-sm') : null,
          viewingCurrent() ? btn('🗑', () => deleteAssessment(a), 'ss-btn-ghost ss-btn-sm ss-btn-icon', { 'aria-label': 'מחיקת ' + a.title, title: 'מחיקה' }) : null)));
    });
    const out = [card('מבחנים', null, list.length ? table(['מבחן', 'מקצוע', 'תקופה', 'תאריך', numTh('משקל'), numTh('ציון מרבי'), numTh('הוזנו'), numTh('ממוצע'), ''], rows)
      : empty('אין מבחנים. לחצו "＋ מבחן חדש".'))];
    const a = list.find(x => x.id === ui.gAssess);
    if (a) out.push(scoreEntry(a, studs));
    return out;
  }
  function scoreEntry(a, studs) {
    const inputs = studs.map(s => h('input', { type: 'number', class: 'ss-input sc-score', min: 0, max: a.max, step: '0.5', inputmode: 'decimal', value: typeof a.scores[s.id] === 'number' ? String(a.scores[s.id]) : '', 'aria-label': 'ציון ' + L.fullName(s), 'data-sid': s.id }));
    const err = h('div', { class: 'sc-err', role: 'alert' });
    const save = () => {
      const scores = {};
      for (const inp of inputs) {
        const raw = inp.value.trim();
        if (!raw) continue;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > a.max) { err.textContent = `ציון לא תקין (0–${a.max}).`; inp.focus(); return; }
        scores[inp.getAttribute('data-sid')] = Math.round(n * 10) / 10;
      }
      const r = commit(d => {
        const x = d.assessments.find(y => y.id === a.id);
        if (!x) return;
        // שומרים ציונים של מי שאינו ברשימה (עזב / עבר כיתה)
        for (const s of studs) delete x.scores[s.id];
        Object.assign(x.scores, scores);
      });
      if (r.ok) toast('הציונים נשמרו');
    };
    const rows = studs.map((s, i) => h('tr', null, h('td', { class: 'sc-name', text: L.fullName(s) }), h('td', null, inputs[i]), h('td', { class: 'ss-muted', text: `מתוך ${a.max}` })));
    const wrap = card(`הזנת ציונים — ${a.title} (${a.subject})`, viewingCurrent() ? [btn('שמירת הציונים', save, 'ss-btn-primary ss-btn-sm')] : null,
      studs.length ? table(['שם', 'ציון', ''], rows, 'sc-table-tight') : empty('אין תלמידים בכיתה.'), err);
    wrap.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.classList.contains('sc-score')) {
        e.preventDefault();
        const i = inputs.indexOf(e.target);
        if (i >= 0 && i < inputs.length - 1) inputs[i + 1].focus(); else save();
      }
    });
    return wrap;
  }
  async function editAssessment(a) {
    const s = data.settings;
    a = a || {};
    const subjects = s.subjects.length ? s.subjects : L.DEFAULT_SUBJECTS;
    const v = await formDialog(a.id ? 'עריכת מבחן' : 'מבחן חדש', [
      { name: 'title', label: 'שם המבחן', value: a.title || '', required: true, max: 80, placeholder: 'מבחן חודשי' },
      { name: 'subject', label: 'מקצוע', type: 'select', value: a.subject || subjects[0], options: [...new Set([...subjects, a.subject].filter(Boolean))].map(x => ({ value: x, label: x })) },
      { name: 'classId', label: terms().cls, type: 'select', value: a.classId || ui.gClass, options: data.classes.map(c => ({ value: c.id, label: c.name })) },
      { name: 'term', label: 'תקופה', type: 'select', value: a.term || ui.gTerm || s.terms[0], options: s.terms.map(t => ({ value: t, label: t })) },
      { name: 'date', label: 'תאריך', type: 'date', value: a.date || L.localDay() },
      { name: 'weight', label: 'משקל', type: 'number', value: String(a.weight || 1), min: 1, maxNum: 100, hint: 'משקל יחסי בממוצע המקצוע (1–100)' },
      { name: 'max', label: 'ציון מרבי', type: 'number', value: String(a.max || 100), min: 1, maxNum: 1000 }
    ], {
      validate: v => {
        const w = Number(v.weight), m = Number(v.max);
        if (!Number.isInteger(w) || w < 1 || w > 100) return 'משקל — מספר שלם בין 1 ל-100';
        if (!Number.isInteger(m) || m < 1 || m > 1000) return 'ציון מרבי — מספר שלם בין 1 ל-1000';
        if (a.id && m < a.max && Object.values(a.scores).some(x => x > m)) return 'יש ציונים גבוהים מהציון המרבי החדש';
        return null;
      }
    });
    if (!v) return;
    const id = a.id || L.newId('a');
    const r = commit(d => {
      // מבחן שהועבר לכיתה אחרת: ציונים של מי שאינו בכיתה החדשה נמחקים — אחרת היו נספרים בתעודה שלו (f32)
      const scores = Object.assign({}, a.scores || {});
      if (a.id && a.classId !== v.classId) for (const sid of Object.keys(scores)) { const st = d.students.find(x => x.id === sid); if (!st || st.classId !== v.classId) delete scores[sid]; }
      const rec = { id, title: v.title.slice(0, 80), subject: v.subject, classId: v.classId, term: v.term, date: L.isDay(v.date) ? v.date : '', weight: Number(v.weight), max: Number(v.max), scores, demo: !!a.demo, yearId: a.yearId || d.yearId };
      const i = d.assessments.findIndex(x => x.id === id);
      if (i >= 0) d.assessments[i] = rec; else { L.assertRoom(d, 'assessments'); d.assessments.push(rec); }
      ui.gAssess = id; ui.gClass = v.classId; ui.gView = 'tests';
    });
    if (r.ok) toast('נשמר');
  }
  async function deleteAssessment(a) {
    const ok = await ssDialog.confirm(`למחוק את "${a.title}" וכל הציונים שבו? אפשר לבטל ב-10 השניות הקרובות.`, { title: 'מחיקה', okText: 'מחיקה', danger: true });
    if (ok) commitUndo(d => { d.assessments = d.assessments.filter(x => x.id !== a.id); }, `נמחק: "${a.title}"`);
  }
  function gradeSheet() {
    const T = terms();
    const studs = L.activeStudents(data, ui.gClass);
    const subjects = [...new Set(classAssessments().map(a => a.subject))];
    if (!subjects.length) return card('גיליון ציונים', null, empty('אין מבחנים בתקופה הזו.'));
    const rankOn = data.settings.showRanking;
    const ranks = rankOn ? new Map(L.classRanking(data, ui.gClass, ui.gTerm, viewYear().id).map(r => [r.student.id, r.rank])) : null;
    const rows = studs.map(s => {
      const av = L.studentSubjectAverages(data, s.id, ui.gTerm, viewYear().id);
      const all = L.overallAverage(av);
      return h('tr', null, h('td', { class: 'sc-name', text: L.fullName(s) }),
        subjects.map(sub => numTd(av[sub] ? String(av[sub].average) : '—')),
        numTd(all === null ? '—' : String(all), all !== null && all < 55 ? 'sc-neg' : ''),
        rankOn ? numTd(ranks.has(s.id) ? String(ranks.get(s.id)) : '—') : null,
        h('td', null, btn('תעודה', () => { ui.gStudent = s.id; ui.gView = 'report'; render(); }, 'ss-btn ss-btn-sm')));
    });
    return card(`גיליון ציונים — ${L.className(data, ui.gClass)}${ui.gTerm ? ' · ' + ui.gTerm : ''}`, null,
      h('p', { class: 'ss-hint', text: 'ממוצע משוקלל לכל מקצוע (לפי משקל המבחנים, באחוזים). הממוצע הכללי — ממוצע המקצועות.' + (rankOn ? '' : ' הדירוג הכיתתי כבוי (בהגדרות).') }),
      table(['שם', ...subjects.map(numTh), numTh('ממוצע'), rankOn ? numTh('מקום') : null, ''].filter(Boolean), rows, 'sc-table-tight'));
  }
  function reportCardNode(s) {
    const set = data.settings;
    const y = viewYear();
    const av = L.studentSubjectAverages(data, s.id, ui.gTerm, y.id);
    const all = L.overallAverage(av);
    // נוכחות לשנת הלימודים: מחודש הפתיחה ועד פתיחת השנה שאחריה. בלי חודש פתיחה — 12 החודשים האחרונים (לא כל השנים; f5)
    const list = L.yearsList(data).slice().reverse();
    const nextYear = list[list.findIndex(x => x.id === y.id) + 1];
    const yearFrom = y.startMonth ? y.startMonth + '-01' : L.addMonths(L.localDay().slice(0, 7), -11) + '-01';
    const yearTo = nextYear && nextYear.startMonth ? L.monthRange(L.addMonths(nextYear.startMonth, -1)).to : '';
    const att = L.attendanceStats(data, { from: yearFrom, to: yearTo, sids: [s.id] });
    const rank = set.showRanking ? L.classRanking(data, s.classId, ui.gTerm, y.id).find(r => r.student.id === s.id) : null;
    const rows = Object.keys(av).sort((a, b) => set.subjects.indexOf(a) - set.subjects.indexOf(b)).map(sub => h('tr', null,
      h('td', { class: 'sc-name', text: sub }), numTd(String(av[sub].average)), h('td', { text: L.verbalGrade(av[sub].average) }), numTd(String(av[sub].count))));
    return h('div', { class: 'sc-doc' },
      h('h2', { text: `תעודה — ${L.fullName(s)}` }),
      h('div', { class: 'sc-doc-meta', text: [set.name, L.className(data, s.classId), y.name ? 'שנת הלימודים ' + y.name : '', ui.gTerm || 'כל השנה'].filter(Boolean).join(' · ') }),
      rows.length ? table(['מקצוע', numTh('ממוצע'), 'הערכה', numTh('מבחנים')], rows) : empty('אין ציונים בתקופה הזו.'),
      h('div', { class: 'ss-row ss-row-total' }, h('span', { text: 'ממוצע כללי' }), h('span', { class: 'sc-num', text: all === null ? '—' : `${all} (${L.verbalGrade(all)})` })),
      rank ? h('div', { class: 'ss-row' }, h('span', { text: 'מקום בכיתה' }), h('span', { class: 'sc-num', text: String(rank.rank) })) : null,
      h('div', { class: 'ss-row' }, h('span', { text: 'נוכחות' }), h('span', { class: 'sc-num', text: pctText(att.pct) + (att.A ? ` · ${att.A} היעדרויות` : '') })),
      h('div', { class: 'sc-doc-sign' }, h('span', { text: 'חתימת ' + terms().teacher + ': ____________' }), h('span', { text: 'חתימת המנהל: ____________' })));
  }
  function reportCardView() {
    const studs = L.activeStudents(data, ui.gClass);
    if (!studs.some(s => s.id === ui.gStudent)) ui.gStudent = studs[0] ? studs[0].id : '';
    if (!ui.gStudent) return card('תעודה', null, empty('אין תלמידים בכיתה.'));
    const sel = h('select', { class: 'ss-input', 'aria-label': terms().one, onchange: e => { ui.gStudent = e.target.value; render(); } }, studs.map(s => h('option', { value: s.id, text: L.fullName(s), selected: s.id === ui.gStudent })));
    sel.style.width = 'auto';
    const s = studentById(ui.gStudent);
    return [h('div', { class: 'ss-toolbar' }, sel, btn('🖨 הדפסה', () => printNode(reportCardNode(s)), 'ss-btn-secondary'),
      btn('הדפסת כל הכיתה', () => printNode(h('div', null, studs.map(x => { const n = reportCardNode(x); n.style.breakAfter = 'page'; return n; }))), 'ss-btn')),
    reportCardNode(s)];
  }

  // ---------- שכר לימוד ----------
  function viewTuition() {
    const T = terms();
    const today = L.localDay();
    const y = viewYear();
    const cur = y.current;
    const sum = L.tuitionSummary(data, today, y.id);
    const views = [['accounts', 'חשבונות'], ['debtors', 'חייבים'], ['payments', 'תשלומים שהתקבלו']];
    const chips = h('div', { class: 'sc-chips', role: 'group', 'aria-label': 'תצוגה' }, views.map(([id, l]) =>
      h('button', { type: 'button', class: 'ss-chip' + (ui.tView === id ? ' sc-chip-on' : ''), 'aria-pressed': ui.tView === id ? 'true' : 'false', onclick: () => { ui.tView = id; render(); } }, l)));
    const out = [
      h('div', { class: 'ss-kpis' },
        h('div', { class: 'ss-kpi' }, h('small', { text: 'חיוב שנתי (נטו)' }), h('strong', null, L.fmtMoney(sum.plannedAg))),
        sum.carryAg ? h('div', { class: 'ss-kpi' }, h('small', { text: 'יתרה משנה קודמת' }), h('strong', null, L.fmtMoney(sum.carryAg))) : null,
        h('div', { class: 'ss-kpi' }, h('small', { text: 'שולם' }), h('strong', null, L.fmtMoney(sum.paidAg))),
        h('div', { class: 'ss-kpi' }, h('small', { text: 'יתרה פתוחה לשנה' }), h('strong', null, L.fmtMoney(sum.openAg))),
        h('div', { class: 'ss-kpi' }, h('small', { text: 'פיגור (מועד עבר)' }), h('strong', null, L.fmtMoney(sum.arrearsAg)))),
      h('section', { class: 'ss-card ss-card-accent sc-legal' },
        h('p', { style: 'margin:0' }, h('strong', { text: 'שכר לימוד אינו תרומה. ' }), 'אין להנפיק עליו קבלת תרומה (סעיף 46). אישורי התשלום כאן הם ', h('strong', { text: 'אישור תשלום פנימי, אינו קבלה לצורכי מס' }), ' — קבלה רשמית מפיקים במערכת הכלכלית לפי הנחיית רואה החשבון.'),
        h('p', { class: 'ss-hint', style: 'margin-bottom:0', text: `${T.many} בחינוך המיוחד פטורים כברירת מחדל משכר לימוד ומדמי רישום. אין לפגוע ב${T.one} בשל אי תשלום של הוריו. סכומי החובה — לפי מה שאושר למוסד.` })),
      h('div', { class: 'ss-toolbar' }, yearSelect(), chips, h('div', { class: 'ss-push ss-actions' }, cur ? btn('החלת תוכנית על ' + T.cls, applyPlanToClass) : null,
        perms().exp ? btn('ייצוא חייבים CSV', () => download(`debts-${stamp()}.csv`, L.debtsCsv(data, today, y.id))) : null))
    ];
    if (!cur) out.push(h('div', { class: 'sc-alert sc-alert-warn' }, `צפייה בשנת הלימודים ${y.name || ''} — לקריאה בלבד. תשלום על יתרה משנה קודמת נרשם בשנה הנוכחית.`));
    if (ui.tView === 'debtors') out.push(debtorsCard(today, y));
    else if (ui.tView === 'payments') out.push(paymentsCard(y));
    else out.push(accountsCard(today, y));
    return out;
  }
  function accountsCard(today, y) {
    const T = terms();
    const cls = h('select', { class: 'ss-input', 'aria-label': T.cls, onchange: e => { ui.tClass = e.target.value; render(); } }, classOptions(ui.tClass, `כל ה${T.classes}`));
    cls.style.width = 'auto';
    const paidIn = new Set(data.payments.filter(p => (p.yearId || data.yearId) === y.id).map(p => p.sid));
    const studs = L.searchStudents(data, { classId: ui.tClass, status: 'all', q: ui.tq })
      .filter(s => (y.current && s.status === 'active') || y.plans[s.id] || y.carry[s.id] || paidIn.has(s.id));
    const rows = studs.map(s => {
      const b = L.studentBalance(data, s.id, today, y.id);
      const tags = [b.totals.exempt && b.hasPlan ? badge('פטור — חינוך מיוחד', 'info') : s.specialEd ? badge('חינוך מיוחד', 'info') : null, s.status === 'left' ? badge('עזב', 'danger') : null];
      return h('tr', null, h('td', null, h('span', { class: 'sc-name', text: L.fullName(s) }), ' ', tags), h('td', { text: L.className(data, s.classId) || '—' }),
        b.hasPlan ? numTd(L.fmtMoney(b.chargeAg + b.carryAg)) : h('td', { class: 'ss-muted', text: 'אין תוכנית' }),
        numTd(L.fmtMoney(b.paidAg)), numTd(L.fmtMoney(b.balanceAg), b.balanceAg < 0 ? 'sc-pos' : ''),
        numTd(b.arrearsAg ? L.fmtMoney(b.arrearsAg) : '—', b.arrearsAg ? 'sc-neg' : ''),
        h('td', null, h('div', { class: 'ss-actions' },
          y.current ? btn('תשלום', () => addPaymentFlow(s), 'ss-btn-primary ss-btn-sm') : null,
          y.current ? btn(b.plan ? 'תוכנית' : '＋ תוכנית', () => editPlan(s), 'ss-btn ss-btn-sm') : null,
          btn('כרטיס חשבון', () => statement(s, y.id), 'ss-btn ss-btn-sm'))));
    });
    const q = h('input', { type: 'search', class: 'ss-input', placeholder: 'חיפוש', 'aria-label': 'חיפוש', value: ui.tq });
    q.addEventListener('change', () => { ui.tq = q.value; render(); });
    return card('חשבונות', [q, cls], studs.length ? table(['שם', T.cls, numTh('חיוב שנתי'), numTh('שולם'), numTh('יתרה'), numTh('פיגור'), ''], rows, 'sc-table-tight') : empty(`אין ${T.many}.`));
  }
  function debtorsCard(today, y) {
    const T = terms();
    const list = L.debtors(data, today, y.id);
    const rows = list.map(r => h('tr', null, h('td', { class: 'sc-name', text: L.fullName(r.student) }), h('td', { text: L.className(data, r.student.classId) || '—' }),
      h('td', { text: [r.student.father, r.student.mother].filter(Boolean).join(' / ') || '—' }), h('td', { class: 'sc-num', text: r.student.phone1 || '—' }),
      numTd(L.fmtMoney(r.paidAg)), numTd(L.fmtMoney(r.arrearsAg), 'sc-neg'),
      h('td', null, h('div', { class: 'ss-actions' }, y.current ? btn('תשלום', () => addPaymentFlow(r.student), 'ss-btn-primary ss-btn-sm') : null, btn('כרטיס חשבון', () => statement(r.student, y.id), 'ss-btn ss-btn-sm')))));
    return card(`חייבים (${list.length})`, null,
      h('p', { class: 'ss-hint', text: 'פיגור = תשלומי חובה שמועדם עבר ויתרה משנה קודמת, פחות מה ששולם. תשלומי רשות לא נכנסים לפיגור. למי שעזב — החיוב עד חודש העזיבה.' }),
      list.length ? table(['שם', T.cls, 'הורים', 'טלפון', numTh('שולם'), numTh('פיגור'), ''], rows, 'sc-table-tight') : empty('אין חייבים. 👍'));
  }
  function paymentsCard(y) {
    const list = data.payments.filter(p => (p.yearId || data.yearId) === y.id).sort((a, b) => b.no - a.no);
    const canCancel = perms().del;
    const rows = list.map(p => {
      const s = studentById(p.sid);
      return h('tr', { class: p.cancelled ? 'sc-strike' : '' }, numTd(String(p.no)), h('td', { class: 'sc-num', text: fmtDay(p.date) }), h('td', { class: 'sc-name', text: s ? L.fullName(s) : '—' }),
        numTd(L.fmtMoney(p.amountAg)), h('td', { text: L.PAY_METHODS[p.method] + (p.ref ? ' · ' + p.ref : '') }), h('td', { text: p.payer || '—' }),
        h('td', null, p.cancelled ? badge('בוטל', 'danger') : null, p.cancelled ? h('span', { class: 'ss-muted', text: ' ' + cancelText(p) }) : null),
        h('td', null, h('div', { class: 'ss-actions' }, btn('אישור', () => showConfirmation(p), 'ss-btn ss-btn-sm'), p.cancelled || !canCancel ? null : btn('ביטול', () => cancelPaymentFlow(p), 'ss-btn-ghost ss-btn-sm'))));
    });
    return card(`תשלומים שהתקבלו (${list.length})`, null,
      h('p', { class: 'ss-hint', text: 'כל תשלום מקבל מספר רץ שלא חוזר. ביטול מסמן את הרשומה ולא ממחזר את המספר.' }),
      list.length ? table([numTh('מס׳'), 'תאריך', 'שם', numTh('סכום'), 'אמצעי', 'משלם', 'מצב', ''], rows, 'sc-table-tight') : empty('לא נרשמו תשלומים.'));
  }
  function planFields(p) {
    const item = cat => p && p.items.find(i => i.category === cat);
    const ag = cat => { const it = item(cat); return it ? (it.amountAg / 100).toFixed(2) : ''; };
    const pct = p && p.discounts.find(d => d.pctBp);
    const amt = p && p.discounts.find(d => d.amountAg);
    const s = data.settings;
    return [
      { type: 'section', label: 'חיובים לשנה (₪)' },
      { name: 'tuition', label: 'שכר לימוד', value: ag('tuition'), inputmode: 'decimal', placeholder: '0.00' },
      { name: 'registration', label: 'דמי רישום (חד-פעמי)', value: ag('registration'), inputmode: 'decimal', placeholder: '0.00', hint: 'לתלמיד חדש בלבד' },
      { name: 'talan', label: 'תל"ן', value: ag('talan'), inputmode: 'decimal', placeholder: '0.00' },
      { name: 'optional', label: 'רשות (הסעות, צהרון...)', value: ag('optional'), inputmode: 'decimal', placeholder: '0.00', hint: 'לא נכנס לפיגור' },
      { type: 'section', label: 'הנחות ומלגות (על שכר הלימוד)' },
      { name: 'pctLabel', label: 'הנחה באחוזים — סיבה', value: pct ? pct.label : '', placeholder: 'הנחת אחים' },
      { name: 'pct', label: 'אחוז הנחה', value: pct ? String(pct.pctBp / 100) : '', inputmode: 'decimal', placeholder: '0' },
      { name: 'amtLabel', label: 'מלגה בסכום — סיבה', value: amt ? amt.label : '', placeholder: 'מלגה' },
      { name: 'amt', label: 'סכום המלגה (₪)', value: amt ? (amt.amountAg / 100).toFixed(2) : '', inputmode: 'decimal', placeholder: '0.00' },
      { type: 'section', label: 'פריסה' },
      { name: 'installments', label: 'מספר תשלומים', type: 'number', value: String(p ? p.installments : s.defaultInstallments), min: 1, maxNum: 24 },
      { name: 'startMonth', label: 'חודש התשלום הראשון', type: 'month', value: (p && p.startMonth) || s.yearStartMonth || L.localDay().slice(0, 7) }
    ];
  }
  function planFromValues(v, prev) {
    const items = [];
    for (const [cat, label] of [['tuition', 'שכר לימוד'], ['registration', 'דמי רישום'], ['talan', 'תל"ן'], ['optional', 'רשות']]) {
      if (!v[cat]) continue;
      const ag = L.parseShekels(v[cat]);
      if (ag === null) throw new Error(`סכום לא תקין: ${label}`);
      if (ag) items.push({ category: cat, label, amountAg: ag });
    }
    const discounts = [];
    if (v.pct) {
      const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(v.pct);
      const bp = m ? Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0')) : NaN;
      if (!(bp > 0 && bp <= 10000)) throw new Error('אחוז ההנחה צריך להיות בין 0 ל-100');
      discounts.push({ label: v.pctLabel || 'הנחה', pctBp: bp });
    }
    if (v.amt) {
      const ag = L.parseShekels(v.amt);
      if (!ag) throw new Error('סכום המלגה לא תקין');
      discounts.push({ label: v.amtLabel || 'מלגה', amountAg: ag });
    }
    const n = Number(v.installments);
    if (!Number.isInteger(n) || n < 1 || n > 24) throw new Error('מספר התשלומים — 1 עד 24');
    if (!L.isMonth(v.startMonth)) throw new Error('חודש התשלום הראשון לא תקין');
    return L.normPlan({ items, discounts, installments: n, startMonth: v.startMonth, exemptOverride: v.charge ? false : null, note: v.note !== undefined ? v.note : (prev && prev.note) });
  }
  async function editPlan(s) {
    const p = data.plans[s.id];
    const fields = planFields(p);
    if (s.specialEd) fields.push({ name: 'charge', label: 'לגבות שכר לימוד ודמי רישום למרות חינוך מיוחד', type: 'checkbox', value: p && p.exemptOverride === false, wide: true, hint: 'כברירת מחדל תלמיד בחינוך המיוחד פטור. סמנו רק אם יש לכך הצדקה מוסדרת.' });
    fields.push({ name: 'note', label: 'הערה', type: 'textarea', value: p ? p.note : '', max: 300 });
    let plan = null;
    const v = await formDialog(`תוכנית שכר לימוד — ${L.fullName(s)}`, fields, {
      validate: v => { try { plan = planFromValues(v, p); return null; } catch (e) { return e.message; } }
    });
    if (!v || !plan) return;
    const r = commit(d => { d.plans[s.id] = plan; });
    if (r.ok) {
      const w = L.registrationWarning(plan);
      toast('התוכנית נשמרה');
      if (w) ssDialog.alert(w, { title: 'דמי רישום' });
    }
  }
  async function applyPlanToClass() {
    const T = terms();
    if (!data.classes.length) { ssDialog.alert(`אין ${T.classes}.`); return; }
    const fields = [{ name: 'classId', label: T.cls, type: 'select', value: ui.tClass || data.classes[0].id, options: data.classes.map(c => ({ value: c.id, label: c.name })) },
      { name: 'overwrite', label: 'להחליף גם תוכניות קיימות', type: 'checkbox', value: false }, ...planFields(null)];
    let plan = null;
    const v = await formDialog(`החלת תוכנית על ${T.cls}`, fields, {
      submitText: 'החלה',
      validate: v => { try { plan = planFromValues(v, null); return plan.items.length ? null : 'יש להזין לפחות חיוב אחד'; } catch (e) { return e.message; } }
    });
    if (!v || !plan) return;
    const r = commit(d => {
      let n = 0;
      for (const s of L.activeStudents(d, v.classId)) {
        if (d.plans[s.id] && !v.overwrite) continue;
        d.plans[s.id] = JSON.parse(JSON.stringify(plan));
        n++;
      }
      return n;
    });
    if (r.ok) toast(`התוכנית הוחלה על ${r.result} ${T.many}`);
  }
  async function addPaymentFlow(s) {
    const b = L.studentBalance(data, s.id, L.localDay());
    const suggested = b.arrearsAg || (b.schedule.find(x => x.month >= L.localDay().slice(0, 7)) || {}).amountAg || 0;
    let amountAg = 0;
    const v = await formDialog(`רישום תשלום — ${L.fullName(s)}`, [
      { name: 'amount', label: 'סכום (₪)', value: suggested ? (suggested / 100).toFixed(2) : '', required: true, inputmode: 'decimal', hint: b.hasPlan ? `יתרה לשנה ${L.fmtMoney(b.balanceAg)} · פיגור ${L.fmtMoney(b.arrearsAg)}` : 'אין תוכנית שכר לימוד' },
      { name: 'date', label: 'תאריך', type: 'date', value: L.localDay(), required: true },
      { name: 'method', label: 'אמצעי תשלום', type: 'select', value: 'cash', options: Object.keys(L.PAY_METHODS).map(k => ({ value: k, label: L.PAY_METHODS[k] })) },
      { name: 'payer', label: 'שם המשלם', value: [s.father, s.last].filter(Boolean).join(' '), max: 80 },
      // פרטים שרוב הזמן לא צריך — מקופלים; בהמחאה הם נפתחים (מספר ההמחאה חובה)
      { name: 'ref', label: 'אסמכתה / מספר המחאה', value: '', max: 60, more: true, openWhen: ['method', 'check'] },
      { name: 'note', label: 'הערה', value: '', max: 200, wide: true, more: true }
    ], {
      submitText: 'רישום התשלום',
      validate: v => {
        amountAg = L.parseShekels(v.amount);
        if (!amountAg) return 'סכום לא תקין (לדוגמה 750 או 1,250.50)';
        if (!L.isDay(v.date)) return 'תאריך לא תקין';
        if (v.method === 'check' && !v.ref) return 'בהמחאה צריך למלא את מספר ההמחאה (ב"פרטים נוספים")';
        return null;
      }
    });
    if (!v) return;
    // המספר נקבע רק אחרי שהשמירה הצליחה
    const r = commit(d => L.addPayment(d, { sid: s.id, amountAg, date: v.date, method: v.method, ref: v.ref, payer: v.payer, note: v.note }));
    if (r.ok && r.result) { toast(`תשלום מס׳ ${r.result.no} נרשם`); showConfirmation(r.result); }
  }
  // f108: ביטול — רק עם הרשאת data.delete; נרשמים הזמן והמשתמש
  const cancelText = p => [p.cancelReason, p.cancelledBy ? 'על ידי ' + p.cancelledBy : '', p.cancelledAt ? fmtStamp(p.cancelledAt) : ''].filter(Boolean).join(' · ');
  function fmtStamp(t) { const day = t.slice(0, 10); return (L.isDay(day) ? fmtDay(day) : '') + (t.length > 11 ? ' ' + t.slice(11, 16) : ''); }
  function nowStamp() { const d = new Date(); return `${L.localDay(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
  async function cancelPaymentFlow(p) {
    if (!perms().del) { denyDelete(); return; }
    const reason = await ssDialog.prompt(`ביטול תשלום מס׳ ${p.no} (${L.fmtMoney(p.amountAg)}). סיבת הביטול:`, '', { title: 'ביטול תשלום' });
    if (reason === null) return;
    const r = commit(d => L.cancelPayment(d, p.id, reason || 'בוטל', { at: nowStamp(), by: perms().user }));
    if (r.ok) toast('התשלום בוטל; המספר לא ימוחזר');
  }
  function confirmationNode(p) {
    const s = studentById(p.sid);
    const set = data.settings;
    return h('div', { class: 'sc-doc' },
      h('h2', { text: `אישור תשלום מס׳ ${p.no}` + (p.cancelled ? ' — בוטל' : '') }),
      h('div', { class: 'sc-doc-meta', text: [set.name || 'המוסד', (L.yearInfo(data, p.yearId) || {}).name ? 'שנת הלימודים ' + L.yearInfo(data, p.yearId).name : ''].filter(Boolean).join(' · ') }),
      h('div', { class: 'ss-row' }, h('span', { text: 'תאריך' }), h('span', { class: 'sc-num', text: fmtDay(p.date) })),
      h('div', { class: 'ss-row' }, h('span', { text: 'עבור' }), h('span', { text: s ? `${L.fullName(s)}${s.classId ? ' · ' + L.className(data, s.classId) : ''}` : '—' })),
      h('div', { class: 'ss-row' }, h('span', { text: 'התקבל מאת' }), h('span', { text: p.payer || '—' })),
      h('div', { class: 'ss-row' }, h('span', { text: 'אמצעי תשלום' }), h('span', { text: L.PAY_METHODS[p.method] + (p.ref ? ` (${p.ref})` : '') })),
      p.note ? h('div', { class: 'ss-row' }, h('span', { text: 'הערה' }), h('span', { text: p.note })) : null,
      h('div', { class: 'ss-row ss-row-big' }, h('span', { text: 'סכום' }), h('span', { class: 'sc-num', text: L.fmtMoney(p.amountAg) })),
      h('div', { class: 'sc-doc-note' }, h('strong', { text: 'אישור תשלום פנימי, אינו קבלה לצורכי מס.' }), ' שכר לימוד אינו תרומה.'),
      h('div', { class: 'sc-doc-sign' }, h('span', { text: 'חתימה: ____________' })));
  }
  function showConfirmation(p) {
    openDlg('אישור תשלום', [confirmationNode(p)], [btn('🖨 הדפסת אישור התשלום', () => printNode(confirmationNode(p)), 'ss-btn-primary sc-big'), btn('סגירה', () => closeDlg(null))]);
  }
  function statement(s, yearId = data.yearId) {
    const today = L.localDay();
    const b = L.studentBalance(data, s.id, today, yearId);
    const y = L.yearInfo(data, b.yearId);
    const month = today.slice(0, 7);
    const t = b.totals;
    const node = () => h('div', { class: 'sc-doc' },
      h('h2', { text: `כרטיס חשבון — ${L.fullName(s)}` }),
      h('div', { class: 'sc-doc-meta', text: [data.settings.name, L.className(data, s.classId), y.name, 'נכון ל-' + fmtDay(today)].filter(Boolean).join(' · ') }),
      !b.hasPlan ? h('p', { class: 'ss-hint', text: 'לא הוגדרה תוכנית שכר לימוד.' }) : null,
      b.left ? h('p', { class: 'ss-hint', text: `עזב ב-${fmtDay(s.leftOn)} — החיוב עד חודש העזיבה.` }) : null,
      b.leftNoDate ? h('p', { class: 'ss-hint', text: 'עזב, אבל לא נרשם תאריך עזיבה — החיוב לפי כל הלוח. כדי לעצור את החיוב, הזינו את תאריך העזיבה בעריכת התלמיד.' }) : null,
      b.hasPlan ? h('div', null,
        b.carryAg ? h('div', { class: 'ss-row' }, h('span', { text: b.carryAg < 0 ? 'יתרת זכות משנה קודמת' : 'יתרה משנה קודמת' }), h('span', { class: 'sc-num', text: (b.carryAg < 0 ? '-' : '') + L.fmtMoney(Math.abs(b.carryAg)) })) : null,
        Object.keys(L.CATEGORIES).filter(c => t.byCat[c]).map(c => h('div', { class: 'ss-row' }, h('span', { text: L.CATEGORIES[c].label }), h('span', { class: 'sc-num', text: L.fmtMoney(t.byCat[c]) }))),
        t.exemptAg ? h('div', { class: 'ss-row' }, h('span', { text: 'פטור — חינוך מיוחד' }), h('span', { class: 'sc-num', text: L.fmtMoney(t.exemptAg) })) : null,
        t.discountAg ? h('div', { class: 'ss-row' }, h('span', { text: 'הנחות ומלגות (כבר קוזזו)' }), h('span', { class: 'sc-num', text: '-' + L.fmtMoney(t.discountAg) })) : null,
        h('div', { class: 'ss-row ss-row-total' }, h('span', { text: 'סה"כ לשנה' }), h('span', { class: 'sc-num', text: L.fmtMoney(b.chargeAg + b.carryAg) })),
        h('div', { class: 'ss-row' }, h('span', { text: 'שולם' }), h('span', { class: 'sc-num', text: L.fmtMoney(b.paidAg) })),
        h('div', { class: 'ss-row ss-row-big' }, h('span', { text: b.balanceAg < 0 ? 'יתרת זכות' : 'יתרה לתשלום' }), h('span', { class: 'sc-num', text: L.fmtMoney(Math.abs(b.balanceAg)) })),
        b.arrearsAg ? h('div', { class: 'ss-row' }, h('span', { class: 'sc-neg', text: 'מתוכה בפיגור' }), h('span', { class: 'sc-num sc-neg', text: L.fmtMoney(b.arrearsAg) })) : null,
        h('h4', { class: 'ss-section-title', text: 'לוח תשלומים' }),
        table([numTh('#'), 'חודש', numTh('חובה'), numTh('רשות'), numTh('סה"כ'), ''], b.schedule.map(r => h('tr', null, numTd(String(r.no)), h('td', { class: 'sc-num', text: r.month.split('-').reverse().join('/') }),
          numTd(L.fmtMoney(r.mandatoryAg)), numTd(L.fmtMoney(r.optionalAg)), numTd(L.fmtMoney(r.amountAg)), h('td', null, r.month <= month ? badge('מועד עבר') : null))), 'sc-table-tight')) : null,
      h('h4', { class: 'ss-section-title', text: 'תשלומים' }),
      (() => { const ps = data.payments.filter(p => p.sid === s.id && (p.yearId || data.yearId) === b.yearId).sort((a, c) => a.no - c.no); return ps.length ? table([numTh('מס׳'), 'תאריך', numTh('סכום'), 'אמצעי', 'מצב'], ps.map(p => h('tr', { class: p.cancelled ? 'sc-strike' : '' }, numTd(String(p.no)), h('td', { class: 'sc-num', text: fmtDay(p.date) }), numTd(L.fmtMoney(p.amountAg)), h('td', { text: L.PAY_METHODS[p.method] + (p.ref ? ' · ' + p.ref : '') }), h('td', null, p.cancelled ? badge('בוטל', 'danger') : badge('התקבל', 'success')))), 'sc-table-tight') : h('p', { class: 'ss-muted', text: 'לא נרשמו תשלומים.' }); })(),
      h('div', { class: 'sc-doc-note', text: 'שכר לימוד אינו תרומה. מסמך פנימי — אינו קבלה לצורכי מס.' }));
    openDlg('כרטיס חשבון', [node()], [y.current ? btn('תשלום', () => { closeDlg(null); addPaymentFlow(s); }, 'ss-btn-primary') : null, btn('🖨 הדפסה', () => printNode(node())), btn('סגירה', () => closeDlg(null))].filter(Boolean));
  }

  // ---------- הגדרות ----------
  function viewSettings() {
    const s = data.settings;
    const T = terms();
    const subjInput = h('input', { class: 'ss-input', placeholder: 'מקצוע חדש', 'aria-label': 'מקצוע חדש', maxlength: 40 });
    subjInput.style.width = 'auto';
    const addSubj = () => {
      const v = subjInput.value.trim();
      if (!v) return;
      if (s.subjects.includes(v)) { toast('המקצוע כבר קיים'); return; }
      commit(d => { d.settings.subjects.push(v.slice(0, 40)); });
    };
    subjInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addSubj(); } });
    const subjects = h('div', { class: 'sc-chips' }, s.subjects.map((x, i) => h('span', { class: 'ss-chip' }, x,
      h('button', { type: 'button', class: 'ss-btn-ghost ss-btn-sm', 'aria-label': 'הסרת ' + x, title: 'הסרה', onclick: () => commit(d => { d.settings.subjects.splice(i, 1); }) }, '✕'))));

    const editGeneral = async () => {
      const v = await formDialog('פרטי המוסד', [
        { name: 'name', label: 'שם המוסד', value: s.name, required: true, max: 120 },
        { name: 'type', label: 'סוג המוסד', type: 'select', value: s.type, options: Object.keys(L.INSTITUTION_TYPES).map(k => ({ value: k, label: L.INSTITUTION_TYPES[k] })) },
        { name: 'year', label: 'שנת הלימודים', value: s.year, placeholder: 'תשפ"ז', max: 30 },
        { name: 'yearStartMonth', label: 'חודש פתיחת השנה', type: 'month', value: s.yearStartMonth, hint: 'לחישוב נוכחות שנתית ולוחות תשלומים' },
        { name: 'terms', label: 'תקופות (מופרדות בפסיק)', value: s.terms.join(', '), wide: true, max: 200 },
        { name: 'sessions', label: 'סדרים בכולל (מופרדים בפסיק)', value: s.sessions.join(', '), wide: true, max: 200 }
      ]);
      if (!v) return;
      const split = x => [...new Set(x.split(/[,،]/).map(y => y.trim()).filter(Boolean))];
      commit(d => {
        Object.assign(d.settings, { name: v.name.slice(0, 120), type: v.type, year: v.year.slice(0, 30), yearStartMonth: L.isMonth(v.yearStartMonth) ? v.yearStartMonth : '' });
        const t = split(v.terms).slice(0, 6); if (t.length) d.settings.terms = t.map(x => x.slice(0, 30));
        const se = split(v.sessions).slice(0, 5); if (se.length) d.settings.sessions = se.map(x => x.slice(0, 30));
      });
    };
    const editRules = async () => {
      const v = await formDialog('כללים', [
        { name: 'lowAttendancePct', label: 'סף נוכחות נמוכה (%)', type: 'number', value: String(s.lowAttendancePct), min: 1, maxNum: 100 },
        { name: 'kollelMinPct', label: 'כולל: נוכחות מינימלית לאברך (%)', type: 'number', value: String(s.kollelMinPct), min: 1, maxNum: 100 },
        { name: 'kollelMinPresent', label: 'כולל: מינימום לומדים בכל סדר', type: 'number', value: String(s.kollelMinPresent), min: 0, maxNum: 500, hint: 'לפי החוזר: 15 לכולל, 10 לשלוחה — לבדיקה מול החוזר העדכני' },
        { name: 'defaultInstallments', label: 'מספר תשלומים ברירת מחדל', type: 'number', value: String(s.defaultInstallments), min: 1, maxNum: 24 },
        { name: 'showRanking', label: 'להציג דירוג כיתתי בגיליון ובתעודה', type: 'checkbox', value: s.showRanking, wide: true }
      ], {
        validate: v => {
          const ok = (x, a, b) => Number.isInteger(Number(x)) && Number(x) >= a && Number(x) <= b;
          if (!ok(v.lowAttendancePct, 1, 100) || !ok(v.kollelMinPct, 1, 100)) return 'אחוז — בין 1 ל-100';
          if (!ok(v.kollelMinPresent, 0, 500)) return 'מינימום לומדים — 0 עד 500';
          if (!ok(v.defaultInstallments, 1, 24)) return 'מספר תשלומים — 1 עד 24';
          return null;
        }
      });
      if (!v) return;
      commit(d => Object.assign(d.settings, { lowAttendancePct: Number(v.lowAttendancePct), kollelMinPct: Number(v.kollelMinPct), kollelMinPresent: Number(v.kollelMinPresent), defaultInstallments: Number(v.defaultInstallments), showRanking: v.showRanking }));
    };
    // פתיחת שנת לימודים (f5): התוכניות והתשלומים של השנה הנוכחית נשמרים לצפייה, והיתרות עוברות כשורה מפורשת
    const newYear = async () => {
      const v = await formDialog('פתיחת שנת לימודים חדשה', [
        { name: 'name', label: 'שם השנה החדשה', value: '', required: true, max: 30, placeholder: 'תשפ"ח' },
        { name: 'startMonth', label: 'חודש הפתיחה', type: 'month', value: s.yearStartMonth ? L.addMonths(s.yearStartMonth, 12) : L.localDay().slice(0, 7), required: true }
      ], {
        submitText: 'פתיחת השנה',
        extra: h('p', { class: 'ss-hint', text: `תוכניות שכר הלימוד והתשלומים של השנה הנוכחית${s.year ? ' (' + s.year + ')' : ''} יישמרו לצפייה. לכל ${terms().one} שנשארה לו יתרה (חוב או זכות) תירשם בשנה החדשה שורה "יתרה משנה קודמת". את תוכניות שכר הלימוד לשנה החדשה מגדירים מחדש.` }),
        validate: v => (!L.isMonth(v.startMonth) ? 'חודש הפתיחה אינו תקין' : v.name === s.year ? 'שם השנה החדשה זהה לשנה הנוכחית' : s.yearStartMonth && v.startMonth <= s.yearStartMonth ? 'חודש הפתיחה חייב להיות אחרי חודש הפתיחה של השנה הנוכחית' : null)
      });
      if (!v) return;
      const r = commit(d => L.openNewYear(d, { name: v.name, startMonth: v.startMonth }));
      if (r.ok) { ui.year = ''; toast(`נפתחה שנת הלימודים ${v.name}. יתרות עברו ל-${r.result.carried} ${terms().many}.`); }
    };
    const wipe = async () => {
      if (!perms().del) { denyDelete(); return; }
      const ok = await ssDialog.confirm('למחוק את כל נתוני המוסד (תלמידים, נוכחות, ציונים ותשלומים)? אין דרך לבטל, מלבד שחזור מגיבוי.', { title: 'מחיקת כל הנתונים', okText: 'מחיקה', danger: true });
      if (!ok) return;
      const typed = await ssDialog.prompt('לאישור הקלידו: מחק', '', { title: 'אישור סופי' });
      if (typed !== 'מחק') return;
      // המספור של אישורי התשלום נשמר — לא מתחיל מחדש
      commit(d => { const seq = L.nextPaymentNo(d) - 1; const keep = d.settings; const fresh = L.emptyData(); Object.keys(d).forEach(k => delete d[k]); Object.assign(d, fresh, { settings: keep, paySeq: seq }); });
    };
    const row = (k, v) => h('div', { class: 'ss-row' }, h('span', { class: 'ss-muted', text: k }), h('span', { text: v || '—' }));
    const hasDemo = data.students.some(x => x.demo);
    return [h('div', { class: 'ss-grid' },
      card('פרטי המוסד', [btn('עריכה', editGeneral, 'ss-btn ss-btn-sm'), btn('פתיחת שנת לימודים', newYear, 'ss-btn ss-btn-sm')],
        row('שם', s.name), row('סוג', L.INSTITUTION_TYPES[s.type]), row('שנת הלימודים', s.year), row('חודש פתיחה', s.yearStartMonth ? s.yearStartMonth.split('-').reverse().join('/') : ''),
        row('תקופות', s.terms.join(', ')), isKollel() ? row('סדרים', s.sessions.join(', ')) : null,
        data.years.length ? row('שנים קודמות', data.years.map(y => y.name).join(', ')) : null),
      card('כללים', btn('עריכה', editRules, 'ss-btn ss-btn-sm'),
        row('סף נוכחות נמוכה', s.lowAttendancePct + '%'), isKollel() ? row('נוכחות מינימלית לאברך', s.kollelMinPct + '%') : null,
        isKollel() ? row('מינימום לומדים בסדר', String(s.kollelMinPresent)) : null, row('תשלומים ברירת מחדל', String(s.defaultInstallments)),
        row('דירוג כיתתי', s.showRanking ? 'מוצג' : 'כבוי'))),
    card('מקצועות', null, subjects, h('div', { class: 'ss-toolbar' }, subjInput, btn('＋ הוספה', addSubj, 'ss-btn ss-btn-sm'))),
    card('נתונים', null,
      h('p', { class: 'ss-hint', text: 'הנתונים נשמרים במחשב בלבד (מוצפנים על ידי התוכנה) ונכללים בגיבוי של התוכנה. קובצי CSV נפתחים באקסל.' }),
      perms().exp ? h('div', { class: 'ss-toolbar' },
        btn(`ייצוא ${T.many} CSV`, () => download(`students-${stamp()}.csv`, L.studentsCsv(data))),
        btn('ייצוא נוכחות החודש CSV', () => download(`attendance-${L.localDay().slice(0, 7)}.csv`, L.attendanceCsv(data, L.localDay().slice(0, 7)))),
        isKollel() ? null : btn('ייצוא חייבים CSV', () => download(`debts-${stamp()}.csv`, L.debtsCsv(data)))) : null,
      h('div', { class: 'ss-toolbar' },
        hasDemo ? btn('הסרת נתוני הדוגמה', removeDemo, 'ss-btn-secondary') : canLoadDemo() ? btn('טעינת נתוני דוגמה', loadDemo, 'ss-btn-secondary') : null,
        perms().del ? h('div', { class: 'ss-push' }, btn('מחיקת כל הנתונים', wipe, 'ss-btn-danger')) : null))];
  }

  // ---------- קישור ישיר לפעולה (מהמעטפת) ----------
  // #ss-action=<id> — רק מהרשימה הסגורה; אחרת מתעלמים. ה-hash נמחק. הפעולה רק פותחת מסך או טופס, לא שומרת
  const ACTIONS = {
    'attendance-today': () => { ui.attDay = L.localDay(); go('att'); },
    'new-student': () => { ui.tab = 'students'; saveUi(); render(); editStudent(null); },
    // תשלום: מסך החשבונות — מחפשים את התלמיד ולוחצים "תשלום" בשורה שלו (בכולל אין שכר לימוד)
    'new-payment': () => {
      if (isKollel()) { go('dash'); return; }
      ui.tView = 'accounts'; ui.year = ''; go('tuition');
      const q = $('view').querySelector('input[type=search]');
      if (q) q.focus();
      toast(`חפשו את ה${terms().one} ולחצו "תשלום" בשורה שלו`);
    },
    grades: () => { ui.gView = 'tests'; go('grades'); }
  };
  // רשימה סגורה: Map (לא גישה דינמית לאובייקט לפי שם שמגיע מהכתובת)
  const ACTION_MAP = new Map(Object.entries(ACTIONS));
  async function takeAction() {
    const loc = window.location;
    const m = loc && /^#ss-action=([a-z0-9-]{1,40})(?:&|$)/.exec(String(loc.hash || ''));
    if (!m) return;
    try { window.history.replaceState(null, '', loc.pathname + loc.search); } catch (e) { /* בלי היסטוריה */ }
    const fn = ACTION_MAP.get(m[1]);
    if (typeof fn !== 'function') return;
    // טופס פתוח (תלמיד, תשלום) לא נזרק בשקט: שואלים קודם; "להמשיך למלא" ← הפעולה לא מתבצעת
    if (dlgResolve) {
      const ok = await ssDialog.confirm('יש טופס פתוח שעוד לא נשמר. לסגור אותו בלי לשמור?', { title: 'טופס פתוח', okText: 'סגירה בלי שמירה', cancelText: 'להמשיך למלא' });
      if (!ok) return;
      closeDlg(null);
    }
    fn();
  }
  window.addEventListener('hashchange', takeAction);

  // ---------- התחלה ----------
  // שינוי ממסך אחר (גיבוי ששוחזר) — טעינה מחדש
  window.addEventListener('storage', e => { if (e.key === null || L.isDataKey(e.key)) { data = load(); render(); } });
  // הרשאות שהגיעו או השתנו (אנדרואיד: frame.js) — הכפתורים מוצגים מחדש
  window.addEventListener('ss-perms', () => render());
  render();
  takeAction();
})();
