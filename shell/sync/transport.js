// חיבור ישיר בין עמיתים (docs/SYNC-DESIGN.md, שלב 2).
// כל מכשיר מאזין (שרת) וגם מתחבר לעמיתים (לקוח). שכבות ההגנה:
// 1. TLS 1.3 בלבד, עם אימות הדדי (mTLS). האמון הוא הצמדת מפתח ה-TLS שהתקבל בצימוד — לא רשות אישורים.
//    מכשיר שאינו מצומד מנותק מיד (חוץ מחיבור צימוד, כשיש הזמנה פתוחה).
// 2. בתוך ה-TLS כל הודעה היא מעטפה מוצפנת וחתומה (envelope.js) — הגנה גם אם שכבת ה-TLS תיפגע.
// 3. הגנה מפני שידור חוזר בחלון הזזה (RFC 4303 §3.4.3), כך שהודעות שהגיעו בסדר שונה לא נדחות.
// 4. מגבלות משאבים: גודל מסגרת, זמן לחיצת יד, זמן סרק, מספר חיבורים.
const tls = require('tls');
const { EventEmitter } = require('events');
const Envelope = require('./envelope');
const Pairing = require('./pairing');
const { publicInfo } = require('./identity');
const { selfSignedCert, certPublicJwk, sameTlsKey } = require('./cert');

const ALPN = 'supersuite-sync/1';
const MAX_FRAME = 9 * 1024 * 1024;
const REPLAY_WINDOW = 1024;
const LIMITS = { handshakeMs: 10000, pairingMs: 30000, idleMs: 120000, maxConnections: 64 };

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// ── מסגרות: אורך 4 בתים (big-endian) + JSON ──
function encodeFrame(obj) {
  const body = Buffer.from(JSON.stringify(obj));
  if (body.length === 0 || body.length > MAX_FRAME) throw fail('frame-size', 'ההודעה גדולה מדי');
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  return Buffer.concat([head, body]);
}
function frameReader(onFrame, onError) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const n = buf.readUInt32BE(0);
      if (n === 0 || n > MAX_FRAME) { buf = Buffer.alloc(0); return onError(fail('frame-size', 'מסגרת בגודל לא חוקי')); }
      if (buf.length < 4 + n) return;
      const body = buf.subarray(4, 4 + n);
      buf = buf.subarray(4 + n);
      let obj;
      try { obj = JSON.parse(body.toString('utf8')); } catch { return onError(fail('frame-json', 'מסגרת לא תקינה')); }
      if (!obj || typeof obj !== 'object' || typeof obj.t !== 'string') return onError(fail('frame-json', 'מסגרת לא תקינה'));
      onFrame(obj);
    }
  };
}

// ── חלון שידור חוזר: state = { max, recent: [seq...] } לכל עמית ──
function replayFloor(w) { return w ? Math.max(0, w.max - REPLAY_WINDOW) : 0; }
function replaySeen(w, seq) { return !!w && (seq <= w.max - REPLAY_WINDOW || w.recent.includes(seq)); }
function replayAccept(w, seq) {
  const max = Math.max(w ? w.max : 0, seq);
  const recent = [...(w ? w.recent : []), seq].filter(s => s > max - REPLAY_WINDOW);
  return { max, recent };
}

