// ממשק המודול הכלכלי — הודעות מאובטחות בין המערכות.
// סקריפט רגיל (לא מודול): כל קבצי ui/ חולקים טווח שמות אחד, לפי הסדר ב-views/index.html.
'use strict';

// ============================================================
// הודעות: תקשורת מאובטחת בין מנהל-העל, הלקוחות ומערכות הבת — מוצפנת מקצה לקצה וחתומה
// ============================================================
const CHAT_ROLES = { owner: 'מנהל-העל', parent: 'המערכת המנפיקה', child: 'מערכת בת', tenant: 'לקוח' };
const CHAT_STATUS = { sent: '✓', delivered: '✓✓', read: '✓✓ נקרא' };
const CHAT_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const CHAT_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#64748b'];
const CHAT_IMAGE = /^image\/(png|jpeg|gif|webp)$/;
const CHAT_EDIT_MS = 15 * 60 * 1000;
const CHAT_DELETE_ALL_MS = 48 * 60 * 60 * 1000;
const CHAT_MAX_FILE = 110 * 1024;
// סוג הקובץ לפי הסיומת (ב-Windows הדפדפן לא תמיד יודע — למשל CSV)
const CHAT_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
  txt: 'text/plain', csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const chatTime = (ms) => (ms ? new Date(ms).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const chatKb = (n) => (Number(n) >= 1024 ? Math.round(Number(n) / 1024) + 'KB' : Number(n || 0) + 'B');
const chatPreview = (x) => (x.deleted ? '🚫 ההודעה נמחקה' : x.att && !x.text ? '📎 ' + x.att.name : String(x.text || '').slice(0, 90));
const chatColor = (c) => (CHAT_COLORS.includes(c) ? c : CHAT_COLORS[0]);

function chatLabelChips(ids, labels) {
  return (ids || []).map((id) => {
    const l = (labels || []).find(x => x.id === id);
    return l ? `<span class="chat-label" style="background:${chatColor(l.color)}">${esc(l.name)}</span>` : '';
  }).join('');
}

function chatBubble(x, ctx) {
  const { byMid, peer, now } = ctx;
  let quote = '';
  if (x.replyTo) {
    const q = byMid.get(x.replyTo);
    quote = `<div class="chat-quote">${q ? `<b>${esc(q.dir === 'out' ? 'את/ה' : peer.name)}</b> ${esc(chatPreview(q))}` : '<i>הודעה שאינה זמינה</i>'}</div>`;
  }
  const flags = [x.forwarded ? '↪ הועברה' : '', x.auto ? '🤖 הודעה אוטומטית' : '', x.bc ? '📢 נשלחה ברשימת תפוצה' : ''].filter(Boolean)
    .map(f => `<small class="chat-flag">${f}</small>`).join('');
  let body;
  if (x.deleted) body = '<i class="muted">🚫 ההודעה נמחקה</i>';
  else {
    body = (x.subject ? `<b>${esc(x.subject)}</b><br>` : '') + esc(x.text || '').replace(/\n/g, '<br>');
    if (x.att) {
      const a = x.att;
      const img = a.data && CHAT_IMAGE.test(a.type) && /^[A-Za-z0-9+/=]+$/.test(a.data)
        ? `<img class="chat-img" alt="${esc(a.name)}" src="data:${a.type};base64,${a.data}">` : '';
      body = `<div class="chat-att">${img}<span>📎 ${esc(a.name)} <small>(${esc(chatKb(a.size))})</small></span>
        ${a.available ? `<button class="secondary small" data-chat-save="${esc(x.mid)}">💾 שמירה</button>` : '<small class="muted">הקובץ אינו זמין עוד במחשב הזה</small>'}</div>` + body;
    }
  }
  const canEdit = x.dir === 'out' && !x.deleted && !x.auto && !(x.att && !x.text) && now - x.sentAt <= CHAT_EDIT_MS;
  const actions = x.deleted ? `<button class="chat-act" data-chat-del="${esc(x.mid)}" data-chat-del-all="0" title="מחיקה אצלי">🗑</button>` : `
    <button class="chat-act" data-chat-reply="${esc(x.mid)}" title="תגובה">↩</button>
    <button class="chat-act" data-chat-star="${esc(x.mid)}" data-on="${x.starred ? '0' : '1'}" title="${x.starred ? 'הסרת כוכב' : 'סימון בכוכב'}">${x.starred ? '★' : '☆'}</button>
    <button class="chat-act" data-chat-fwd="${esc(x.mid)}" title="העברה">↪</button>
    ${canEdit ? `<button class="chat-act" data-chat-edit="${esc(x.mid)}" title="עריכה">✏</button>` : ''}
    <button class="chat-act" data-chat-del="${esc(x.mid)}" data-chat-del-all="${x.dir === 'out' && now - x.sentAt <= CHAT_DELETE_ALL_MS ? '1' : '0'}" title="מחיקה">🗑</button>`;
  return `<div class="chat-msg ${x.dir}" id="msg-${esc(x.mid)}">
    ${flags}${quote}${body}
    <small>${esc(chatTime(x.sentAt))}${x.editedAt && !x.deleted ? ' · נערכה' : ''}${x.starred ? ' · ★' : ''}${x.dir === 'out' ? ' ' + esc(CHAT_STATUS[x.status] || '') : ''}</small>
    <div class="chat-actions">${actions}</div>
  </div>`;
}

function chatProfileBox(p) {
  if (!p || !(p.about || p.address || p.phone || p.email || p.website)) return '';
  const row = (icon, v) => (v ? `<span>${icon} ${esc(v)}</span>` : '');
  return `<div class="chat-profile">${p.name ? `<b>${esc(p.name)}</b>` : ''}${p.about ? `<p>${esc(p.about)}</p>` : ''}
    <div class="chat-profile-rows">${row('📍', p.address)}${row('📞', p.phone)}${row('✉', p.email)}${row('🌐', p.website)}</div></div>`;
}

function chatSettingsPanel(s, contacts) {
  const day = (h, i) => `<div class="chat-hours-row" data-day="${i}">
    <label class="check"><input type="checkbox" data-h-open ${h ? 'checked' : ''}> ${CHAT_DAYS[i]}</label>
    <input type="time" data-h-from value="${esc(h ? h.open : '09:00')}"> – <input type="time" data-h-to value="${esc(h ? h.close : '17:00')}"></div>`;
  const qr = (q, i) => `<div class="chat-set-row" data-qr="${i}"><span>/</span><input type="text" data-qr-key maxlength="24" placeholder="קיצור" value="${esc(q.shortcut)}">
    <textarea data-qr-text rows="2" maxlength="4000" placeholder="נוסח התשובה">${esc(q.text)}</textarea>
    <button type="button" class="danger-outline small" title="הסרה" data-chat-set-del="quickReplies" data-i="${i}">✖</button></div>`;
  const lb = (l, i) => `<div class="chat-set-row" data-lb="${i}" data-id="${esc(l.id || '')}"><input type="text" data-lb-name maxlength="30" value="${esc(l.name)}">
    <select data-lb-color>${CHAT_COLORS.map(c => `<option value="${c}"${chatColor(l.color) === c ? ' selected' : ''} style="background:${c};color:#fff">${c}</option>`).join('')}</select>
    <span class="chat-label" style="background:${chatColor(l.color)}">${esc(l.name || 'תווית')}</span>
    <button type="button" class="danger-outline small" title="הסרה" data-chat-set-del="labels" data-i="${i}">✖</button></div>`;
  const ls = (l, i) => `<fieldset class="chat-list-set" data-ls="${i}" data-id="${esc(l.id || '')}"><legend><input type="text" data-ls-name maxlength="40" value="${esc(l.name)}" placeholder="שם הרשימה"></legend>
    ${contacts.map(c => `<label class="check"><input type="checkbox" data-ls-member value="${esc(c.id)}"${(l.members || []).includes(c.id) ? ' checked' : ''}> ${esc(c.name)}</label>`).join('') || '<small class="muted">אין אנשי קשר</small>'}
    <button type="button" class="danger-outline small" title="הסרה" data-chat-set-del="lists" data-i="${i}">✖ מחיקת הרשימה</button></fieldset>`;
  const p = s.profile || {};
  return `<div class="card chat-settings" id="chatSettings">
    <h3>⚙ הגדרות העסק</h3>
    <section><h4>פרופיל עסקי</h4><p class="muted">מוצג לאנשי הקשר בראש השיחה איתכם, אחרי לחיצה על "שליחת הפרופיל".</p>
      <div class="chat-set-grid">
        <label class="field"><span>שם העסק</span><input type="text" data-p="name" maxlength="80" value="${esc(p.name)}"></label>
        <label class="field"><span>טלפון</span><input type="text" data-p="phone" maxlength="30" value="${esc(p.phone)}"></label>
        <label class="field"><span>כתובת</span><input type="text" data-p="address" maxlength="200" value="${esc(p.address)}"></label>
        <label class="field"><span>דוא"ל</span><input type="text" data-p="email" maxlength="120" value="${esc(p.email)}"></label>
        <label class="field"><span>אתר (https://)</span><input type="text" data-p="website" maxlength="200" value="${esc(p.website)}"></label>
      </div>
      <label class="field"><span>תיאור</span><textarea data-p="about" rows="2" maxlength="500">${esc(p.about)}</textarea></label>
    </section>
    <section><h4>שעות פעילות</h4>${(s.hours || []).map(day).join('')}</section>
    <section><h4>הודעות אוטומטיות</h4>
      <p class="muted">בשבת וביום טוב (כשמצב שבת מופעל) לא נשלחות הודעות אוטומטיות. כדי שיישלחו גם כשאיש לא ליד המחשב — יש להפעיל קבלה אוטומטית.</p>
      <label class="check"><input type="checkbox" id="chatSetAutoFetch"${s.autoFetch ? ' checked' : ''}> קבלת הודעות אוטומטית כל 3 דקות</label>
      <label class="check"><input type="checkbox" id="chatSetGreetOn"${s.greeting.enabled ? ' checked' : ''}> הודעת פתיחה — לפונה חדש, או למי שלא היה קשר איתו</label>
      <label class="field"><span>ימים ללא קשר</span><input type="number" id="chatSetGreetDays" min="1" max="90" value="${Number(s.greeting.quietDays) || 14}"></label>
      <label class="field"><span>נוסח הודעת הפתיחה</span><textarea id="chatSetGreetText" rows="2" maxlength="4000">${esc(s.greeting.text)}</textarea></label>
      <label class="check"><input type="checkbox" id="chatSetAwayOn"${s.away.enabled ? ' checked' : ''}> הודעת היעדרות — מחוץ לשעות הפעילות (פעם ב-12 שעות לכל שיחה)</label>
      <label class="check"><input type="checkbox" id="chatSetAwayAlways"${s.away.always ? ' checked' : ''}> גם בשעות הפעילות (למשל בחופשה)</label>
      <label class="field"><span>נוסח הודעת ההיעדרות</span><textarea id="chatSetAwayText" rows="2" maxlength="4000">${esc(s.away.text)}</textarea></label>
    </section>
    <section><h4>תשובות מהירות</h4><p class="muted">בכתיבת הודעה מקלידים / ואת הקיצור, ובוחרים מהרשימה.</p>
      ${(s.quickReplies || []).map(qr).join('')}<button type="button" class="secondary small" data-chat-set-add="quickReplies">➕ תשובה מהירה</button></section>
    <section><h4>תוויות</h4>${(s.labels || []).map(lb).join('')}<button type="button" class="secondary small" data-chat-set-add="labels">➕ תווית</button></section>
    <section><h4>רשימות תפוצה</h4><p class="muted">הודעה לרשימה נשלחת לכל אחד בנפרד — הנמענים אינם רואים זה את זה.</p>
      ${(s.lists || []).map(ls).join('')}<button type="button" class="secondary small" data-chat-set-add="lists">➕ רשימה</button></section>
    <div class="acct-actions">
      <button class="primary" id="chatSetSave">💾 שמירה</button>
      <button class="secondary" id="chatSetPublish">📤 שליחת הפרופיל לאנשי הקשר</button>
      <button class="secondary" data-chat-panel="">סגירה</button>
    </div>
  </div>`;
}

// קריאת טופס ההגדרות כפי שהוא על המסך (גם לפני שמירה — כדי שהוספה/מחיקה של שורה לא תמחק את מה שהוקלד)
function chatCollectSettings() {
  const root = document.getElementById('chatSettings');
  if (!root || !root.querySelectorAll) return null;
  const on = (id) => { const e = document.getElementById(id); return !!(e && e.checked); };
  const v = (id) => { const e = document.getElementById(id); return e ? e.value : ''; };
  const profile = {};
  root.querySelectorAll('[data-p]').forEach((e) => { profile[e.dataset.p] = e.value; });
  const hours = [...root.querySelectorAll('[data-day]')].map((r) => {
    const open = r.querySelector('[data-h-open]');
    return open && open.checked ? { open: r.querySelector('[data-h-from]').value, close: r.querySelector('[data-h-to]').value } : null;
  });
  return {
    profile, hours, autoFetch: on('chatSetAutoFetch'),
    greeting: { enabled: on('chatSetGreetOn'), text: v('chatSetGreetText'), quietDays: Number(v('chatSetGreetDays')) || 14 },
    away: { enabled: on('chatSetAwayOn'), always: on('chatSetAwayAlways'), text: v('chatSetAwayText') },
    quickReplies: [...root.querySelectorAll('[data-qr]')].map(r => ({ shortcut: r.querySelector('[data-qr-key]').value, text: r.querySelector('[data-qr-text]').value })),
    labels: [...root.querySelectorAll('[data-lb]')].map(r => ({ id: r.dataset.id, name: r.querySelector('[data-lb-name]').value, color: r.querySelector('[data-lb-color]').value })),
    lists: [...root.querySelectorAll('[data-ls]')].map(r => ({ id: r.dataset.id, name: r.querySelector('[data-ls-name]').value,
      members: [...r.querySelectorAll('[data-ls-member]')].filter(c => c.checked).map(c => c.value) })),
  };
}

function renderMessages(d) {
  const m = d || {};
  const convs = Array.isArray(m.conversations) ? m.conversations : [];
  const thread = Array.isArray(m.thread) ? m.thread : [];
  const labels = Array.isArray(m.labels) ? m.labels : [];
  const lists = Array.isArray(m.lists) ? m.lists : [];
  const contacts = Array.isArray(m.contacts) ? m.contacts : convs;
  const peer = convs.find(c => c.id === m.peer) || contacts.find(c => c.id === m.peer) || null;
  const filter = state.chatFilter || 'all';
  const head = `<div class="acct-header">
      <div class="acct-actions">
        ${m.ownerUnlocked ? `<select id="chatAs"><option value=""${m.as ? '' : ' selected'}>בשם המערכת הזו</option><option value="owner"${m.as === 'owner' ? ' selected' : ''}>בשם מנהל-העל</option></select>` : ''}
        <input id="chatSearch" type="search" placeholder="חיפוש בהודעות" value="${esc(state.chatQuery || '')}">
        ${m.remote ? `<select id="chatFilter" title="סינון שיחות">
          <option value="all"${filter === 'all' ? ' selected' : ''}>כל השיחות</option>
          <option value="unread"${filter === 'unread' ? ' selected' : ''}>לא נקראו</option>
          <option value="archived"${filter === 'archived' ? ' selected' : ''}>🗄 ארכיון</option>
          ${labels.map(l => `<option value="label:${esc(l.id)}"${filter === 'label:' + l.id ? ' selected' : ''}>🏷 ${esc(l.name)}</option>`).join('')}
        </select>` : ''}
      </div>
      <div class="acct-actions">${m.remote ? `
        <button class="secondary" data-chat-panel="starred">⭐ מסומנות</button>
        ${lists.length ? '<button class="secondary" data-chat-panel="broadcast">📢 הודעת תפוצה</button>' : ''}
        ${m.isAdmin ? '<button class="secondary" data-chat-panel="settings">⚙ הגדרות העסק</button>' : ''}
        <button class="primary" id="chatRefreshBtn">🔄 קבלת הודעות</button>` : ''}</div>
    </div>`;
  if (!m.remote) {
    return `<div class="card">${head}<p class="muted">ההודעות עוברות דרך שרת הרישוי. יש להגדיר שרת במסך "רישוי ומערכות" ← "עבודה מרחוק".</p></div>`;
  }
  let panel = '';
  if (state.chatPanel === 'settings' && m.panel && m.panel.settings) {
    panel = chatSettingsPanel(state.chatSettingsDraft || m.panel.settings, m.panel.contacts || []);
  } else if (state.chatPanel === 'broadcast' && m.panel && m.panel.settings) {
    const ls = m.panel.settings.lists || [];
    panel = `<div class="card chat-panel"><h3>📢 הודעת תפוצה</h3>
      <p class="muted">כל נמען מקבל את ההודעה בנפרד, מוצפנת אליו, ואינו רואה את שאר הנמענים.</p>
      <label class="field"><span>רשימה</span><select id="chatBcList">${ls.map(l => `<option value="${esc(l.id)}">${esc(l.name)} (${l.members.length})</option>`).join('')}</select></label>
      <label class="field"><span>נושא (לא חובה)</span><input id="chatBcSubject" type="text" maxlength="120"></label>
      <label class="field"><span>הודעה</span><textarea id="chatBcText" rows="4" maxlength="4000"></textarea></label>
      <div class="acct-actions"><button class="primary" id="chatBcSend">📢 שליחה לכל הרשימה</button><button class="secondary" data-chat-panel="">סגירה</button></div></div>`;
  } else if (state.chatPanel === 'starred' && m.panel) {
    const st = m.panel.starred || [];
    const nameOf = (id) => { const c = contacts.find(x => x.id === id); return c ? c.name : ''; };
    panel = `<div class="card chat-panel"><h3>⭐ הודעות מסומנות (${st.length})</h3>
      ${st.map(x => `<div class="acct-row"><span><small>${esc(chatTime(x.sentAt))} · ${esc(nameOf(x.peer))}</small> ${esc(chatPreview(x))}</span>
        <span><button class="secondary small" data-chat-open="${esc(x.peer)}">פתיחה</button> <button class="secondary small" data-chat-star="${esc(x.mid)}" data-on="0">הסרה</button></span></div>`).join('') || '<p class="muted">אין הודעות מסומנות. סימון — בכפתור ☆ שליד ההודעה.</p>'}
      <div class="acct-actions"><button class="secondary" data-chat-panel="">סגירה</button></div></div>`;
  }
  if (!convs.length && filter === 'all') {
    return `<div class="card">${head}${panel}<p class="muted">אין אנשי קשר עדיין. אנשי הקשר נקבעים לפי הרישיונות: מנהל-העל, המערכת המנפיקה ומערכות הבת.</p></div>`;
  }
  const results = state.chatResults;
  const meta = m.meta || {};
  const byMid = new Map(thread.map(x => [x.mid, x]));
  const replyTo = state.chatReply ? byMid.get(state.chatReply) : null;
  const att = state.chatAtt;
  return `<div class="card chat">
    ${head}
    ${panel}
    ${Array.isArray(results) ? `<div class="chat-results"><h4>תוצאות חיפוש (${results.length})</h4>${results.map(r => `<div class="acct-row"><span><small>${esc(chatTime(r.sentAt))}</small> ${esc(chatPreview(r).slice(0, 140))}</span><button class="secondary small" data-chat-open="${esc(r.peer)}">פתיחה</button></div>`).join('') || '<p class="muted">לא נמצאו הודעות</p>'}</div>` : ''}
    <div class="chat-layout">
      <aside class="chat-list">${convs.map(c => `<button class="chat-contact${c.id === m.peer ? ' active' : ''}" data-chat-open="${esc(c.id)}">
        <span class="chat-contact-top"><b>${c.pinned ? '📌 ' : ''}${esc(c.name)}</b>${c.muted ? ' 🔕' : ''}${c.unread ? ` <span class="chat-badge">${Number(c.unread)}</span>` : c.markedUnread ? ' <span class="chat-badge">•</span>' : ''}</span>
        <small class="muted">${esc(CHAT_ROLES[c.role] || '')}${c.hasNote ? ' · 📝' : ''}</small>
        ${c.labels && c.labels.length ? `<span>${chatLabelChips(c.labels, labels)}</span>` : ''}
        ${c.last ? `<small>${c.last.dir === 'out' ? 'את/ה: ' : ''}${esc(c.last.text)}</small>` : ''}
      </button>`).join('') || `<p class="muted">${filter === 'archived' ? 'אין שיחות בארכיון' : 'אין שיחות בסינון הזה'}</p>`}</aside>
      <section class="chat-thread">
        ${peer ? `<div class="chat-thread-head">
            <h3>${esc(peer.name)} <small class="muted">${esc(CHAT_ROLES[peer.role] || '')} · 🔒 מוצפן מקצה לקצה</small></h3>
            <div class="acct-actions">
              <button class="chat-act" data-chat-meta="pinned" data-on="${meta.pinned ? '0' : '1'}" title="${meta.pinned ? 'ביטול נעיצה' : 'נעיצה בראש הרשימה'}">${meta.pinned ? '📍' : '📌'}</button>
              <button class="chat-act" data-chat-meta="muted" data-on="${meta.muted ? '0' : '1'}" title="${meta.muted ? 'ביטול השתקה' : 'השתקה'}">${meta.muted ? '🔔' : '🔕'}</button>
              <button class="chat-act" data-chat-meta="archived" data-on="${meta.archived ? '0' : '1'}" title="${meta.archived ? 'הוצאה מהארכיון' : 'העברה לארכיון'}">🗄</button>
              <button class="chat-act" data-chat-meta="markedUnread" data-on="1" title="סימון כלא נקראה">✉</button>
              <button class="chat-act" id="chatLabelsBtn" title="תוויות">🏷</button>
              <button class="chat-act" id="chatNoteBtn" title="הערה פנימית">📝</button>
            </div>
          </div>
          ${meta.labels && meta.labels.length ? `<div>${chatLabelChips(meta.labels, labels)}</div>` : ''}
          ${chatProfileBox(meta.profile)}
          ${meta.note ? `<div class="chat-note"><b>📝 הערה פנימית</b> <small class="muted">(לא נשלחת)</small><br>${esc(meta.note).replace(/\n/g, '<br>')}</div>` : ''}
          <div class="chat-messages" id="chatMessages">${thread.map(x => chatBubble(x, { byMid, peer, now: m.now || Date.now() })).join('') || '<p class="muted">אין הודעות עדיין</p>'}</div>
          <div class="chat-compose">
            ${replyTo ? `<div class="chat-quote chat-reply-bar"><span>↩ תגובה ל: <b>${esc(replyTo.dir === 'out' ? 'את/ה' : peer.name)}</b> ${esc(chatPreview(replyTo))}</span><button class="chat-act" id="chatReplyCancel" title="ביטול">✖</button></div>` : ''}
            ${att ? `<div class="chat-quote chat-reply-bar"><span>📎 ${esc(att.name)} <small>(${esc(chatKb(att.size))})</small></span><button class="chat-act" id="chatAttCancel" title="הסרת הקובץ">✖</button></div>` : ''}
            <input id="chatSubject" type="text" maxlength="120" placeholder="נושא (לא חובה)" value="${esc(state.chatDraftSubject || '')}">
            <div class="chat-quick" id="chatQuick" hidden></div>
            <textarea id="chatText" rows="3" maxlength="4000" placeholder="כתיבת הודעה… (Enter — שליחה, Shift+Enter — שורה חדשה, / — תשובה מהירה)">${esc(state.chatDraft || '')}</textarea>
            <div class="acct-actions">
              <input type="file" id="chatFile" hidden accept="${Object.keys(CHAT_TYPES).map(e => '.' + e).join(',')}">
              <button class="secondary" id="chatAttachBtn" title="צירוף קובץ (עד ${Math.floor(CHAT_MAX_FILE / 1024)}KB)">📎 צירוף קובץ</button>
              <button class="primary" id="chatSendBtn">שליחה</button>
            </div>
          </div>`
        : '<p class="muted">בחרו איש קשר מהרשימה</p>'}
      </section>
    </div>
  </div>`;
}

// חלון עם תיבת טקסט (עריכה / הערה פנימית). מחזיר את הטקסט או null בביטול
function chatTextDialog(title, value, okText, hint) {
  return openDialog((card, finish) => {
    card.style.maxWidth = '520px';
    const h = document.createElement('h2');
    h.textContent = title;
    const form = document.createElement('form');
    form.className = 'modal-form';
    if (hint) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = hint; form.appendChild(p); }
    const ta = document.createElement('textarea');
    ta.rows = 5;
    ta.maxLength = 4000;
    ta.value = value || '';
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = 'ביטול';
    const ok = document.createElement('button');
    ok.type = 'submit'; ok.className = 'primary'; ok.textContent = okText;
    actions.append(cancel, ok);
    form.append(ta, actions);
    card.append(h, form);
    cancel.addEventListener('click', () => finish(null));
    form.addEventListener('submit', (e) => { e.preventDefault(); finish(ta.value); });
    ta.focus();
  });
}
// חלון בחירה בין כמה פעולות. מחזיר את הערך שנבחר או null
function chatChoice(title, message, choices) {
  return openDialog((card, finish) => {
    const h = document.createElement('h2');
    h.textContent = title;
    const p = document.createElement('p');
    p.style.padding = '0 1.5rem';
    p.textContent = message;
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    for (const [value, text, cls] of choices) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = cls || 'secondary'; b.textContent = text;
      b.addEventListener('click', () => finish(value));
      actions.appendChild(b);
    }
    card.append(h, p, actions);
  });
}

