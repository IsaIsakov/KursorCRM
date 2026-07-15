/* ============================================================
   KURSOR — Видеоотчёты и файлы работ: /api/session-artifacts
   video → expires_at = created_at + 30 дней (автоудаление).
   screenshot/file/link → хранятся постоянно.
   ============================================================ */
const express = require('express');
const db = require('./db');
const { authRequired } = require('./auth');
const { genId } = require('./util');
const { hasPermission } = require('./permissions');
const storage = require('./storage');

const router = express.Router();
router.use(authRequired);

const VIDEO_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней
const MAX_BYTES = 50 * 1024 * 1024;            // 50 МБ на файл (base64)

function canManageGroup(user, groupId) {
  if (user.role === 'admin') return true;
  if (!['teacher', 'assistant'].includes(user.role)) return false;
  const g = db.prepare('SELECT teacher_id, assistant_id FROM groups WHERE id = ?').get(groupId);
  return g && (g.teacher_id === user.id || g.assistant_id === user.id);
}

function rowToArtifact(r) {
  const o = {
    id: r.id, lessonSessionId: r.lesson_session_id, studentId: r.student_id,
    type: r.type, title: r.title || null, createdAt: r.created_at,
    expiresAt: r.expires_at || null, deleted: !!r.deleted,
    sessionDate: r.session_date || null, topic: r.topic || null,
  };
  if (r.deleted) {
    o.url = null;
    o.unavailable = r.type === 'video' ? 'Видео больше не доступно (срок хранения истёк)' : 'Файл удалён';
  } else {
    o.url = r.url || (r.file_path ? storage.getUrl(r.file_path) : null);
  }
  return o;
}

// GET /api/session-artifacts?student_id=&lesson_session_id=
router.get('/', (req, res) => {
  const { student_id, lesson_session_id } = req.query;
  const where = []; const params = [];
  if (student_id) { where.push('sa.student_id = ?'); params.push(student_id); }
  if (lesson_session_id) { where.push('sa.lesson_session_id = ?'); params.push(lesson_session_id); }

  // студент видит только свои; teacher/assistant — по своим группам (проверим ниже)
  if (req.user.role === 'student') { where.push('sa.student_id = ?'); params.push(req.user.id); }
  else if (req.user.role === 'parent') { return res.status(403).json({ error: 'Используйте /api/parent/artifacts' }); }

  const rows = db.prepare(`
    SELECT sa.*, ls.group_id, ls.date AS session_date, ls.topic
    FROM session_artifacts sa
    JOIN lesson_sessions ls ON ls.id = sa.lesson_session_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY sa.created_at DESC
  `).all(...params);

  const filtered = rows.filter(r => {
    if (req.user.role === 'admin' || req.user.role === 'student') return true;
    return canManageGroup(req.user, r.group_id);
  });
  res.json(filtered.map(rowToArtifact));
});

// POST — загрузка артефакта. Тело:
//  { lessonSessionId, studentId, type, title?, dataUrl?, url? }
router.post('/', (req, res) => {
  const { lessonSessionId, studentId, type, title, dataUrl, url } = req.body || {};
  if (!['admin', 'teacher', 'assistant'].includes(req.user.role)) return res.status(403).json({ error: 'Недостаточно прав' });
  if (!lessonSessionId || !studentId || !['video', 'screenshot', 'file', 'link'].includes(type)) {
    return res.status(400).json({ error: 'lessonSessionId, studentId, корректный type обязательны' });
  }
  const ls = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(lessonSessionId);
  if (!ls) return res.status(404).json({ error: 'Занятие не найдено' });
  if (!canManageGroup(req.user, ls.group_id)) return res.status(403).json({ error: 'Это не ваша группа' });
  if (req.user.role !== 'admin' && !hasPermission(req.user, 'upload_artifacts')) {
    return res.status(403).json({ error: 'Нет права загружать материалы' });
  }

  // Согласие на видео
  if (type === 'video') {
    const crm = db.prepare('SELECT video_consent FROM students_crm WHERE user_id = ?').get(studentId);
    if (!crm || !crm.video_consent) {
      return res.status(403).json({ error: 'Нет согласия на видеосъёмку у этого ученика. Видео загрузить нельзя (но скрины и файлы — можно).' });
    }
  }

  const now = Date.now();
  const id = genId('sa');
  const expiresAt = type === 'video' ? now + VIDEO_TTL_MS : null;

  let filePath = null, linkUrl = null;
  if (type === 'link') {
    if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Для ссылки нужен корректный url (http/https)' });
    linkUrl = url;
  } else {
    // dataUrl: "data:<mime>;base64,...."
    const m = /^data:([\w.+/-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
    if (!m) return res.status(400).json({ error: 'Ожидается dataUrl с base64-содержимым' });
    let buf;
    try { buf = Buffer.from(m[2], 'base64'); } catch { return res.status(400).json({ error: 'Некорректный base64' }); }
    if (!buf.length) return res.status(400).json({ error: 'Пустой файл' });
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'Файл больше 50 МБ' });
    const mime = m[1];
    const ext = (mime.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
    const safeStudent = String(studentId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeSession = String(lessonSessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const rel = `sessions/${safeStudent}/${safeSession}/${id}.${ext}`;
    storage.saveFile(buf, rel);
    filePath = rel;
  }

  db.prepare(`INSERT INTO session_artifacts
    (id, lesson_session_id, student_id, type, title, file_path, url, created_at, expires_at, deleted)
    VALUES (?,?,?,?,?,?,?,?,?,0)`)
    .run(id, lessonSessionId, studentId, type, title || null, filePath, linkUrl, now, expiresAt);

  const row = db.prepare(`
    SELECT sa.*, ls.date AS session_date, ls.topic FROM session_artifacts sa
    JOIN lesson_sessions ls ON ls.id = sa.lesson_session_id WHERE sa.id = ?`).get(id);
  res.status(201).json(rowToArtifact(row));
});

router.delete('/:id', (req, res) => {
  const row = db.prepare(`SELECT sa.*, ls.group_id FROM session_artifacts sa
    JOIN lesson_sessions ls ON ls.id = sa.lesson_session_id WHERE sa.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Не найдено' });
  if (req.user.role !== 'admin' && !canManageGroup(req.user, row.group_id)) {
    return res.status(403).json({ error: 'Недоступно' });
  }
  if (row.file_path) storage.deleteFile(row.file_path);
  db.prepare('DELETE FROM session_artifacts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
