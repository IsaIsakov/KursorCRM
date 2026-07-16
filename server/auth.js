/* ============================================================
   KURSOR — Аутентификация: JWT + middleware ролей
   ============================================================ */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
const crypto = require('crypto');

// A fallback exists only so local development remains one-command. index.js
// refuses to start production with it.
const SECRET = process.env.JWT_SECRET || 'kursor-local-jwt-secret-not-for-production';
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SESSION_COOKIE = IS_PRODUCTION ? '__Host-kursor_session' : 'kursor_session';
const CSRF_COOKIE = IS_PRODUCTION ? '__Host-kursor_csrf' : 'kursor_csrf';
const SESSION_MAX_AGE = Math.min(30 * 86400000, Math.max(5 * 60000, Number(process.env.SESSION_MAX_AGE_MS) || 7 * 86400000));

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

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, login: user.login, name: user.name },
    SECRET,
    { expiresIn: EXPIRES_IN }
  );
}

function verifyToken(token) {
  try { return jwt.verify(token, SECRET); } catch { return null; }
}

function hashPassword(plain) { return bcrypt.hashSync(plain, 10); }
function checkPassword(plain, hash) { return bcrypt.compareSync(plain, hash); }

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
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Не авторизован' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Недостаточно прав' });
    next();
  };
}

module.exports = { signToken, verifyToken, hashPassword, checkPassword, authRequired, requireRole,
  issueSession, clearSession, tokenFromCookie, parseCookies, SESSION_COOKIE, CSRF_COOKIE };
