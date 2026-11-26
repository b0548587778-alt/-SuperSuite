// ממשק המודול הכלכלי — חלונות קלט ופעולות במסך הרישוי.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

// ---------- חלונות קלט למסך הרישוי ----------
// טופס כללי: שדות טקסט/מספר/בחירה ותיבות סימון. מחזיר ערכים או null בביטול
function licForm(title, fields, submitText, intro) {
  return openDialog((card, finish) => {
    card.style.maxWidth = '520px';
    const h = document.createElement('h2');
    h.textContent = title;
    card.appendChild(h);
    if (intro) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.style.padding = '0 1.5rem';
      p.textContent = intro;
      card.appendChild(p);
    }
    const form = document.createElement('form');
    form.className = 'modal-form';
    form.noValidate = true;
    const get = {};
    const fieldEls = {}; // לסימון השדה עם השגיאה (r4 נגישות)
    for (const f of fields) {
      if (f.type === 'checks') {
        const box = document.createElement('fieldset');
        const lg = document.createElement('legend');
        lg.textContent = f.label;
        box.appendChild(lg);
        const inputs = [];
        for (const [value, label] of f.options) {
          const l = document.createElement('label');
          l.className = 'check';
          const c = document.createElement('input');
          c.type = 'checkbox';
          c.value = value;
          c.checked = (f.value || []).includes(value);
          if (f.allowed && !f.allowed.includes(value)) { c.disabled = true; c.checked = false; }
          l.append(c, document.createTextNode(' ' + label));
          box.appendChild(l);
          inputs.push(c);
        }
        form.appendChild(box);
        fieldEls[f.name] = inputs[0];
        get[f.name] = () => inputs.filter(c => c.checked).map(c => c.value);
        continue;
      }
      const label = document.createElement('label');
      label.className = 'field';
      const span = document.createElement('span');
      span.textContent = f.label;
      let input;
      if (f.type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = f.rows || 6;
        input.dir = 'ltr';
        input.spellcheck = false;
      } else if (f.type === 'select') {
        input = document.createElement('select');
        for (const [value, text] of f.options) {
          const o = document.createElement('option');
          o.value = value;
          o.textContent = text;
          input.appendChild(o);
        }
      } else {
        input = document.createElement('input');
        input.type = f.type || 'text';
        if (f.type === 'password') input.autocomplete = 'new-password';
      }
      const val = f.value != null ? String(f.value) : '';
      // רשימת בחירה בלי ערך תואם — האפשרות הראשונה (לא רשימה ריקה שנשלחת כ-'' ונדחית באנגלית או דורסת הגדרה;
      // סקירת קוד 2.11.2026)
      if (f.type === 'select') input.selectedIndex = Math.max(0, f.options.findIndex(([v]) => String(v) === val));
      else input.value = val;
      label.append(span, input);
      form.appendChild(label);
      fieldEls[f.name] = input;
      get[f.name] = () => (f.type === 'password' ? input.value : input.value.trim());
    }
    const err = document.createElement('div');
    err.setAttribute('role', 'alert'); // שגיאה מוקראת מיד (r4 נגישות)
    err.style.color = 'var(--ss-danger)';
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
    form.append(err, actions);
    card.appendChild(form);
    cancel.addEventListener('click', () => finish(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const values = {};
      for (const f of fields) {
        const v = get[f.name]();
        if (f.required && (Array.isArray(v) ? !v.length : !v)) { dialogFieldError(err, fieldEls[f.name], `חסר: ${f.label}. מלאו את השדה ונסו שוב.`); return; }
        if (f.type === 'number') {
          // שדה ריק אינו 0 (Number('') === 0 היה נשמר בשקט כאפס)
          const n = v === '' ? NaN : Number(v);
          if (!Number.isInteger(n) || n < (f.min ?? 0) || (f.max != null && n > f.max)) {
            dialogFieldError(err, fieldEls[f.name], `${f.label}: מספר שלם${f.max != null ? ' עד ' + f.max : ''} — כתבו מספר בלי נקודה ובלי אותיות.`); return;
          }
          values[f.name] = n;
        } else values[f.name] = v;
      }
      finish(values);
    });
  });
}

// תנאים לרישיון: תחומים, מכסות ותוקף. ceiling = המגבלות של ההורה (לא ניתן לחרוג)
// options — התחומים של התוכנה (מרכז הרישוי); ברירת המחדל — של SuperSuite
function licTermsFields(ceiling, current, options = LIC_FEATURES) {
  const c = ceiling || {};
  const cur = current || {};
  const own = options === LIC_FEATURES;
  const known = new Set(options.map(o => o[0]));
  const curFeatures = cur.features ? cur.features.filter(f => known.has(f)) : null;
  const limit = (name, label, def) => ({ name, label: label + (c.limits && c.limits[name] != null ? ` (עד ${c.limits[name]})` : ''),
    type: 'number', min: 0, max: c.limits ? c.limits[name] : undefined, value: cur.limits && cur.limits[name] != null ? cur.limits[name] : def });
  return [
    { name: 'features', label: 'תחומים פתוחים', type: 'checks', options, allowed: c.features,
      value: curFeatures && curFeatures.length ? curFeatures : (!own ? [options[0][0]] : (c.features ? ['econ'] : ['econ', 'tools'])), required: true },
    limit('maxUsers', 'משתמשים פעילים', c.limits ? Math.min(3, c.limits.maxUsers) : 5),
    limit('maxChildren', 'מערכות בת', 0),
    limit('maxDepth', 'עומק מרבי בעץ', 2),
    limit('maxStorageMb', 'אחסון (MB)', c.limits ? Math.min(1000, c.limits.maxStorageMb) : 5000),
    { name: 'months', label: 'תוקף (חודשים — שנה לפחות)', type: 'number', min: 12, max: 60, value: 12 },
    { name: 'graceDays', label: 'ימי חסד אחרי התפוגה', type: 'number', min: 0, max: 90, value: 7 }
  ];
}
const licTerms = (v) => ({ features: v.features, months: v.months, graceDays: v.graceDays,
  limits: { maxUsers: v.maxUsers, maxChildren: v.maxChildren, maxDepth: v.maxDepth, maxStorageMb: v.maxStorageMb } });

