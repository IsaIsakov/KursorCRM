/* ============================================================
   KURSOR — WebSocket: учителя/админы получают live-обновления
   ============================================================ */
const { WebSocketServer } = require('ws');
const { verifyToken, tokenFromCookie } = require('./auth');
const db = require('./db');
const { canAccessStudent } = require('./access-scope');
const { originAllowed } = require('./http-security');

let wss = null;
const MAX_CONNECTIONS_PER_SOURCE = 20;
const MAX_TOTAL_CONNECTIONS = 1000;
const sourceConnections = new Map();

function recipientsForStudent(studentId) {
  const allowed = new Set();
  allowed.add(studentId);
  const candidates = db.prepare("SELECT id, role FROM users WHERE role IN ('admin','teacher','assistant')").all();
  for (const user of candidates) if (canAccessStudent(db, user, studentId)) allowed.add(user.id);
  return allowed;
}

function init(server) {
  wss = new WebSocketServer({
    server, path: '/ws',
    maxPayload: 16 * 1024,
    perMessageDeflate: false,
    verifyClient(info, done) {
      const allowed = process.env.NODE_ENV !== 'production'
        ? originAllowed(info.origin)
        : (!!info.origin && originAllowed(info.origin)) || (!info.origin && process.env.API_AUTH_BEARER === 'true');
      done(allowed, allowed ? 200 : 403, 'Origin not allowed');
    },
  });
  wss.on('connection', (socket, req) => {
    const source = req.socket.remoteAddress || 'unknown';
    const count = sourceConnections.get(source) || 0;
    if (wss.clients.size > MAX_TOTAL_CONNECTIONS || count >= MAX_CONNECTIONS_PER_SOURCE) {
      socket.close(1013, 'capacity');
      return;
    }
    sourceConnections.set(source, count + 1);
    socket.once('close', () => {
      const next = (sourceConnections.get(source) || 1) - 1;
      if (next <= 0) sourceConnections.delete(source); else sourceConnections.set(source, next);
    });
    socket.on('error', () => {});
    const url = new URL(req.url, 'http://localhost');
    // Browsers authenticate the same-origin upgrade with the HttpOnly cookie.
    // Query tokens remain opt-in for non-browser legacy clients only.
    const queryToken = process.env.API_AUTH_BEARER === 'true' ? url.searchParams.get('token') : null;
    const token = tokenFromCookie(req.headers.cookie) || queryToken;
    const payload = token ? verifyToken(token) : null;
    if (!payload) {
      socket.send(JSON.stringify({ type: 'error', error: 'unauthorized' }));
      socket.close();
      return;
    }
    const current = db.prepare('SELECT id, role, must_change_password FROM users WHERE id=?').get(payload.sub);
    if (!current || current.must_change_password) {
      socket.send(JSON.stringify({ type: 'error', error: 'unauthorized' }));
      socket.close();
      return;
    }
    socket.userId = current.id;
    socket.role = current.role;
    socket.send(JSON.stringify({ type: 'hello', userId: current.id, role: current.role }));

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'ping') socket.send(JSON.stringify({ type: 'pong', t: Date.now() }));
      } catch {}
    });
  });
  console.log('[ws] WebSocket-сервер запущен на /ws');
}

function broadcastProgress(studentId, progress) {
  if (!wss) return;
  const recipients = recipientsForStudent(studentId);
  const data = JSON.stringify({ type: 'progress', studentId, progress, t: Date.now() });
  wss.clients.forEach(client => {
    if (client.readyState === 1 && recipients.has(client.userId)) {
      try { client.send(data); } catch {}
    }
  });
}

function broadcastToUsers(userIds, payload) {
  if (!wss) return;
  const recipients = new Set(userIds || []);
  const data = JSON.stringify({ ...payload, t: Date.now() });
  wss.clients.forEach(client => {
    if (client.readyState === 1 && recipients.has(client.userId)) {
      try { client.send(data); } catch {}
    }
  });
}

function close() {
  if (!wss) return;
  for (const client of wss.clients) try { client.close(1001, 'server shutdown'); } catch {}
  wss.close(); wss = null; sourceConnections.clear();
}

module.exports = { init, close, broadcastProgress, broadcastToUsers };
