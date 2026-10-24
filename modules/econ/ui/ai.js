// ממשק המודול הכלכלי — עוזר „שאל את התוכנה”: שאלות בשפה פשוטה על נתוני המשתמש.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
// העוזר מקומי בלבד: אין קריאה לרשת, והתשובות נבנות ממנוע החישוב של התוכנה. כל ההרשאות והרישיון נבדקים בתהליך הראשי.
'use strict';

// תחומי הנתונים שהעוזר מכיר — הסימון מגיע מ-ai:status (רישיון + הרשאה של המשתמש הזה)
const AI_SOURCES = [
  { id: 'acct', label: 'חשבונאות וחשבוניות' },
  { id: 'npo', label: 'עמותה ותרומות' },
  { id: 'shamai', label: 'שמאות' },
  { id: 'trainer', label: 'אימונים' }
];

// התשובה נשמרת בזיכרון התצוגה בלבד — היא לא נשמרת למסד ולא נשלחת לשום מקום
const aiUi = { busy: false, answer: null, error: '' };

// מזהי הדפוסים שהממשק מחפש כדי להציע ניווט למסך המתאים
const AI_OPEN_IDS = {
  unpaid: 'acct-invoices',
  customers: 'acct-invoices',
  income: 'acct-reports',
  expense: 'acct-reports',
  vat: 'acct-reports',
  profit: 'acct-reports',
  donors: 'npo',
  shamai: 'shamai',
  trainer: 'trainer',
  howto: 'acct-invoices'
};
// יעדים שהם מודולים (נפתחים ב-openModule) ולא מסכים בממשק הכלכלי
const AI_OPEN_MODULES = ['trainer', 'shamai'];

// טווח התקופה שהממשק מבקש במפורש. התאריכים נקבעים כאן לפי תאריך המחשב — לא UTC
function aiUiRange(text) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const day = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const t = String(text || '');
  if (t.includes('החודש שעבר')) {
    return {
      from: day(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      // גבול עליון כוללני (inRange): היום האחרון של החודש שעבר (יום 0 של החודש הזה). ה-1 בחודש הזה
      // הכניס את הכנסות ה-1 גם לחודש שעבר (ממצא 47)
      to: day(new Date(now.getFullYear(), now.getMonth(), 0)),
      label: 'החודש שעבר'
    };
  }
  if (t.includes('השנה שעברה')) {
    const y = now.getFullYear() - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: `שנת ${y}` };
  }
  return null;
}

function renderAi(data) {
  const st = (data && data.status) || {};
  const cloud = st.cloud || {};
  const prefs = st.prefs || {};
  const opened = st.opened || {};
  const samples = (data && Array.isArray(data.samples)) ? data.samples : [];
  const engineText = st.local && st.local.licensed && st.local.mode === 'ready' ? 'מנוע החישוב, ומודל במחשב לשאלות חופשיות' : 'מנוע החישוב של התוכנה';
  const cloudText = cloud.licensed
    ? (cloud.ready ? 'מחובר' : 'כלול ברישיון — טרם הופעל')
    : 'כלול בשדרוג';

  const sourceTags = AI_SOURCES.map(s => {
    if (s.id === 'shamai' || s.id === 'trainer') {
      return `<span class="ss-badge ${opened[s.id] ? 'ss-badge-success' : ''}">${esc(s.label)} — ${opened[s.id] ? 'מודול פתוח' : 'מודול סגור'}</span>`;
    }
    return `<span class="ss-badge ${opened[s.id] ? 'ss-badge-success' : ''}">${esc(s.label)} — ${opened[s.id] ? 'פתוח' : 'לא בהרשאה'}</span>`;
  }).join(' ');

  const html = [];
  html.push(`<div class="ss-page-head"><span>שאלו בשפה פשוטה על הנתונים שבתוכנה — „כמה גבייתי החודש?”, „מי לא שילם?”. העוזר עונה ממנוע החישוב של התוכנה, על המחשב הזה, בלי חיבור לרשת. התשובות הן עזר בלבד ואינן ייעוץ מקצועי — בדקו לפני החלטה.</span></div>`);

  html.push(`<div class="ss-card">
    <h4 class="ss-section-title">מצב העוזר</h4>
    <div class="ss-row"><span>מנוע התשובות</span><span>${esc(engineText)}</span></div>
    <div class="ss-row"><span>עוזר בענן</span><span>${esc(cloudText)}</span><span class="ss-badge ${cloud.licensed ? 'ss-badge-info' : ''}">${cloud.licensed ? 'ברישיון' : 'שדרוג'}</span></div>
    <div class="ss-row"><span>הסתרת מזהים</span><span>${prefs.conceal ? 'מוסתרים לפני שהטקסט מוצג' : 'המזהים מוצגים כפי שהם'}</span>
      <button type="button" class="ss-btn-secondary ss-btn-sm" data-ai-conceal="${prefs.conceal ? '1' : '0'}">${prefs.conceal ? 'בטל הסתרה' : 'הצג בלי מזהים'}</button></div>
    <p class="ss-muted">תחומים שהשאלות עונות עליהם עבור המשתמש הזה:</p>
    ${sourceTags}
  </div>`);

  html.push(renderAiModelCard(st.local || {}));

  html.push(`<div class="ss-card">
    <label class="ss-label" for="aiQuestion">השאלה</label>
    <textarea class="ss-input" id="aiQuestion" dir="rtl" rows="3" maxlength="500" placeholder="למשל: מי לא שילם? כמה גבייתי החודש?"></textarea>
    ${samples.length ? `<div class="ss-toolbar">${samples.map(q => `<button type="button" class="ss-btn-ghost ss-btn-sm" data-ai-sample="${esc(q)}">${esc(q)}</button>`).join(' ')}</div>` : ''}
    <div class="ss-toolbar">
      <button type="button" class="ss-btn-primary" id="aiAsk"${aiUi.busy ? ' disabled' : ''}>${aiUi.busy ? 'בודק…' : 'שאל'}</button>
      <span class="ss-muted">התשובה נבנית מהנתונים בטווח התקופה: החודש, „החודש שעבר” או „השנה שעברה” — לפי השאלה.</span>
    </div>
  </div>`);

  if (aiUi.error) {
    html.push(`<div class="ss-card ss-card-warning"><p>${esc(aiUi.error)}</p></div>`);
  }
  if (aiUi.answer) {
    const a = aiUi.answer;
    // הכפתור נושא את סוג התשובה (kind), והמסך נגזר ממנו בלחיצה. פעם נשמר בו המסך עצמו, והבדיקה בלחיצה
    // חיפשה אותו כמפתח בטבלה — רק „trainer” (מפתח וגם מסך) עבד
    const kind = a.data && typeof a.data.kind === 'string' && Object.prototype.hasOwnProperty.call(AI_OPEN_IDS, a.data.kind) ? a.data.kind : '';
    html.push(`<div class="ss-card">
      <h4 class="ss-section-title">התשובה</h4>
      <p class="ss-pre">${esc(a.text)}</p>
      <div class="ss-toolbar">
        <span class="ss-badge ss-badge-info">${esc(a.engineLabel || 'מנוע החישוב')}</span>
        <button type="button" class="ss-btn-secondary ss-btn-sm" id="aiExplain">איך חושב הסכום?</button>
        ${kind ? `<button type="button" class="ss-btn-ghost ss-btn-sm" data-ai-open="${esc(kind)}">פתיחת המסך הרלוונטי</button>` : ''}
      </div>
      <p class="ss-muted" id="aiExplainOut" hidden></p>
    </div>`);
  }

  return `<div class="ss-stack">${html.join('')}</div>`;
}

