// ממשק המודול הכלכלי — דיאלוגים, כניסה, הודעות ושגיאות.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

// ===== דיאלוגים בתוך האפליקציה (prompt/confirm לא נתמכים ב-Electron) =====
// מונע הזרקת HTML מטקסט שהמשתמש הזין (XSS)
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// שגיאות בשפה פשוטה (r4 נגישות): מה קרה ומה לעשות עכשיו. הודעה טכנית באנגלית לא מגיעה למשתמש כמו שהיא
const PLAIN_ERRORS = [
  [/^Invalid credentials$/, 'שם המשתמש או הסיסמה לא נכונים. בדקו שהמקלדת בעברית/אנגלית כמו שצריך, ונסו שוב.'],
  [/^Admin user already exists$/, 'כבר יש מנהל במערכת. היכנסו עם שם המשתמש והסיסמה שלו.'],
  [/^Password must be at least 12 characters$/, 'הסיסמה קצרה מדי — צריך לפחות 12 תווים. אפשר משפט קצר, למשל שלוש מילים ומספר.'],
  [/ENOSPC|no space left/i, 'אין מספיק מקום פנוי בכונן. פנו מקום (למשל מחקו קבצים מיותרים) ונסו שוב.'],
  [/EACCES|EPERM|permission denied/i, 'אין גישה לקובץ או לתיקייה. בחרו מקום אחר (למשל "מסמכים") ונסו שוב.'],
  [/SQLITE_BUSY|database is locked/i, 'המערכת עסוקה כרגע. חכו כמה שניות ונסו שוב.'],
  [/EBUSY|resource busy|locked/i, 'הקובץ פתוח בתוכנה אחרת. סגרו אותו ונסו שוב.'],
  [/ENOENT|no such file/i, 'הקובץ לא נמצא. ייתכן שהוא הועבר או נמחק — בחרו אותו שוב.'],
  [/Failed to fetch|NetworkError|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network/i, 'אין חיבור לשרת כרגע. בדקו את החיבור לאינטרנט ונסו שוב מאוחר יותר.'],
  [/Unexpected token|JSON/i, 'הקובץ שנבחר אינו בפורמט הנכון. בדקו שבחרתם את הקובץ הנכון.'],
];
function errMsg(error) {
  const raw = String((error && error.message) || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  // הודעה בעברית מהשרת — כבר מנוסחת למשתמש
  if (/[֐-׿]/.test(raw)) return raw;
  for (const [re, text] of PLAIN_ERRORS) if (re.test(raw)) return text;
  // הודעה פנימית באנגלית (באג, TypeError וכו') — הסבר פשוט במקום טקסט טכני
  return 'משהו השתבש. נסו שוב; אם זה חוזר — שמרו "דוח תקלה" (F1) ופנו לתמיכה.';
}

// ===== מקלדת בחלונות (r4 נגישות): Tab נשאר בתוך החלון, Escape סוגר, והמיקוד חוזר למקום שממנו נפתח =====
const FOCUSABLE_SEL = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
function focusablesIn(container) {
  if (!container || typeof container.querySelectorAll !== 'function') return [];
  // שדה מתקדם מוסתר רק במצב פשוט — במצב הרגיל הוא גלוי וחלק ממעגל ה-Tab
  const simple = isSimpleMode();
  return [...container.querySelectorAll(FOCUSABLE_SEL)].filter(el => {
    if (el.closest && el.closest(simple ? '[hidden], .hidden, .ss-advanced' : '[hidden], .hidden')) return false;
    if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
    return true;
  });
}
// מצב פשוט של המעטפת: <html data-ss-simple="on">
function isSimpleMode() {
  const html = typeof document !== 'undefined' ? document.documentElement : null;
  return !!(html && typeof html.getAttribute === 'function' && html.getAttribute('data-ss-simple') === 'on');
}
// Tab / Shift+Tab — מעגל בתוך החלון. מחזיר true אם טופל
function trapTab(e, container) {
  if (e.key !== 'Tab') return false;
  const list = focusablesIn(container);
  if (!list.length) { e.preventDefault(); return true; }
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement;
  const inside = active && container.contains && container.contains(active);
  if (e.shiftKey && (active === first || !inside)) { e.preventDefault(); last.focus(); return true; }
  if (!e.shiftKey && (active === last || !inside)) { e.preventDefault(); first.focus(); return true; }
  return false;
}
// המקום שממנו נפתח החלון — כדי להחזיר אליו את המיקוד בסגירה
function rememberFocus() {
  const a = typeof document !== 'undefined' ? document.activeElement : null;
  return a && a !== document.body && typeof a.focus === 'function' ? a : null;
}
function restoreFocus(el) {
  if (el && typeof el.focus === 'function' && (!document.body || !document.body.contains || document.body.contains(el))) el.focus();
}

// שגיאה בחלון קטן (r4 נגישות): ההודעה מוקראת מיד (role=alert), השדה מסומן (aria-invalid)
// ומקושר להודעה (aria-describedby), והמיקוד עובר אליו — המשתמש יודע בדיוק מה לתקן
function dialogFieldError(err, input, message) {
  if (!err) return;
  if (!err.id) err.id = 'dlgErr' + (++dialogSeq);
  if (!err.getAttribute('role')) err.setAttribute('role', 'alert');
  err.textContent = message;
  const form = input && input.closest ? input.closest('form') : null;
  if (form && form.querySelectorAll) form.querySelectorAll('[aria-invalid]').forEach(i => i.removeAttribute('aria-invalid'));
  if (!input || typeof input.setAttribute !== 'function') return;
  input.setAttribute('aria-invalid', 'true');
  const ids = String(input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  if (!ids.includes(err.id)) input.setAttribute('aria-describedby', [err.id, ...ids].join(' '));
  if (typeof input.focus === 'function') input.focus();
}

// opts.screen — מסך מלא (כניסה / מנהל ראשון): בלי סגירה ב-Escape, המשתמש חייב להשלים
let dialogSeq = 0;
function openDialog(build, opts = {}) {
  return new Promise((resolve) => {
    const returnTo = rememberFocus();
    const overlay = document.createElement('div');
    overlay.className = opts.screen ? 'modal auth-screen' : 'modal';
    overlay.setAttribute('role', opts.role || 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const card = document.createElement('div');
    card.className = 'modal-card';
    if (opts.screen) card.classList.add('auth-card'); else card.style.maxWidth = '420px';
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      restoreFocus(returnTo);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && !opts.screen) { e.preventDefault(); finish(null); return; }
      trapTab(e, overlay);
    };
    document.addEventListener('keydown', onKey, true);
    build(card, finish);
    // חלון בלי כותרת מקושרת — הכותרת הראשונה בו נותנת לו שם
    if (overlay.getAttribute && !overlay.getAttribute('aria-labelledby') && card.querySelector) {
      const h = card.querySelector('h2, h3');
      if (h) { if (!h.id) h.id = 'dlgTitle' + (++dialogSeq); overlay.setAttribute('aria-labelledby', h.id); }
    }
  });
}

// אישור לפני פעולה: כפתורים במילים ("כן, למחוק" / "לא, לחזור") במקום "אישור" כללי.
// opts: { okText, cancelText, danger } — ברירת מחדל לפי הפועל שבתחילת השאלה.
// בפעולה מסוכנת המיקוד מתחיל ב"לא, לחזור" — Enter בטעות לא מוחק
function confirmLabels(message, opts = {}) {
  const m = /^(?:⚠\s*)?(?:האם\s+)?(ל[א-ת]+)/.exec(String(message || ''));
  const verb = m ? m[1] : '';
  const DANGER = /^(למחוק|לבטל|להסיר|לסגור|לנעול|לנתק|להתעלם|לדלג|לשחזר|לחזור)$/;
  const danger = opts.danger !== undefined ? !!opts.danger : DANGER.test(verb);
  const okText = opts.okText || (verb && verb.length <= 8 ? 'כן, ' + verb : 'כן, להמשיך');
  return { okText, cancelText: opts.cancelText || 'לא, לחזור', danger };
}
function askConfirm(message, opts = {}) {
  const { okText, cancelText, danger } = confirmLabels(message, opts);
  return openDialog((card, finish) => {
    const h = document.createElement('h2');
    h.textContent = danger ? 'לפני שממשיכים' : 'אישור';
    h.id = 'dlgTitle' + (++dialogSeq);
    const p = document.createElement('p');
    p.textContent = message;
    p.id = 'dlgDesc' + dialogSeq;
    p.style.padding = '0 1.5rem';
    p.style.whiteSpace = 'pre-line';
    if (card.parentNode && card.parentNode.setAttribute) {
      card.parentNode.setAttribute('aria-labelledby', h.id);
      card.parentNode.setAttribute('aria-describedby', p.id);
    }
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary';
    cancel.textContent = cancelText;
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = danger ? 'danger' : 'primary';
    ok.textContent = okText;
    cancel.addEventListener('click', () => finish(false));
    ok.addEventListener('click', () => finish(true));
    actions.append(cancel, ok);
    card.append(h, p, actions);
    (danger ? cancel : ok).focus();
  }, { role: 'alertdialog' });
}

// ראש מסך הכניסה (PLAN.md 7.2): הלוגו, שם התוכנה וברכה לפי השעה. הלוגו כ-SVG בתוך העמוד — בלי קובץ חיצוני
const AUTH_LOGO = '<svg viewBox="0 0 512 512" width="52" height="52" aria-hidden="true"><defs>' +
  '<linearGradient id="authG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--ss-gold-bright)"/><stop offset=".55" style="stop-color:var(--ss-gold-bright)"/><stop offset="1" style="stop-color:var(--ss-gold)"/></linearGradient>' +
  '<linearGradient id="authS" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--ss-navy-3)"/><stop offset="1" style="stop-color:var(--ss-navy-1)"/></linearGradient></defs>' +
  '<rect x="24" y="24" width="464" height="464" rx="112" fill="url(#authG)"/>' +
  '<path d="M256 92 L296 216 L420 256 L296 296 L256 420 L216 296 L92 256 L216 216 Z" fill="url(#authS)"/></svg>';
function authGreeting(now = new Date()) {
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'בוקר טוב';
  if (h >= 12 && h < 17) return 'צהריים טובים';
  if (h >= 17 && h < 22) return 'ערב טוב';
  return 'לילה טוב';
}
function authHeader(card, intro) {
  const head = document.createElement('div');
  head.className = 'auth-head';
  head.innerHTML = AUTH_LOGO + '<b>SuperSuite</b>';
  const hello = document.createElement('div');
  hello.className = 'auth-hello';
  hello.textContent = authGreeting() + (intro ? ' — ' + intro : '');
  head.appendChild(hello);
  card.appendChild(head);
}

// opts.altText — כפתור נוסף (למשל "כניסה עם Google"); לחיצה עליו מחזירה { alt: true }
// opts.screen — מסך כניסה מלא: { intro, note } — בלי "ביטול" (אין לאן לחזור בלי משתמש)
// שדה עם same: '<name>' — חייב להיות זהה לשדה אחר (אימות סיסמה)
function askFields(title, fields, submitText, initial = {}, opts = {}) {
  return openDialog((card, finish) => {
    if (opts.screen) authHeader(card, opts.screen.intro);
    const h = document.createElement('h2');
    h.textContent = title;
    h.id = 'dlgTitle' + (++dialogSeq);
    if (card.parentNode && card.parentNode.setAttribute) card.parentNode.setAttribute('aria-labelledby', h.id);
    const form = document.createElement('form');
    form.className = 'modal-form';
    form.noValidate = true;
    const inputs = {};
    const seq = ++dialogSeq;
    const errId = 'dlgErr' + seq;
    for (const f of fields) {
      const label = document.createElement('label');
      label.textContent = f.label;
      const input = document.createElement('input');
      input.type = f.type || 'text';
      input.name = f.name;
      input.id = 'dlgF' + seq + '_' + f.name;
      label.htmlFor = input.id;
      input.autocomplete = f.type === 'password' ? (f.newPassword ? 'new-password' : 'current-password') : 'username';
      input.value = initial[f.name] || '';
      if (!f.optional) input.setAttribute('aria-required', 'true');
      label.appendChild(input);
      if (f.hint) {
        const hint = document.createElement('small');
        hint.className = 'field-hint';
        hint.id = input.id + '_hint';
        hint.textContent = f.hint;
        label.appendChild(hint);
        input.setAttribute('aria-describedby', hint.id);
      }
      form.appendChild(label);
      // סיסמה: כפתור "הצגת הסיסמה" — לבדוק מה הוקלד בלי לנחש (r4 נגישות)
      if (f.type === 'password') {
        const show = document.createElement('button');
        show.type = 'button';
        show.className = 'ghost small pw-toggle';
        show.textContent = 'הצגת הסיסמה';
        show.setAttribute('aria-pressed', 'false');
        show.setAttribute('aria-controls', input.id);
        show.addEventListener('click', () => {
          const visible = input.type === 'password';
          input.type = visible ? 'text' : 'password';
          show.textContent = visible ? 'הסתרת הסיסמה' : 'הצגת הסיסמה';
          show.setAttribute('aria-pressed', visible ? 'true' : 'false');
        });
        form.appendChild(show);
      }
      inputs[f.name] = input;
    }
    if (opts.screen && opts.screen.note) {
      const note = document.createElement('div');
      note.className = 'auth-note';
      note.textContent = opts.screen.note;
      form.appendChild(note);
    }
    // הודעת שגיאה: מוקראת מיד (role=alert) ומקושרת לשדה (aria-describedby + aria-invalid)
    const err = document.createElement('div');
    err.id = errId;
    err.setAttribute('role', 'alert');
    err.className = 'form-error';
    err.style.color = 'var(--ss-danger-ink)';
    err.style.fontSize = '0.95rem';
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary';
    cancel.textContent = 'ביטול';
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'primary';
    ok.textContent = submitText;
    if (opts.screen) actions.append(ok); else actions.append(cancel, ok);
    if (opts.altText) {
      const alt = document.createElement('button');
      alt.type = 'button';
      alt.className = opts.screen ? 'secondary auth-alt' : 'secondary';
      alt.textContent = opts.altText;
      alt.addEventListener('click', () => finish({ alt: true }));
      actions.prepend(alt);
    }
    form.append(err, actions);
    card.append(h, form);

    const fieldError = (f, message) => {
      for (const i of Object.values(inputs)) if (i.removeAttribute) i.removeAttribute('aria-invalid');
      const input = inputs[f.name];
      err.textContent = message;
      input.setAttribute('aria-invalid', 'true');
      const hintId = f.hint ? input.id + '_hint' : '';
      input.setAttribute('aria-describedby', [errId, hintId].filter(Boolean).join(' '));
      input.focus();
    };
    cancel.addEventListener('click', () => finish(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const values = {};
      for (const f of fields) {
        const raw = inputs[f.name].value;
        const v = f.type === 'password' ? raw : raw.trim();
        // optional: שדה רשות (מסומן "לא חובה" בתווית) — נשלח ריק (סקירת קוד 2.11.2026)
        if (!v && !f.optional) {
          fieldError(f, `חסר: ${f.label}. מלאו את השדה ולחצו שוב על "${submitText}".`);
          return;
        }
        if (f.same && v !== values[f.same]) {
          fieldError(f, `${f.label} — אינה זהה לסיסמה הראשונה. הקלידו אותה שוב בדיוק.`);
          return;
        }
        values[f.name] = v;
      }
      finish(values);
    });
    const first = Object.values(inputs).find(i => !i.value) || Object.values(inputs)[0];
    if (first) first.focus();
  }, { screen: !!opts.screen });
}

// Setup admin
async function setupAdmin() {
  // מסד ששוחזר אחרי תקלה בלי משתמשים — המנהל נוצר רק עם קוד השחזור (🔑) של המחשב (סקירת קוד 2.11.2026)
  const st = window.systemAPI.authStatus ? await window.systemAPI.authStatus().catch(() => null) : null;
  const needCode = !!(st && st.recoveryCodeRequired);
  const values = await askFields('יצירת מנהל ראשון', [
    { name: 'username', label: 'שם משתמש' },
    { name: 'password', label: 'סיסמה', type: 'password', newPassword: true, hint: 'לפחות 12 תווים. משפט קצר שקל לזכור — למשל שלוש מילים ומספר' },
    { name: 'password2', label: 'הסיסמה שוב', type: 'password', newPassword: true, same: 'password' },
    ...(needCode ? [{ name: 'recoveryCode', label: 'קוד השחזור (🔑)', hint: 'במערכת יש נתונים אבל אין משתמשים (שוחזרה אחרי תקלה) — הקלידו את קוד השחזור שנרשם על נייר' }] : [])
  ], 'צור מנהל והתחל', {}, { screen: {
    intro: needCode ? 'שחזור הגישה למערכת' : 'ברוכים הבאים',
    note: 'זה המנהל של התוכנה: הוא יכול להוסיף משתמשים ולקבוע מה כל אחד רואה. את הסיסמה אי אפשר לשחזר — רשמו אותה ושמרו במקום בטוח.'
  } });
  if (!values) return;
  try {
    state.user = needCode
      ? await window.systemAPI.setupAdmin(values.username, values.password, values.recoveryCode)
      : await window.systemAPI.setupAdmin(values.username, values.password);
    showToast('מנהל נוצר בהצלחה');
  } catch (error) {
    showError('שגיאה ביצירת מנהל: ' + errMsg(error));
  }
}

// Login user — שומר את שם המשתמש האחרון אחרי ניסיון כושל
let lastLoginUser = '';
async function loginUser() {
  const st = await window.systemAPI.authStatus().catch(() => null);
  const google = !!(st && st.google && st.google.enabled && window.systemAPI.googleLogin);
  const values = await askFields('התחברות למערכת', [
    { name: 'username', label: 'שם משתמש' },
    { name: 'password', label: 'סיסמה', type: 'password' }
  ], 'התחבר', { username: lastLoginUser }, { screen: { intro: 'נא להתחבר כדי להמשיך' }, ...(google ? { altText: 'כניסה עם Google' } : {}) });
  if (!values) return;
  if (values.alt) {
    showToast('המשיכו את הכניסה בדפדפן שנפתח…');
    try {
      state.user = await window.systemAPI.googleLogin();
      showToast('התחברות בהצלחה');
    } catch (error) {
      showError('שגיאה בכניסה עם Google: ' + errMsg(error));
    }
    return;
  }
  lastLoginUser = values.username;
  try {
    state.user = await window.systemAPI.login(values.username, values.password);
    showToast('התחברות בהצלחה');
  } catch (error) {
    showError('שגיאה בהתחברות: ' + errMsg(error));
  }
}

// Close modal
function closeModal() {
  elements.modal.classList.add('hidden');
  elements.modalForm.innerHTML = '';
  clearFormError();
  if (modalKeyHandler && typeof document.removeEventListener === 'function') document.removeEventListener('keydown', modalKeyHandler, true);
  modalKeyHandler = null;
  const back = modalReturnFocus;
  modalReturnFocus = null;
  restoreFocus(back);
  // עריכת רשומה דרסה את ערכי השדות שבסכימה; מחזירים אותם כדי שטופס "הוספה"
  // הבא ייפתח נקי. כל יציאה מהחלון (ביטול / × / שמירה) עוברת כאן.
  const schema = formSchemas[state.currentView];
  state.subForm = null;
  if (schema && state.fieldValuesBackup) {
    schema.fields.forEach((f, i) => { f.value = state.fieldValuesBackup[i]; });
  }
  state.fieldValuesBackup = null;
  state.editingId = null;
}

// Show modal — החלון הראשי של הטפסים (#modal): מיקוד בשדה הראשון, Tab נשאר בחלון, Escape סוגר,
// ובסגירה המיקוד חוזר לכפתור שפתח אותו (r4 נגישות)
let modalKeyHandler = null;
let modalReturnFocus = null;
function showModal(title, formHtml) {
  const wasOpen = !elements.modal.classList.contains('hidden');
  if (!wasOpen) modalReturnFocus = rememberFocus();
  elements.modalTitle.textContent = title;
  elements.modalForm.innerHTML = requiredNote(formHtml) + formHtml;
  clearFormError();
  elements.modal.classList.remove('hidden');
  setupAdvancedToggle(elements.modalForm);
  if (!modalKeyHandler && typeof document.addEventListener === 'function') {
    modalKeyHandler = (e) => {
      if (elements.modal.classList.contains('hidden')) return;
      // חלון אחר (אישור / שאלה) פתוח מעל הטופס — הוא מטפל במקשים
      if (document.body && document.body.querySelector && document.body.querySelector('.modal:not(#modal)')) return;
      if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
      trapTab(e, elements.modal);
    };
    document.addEventListener('keydown', modalKeyHandler, true);
  }
  const first = focusablesIn(elements.modalForm)[0] || elements.submitBtn;
  if (first && typeof first.focus === 'function') first.focus();
}

// "שדות עם (חובה) חייבים להיות מלאים" — רק כשיש בטופס שדה חובה
function requiredNote(formHtml) {
  return /\baria-required="true"/.test(String(formHtml || '')) ? '<p class="ss-hint form-required-note">שדות שמסומנים <b>(חובה)</b> — חייבים למלא. כל השאר — לפי הצורך.</p>' : '';
}

// מצב פשוט (data-ss-simple="on"): שדות מתקדמים (.ss-advanced) מוסתרים, וכפתור "עוד אפשרויות" מציג אותם.
// ההצגה מסירה את המחלקה (ולא תלויה בכלל CSS של מישהו אחר) ומסמנת data-ss-was-advanced להסתרה חוזרת
function setupAdvancedToggle(form) {
  if (!form || typeof form.querySelectorAll !== 'function') return;
  const adv = form.querySelectorAll('.ss-advanced');
  if (!adv.length) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'secondary small ss-more-toggle';
  btn.textContent = 'עוד אפשרויות';
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', () => revealAdvanced(form, btn.getAttribute('aria-expanded') !== 'true'));
  form.appendChild(btn);
}
function revealAdvanced(form, show) {
  if (!form || typeof form.querySelectorAll !== 'function') return;
  const sel = show ? '.ss-advanced' : '[data-ss-was-advanced]';
  form.querySelectorAll(sel).forEach(el => {
    if (show) { el.classList.remove('ss-advanced'); el.setAttribute('data-ss-was-advanced', '1'); }
    else { el.classList.add('ss-advanced'); el.removeAttribute('data-ss-was-advanced'); }
  });
  const btn = form.querySelector('.ss-more-toggle');
  if (btn) { btn.setAttribute('aria-expanded', show ? 'true' : 'false'); btn.textContent = show ? 'פחות אפשרויות' : 'עוד אפשרויות'; }
}

// שגיאה בטופס הראשי: ליד השדה (aria-invalid + aria-describedby) ובראש החלון (role=alert)
function showFormError(message, fieldName) {
  clearFormError();
  const box = typeof document.getElementById === 'function' ? document.getElementById('modalError') : null;
  if (box) { box.textContent = message; box.hidden = false; }
  if (!fieldName) return;
  const input = document.getElementById('f_' + fieldName);
  if (!input || typeof input.setAttribute !== 'function') return;
  // שדה מתקדם מוסתר — מציגים אותו, אחרת המשתמש לא ימצא את השגיאה
  if (input.closest && input.closest('.ss-advanced')) revealAdvanced(elements.modalForm, true);
  input.setAttribute('aria-invalid', 'true');
  const errEl = document.getElementById('e_' + fieldName);
  if (errEl) { errEl.textContent = message; errEl.hidden = false; }
  if (typeof input.focus === 'function') input.focus();
}
function clearFormError() {
  if (typeof document.getElementById !== 'function') return;
  const box = document.getElementById('modalError');
  if (box) { box.textContent = ''; box.hidden = true; }
  const form = elements.modalForm;
  if (form && typeof form.querySelectorAll === 'function') {
    form.querySelectorAll('[aria-invalid]').forEach(i => i.removeAttribute('aria-invalid'));
    form.querySelectorAll('.field-error').forEach(e => { e.textContent = ''; e.hidden = true; });
  }
}

// Show toast notification — מוקרא (aria-live), ונשאר 6 שניות (3 היו קצרות מדי לקריאה)
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  elements.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

// Show error notification
// פגישה שפגה (חוסר פעילות): מציגים שוב את מסך הכניסה ואחר כך טוענים מחדש את התצוגה
let reloginPending = false;
function maybeRelogin(message) {
  if (!String(message).includes('נדרשת כניסה')) return;
  relogin();
}
// חלון כניסה אחד בכל פעם, והמסך נשאר ריק עד שמישהו נכנס (גם אחרי סיסמה שגויה).
// אחרי הכניסה — טעינה מחדש של המסך בשם המשתמש החדש (סקירת קוד 2.11.2026)
function relogin() {
  if (reloginPending) return reloginPending;
  resetUiForLogout();
  reloginPending = (async () => {
    try {
      while (!state.user) await loginUser();
      await switchView(state.currentView);
    } finally { reloginPending = false; }
  })();
  return reloginPending;
}
// יציאה / החלפת משתמש / ניתוק: שום דבר מהמשתמש הקודם לא נשאר על המסך או בזיכרון הממשק —
// המסך, החלון הפתוח, state.data וזיכרוני המסכים (עוזר ה-AI, מעבדת התמהיל, השמאות, טיוטת הודעה, נדל"ן)
const UI_KEEP_ON_LOGOUT = ['currentView', 'acctKeysBound', 'viewSeq', 'searchSeq'];
function resetUiForLogout() {
  if (elements.modal && !elements.modal.classList.contains('hidden')) closeModal();
  // אשף פתוח — מה שהוקלד בו לא נשאר למשתמש הבא
  if (wizActive) wizClose();
  toggleHelp(false);
  for (const k of Object.keys(state)) if (!UI_KEEP_ON_LOGOUT.includes(k)) delete state[k];
  Object.assign(state, { user: null, data: {}, loading: false, error: null, editingId: null, fieldValuesBackup: null, subForm: null });
  // טעינה או חיפוש שעוד בדרך לא יתרנדרו מעל מסך הכניסה
  state.viewSeq = (state.viewSeq || 0) + 1;
  state.searchSeq = (state.searchSeq || 0) + 1;
  Object.assign(aiUi, { busy: false, answer: null, error: '' });
  Object.assign(rltyUi, { tab: 'properties', matches: null, deal: null, inv: {}, invResult: null, analysisId: '', table: null, proj: null, projResult: null });
  if (elements.view) elements.view.innerHTML = '';
}

// שגיאה: מוקראת מיד (אזור role=alert), נשארת עד שסוגרים או 20 שניות, ועם כפתור סגירה.
// בטופס פתוח — מוצגת גם בתוך החלון, ליד כפתור השמירה (r4 נגישות)
function showError(message) {
  maybeRelogin(message);
  const toast = document.createElement('div');
  toast.className = 'toast danger';
  const text = document.createElement('span');
  text.textContent = '⚠ ' + message;
  toast.appendChild(text);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.textContent = '×';
  if (close.setAttribute) close.setAttribute('aria-label', 'סגירת ההודעה');
  close.addEventListener('click', () => toast.remove());
  toast.appendChild(close);
  const host = elements.alertContainer || elements.toastContainer;
  host.appendChild(toast);
  setTimeout(() => toast.remove(), 20000);
  if (elements.modal && elements.modal.classList && !elements.modal.classList.contains('hidden')) {
    const box = typeof document.getElementById === 'function' ? document.getElementById('modalError') : null;
    if (box && !box.textContent) { box.textContent = message; box.hidden = false; }
  }
}
