// ממשק המודול הכלכלי — טפסים: טופס משני, בנייה, איסוף, שמירה, עריכה ומחיקה; חיפוש.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

// ============================================================
// טפסים משניים: תצוגה עם יותר מטופס אחד (למשל "הגדרות עמותה" או "הצעת בנק").
// הטופס המשני עובר באותו מסלול של הטופס הראשי (בנייה, איסוף, שמירה, סגירה).
// ============================================================
const currentSchema = () => state.subForm || formSchemas[state.currentView];

async function openSubForm(schema, values = {}, editingId = null) {
  try {
    if (schema.prepare) await schema.prepare(schema, values);
  } catch (error) {
    showError('שגיאה בטעינת הטופס: ' + errMsg(error));
    return;
  }
  state.subForm = schema;
  state.editingId = editingId;
  showModal(editingId && schema.editTitle ? schema.editTitle : schema.title, buildFormHtml(schema.fields));
  for (const f of schema.fields) {
    const el = document.getElementById('f_' + f.name);
    const v = values[f.name] !== undefined && values[f.name] !== null ? values[f.name] : f.value;
    if (el && v !== undefined && v !== null) el.value = String(v);
  }
  if (typeof schema.afterRender === 'function') schema.afterRender();
}



// תצוגות ללא טופס הוספה — מחושבות/מצטברות בלבד.
// נגזר מ-formSchemas כדי שלא ייווצר פער בין הרשימה לסכימות בפועל.
const hasForm = (viewName) => !!formSchemas[viewName];

// Attach view-specific handlers
function attachViewHandlers(viewName) {
  // כפתור הוספה — מושבת ומוסתר בתצוגות שאין להן טופס מוגדר (כפתור דהוי נראה כתקלה)
  elements.addBtn.disabled = !hasForm(viewName);
  elements.addBtn.hidden = !hasForm(viewName);

  // כפתורי מחיקה בכרטיסים
  document.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => handleDelete(btn.dataset.id));
  });

  // כפתורי עריכה בכרטיסים
  document.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const record = findRecordById(id);
      if (record) await handleEdit(id, record);
    });
  });

  document.querySelectorAll('[data-action="cancel"]').forEach(btn => {
    btn.addEventListener('click', () => handleCancelInvoice(btn.dataset.id));
  });
  document.querySelectorAll('[data-action="alloc"]').forEach(btn => {
    btn.addEventListener('click', () => handleAllocation(btn.dataset.id));
  });
  document.querySelectorAll('[data-action="alloc-waive"]').forEach(btn => {
    btn.addEventListener('click', () => handleAllocationWaive(btn.dataset.id));
  });
  document.querySelectorAll('[data-action="pay"]').forEach(btn => {
    btn.addEventListener('click', () => handlePay(btn.dataset.id));
  });
  // מסמכי מכירה (PLAN.md 9.3)
  document.querySelectorAll('[data-doc-new]').forEach(btn => {
    btn.addEventListener('click', () => openSubForm(salesDocSchema(btn.dataset.docNew), { date: today() }));
  });
  document.querySelectorAll('[data-doc-pdf]').forEach(btn => {
    btn.addEventListener('click', () => handleSalesDocPdf(btn.dataset.docPdf));
  });
  document.querySelectorAll('[data-doc-convert]').forEach(btn => {
    btn.addEventListener('click', () => handleConvertDoc(btn.dataset.docConvert, btn.dataset.to));
  });
  document.querySelectorAll('[data-doc-cancel]').forEach(btn => {
    btn.addEventListener('click', () => handleCancelDoc(btn.dataset.docCancel));
  });
  document.querySelectorAll('[data-action="credit"]').forEach(btn => {
    btn.addEventListener('click', () => handleCreditNote(btn.dataset.id));
  });
  const logoBtn = document.getElementById('acctLogoBtn');
  if (logoBtn) logoBtn.addEventListener('click', () => handleDocLogo(false));
  const logoDel = document.getElementById('acctLogoRemove');
  if (logoDel) logoDel.addEventListener('click', () => handleDocLogo(true));
  document.querySelectorAll('[data-module]').forEach(btn => {
    btn.addEventListener('click', () => window.systemAPI.openModule(btn.dataset.module).catch(e => showError('שגיאה בפתיחת המודול: ' + errMsg(e))));
  });
  document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.goto));
  });
  const periodBtn = document.getElementById('acctPeriodBtn');
  if (periodBtn) periodBtn.addEventListener('click', changeAcctPeriod);
  const calc = ['calcCost', 'calcMarkup', 'calcExempt'].map(id => document.getElementById(id)).filter(Boolean);
  calc.forEach(el => el.addEventListener('input', refreshCalculator));
  if (calc.length) refreshCalculator();
  const csvTb = document.getElementById('acctCsvTb');
  if (csvTb) csvTb.addEventListener('click', () => handleCsv('trialBalance'));
  const uniform = document.getElementById('acctUniformFile');
  if (uniform) uniform.addEventListener('click', handleUniformFile);
  const pcn = document.getElementById('acctPcn874');
  if (pcn) pcn.addEventListener('click', handlePcn874);
  const csvSum = document.getElementById('acctCsvSummary');
  if (csvSum) csvSum.addEventListener('click', () => handleCsv('summary'));
  const csvPer = document.getElementById('acctCsvPersonal');
  if (csvPer) csvPer.addEventListener('click', () => handleCsv('personal'));
  const imp = document.getElementById('acctImportCsv');
  if (imp) imp.addEventListener('click', handleImportCsv);
  document.querySelectorAll('[data-action="unpay"]').forEach(btn => {
    btn.addEventListener('click', () => handleUnpay(btn.dataset.id));
  });
  const csvJ = document.getElementById('acctCsvJournal');
  if (csvJ) csvJ.addEventListener('click', () => handleCsv('journal'));
  document.querySelectorAll('[data-action="pdf"]').forEach(btn => {
    btn.addEventListener('click', () => handlePdf(btn.dataset.id));
  });

  if (viewName === 'acct-invoices') attachInvoiceViewHandlers();
  if (viewName === 'acct-bank') attachBankHandlers();
  if (viewName === 'biz-reports') attachBizHandlers();
  if (viewName === 'dashboard') attachBizDashHandlers();
  if (viewName === 'npo') attachNpoHandlers();
  if (viewName === 'gemach') attachGemachHandlers();
  if (viewName === 'chesed') attachChesedHandlers();
  if (viewName === 'people') attachPeopleHandlers();
  if (viewName === 'personal-finance') attachPersonalFinanceHandlers();
  if (viewName === 'settings') attachSettingsHandlers();
  if (viewName === 'licensing') attachLicensingHandlers();
  if (viewName === 'messages') attachMessagesHandlers();
  if (viewName === 'collect') attachCollectHandlers();
  attachPortsHandlers();
  if (viewName === 'mortgage-advisor') attachMadvHandlers();
  if (viewName === 'mortgage-lab') attachLabHandlers();
  if (viewName === 'realty') attachRealtyHandlers();
  if (viewName === 'realestate') attachRealEstateHandlers();

  // תיבת חיפוש
  const searchInput = document.getElementById('viewSearch');
  if (searchInput) {
    let debounce;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => performSearch(searchInput.value.trim()), 300);
    });
  }
}

