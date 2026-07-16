/* ============================================================
   KURSOR — Auth маршруты: /api/auth/*
   ============================================================ */
const express = require('express');
const db = require('./db');
const { signToken, checkPassword, authRequired, hashPassword, issueSession, clearSession, parseCookies, CSRF_COOKIE } = require('./auth');
const { getPermissions } = require('./permissions');
const { isAcceptablePassword } = require('./security-config');
const loginGuard = require('./login-guard');
const { z, text, validateBody } = require('./validation');

const router = express.Router();

const loginSchema = z.strictObject({ login: text(100), password: z.string().min(1).max(1024) });
const changePasswordSchema = z.strictObject({ oldPassword: z.string().min(1).max(1024), newPassword: z.string().min(10).max(1024) });

router.post('/login', validateBody(loginSchema), (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: 'Введи логин и пароль' });

  const source = req.ip || req.socket.remoteAddress || 'unknown';
  const gate = loginGuard.consume(source, login);
  if (!gate.allowed) {
    res.setHeader('Retry-After', String(gate.retryAfter));
    console.warn(`[security] login_blocked reason=${gate.reason} key=${gate.eventKey}`);
    return res.status(429).json({ error: 'Слишком много попыток. Попробуйте позже', retryAfter: gate.retryAfter });
  }

  const row = db.prepare('SELECT * FROM users WHERE login = ?').get(String(login).trim());
  // Always run bcrypt. This makes an unknown login and a wrong password much
  // harder to distinguish by response time.
  const dummyHash = '$2a$10$7EqJtq98hPqEX7fNZaFWoO5Yf2mP9m7xvL1nH6tZQzK0Qh6VQ7L3a';
  const passwordOk = checkPassword(password, row ? row.password_hash : dummyHash);
  if (!row || !passwordOk) {
    const failure = loginGuard.recordFailure(source, login);
    console.warn(`[security] login_failed key=${failure.eventKey} count=${failure.count} locked=${failure.locked}`);
    if (failure.locked) res.setHeader('Retry-After', String(failure.retryAfter));
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  loginGuard.recordSuccess(source, login);
  const user = {
    id: row.id, login: row.login, name: row.name, role: row.role,
    age: row.age, group: row.group_id,
    languages: JSON.parse(row.languages || '[]'),
    teacher_id: row.teacher_id,
    mustChangePassword: !!row.must_change_password,
  };
  const token = signToken(user);
  const csrfToken = issueSession(res, token);
  res.json({ user, csrfToken });
});

router.get('/me', authRequired, (req, res) => {
  const out = { user: req.user, csrfToken: parseCookies(req.headers.cookie)[CSRF_COOKIE] || null };
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

router.post('/logout', authRequired, validateBody(z.strictObject({})), (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.post('/change-password', authRequired, validateBody(changePasswordSchema), (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !isAcceptablePassword(newPassword)) {
    return res.status(400).json({ error: 'Новый пароль слишком короткий (минимум 10 символов)' });
  }
  if (oldPassword === newPassword) return res.status(400).json({ error: 'Новый пароль должен отличаться от старого' });
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!row || !checkPassword(oldPassword, row.password_hash)) {
    return res.status(401).json({ error: 'Старый пароль неверен' });
  }
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  res.json({ ok: true });
});

module.exports = router;
