/* ============================================================
   KURSOR — Управление пользователями: /api/users/*
   ============================================================ */
const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { authRequired, requireRole, hashPassword } = require('./auth');

const router = express.Router();
router.use(authRequired);

// Допустимые роли (CHECK на уровне БД снят — валидируем здесь)
const ROLES = ['admin', 'teacher', 'assistant', 'student', 'parent'];

const AVATARS_DIR = path.join(__dirname, '..', 'public', 'uploads', 'avatars');
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB

function detectImageExt(buf) {
  // PNG или JPEG по магическим байтам — не доверяем MIME от клиента
  if (buf.length < 8) return null;
  if (buf[0]===0x89 && buf[1]===0x50 && buf[2]===0x4E && buf[3]===0x47) return 'png';
  if (buf[0]===0xFF && buf[1]===0xD8 && buf[2]===0xFF) return 'jpg';
  return null;
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id, login: row.login, name: row.name, role: row.role,
    age: row.age, group: row.group_id,
    languages: JSON.parse(row.languages || '[]'),
    teacher_id: row.teacher_id,
    avatar_url: row.avatar_url || null,
    createdAt: row.created_at,
  };
}

function randomId() {
  return `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

router.get('/', (req, res) => {
  if (req.user.role === 'student') {
    return res.json([rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id))]);
  }
  const rows = db.prepare('SELECT * FROM users ORDER BY role, name').all();
  res.json(rows.map(rowToUser));
});

router.get('/students', requireRole('teacher', 'admin'), (req, res) => {
  let rows;
  if (req.user.role === 'teacher') {
    rows = db.prepare(`
      SELECT * FROM users
      WHERE role='student' AND (teacher_id IS NULL OR teacher_id = ?)
      ORDER BY name
    `).all(req.user.id);
  } else {
    rows = db.prepare("SELECT * FROM users WHERE role='student' ORDER BY name").all();
  }
  const q = (req.query.q || '').toString().trim().toLowerCase();
  if (q) {
    // Фильтруем в JS, а не через SQL LIKE: LIKE в SQLite не складывает регистр
    // для кириллицы, поэтому поиск "алия" не находил бы "Алия" в базе.
    rows = rows.filter(r =>
      (r.name || '').toLowerCase().includes(q) || (r.login || '').toLowerCase().includes(q)
    ).slice(0, 25);
  }
  res.json(rows.map(rowToUser));
});

router.post('/', requireRole('admin'), (req, res) => {
  const { name, login, password, role, age, group, languages, teacher_id } = req.body || {};
  if (!name || !login || !password) return res.status(400).json({ error: 'Имя, логин, пароль обязательны' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Некорректная роль' });

  const exists = db.prepare('SELECT 1 FROM users WHERE login = ?').get(String(login).trim());
  if (exists) return res.status(409).json({ error: 'Такой логин уже существует' });

  const id = randomId();
  db.prepare(`
    INSERT INTO users (id, login, password_hash, name, role, age, group_id, languages, teacher_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, String(login).trim(), hashPassword(password), String(name).trim(), role,
    parseInt(age) || 0, parseInt(group) || 0,
    JSON.stringify(Array.isArray(languages) ? languages : []),
    teacher_id || null, Date.now()
  );
  if (role === 'student') {
    db.prepare('INSERT OR IGNORE INTO progress (user_id, points, streak, badges) VALUES (?, 0, 0, \'["beginner"]\')').run(id);
  }
  res.status(201).json(rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
});

router.put('/:id', (req, res) => {
  const targetId = req.params.id;
  const isAdmin = req.user.role === 'admin';
  const isSelf = req.user.id === targetId;
  if (!isAdmin && !isSelf) return res.status(403).json({ error: 'Можно править только свой профиль' });

  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!cur) return res.status(404).json({ error: 'Пользователь не найден' });

  const { name, password, age, group, languages, role, teacher_id, login } = req.body || {};
  const patch = {
    name: name !== undefined ? String(name).trim() : cur.name,
    age: age !== undefined ? (parseInt(age) || 0) : cur.age,
    group_id: group !== undefined ? (parseInt(group) || 0) : cur.group_id,
    languages: languages !== undefined ? JSON.stringify(Array.isArray(languages) ? languages : []) : cur.languages,
  };
  if (isAdmin) {
    patch.role = (role && ROLES.includes(role)) ? role : cur.role;
    if (login !== undefined) {
      const newLogin = String(login).trim();
      if (newLogin !== cur.login) {
        const dup = db.prepare('SELECT 1 FROM users WHERE login = ? AND id != ?').get(newLogin, targetId);
        if (dup) return res.status(409).json({ error: 'Логин занят' });
        patch.login = newLogin;
      } else patch.login = cur.login;
    } else patch.login = cur.login;
    patch.teacher_id = teacher_id !== undefined ? (teacher_id || null) : cur.teacher_id;
  } else {
    patch.role = cur.role;
    patch.login = cur.login;
    patch.teacher_id = cur.teacher_id;
  }

  const passwordHash = password ? hashPassword(password) : cur.password_hash;

  db.prepare(`
    UPDATE users SET login=?, password_hash=?, name=?, role=?, age=?, group_id=?, languages=?, teacher_id=?
    WHERE id=?
  `).run(patch.login, passwordHash, patch.name, patch.role, patch.age, patch.group_id, patch.languages, patch.teacher_id, targetId);

  res.json(rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(targetId)));
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Нельзя удалить себя' });
  // Чистим файл аватарки
  try {
    const u = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(req.params.id);
    if (u && u.avatar_url) {
      const f = path.join(AVATARS_DIR, path.basename(u.avatar_url));
      if (f.startsWith(AVATARS_DIR) && fs.existsSync(f)) fs.unlinkSync(f);
    }
  } catch {}
  const info = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Не найден' });
  res.json({ ok: true });
});