// מרכז הרישוי: הנפקה לבקשה של לקוח — התוכנה (מהבקשה, או בחירה כשהבקשה לא מציינת), ואז "לפי חבילה ששולמה"
// (התחומים, המכסות והתקופה מהחבילה) או תנאים לבחירה. מחזיר את הקלט ל-ownerIssue / ownerInboxIssue (בלי request), או null
async function licIssueDialog(req, cat) {
  const title = req.renewal ? `חידוש רישיון: ${req.name}` : `לקוח חדש: ${req.name}`;
  const nameField = { name: 'name', label: 'שם הלקוח', value: req.name, required: true };
  let product = req.product || null;
  const bundles = Array.isArray(req.bundles) ? req.bundles : [];
  if (!product || bundles.length) {
    const fields = [];
    if (!product) fields.push({ name: 'product', label: 'מאיזו תוכנה הבקשה?', type: 'select', options: licProducts(cat).map(p => [p.id, p.name]), value: req.productGuess });
    if (bundles.length) fields.push({ name: 'bundle', label: 'אופן ההנפקה', type: 'select',
      options: [['', 'רגילה — תחומים ומכסות לבחירה'], ...bundles.map(b => [b.id + '|' + b.forProduct, `לפי חבילה ששולמה: ${b.customer} — ${b.planName} (${licProductName(cat, b.forProduct)})`])] });
    const intro = product ? `הבקשה נשלחה מ${licProductName(cat, product)}.` : 'הבקשה לא מציינת מאיזו תוכנה היא (גרסה קודמת). בחרו את התוכנה — התחומים יוצגו לפיה.';
    const v0 = await licForm(title, fields, 'המשך', intro);
    if (!v0) return null;
    if (v0.bundle) {
      const [bundleId, forProduct] = String(v0.bundle).split('|');
      const v = await licForm(title, [nameField], 'הנפקה',
        `הרישיון יונפק ל${licProductName(cat, forProduct)} לפי החבילה — התחומים, המכסות והתקופה כפי ששולמו, בלי תשלום נוסף.`);
      return v ? { name: v.name, product: forProduct, bundleId } : null;
    }
    if (v0.product) product = v0.product;
  }
  const current = req.current && (!req.current.product || req.current.product === product) ? req.current : null;
  const v = await licForm(`${title} · ${licProductName(cat, product)}`, [nameField, ...licTermsFields(null, current, licProductFeatures(cat, product))], 'הנפקה');
  return v ? { name: v.name, product, ...licTerms(v) } : null;
}

const licReason = (title, extra = []) => licForm(title, [...extra, { name: 'reason', label: 'סיבה (חובה — נרשמת ביומן ומוצגת למשתמשי המערכת)', required: true }], 'אישור');
const licHoldFields = [{ name: 'kind', label: 'סוג', type: 'select', options: Object.entries(LIC_HOLD_KINDS) }];

// התקנת רישיון מקובץ או מקוד. רישיון ממערכת מנפיקה אחרת (ממצא f85) — רק אחרי אישור מפורש. null — בוטל
// extra.pending — הרישיון שהתקבל בסנכרון וממתין לאישור (text ריק)
async function licInstallText(text, extra = {}) {
  const r = await window.systemAPI.installLicense(text, extra);
  if (!r || !r.confirm) return r;
  if (!(await askConfirm(r.confirm + '. להתקין בכל זאת?'))) return null;
  return window.systemAPI.installLicense(text, { ...extra, allowParentChange: true });
}

async function licSave(text, name, doneMsg) {
  const r = await window.systemAPI.saveLicenseFile(text, name);
  if (r && r.ok) showToast(doneMsg || 'הקובץ נשמר');
  return r;
}

// עטיפה לכל כפתור: שגיאה בעברית, ורענון המסך בסוף
// דוח אחרי "שליחת עדכוני סטטוס לכל המערכות" (סקירת אבטחה 24.10.2026, ממצאים 3, 5): מי לא קיבל ולמה — כולל מסירה
// שהשרת לא אישר בחתימה. טקסט בלבד (textContent) — שם הלקוח והשגיאה אינם HTML
function licPushReport(failed) {
  return openDialog((card, finish) => {
    const h = document.createElement('h2');
    h.textContent = `עדכוני סטטוס שלא נמסרו (${failed.length})`;
    const intro = document.createElement('p');
    intro.textContent = 'המערכות האלה לא קיבלו את העדכון. אפשר לנסות שוב, או לשלוח להן "קובץ עדכון" ידנית:';
    const list = document.createElement('div');
    list.className = 'ss-list';
    for (const f of failed.slice(0, 200)) {
      const row = document.createElement('div');
      row.className = 'ss-list-row';
      row.textContent = `${f.name || f.to}: ${f.error || 'לא נמסר'}`;
      list.appendChild(row);
    }
    for (const el of [intro, list]) el.style.padding = '0 1.5rem';
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'primary';
    close.textContent = 'סגירה';
    close.addEventListener('click', () => finish(true));
    actions.appendChild(close);
    card.append(h, intro, list, actions);
    close.focus();
  });
}

const licAction = (fn) => async (e) => {
  try { await fn(e); } catch (error) { showError(errMsg(error)); return; }
  await switchView('licensing');
};

