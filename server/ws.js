/* ============================================================
   KURSOR — WebSocket: учителя/админы получают live-обновления
   ============================================================ */
const { WebSocketServer } = require('ws');
const { verifyToken } = require('./auth');
const db = require('./db');

let wss = null;

function recipientsForStudent(studentId) {
  const student = db.prepare('SELECT teacher_id FROM users WHERE id = ?').get(studentId);
  const allowed = new Set();
  allowed.add(studentId);
  if (student && student.teacher_id) allowed.add(student.teacher_id);
  const everyone = db.prepare("SELECT id, role FROM users WHERE role IN ('admin','teacher')").all();
  for (const u of everyone) {
    if (u.role === 'admin') allowed.add(u.id);
    if (u.role === 'teacher' && (!student || !student.teacher_id)) allowed.add(u.id);
  }
  return allowed;
}

function init(server) {
  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const payload = token ? verifyToken(token) : null;
    if (!payload) {
      socket.send(JSON.stringify({ type: 'error', error: 'unauthorized' }));
      socket.close();
      return;
    }
    socket.userId = payload.sub;
    socket.role = payload.role;
    socket.send(JSON.stringify({ type: 'hello', userId: payload.sub, role: payload.role }));

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

module.exports = { init, broadcastProgress };
