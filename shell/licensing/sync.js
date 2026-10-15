// סנכרון רישוי מרחוק דרך שרת הממסר — החלק שקובע מה נשלח למי ומה עושים עם מה שמגיע.
// שתי תיבות: של המערכת (לפי מזהה המפתח שלה), ושל מנהל-העל (לפי מזהה מפתח השורש) כשמצב מנהל-העל פתוח.
// מה שמגיע נקלט רק אחרי אימות החתימות המקומי (install / importNotices / issueChild) — השרת אינו מהימן.
const L = require('./license');
const { createRemote, mailboxOf } = require('./remote');
const M = require('./messages');
const OF = require('./offer');
const SU = require('./signup');
const PK = require('./prekeys');
const { PKG_REQUEST, PKG_APPROVAL_REQUEST } = require('./store');

// isRestTime(): בשבת וביום טוב (מצב שבת) — אין תשובות אוטומטיות
function createLicenseSync({ store, owner, rootKeys, fetchImpl, clock, chat, ownerChat, updates, prekeys, ownerPrekeys, isRestTime = () => false }) {
  const now = () => (clock ? clock() : Date.now());
  const remote = () => {
    const r = store.getRemoteSettings();
    if (!r.url) throw new Error('לא הוגדר שרת רישוי');
    return createRemote({ url: r.url, fetchImpl, clock });
  };
  // מנהל-העל: התיבה לפי מפתח השורש שמוגדר בתוכנה (הראשון), או המפתח של מנהל-העל במחשב הזה
  const ownerBox = () => {
    if (rootKeys && rootKeys.length) return mailboxOf(rootKeys[0]);
    if (owner && owner.isInitialized()) return mailboxOf(owner.pubkey());
    throw new Error('לא ידוע למי לשלוח: מפתח מנהל-העל אינו מוגדר בתוכנה');
  };

  // ---------- שליחה ממערכת ----------
  async function sendLicenseRequest(name) {
    const req = store.request(name);
    const key = store.syncKey(false);
    await remote().send(key, [{ to: ownerBox(), kind: 'license-request', body: JSON.stringify(req) }]);
    return { sent: true, keyId: req.keyId };
  }

  async function sendApprovalRequest(input) {
    const r = store.requestChildApproval(input);
    await remote().send(store.syncKey(false), [{ to: ownerBox(), kind: 'approval-request', body: r.package }]);
    return { sent: true, childId: r.childId };
  }

  // מערכת בת חדשה מבקשת רישיון מההורה (לא ממנהל-העל): ההורה ישלח בשמה בקשת אישור
  async function sendRequestToParent(name, parentId) {
    if (!/^[A-Za-z0-9_-]{22}$/.test(String(parentId || ''))) throw new Error('קוד המערכת המנפיקה אינו תקין');
    const req = store.request(name);
    await remote().send(store.syncKey(false), [{ to: parentId, kind: 'license-request', body: JSON.stringify(req) }]);
    return { sent: true, keyId: req.keyId };
  }

  // ---------- קבלה במערכת ----------
  // מטפל בכל מה שהגיע לתיבה של המערכת. בקשות רישיון ממערכות בת חדשות נשמרות לטיפול בכפתור
  async function receive() {
    const key = store.syncKey(false);
    if (!key) return { handled: 0, pending: [], errors: [] };
    const rm = remote();
    try { await publishPrekey(key, prekeys); } catch { /* ינוסה שוב בסנכרון הבא */ }
    const msgs = await rm.fetch(key);
    const done = [];
    const errors = [];
    const forward = [];
    let pending = (store.getRemoteSettings().pendingChildRequests || []);
    const autos = [];
    for (const m of msgs) {
      try {
        if (m.kind === 'license') store.install(m.body);
        else if (m.kind === 'notices') store.importNotices(m.body);
        else if (m.kind === 'approval') {
          // אישור ממנהל-העל: הנפקה אוטומטית, והרישיון נשלח ישר למערכת הבת
          const r = store.issueChild({ approval: m.body });
          forward.push({ to: r.child.id, kind: 'license', body: r.package });
        } else if (m.kind === 'rejection') {
          const j = JSON.parse(m.body);
          errors.push('הבקשה למערכת הבת "' + String(j.name || '') + '" נדחתה: ' + String(j.reason || ''));
        } else if (m.kind === 'update') {
          // תעודת גרסה — נבדקת בחתימה מול מפתח השורש; מה שאינו תקין נדחה
          if (updates) updates.offer(m.body);
        } else if (m.kind === 'message') {
          if (chat) receiveMessage(store.syncKey(false), m.body, myContacts(), chat, prekeys, autos);
        } else if (m.kind === 'license-request') {
          const req = JSON.parse(m.body);
          if (!req || req.type !== PKG_REQUEST) throw new Error('בקשה לא תקינה');
          if (!pending.some(p => p.keyId === req.keyId)) pending = [...pending, { keyId: req.keyId, name: req.name, at: m.at, body: m.body }];
        }
        done.push(m.id);
      } catch (e) {
        errors.push(e.message);
        done.push(m.id); // הודעה פגומה לא תחסום את התיבה לנצח
      }
    }
    store.setRemoteSettings({ pendingChildRequests: pending.slice(-100), lastSync: clock ? clock() : Date.now() });
    // העברת עדכוני סטטוס למערכות הבת — כך השבתה מלמעלה מגיעה עד הסוף
    const info = store.syncInfo();
    for (const c of info.children) {
      const pkg = store.noticesForChild(c.id);
      if (pkg) forward.push({ to: c.id, kind: 'notices', body: pkg });
    }
    for (let i = 0; i < forward.length; i += 50) await rm.send(key, forward.slice(i, i + 50));
    await rm.ack(key, done);
    if (chat) await sendAutoReplies(key, myContacts(), chat, prekeys, autos);
    store.invalidate();
    return { handled: done.length, pending: pending.map(({ keyId, name, at }) => ({ keyId, name, at })), errors };
  }

  // הורה: בקשת רישיון שהגיעה ממערכת בת חדשה ← בקשת אישור למנהל-העל, בלחיצה
  async function forwardChildRequest(keyId, terms) {
    const pending = store.getRemoteSettings().pendingChildRequests || [];
    const p = pending.find(x => x.keyId === keyId);
    if (!p) throw new Error('הבקשה לא נמצאה');
    const r = await sendApprovalRequest({ request: p.body, ...terms });
    store.setRemoteSettings({ pendingChildRequests: pending.filter(x => x.keyId !== keyId) });
    return r;
  }
  function dismissChildRequest(keyId) {
    const pending = store.getRemoteSettings().pendingChildRequests || [];
    store.setRemoteSettings({ pendingChildRequests: pending.filter(x => x.keyId !== keyId) });
    return true;
  }

  // הורה: עדכון סטטוס למערכת בת מיד אחרי השבתה/החזרה
  async function pushToChild(childId, pkg) {
    await remote().send(store.syncKey(false), [{ to: childId, kind: 'notices', body: pkg }]);
  }

  // ---------- מנהל-העל ----------
  async function ownerReceive() {
    const signer = owner.rootSigner();
    const rm = remote();
    try { await publishPrekey(signer, ownerPrekeys); } catch { /* ינוסה שוב */ }
    const msgs = await rm.fetch(signer);
    let added = 0;
    let messages = 0;
    let signups = 0;
    const autos = [];
    for (const m of msgs) {
      if (m.kind === 'license-request' || m.kind === 'approval-request') { if (owner.addToInbox(m)) added++; }
      else if (m.kind === 'signup' && m.from === 'relay') {
        try { if (owner.addSignup(m.body).added) signups++; } catch { /* הרשמה לא תקינה — נדחית */ }
      }
      else if (m.kind === 'message' && ownerChat) {
        try { if (receiveMessage(signer, m.body, owner.contacts(), ownerChat, ownerPrekeys, autos)) messages++; } catch { /* הודעה פגומה — מדולגת */ }
      }
    }
    await rm.ack(signer, msgs.map(m => m.id));
    if (ownerChat) await sendAutoReplies(signer, owner.contacts(), ownerChat, ownerPrekeys, autos);
    return { added, messages, signups, inbox: owner.inbox().length };
  }

  // שליחת תוצאה לשולח: רישיון ללקוח, או אישור/דחייה ללקוח שביקש מערכת בת
  async function ownerReply(to, kind, body) {
    await remote().send(owner.rootSigner(), [{ to, kind, body }]);
  }

  // עדכוני סטטוס לכל הלקוחות ומערכות הבת (אחרי השבתה / החזרה / נעילה גלובלית)
  async function ownerPushNotices() {
    const rm = remote();
    const signer = owner.rootSigner();
    const reg = owner.list();
    const items = [];
    for (const t of reg.tenants) {
      items.push({ to: t.id, kind: 'notices', body: owner.noticesPackage(t.id) });
      // כולל מערכות בת שבוטלו — כדי שהודעת הסיום תגיע אליהן
      for (const c of t.children) items.push({ to: c.id, kind: 'notices', body: owner.noticesPackage(c.id) });
    }
    for (let i = 0; i < items.length; i += 50) await rm.send(signer, items.slice(i, i + 50));
    return { sent: items.length };
  }

  // ---------- הרשמה ותשלום ----------
  // מנהל-העל: פרסום ההצעה (תכניות + תקנון) בשרת
  async function ownerPublishOffer() {
    const o = owner.offer();
    if (!o) throw new Error('עדיין לא הוגדרו תכניות ותקנון');
    await remote().setOffer(owner.rootSigner(), o.text);
    return { ok: true };
  }
  // מערכת חדשה: ההצעה מהשרת — נבדקת בחתימה מול מפתח השורש שבתוכנה
  async function getOffer() {
    const text = await remote().getOffer(store.syncKey(true));
    return { text, offer: OF.verifyOffer(text, rootKeys) };
  }
  // הרשמה: חתימה על התקנון ויצירת תשלום. מחזיר קישור לדף התשלום המאובטח של הספק
  async function signup({ offerText, planId, customer, signatureImage, scrolledToEnd, accepted }) {
    const key = store.syncKey(true);
    const su = SU.createSignup({ deviceJwk: key, offerText, rootKeys, planId, customer, signatureImage, scrolledToEnd, accepted, at: now() });
    const r = await remote().checkout(key, su.text);
    store.setRemoteSettings({ signup: { id: su.id, paymentId: r.paymentId || null, status: r.free ? 'submitted' : r.status, url: r.url || null,
      planName: su.body.planName, priceAgorot: su.body.priceAgorot, org: su.body.customer.org, at: now() } });
    return { id: su.id, free: !!r.free, status: r.free ? 'submitted' : r.status, url: r.url || null };
  }
  async function signupStatus() {
    const cur = store.getRemoteSettings().signup;
    if (!cur) return null;
    if (cur.paymentId && cur.status === 'pending') {
      const r = await remote().paymentStatus(store.syncKey(false), cur.paymentId);
      const next = { ...cur, status: r.status === 'paid' ? 'submitted' : r.status, url: r.url || cur.url };
      store.setRemoteSettings({ signup: next });
      return next;
    }
    return cur;
  }

  // מנהל-העל: שליחת תעודת גרסה לכל המערכות (לקוחות ומערכות בת)
  async function ownerPublishUpdate(releaseText) {
    const rm = remote();
    const signer = owner.rootSigner();
    const items = owner.recipients().map(to => ({ to, kind: 'update', body: releaseText }));
    for (let i = 0; i < items.length; i += 50) await rm.send(signer, items.slice(i, i + 50));
    return { sent: items.length };
  }

  // ---------- הודעות ----------
  // אנשי הקשר של המערכת: ההורה, הילדים, ומנהל-העל — מתוך הרישיונות החתומים בלבד
  function myContacts() {
    const info = store.syncInfo();
    if (!info.nodeId) return [];
    return M.contactsOf({ chain: info.chain, children: info.children, rootKeys: rootKeys.slice(0, 1) });
  }
  // פענוח ושמירה. מחזיר true אם נוספה הודעה חדשה; תשובות אוטומטיות נאספות ל-autos ונשלחות אחרי הקבלה
  function receiveMessage(myKey, body, contacts, box, pks, autos) {
    const msg = M.open(myKey, body, contacts, { prekeyPriv: pks ? (id) => pks.privOf(id) : null });
    if (msg.kind === 'receipt') { box.setStatus(msg.mids, 'read'); return false; }
    if (msg.kind === 'edit') { box.applyRemoteEdit(msg.from, msg.target, msg.text, msg.sentAt); return false; }
    if (msg.kind === 'delete') { box.applyRemoteDelete(msg.from, msg.target); return false; }
    if (msg.kind === 'profile') { box.setPeerProfile(msg.from, msg.profile); return false; }
    const added = box.addIncoming({ mid: msg.mid, peer: msg.from, subject: msg.subject, text: msg.text, sentAt: msg.sentAt,
      replyTo: msg.replyTo, forwarded: msg.forwarded, auto: msg.auto, bc: msg.bc, att: msg.att });
    if (added && autos && !isRestTime()) for (const r of box.autoReplies(msg.from, msg, now())) autos.push({ peer: msg.from, ...r });
    return added;
  }
  async function sendAutoReplies(signer, contacts, box, pks, autos) {
    for (const a of autos) {
      try { await sendSealed(signer, contacts, box, a.peer, { text: a.text, auto: a.auto }, pks); } catch { /* לא קריטי */ }
    }
  }
  // פרסום המפתח הזמני שלי (כשהתחלף או עוד לא פורסם)
  async function publishPrekey(signer, pks) {
    if (!pks || !pks.needsPublish()) return false;
    const b = pks.bundle(signer);
    await remote().setPrekey(signer, b);
    pks.markPublished(b.id);
    return true;
  }
  // המפתח הזמני של איש קשר — מאומת בחתימה מול המפתח הקבוע שלו (מהרישיונות), לא מה שהשרת טוען
  async function peerPrekey(signer, peer) {
    try { return PK.verifyBundle(await remote().getPrekey(signer, peer.id), peer.publicKey, now()); } catch { return null; }
  }
  // שליחה מוצפנת. הודעת טקסט נשמרת בתיבה כיוצאת; עריכה/מחיקה/פרופיל — רק נשלחות
  async function sendSealed(signer, contacts, box, peerId, msg, pks) {
    const peer = contacts.find(c => c.id === peerId);
    if (!peer) throw new Error('איש הקשר אינו מוכר');
    const sentAt = now();
    try { await publishPrekey(signer, pks); } catch { /* לא חוסם שליחה */ }
    const prekey = await peerPrekey(signer, peer);
    const kind = msg.kind || 'text';
    const { mid, envelope } = M.seal(signer, peer.publicKey, { ...msg, kind, sentAt }, { prekey });
    await remote().send(signer, [{ to: peer.id, kind: 'message', body: envelope }]);
    if (kind === 'text') {
      box.addOutgoing({ mid, peer: peer.id, subject: M.cleanText(msg.subject, M.MAX_SUBJECT), text: M.cleanText(msg.text, M.MAX_TEXT), sentAt,
        replyTo: msg.replyTo, forwarded: msg.forwarded, auto: msg.auto, bc: msg.bc, att: msg.att ? M.cleanAttachment(msg.att) : null });
      box.setStatus([mid], 'delivered');
    }
    return { mid };
  }
  async function sendReceipt(signer, contacts, peerId, mids) {
    const peer = contacts.find(c => c.id === peerId);
    if (!peer || !mids.length) return;
    const { envelope } = M.seal(signer, peer.publicKey, { kind: 'receipt', mids, sentAt: now() }, { prekey: await peerPrekey(signer, peer) });
    await remote().send(signer, [{ to: peer.id, kind: 'message', body: envelope }]);
  }
  // פעולות הצ'אט — לתיבה של המערכת (asOwner=false) או של מנהל-העל
  function chatOps(asOwner) {
    const signer = () => (asOwner ? owner.rootSigner() : store.syncKey(false));
    const contacts = () => (asOwner ? owner.contacts() : myContacts());
    const box = asOwner ? ownerChat : chat;
    const pks = asOwner ? ownerPrekeys : prekeys;
    // שליחה ידנית — אף פעם לא מסומנת כאוטומטית
    const send = (peerId, msg) => sendSealed(signer(), contacts(), box, peerId, { ...msg, kind: 'text', auto: undefined }, pks);
    return {
      send,
      async markRead(peerId) {
        const ids = box.markRead(peerId);
        try { await sendReceipt(signer(), contacts(), peerId, ids); } catch { /* אישור קריאה אינו קריטי */ }
        return ids.length;
      },
      // עריכה: נבדקת מקומית (חלון זמן), נשלחת, ורק אז נשמרת
      async edit(mid, text) {
        const m = box.get(mid);
        if (!box.canEdit(m, now())) throw new Error('אפשר לערוך הודעה ששלחתם בתוך 15 דקות בלבד');
        if (!m.text && m.att) throw new Error('אי אפשר לערוך קובץ מצורף');
        await sendSealed(signer(), contacts(), box, m.peer, { kind: 'edit', target: mid, text }, pks);
        return box.editOwn(mid, text, now());
      },
      async deleteForAll(mid) {
        const m = box.get(mid);
        if (!box.canDeleteForAll(m, now())) throw new Error('אפשר למחוק אצל כולם הודעה ששלחתם ביומיים האחרונים בלבד');
        await sendSealed(signer(), contacts(), box, m.peer, { kind: 'delete', target: mid }, pks);
        return box.deleteOwnForAll(mid, now());
      },
      // העברה לאיש קשר אחר — הטקסט והקובץ, עם סימון "הועברה"
      forward(mid, peerId) {
        const m = box.get(mid);
        if (!m || m.deleted) throw new Error('ההודעה לא נמצאה');
        let att = null;
        if (m.att) {
          if (!m.att.data) throw new Error('הקובץ אינו זמין עוד במחשב הזה');
          att = { name: m.att.name, type: m.att.type, data: m.att.data };
        }
        return send(peerId, { subject: m.subject, text: m.text, att, forwarded: true });
      },
      // רשימת תפוצה: כל נמען מקבל הודעה נפרדת (לא קבוצה — הנמענים לא רואים זה את זה)
      async broadcast(listId, msg) {
        const list = box.settings().lists.find(l => l.id === listId);
        if (!list) throw new Error('רשימת התפוצה לא נמצאה');
        const known = new Map(contacts().map(c => [c.id, c]));
        const members = list.members.filter(id => known.has(id));
        if (!members.length) throw new Error('אין ברשימה אנשי קשר פעילים');
        const failed = [];
        let sent = 0;
        for (const id of members) {
          try { await send(id, { ...msg, replyTo: undefined, bc: true }); sent++; }
          catch (e) { failed.push({ name: known.get(id).name, error: e.message }); }
        }
        return { sent, failed, skipped: list.members.length - members.length };
      },
      // הפרופיל העסקי — נשלח לכל אנשי הקשר (מוצג אצלם בראש השיחה)
      async publishProfile() {
        const profile = box.settings().profile;
        let sent = 0;
        for (const c of contacts()) {
          try { await sendSealed(signer(), contacts(), box, c.id, { kind: 'profile', profile }, pks); sent++; } catch { /* ינוסה בפעם הבאה */ }
        }
        return { sent };
      },
      receive: () => (asOwner ? ownerReceive() : receive()),
    };
  }
  const chatSend = (peerId, msg) => chatOps(false).send(peerId, msg);
  const chatMarkRead = (peerId) => chatOps(false).markRead(peerId);
  const ownerChatSend = (peerId, msg) => chatOps(true).send(peerId, msg);
  const ownerChatMarkRead = (peerId) => chatOps(true).markRead(peerId);

  return { myContacts, chatOps, chatSend, chatMarkRead, ownerChatSend, ownerChatMarkRead, sendLicenseRequest, sendApprovalRequest, sendRequestToParent, receive, forwardChildRequest, dismissChildRequest, pushToChild,
    ownerReceive, ownerReply, ownerPushNotices, ownerPublishUpdate, ownerPublishOffer, getOffer, signup, signupStatus, ownerBox };
}

module.exports = { createLicenseSync, PKG_APPROVAL_REQUEST };
