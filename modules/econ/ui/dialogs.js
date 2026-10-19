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

function errMsg(error) {
  const raw = String((error && error.message) || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const known = {
    'Invalid credentials': 'שם משתמש או סיסמה שגויים',
    'Admin user already exists': 'כבר קיים מנהל במערכת',
    'Password must be at least 12 characters': 'הסיסמה חייבת להכיל לפחות 12 תווים'
  };
  return known[raw] || raw;
}

// opts.screen — מסך מלא (כניסה / מנהל ראשון): בלי סגירה ב-Escape, המשתמש חייב להשלים
let dialogSeq = 0;
function openDialog(build, opts = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = opts.screen ? 'modal auth-screen' : 'modal';
    overlay.setAttribute('role', 'dialog');
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
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape' && !opts.screen) { e.preventDefault(); finish(null); } };
    document.addEventListener('keydown', onKey, true);
    build(card, finish);
  });
}

function askConfirm(message) {
  return openDialog((card, finish) => {
    const h = document.createElement('h2');
    h.textContent = 'אישור';
    const p = document.createElement('p');
    p.textContent = message;
    p.style.padding = '0 1.5rem';
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary';
    cancel.textContent = 'ביטול';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'danger';
    ok.textContent = 'אישור';
    cancel.addEventListener('click', () => finish(false));
    ok.addEventListener('click', () => finish(true));
    actions.append(cancel, ok);
    card.append(h, p, actions);
    ok.focus();
  });
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
    card.parentNode.setAttribute('aria-labelledby', h.id);
    const form = document.createElement('form');
    form.className = 'modal-form';
    form.noValidate = true;
    const inputs = {};
    for (const f of fields) {
      const label = document.createElement('label');
      label.textContent = f.label;
      const input = document.createElement('input');
      input.type = f.type || 'text';
      input.name = f.name;
      input.autocomplete = f.type === 'password' ? (f.newPassword ? 'new-password' : 'current-password') : 'username';
      input.value = initial[f.name] || '';
      label.appendChild(input);
      if (f.hint) {
        const hint = document.createElement('small');
        hint.className = 'field-hint';
        hint.textContent = f.hint;
        label.appendChild(hint);
      }
      form.appendChild(label);
      inputs[f.name] = input;
    }
    if (opts.screen && opts.screen.note) {
      const note = document.createElement('div');
      note.className = 'auth-note';
      note.textContent = opts.screen.note;
      form.appendChild(note);
    }
    const err = document.createElement('div');
    err.style.color = 'var(--ss-danger)';
    err.style.fontSize = '0.9rem';
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

    cancel.addEventListener('click', () => finish(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const values = {};
      for (const f of fields) {
        const raw = inputs[f.name].value;
        const v = f.type === 'password' ? raw : raw.trim();
        if (!v) {
          err.textContent = 'יש למלא את השדה: ' + f.label;
          inputs[f.name].focus();
          return;
        }
        if (f.same && v !== values[f.same]) {
          err.textContent = f.label + ' — אינה זהה';
          inputs[f.name].focus();
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
  const values = await askFields('יצירת מנהל ראשון', [
    { name: 'username', label: 'שם משתמש' },
    { name: 'password', label: 'סיסמה', type: 'password', newPassword: true, hint: 'לפחות 12 תווים. משפט קצר שקל לזכור — למשל שלוש מילים ומספר' },
    { name: 'password2', label: 'הסיסמה שוב', type: 'password', newPassword: true, same: 'password' }
  ], 'צור מנהל והתחל', {}, { screen: {
    intro: 'ברוכים הבאים',
    note: 'זה המנהל של התוכנה: הוא יכול להוסיף משתמשים ולקבוע מה כל אחד רואה. את הסיסמה אי אפשר לשחזר — רשמו אותה ושמרו במקום בטוח.'
  } });
  if (!values) return;
  try {
    state.user = await window.systemAPI.setupAdmin(values.username, values.password);
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

// Show modal
function showModal(title, formHtml) {
  elements.modalTitle.textContent = title;
  elements.modalForm.innerHTML = formHtml;
  elements.modal.classList.remove('hidden');
}

// Show toast notification
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  elements.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Show error notification
// פגישה שפגה (חוסר פעילות): מציגים שוב את מסך הכניסה ואחר כך טוענים מחדש את התצוגה
let reloginPending = false;
function maybeRelogin(message) {
  if (!String(message).includes('נדרשת כניסה') || reloginPending) return;
  reloginPending = true;
  state.user = null;
  loginUser().then(() => {
    if (state.user) switchView(state.currentView);
  }).finally(() => { reloginPending = false; });
}

function showError(message) {
  maybeRelogin(message);
  const toast = document.createElement('div');
  toast.className = 'toast danger';
  toast.textContent = message;
  elements.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}
