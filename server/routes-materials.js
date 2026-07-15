/* ============================================================
   KURSOR — Материалы курса + временный доступ учителей.
   /api/materials, /api/teacher-course-access
   ============================================================ */
const express = require('express');
const db = require('./db');
const { authRequired, requireRole } = require('./auth');
const { genId } = require('./util');
const { hasPermission } = require('./permissions');
const storage = require('./storage');

const MAT_MAX_BYTES = 50 * 1024 * 1024; // 50 МБ на файл материала
// Разрешённые расширения для загружаемых файлов материалов
const MAT_EXT = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'text/plain': 'txt', 'application/zip': 'zip',
};

// Декодирует dataUrl и сохраняет файл материала. Возвращает публичный URL.
function saveMaterialFile(dataUrl, matId, fileName) {
  const m = /^data:([\w.+/-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) throw { code: 400, msg: 'Ожидается dataUrl с base64-содержимым файла' };
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch { throw { code: 400, msg: 'Некорректный base64' }; }
  if (!buf.length) throw { code: 400, msg: 'Пустой файл' };
  if (buf.length > MAT_MAX_BYTES) throw { code: 413, msg: 'Файл больше 50 МБ' };
  const mime = m[1];
  // расширение: по mime, иначе по имени файла, иначе bin
  let ext = MAT_EXT[mime];
  if (!ext && fileName && /\.([a-z0-9]{1,8})$/i.test(fileName)) ext = fileName.split('.').pop().toLowerCase();
  ext = (ext || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  const rel = `materials/${matId}.${ext}`;
  return storage.saveFile(buf, rel);
}

const router = express.Router();
router.use(authRequired);

function rowToMaterial(r) {
  return {
    id: r.id, courseId: r.course_id, type: r.type, title: r.title,
    content: r.content || '', createdBy: r.created_by, createdAt: r.created_at,
    courseTitle: r.course_title || null,
  };
}

function rowToAccess(r) {
  return {
    id: r.id, teacherId: r.teacher_id, teacherName: r.teacher_name || null,
    courseId: r.course_id, courseTitle: r.course_title || null,
    grantedAt: r.granted_at, expiresAt: r.expires_at, grantedBy: r.granted_by,
    active: r.expires_at > Date.now(),
  };
}

// Есть ли у учителя активный доступ к курсу прямо сейчас
function teacherHasActiveAccess(teacherId, courseId) {
  const row = db.prepare(`
    SELECT 1 FROM teacher_course_access
    WHERE teacher_id = ? AND course_id = ? AND expires_at > ?
    LIMIT 1
  `).get(teacherId, courseId, Date.now());
  return !!row;
}

/* ---------------- МАТЕРИАЛЫ ---------------- */

// GET /api/materials  (?course_id=)
//  admin — все; teacher/assistant — только курсы с активным доступом.
router.get('/materials', (req, res) => {
  const { course_id } = req.query;
  let rows;
  if (req.user.role === 'admin') {
    rows = course_id
      ? db.prepare(`SELECT m.*, mod.title AS course_title FROM materials m LEFT JOIN modules mod ON mod.id=m.course_id WHERE m.course_id = ? ORDER BY m.created_at DESC`).all(course_id)
      : db.prepare(`SELECT m.*, mod.title AS course_title FROM materials m LEFT JOIN modules mod ON mod.id=m.course_id ORDER BY m.created_at DESC`).all();
  } else if (req.user.role === 'teacher' || req.user.role === 'assistant') {
    // только курсы с активным доступом
    rows = db.prepare(`
      SELECT m.*, mod.title AS course_title FROM materials m
      LEFT JOIN modules mod ON mod.id = m.course_id
      WHERE m.course_id IN (
        SELECT course_id FROM teacher_course_access WHERE teacher_id = ? AND expires_at > ?
      )
      ${course_id ? 'AND m.course_id = ?' : ''}
      ORDER BY m.created_at DESC
    `).all(...(course_id ? [req.user.id, Date.now(), course_id] : [req.user.id, Date.now()]));
  } else {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  res.json(rows.map(rowToMaterial));
});

router.post('/materials', (req, res) => {
  const { courseId, type, title, content, dataUrl, fileName } = req.body || {};
  if (!['admin', 'teacher', 'assistant'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  if (!courseId || !title || !['presentation', 'task', 'text', 'file'].includes(type)) {
    return res.status(400).json({ error: 'courseId, корректный type и title обязательны' });
  }
  // teacher может создавать только если есть активный доступ + право edit_materials
  if (req.user.role !== 'admin') {
    if (!hasPermission(req.user, 'edit_materials')) return res.status(403).json({ error: 'Нет права редактировать материалы' });
    if (!teacherHasActiveAccess(req.user.id, courseId)) return res.status(403).json({ error: 'Нет активного доступа к этому курсу' });
  }
  const course = db.prepare('SELECT id FROM modules WHERE id = ?').get(courseId);
  if (!course) return res.status(404).json({ error: 'Курс (модуль) не найден' });

  const id = genId('mat');
  // Если передан файл (dataUrl) — сохраняем его и кладём публичный URL в content.
  let finalContent = content || '';
  if (dataUrl) {
    try { finalContent = saveMaterialFile(dataUrl, id, fileName); }
    catch (e) { return res.status(e.code || 400).json({ error: e.msg || 'Ошибка загрузки файла' }); }
  }
  db.prepare(`
    INSERT INTO materials (id, course_id, type, title, content, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, courseId, type, String(title).trim(), finalContent, req.user.id, Date.now());
  res.status(201).json(rowToMaterial(db.prepare('SELECT * FROM materials WHERE id = ?').get(id)));
});

router.put('/materials/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Не найден' });
  if (req.user.role !== 'admin') {
    if (!hasPermission(req.user, 'edit_materials')) return res.status(403).json({ error: 'Нет права редактировать материалы' });
    if (!teacherHasActiveAccess(req.user.id, cur.course_id)) return res.status(403).json({ error: 'Нет активного доступа к этому курсу' });
  }
  const { type, title, content, dataUrl, fileName } = req.body || {};
  let finalContent = content !== undefined ? content : cur.content;
  if (dataUrl) {
    try { finalContent = saveMaterialFile(dataUrl, req.params.id, fileName); }
    catch (e) { return res.status(e.code || 400).json({ error: e.msg || 'Ошибка загрузки файла' }); }
  }
  db.prepare(`UPDATE materials SET type=?, title=?, content=? WHERE id=?`).run(
    type && ['presentation', 'task', 'text', 'file'].includes(type) ? type : cur.type,
    title !== undefined ? String(title).trim() : cur.title,
    finalContent,
    req.params.id
  );
  res.json(rowToMaterial(db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id)));
});

router.delete('/materials/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Не найден' });
  if (req.user.role !== 'admin') {
    if (!hasPermission(req.user, 'edit_materials')) return res.status(403).json({ error: 'Нет права редактировать материалы' });
    if (!teacherHasActiveAccess(req.user.id, cur.course_id)) return res.status(403).json({ error: 'Нет активного доступа к этому курсу' });
  }
  db.prepare('DELETE FROM materials WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------------- ДОСТУП УЧИТЕЛЕЙ К КУРСАМ ---------------- */

// Список выдач доступа (admin) или свои (teacher)
router.get('/teacher-course-access', (req, res) => {
  let rows;
  if (req.user.role === 'admin') {
    rows = db.prepare(`
      SELECT a.*, u.name AS teacher_name, m.title AS course_title
      FROM teacher_course_access a
      LEFT JOIN users u ON u.id = a.teacher_id
      LEFT JOIN modules m ON m.id = a.course_id
      ORDER BY a.expires_at DESC
    `).all();
  } else {
    rows = db.prepare(`
      SELECT a.*, u.name AS teacher_name, m.title AS course_title
      FROM teacher_course_access a
      LEFT JOIN users u ON u.id = a.teacher_id
      LEFT JOIN modules m ON m.id = a.course_id
      WHERE a.teacher_id = ?
      ORDER BY a.expires_at DESC
    `).all(req.user.id);
  }
  res.json(rows.map(rowToAccess));
});

router.post('/teacher-course-access', requireRole('admin'), (req, res) => {
  const { teacherId, courseId, expiresAt } = req.body || {};
  if (!teacherId || !courseId || !expiresAt) {
    return res.status(400).json({ error: 'teacherId, courseId, expiresAt обязательны' });
  }
  const exp = Number(expiresAt);
  if (!Number.isFinite(exp)) return res.status(400).json({ error: 'expiresAt — это timestamp (мс)' });
  const id = genId('tca');
  db.prepare(`
    INSERT INTO teacher_course_access (id, teacher_id, course_id, granted_at, expires_at, granted_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, teacherId, courseId, Date.now(), exp, req.user.id);
  const row = db.prepare(`
    SELECT a.*, u.name AS teacher_name, m.title AS course_title
    FROM teacher_course_access a
    LEFT JOIN users u ON u.id = a.teacher_id
    LEFT JOIN modules m ON m.id = a.course_id WHERE a.id = ?`).get(id);
  res.status(201).json(rowToAccess(row));
});

// Изменить срок (продлить / закрыть досрочно) — запись не удаляется
router.put('/teacher-course-access/:id', requireRole('admin'), (req, res) => {
  const cur = db.prepare('SELECT * FROM teacher_course_access WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Не найдено' });
  const { expiresAt } = req.body || {};
  const exp = Number(expiresAt);
  if (!Number.isFinite(exp)) return res.status(400).json({ error: 'expiresAt — это timestamp (мс)' });
  db.prepare('UPDATE teacher_course_access SET expires_at = ? WHERE id = ?').run(exp, req.params.id);
  const row = db.prepare(`
    SELECT a.*, u.name AS teacher_name, m.title AS course_title
    FROM teacher_course_access a
    LEFT JOIN users u ON u.id = a.teacher_id
    LEFT JOIN modules m ON m.id = a.course_id WHERE a.id = ?`).get(req.params.id);
  res.json(rowToAccess(row));
});

router.delete('/teacher-course-access/:id', requireRole('admin'), (req, res) => {
  const info = db.prepare('DELETE FROM teacher_course_access WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

module.exports = router;
module.exports.teacherHasActiveAccess = teacherHasActiveAccess;