// גודל קובץ המודל לתצוגה (MB / GB)
function aiModelSize(bytes) {
  const n = Number(bytes) || 0;
  return n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(1) + ' GB' : Math.round(n / 1024 ** 2) + ' MB';
}

// המודל המקומי (תוסף בתשלום): מצב, התקנה מקובץ עם תעודה חתומה, אימות והסרה. ההרשאה והרישיון — בשרת
function renderAiModelCard(local) {
  const m = local.model;
  const modeText = !local.licensed ? 'לא כלול ברישיון — שדרוג „עוזר חכם — מודל במחשב”'
    : !local.present ? 'לא מותקן'
    : local.mode === 'ready' ? (local.running ? 'פעיל' : 'מוכן — נטען בשאלה הראשונה')
    : local.mode === 'degraded' ? 'הטעינה האחרונה נכשלה — ננסה שוב בשאלה הבאה'
    : 'מותקן, אך רכיב ההרצה חסר בגרסה הזו של התוכנה';
  const badge = !local.licensed ? '' : local.present && local.mode === 'ready' ? 'ss-badge-success' : local.present ? 'ss-badge-warning' : '';
  return `<div class="ss-card">
    <h4 class="ss-section-title">מודל שפה במחשב</h4>
    <div class="ss-row"><span>מצב</span><span>${esc(modeText)}</span><span class="ss-badge ${badge}">${local.present ? 'מותקן' : 'לא מותקן'}</span></div>
    ${m ? `<div class="ss-row"><span>המודל</span><span>${esc(m.name || m.id)}${m.quant ? ' · ' + esc(m.quant) : ''} · ${esc(aiModelSize(m.size))}${m.license ? ' · רישיון ' + esc(m.license) : ''}</span></div>` : ''}
    ${local.error ? `<p class="ss-hint">${esc(local.error)}</p>` : ''}
    <p class="ss-muted">המודל רץ על המחשב הזה בלבד ומותקן מקובץ (למשל מדיסק און קי): תעודה חתומה (‎.ssmodel) וקובץ המודל (‎.gguf). התוכנה בודקת את החתימה ואת תקינות הקובץ לפני השימוש.</p>
    ${local.licensed ? `<div class="ss-toolbar">
      <button type="button" class="ss-btn-secondary ss-btn-sm" id="aiModelInstall">${local.present ? 'החלפת מודל' : 'התקנת מודל מקובץ'}</button>
      ${local.present ? `<button type="button" class="ss-btn-ghost ss-btn-sm" id="aiModelVerify">בדיקת תקינות</button>
      <button type="button" class="ss-btn-danger ss-btn-sm" id="aiModelRemove">הסרת המודל</button>` : ''}
    </div>` : ''}
  </div>`;
}

