/* ============================================================
   KURSOR — Уведомления (фаза 6)
   GET    /api/notifications            — свои уведомления (+ unread count)
   PUT    /api/notifications/:id/read   — отметить прочитанным
   PUT    /api/notifications/read-all   — отметить все прочитанными
   DELETE /api/notifications/:id        — удалить
   ============================================================ */
const express = require('express');
const db = require('./db');
const { authRequired } = require('./auth');

const router = express.Router();
router.use(authRequired);

function rowToNotif(r) {
  return {
    id: r.id,
    userId: r.user_id,
    type: r.type,
    text: r.text,
    link: r.link || null,
    channel: r.channel || 'in_app',
    read: !!r.read,
    createdAt: r.created_at,
  };
}

// Список своих уведомлений (новейшие сверху), ограничение 100
router.get('/', (req, res) => {
  const rows = db.prepare(
    `SELECT * FROM notifications
     WHERE user_id = ? AND channel = 'in_app'
     ORDER BY created_at DESC
     LIMIT 100`
  ).all(req.user.id);
  const unread = db.prepare(
    `SELECT COUNT(*) AS n FROM notifications
     WHERE user_id = ? AND read = 0 AND channel = 'in_app'`
  ).get(req.user.id).n;
  res.json({ items: rows.map(rowToNotif), unread });
});

// Отметить одно прочитанным
router.put('/:id/read', (req, res) => {
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Уведомление не найдено' });
  if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Отметить все прочитанными
router.put('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(req.user.id);
  res.json({ ok: true });
});

// Удалить уведомление
router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Уведомление не найдено' });
  if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
  db.prepare('DELETE FROM notifications WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
