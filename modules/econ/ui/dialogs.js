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

function openDialog(build) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const card = document.createElement('div');
    card.className = 'modal-card';
    card.style.maxWidth = '420px';
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
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(null); } };
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

// opts.altText — כפתור נוסף (למשל "כניסה עם Google"); לחיצה עליו מחזירה { alt: true }
function askFields(title, fields, submitText, initial = {}, opts = {}) {
  return openDialog((card, finish) => {
    const h = document.createElement('h2');
    h.textContent = title;
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
      input.autocomplete = f.type === 'password' ? 'current-password' : 'username';
      input.value = initial[f.name] || '';
      label.appendChild(input);
      form.appendChild(label);
      inputs[f.name] = input;
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
    actions.append(cancel, ok);
    if (opts.altText) {
      const alt = document.createElement('button');
      alt.type = 'button';
      alt.className = 'secondary';
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
        values[f.name] = v;
      }
      finish(values);
    });
    const first = Object.values(inputs)[0];
    if (first) first.focus();
  });
}

// Setup admin
async function setupAdmin() {
  const values = await askFields('יצירת מנהל ראשון', [
    { name: 'username', label: 'שם משתמש' },
    { name: 'password', label: 'סיסמה (לפחות 12 תווים)', type: 'password' }
  ], 'צור מנהל');
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
  ], 'התחבר', { username: lastLoginUser }, google ? { altText: 'כניסה עם Google' } : {});
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