function attachMessagesHandlers() {
  const d = state.data.messages || {};
  const as = () => state.chatAs || '';
  const api = window.systemAPI;
  const act = (fn) => async () => { try { await fn(); } catch (error) { showError(errMsg(error)); return; } await switchView('messages'); };
  const on = (sel, fn) => document.querySelectorAll(sel).forEach(b => b.addEventListener('click', act(() => fn(b))));
  const keepDraft = () => {
    const t = document.getElementById('chatText');
    const s = document.getElementById('chatSubject');
    if (t && typeof t.value === 'string') state.chatDraft = t.value;
    if (s && typeof s.value === 'string') state.chatDraftSubject = s.value;
  };

  on('[data-chat-open]', (b) => {
    if (state.chatPeer !== b.dataset.chatOpen) { state.chatDraft = ''; state.chatDraftSubject = ''; state.chatReply = null; state.chatAtt = null; }
    state.chatPeer = b.dataset.chatOpen; state.chatResults = null;
    if (state.chatPanel === 'starred') state.chatPanel = null;
  });
  on('[data-chat-panel]', (b) => {
    state.chatPanel = b.dataset.chatPanel || null;
    state.chatSettingsDraft = null;
  });
  const sel = document.getElementById('chatAs');
  if (sel) sel.addEventListener('change', act(() => { state.chatAs = sel.value; state.chatPeer = null; state.chatResults = null; state.chatPanel = null; state.chatSettingsDraft = null; }));
  const flt = document.getElementById('chatFilter');
  if (flt) flt.addEventListener('change', act(() => { state.chatFilter = flt.value; }));
  const refresh = document.getElementById('chatRefreshBtn');
  if (refresh) refresh.addEventListener('click', act(async () => {
    keepDraft();
    const r = await api.chatRefresh(as());
    (r.errors || []).forEach(e => showError(e));
  }));
  const search = document.getElementById('chatSearch');
  if (search) search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    act(async () => { state.chatQuery = search.value; state.chatResults = search.value.trim() ? await api.chatSearch(search.value, as()) : null; })();
  });

  // ---------- פעולות על הודעה ----------
  on('[data-chat-reply]', (b) => { keepDraft(); state.chatReply = b.dataset.chatReply; });
  on('[data-chat-star]', async (b) => { keepDraft(); await api.chatStar({ mid: b.dataset.chatStar, on: b.dataset.on === '1' }, as()); });
  on('[data-chat-save]', async (b) => { keepDraft(); const r = await api.chatSaveAttachment(b.dataset.chatSave, as()); if (r && r.saved) showToast('הקובץ נשמר'); });
  on('[data-chat-edit]', async (b) => {
    keepDraft();
    const x = (d.thread || []).find(t => t.mid === b.dataset.chatEdit);
    if (!x) return;
    const text = await chatTextDialog('עריכת הודעה', x.text, 'שמירה', 'ההודעה תתעדכן גם אצל הנמען, עם הסימון "נערכה".');
    if (text == null || text.trim() === x.text) return;
    await api.chatEdit({ mid: x.mid, text }, as());
  });
  on('[data-chat-del]', async (b) => {
    keepDraft();
    const all = b.dataset.chatDelAll === '1';
    const choices = [...(all ? [['all', '🗑 מחיקה אצל כולם', 'danger']] : []), ['me', 'מחיקה אצלי', all ? 'secondary' : 'danger'], [null, 'ביטול', 'secondary']];
    const c = await chatChoice('מחיקת הודעה', all ? 'למחוק את ההודעה רק מהמחשב הזה, או גם אצל הנמען?' : 'ההודעה תימחק מהמחשב הזה בלבד.', choices);
    if (c === 'all') await api.chatDeleteForAll(b.dataset.chatDel, as());
    else if (c === 'me') await api.chatDeleteForMe([b.dataset.chatDel], as());
  });
  on('[data-chat-fwd]', async (b) => {
    keepDraft();
    const others = (d.contacts || d.conversations || []).filter(c => c.id !== d.peer);
    if (!others.length) throw new Error('אין איש קשר נוסף להעביר אליו');
    const v = await licForm('העברת הודעה', [{ name: 'peerId', label: 'אל', type: 'select', options: others.map(c => [c.id, c.name]) }], '↪ העברה');
    if (!v) return;
    await api.chatForward({ mid: b.dataset.chatFwd, peerId: v.peerId }, as());
    showToast('ההודעה הועברה');
  });

  // ---------- פעולות על השיחה ----------
  on('[data-chat-meta]', async (b) => {
    keepDraft();
    await api.chatSetMeta({ peerId: d.peer, [b.dataset.chatMeta]: b.dataset.on === '1' }, as());
    if (b.dataset.chatMeta === 'archived' && b.dataset.on === '1') showToast('השיחה הועברה לארכיון');
  });
  const labelsBtn = document.getElementById('chatLabelsBtn');
  if (labelsBtn) labelsBtn.addEventListener('click', act(async () => {
    keepDraft();
    const labels = d.labels || [];
    if (!labels.length) throw new Error('אין תוויות. אפשר להוסיף ב"הגדרות העסק"');
    const v = await licForm('תוויות לשיחה', [{ name: 'labels', label: 'תוויות', type: 'checks', options: labels.map(l => [l.id, l.name]), value: (d.meta && d.meta.labels) || [] }], 'שמירה');
    if (v) await api.chatSetMeta({ peerId: d.peer, labels: v.labels }, as());
  }));
  const noteBtn = document.getElementById('chatNoteBtn');
  if (noteBtn) noteBtn.addEventListener('click', act(async () => {
    keepDraft();
    const note = await chatTextDialog('הערה פנימית', (d.meta && d.meta.note) || '', 'שמירה', 'ההערה נשמרת במחשב הזה בלבד ואינה נשלחת לאיש הקשר.');
    if (note != null) await api.chatSetMeta({ peerId: d.peer, note }, as());
  }));

  // ---------- כתיבה ושליחה ----------
  const text = document.getElementById('chatText');
  const quick = document.getElementById('chatQuick');
  const qrs = d.quickReplies || [];
  if (text && quick) {
    // תשובות מהירות: "/" בתחילת ההודעה מציג את הקיצורים המתאימים
    const showQuick = () => {
      const v = String(text.value || '');
      const mm = /^\/([\p{L}\p{N}_-]*)$/u.exec(v);
      const found = mm ? qrs.filter(q => q.shortcut.startsWith(mm[1])).slice(0, 8) : [];
      quick.hidden = !found.length;
      quick.innerHTML = found.map(q => `<button type="button" class="chat-quick-item" data-qr-use="${esc(q.shortcut)}"><b>/${esc(q.shortcut)}</b> ${esc(q.text.slice(0, 80))}</button>`).join('');
      if (quick.querySelectorAll) quick.querySelectorAll('[data-qr-use]').forEach(b => b.addEventListener('click', () => {
        const q = qrs.find(x => x.shortcut === b.dataset.qrUse);
        if (q) { text.value = q.text; quick.hidden = true; text.focus(); }
      }));
    };
    text.addEventListener('input', showQuick);
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        const first = quick.hidden ? null : qrs.find(x => '/' + x.shortcut === String(text.value).trim()) || null;
        if (first) { text.value = first.text; quick.hidden = true; return; }
        const send = document.getElementById('chatSendBtn');
        if (send) send.click();
      }
    });
  }
  const replyCancel = document.getElementById('chatReplyCancel');
  if (replyCancel) replyCancel.addEventListener('click', act(() => { keepDraft(); state.chatReply = null; }));
  const attCancel = document.getElementById('chatAttCancel');
  if (attCancel) attCancel.addEventListener('click', act(() => { keepDraft(); state.chatAtt = null; }));
  const file = document.getElementById('chatFile');
  const attachBtn = document.getElementById('chatAttachBtn');
  if (attachBtn && file) attachBtn.addEventListener('click', () => file.click());
  if (file) file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const ext = String(f.name).split('.').pop().toLowerCase();
    const type = CHAT_TYPES[ext];
    if (!type) { showError('סוג הקובץ אינו נתמך (תמונה, PDF, טקסט, CSV, Excel או Word)'); return; }
    if (f.size > CHAT_MAX_FILE) { showError('הקובץ גדול מדי — עד ' + Math.floor(CHAT_MAX_FILE / 1024) + 'KB'); return; }
    const reader = new FileReader();
    reader.onload = act(() => {
      keepDraft();
      state.chatAtt = { name: f.name, type, size: f.size, data: String(reader.result).replace(/^data:[^,]*,/, '') };
    });
    reader.onerror = () => showError('לא ניתן לקרוא את הקובץ');
    reader.readAsDataURL(f);
  });
  const send = document.getElementById('chatSendBtn');
  if (send) send.addEventListener('click', act(async () => {
    const body = document.getElementById('chatText').value;
    const subject = document.getElementById('chatSubject').value;
    if (!String(body).trim() && !state.chatAtt) throw new Error('ההודעה ריקה');
    send.disabled = true;
    try {
      await api.chatSend({ peerId: state.chatPeer, subject, text: body, replyTo: state.chatReply || undefined, att: state.chatAtt || undefined }, as());
      state.chatDraft = ''; state.chatDraftSubject = ''; state.chatReply = null; state.chatAtt = null;
    } catch (e) { keepDraft(); throw e; }
    finally { send.disabled = false; }
  }));

  // ---------- תפוצה ----------
  const bc = document.getElementById('chatBcSend');
  if (bc) bc.addEventListener('click', act(async () => {
    const listId = document.getElementById('chatBcList').value;
    const t = document.getElementById('chatBcText').value;
    if (!String(t).trim()) throw new Error('ההודעה ריקה');
    bc.disabled = true;
    try {
      const r = await api.chatBroadcast({ listId, subject: document.getElementById('chatBcSubject').value, text: t }, as());
      showToast(`נשלחה ל-${r.sent} נמענים`);
      (r.failed || []).forEach(f => showError(`לא נשלחה אל ${f.name}: ${f.error}`));
      state.chatPanel = null;
    } finally { bc.disabled = false; }
  }));

  // ---------- הגדרות העסק ----------
  on('[data-chat-set-add]', (b) => {
    const s = chatCollectSettings();
    if (!s) return;
    const k = b.dataset.chatSetAdd;
    if (k === 'quickReplies') s.quickReplies.push({ shortcut: '', text: '' });
    if (k === 'labels') s.labels.push({ id: '', name: 'תווית חדשה', color: CHAT_COLORS[s.labels.length % CHAT_COLORS.length] });
    if (k === 'lists') s.lists.push({ id: '', name: 'רשימה חדשה', members: [] });
    state.chatSettingsDraft = s;
  });
  on('[data-chat-set-del]', (b) => {
    const s = chatCollectSettings();
    if (!s) return;
    s[b.dataset.chatSetDel].splice(Number(b.dataset.i), 1);
    state.chatSettingsDraft = s;
  });
  const save = document.getElementById('chatSetSave');
  if (save) save.addEventListener('click', act(async () => {
    const s = chatCollectSettings();
    state.chatSettingsDraft = s; // אם השמירה נכשלה — מה שהוקלד נשאר
    await api.chatSaveSettings(s, as());
    state.chatSettingsDraft = null;
    showToast('ההגדרות נשמרו');
  }));
  const publish = document.getElementById('chatSetPublish');
  if (publish) publish.addEventListener('click', act(async () => {
    const s = chatCollectSettings();
    state.chatSettingsDraft = s;
    await api.chatSaveSettings(s, as()); // שולחים את מה שעל המסך
    state.chatSettingsDraft = null;
    const r = await api.chatPublishProfile(as());
    showToast(`הפרופיל נשלח ל-${r.sent} אנשי קשר`);
  }));

  const box = document.getElementById('chatMessages');
  if (box && typeof box.scrollHeight === 'number') box.scrollTop = box.scrollHeight;
}
