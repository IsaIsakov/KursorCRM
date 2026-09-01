/* ============================================================
   KURSOR — Управление пользователями: /api/users/*
   ============================================================ */
const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { authRequired, requireRole, hashPassword, revokeAllUserSessions } = require('./auth');
const { genId } = require('./util');
const { isAcceptablePassword } = require('./security-config');
const { accessibleStudentIds } = require('./access-scope');
const { z, id: idSchema, text, validateBody } = require('./validation');
const { AVATARS_DIR } = require('./avatar-storage');

const router = express.Router();
router.use(authRequired);

// Допустимые роли (CHECK на уровне БД снят — валидируем здесь)
const ROLES = ['admin', 'teacher', 'curator', 'student', 'parent'];
const roleSchema = z.enum(ROLES);
const languagesSchema = z.array(z.string().trim().min(1).max(50)).max(30);
const createUserSchema = z.strictObject({
  name: text(200), login: text(100), password: z.string().min(12).max(1024), role: roleSchema,
  age: z.coerce.number().int().min(0).max(130).optional(), group: z.coerce.number().int().min(0).max(1000000).optional(),
  languages: languagesSchema.optional(), teacher_id: idSchema.nullable().optional(), sipuni_extension: z.string().trim().max(30).nullable().optional(),
  mustChangePassword: z.boolean().optional(),
});
const updateUserSchema = z.strictObject({
  name: text(200).optional(), login: text(100).optional(), password: z.string().min(12).max(1024).optional(), role: roleSchema.optional(),
  age: z.coerce.number().int().min(0).max(130).optional(), group: z.coerce.number().int().min(0).max(1000000).optional(),
  languages: languagesSchema.optional(), teacher_id: idSchema.nullable().optional(), sipuni_extension: z.string().trim().max(30).nullable().optional(),
  mustChangePassword: z.boolean().optional(),
}).refine(v => Object.keys(v).length > 0, 'Нужно передать хотя бы одно поле');
const avatarSchema = z.strictObject({ dataUrl: z.string().min(32).max(3_000_000) });
const childrenSchema = z.strictObject({ children: z.array(idSchema).max(500) });

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
    avatar_url: row.avatar_url || null, sipuni_extension: row.sipuni_extension || null,
    mustChangePassword: !!row.must_change_password,
    createdAt: row.created_at,
  };
}

function randomId() {
  return genId('u');
}

function canEditAvatar(user, target) {
  if (!target) return false;
  if (user.id === target.id || user.role === 'admin') return true;
  if (target.role !== 'student') return false;
  if (user.role === 'teacher') {
    if (accessibleStudentIds(db, user).includes(target.id)) return true;
    return !!db.prepare(`
      SELECT 1
      FROM lesson_session_members lsm
      JOIN lesson_sessions ls ON ls.id=lsm.lesson_session_id
      WHERE lsm.student_id=? AND lsm.active=1
        AND (ls.scheduled_teacher_id=? OR ls.scheduled_assistant_id=?)
      LIMIT 1
    `).get(target.id, user.id, user.id);
  }
  if (user.role === 'curator') {
    return !!db.prepare(`
      SELECT 1 FROM students_crm sc
      JOIN curator_branches cb ON cb.branch_id=sc.branch_id
      WHERE sc.user_id=? AND cb.curator_id=?
    `).get(target.id, user.id);
  }
  return false;
}

function canViewAvatar(user, target) {
  if (!target || !user) return false;
  if (target.role !== 'student' || user.id === target.id || user.role === 'admin') return true;
  if (canEditAvatar(user, target)) return true;
  if (user.role === 'parent') return !!db.prepare('SELECT 1 FROM parent_children WHERE parent_id=? AND student_id=?').get(user.id, target.id);
  if (user.role === 'student') return !!db.prepare(`SELECT 1 FROM group_members mine JOIN group_members theirs ON theirs.group_id=mine.group_id
    WHERE mine.student_id=? AND theirs.student_id=? AND (mine.until IS NULL OR mine.until>=?) AND (theirs.until IS NULL OR theirs.until>=?) LIMIT 1`)
    .get(user.id, target.id, Date.now(), Date.now());
  return false;
}

