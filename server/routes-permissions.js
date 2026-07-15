/* ============================================================
   KURSOR — Права учителей/ассистентов: /api/teacher-permissions
   ============================================================ */
const express = require('express');
const db = require('./db');
const { authRequired, requireRole } = require('./auth');
const { PERMISSION_KEYS, getPermissions, setPermission } = require('./permissions');

const router = express.Router();
router.use(authRequired);

// Справочник доступных ключей прав
router.get('/teacher-permissions/keys', requireRole('admin'), (req, res) => {
  res.json(Object.entries(PERMISSION_KEYS).map(([key, v]) => ({ key, label: v.label, default: v.default })));
});

// Текущие права учителя — admin или сам учитель
router.get('/teacher-permissions/:teacherId', (req, res) => {
  if (req.user.role !== 'admin' && req.user.id !== req.params.teacherId) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  res.json(getPermissions(req.params.teacherId));
});

// Установить права (объект key->bool) — только admin
router.put('/teacher-permissions/:teacherId', requireRole('admin'), (req, res) => {
  const teacher = db.prepare("SELECT id, role FROM users WHERE id = ?").get(req.params.teacherId);
  if (!teacher) return res.status(404).json({ error: 'Учитель не найден' });
  const body = req.body || {};
  for (const key of Object.keys(PERMISSION_KEYS)) {
    if (key in body) setPermission(req.params.teacherId, key, !!body[key]);
  }
  res.json(getPermissions(req.params.teacherId));
});

module.exports = router;
