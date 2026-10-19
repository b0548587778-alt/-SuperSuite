// ממשק המודול הכלכלי — גבייה וקישורי תשלום.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

// ============================================================
// גבייה: קישור תשלום ללקוח / לתורם / ללווה — לחשבון הסוחר של הארגון, וקליטת דוח הסליקה
// ============================================================
const COLLECT_PLACEHOLDERS = '{amount} — סכום · {agorot} — סכום באגורות · {ref} — מספר הדרישה · {name} — שם המשלם · {desc} — תיאור';

function renderCollect(d) {
  const c = d || {};
  const s = c.settings || {};
  const sum = c.summary || {};
  const reqs = Array.isArray(c.requests) ? c.requests : [];
  const filter = state.collectFilter || 'open';
  const shown = reqs.filter(r => filter === 'all' || r.status === filter);
  const providers = c.providers || {};
  const setup = !s.linkTemplate
    ? `<div class="card owner-panel"><h3>💳 חיבור חשבון הסוחר</h3>
        <p>כדי לשלוח קישורי תשלום, מדביקים כאן את קישור התשלום שקיבלתם מחברת הסליקה שלכם (בהגדרות "דף תשלום" / "קישור לתשלום" באתר החברה).
        הכסף עובר <b>ישירות לחשבון של הארגון</b>. פרטי האשראי מוקלדים רק בדף של חברת הסליקה, לא בתוכנה.</p>
        <p class="muted">גם בלי קישור אפשר לעבוד: יוצרים דרישה, שולחים ללקוח את מספר האסמכתא, ומסמנים "שולם" או קולטים את הדוח.</p>
        <button class="primary" id="collectSettingsBtn">⚙ הגדרת קישור תשלום</button></div>` : '';
  const row = (r) => `<tr>
      <td><b>${esc(r.ref)}</b><br><small class="muted">${esc(new Date(r.createdAt).toLocaleDateString('he-IL'))}</small></td>
      <td>${esc(r.payerName)}${r.payerPhone ? `<br><small class="muted">${esc(r.payerPhone)}</small>` : ''}</td>
      <td>${esc(r.kindLabel || '')}<br><small class="muted">${esc(r.description)}</small></td>
      <td>${money(r.amount)}</td>
      <td><span class="badge ${r.status === 'paid' ? 'good' : r.status === 'cancelled' ? 'muted' : 'warn'}">${esc(r.statusLabel || r.status)}</span>
        ${r.payment ? `<br><small class="muted">${esc(r.payment.date)}${r.payment.txId ? ' · ' + esc(r.payment.txId) : ''}${r.payment.source === 'report' ? ' · מהדוח' : ' · ידני'}</small>` : ''}</td>
      <td class="acct-actions">${r.status === 'open' ? `
        <button class="secondary small" data-collect-msg="${esc(r.id)}" title="נוסח הודעה עם הקישור, להעתקה">📋 הודעה ללקוח</button>
        <button class="primary small" data-collect-paid="${esc(r.id)}">✔ שולם</button>
        <button class="danger-outline small" data-collect-cancel="${esc(r.id)}" title="ביטול הדרישה">✖</button>` : ''}</td>
    </tr>`;
  return `${setup}
    <div class="card">
      <div class="acct-header">
        <div class="acct-actions">
          <select id="collectFilter">
            ${[['open', 'ממתינים לתשלום'], ['paid', 'שולמו'], ['cancelled', 'בוטלו'], ['all', 'הכול']].map(([v, l]) => `<option value="${v}"${filter === v ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="acct-actions">
          <button class="primary" id="collectNewBtn">➕ דרישת תשלום</button>
          <button class="secondary" id="collectImportBtn" title="קובץ CSV מאתר חברת הסליקה — התשלומים נרשמים אוטומטית">📥 קליטת דוח סליקה</button>
          <button class="secondary" id="collectTrainerBtn" title="תשלומי מנויים שנרשמו במודול האימונים — הפקת חשבונית מס/קבלה">🏋️ תשלומי אימונים</button>
          ${s.linkTemplate ? '<button class="secondary" id="collectSettingsBtn">⚙ הגדרות</button>' : ''}
        </div>
      </div>
      <div class="stats-grid">
        <div class="stat-card"><div class="label">ממתינים לתשלום</div><div class="value">${Number(sum.open || 0)}</div><small>${money(sum.openAmount || 0)}</small></div>
        <div class="stat-card"><div class="label">שולמו</div><div class="value">${Number(sum.paid || 0)}</div><small>${money(sum.paidAmount || 0)}</small></div>
        <div class="stat-card"><div class="label">חברת הסליקה</div><div class="value" style="font-size:1rem">${esc(providers[s.provider] || 'לא הוגדרה')}</div><small>${s.linkTemplate ? '🔗 קישור מוגדר' : 'בלי קישור'}</small></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>אסמכתא</th><th>משלם</th><th>עבור</th><th>סכום</th><th>מצב</th><th></th></tr></thead>
        <tbody>${shown.map(row).join('') || `<tr><td colspan="6" class="muted">${filter === 'open' ? 'אין דרישות שממתינות לתשלום' : 'אין דרישות'}</td></tr>`}</tbody>
      </table></div>
    </div>`;
}

// הודעה ללקוח: נוסח מוכן עם הקישור — להעתקה לדוא"ל, להודעה או להדפסה
function collectMessageDialog(m) {
  return openDialog((card, finish) => {
    card.style.maxWidth = '560px';
    const h = document.createElement('h2');
    h.textContent = 'הודעה ללקוח — ' + m.ref;
    const ta = document.createElement('textarea');
    ta.rows = 12;
    ta.readOnly = true;
    ta.value = m.text;
    ta.style.cssText = 'width:100%;font:inherit;padding:8px';
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = m.link ? 'הקישור פותח את דף התשלום המאובטח של חברת הסליקה שלכם, עם הסכום ומספר האסמכתא.' : 'לא הוגדר קישור תשלום — ההודעה כוללת את מספר האסמכתא בלבד.';
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'secondary'; close.textContent = 'סגירה';
    const copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'primary'; copy.textContent = '📋 העתקה';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(ta.value); showToast('ההודעה הועתקה'); }
      catch { ta.select(); showToast('סמנו והעתיקו (Ctrl+C)'); }
    });
    close.addEventListener('click', () => finish(null));
    actions.append(close, copy);
    card.append(h, p, ta, actions);
  });
}

// דרישה חדשה: בחירה של מה משולם — חשבונית פתוחה, תרומה, או תשלום בלוח הסילוקין של גמ"ח
async function collectNewRequest() {
  const kind = await licForm('דרישת תשלום חדשה', [{ name: 'kind', label: 'עבור מה התשלום?', type: 'select',
    options: [['invoice', '🧾 חשבונית פתוחה'], ['donation', '🤝 תרומה'], ['gemach', '🫱 החזר הלוואה בגמ"ח'], ['other', 'אחר']] }], 'המשך');
  if (!kind) return false;
  const base = { name: 'payerPhone', label: 'טלפון (לא חובה)' };
  let input = null;
  if (kind.kind === 'invoice') {
    const invoices = (await window.systemAPI.getInvoices()).filter(i => i.status === 'open');
    if (!invoices.length) throw new Error('אין חשבוניות פתוחות');
    const v = await licForm('תשלום חשבונית', [
      { name: 'targetId', label: 'חשבונית', type: 'select', options: invoices.map(i => [i.id, `${i.number} — ${i.customer} — ${i.total} ₪`]) }, base], 'יצירה');
    if (!v) return false;
    const inv = invoices.find(i => i.id === v.targetId);
    input = { kind: 'invoice', targetId: inv.id, amount: inv.total, payerName: inv.customer, payerPhone: v.payerPhone, description: `חשבונית ${inv.number}` };
  } else if (kind.kind === 'gemach') {
    const ov = await window.systemAPI.getGemachOverview();
    const loans = (ov.loans || []).filter(l => l.status === 'active');
    if (!loans.length) throw new Error('אין הלוואות פעילות');
    const v = await licForm('החזר הלוואה', [{ name: 'loanId', label: 'הלוואה', type: 'select', options: loans.map(l => [l.id, `${l.borrowerName} — נותר ${l.outstanding} ₪`]) }], 'המשך');
    if (!v) return false;
    const loan = await window.systemAPI.getGemachLoan(v.loanId);
    const due = (loan.schedule || []).filter(x => x.paidAg < x.amountAg);
    if (!due.length) throw new Error('ההלוואה נפרעה במלואה');
    const w = await licForm('החזר הלוואה — ' + loan.borrowerName, [
      { name: 'seq', label: 'תשלום', type: 'select', options: due.map(x => [String(x.seq), `${x.seq}. ${x.dueDate} — ${((x.amountAg - x.paidAg) / 100).toFixed(2)} ₪`]) }, base], 'יצירה');
    if (!w) return false;
    const item = due.find(x => String(x.seq) === w.seq);
    input = { kind: 'gemach', targetId: loan.id, seq: item.seq, amount: (item.amountAg - item.paidAg) / 100, payerName: loan.borrowerName,
      payerPhone: w.payerPhone, description: `החזר הלוואה — תשלום ${item.seq}` };
  } else {
    const fields = [{ name: 'payerName', label: kind.kind === 'donation' ? 'שם התורם' : 'שם המשלם', required: true },
      { name: 'amount', label: 'סכום (₪)', required: true }, base, { name: 'description', label: 'תיאור', value: kind.kind === 'donation' ? 'תרומה' : '' }];
    let npo = null;
    if (kind.kind === 'donation') {
      npo = await window.systemAPI.getNpoOverview();
      if (!(npo.settings || {}).orgName) throw new Error('יש להגדיר תחילה את פרטי העמותה (מסך "עמותה ותרומות")');
      fields.splice(1, 0, { name: 'donorId', label: 'ת.ז (לקבלה לפי סעיף 46 — לא חובה)' });
      const funds = (npo.funds || []).filter(f => !f.archived);
      if (funds.length > 1) fields.push({ name: 'fundId', label: 'קרן', type: 'select', options: funds.map(f => [f.id, f.name]) });
      const cmps = (npo.campaigns || []).filter(x => !x.closed);
      if (cmps.length) fields.push({ name: 'campaignId', label: 'קמפיין', type: 'select', options: [['', 'ללא'], ...cmps.map(x => [x.id, x.name])] });
    }
    const v = await licForm(kind.kind === 'donation' ? 'בקשת תרומה' : 'דרישת תשלום', fields, 'יצירה',
      kind.kind === 'donation' ? 'כשהתשלום יתקבל, התרומה תירשם עם קבלה — כמו תרומה רגילה.' : '');
    if (!v) return false;
    const amount = Number(String(v.amount).replace(/[₪,\s]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('סכום לא תקין');
    input = { kind: kind.kind, amount, payerName: v.payerName, payerPhone: v.payerPhone, description: v.description,
      donorId: v.donorId, fundId: v.fundId, campaignId: v.campaignId };
  }
  const r = await window.systemAPI.collectCreateRequest(input);
  await collectMessageDialog(await window.systemAPI.collectGetMessage(r.id));
  return true;
}

async function collectSettings() {
  const s = (state.data.collect && state.data.collect.settings) || {};
  const providers = (state.data.collect && state.data.collect.providers) || {};
  const v = await licForm('הגדרות גבייה', [
    { name: 'provider', label: 'חברת הסליקה', type: 'select', options: Object.entries(providers) },
    { name: 'linkTemplate', label: 'קישור התשלום (https://...)', value: s.linkTemplate || '' },
    { name: 'instructions', label: 'הוראות נוספות ללקוח (לא חובה)', value: s.instructions || '' },
  ], 'שמירה', 'מדביקים את קישור דף התשלום של הארגון. אפשר לשלב בו משתנים, אם חברת הסליקה תומכת בהם בקישור: ' + COLLECT_PLACEHOLDERS +
    '. למשל: https://.../pay?sum={amount}&comment={ref}. בלי משתנים — הלקוח מקליד את הסכום ואת מספר האסמכתא בעצמו.');
  if (!v) return false;
  await window.systemAPI.collectSaveSettings(v);
  showToast('ההגדרות נשמרו');
  return true;
}

// קליטת דוח: התאמת עמודות (נשמרת לפעם הבאה), תצוגה של מה יירשם — ואז רישום
async function collectImport() {
  const text = await pickCsvAnyEncoding();
  if (!text) return false;
  const pv = await window.systemAPI.collectPreviewImport(text);
  const fields = Object.entries(pv.fields).map(([k, f]) => ({ name: k, label: f.label + (f.required ? ' *' : ''), type: 'select',
    options: [['', '— אין —'], ...pv.headers.map(h => [h, h])], value: pv.mapping[k] || '' }));
  const m = pv.match && !pv.match.error ? pv.match : null;
  const intro = `${pv.total} שורות בקובץ.` + (m ? ` לפי ההתאמה המוצעת: ${m.matched.length} תשלומים יירשמו, ${m.unmatched.length} לא זוהו, ${m.skipped} דולגו (נכשלו או נקלטו כבר).` : '') +
    ' התאמה לפי מספר הדרישה (P00012) באסמכתא או בהערה; אחרת — לפי שם וסכום זהים.';
  const mapping = await licForm('קליטת דוח סליקה', fields, '📥 קליטה', intro);
  if (!mapping) return false;
  const r = await window.systemAPI.collectImportReport(text, mapping);
  showToast(`נרשמו ${r.recorded.length} תשלומים`);
  for (const f of r.failed) showError(`${f.ref} (שורה ${f.line}): ${f.message}`);
  if (r.unmatched.length) {
    await openDialog((card, finish) => {
      card.style.maxWidth = '640px';
      card.innerHTML = `<h2>תשלומים שלא זוהו (${r.unmatched.length})</h2>
        <p class="muted" style="padding:0 1.5rem">לא נרשמו. אם הם שייכים לדרישה — סמנו אותה "שולם" ידנית.</p>
        <div class="table-wrap" style="max-height:50vh"><table><thead><tr><th>שורה</th><th>תאריך</th><th>שם</th><th>סכום</th><th>סיבה</th></tr></thead><tbody>
        ${r.unmatched.map(u => `<tr><td>${u.line}</td><td>${esc(u.date)}</td><td>${esc(u.name)}</td><td>${(u.amountAg / 100).toFixed(2)}</td><td><small>${esc(u.reason)}</small></td></tr>`).join('')}
        </tbody></table></div><div class="modal-actions"><button type="button" class="primary" data-close>סגירה</button></div>`;
      const b = card.querySelector('[data-close]');
      if (b) b.addEventListener('click', () => finish(null));
    });
  }
  return true;
}

// נוסח האישור לפני הפקה — כל הפרטים שיופיעו במסמך
function collectTrainerConfirmText(p) {
  return `הפקת מסמך על ${money(p.amount)} ל${p.clientName} (${p.membershipName}), בתאריך ${p.date}, ב${p.methodLabel}. ` +
    'המסמך נרשם ביומן ומקבל מספר רץ. אחרי ההפקה אפשר לבטל אותו רק במסך החשבוניות.';
}
const COLLECT_TRAINER_DOCS = [['taxed', 'חשבונית מס/קבלה — עוסק מורשה (הסכום כולל מע"מ)'], ['exempt', 'חשבונית עסקה וקבלה — עוסק פטור (בלי מע"מ)']];

// תשלומי מנויים ממודול האימונים: רשימה, ולכל תשלום בלי חשבונית — הפקה אחרי אישור מפורש
async function collectTrainerPayments() {
  for (;;) {
    const r = await window.systemAPI.collectTrainerPayments();
    if (!r.available) { showError(r.reason || 'תשלומי האימונים אינם זמינים'); return false; }
    const list = r.payments || [];
    const pick = await openDialog((card, finish) => {
      card.style.maxWidth = '720px';
      const row = (p) => `<tr><td>${esc(p.date)}</td><td>${esc(p.clientName)}<br><small class="muted">${esc(p.membershipName)}${p.cancelled ? ' · בוטל' : ''}</small></td>
        <td>${money(p.amount)}</td><td>${esc(p.methodLabel)}</td>
        <td>${p.invoiceNumber ? `<span class="badge good">חשבונית ${esc(p.invoiceNumber)}</span>` : `<button type="button" class="primary small" data-trainer-issue="${esc(p.key)}">🧾 הפקה</button>`}</td></tr>`;
      card.innerHTML = `<h2>🏋️ תשלומי אימונים</h2>
        <p class="muted" style="padding:0 1.5rem">התשלומים שנרשמו במודול האימונים, בכרטיס המתאמן. לכל תשלום אפשר להפיק חשבונית מס/קבלה אחת, אחרי אישור.</p>
        <div class="table-wrap" style="max-height:55vh"><table><thead><tr><th>תאריך</th><th>מתאמן</th><th>סכום</th><th>אמצעי</th><th></th></tr></thead><tbody>
        ${list.map(row).join('') || '<tr><td colspan="5" class="muted">לא נרשמו תשלומים במודול האימונים</td></tr>'}
        </tbody></table></div><div class="modal-actions"><button type="button" class="secondary" data-close>סגירה</button></div>`;
      card.querySelector('[data-close]').addEventListener('click', () => finish(null));
      card.querySelectorAll('[data-trainer-issue]').forEach(b => b.addEventListener('click', () => finish(b.dataset.trainerIssue)));
    });
    const p = pick && list.find(x => x.key === pick);
    if (!p) return true;
    const v = await licForm('אישור הפקה', [{ name: 'doc', label: 'סוג המסמך', type: 'select', options: COLLECT_TRAINER_DOCS,
      value: r.exemptDefault ? 'exempt' : 'taxed' }], '🧾 אישור והפקה', collectTrainerConfirmText(p));
    if (!v) continue;
    const inv = await window.systemAPI.collectIssueTrainerReceipt(p.key, { confirmed: true, exempt: v.doc === 'exempt' });
    showToast(inv.exempt ? `הופקו חשבונית עסקה ${inv.number} וקבלה ${inv.receiptNumber} — להדפסה במסך החשבוניות`
      : `הופקה חשבונית מס/קבלה ${inv.number} — להדפסה במסך החשבוניות`);
  }
}

function attachCollectHandlers() {
  const act = (fn) => async () => { try { await fn(); } catch (error) { showError(errMsg(error)); return; } await switchView('collect'); };
  const on = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', act(fn)); };
  on('collectNewBtn', collectNewRequest);
  on('collectSettingsBtn', collectSettings);
  on('collectImportBtn', collectImport);
  on('collectTrainerBtn', collectTrainerPayments);
  const flt = document.getElementById('collectFilter');
  if (flt) flt.addEventListener('change', act(() => { state.collectFilter = flt.value; }));
  document.querySelectorAll('[data-collect-msg]').forEach(b => b.addEventListener('click', act(async () => {
    await collectMessageDialog(await window.systemAPI.collectGetMessage(b.dataset.collectMsg));
  })));
  document.querySelectorAll('[data-collect-paid]').forEach(b => b.addEventListener('click', act(async () => {
    const v = await licForm('סימון כשולם', [{ name: 'date', label: 'תאריך התשלום', type: 'date', value: new Date().toLocaleDateString('en-CA') },
      { name: 'txId', label: 'מספר עסקה / אישור (לא חובה)' }], '✔ שולם', 'התשלום יירשם במקומו: גביית החשבונית, תרומה עם קבלה, או תשלום בלוח הסילוקין.');
    if (v) await window.systemAPI.collectMarkPaid(b.dataset.collectPaid, v);
  })));
  document.querySelectorAll('[data-collect-cancel]').forEach(b => b.addEventListener('click', act(async () => {
    if (await askConfirm('לבטל את דרישת התשלום? הקישור שכבר נשלח ימשיך לעבוד אצל חברת הסליקה — אם הלקוח ישלם, יש לטפל בזה ידנית.')) {
      await window.systemAPI.collectCancelRequest(b.dataset.collectCancel);
    }
  })));
}
