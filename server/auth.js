/* ============================================================
   KURSOR — Аутентификация: JWT + middleware ролей
   ============================================================ */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
const crypto = require('crypto');
const { sourceHash } = require('./audit-utils');
const requestLimits = require('./request-limits');

// A fallback exists only so local development remains one-command. index.js
// refuses to start production with it.
const SECRET = process.env.JWT_SECRET || 'kursor-local-jwt-secret-not-for-production';
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SESSION_COOKIE = IS_PRODUCTION ? '__Host-kursor_session' : 'kursor_session';
const CSRF_COOKIE = IS_PRODUCTION ? '__Host-kursor_csrf' : 'kursor_csrf';
const SESSION_MAX_AGE = Math.min(30 * 86400000, Math.max(5 * 60000, Number(process.env.SESSION_MAX_AGE_MS) || 7 * 86400000));
const SESSION_IDLE_TIMEOUT = Math.min(7 * 86400000, Math.max(15 * 60000, Number(process.env.SESSION_IDLE_TIMEOUT_MS) || 12 * 60 * 60 * 1000));
const STAFF_IDLE_TIMEOUT = Math.min(24 * 60 * 60 * 1000, Math.max(15 * 60000, Number(process.env.STAFF_SESSION_IDLE_TIMEOUT_MS) || 2 * 60 * 60 * 1000));
const JWT_ISSUER = 'kursor';
const JWT_AUDIENCE = 'kursor-web';
const MAX_ACTIVE_SESSIONS = Math.min(20, Math.max(1, Number(process.env.MAX_ACTIVE_SESSIONS) || 5));

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    try { out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim()); } catch {}
  }
  return out;
}

function cookieLine(name, value, { httpOnly = false, maxAge = SESSION_MAX_AGE } = {}) {
  const attrs = [`${name}=${encodeURIComponent(value)}`, 'Path=/', `Max-Age=${Math.floor(maxAge / 1000)}`, 'SameSite=Strict'];
  if (httpOnly) attrs.push('HttpOnly');
  if (IS_PRODUCTION) attrs.push('Secure');
  return attrs.join('; ');
}

function issueSession(res, token) {
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  res.setHeader('Set-Cookie', [cookieLine(SESSION_COOKIE, token, { httpOnly: true }), cookieLine(CSRF_COOKIE, csrfToken)]);
  return csrfToken;
}

function clearSession(res) {
  res.setHeader('Set-Cookie', [cookieLine(SESSION_COOKIE, '', { httpOnly: true, maxAge: 0 }), cookieLine(CSRF_COOKIE, '', { maxAge: 0 })]);
}

function tokenFromCookie(header) { return parseCookies(header)[SESSION_COOKIE] || null; }

function sessionFingerprint(value) {
  return value ? crypto.createHmac('sha256', SECRET).update(String(value)).digest('hex') : null;
}