// Handle add action — פותח את הטופס המתאים לתצוגה
async function handleAdd() {
  const schema = formSchemas[state.currentView];
  if (!schema) {
    showToast('בתצוגה זו אין טופס הוספה');
    return;
  }
  try {
    if (schema.prepare) await schema.prepare(schema);
  } catch (error) {
    showError('שגיאה בטעינת הטופס: ' + errMsg(error));
    return;
  }
  showModal(schema.title, buildFormHtml(schema.fields));
  if (schema.dynamic) attachDynamicFields(schema);
  if (schema.afterRender) schema.afterRender();
}

// שדות פעילים לפי הסוג הנבחר (לטופס דינמי עם בחירת סוג)
function activeFields(schema) {
  if (!schema.dynamic) return schema.fields;
  const kindEl = document.getElementById('f_' + schema.fields[0].name);
  const kind = kindEl ? kindEl.value : schema.fields[0].options[0].value;
  return schema.fields.filter(f => !f.kinds || f.kinds.includes(kind));
}

// טופס דינמי: החלפת השדות בכל שינוי בסוג הרשומה
function attachDynamicFields(schema) {
  const kindName = schema.fields[0].name;
  const kindEl = document.getElementById('f_' + kindName);
  if (!kindEl) return;
  const fieldsWrap = document.getElementById('formFields');
  if (!fieldsWrap) return;

  const refresh = () => {
    // שמירת הערכים שכבר הוזנו, כדי לא לאבד אותם במעבר בין סוגים
    const prev = {};
    for (const f of schema.fields) {
      const el = document.getElementById('f_' + f.name);
      if (el && f.name !== kindName) prev[f.name] = el.value;
    }
    fieldsWrap.innerHTML = buildFormHtml(activeFields(schema).filter(f => f.name !== kindName));
    // שחזור ערכים תואמים
    for (const [name, value] of Object.entries(prev)) {
      const el = document.getElementById('f_' + name);
      if (el) el.value = value;
    }
  };
  kindEl.addEventListener('change', refresh);
  refresh();
}