// identity: הזהות המלאה (כולל מפתחות פרטיים); getPeers(): רשימת העמיתים (pairing.addPeer);
// savePeers(list): שמירת הרשימה; state/onState: { outSeq, replay: {peerId: window} } — נשמר בכל שינוי
function createPeerNode({ identity, getPeers, savePeers, state, onState = () => {}, now = Date.now, limits = {} }) {
  const lim = { ...LIMITS, ...limits };
  const node = new EventEmitter();
  const { cert, key } = selfSignedCert(identity.tls, { commonName: identity.id });
  const sessions = new Map(); // peerId → session
  const st = { outSeq: 0, replay: {}, ...(state || {}) };
  let pending = null; // הזמנת צימוד פתוחה אחת בלבד; הזמנה חדשה מחליפה את הקודמת
  let server = null;
  const sockets = new Set(); // כל החיבורים הפתוחים — לסגירה מלאה
  const track = (sock) => { sockets.add(sock); sock.once('close', () => sockets.delete(sock)); return sock; };

  const tlsBase = {
    cert, key, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3',
    ALPNProtocols: [ALPN], rejectUnauthorized: false, // האימות הוא ההצמדה, לא שרשרת אישורים
  };
  const trusted = (id) => Pairing.trustedPeer(getPeers(), id);
  const peerByTlsKey = (jwk) => getPeers().find(p => !p.revoked && sameTlsKey(p.tls, jwk)) || null;
  const log = (level, msg, extra) => node.emit('log', { level, msg, ...extra });

  function presentedKey(socket) {
    const c = socket.getPeerCertificate(true);
    if (!c || !c.raw) return null;
    try { return certPublicJwk(c.raw); } catch { return null; }
  }

  // ── סשן מאומת מול עמית מצומד ──
  function startSession(socket, peer) {
    const old = sessions.get(peer.id);
    if (old) old.close('הוחלף בחיבור חדש');
    socket.setTimeout(lim.idleMs, () => session.close('זמן סרק'));
    const session = {
      peerId: peer.id,
      send(body) {
        const p = trusted(peer.id);
        if (!p) throw fail('not-paired', 'המכשיר אינו מצומד');
        st.outSeq += 1;
        onState({ ...st });
        socket.write(encodeFrame({ t: 'env', env: Envelope.seal({ identity, peer: p, seq: st.outSeq, body, now: now() }) }));
      },
      close(reason) {
        if (sessions.get(peer.id) === session) sessions.delete(peer.id);
        if (!socket.destroyed) socket.destroy();
        if (!session.closed) { session.closed = true; node.emit('disconnected', peer.id, reason || null); }
      },
      closed: false,
    };
    socket.on('data', frameReader((frame) => {
      if (frame.t !== 'env') return session.close('סוג הודעה לא צפוי');
      const p = trusted(peer.id);
      if (!p) return session.close('המכשיר בוטל');
      const w = st.replay[peer.id];
      let msg;
      try {
        msg = Envelope.open({ identity, peer: p, env: frame.env, lastSeq: replayFloor(w), now: now() });
        if (replaySeen(w, msg.seq)) throw fail('replay', 'הודעה שכבר התקבלה (שידור חוזר)');
      } catch (err) {
        log('warn', 'הודעה נדחתה', { peerId: peer.id, code: err.code });
        return session.close(err.message);
      }
      st.replay = { ...st.replay, [peer.id]: replayAccept(w, msg.seq) };
      onState({ ...st });
      node.emit('message', peer.id, msg.body);
    }, (err) => { log('warn', 'מסגרת נדחתה', { peerId: peer.id, code: err.code }); session.close(err.message); }));
    socket.on('close', () => session.close());
    socket.on('error', () => session.close());
    sessions.set(peer.id, session);
    node.emit('connected', peer.id);
    return session;
  }

  // ── צד שרת ──
  function onSecureConnection(socket) {
    track(socket);
    socket.on('error', () => {});
    const k = presentedKey(socket);
    if (!k || socket.alpnProtocol !== ALPN) return socket.destroy();
    const peer = peerByTlsKey(k);
    if (peer) return startSession(socket, peer);
    if (pending && !pending.used && now() <= pending.exp) return handlePairingConnection(socket, k);
    socket.destroy(); // לא מצומד ואין צימוד פתוח — בלי שום תשובה
  }

  // מכשיר שאינו מצומד, כשיש הזמנה פתוחה: מסגרת אחת בלבד, ואז ניתוק
  function handlePairingConnection(socket, presented) {
    socket.setTimeout(lim.pairingMs, () => socket.destroy());
    let done = false;
    const reply = (obj) => { socket.end(encodeFrame(obj)); };
    socket.on('data', frameReader((frame) => {
      if (done) return;
      done = true;
      const inv = pending;
      try {
        if (frame.t !== 'pair' || !inv) throw fail('bad-response', 'בקשת צימוד לא תקינה');
        const result = Pairing.completePairing(identity, inv, frame.response, { now: now() });
        // המפתח שהוצג ב-TLS חייב להיות המפתח שבתשובה החתומה — אחרת מישהו "השאיל" תשובה של אחר
        if (!sameTlsKey(result.peer.tls, presented)) throw fail('tls-mismatch', 'מפתח החיבור אינו תואם את בקשת הצימוד');
        if (pending === inv) pending = null;
        reply({ t: 'pair-ok' });
        node.emit('pair-request', {
          peer: result.peer, code: result.code,
          approve: () => savePeers(Pairing.addPeer(getPeers(), result.peer, { now: now() })),
          reject: () => {},
        });
      } catch (err) {
        if (pending === inv && inv && inv.used) pending = null;
        log('warn', 'צימוד נדחה', { code: err.code });
        reply({ t: 'pair-fail', code: err.code || 'error' });
      }
    }, () => socket.destroy()));
  }

  node.listen = ({ host = '0.0.0.0', port = 0 } = {}) => new Promise((resolve, reject) => {
    server = tls.createServer({ ...tlsBase, requestCert: true, handshakeTimeout: lim.handshakeMs }, onSecureConnection);
    server.maxConnections = lim.maxConnections;
    server.on('tlsClientError', () => {}); // לחיצת יד שנכשלה (גרסה ישנה, בלי תעודה) — מתעלמים בשקט
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(server.address()); });
  });

  // ── צד לקוח: חיבור TLS עם הצמדת מפתח השרת ──
  function dial({ host, port }, expectedTls) {
    return new Promise((resolve, reject) => {
      const socket = track(tls.connect({ ...tlsBase, host, port, servername: undefined, checkServerIdentity: () => undefined }));
      const timer = setTimeout(() => { socket.destroy(); reject(fail('timeout', 'המכשיר השני אינו עונה')); }, lim.handshakeMs);
      socket.once('error', (err) => { clearTimeout(timer); reject(fail('connect', 'לא ניתן להתחבר למכשיר: ' + (err.code || err.message))); });
      socket.once('secureConnect', () => {
        clearTimeout(timer);
        const k = presentedKey(socket);
        if (!k || !sameTlsKey(k, expectedTls)) { socket.destroy(); return reject(fail('pin-mismatch', 'זהות המכשיר בכתובת זו אינה תואמת — ייתכן ניסיון התחזות')); }
        if (socket.alpnProtocol !== ALPN) { socket.destroy(); return reject(fail('protocol', 'המכשיר השני אינו תומך בפרוטוקול')); }
        resolve(socket);
      });
    });
  }

  node.connect = async (peerId, endpoint) => {
    const peer = trusted(peerId);
    if (!peer) throw fail('not-paired', 'המכשיר אינו מצומד');
    const socket = await dial(endpoint, peer.tls);
    socket.on('error', () => {});
    return startSession(socket, peer);
  };

  node.send = (peerId, body) => {
    const s = sessions.get(peerId);
    if (!s) throw fail('offline', 'המכשיר אינו מחובר כעת');
    s.send(body);
  };
  node.connected = () => [...sessions.keys()];

  // ── צימוד ברשת ──
  // במכשיר המזמין: endpoint היא הכתובת שהמכשיר השני יתחבר אליה
  node.openPairing = (endpoint) => {
    const { code, pending: p } = Pairing.createInvite(identity, { now: now(), endpoint });
    pending = p;
    return code;
  };
  node.cancelPairing = () => { pending = null; };

  // במכשיר המצטרף: מתחבר לכתובת שבהזמנה (או לזו שהמשתמש הזין), ומחזיר את קוד האימות להשוואה
  node.joinPairing = async (code, { endpoint } = {}) => {
    const inv = Pairing.parseInvite(code, now());
    const target = endpoint || inv.endpoint;
    if (!target) throw fail('no-endpoint', 'בקוד הצימוד אין כתובת — הזינו את כתובת המכשיר השני');
    const accepted = Pairing.acceptInvite(identity, code, { now: now() });
    const socket = await dial(target, inv.peer.tls);
    const answer = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.destroy(); reject(fail('timeout', 'המכשיר השני אינו עונה')); }, lim.pairingMs);
      socket.on('data', frameReader((f) => { clearTimeout(timer); socket.destroy(); resolve(f); },
        (e) => { clearTimeout(timer); socket.destroy(); reject(e); }));
      socket.on('error', () => {});
      socket.on('close', () => { clearTimeout(timer); reject(fail('closed', 'המכשיר השני סגר את החיבור — ייתכן שקוד הצימוד כבר נוצל או בוטל. צרו קוד חדש')); });
      socket.write(encodeFrame({ t: 'pair', response: accepted.response }));
    });
    if (answer.t !== 'pair-ok') throw fail(answer.code || 'pair-failed', 'המכשיר השני דחה את הצימוד — צרו קוד חדש ונסו שוב');
    return {
      peer: accepted.peer, code: accepted.code,
      approve: () => savePeers(Pairing.addPeer(getPeers(), accepted.peer, { now: now() })),
      reject: () => {},
    };
  };

  // ביטול מכשיר: מסומן כמבוטל ונותק מיד
  node.revoke = (peerId) => {
    savePeers(Pairing.revokePeer(getPeers(), peerId, { now: now() }));
    const s = sessions.get(peerId);
    if (s) s.close('המכשיר בוטל');
  };

  node.close = () => new Promise((resolve) => {
    for (const s of [...sessions.values()]) s.close('סגירה');
    for (const sock of sockets) sock.destroy();
    pending = null;
    if (!server) return resolve();
    server.close(() => resolve());
  });

  node.info = () => publicInfo(identity);
  return node;
}

module.exports = { createPeerNode, encodeFrame, frameReader, replayAccept, replaySeen, ALPN, MAX_FRAME, REPLAY_WINDOW };
