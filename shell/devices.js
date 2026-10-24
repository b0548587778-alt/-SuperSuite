// מסך "מכשירים מחוברים" במעטפת: הפעלת הסנכרון, צימוד בקוד, השוואת קוד אימות וביטול מכשיר.
// כל הנתונים מגיעים מ-shellAPI.sync (main.js, למנהל בלבד). שם מכשיר מגיע מהצד השני — לכן הכול
// נבנה ב-textContent, בלי innerHTML.
(function () {
  const api = window.shellAPI && window.shellAPI.sync;
  const $ = (id) => document.getElementById(id);
  const dlg = $('devDlg');
  if (!api || !dlg) return;

  let st = null;
  let open = false;
  let tick = null;
  const pingResults = new Map(); // peerId → טקסט; נשמר בין רינדורים (המסך מתרענן בכל שינוי)

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function btn(text, cls, onclick) {
    const b = el('button', cls, text);
    b.type = 'button';
    b.onclick = async () => {
      b.disabled = true;
      try { await onclick(); } catch (err) { showError(err); } finally { b.disabled = false; }
    };
    return b;
  }
  // הודעת שגיאה מ-IPC: Electron מוסיף קידומת אנגלית ("Error invoking remote method...") — מציגים רק את העברית
  function message(err) {
    const m = String((err && err.message) || err || 'שגיאה');
    return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }
  function showError(err) { $('devErr').textContent = err ? message(err) : ''; }
  const fmtCode = (c) => c.slice(0, 3) + ' ' + c.slice(3);
  const fmtTime = (ms) => {
    if (!ms) return '—';
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  async function refresh() {
    if (!open) return;
    try {
      st = await api.status();
      $('devLogin').hidden = true;
      $('devBody').hidden = false;
    } catch (err) {
      st = null;
      $('devLogin').hidden = false;
      $('devBody').hidden = true;
      return;
    }
    render();
  }

  // ── המכשיר הזה ──
  function renderSelf() {
    const box = $('devSelf');
    box.replaceChildren();
    if (!st.available) {
      box.append(el('p', 'warn', 'הצפנת המערכת של Windows אינה זמינה בחשבון זה, ולכן אי אפשר לשמור מפתחות סנכרון בבטחה. הסנכרון אינו זמין.'));
      return;
    }
    const row = el('label', 'chk');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = st.enabled;
    cb.onchange = async () => {
      cb.disabled = true;
      try {
        if (cb.checked && !(await ssDialog.confirm('הפעלת הסנכרון: המחשב יתחיל לקבל חיבורים מהרשת (רק ממכשירים שתצמדו).\nWindows עשוי לבקש אישור של חומת האש.\n\nלהפעיל?', { okText: 'הפעלה' }))) { cb.checked = false; return; }
        await api.setEnabled(cb.checked);
      } catch (err) { showError(err); } finally { cb.disabled = false; refresh(); }
    };
    row.append(cb, document.createTextNode(' סנכרון פעיל — המכשיר מקבל חיבורים ממכשירים מצומדים'));
    box.append(row);

    let line;
    if (!st.enabled) line = 'הסנכרון כבוי. המכשיר אינו מאזין לרשת.';
    else if (st.paused) line = 'מצב שבת: הסנכרון מושהה ויחזור אחרי צאת השבת / החג.';
    else if (st.listening) line = `פעיל · מאזין בפורט ${st.listening}` + (st.addresses.length ? ` · כתובת ברשת: ${st.addresses.join(', ')}` : '');
    else line = 'הסנכרון אינו פעיל כרגע.';
    box.append(el('div', 'state' + (st.enabled && st.listening ? ' on' : ''), line));
    if (st.error) box.append(el('p', 'warn', st.error));
    if (st.stateUnreadable) {
      box.append(el('p', 'warn', 'רשימת המכשירים המצומדים לא נקראה בחשבון זה (למשל אחרי העברת התוכנה למחשב אחר). בהפעלה הבאה תתחיל רשימה חדשה, והקובץ הישן יישמר בצד בתיקיית הנתונים — לא יימחק.'));
    }
    if (st.identityUnreadable) {
      box.append(el('p', 'warn', 'זהות הסנכרון של המכשיר הזה לא נפתחת בחשבון זה. אפשר ליצור זהות חדשה: הקובץ הישן יישמר בצד, וכל המכשירים יצטרכו צימוד מחדש.'));
      box.append(btn('יצירת זהות חדשה', 'danger', async () => {
        if (!(await ssDialog.confirm('יצירת זהות סנכרון חדשה למכשיר הזה.\nהמכשירים שצומדו קודם לא יכירו אותו, ויש לצמד אותם מחדש (ולבטל אצלם את המכשיר הישן).\n\nלהמשיך?', { danger: true, okText: 'יצירה' }))) return;
        await api.resetIdentity();
        refresh();
      }));
    }

    if (st.device) {
      const nameRow = el('div', 'inline');
      const name = el('input');
      name.value = st.device.name;
      name.maxLength = 60;
      name.setAttribute('aria-label', 'שם המכשיר');
      nameRow.append(el('span', 'lbl', 'שם המכשיר (כפי שיופיע במכשירים האחרים)'), name,
        btn('שמירה', '', async () => { await api.rename(name.value); refresh(); }));
      box.append(nameRow);
      box.append(el('div', 'fp', 'מזהה: ' + st.device.id));
    }

    const adv = el('details', 'adv');
    adv.append(el('summary', '', 'מתקדם'));
    const portRow = el('div', 'inline');
    const port = el('input');
    port.type = 'number'; port.min = '1024'; port.max = '65535'; port.value = String(st.port);
    port.setAttribute('aria-label', 'פורט');
    portRow.append(el('span', 'lbl', 'פורט להאזנה (לחיבור דרך האינטרנט — יש להפנות אותו בנתב)'), port,
      btn('שמירה', '', async () => { await api.setPort(Number(port.value)); refresh(); }));
    adv.append(portRow);
    box.append(adv);
  }

  // ── אישור צימוד: השוואת 6 הספרות ──
  function renderApprovals() {
    const box = $('devApprove');
    box.replaceChildren();
    box.hidden = !st.approvals.length;
    for (const a of st.approvals) {
      const card = el('div', 'approve');
      card.append(el('b', '', a.direction === 'incoming' ? `בקשת צימוד מ«${a.name}»` : `צימוד עם «${a.name}»`));
      card.append(el('div', 'sas', fmtCode(a.code)));
      card.append(el('p', '', 'ודאו שבמכשיר השני מוצג בדיוק אותו מספר. אם המספרים שונים — ייתכן שמישהו מנסה להתחזות. בטלו וצרו קוד חדש.'));
      const row = el('div', 'row');
      row.append(
        btn('המספרים זהים — אישור', 'primary', async () => { await api.approve(a.reqId); refresh(); }),
        btn('לא זהים — ביטול', 'danger', async () => { await api.reject(a.reqId); refresh(); }),
      );
      card.append(row);
      box.append(card);
    }
  }

  // ── צימוד מכשיר חדש ──
  function renderPair() {
    const box = $('devPair');
    box.replaceChildren();
    if (!st.enabled || !st.listening) {
      box.append(el('p', 'muted', 'כדי לצמד מכשיר יש להפעיל את הסנכרון בשני המכשירים.'));
      return;
    }
    if (st.pairing) {
      box.append(el('p', '', 'העבירו את הקוד למכשיר השני (העתקה והדבקה, למשל בדיסק-און-קי). הקוד חד-פעמי.'));
      const ta = el('textarea', 'code');
      ta.readOnly = true; ta.value = st.pairing.code; ta.rows = 3;
      ta.onfocus = () => ta.select();
      const left = el('div', 'muted countdown');
      const upd = () => {
        const s = Math.max(0, Math.round((st.pairing.expiresAt - Date.now()) / 1000));
        left.textContent = s ? `בתוקף עוד ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} דקות` : 'הקוד פג תוקף';
      };
      upd();
      clearInterval(tick);
      tick = setInterval(() => { if (!open || !st || !st.pairing) return clearInterval(tick); upd(); }, 1000);
      const row = el('div', 'row');
      row.append(
        btn('העתקה', 'primary', async () => { ta.focus(); ta.select(); document.execCommand('copy'); }),
        btn('ביטול הקוד', '', async () => { await api.cancelInvite(); refresh(); }),
      );
      box.append(ta, left, row);
      return;
    }
    // יצירת קוד במכשיר הזה
    const mk = el('div', 'half');
    mk.append(el('h4', '', 'צירוף מכשיר אחר למכשיר הזה'));
    const sel = el('select');
    sel.setAttribute('aria-label', 'הכתובת שהמכשיר השני יתחבר אליה');
    for (const a of st.addresses) sel.append(new Option(`${a} (רשת מקומית)`, a));
    sel.append(new Option('כתובת אחרת (חיבור דרך האינטרנט)…', ''));
    const custom = el('input');
    custom.placeholder = 'כתובת IP חיצונית או שם';
    custom.hidden = st.addresses.length > 0;
    sel.onchange = () => { custom.hidden = sel.value !== ''; };
    mk.append(el('span', 'lbl', 'הכתובת שהמכשיר השני יתחבר אליה'), sel, custom,
      btn('יצירת קוד צימוד', 'primary', async () => {
        const host = sel.value || custom.value.trim();
        if (!host) throw new Error('יש להזין כתובת');
        await api.createInvite(host);
        refresh();
      }));
    // הצטרפות בקוד ממכשיר אחר
    const jn = el('div', 'half');
    jn.append(el('h4', '', 'הצטרפות בקוד ממכשיר אחר'));
    const code = el('textarea', 'code');
    code.rows = 3; code.placeholder = 'הדביקו כאן את קוד הצימוד (מתחיל ב-SSPAIR1.)';
    const ep = el('input');
    ep.placeholder = 'כתובת (לא חובה — אם הקוד לא מתחבר לבד)';
    ep.dir = 'ltr';
    jn.append(code, ep, btn('צימוד', 'primary', async () => {
      showError(null);
      await api.join(code.value, ep.value.trim());
      code.value = '';
      refresh();
    }));
    box.append(mk, jn);
  }

  // ── מכשירים מצומדים ──
  function renderPeers() {
    const box = $('devPeers');
    box.replaceChildren();
    const peers = [...st.peers].sort((a, b) => (a.revoked - b.revoked) || (b.connected - a.connected));
    if (!peers.length) { box.append(el('p', 'muted', 'עדיין אין מכשירים מצומדים.')); return; }
    for (const p of peers) {
      const row = el('div', 'peer' + (p.revoked ? ' revoked' : ''));
      const head = el('div', 'peer-h');
      head.append(el('b', '', p.name));
      head.append(el('span', 'chip ' + (p.revoked ? 'off' : p.connected ? 'ok' : ''), p.revoked ? 'בוטל' : p.connected ? 'מחובר' : 'לא מחובר'));
      row.append(head);
      const meta = p.revoked
        ? `בוטל ב-${fmtTime(p.revokedAt)}`
        : `צומד ב-${fmtTime(p.pairedAt)} · נראה לאחרונה: ${fmtTime(p.lastSeen)}` + (p.endpoint ? ` · ${p.endpoint}` : '');
      row.append(el('div', 'muted', meta));
      if (!p.revoked) {
        const actions = el('div', 'row');
        const result = el('span', 'muted', pingResults.get(p.id) || '');
        const addr = el('div', 'inline');
        addr.hidden = true;
        const addrIn = el('input');
        addrIn.placeholder = 'כתובת:פורט, למשל 192.168.1.20:47700';
        addrIn.dir = 'ltr';
        addr.append(addrIn, btn('התחברות', 'primary', async () => {
          await api.connect(p.id, addrIn.value.trim());
          refresh();
        }));
        actions.append(
          btn('בדיקת חיבור', '', async () => {
            const show = (t) => { pingResults.set(p.id, t); refresh(); };
            show('בודק…');
            try { const r = await api.ping(p.id); show(`✓ המכשיר ענה (${r.ms} אלפיות שנייה)`); }
            catch (err) { show('✗ ' + message(err)); }
          }),
          btn('כתובת…', '', async () => { addr.hidden = !addr.hidden; if (!addr.hidden) addrIn.focus(); }),
          btn('ביטול מכשיר', 'danger', async () => {
            if (!(await ssDialog.confirm(`לבטל את «${p.name}»?\nהמכשיר ינותק מיד ולא יוכל להתחבר עוד. כדי לחבר אותו שוב יהיה צורך בצימוד חדש.`, { danger: true, okText: 'ביטול המכשיר', cancelText: 'חזרה' }))) return;
            await api.revoke(p.id);
            refresh();
          }),
          result,
        );
        row.append(actions, addr);
      }
      box.append(row);
    }
  }

  function render() {
    renderSelf();
    renderApprovals();
    renderPair();
    renderPeers();
  }

  function show() {
    open = true;
    showError(null);
    dlg.oncancel = (e) => { e.preventDefault(); hide(); };
    if (window.shellAPI.setOverlay) window.shellAPI.setOverlay(true);
    dlg.showModal();
    refresh();
  }
  function hide() {
    open = false;
    clearInterval(tick);
    dlg.close();
    if (window.shellAPI.setOverlay && !document.body.classList.contains('shabbat')) window.shellAPI.setOverlay(false);
  }

  $('dv').onclick = show;
  $('devClose').onclick = hide;
  // מצב שבת: מסך השבת במעטפת, או שהשירות מדווח "מושהה" (ייתכן שהמסך עוד לא התעדכן)
  const restTime = (s) => document.body.classList.contains('shabbat') || !!(s && s.paused);
  api.onChanged(() => {
    // בקשת צימוד נכנסת כשהמסך סגור — פותחים אותו, כדי שהמשתמש יראה את הקוד להשוואה. לא בשבת: בקשה שלא נענתה
    // לפני כניסת השבת פתחה את החלון מעל מסך השבת (בדיקת קוד 23.10.2026)
    if (!open) { api.status().then((s) => { if (s.approvals.length && !restTime(s)) show(); }).catch(() => {}); return; }
    // החלון פתוח (למשל נפתח מעצמו ביום שישי) והשבת נכנסה: showModal שם אותו בשכבה העליונה, מעל מסך השבת — סוגרים
    api.status().then((s) => { if (restTime(s)) hide(); else refresh(); }).catch(() => refresh());
  });
  // מסך השבת עולה בלי אירוע של הסנכרון (הסנכרון כבוי, או שהשירות עוד לא בדק) — סוגרים גם אז
  if (typeof MutationObserver === 'function') {
    new MutationObserver(() => { if (open && document.body.classList.contains('shabbat')) hide(); })
      .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
})();