/* ============================================================
   АВАТАРКИ: менять может ТОЛЬКО владелец аккаунта.
   POST /api/users/:id/avatar   — боди { dataUrl: "data:image/png;base64,..." }
   DELETE /api/users/:id/avatar — удалить
   ============================================================ */
router.post('/:id/avatar', (req, res) => {
  if (req.user.id !== req.params.id) {
    return res.status(403).json({ error: 'Менять аватарку может только владелец аккаунта' });
  }
  const { dataUrl } = req.body || {};
  if (!dataUrl || typeof dataUrl !== 'string') {
    return res.status(400).json({ error: 'Ожидается dataUrl' });
  }
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return res.status(400).json({ error: 'Разрешены только PNG/JPG (data URL)' });

  let buf;
  try { buf = Buffer.from(m[2], 'base64'); }
  catch { return res.status(400).json({ error: 'Некорректный base64' }); }
  if (!buf.length) return res.status(400).json({ error: 'Пустой файл' });
  if (buf.length > MAX_AVATAR_BYTES) {
    return res.status(413).json({ error: 'Файл больше 2 МБ' });
  }
  const ext = detectImageExt(buf);
  if (!ext) return res.status(400).json({ error: 'Это не PNG и не JPG' });

  const safeId = String(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  // Чистим старые файлы этого юзера
  try {
    for (const f of fs.readdirSync(AVATARS_DIR)) {
      if (f.startsWith(safeId + '__')) {
        try { fs.unlinkSync(path.join(AVATARS_DIR, f)); } catch {}
      }
    }
  } catch {}
  const filename = `${safeId}__${Date.now().toString(36)}.${ext}`;
  fs.writeFileSync(path.join(AVATARS_DIR, filename), buf);
  const avatarUrl = `/uploads/avatars/${filename}`;
  db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, req.params.id);
  res.json({ ok: true, avatar_url: avatarUrl, user: rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)) });
});

router.delete('/:id/avatar', (req, res) => {
  if (req.user.id !== req.params.id) {
    return res.status(403).json({ error: 'Удалить аватарку может только владелец аккаунта' });
  }
  const cur = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(req.params.id);
  if (cur && cur.avatar_url) {
    const f = path.join(AVATARS_DIR, path.basename(cur.avatar_url));
    if (f.startsWith(AVATARS_DIR) && fs.existsSync(f)) { try { fs.unlinkSync(f); } catch {} }
  }
  db.prepare('UPDATE users SET avatar_url = NULL WHERE id = ?').run(req.params.id);
  res.json({ ok: true, user: rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)) });
});


// -------- Привязка родитель ↔ дети --------

// GET /api/users/:id/children — список детей родителя
router.get('/:id/children', requireRole('admin'), (req, res) => {
  const rows = db.prepare(
    'SELECT student_id FROM parent_children WHERE parent_id = ?'
  ).all(req.params.id);
  res.json(rows.map(r => r.student_id));
});

// PUT /api/users/:id/children — установить список детей (заменяет всё)
router.put('/:id/children', requireRole('admin'), (req, res) => {
  const parentId = req.params.id;
  const parent = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'parent'").get(parentId);
  if (!parent) return res.status(400).json({ error: 'Пользователь не является родителем' });

  const { children } = req.body; // массив student_id
  if (!Array.isArray(children)) return res.status(400).json({ error: 'children должен быть массивом' });

  // Убираем дубликаты id, чтобы не плодить лишние строки связи
  const uniqueChildren = [...new Set(children)];

  const insertLink = db.prepare(
    'INSERT OR IGNORE INTO parent_children (id, parent_id, student_id, since) VALUES (?, ?, ?, ?)'
  );
  const upsert = db.transaction(() => {
    db.prepare('DELETE FROM parent_children WHERE parent_id = ?').run(parentId);
    for (const sid of uniqueChildren) {
      const student = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'student'").get(sid);
      if (student) {
        const linkId = `pc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        insertLink.run(linkId, parentId, sid, Date.now());
      }
    }
  });
  upsert();
  res.json({ ok: true });
});

// GET /api/users/:id/parents — список родителей ученика
router.get('/:id/parents', requireRole('admin'), (req, res) => {
  const rows = db.prepare(
    'SELECT parent_id FROM parent_children WHERE student_id = ?'
  ).all(req.params.id);
  res.json(rows.map(r => r.parent_id));
});

module.exports = router;