// בניית HTML של טופס לפי סכימה
function buildFormHtml(fields) {
  // טופס דינמי: שדה הסוג נשאר בחוץ, שאר השדות נעטפים ב-wrapper שמתחלף
  const schema = currentSchema();
  if (!schema || !schema.dynamic) return fields.map(renderField).join('');

  const kindName = schema.fields[0].name;
  const isKind = (f) => f.name === kindName;
  const head = fields.filter(isKind).map(renderField).join('');
  const rest = fields.filter(f => !isKind(f));
  return head + `<div id="formFields">${rest.map(renderField).join('')}</div>`;
}

// רינדור שדה בודד
function renderField(f) {
  const req = f.required ? 'required' : '';
  let input;
  if (f.type === 'textarea') {
    input = `<textarea id="f_${esc(f.name)}" name="${esc(f.name)}" rows="3" ${req}>${esc(f.value ?? '')}</textarea>`;
  } else if (f.type === 'select') {
    const opts = (f.options || [])
      .map(o => `<option value="${esc(o.value)}"${String(o.value) === String(f.value ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
    input = `<select id="f_${esc(f.name)}" name="${esc(f.name)}" ${req}>${opts}</select>`;
  } else {
    const val = f.value !== undefined && f.value !== null ? ` value="${esc(f.value)}"` : '';
    input = `<input id="f_${esc(f.name)}" name="${esc(f.name)}" type="${esc(f.type)}"${val} ${req}>`;
  }
  return `<label class="field">
    <span>${esc(f.label)}${f.required ? ' *' : ''}</span>
    ${input}
  </label>`;
}

// איסוף ערכי הטופס — בטופס דינמי נאספים רק השדות הפעילים לסוג הנבחר
function collectFormData(fields) {
  const schema = currentSchema();
  const relevant = (schema && schema.dynamic) ? activeFields(schema) : fields;
  const data = {};
  for (const f of relevant) {
    const el = document.getElementById('f_' + f.name);
    if (!el) continue;
    let value = el.value.trim();
    if (f.required && !value) {
      throw new Error(`השדה "${f.label}" הוא שדה חובה`);
    }
    if (f.type === 'number' && value !== '') {
      value = Number(value);
      if (Number.isNaN(value)) {
        throw new Error(`השדה "${f.label}" חייב להיות מספר`);
      }
    }
    if (value !== '') data[f.name] = value;
  }
  return data;
}

// Handle user action
async function handleUser() {
  try {
    if (state.user) {
      await window.systemAPI.logout();
      state.user = null;
      showToast('התנתקת מהמערכת');
      await loginUser();
    } else {
      await loginUser();
    }
  } catch (error) {
    showError('שגיאה בניהול משתמש: ' + error.message);
  }
}

// Handle backup — גיבוי מוצפן בלבד: ההצפנה במסגרת הראשית, והקובץ שנשמר הוא SSBK1: בלבד
async function handleBackup() {
  try {
    const f = await askFields('גיבוי מוצפן', [{ name: 'pass', label: 'סיסמת גיבוי (לפחות 8 תווים)', type: 'password' }], 'צור גיבוי');
    if (!f) return;
    if (f.pass.length < 8) { showError('סיסמת הגיבוי חייבת להכיל לפחות 8 תווים'); return; }
    showToast('יוצר גיבוי מוצפן...');
    const text = await window.systemAPI.backupEncrypted(f.pass);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const filename = `גיבוי-מערכת-כלכלית-${stamp}.ssbk`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('הגיבוי המוצפן נשמר: ' + filename);
  } catch (error) {
    showError('שגיאה בגיבוי: ' + errMsg(error));
  }
}

// Handle restore — מזהה גיבוי מוצפן (SSBK1:) ומבקש סיסמה; גיבוי ישן (JSON) נתמך לשחזור בלבד
async function handleRestore() {
  try {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ssbk,.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        if (!(await askConfirm('השחזור יחליף את כל הנתונים הכלכליים הקיימים. להמשיך?'))) return;
        if (text.startsWith('SSBK1:')) {
          const f = await askFields('שחזור מגיבוי מוצפן', [{ name: 'pass', label: 'סיסמת הגיבוי', type: 'password' }], 'שחזר');
          if (!f) return;
          await window.systemAPI.restoreEncrypted(text, f.pass);
        } else {
          await window.systemAPI.restoreData(JSON.parse(text));
        }
        showToast('השחזור הושלם בהצלחה');
        await switchView(state.currentView);
      } catch (error) {
        showError('שגיאה בשחזור: ' + errMsg(error));
      }
    });
    input.click();
  } catch (error) {
    showError('שגיאה בשחזור: ' + errMsg(error));
  }
}

// Handle form submission — יוצר או מעדכן רשומה בפועל
async function handleSubmit() {
  const schema = currentSchema();
  if (!schema) {
    closeModal();
    return;
  }

  let data;
  try {
    data = collectFormData(schema.fields);
  } catch (error) {
    showError(error.message);
    return;
  }

  try {
    elements.submitBtn.disabled = true;
    if (state.editingId && schema.update) {
      await schema.update(state.editingId, data);
      showToast('הרשומה עודכנה בהצלחה');
    } else {
      await schema.create(data);
      showToast('הרשומה נשמרה בהצלחה');
    }
    state.editingId = null;
    closeModal();
    await switchView(state.currentView);
  } catch (error) {
    showError('שגיאה בשמירה: ' + error.message);
  } finally {
    elements.submitBtn.disabled = false;
  }
}

// Handle delete — מוחק רשומה עם אישור
async function handleDelete(id) {
  const schema = formSchemas[state.currentView];
  if (!schema || !schema.remove) return;
  if (!(await askConfirm(schema.confirmText || 'האם למחוק את הרשומה? הפעולה אינה ניתנת לביטול.'))) return;

  try {
    await schema.remove(id);
    showToast('הרשומה נמחקה');
    await switchView(state.currentView);
  } catch (error) {
    showError('שגיאה במחיקה: ' + error.message);
  }
}

// Handle edit — פותח טופס עם הנתונים הקיימים.
// שדות הטופס אינם שמות הרשומה בהכרח: סכימות מסוימות (למשל הגדרות מע"מ) שומרות
// vatRate (0.17) בעוד שהשדה הוא vatPercent (17). לכן המילוי עובר דרך prepare של
// הסכימה — בדיוק כמו בפתיחת טופס "הוספה" — ולא בהעתקה עיוורת של שדות הרשומה.
async function handleEdit(id, record) {
  const schema = formSchemas[state.currentView];
  if (!schema || !schema.update) {
    showToast('בתצוגה זו אין עריכה');
    return;
  }
  state.editingId = id;
  // שמירת ערכי הטופס שהיו לסכימה לפני העריכה — כדי שטופס "הוספה" הבא
  // לא ייפתח מלא בנתונים של הרשומה האחרונה שערכנו.
  state.fieldValuesBackup = schema.fields.map(f => f.value);
  try {
    if (typeof schema.prepare === 'function') {
      await schema.prepare(schema);
    } else {
      for (const f of schema.fields) {
        const v = record ? record[f.name] : undefined;
        if (v !== undefined && v !== null) f.value = v;
      }
    }
  } catch (error) {
    showError('שגיאה בטעינת הרשומה לעריכה: ' + errMsg(error));
    state.editingId = null;
    state.fieldValuesBackup = null;
    return;
  }
  showModal('עריכת ' + schema.title.replace(' חדשה', ''), buildFormHtml(schema.fields));
  for (const f of schema.fields) {
    const el = document.getElementById('f_' + f.name);
    if (el && f.value !== undefined && f.value !== null) el.value = f.value;
  }
  if (typeof schema.afterRender === 'function') schema.afterRender();
}

// חיפוש בתצוגות נתמכות
async function performSearch(query) {
  const schema = formSchemas[state.currentView];
  if (!schema || !schema.search) return;

  try {
    if (!query) {
      await switchView(state.currentView);
      return;
    }
    const results = await schema.search(query);
    const key = { contacts: 'contacts', 'voice-notes': 'notes' }[state.currentView];
    state.data[state.currentView] = { [key]: results };
    renderView(state.currentView);
    const input = document.getElementById('viewSearch');
    if (input) {
      input.value = query;
      input.focus();
    }
  } catch (error) {
    showError('שגיאה בחיפוש: ' + error.message);
  }
}
