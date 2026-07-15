/* ============================================================
   KURSOR — Auth маршруты: /api/auth/*
   ============================================================ */
const express = require('express');
const db = require('./db');
const { signToken, checkPassword, authRequired, hashPassword } = require('./auth');
const { getPermissions } = require('./permissions');

const router = express.Router();

router.post('/login', (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: 'Введи логин и пароль' });

  const row = db.prepare('SELECT * FROM users WHERE login = ?').get(String(login).trim());
  if (!row) return res.status(401).json({ error: 'Неверный логин или пароль' });
  if (!checkPassword(password, row.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  const user = {
    id: row.id, login: row.login, name: row.name, role: row.role,
    age: row.age, group: row.group_id,
    languages: JSON.parse(row.languages || '[]'),
    teacher_id: row.teacher_id,
  };
  const token = signToken(user);
  res.json({ token, user });
});

router.get('/me', authRequired, (req, res) => {
  const out = { user: req.user };
  if (req.user.role === 'teacher' || req.user.role === 'assistant') {
    try { out.user = { ...req.user, permissions: getPermissions(req.user.id) }; } catch {}
  }
  if (req.user.role === 'parent') {
    const children = db.prepare(`
      SELECT u.id, u.name, u.avatar_url
      FROM parent_children pc
      JOIN users u ON u.id = pc.student_id
      WHERE pc.parent_id = ?
      ORDER BY u.name
    `).all(req.user.id);
    out.children = children.map(c => ({ id: c.id, name: c.name, avatar_url: c.avatar_url || null }));
  }
  res.json(out);
});

router.post('/change-password', authRequired, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'Новый пароль слишком короткий (мин. 4 символа)' });
  }
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!row || !checkPassword(oldPassword, row.password_hash)) {
    return res.status(401).json({ error: 'Старый пароль неверен' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  res.json({ ok: true });
});

module.exports = router;
