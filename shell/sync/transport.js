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
// חיבור צימוד (מכשיר שעוד לא מצומד): בקשה אמיתית קטנה מ-4KB. מסגרת גדולה יותר — ניתוק מיד (בדיקת קוד 22.10.2026, ממצא 4)
const PAIRING_MAX_FRAME = 16 * 1024;
const REPLAY_WINDOW = 1024;
const LIMITS = { handshakeMs: 10000, pairingMs: 30000, idleMs: 120000, maxConnections: 64 };
// שני המכשירים חייגו זה לזה כמעט באותו רגע (שמעו את המשואה יחד) — נשאר החיבור שיזם בעל המזהה הנמוך (ממצא 8)
const SIMULTANEOUS_MS = 10000;
// התעודה לא נושאת את מזהה המכשיר: כל מי שמתחבר לפורט רואה אותה לפני כל אימות (ממצא 10)
const CERT_NAME = 'SuperSuite';

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
// החלקים נאספים לרשימה ומחוברים פעם אחת, כשהמסגרת שלמה. חיבור מחדש של כל המאגר בכל חלק היה ריבועי:
// מסגרת של 9MB ב-576 חלקים — 3.4 שניות של עבודה רצופה בתהליך הראשי (ממצא 4). אחרי שגיאה — לא ממשיכים
function frameReader(onFrame, onError, maxFrame = MAX_FRAME) {
  let chunks = [];
  let have = 0;
  let dead = false;
  // מוציא n בתים מתחילת הרשימה
  const take = (n) => {
    if (chunks[0].length >= n) {
      const out = chunks[0].subarray(0, n);
      if (chunks[0].length === n) chunks.shift(); else chunks[0] = chunks[0].subarray(n);
      have -= n;
      return out;
    }
    const out = Buffer.allocUnsafe(n);
    let off = 0;
    while (off < n) {
      const c = chunks[0];
      const k = Math.min(c.length, n - off);
      c.copy(out, off, 0, k);
      off += k;
      if (k === c.length) chunks.shift(); else chunks[0] = c.subarray(k);
    }
    have -= n;
    return out;
  };
  const stop = (err) => { dead = true; chunks = []; have = 0; onError(err); };
  let need = null; // אורך המסגרת הנוכחית, אחרי שנקראה הכותרת
  return (chunk) => {
    if (dead) return;
    chunks.push(chunk);
    have += chunk.length;
    for (;;) {
      if (need === null) {
        if (have < 4) return;
        need = take(4).readUInt32BE(0);
        if (need === 0 || need > maxFrame) return stop(fail('frame-size', 'מסגרת בגודל לא חוקי'));
      }
      if (have < need) return;
      const body = take(need);
      need = null;
      let obj;
      try { obj = JSON.parse(body.toString('utf8')); } catch { return stop(fail('frame-json', 'מסגרת לא תקינה')); }
      if (!obj || typeof obj !== 'object' || typeof obj.t !== 'string') return stop(fail('frame-json', 'מסגרת לא תקינה'));
      onFrame(obj);
      if (dead) return;
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
  const { cert, key } = selfSignedCert(identity.tls, { commonName: CERT_NAME });
  const sessions = new Map(); // peerId → session
  // בלי מצב שמור (מכשיר חדש, או קובץ שאבד / לא נקרא) המונה מתחיל מהשעון, ולא מ-0: העמית זוכר את המספר
  // הגבוה שראה, ומונה שהתחיל מחדש נדחה כשידור חוזר כמעט לתמיד (ממצא 3). מיליון לשנייה — עדיין מספר שלם בטוח
  const st = { replay: {}, ...(state || {}) };
  if (!Number.isSafeInteger(st.outSeq) || st.outSeq < 0) st.outSeq = now() * 1000;
  // שמירת המצב נכשלה (דיסק מלא, אנטי-וירוס נועל את הקובץ) — נרשם ביומן, והקורא מחליט; לא חריגה שלא נתפסה
  // מתוך מאזין של חיבור, שהקפיצה את חלון הקריסה בכל הודעה (ממצא 5)
  function persist() {
    try { onState({ ...st }); return true; }
    catch (err) { log('error', 'שמירת מצב הסנכרון נכשלה', { code: err && err.code }); return false; }
  }
  // צימוד מחדש של מכשיר: החלון שלו מתאפס — אחרת מכשיר שהמונה שלו התחיל מחדש נדחה גם אחרי הצימוד
  function resetReplay(peerId) {
    if (!st.replay[peerId]) return;
    const { [peerId]: _gone, ...rest } = st.replay;
    st.replay = rest;
    persist();
  }
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
  // initiator — מזהה המכשיר שיזם את החיבור (אני, או העמית)
  function startSession(socket, peer, initiator) {
    const old = sessions.get(peer.id);
    if (old && !old.closed && old.initiator !== initiator && now() - old.startedAt < SIMULTANEOUS_MS) {
      // חיוג בו-זמני משני הצדדים: שני הצדדים מכריעים באותו כלל, ולכן נשאר אותו חיבור אצל שניהם
      const keeper = identity.id < peer.id ? identity.id : peer.id;
      if (old.initiator === keeper) { socket.destroy(); return old; }
    }
    if (old) old.close('הוחלף בחיבור חדש');
    socket.setTimeout(lim.idleMs, () => session.close('זמן סרק'));
    const session = {
      peerId: peer.id,
      initiator,
      startedAt: now(),
      send(body) {
        const p = trusted(peer.id);
        if (!p) throw fail('not-paired', 'המכשיר אינו מצומד');
        st.outSeq += 1;
        // מספר שלא נשמר עלול לחזור אחרי הפעלה מחדש — ואז העמית ידחה אותו. לא שולחים בלי שמירה
        if (!persist()) throw fail('state-save', 'לא ניתן לשמור את מצב הסנכרון בדיסק — ההודעה לא נשלחה');
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
      // בלי שמירה, אחרי הפעלה מחדש אותה הודעה הייתה מתקבלת שוב — לא מעבירים אותה, וסוגרים בצורה מסודרת
      if (!persist()) return session.close('לא ניתן לשמור את מצב הסנכרון בדיסק');
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
    if (peer) return startSession(socket, peer, peer.id);
    if (pending && !pending.used && now() <= pending.exp) return handlePairingConnection(socket, k);
    socket.destroy(); // לא מצומד ואין צימוד פתוח — בלי שום תשובה
  }

  // מכשיר שאינו מצומד, כשיש הזמנה פתוחה: בקשה (עם התחייבות) ← המספר שלי ← החשיפה של המספר שלו ← ניתוק.
  // מסגרות קטנות בלבד (PAIRING_MAX_FRAME)
  function handlePairingConnection(socket, presented) {
    socket.setTimeout(lim.pairingMs, () => socket.destroy());
    let stage = 'request';
    let result = null;
    const failReply = (err) => {
      stage = 'done';
      log('warn', 'צימוד נדחה', { code: err.code });
      socket.end(encodeFrame({ t: 'pair-fail', code: err.code || 'error' }));
    };
    socket.on('data', frameReader((frame) => {
      if (stage === 'request') {
        const inv = pending;
        try {
          if (frame.t !== 'pair' || !inv) throw fail('bad-response', 'בקשת צימוד לא תקינה');
          result = Pairing.completePairing(identity, inv, frame.response, { now: now() });
          // המפתח שהוצג ב-TLS חייב להיות המפתח שבתשובה החתומה — אחרת מישהו "השאיל" תשובה של אחר
          if (!sameTlsKey(result.peer.tls, presented)) throw fail('tls-mismatch', 'מפתח החיבור אינו תואם את בקשת הצימוד');
        } catch (err) {
          // ההזמנה נשרפת רק אחרי הוכחה תקינה (completePairing מסמן used) — זר שלא מכיר את הסוד לא שורף אותה
          if (pending === inv && inv && inv.used) { pending = null; node.emit('pairing-closed'); }
          return failReply(err);
        }
        if (pending === inv) { pending = null; node.emit('pairing-closed'); }
        stage = 'reveal';
        socket.write(encodeFrame({ t: 'pair-nonce', nonce: result.nonce }));
        return;
      }
      if (stage !== 'reveal') return;
      let code;
      try {
        if (frame.t !== 'pair-reveal') throw fail('bad-response', 'בקשת צימוד לא תקינה');
        ({ code } = result.finish(frame.nonce));
      } catch (err) { return failReply(err); }
      stage = 'done';
      socket.end(encodeFrame({ t: 'pair-ok' }));
      const peer = result.peer;
      node.emit('pair-request', {
        peer, code,
        approve: () => { resetReplay(peer.id); savePeers(Pairing.addPeer(getPeers(), peer, { now: now() })); },
        reject: () => {},
      });
    }, () => socket.destroy(), PAIRING_MAX_FRAME));
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
    return startSession(socket, peer, identity.id);
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
  // יש הזמנה שעדיין אפשר להשתמש בה (לא נוצלה, לא בוטלה, לא פגה)
  node.pairingOpen = () => !!(pending && !pending.used && now() <= pending.exp);

  // במכשיר המצטרף: מתחבר לכתובת שבהזמנה (או לזו שהמשתמש הזין), ומחזיר את קוד האימות להשוואה
  node.joinPairing = async (code, { endpoint } = {}) => {
    const inv = Pairing.parseInvite(code, now());
    const target = endpoint || inv.endpoint;
    if (!target) throw fail('no-endpoint', 'בקוד הצימוד אין כתובת — הזינו את כתובת המכשיר השני');
    const accepted = Pairing.acceptInvite(identity, code, { now: now() });
    const socket = await dial(target, inv.peer.tls);
    const refused = (f) => fail(f.code || 'pair-failed', f.code === 'old-version'
      ? 'המכשיר השני משתמש בגרסה אחרת של התוכנה — עדכנו את שני המכשירים'
      : 'המכשיר השני דחה את הצימוד — צרו קוד חדש ונסו שוב');
    // בקשה (עם התחייבות) ← המספר של המזמין ← חשיפת המספר שלי ← אישור
    const shown = await new Promise((resolve, reject) => {
      let mine = null;
      const end = (fn) => { clearTimeout(timer); socket.destroy(); fn(); };
      const timer = setTimeout(() => end(() => reject(fail('timeout', 'המכשיר השני אינו עונה'))), lim.pairingMs);
      socket.on('data', frameReader((f) => {
        if (!mine) {
          if (f.t !== 'pair-nonce') return end(() => reject(refused(f)));
          try { mine = accepted.reveal(f.nonce); } catch (e) { return end(() => reject(e)); }
          socket.write(encodeFrame({ t: 'pair-reveal', nonce: mine.nonce }));
          return;
        }
        end(() => (f.t === 'pair-ok' ? resolve(mine.code) : reject(refused(f))));
      }, (e) => end(() => reject(e)), PAIRING_MAX_FRAME));
      socket.on('error', () => {});
      socket.on('close', () => { clearTimeout(timer); reject(fail('closed', 'המכשיר השני סגר את החיבור — ייתכן שקוד הצימוד כבר נוצל או בוטל. צרו קוד חדש')); });
      socket.write(encodeFrame({ t: 'pair', response: accepted.response }));
    });
    return {
      peer: accepted.peer, code: shown,
      approve: () => { resetReplay(accepted.peer.id); savePeers(Pairing.addPeer(getPeers(), accepted.peer, { now: now() })); },
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

module.exports = { createPeerNode, encodeFrame, frameReader, replayAccept, replaySeen, ALPN, MAX_FRAME, PAIRING_MAX_FRAME, REPLAY_WINDOW, CERT_NAME };
