/* ============================================================
   KURSOR — Auth маршруты: /api/auth/*
   ============================================================ */
const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const { signToken, checkPassword, authRequired, requireRole, hashPassword, issueSession, clearSession, parseCookies, CSRF_COOKIE } = require('./auth');
const { getPermissions } = require('./permissions');
const { isAcceptablePassword } = require('./security-config');
const loginGuard = require('./login-guard');
const { z, text, validateBody } = require('./validation');
const { genId } = require('./util');
const { temporaryPassword, storeCredential } = require('./onboarding');
const { sendAccessMessage, normalizePhone } = require('./whatsapp');

const router = express.Router();

const loginSchema = z.strictObject({ login: text(100), password: z.string().min(1).max(1024) });
const changePasswordSchema = z.strictObject({ oldPassword: z.string().min(1).max(1024), newPassword: z.string().min(10).max(1024) });
const recoverySchema = z.strictObject({
  login: text(100),
  recoveryCode: z.string().min(1).max(1024),
  newPassword: z.string().min(10).max(1024),
});
const resetRequestSchema = z.strictObject({ login: text(100) });

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post('/recover-admin', validateBody(recoverySchema), (req, res) => {
  const configured = String(process.env.ADMIN_RECOVERY_CODE || '');
  if (!configured) return res.status(503).json({ error: 'Восстановление не настроено администратором' });
  const { login, recoveryCode, newPassword } = req.body;
  const source = req.ip || req.socket.remoteAddress || 'unknown';
  const limiterLogin = `admin-recovery:${login}`;
  const gate = loginGuard.consume(source, limiterLogin);
  if (!gate.allowed) {
    res.setHeader('Retry-After', String(gate.retryAfter));
    return res.status(429).json({ error: 'Слишком много попыток. Попробуйте позже', retryAfter: gate.retryAfter });
  }
  const row = db.prepare("SELECT id FROM users WHERE login=? AND role='admin'").get(String(login).trim());
  if (!row || !safeEqual(recoveryCode, configured)) {
    const failure = loginGuard.recordFailure(source, limiterLogin);
    if (failure.locked) res.setHeader('Retry-After', String(failure.retryAfter));
    return res.status(401).json({ error: 'Неверный логин администратора или код восстановления' });
  }
  if (!isAcceptablePassword(newPassword)) return res.status(400).json({ error: 'Пароль должен содержать не менее 10 символов' });
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').run(hashPassword(newPassword), row.id);
    db.prepare('UPDATE account_credentials SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(Date.now(), row.id);
  })();
  loginGuard.recordSuccess(source, limiterLogin);
  clearSession(res);
  res.json({ ok: true });
});

function resetContext(userId) {
  const direct = db.prepare('SELECT branch_id,parent_name,parent_phone,full_name FROM students_crm WHERE user_id=?').get(userId);
  if (direct) return { branchId: direct.branch_id || null, phone: normalizePhone(direct.parent_phone), name: direct.full_name };
  const parent = db.prepare(`SELECT sc.branch_id,sc.parent_phone,sc.parent_name FROM parent_children pc
    JOIN students_crm sc ON sc.user_id=pc.student_id WHERE pc.parent_id=? ORDER BY sc.full_name LIMIT 1`).get(userId);
  if (parent) return { branchId: parent.branch_id || null, phone: normalizePhone(parent.parent_phone), name: parent.parent_name };
  const staff = db.prepare(`SELECT g.branch_id FROM groups g WHERE g.teacher_id=? OR g.assistant_id=? LIMIT 1`).get(userId,userId);
  return { branchId: staff?.branch_id || null, phone: null, name: null };
}