function avatarFilename(url) {
  const value = String(url || '');
  const queryValue = /[?&]v=([^&]+)/.exec(value)?.[1];
  const filename = queryValue ? decodeURIComponent(queryValue) : path.basename(value);
  return /^[a-zA-Z0-9_-]+__\w+\.(png|jpg)$/.test(filename) ? filename : null;
}

router.get('/', (req, res) => {
  if (req.user.role === 'admin') {
    return res.json(db.prepare('SELECT * FROM users ORDER BY role, name').all().map(rowToUser));
  }
  const allowed = new Set([req.user.id, ...accessibleStudentIds(db, req.user)]);
  const rows = [...allowed].map(id => db.prepare('SELECT * FROM users WHERE id=?').get(id)).filter(Boolean);
  res.json(rows.map(rowToUser));
});

router.get('/students', requireRole('teacher', 'assistant', 'admin'), (req, res) => {
  let rows;
  if (req.user.role === 'admin') {
    rows = db.prepare("SELECT * FROM users WHERE role='student' ORDER BY name").all();
  } else {
    rows = accessibleStudentIds(db, req.user)
      .map(id => db.prepare("SELECT * FROM users WHERE id=? AND role='student'").get(id))
      .filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
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

router.get('/staff', requireRole('curator','admin'), (_req,res)=>{
  res.json(db.prepare("SELECT * FROM users WHERE role='teacher' ORDER BY name").all().map(rowToUser));
});

router.post('/', requireRole('admin'), validateBody(createUserSchema), (req, res) => {
  const { name, login, password, role, age, group, languages, teacher_id, sipuni_extension, mustChangePassword } = req.body || {};
  if (!name || !login || !password) return res.status(400).json({ error: 'Имя, логин, пароль обязательны' });
  if (!isAcceptablePassword(password)) return res.status(400).json({ error: 'Временный пароль должен содержать минимум 12 символов' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Некорректная роль' });

  const exists = db.prepare('SELECT 1 FROM users WHERE login = ?').get(String(login).trim());
  if (exists) return res.status(409).json({ error: 'Такой логин уже существует' });

  const id = randomId();
  db.prepare(`
    INSERT INTO users (id, login, password_hash, name, role, age, group_id, languages, teacher_id, must_change_password, created_at, sipuni_extension)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, String(login).trim(), hashPassword(password), String(name).trim(), role,
    parseInt(age) || 0, parseInt(group) || 0,
    JSON.stringify(Array.isArray(languages) ? languages : []),
    teacher_id || null, mustChangePassword ? 1 : 0, Date.now(), sipuni_extension || null
  );
  if (role === 'student') {
    db.prepare('INSERT OR IGNORE INTO progress (user_id, points, streak, badges) VALUES (?, 0, 0, \'["beginner"]\')').run(id);
  }
  res.status(201).json(rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
});

router.put('/:id', validateBody(updateUserSchema), (req, res) => {
  const targetId = req.params.id;
  const isAdmin = req.user.role === 'admin';
  const isSelf = req.user.id === targetId;
  if (!isAdmin && !isSelf) return res.status(403).json({ error: 'Можно править только свой профиль' });

  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!cur) return res.status(404).json({ error: 'Пользователь не найден' });

  const { name, password, age, group, languages, role, teacher_id, login, sipuni_extension, mustChangePassword } = req.body || {};
  if (!isAdmin && password) return res.status(400).json({ error: 'Используйте защищённую форму смены пароля' });
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
    patch.sipuni_extension = sipuni_extension !== undefined ? (sipuni_extension || null) : cur.sipuni_extension;
  } else {
    patch.role = cur.role;
    patch.login = cur.login;
    patch.teacher_id = cur.teacher_id;
    patch.sipuni_extension = cur.sipuni_extension;
  }

  if (password && !isAcceptablePassword(password)) return res.status(400).json({ error: 'Временный пароль должен содержать минимум 12 символов' });
  const passwordHash = password ? hashPassword(password) : cur.password_hash;
  const nextMustChangePassword = mustChangePassword !== undefined
    ? (mustChangePassword ? 1 : 0)
    : (password ? 0 : (cur.must_change_password || 0));

  db.prepare(`
    UPDATE users SET login=?, password_hash=?, name=?, role=?, age=?, group_id=?, languages=?, teacher_id=?, must_change_password=?, sipuni_extension=?
    WHERE id=?
  `).run(patch.login, passwordHash, patch.name, patch.role, patch.age, patch.group_id, patch.languages, patch.teacher_id, nextMustChangePassword, patch.sipuni_extension, targetId);
  if (password || patch.role !== cur.role || patch.login !== cur.login) revokeAllUserSessions(targetId);

  res.json(rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(targetId)));
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Нельзя удалить себя' });
  // Чистим файл аватарки
  try {
    const u = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(req.params.id);
    if (u && u.avatar_url) {
      const filename = avatarFilename(u.avatar_url);
      const f = filename ? path.join(AVATARS_DIR, filename) : '';
      if (f.startsWith(AVATARS_DIR) && fs.existsSync(f)) fs.unlinkSync(f);
    }
  } catch {}
  const info = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Не найден' });
  res.json({ ok: true });
});

/* ============================================================
   АВАТАРКИ: владелец, администратор, назначенный преподаватель
   или куратор филиала ученика.
   POST /api/users/:id/avatar   — боди { dataUrl: "data:image/png;base64,..." }
   DELETE /api/users/:id/avatar — удалить
   ============================================================ */
router.post('/:id/avatar', validateBody(avatarSchema), (req, res) => {
  const target = db.prepare('SELECT id,role FROM users WHERE id=?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (!canEditAvatar(req.user, target)) return res.status(403).json({ error: 'Нет права менять фото этого ученика' });
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
  const avatarUrl = `/api/users/${encodeURIComponent(req.params.id)}/avatar-file?v=${encodeURIComponent(filename)}`;
  db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, req.params.id);
  res.json({ ok: true, avatar_url: avatarUrl, user: rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)) });
});

router.delete('/:id/avatar', (req, res) => {
  const target = db.prepare('SELECT id,role FROM users WHERE id=?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (!canEditAvatar(req.user, target)) return res.status(403).json({ error: 'Нет права удалить фото этого ученика' });
  const cur = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(req.params.id);
  if (cur && cur.avatar_url) {
    const filename = avatarFilename(cur.avatar_url);
    const f = filename ? path.join(AVATARS_DIR, filename) : '';
    if (f.startsWith(AVATARS_DIR) && fs.existsSync(f)) { try { fs.unlinkSync(f); } catch {} }
  }
  db.prepare('UPDATE users SET avatar_url = NULL WHERE id = ?').run(req.params.id);
  res.json({ ok: true, user: rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)) });
});

router.get('/:id/avatar-file', (req, res) => {
  const target = db.prepare('SELECT id,role,avatar_url FROM users WHERE id=?').get(req.params.id);
  if (!target?.avatar_url) return res.status(404).json({ error: 'Фото не найдено' });
  if (!canViewAvatar(req.user, target)) return res.status(403).json({ error: 'Нет доступа к фото' });
  const filename = avatarFilename(target.avatar_url);
  if (!filename) return res.status(404).json({ error: 'Фото не найдено' });
  const full = path.join(AVATARS_DIR, filename);
  if (!full.startsWith(AVATARS_DIR + path.sep) || !fs.existsSync(full)) return res.status(404).json({ error: 'Фото не найдено' });
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type(path.extname(filename));
  res.sendFile(full);
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
router.put('/:id/children', requireRole('admin'), validateBody(childrenSchema), (req, res) => {
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
        const linkId = genId('pc');
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