function attachAiModelHandlers(root) {
  const bind = (id, fn) => {
    const b = root.querySelector('#' + id);
    if (!b) return;
    b.addEventListener('click', async () => {
      // התווית הזמנית („מתקין…”) חוזרת גם אחרי שגיאה — אחרת הכפתור נראה כאילו הפעולה עוד רצה.
      // הכרטיס מתרענן תמיד: גם התקנה שנכשלה עוצרת את המודל הקודם, והמצב במסך כבר לא נכון
      const label = b.textContent;
      b.disabled = true;
      let changed = false;
      try { changed = (await fn(b)) !== false; } catch (e) { changed = true; showError(errMsg(e)); }
      finally { b.disabled = false; b.textContent = label; }
      if (changed) switchView('ai');
    });
  };
  bind('aiModelInstall', async (b) => {
    b.textContent = 'מתקין… (בדיקת הקובץ לוקחת כדקה)';
    const r = await window.systemAPI.aiModelInstall();
    if (!r || r.canceled) return false;
    showToast(`המודל ${r.name || r.id} הותקן`);
  });
  bind('aiModelVerify', async (b) => {
    b.textContent = 'בודק…';
    const r = await window.systemAPI.aiModelVerify();
    if (r && r.present) showToast('המודל תקין'); else showError((r && r.error) || 'המודל אינו תקין');
  });
  bind('aiModelRemove', async () => {
    if (!(await askConfirm('להסיר את המודל מהמחשב? אפשר להתקין אותו שוב מהקובץ.'))) return false;
    await window.systemAPI.aiModelRemove();
    showToast('המודל הוסר');
  });
}

function attachAiHandlers(root) {
  const askBtn = root.querySelector('#aiAsk');
  const box = root.querySelector('#aiQuestion');
  const run = async () => {
    const question = box ? box.value.trim() : '';
    if (!question) {
      showError('כתבו שאלה');
      if (box) box.focus();
      return;
    }
    aiUi.busy = true;
    aiUi.error = '';
    if (askBtn) { askBtn.disabled = true; askBtn.textContent = 'בודק…'; }
    try {
      const range = aiUiRange(question);
      aiUi.answer = await window.systemAPI.aiRun(question, range ? { range } : {});
    } catch (e) {
      aiUi.error = 'לא הצלחתי לענות: ' + errMsg(e);
    } finally {
      aiUi.busy = false;
      switchView('ai');
    }
  };
  attachAiModelHandlers(root);
  if (askBtn) askBtn.addEventListener('click', run);
  if (box) {
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); }
    });
    box.focus();
  }
  root.querySelectorAll('[data-ai-sample]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (box) box.value = btn.dataset.aiSample || '';
      run();
    });
  });

  const concealBtn = root.querySelector('[data-ai-conceal]');
  if (concealBtn) {
    concealBtn.addEventListener('click', async () => {
      try {
        await window.systemAPI.aiPrefsSave({ conceal: concealBtn.dataset.aiConceal !== '1' });
        showToast('נשמר — ההסתרה תחול על השאלה הבאה');
        switchView('ai');
      } catch (e) {
        showError('שמירת ההגדרה נכשלה: ' + errMsg(e));
      }
    });
  }

  const explainBtn = root.querySelector('#aiExplain');
  if (explainBtn) {
    explainBtn.addEventListener('click', async () => {
      const out = root.querySelector('#aiExplainOut');
      try {
        const res = await window.systemAPI.aiExplain({ text: aiUi.answer ? aiUi.answer.text : '' });
        if (out) { out.textContent = res && res.text ? res.text : ''; out.hidden = false; }
      } catch (e) {
        showError('לא הצלחתי להסביר: ' + errMsg(e));
      }
    });
  }

  root.querySelectorAll('[data-ai-open]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const kind = btn.dataset.aiOpen || '';
      // רק סוג תשובה מוכר, ורק מסך שמופיע בטבלה — סוג חדש בלי יעד לא מנווט לשום מקום
      const view = Object.prototype.hasOwnProperty.call(AI_OPEN_IDS, kind) ? AI_OPEN_IDS[kind] : '';
      // מודול (אימונים, שמאות) אינו מסך בממשק הכלכלי (נפתח ב-openModule) — ולכן אינו בטבלת viewTitles
      const isModule = AI_OPEN_MODULES.includes(view);
      const known = isModule || Object.prototype.hasOwnProperty.call(viewTitles, view);
      if (!view || !known) {
        showError('המסך המבוקש אינו מוכר');
        return;
      }
      // היעד עצמו נבדק בשרת (רשימה סגורה) לפני המעבר
      try { await window.systemAPI.aiOpen(view); } catch (e) { showError(errMsg(e)); return; }
      if (isModule) {
        window.systemAPI.openModule(view).catch(e => showError('שגיאה בפתיחת המודול: ' + errMsg(e)));
        return;
      }
      switchView(view);
    });
  });
}
