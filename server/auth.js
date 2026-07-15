/* ============================================================
   KURSOR — Аутентификация: JWT + middleware ролей
   ============================================================ */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const SECRET = process.env.JWT_SECRET || 'change-me';
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

if (SECRET === 'change-me' || SECRET.length < 16) {
  console.warn('⚠️  JWT_SECRET слишком короткий или дефолтный! Установи длинный секрет в .env');
}

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
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Не авторизован' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Токен недействителен или истёк' });
  const user = db.prepare('SELECT id, login, name, role, age, group_id, languages, teacher_id, avatar_url FROM users WHERE id = ?').get(payload.sub);
  if (!user) return res.status(401).json({ error: 'Пользователь больше не существует' });
  req.user = {
    ...user,
    group: user.group_id,
    languages: JSON.parse(user.languages || '[]'),
    avatar_url: user.avatar_url || null,
  };
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Не авторизован' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Недостаточно прав' });
    next();
  };
}

module.exports = { signToken, verifyToken, hashPassword, checkPassword, authRequired, requireRole };