function attachLicensingHandlers() {
  const d = state.data.licensing || {};
  const st = d.status || {};
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', licAction(fn)); };
  // --- הפעלת המערכת ---
  on('licActInstallBtn', async () => { const b = document.getElementById('licInstallBtn'); if (b) b.click(); });
  on('licActSyncBtn', async () => {
    const r = await window.systemAPI.licenseRemoteSync();
    (r.errors || []).forEach(e => showError(e));
    showToast('החיבור לשרת הצליח');
  });
  const each = (attr, fn) => document.querySelectorAll('[' + attr + ']').forEach(b => b.addEventListener('click', licAction(() => fn(b))));

  // --- הרישיון של המערכת ---
  on('licRequestBtn', async () => {
    const v = await licForm('הפקת בקשת רישיון', [{ name: 'name', label: 'שם המערכת / הארגון', required: true }], 'הפקה ושמירה');
    if (!v) return;
    await licSave(await window.systemAPI.getLicenseRequest(v.name), 'בקשת-רישיון-' + v.name, 'הבקשה נשמרה — שלחו אותה לספק');
  });
  on('licInstallBtn', async () => {
    const text = await pickFileText('.sslic,.json');
    if (text == null) return;
    const r = await licInstallText(text);
    if (r) showToast(`הרישיון הותקן: ${r.name}, בתוקף עד ${licDate(r.expiresAt)}`);
  });
  // קוד רישיון שהודבק = אותו תוכן כמו קובץ הרישיון — אותה התקנה ואותן בדיקות
  on('licPasteBtn', async () => {
    const v = await licForm('הדבקת קוד רישיון', [{ name: 'code', label: 'קוד הרישיון', type: 'textarea', required: true }], 'התקנה',
      'הדביקו כאן את כל הקוד שקיבלתם מהספק, מההתחלה ועד הסוף.');
    if (!v) return;
    const r = await licInstallText(v.code);
    if (r) showToast(`הרישיון הותקן: ${r.name}, בתוקף עד ${licDate(r.expiresAt)}`);
  });
  on('licBuyBtn', async () => { await startSignup(); });
  // רישיון שהתקבל בסנכרון ממערכת מנפיקה אחרת (ממצא f85) — התקנה רק אחרי אישור
  on('licPendingInstallBtn', async () => {
    const r = await licInstallText('', { pending: true });
    if (r) showToast(`הרישיון הותקן: ${r.name}, בתוקף עד ${licDate(r.expiresAt)}`);
  });
  const goMessages = document.getElementById('licGoMessagesBtn');
  if (goMessages) goMessages.addEventListener('click', () => switchView('messages'));
  on('licNoticesBtn', async () => {
    const text = await pickFileText('.sslic,.json');
    if (text == null) return;
    const r = await window.systemAPI.importLicenseNotices(text);
    showToast(r.added ? `התקבלו ${r.added} עדכונים` : 'אין עדכונים חדשים');
  });

  // --- מערכות בת (לקוח) ---
  // תשלום מערכת בת להורה: דרישת תשלום במסך הגבייה, ואחריה הודעה עם הקישור לתשלום
  const licPayFields = (name) => [{ name: 'name', label: 'שם מערכת הבת', value: name || '', required: true },
    { name: 'amount', label: 'סכום לתשלום (₪)', type: 'number', min: 1, required: true },
    { name: 'months', label: 'תקופה (חודשים — שנה לפחות)', type: 'number', min: 12, max: 60, value: 12, required: true },
    { name: 'payerPhone', label: 'טלפון המשלם (לא חובה)' }, { name: 'payerEmail', label: 'דוא"ל המשלם (לא חובה)' }];
  const licPayIntro = 'הרישיון למערכת הבת שנתי ומשולם מראש למערכת הזו. הדרישה נוספת למסך הגבייה; כשהתשלום מתקבל — מסמנים "שולם" שם (או קולטים את דוח חברת הסליקה), ואז אפשר לשלוח את בקשת האישור.';
  const licPayCreate = async (input) => {
    const r = await window.systemAPI.licenseChildPaymentRequest(input);
    await collectMessageDialog(await window.systemAPI.collectGetMessage(r.id));
  };
  on('licChildPayBtn', async () => {
    const text = await pickFileText('.sslic,.json');
    if (text == null) return;
    const v = await licForm('דרישת תשלום למערכת בת', licPayFields(''), 'יצירת דרישת תשלום', licPayIntro);
    if (!v) return;
    await licPayCreate({ request: text, ...v });
  });
  each('data-lic-remote-pay', async (b) => {
    const v = await licForm(`דרישת תשלום: ${b.dataset.name}`, licPayFields(b.dataset.name), 'יצירת דרישת תשלום', licPayIntro);
    if (!v) return;
    await licPayCreate({ keyId: b.dataset.licRemotePay, ...v });
  });
  each('data-lic-pay-msg', async (b) => {
    await collectMessageDialog(await window.systemAPI.collectGetMessage(b.dataset.licPayMsg));
  });
  on('licChildRequestBtn', async () => {
    const text = await pickFileText('.sslic,.json');
    if (text == null) return;
    const v = await licForm('בקשת אישור למערכת בת', [{ name: 'name', label: 'שם מערכת הבת', required: true },
      ...licTermsFields({ features: st.features, limits: st.limits }).filter(f => f.name !== 'months')], 'הפקת בקשה ושמירה',
    'התנאים לא יכולים לעלות על הרישיון של המערכת הזו. התוקף — לפי התקופה ששולמה. מנהל-העל יאשר או ידחה.');
    if (!v) return;
    // חלון השמירה נפתח בערוץ עצמו — התשלום מנוצל רק אחרי שהקובץ נשמר
    const r = await window.systemAPI.requestLicenseChildApproval({ request: text, name: v.name, ...licTerms(v) });
    if (r && r.saved) showToast('בקשת האישור נשמרה — שלחו אותה לספק');
  });
  on('licChildIssueBtn', async () => {
    const text = await pickFileText('.sslic,.json');
    if (text == null) return;
    const r = await window.systemAPI.issueLicenseChild({ approval: text });
    await licSave(r.package, 'רישיון-' + r.child.name, `מערכת הבת "${r.child.name}" הונפקה — העבירו את הקובץ למכשיר שלה`);
  });
  each('data-lic-child-hold', async (b) => {
    const v = await licReason('השבתת מערכת בת', licHoldFields);
    if (!v) return;
    const r = await window.systemAPI.holdLicenseChild({ childId: b.dataset.licChildHold, kind: v.kind, reason: v.reason });
    if (remoteOn) return pushChild(b.dataset.licChildHold);
    await licSave(r.package, 'עדכון-סטטוס', 'ההשבתה נרשמה — העבירו את קובץ העדכון למערכת הבת');
  });
  each('data-lic-child-release', async (b) => {
    const v = await licReason('החזרה לפעילות');
    if (!v) return;
    const r = await window.systemAPI.releaseLicenseChild({ childId: b.dataset.licChildRelease, holdId: b.dataset.hold, reason: v.reason });
    if (remoteOn) return pushChild(b.dataset.licChildRelease);
    await licSave(r.package, 'עדכון-סטטוס', 'ההחזרה נרשמה — העבירו את קובץ העדכון למערכת הבת');
  });
  each('data-lic-child-terminate', async (b) => {
    if (!(await askConfirm('סיום מערכת בת הוא סופי ואינו ניתן לביטול. להמשיך?', { danger: true, okText: 'כן, לסיים את המערכת' }))) return;
    const v = await licReason('סיום מערכת בת');
    if (!v) return;
    const r = await window.systemAPI.terminateLicenseChild({ childId: b.dataset.licChildTerminate, reason: v.reason });
    if (remoteOn) return pushChild(b.dataset.licChildTerminate);
    await licSave(r.package, 'עדכון-סטטוס', 'הסיום נרשם');
  });

  // --- עבודה מרחוק ---
  const remoteOn = !!(d.remote && d.remote.url);
  on('licRemoteSetBtn', async () => {
    const v = await licForm('שרת רישוי', [{ name: 'url', label: 'כתובת השרת (https://…) — ריק לביטול', value: (d.remote && d.remote.url) || '' }], 'שמירה',
      'הכתובת מתקבלת מהספק. בסביבה מסוננת ייתכן שיש לבקש אישור לכתובת.');
    if (!v) return;
    await window.systemAPI.setLicenseRemote(v.url);
    showToast(v.url ? 'שרת הרישוי הוגדר' : 'העבודה מרחוק בוטלה');
  });
  on('licRemoteSyncBtn', async () => {
    const r = await window.systemAPI.licenseRemoteSync();
    (r.errors || []).forEach(e => showError(e));
    showToast(r.handled ? `התקבלו ${r.handled} עדכונים` : 'אין עדכונים חדשים');
  });
  // אישור חיבור בקובץ (f81)
  on('licOfflineReqBtn', async () => {
    const r = await window.systemAPI.licenseOfflineRequest();
    await licSave(r.text, 'בקשת-אישור-חיבור', 'הבקשה נשמרה. העבירו אותה למחשב מחובר, ושם — "העברת בקשה של מחשב אחר"');
  });
  on('licOfflineRelayBtn', async () => {
    const text = await pickFileText('.sslic,.json');
    if (!text) return;
    const r = await window.systemAPI.licenseOfflineRelay(text);
    await licSave(r.text, 'אישור-חיבור', 'האישור נשמר. העבירו אותו למחשב שביקש, ושם — "טעינת אישור"');
  });
  on('licOfflineImportBtn', async () => {
    const text = await pickFileText('.sslic,.json');
    if (!text) return;
    const r = await window.systemAPI.licenseOfflineImport(text);
    (r.errors || []).forEach(e => showError(e));
    showToast('האישור נקלט' + (r.handled ? ` (${r.handled} עדכונים)` : '') + (r.deferred ? ' — הודעות נוספות ייקלטו בסנכרון עם חיבור' : ''));
  });
  on('licRemoteRequestBtn', async () => {
    const v = await licForm('בקשת רישיון מהספק', [{ name: 'name', label: 'שם המערכת / הארגון', required: true }], 'שליחה');
    if (!v) return;
    await window.systemAPI.licenseRemoteRequest(v.name);
    showToast('הבקשה נשלחה. אחרי האישור — "סנכרון עכשיו"');
  });
  on('licRemoteParentBtn', async () => {
    const v = await licForm('בקשה ממערכת מנפיקה', [{ name: 'name', label: 'שם המערכת החדשה', required: true },
      { name: 'code', label: 'קוד המערכת המנפיקה (מופיע אצלה ב"עבודה מרחוק")', required: true }], 'שליחה');
    if (!v) return;
    await window.systemAPI.licenseRemoteRequestFromParent(v.name, v.code);
    showToast('הבקשה נשלחה. אחרי האישור — "סנכרון עכשיו"');
  });
  each('data-lic-remote-forward', async (b) => {
    const v = await licForm(`בקשת אישור: ${b.dataset.name}`, [{ name: 'name', label: 'שם מערכת הבת', value: b.dataset.name, required: true },
      ...licTermsFields({ features: st.features, limits: st.limits }).filter(f => f.name !== 'months')], 'שליחה למנהל-העל',
    'התוקף — לפי התקופה ששולמה. אחרי שמנהל-העל יאשר, הרישיון יונפק ויישלח למערכת הבת אוטומטית בסנכרון הבא.');
    if (!v) return;
    await window.systemAPI.licenseRemoteForwardChild({ keyId: b.dataset.licRemoteForward, name: v.name, ...licTerms(v) });
    showToast('הבקשה נשלחה לאישור');
  });
  each('data-lic-remote-dismiss', async (b) => {
    if (!(await askConfirm('להתעלם מהבקשה? אפשר לבקש שוב מהמערכת החדשה.'))) return;
    await window.systemAPI.licenseRemoteDismissChild(b.dataset.licRemoteDismiss);
  });
  // אחרי השבתה/החזרה/סיום של מערכת בת — משלוח מיידי כשיש שרת (ללא שרת: קובץ, כמו קודם)
  const pushChild = async (id) => { if (remoteOn) { try { await window.systemAPI.licenseRemotePushChild(id); showToast('העדכון נשלח למערכת הבת'); } catch (e) { showError(errMsg(e)); } } };

  // --- מנהל-העל מרחוק ---
  on('ownerRemoteReceiveBtn', async () => {
    const r = await window.systemAPI.ownerRemoteReceive();
    showToast(r.added ? `התקבלו ${r.added} בקשות חדשות` : 'אין בקשות חדשות');
  });
  // --- הרשמה ---
  async function startSignup() {
    const offer = await window.systemAPI.getSignupOffer();
    const v = await signupWizard(offer);
    if (!v) return;
    const r = await window.systemAPI.licenseSignup(v);
    if (r.free) { showToast('ההרשמה נשלחה — הרישיון יגיע בסנכרון'); return; }
    // באנדרואיד אין פתיחת דף התשלום (license:openPayment דוחה שם בעברית)
    if (licOnAndroid(d)) { showToast('ההרשמה נשמרה. באנדרואיד אין מעבר לדף התשלום — התשלום נפתח רק בגרסת המחשב'); return; }
    showToast('נפתח דף התשלום המאובטח');
    await window.systemAPI.licenseOpenPayment();
  }
  on('signupStartBtn', async () => { await startSignup(); });
  on('signupPayBtn', async () => { await window.systemAPI.licenseOpenPayment(); });
  on('signupCheckBtn', async () => {
    const r = await window.systemAPI.licenseSignupStatus();
    showToast(r && r.status === 'submitted' ? 'התשלום התקבל — הרישיון יגיע בסנכרון' : 'התשלום עדיין לא הושלם');
  });
  on('licRemoteSyncBtn2', async () => {
    const r = await window.systemAPI.licenseRemoteSync();
    showToast(r.handled ? 'התקבלו ' + r.handled + ' עדכונים' : 'עדיין לא התקבל רישיון — נסו שוב בעוד כמה דקות');
  });
  on('ownerOfferBtn', async () => {
    const cur = await window.systemAPI.ownerGetOffer();
    const v = await offerEditor(cur, d.owner && d.owner.products);
    if (!v) return;
    await window.systemAPI.ownerSetOffer(v);
    showToast('התכניות והתקנון נחתמו ונשמרו');
  });
  on('ownerOfferPublishBtn', async () => {
    const r = await window.systemAPI.ownerPublishOffer();
    const failed = Array.isArray(r && r.failed) ? r.failed : [];
    showToast(failed.length
      ? `פורסם חלקית — לא פורסם ל: ${failed.map(f => f.name).join(', ')} (${failed[0].message}). ייתכן ששרת הרישוי צריך עדכון`
      : 'התכניות והתקנון פורסמו — מערכות חדשות יכולות להירשם');
  });
  each('data-owner-signup-issue', async (b) => {
    const id = b.dataset.ownerSignupIssue;
    let r;
    const opts = {};
    let verified = false;
    // הרשמה בתשלום שעוד לא אומתה, כשמוגדרים פרטי Cardcom — בודקים לפני ההנפקה (גם אחרי בדיקה קודמת שלא הושלמה)
    if (b.dataset.ownerVerifyFirst === '1') {
      verified = true;
      const c = await window.systemAPI.ownerVerifySignupPayment(id);
      showToast(c.message);
    }
    // אישורים אפשריים: הצעה שהוחלפה (ממצא 31) או תשלום בלי אישור חתום של השרת (f83) — force; ואימות התשלום מול
    // חברת הסליקה (סקירת קוד 2.11.2026).
    // כשמוגדרים פרטי Cardcom — קודם אימות אוטומטי במחשב הזה (החלטת הבעלים 5.11.2026); לא ניתן לאמת ← אישור ידני
    for (;;) {
      try { r = await window.systemAPI.ownerSignupIssue(id, { ...opts }); break; } catch (e) {
        const m = errMsg(e);
        if (/נדרש אימות מול Cardcom/.test(m) && !verified) {
          verified = true;
          const c = await window.systemAPI.ownerVerifySignupPayment(id);
          showToast(c.message);
          // לא תואם / לא שולם — הקריאה הבאה נחסמת בשרת עם ההסבר; לא נבדק — עוברים לאישור הידני
        } else if (/הוחלפה|בלי אישור חתום/.test(m) && !opts.force) {
          if (!(await askConfirm(m + '\n\nלהנפיק בכל זאת, לפי התכנית שבהרשמה?'))) return;
          opts.force = true;
        } else if (/נדרש אימות התשלום/.test(m) && !opts.paymentConfirmed) {
          if (!(await askConfirm(m + '\n\nבדקתי — התשלום התקבל. להנפיק ולהפיק חשבונית?'))) return;
          opts.paymentConfirmed = true;
        } else throw e;
      }
    }
    showToast(r.invoice ? `הרישיון של "${r.name}" נשלח, והופקה חשבונית מס/קבלה ${r.invoice.number}` : `הרישיון של "${r.name}" נשלח`);
  });
  each('data-owner-signup-verify', async (b) => {
    const c = await window.systemAPI.ownerVerifySignupPayment(b.dataset.ownerSignupVerify);
    showToast(c.message);
  });
  on('ownerCardcomBtn', async () => {
    const v = await askFields('פרטי המסוף של Cardcom — לאימות תשלומי הרשמה', [
      { name: 'terminal', label: 'מספר מסוף', hint: 'מממשק הניהול של Cardcom' },
      { name: 'apiName', label: 'שם API (ApiName)', type: 'password', newPassword: true, hint: 'נשמר מוצפן במפתח מנהל-העל, במחשב הזה בלבד — לא נשלח לשרת הרישוי' }], 'שמירה');
    if (!v) return;
    await window.systemAPI.ownerSetCardcomCredentials({ terminal: v.terminal, apiName: v.apiName });
    showToast('פרטי המסוף נשמרו — תשלומי הרשמה ייבדקו מול Cardcom לפני הנפקה');
  });
  on('ownerCardcomClearBtn', async () => {
    if (!(await askConfirm('להסיר את פרטי המסוף של Cardcom? הנפקה בתשלום תחזור לאישור ידני.'))) return;
    await window.systemAPI.ownerClearCardcomCredentials();
    showToast('פרטי המסוף הוסרו');
  });
  each('data-owner-signup-invoice', async (b) => {
    const r = await window.systemAPI.exportInvoicePdf(b.dataset.ownerSignupInvoice);
    if (r && r.ok) showToast('החשבונית נשמרה כ-PDF');
  });
  each('data-owner-signup-doc', async (b) => {
    const r = await window.systemAPI.ownerSignupDocument(b.dataset.ownerSignupDoc);
    if (r && r.ok) showToast('התקנון החתום נשמר כ-PDF');
  });

  // --- עדכוני גרסה ---
  on('updDownloadBtn', async () => {
    showToast('מוריד ובודק את העדכון...');
    const r = await window.systemAPI.updateDownload();
    showToast(`גרסה ${r.version} הורדה ונבדקה — אפשר להתקין`);
  });
  on('updFileBtn', async () => {
    const r = await window.systemAPI.updateFromFile();
    if (r && r.ok) showToast(`גרסה ${r.version} נבדקה ומוכנה להתקנה`);
  });
  on('updInstallBtn', async () => {
    if (!(await askConfirm('התוכנה תיסגר ותיפתח ההתקנה של הגרסה החדשה. מומלץ לגבות לפני כן. להמשיך?', { okText: 'כן, להתקין עכשיו' }))) return;
    await window.systemAPI.updateInstall();
  });
  on('ownerReleaseBtn', async () => {
    const v = await licForm('שחרור גרסה חדשה', [
      { name: 'version', label: 'מספר גרסה (למשל 3.9.0)', required: true },
      { name: 'url', label: 'קישור הורדה https (לא חובה — בלי קישור: התקנה מקובץ בלבד)' },
      { name: 'notes', label: 'מה חדש בגרסה' },
    ], 'בחירת קובץ ההתקנה וחתימה', 'בשלב הבא בוחרים את קובץ ה-EXE או ה-APK. התעודה החתומה תישמר לידו.');
    if (!v) return;
    const r = await window.systemAPI.ownerReleaseCreate(v);
    if (r && r.ok) showToast(`גרסה ${r.version} נחתמה. התעודה נשמרה: ${r.path}`);
  });
  on('ownerModelSignBtn', async () => {
    const v = await licForm('חתימת מודל AI מקומי', [
      { name: 'id', label: 'מזהה (אותיות לטיניות קטנות, ספרות, נקודה או מקף — למשל dictalm-1.7b-q4)', required: true },
      { name: 'name', label: 'שם לתצוגה' },
      { name: 'license', label: 'רישיון המודל (למשל Apache-2.0)' },
      { name: 'quant', label: 'כימות (למשל Q4_K_M)' },
      { name: 'contextSize', label: 'אורך הקשר', value: '4096' },
    ], 'בחירת קובץ ה-GGUF וחתימה', 'בשלב הבא בוחרים את קובץ המודל. חישוב התמצית לוקח כדקה; התעודה (‎.ssmodel) תישמר לידו.');
    if (!v) return;
    const r = await window.systemAPI.ownerModelSign(v);
    if (r && r.ok) showToast(`המודל ${r.name} נחתם. התעודה נשמרה: ${r.path}`);
  });
  each('data-owner-publish', async (b) => {
    if (!(await askConfirm(`לשלוח את גרסה ${b.dataset.ownerPublish} לכל המערכות?`))) return;
    const r = await window.systemAPI.ownerReleasePublish(b.dataset.ownerPublish, b.dataset.platform);
    showToast(`העדכון נשלח ל-${r.sent} מערכות`);
  });
  on('ownerRemotePushBtn', async () => {
    const r = await window.systemAPI.ownerRemotePush();
    const failed = Array.isArray(r && r.failed) ? r.failed : [];
    showToast(`נשלחו ${Number(r && r.sent) || 0} עדכונים` + (failed.length ? ` — ${failed.length} לא נמסרו` : ''));
    if (failed.length) await licPushReport(failed);
  });
  each('data-owner-inbox-issue', async (b) => {
    const m = (d.inbox || []).find(x => x.id === b.dataset.ownerInboxIssue) || {};
    // הסיכום נשמר כשהבקשה הגיעה — המוצר והחבילות נבדקים שוב מול המצב של עכשיו
    const sm = { ...(m.summary || {}), bundles: (d.owner && d.owner.bundles || []).filter(x => (x.pending || []).length)
      .flatMap(x => x.pending.filter(pid => !(m.summary || {}).product || pid === m.summary.product).map(pid => ({ ...x, forProduct: pid }))) };
    const v = await licIssueDialog(sm, d.owner && d.owner.products);
    if (!v) return;
    const r = await window.systemAPI.ownerInboxIssue({ id: m.id, ...v });
    showToast(`הרישיון של "${r.name}" נשלח ללקוח`);
  });
  each('data-owner-inbox-approve', async (b) => {
    const r = await window.systemAPI.ownerInboxApprove(b.dataset.ownerInboxApprove);
    showToast(`מערכת הבת "${r.name}" אושרה — האישור נשלח ל"${r.parentName}"`);
  });
  each('data-owner-inbox-reject', async (b) => {
    const v = await licReason('דחיית הבקשה');
    if (!v) return;
    await window.systemAPI.ownerInboxReject(b.dataset.ownerInboxReject, v.reason);
    showToast('הבקשה נדחתה והשולח עודכן');
  });

  // --- מנהל-העל ---
  on('ownerInitBtn', async () => {
    const v = await licForm('הגדרת מצב מנהל-העל', [
      { name: 'p1', label: 'סיסמה (לפחות 12 תווים)', type: 'password', required: true },
      { name: 'p2', label: 'אימות סיסמה', type: 'password', required: true }], 'יצירת מפתח שורש',
    'חשוב: בלי הסיסמה ובלי גיבוי של המחשב הזה לא ניתן יהיה לחדש רישיונות. שמרו את הסיסמה במקום בטוח.');
    if (!v) return;
    if (v.p1 !== v.p2) throw new Error('הסיסמאות אינן זהות');
    await window.systemAPI.ownerInit(v.p1);
    showToast('מצב מנהל-העל הוגדר');
  });
  on('ownerUnlockBtn', async () => {
    const v = await licForm('כניסה למצב מנהל-העל', [{ name: 'p', label: 'סיסמה', type: 'password', required: true }], 'כניסה');
    if (!v) return;
    await window.systemAPI.ownerUnlock(v.p);
  });
  on('ownerLockBtn', () => window.systemAPI.ownerLock());
  // --- שמירה על המפתח ---
  const makeCodes = async () => {
    // הקודים משחזרים את המפתח עצמו — לכן הסיסמה נדרשת שוב, גם כשמצב מנהל-העל פתוח
    const v = await licForm('יצירת קודי שחזור', [
      { name: 'p', label: 'סיסמת מנהל-העל', type: 'password', required: true },
      { name: 'n', label: 'כמה קודים ליצור', type: 'number', value: 5, required: true },
      { name: 'k', label: 'כמה קודים נדרשים לשחזור', type: 'number', value: 3, required: true }], 'יצירה',
    'מומלץ: 5 קודים, 3 לשחזור. יצירה מחדש מבטלת את הצורך בקודים הישנים — אבל הם עדיין משחזרים את אותו מפתח, לכן השמידו אותם.');
    if (!v) return;
    const r = await window.systemAPI.ownerRecoveryCodes(v.p, Number(v.n), Number(v.k));
    await showRecoveryCodes(r);
  };
  on('ownerCodesBtn', makeCodes);
  on('ownerCodesBtn2', makeCodes);
  on('ownerExportBtn', async () => {
    const v = await licForm('גיבוי מלא של מנהל-העל', [
      { name: 'p', label: 'סיסמה לקובץ הגיבוי (לפחות 12 תווים)', type: 'password', required: true },
      { name: 'p2', label: 'אימות', type: 'password', required: true }], 'שמירה',
    'הגיבוי כולל את כל הלקוחות, האישורים, ההרשמות והגרסאות. המפתח בתוכו נשאר מוצפן גם בסיסמת מנהל-העל.');
    if (!v) return;
    if (v.p !== v.p2) throw new Error('הסיסמאות אינן זהות');
    if (v.p.length < 12) throw new Error('הסיסמה קצרה מדי');
    const r = await window.systemAPI.ownerExportBackup(v.p);
    if (r && r.ok) showToast('הגיבוי נשמר');
  });
  on('ownerImportBtn', async () => {
    const text = await pickFileText('.ssowner');
    if (text == null) return;
    const v = await licForm('שחזור מגיבוי מלא', [{ name: 'p', label: 'סיסמת קובץ הגיבוי', type: 'password', required: true }], 'שחזור');
    if (!v) return;
    const r = await window.systemAPI.ownerImportBackup(text, v.p);
    showToast(`שוחזרו ${r.tenants} לקוחות. כניסה — בסיסמת מנהל-העל`);
  });
  on('ownerPassBtn', async () => {
    const v = await licForm('החלפת סיסמת מנהל-העל', [
      { name: 'o', label: 'סיסמה נוכחית', type: 'password', required: true },
      { name: 'p1', label: 'סיסמה חדשה (לפחות 12 תווים)', type: 'password', required: true },
      { name: 'p2', label: 'אימות', type: 'password', required: true }], 'החלפה');
    if (!v) return;
    if (v.p1 !== v.p2) throw new Error('הסיסמאות אינן זהות');
    await window.systemAPI.ownerChangePassphrase(v.o, v.p1);
    showToast('הסיסמה הוחלפה');
  });
  on('ownerRecoverBtn', async () => {
    const v = await licForm('שחזור מקודי שחזור', [
      { name: 'codes', label: 'הקודים — כל קוד בשורה, או מופרדים ברווח', required: true },
      { name: 'p1', label: 'סיסמה חדשה (לפחות 12 תווים)', type: 'password', required: true },
      { name: 'p2', label: 'אימות', type: 'password', required: true }], 'שחזור');
    if (!v) return;
    if (v.p1 !== v.p2) throw new Error('הסיסמאות אינן זהות');
    const codes = String(v.codes).split(/[\s,;]+/).filter(x => /^SSK1-/i.test(x));
    const r = await window.systemAPI.ownerRecover(codes, v.p1);
    showToast(r.restoredRegistry ? 'המפתח שוחזר — אפשר להמשיך לעבוד' : 'המפתח שוחזר. לשחזור רשימת הלקוחות — "שחזור מגיבוי מלא"');
  });
  on('ownerCopyKeyBtn', () => licSave(JSON.stringify((d.owner || {}).publicKey), 'מפתח-ציבורי-מנהל-העל', 'המפתח הציבורי נשמר — יש להוסיף אותו ל-root-keys.js בבניית התוכנה'));

  // הכפתור המרכזי: פתיחת כל בקשה מלקוח — רישיון חדש/חידוש, או אישור מערכת בת
  on('ownerOpenBtn', async () => {
    const text = await pickFileText('.sslic,.json');
    if (text == null) return;
    const req = await window.systemAPI.ownerOpenRequest(text);
    if (req.kind === 'license') {
      const v = await licIssueDialog(req, d.owner && d.owner.products);
      if (!v) return;
      const r = await window.systemAPI.ownerIssue({ request: text, ...v });
      await licSave(r.package, 'רישיון-' + r.name, `הרישיון של "${r.name}" נשמר — שלחו אותו ללקוח`);
      return;
    }
    // בקשת אישור למערכת בת: אישור או דחייה בלחיצה
    const summary = `"${req.parentName}" מבקש ${req.renewal ? 'לחדש' : 'לפתוח'} מערכת בת "${req.name}". `
      + `תחומים: ${(req.features || []).map(licFeatureLabel).join(', ')}. ${licLimits(req.limits)}. בתוקף עד ${licDate(req.expiresAt)}. `
      + `מכסה: ${req.quota.used} מתוך ${req.quota.max}.` + (req.problem ? ` ⚠ ${req.problem}` : '');
    const choice = await licForm('בקשה למערכת בת', [{ name: 'decision', label: 'החלטה', type: 'select',
      options: req.problem ? [['reject', 'דחייה']] : [['approve', '✔ אישור'], ['reject', '✖ דחייה']] }], 'המשך', summary);
    if (!choice) return;
    if (choice.decision === 'approve') {
      const r = await window.systemAPI.ownerApprove({ request: text });
      await licSave(r.package, 'אישור-' + r.name, `מערכת הבת "${r.name}" אושרה — שלחו את קובץ האישור ל"${r.parentName}"`);
    } else if (choice.decision === 'reject') {
      // רק בחירה מפורשת בדחייה — ערך ריק או לא צפוי אינו דחייה (f66)
      const v = await licReason('דחיית הבקשה');
      if (!v) return;
      await window.systemAPI.ownerReject({ request: text, reason: v.reason });
      showToast('הבקשה נדחתה ונרשמה ביומן');
    } else return;
  });
  on('ownerKillBtn', async () => {
    if (!(await askConfirm('נעילה גלובלית תנעל את כל המערכות של כל הלקוחות ברגע שיקבלו את העדכון. להמשיך?', { danger: true, okText: 'כן, לנעול את כולם' }))) return;
    const v = await licReason('נעילת כל המערכות');
    if (!v) return;
    await window.systemAPI.ownerNotice({ type: 'hold', target: '*', kind: 'locked', reason: v.reason });
    showToast('הנעילה הגלובלית נרשמה — שלחו "קובץ עדכון" ללקוחות');
  });
  each('data-owner-hold', async (b) => {
    const v = await licReason('השבתה', licHoldFields);
    if (!v) return;
    await window.systemAPI.ownerNotice({ type: 'hold', target: b.dataset.ownerHold, kind: v.kind, reason: v.reason });
    showToast('ההשבתה נרשמה — שלחו "קובץ עדכון" ללקוח');
  });
  each('data-owner-release', async (b) => {
    const v = await licReason('החזרה לפעילות');
    if (!v) return;
    await window.systemAPI.ownerNotice({ type: 'release', target: b.dataset.ownerRelease, holdId: b.dataset.hold, reason: v.reason });
    showToast('ההחזרה נרשמה — שלחו "קובץ עדכון" ללקוח');
  });
  each('data-owner-terminate', async (b) => {
    if (!(await askConfirm('סיום לקוח הוא סופי ומסיים גם את כל מערכות הבת שלו. להמשיך?', { danger: true, okText: 'כן, לסיים את הלקוח' }))) return;
    const v = await licReason('סיום לקוח');
    if (!v) return;
    await window.systemAPI.ownerNotice({ type: 'terminate', target: b.dataset.ownerTerminate, reason: v.reason });
  });
  each('data-owner-revoke', async (b) => {
    if (!(await askConfirm('ביטול האישור מסיים את מערכת הבת ומפנה את המשבצת במכסה. להמשיך?', { danger: true, okText: 'כן, לבטל את האישור' }))) return;
    const v = await licReason('ביטול אישור מערכת בת');
    if (!v) return;
    await window.systemAPI.ownerRevoke({ childId: b.dataset.ownerRevoke, reason: v.reason });
  });
  each('data-owner-notices', async (b) => {
    const text = await window.systemAPI.ownerNoticesPackage(b.dataset.ownerNotices);
    await licSave(text, 'עדכון-' + b.dataset.name, 'קובץ העדכון נשמר — שלחו אותו ללקוח');
  });
}