router.post('/password-reset/request', validateBody(resetRequestSchema), (req, res) => {
  const login = String(req.body.login || '').trim();
  const source = req.ip || req.socket.remoteAddress || 'unknown';
  const gate = loginGuard.consume(source, `password-reset:${login}`);
  if (!gate.allowed) return res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже' });
  const user = db.prepare('SELECT id,login,name,role FROM users WHERE login=?').get(login);
  // Ответ всегда одинаковый: форма не раскрывает существование аккаунта.
  if (!user) return res.json({ ok: true, message: 'Если аккаунт найден, заявка отправлена ответственному сотруднику' });
  const existing = db.prepare("SELECT id FROM password_reset_requests WHERE user_id=? AND status='pending' AND requested_at>?")
    .get(user.id, Date.now() - 30 * 60 * 1000);
  if (!existing) {
    const context = resetContext(user.id);
    const id = genId('prr'), now = Date.now();
    db.prepare(`INSERT INTO password_reset_requests(id,user_id,login_snapshot,branch_id,status,requested_at)
      VALUES (?,?,?,?,'pending',?)`).run(id,user.id,user.login,context.branchId,now);
    const recipients = new Set(db.prepare("SELECT id FROM users WHERE role='admin'").all().map(x => x.id));
    if (context.branchId) db.prepare('SELECT curator_id id FROM curator_branches WHERE branch_id=?').all(context.branchId).forEach(x => recipients.add(x.id));
    const notify = db.prepare(`INSERT OR IGNORE INTO notifications(id,user_id,type,text,link,channel,read,created_at)
      VALUES (?,?, 'password_reset', ?, ?, 'in_app',0,?)`);
    for (const uid of recipients) {
      const link = db.prepare('SELECT role FROM users WHERE id=?').get(uid)?.role === 'curator' ? '/curator/index.html#passwords' : '/admin/index.html#users';
      notify.run(`password_reset_${id}_${uid}`,uid,`Запрос восстановления доступа: ${user.name} (${user.login})`,link,now);
    }
  }
  res.json({ ok: true, message: 'Если аккаунт найден, заявка отправлена ответственному сотруднику' });
});

router.get('/password-reset/requests', authRequired, (req, res) => {
  if (!['admin','curator'].includes(req.user.role)) return res.status(403).json({ error: 'Недостаточно прав' });
  const params=[]; let scope='';
  if (req.user.role === 'curator') {
    scope='AND pr.branch_id IN (SELECT branch_id FROM curator_branches WHERE curator_id=?)'; params.push(req.user.id);
  }
  res.json(db.prepare(`SELECT pr.*,u.name,u.role,b.name branch_name FROM password_reset_requests pr
    LEFT JOIN users u ON u.id=pr.user_id LEFT JOIN branches b ON b.id=pr.branch_id
    WHERE pr.status='pending' ${scope} ORDER BY pr.requested_at DESC`).all(...params));
});

router.post('/password-reset/requests/:id/resolve', authRequired, async (req, res, next) => {
  try {
    if (!['admin','curator'].includes(req.user.role)) return res.status(403).json({ error: 'Недостаточно прав' });
    const row=db.prepare(`SELECT pr.*,u.login,u.name,u.role FROM password_reset_requests pr JOIN users u ON u.id=pr.user_id WHERE pr.id=?`).get(req.params.id);
    if (!row || row.status!=='pending') return res.status(404).json({ error: 'Активная заявка не найдена' });
    if (req.user.role==='curator') {
      const allowed=!!db.prepare('SELECT 1 FROM curator_branches WHERE curator_id=? AND branch_id=?').get(req.user.id,row.branch_id);
      if (!allowed || ['admin','curator'].includes(row.role)) return res.status(403).json({ error: 'Нет доступа к этому аккаунту' });
    }
    const password=temporaryPassword(), context=resetContext(row.user_id), now=Date.now();
    db.transaction(()=>{
      db.prepare('UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?').run(hashPassword(password),row.user_id);
      storeCredential({userId:row.user_id,login:row.login,password,kind:row.role,actorId:req.user.id});
      db.prepare("UPDATE password_reset_requests SET status='resolved',resolved_at=?,resolved_by=?,delivery_channel=? WHERE id=?")
        .run(now,req.user.id,context.phone?'whatsapp_or_copy':'copy',row.id);
    })();
    let delivered=false, deliveryError=null;
    if (context.phone) {
      try {
        await sendAccessMessage({phone:context.phone,studentName:row.name,parentName:context.name,credentials:[{kind:row.role,login:row.login,password}]});
        delivered=true;
      } catch (error) { deliveryError=error.message; }
    }
    res.json({ok:true,login:row.login,password,phone:context.phone||null,delivered,deliveryError});
  } catch (error) { next(error); }
});

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
  // A temporary password must never remain revealable after the owner changes it.
  db.prepare('UPDATE account_credentials SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(Date.now(), req.user.id);
  res.json({ ok: true });
});

module.exports = router;
