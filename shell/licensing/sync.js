// סנכרון רישוי מרחוק דרך שרת הממסר — החלק שקובע מה נשלח למי ומה עושים עם מה שמגיע.
// שתי תיבות: של המערכת (לפי מזהה המפתח שלה), ושל מנהל-העל (לפי מזהה מפתח השורש) כשמצב מנהל-העל פתוח.
// מה שמגיע נקלט רק אחרי אימות החתימות המקומי (install / importNotices / issueChild) — השרת אינו מהימן.
const L = require('./license');
const { createRemote, mailboxOf } = require('./remote');
const M = require('./messages');
const OF = require('./offer');
const SU = require('./signup');
const { PKG_REQUEST, PKG_APPROVAL_REQUEST } = require('./store');

function createLicenseSync({ store, owner, rootKeys, fetchImpl, clock, chat, ownerChat, updates }) {
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
    const msgs = await rm.fetch(key);
    const done = [];
    const errors = [];
    const forward = [];
    let pending = (store.getRemoteSettings().pendingChildRequests || []);
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
          if (chat) receiveMessage(store.syncKey(false), m.body, myContacts(), chat);
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
    const msgs = await rm.fetch(signer);
    let added = 0;
    let messages = 0;
    let signups = 0;
    for (const m of msgs) {
      if (m.kind === 'license-request' || m.kind === 'approval-request') { if (owner.addToInbox(m)) added++; }
      else if (m.kind === 'signup' && m.from === 'relay') {
        try { if (owner.addSignup(m.body).added) signups++; } catch { /* הרשמה לא תקינה — נדחית */ }
      }
      else if (m.kind === 'message' && ownerChat) {
        try { if (receiveMessage(signer, m.body, owner.contacts(), ownerChat)) messages++; } catch { /* הודעה פגומה — מדולגת */ }
      }
    }
    await rm.ack(signer, msgs.map(m => m.id));
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
  // פענוח ושמירה; אישור קריאה מעדכן את ההודעות היוצאות. מחזיר true אם נוספה הודעה חדשה
  function receiveMessage(myKey, body, contacts, box) {
    const msg = M.open(myKey, body, contacts);
    if (msg.kind === 'receipt') { box.setStatus(msg.mids, 'read'); return false; }
    return box.addIncoming({ mid: msg.mid, peer: msg.from, subject: msg.subject, text: msg.text, sentAt: msg.sentAt });
  }
  async function sendSealed(signer, contacts, box, peerId, { subject, text }) {
    const peer = contacts.find(c => c.id === peerId);
    if (!peer) throw new Error('איש הקשר אינו מוכר');
    const sentAt = now();
    const { mid, envelope } = M.seal(signer, peer.publicKey, { subject, text, sentAt });
    await remote().send(signer, [{ to: peer.id, kind: 'message', body: envelope }]);
    box.addOutgoing({ mid, peer: peer.id, subject, text, sentAt });
    box.setStatus([mid], 'delivered');
    return { mid };
  }
  async function sendReceipt(signer, contacts, peerId, mids) {
    const peer = contacts.find(c => c.id === peerId);
    if (!peer || !mids.length) return;
    const { envelope } = M.seal(signer, peer.publicKey, { kind: 'receipt', mids, sentAt: now() });
    await remote().send(signer, [{ to: peer.id, kind: 'message', body: envelope }]);
  }
  const chatSend = (peerId, msg) => sendSealed(store.syncKey(false), myContacts(), chat, peerId, msg);
  async function chatMarkRead(peerId) {
    const ids = chat.markRead(peerId);
    try { await sendReceipt(store.syncKey(false), myContacts(), peerId, ids); } catch { /* אישור קריאה אינו קריטי */ }
    return ids.length;
  }
  const ownerChatSend = (peerId, msg) => sendSealed(owner.rootSigner(), owner.contacts(), ownerChat, peerId, msg);
  async function ownerChatMarkRead(peerId) {
    const ids = ownerChat.markRead(peerId);
    try { await sendReceipt(owner.rootSigner(), owner.contacts(), peerId, ids); } catch { /* לא קריטי */ }
    return ids.length;
  }

  return { myContacts, chatSend, chatMarkRead, ownerChatSend, ownerChatMarkRead, sendLicenseRequest, sendApprovalRequest, sendRequestToParent, receive, forwardChildRequest, dismissChildRequest, pushToChild,
    ownerReceive, ownerReply, ownerPushNotices, ownerPublishUpdate, ownerPublishOffer, getOffer, signup, signupStatus, ownerBox };
}

module.exports = { createLicenseSync, PKG_APPROVAL_REQUEST };