function signToken(user, context = {}) {
  const now = Date.now();
  const id = crypto.randomUUID();
  const idleMs = ['admin', 'teacher', 'curator'].includes(user.role) ? STAFF_IDLE_TIMEOUT : SESSION_IDLE_TIMEOUT;
  const absoluteExpiresAt = now + SESSION_MAX_AGE;
  db.transaction(() => {
    db.prepare(`INSERT INTO auth_sessions
      (id,user_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at,source_hash,user_agent_hash)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      id, user.id, now, now, Math.min(absoluteExpiresAt, now + idleMs), absoluteExpiresAt,
      context.source ? sourceHash(context.source) : null, sessionFingerprint(context.userAgent),
    );
    const active = db.prepare(`SELECT id FROM auth_sessions WHERE user_id=? AND revoked_at IS NULL
      ORDER BY created_at DESC`).all(user.id);
    const revoke = db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL');
    active.slice(MAX_ACTIVE_SESSIONS).forEach(row => revoke.run(now, row.id));
    db.prepare('DELETE FROM auth_sessions WHERE absolute_expires_at<? OR (revoked_at IS NOT NULL AND revoked_at<?)')
      .run(now - 86400000, now - 30 * 86400000);
  })();
  return jwt.sign(
    { sub: user.id, jti: id }, SECRET,
    { algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: EXPIRES_IN }
  );
}

function verifyToken(token, { touch = true } = {}) {
  try {
    const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
    if (!payload.jti || !payload.sub) return null;
    const now = Date.now();
    const session = db.prepare(`SELECT * FROM auth_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL
      AND idle_expires_at>? AND absolute_expires_at>?`).get(payload.jti, payload.sub, now, now);
    if (!session) return null;
    if (touch && session.last_seen_at < now - 60_000) {
      const user = db.prepare('SELECT role FROM users WHERE id=?').get(payload.sub);
      const idleMs = ['admin', 'teacher', 'curator'].includes(user?.role) ? STAFF_IDLE_TIMEOUT : SESSION_IDLE_TIMEOUT;
      db.prepare('UPDATE auth_sessions SET last_seen_at=?,idle_expires_at=? WHERE id=?')
        .run(now, Math.min(session.absolute_expires_at, now + idleMs), session.id);
    }
    return payload;
  } catch { return null; }
}

function revokeToken(token, now = Date.now()) {
  try {
    const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE, ignoreExpiration: true });
    if (payload.jti) db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(now, payload.jti);
  } catch {}
}

function revokeAllUserSessions(userId, now = Date.now(), exceptSessionId = null) {
  if (exceptSessionId) {
    return db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND id<>? AND revoked_at IS NULL')
      .run(now, userId, exceptSessionId).changes;
  }
  return db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(now, userId).changes;
}

function hashPassword(plain) {
  const rounds = Math.min(14, Math.max(11, Number(process.env.BCRYPT_COST) || 12));
  return bcrypt.hashSync(plain, rounds);
}
function checkPassword(plain, hash) { return bcrypt.compareSync(plain, hash); }
function needsPasswordRehash(hash) {
  try { return bcrypt.getRounds(hash) < Math.min(14, Math.max(11, Number(process.env.BCRYPT_COST) || 12)); }
  catch { return true; }
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const cookieToken = tokenFromCookie(req.headers.cookie);
  const bearerAllowed = !IS_PRODUCTION || process.env.API_AUTH_BEARER === 'true';
  const bearerToken = bearerAllowed && header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = cookieToken || bearerToken;
  if (!token) return res.status(401).json({ error: 'Не авторизован' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Токен недействителен или истёк' });
  const user = db.prepare('SELECT id, login, name, role, age, group_id, languages, teacher_id, avatar_url, must_change_password FROM users WHERE id = ?').get(payload.sub);
  if (!user) return res.status(401).json({ error: 'Пользователь больше не существует' });
  req.user = {
    ...user,
    group: user.group_id,
    languages: JSON.parse(user.languages || '[]'),
    avatar_url: user.avatar_url || null,
    mustChangePassword: !!user.must_change_password,
  };
  req.sessionId = payload.jti;
  req.authMethod = cookieToken ? 'cookie' : 'bearer';
  if (cookieToken && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const cookies = parseCookies(req.headers.cookie);
    const supplied = String(req.headers['x-csrf-token'] || '');
    const expected = String(cookies[CSRF_COOKIE] || '');
    const valid = supplied.length === expected.length && supplied.length >= 32 && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
    if (!valid) return res.status(403).json({ error: 'CSRF-проверка не пройдена', code: 'CSRF_INVALID' });
  }
  const requestPath = req.originalUrl.split('?')[0];
  const passwordChangeRoute = requestPath === '/api/auth/change-password' || requestPath === '/api/auth/me' || requestPath === '/api/auth/logout';
  if (req.user.mustChangePassword && !passwordChangeRoute) {
    return res.status(403).json({ error: 'Сначала смените временный пароль', code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  const rate = requestLimits.userRequest(req);
  res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfter));
    return res.status(429).json({ error: 'Слишком много запросов. Повторите позже', code: 'RATE_LIMITED' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Не авторизован' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Недостаточно прав' });
    next();
  };
}

module.exports = { signToken, verifyToken, hashPassword, checkPassword, needsPasswordRehash, authRequired, requireRole,
  issueSession, clearSession, tokenFromCookie, parseCookies, revokeToken, revokeAllUserSessions,
  SESSION_COOKIE, CSRF_COOKIE, SESSION_MAX_AGE, SESSION_IDLE_TIMEOUT, STAFF_IDLE_TIMEOUT };
