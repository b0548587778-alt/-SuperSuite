// שירות הסנכרון בתהליך הראשי: מחבר את הזהות, החיבור והגילוי לתוכנה (docs/SYNC-DESIGN.md, שלב 2½).
// ללא תלות ב-Electron — main.js מזריק safeStorage, נתיבים והאם עכשיו שבת; כך הכול נבדק בבדיקות.
// - כבוי כברירת מחדל: המכשיר לא מאזין לרשת עד שמנהל מפעיל.
// - במצב שבת אין פעולות אוטומטיות: לא מאזינים, לא משדרים ולא מתחברים (כמו הגיבוי האוטומטי).
// - רשימת העמיתים ומצב השידור החוזר נשמרים מוצפנים ב-DPAPI, כמו הזהות.
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const Identity = require('./identity');
const Transport = require('./transport');
const Discovery = require('./discovery');

const DEFAULT_PORT = 47700;
const APPROVAL_TTL_MS = 5 * 60 * 1000;
const PING_TIMEOUT_MS = 8000;

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// כתובות IPv4 של המחשב ברשת המקומית (להצגה ולקוד הצימוד)
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

// "host:port" או { host, port } ← { host, port }; קלט לא תקין — null
function parseEndpoint(input, defaultPort = DEFAULT_PORT) {
  if (input && typeof input === 'object') input = `${input.host}:${input.port}`;
  const s = String(input == null ? '' : input).trim();
  const m = /^(\[[0-9a-fA-F:.%]+\]|[A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(s);
  if (!m) return null;
  const port = m[2] ? Number(m[2]) : defaultPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || m[1].length > 253) return null;
  return { host: m[1].replace(/^\[|\]$/g, ''), port };
}

function createSyncService({ dir, safeStorage, isPaused = () => false, now = Date.now, discovery = true, discoveryPort, limits }) {
  const files = { identity: `${dir}/sync-identity.bin`, state: `${dir}/sync-state.bin` };
  const svc = new EventEmitter();
  let identity = null;
  let data = { enabled: false, port: DEFAULT_PORT, peers: [], endpoints: {}, transport: null };
  let node = null;
  let disc = null;
  let listening = null; // { port } או null
  let lastError = null;
  let invite = null; // ההזמנה הפתוחה — בזיכרון בלבד (מכילה סוד חד-פעמי, ואחרי הפעלה מחדש אינה תקפה)
  const approvals = new Map(); // reqId → { peer, code, direction, exp, approve, reject }
  const lastSeen = new Map(); // peerId → זמן
  const pings = new Map(); // nonce → { peerId, resolve, reject }
  let pauseTimer = null;
  let pausedNow = false;

  const changed = () => svc.emit('changed');

  // ── אחסון מוצפן ──
  function loadState() {
    if (!fs.existsSync(files.state)) return;
    try { data = { ...data, ...JSON.parse(safeStorage.decryptString(fs.readFileSync(files.state))) }; }
    catch { throw fail('state-unreadable', 'נתוני הסנכרון אינם קריאים בחשבון זה'); }
  }
  function saveState() {
    fs.writeFileSync(files.state, safeStorage.encryptString(JSON.stringify(data)), { mode: 0o600 });
  }

  function ensureIdentity(create) {
    if (!identity) identity = Identity.loadIdentity({ file: files.identity, safeStorage, create, name: os.hostname() });
    return identity;
  }

  // ── הפעלה / עצירה של הרשת ──
  async function startNetwork() {
    if (node) return;
    ensureIdentity(true);
    node = Transport.createPeerNode({
      identity, limits,
      getPeers: () => data.peers,
      savePeers: (list) => { data.peers = list; saveState(); changed(); },
      state: data.transport,
      onState: (s) => { data.transport = s; saveState(); },
      now,
    });
    node.on('connected', (id) => { lastSeen.set(id, now()); changed(); });
    node.on('disconnected', (id) => {
      // חיבור שנסגר — בדיקות חיבור שממתינות לו נכשלות מיד, בלי לחכות לזמן הקצוב
      for (const [nonce, p] of pings) if (p.peerId === id) { pings.delete(nonce); p.reject(fail('closed', 'המכשיר השני סגר את החיבור (ייתכן שהמכשיר הזה בוטל אצלו)')); }
      changed();
    });
    node.on('message', (id, body) => onMessage(id, body));
    node.on('pair-request', (req) => addApproval(req, 'incoming'));
    try {
      listening = await node.listen({ host: '0.0.0.0', port: data.port });
      lastError = null;
    } catch (err) {
      const n = node;
      node = null; listening = null;
      await n.close();
      lastError = err.code === 'EADDRINUSE' ? `הפורט ${data.port} תפוס בתוכנה אחרת — בחרו פורט אחר` : 'לא ניתן להאזין לרשת: ' + (err.code || err.message);
      changed();
      return;
    }
    if (discovery) {
      disc = Discovery.startDiscovery({
        identity, getPeers: () => data.peers, listenPort: listening.port, port: discoveryPort, now,
        onFound: ({ peerId, host, port }) => {
          lastSeen.set(peerId, now());
          data.endpoints[peerId] = { host, port, via: 'lan' };
          if (node && !node.connected().includes(peerId)) connectPeer(peerId).catch(() => {});
          changed();
        },
      });
    }
    changed();
  }
  async function stopNetwork() {
    const n = node, d = disc;
    node = null; disc = null; listening = null;
    if (d) await d.stop();
    if (n) await n.close();
    changed();
  }
  async function applyRunState() {
    pausedNow = !!isPaused();
    if (data.enabled && !pausedNow) await startNetwork();
    else await stopNetwork();
  }

  // ── הודעות: כרגע בדיקת חיבור בלבד (ping/pong). סנכרון וצ'אט — בשלבים הבאים ──
  function onMessage(peerId, body) {
    lastSeen.set(peerId, now());
    if (!body || typeof body !== 'object') return;
    if (body.type === 'ping' && typeof body.nonce === 'string') {
      try { node.send(peerId, { type: 'pong', nonce: body.nonce }); } catch {}
    } else if (body.type === 'pong' && pings.has(body.nonce) && pings.get(body.nonce).peerId === peerId) {
      pings.get(body.nonce).resolve();
      pings.delete(body.nonce);
    }
    svc.emit('message', peerId, body);
  }

  // ── אישורי צימוד: נשמר רק אחרי שהמשתמש אישר שהקודים זהים ──
  function addApproval(req, direction) {
    const reqId = crypto.randomBytes(8).toString('hex');
    approvals.set(reqId, { ...req, direction, exp: now() + APPROVAL_TTL_MS });
    changed();
    return reqId;
  }
  function takeApproval(reqId) {
    const a = approvals.get(reqId);
    approvals.delete(reqId);
    if (!a || now() > a.exp) throw fail('approval-expired', 'הבקשה פגה — התחילו את הצימוד מחדש');
    return a;
  }

  async function connectPeer(peerId, endpoint) {
    if (!node) throw fail('disabled', 'הסנכרון כבוי');
    const ep = endpoint || data.endpoints[peerId];
    if (!ep) throw fail('no-endpoint', 'הכתובת של המכשיר לא ידועה — הזינו כתובת');
    await node.connect(peerId, { host: ep.host, port: ep.port });
    lastSeen.set(peerId, now());
    changed();
  }

  // ── API למעטפת ──
  svc.init = async () => {
    if (!safeStorage.isEncryptionAvailable()) { lastError = 'הצפנת המערכת (DPAPI) אינה זמינה — הסנכרון אינו אפשרי בחשבון זה'; return; }
    try {
      loadState();
      if (data.enabled) ensureIdentity(false);
      await applyRunState();
    } catch (err) { lastError = err.message; }
    // בדיקה פעם בדקה: כניסת שבת/יו"ט עוצרת את הרשת, וצאתם מחזירה אותה
    pauseTimer = setInterval(() => { if (!!isPaused() !== pausedNow) applyRunState().catch(() => {}); }, 60000);
    if (pauseTimer.unref) pauseTimer.unref();
  };

  svc.status = () => {
    const connected = node ? node.connected() : [];
    for (const [id, a] of approvals) if (now() > a.exp) approvals.delete(id);
    return {
      available: safeStorage.isEncryptionAvailable(),
      enabled: !!data.enabled,
      paused: pausedNow && !!data.enabled,
      listening: listening ? listening.port : null,
      port: data.port,
      addresses: lanAddresses(),
      device: identity ? { id: identity.id, name: identity.name } : null,
      error: lastError,
      pairing: invite && invite.exp > now() && node ? { code: invite.code, expiresAt: invite.exp } : null,
      approvals: [...approvals].map(([reqId, a]) => ({ reqId, name: a.peer.name, deviceId: a.peer.id, code: a.code, direction: a.direction })),
      peers: data.peers.map(p => ({
        id: p.id, name: p.name, pairedAt: p.pairedAt, revoked: !!p.revoked, revokedAt: p.revokedAt || null,
        connected: connected.includes(p.id), lastSeen: lastSeen.get(p.id) || null,
        endpoint: data.endpoints[p.id] ? `${data.endpoints[p.id].host}:${data.endpoints[p.id].port}` : null,
      })),
    };
  };

  svc.setEnabled = async (on) => {
    if (!safeStorage.isEncryptionAvailable()) throw fail('no-encryption', 'הצפנת המערכת (DPAPI) אינה זמינה — הסנכרון אינו אפשרי');
    data.enabled = !!on;
    if (on) ensureIdentity(true);
    if (!on) { invite = null; approvals.clear(); }
    saveState();
    await applyRunState();
    return svc.status();
  };

  svc.rename = (name) => {
    ensureIdentity(true);
    const clean = String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
    if (!clean) throw fail('bad-name', 'יש להזין שם למכשיר');
    identity.name = clean;
    fs.writeFileSync(files.identity, safeStorage.encryptString(JSON.stringify(identity)), { mode: 0o600 });
    changed();
    return svc.status();
  };

  svc.setPort = async (port) => {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw fail('bad-port', 'פורט חייב להיות מספר בין 1024 ל-65535');
    data.port = port;
    saveState();
    if (node) { await stopNetwork(); await applyRunState(); }
    return svc.status();
  };

  // host: הכתובת שהמכשיר השני יתחבר אליה (אחת מכתובות הרשת, או כתובת חיצונית לחיבור דרך האינטרנט)
  svc.createInvite = (host) => {
    if (!node || !listening) throw fail('disabled', 'יש להפעיל את הסנכרון לפני הצימוד');
    const ep = parseEndpoint(host || lanAddresses()[0] || '127.0.0.1', listening.port);
    if (!ep) throw fail('bad-endpoint', 'כתובת לא תקינה');
    const code = node.openPairing(ep);
    const inv = require('./pairing').parseInvite(code, now());
    invite = { code, exp: inv.exp };
    changed();
    return { code, expiresAt: inv.exp, endpoint: `${ep.host}:${ep.port}` };
  };
  svc.cancelInvite = () => { if (node) node.cancelPairing(); invite = null; changed(); };

  svc.join = async (code, endpoint) => {
    if (!node) throw fail('disabled', 'יש להפעיל את הסנכרון לפני הצימוד');
    let ep;
    if (endpoint) { ep = parseEndpoint(endpoint); if (!ep) throw fail('bad-endpoint', 'כתובת לא תקינה. דוגמה: 192.168.1.20:47700'); }
    const req = await node.joinPairing(String(code || '').trim(), { endpoint: ep });
    const inv = require('./pairing').parseInvite(String(code).trim(), now());
    const target = ep || inv.endpoint;
    const reqId = addApproval({
      ...req,
      approve: () => { req.approve(); data.endpoints[req.peer.id] = { ...target, via: 'pairing' }; saveState(); },
    }, 'outgoing');
    return { reqId, name: req.peer.name, code: req.code };
  };

  svc.approve = async (reqId) => {
    const a = takeApproval(reqId);
    a.approve();
    if (a.direction === 'incoming') { invite = null; }
    saveState();
    changed();
    // המכשיר המצטרף מתחבר מיד לכתובת שבהזמנה
    if (a.direction === 'outgoing') connectPeer(a.peer.id).catch(() => {});
    return svc.status();
  };
  svc.reject = (reqId) => { const a = approvals.get(reqId); approvals.delete(reqId); if (a) a.reject(); changed(); return svc.status(); };

  svc.connect = async (peerId, endpoint) => {
    let ep;
    if (endpoint) {
      ep = parseEndpoint(endpoint);
      if (!ep) throw fail('bad-endpoint', 'כתובת לא תקינה. דוגמה: 192.168.1.20:47700');
      data.endpoints[peerId] = { ...ep, via: 'manual' };
      saveState();
    }
    await connectPeer(peerId, ep);
    return svc.status();
  };

  svc.ping = async (peerId) => {
    if (!node) throw fail('disabled', 'הסנכרון כבוי');
    if (!node.connected().includes(peerId)) await connectPeer(peerId);
    const nonce = crypto.randomBytes(8).toString('hex');
    const started = Date.now();
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => { pings.delete(nonce); reject(fail('timeout', 'המכשיר לא ענה')); }, PING_TIMEOUT_MS);
      pings.set(nonce, {
        peerId,
        resolve: () => { clearTimeout(t); resolve(); },
        reject: (err) => { clearTimeout(t); reject(err); },
      });
      node.send(peerId, { type: 'ping', nonce });
    });
    return { ms: Date.now() - started };
  };

  svc.revoke = (peerId) => {
    if (!data.peers.some(p => p.id === peerId)) throw fail('unknown', 'המכשיר לא נמצא');
    if (node) node.revoke(peerId);
    else data.peers = require('./pairing').revokePeer(data.peers, peerId, { now: now() });
    delete data.endpoints[peerId];
    saveState();
    changed();
    return svc.status();
  };

  svc.close = async () => { clearInterval(pauseTimer); await stopNetwork(); };
  return svc;
}

module.exports = { createSyncService, parseEndpoint, lanAddresses, DEFAULT_PORT };
