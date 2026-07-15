/* ============================================================
   KURSOR — Фидбек об учениках: /api/feedback
   ============================================================ */
const express = require('express');
const db = require('./db');
const { authRequired, requireRole } = require('./auth');
const { genId } = require('./util');
const { hasPermission } = require('./permissions');

const router = express.Router();
router.use(authRequired);

function rowToFeedback(r) {
  return {
    id: r.id,
    teacherId: r.teacher_id,
    teacherName: r.teacher_name || null,
    studentId: r.student_id,
    type: r.type,
    lessonSessionId: r.lesson_session_id || null,
    moduleId: r.module_id || null,
    text: r.text,
    isInternal: !!r.is_internal,
    createdAt: r.created_at,
  };
}

// Список отзывов. Фильтры: ?student_id= &teacher_id=
// student видит только свои и только is_internal=0; parent — через /api/parent.
router.get('/', (req, res) => {
  const { student_id, teacher_id } = req.query;
  const where = [];
  const params = [];

  if (student_id) { where.push('f.student_id = ?'); params.push(student_id); }
  if (teacher_id) { where.push('f.teacher_id = ?'); params.push(teacher_id); }

  // Ограничения по роли
  if (req.user.role === 'student') {
    where.push('f.student_id = ?'); params.push(req.user.id);
    where.push('f.is_internal = 0');
  } else if (req.user.role === 'teacher' || req.user.role === 'assistant') {
    // учитель видит отзывы по своим ученикам (teacher_id ученика = он) или написанные им
    where.push('(f.teacher_id = ? OR EXISTS (SELECT 1 FROM users u WHERE u.id=f.student_id AND u.teacher_id = ?))');
    params.push(req.user.id, req.user.id);
  } else if (req.user.role === 'parent') {
    return res.status(403).json({ error: 'Используйте /api/parent/feedback' });
  }

  const sql = `
    SELECT f.*, t.name AS teacher_name
    FROM feedback f
    LEFT JOIN users t ON t.id = f.teacher_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY f.created_at DESC
  `;
  res.json(db.prepare(sql).all(...params).map(rowToFeedback));
});

// Создать отзыв — teacher/assistant (с правом write_feedback) или admin
router.post('/', (req, res) => {
  const { studentId, type, text, moduleId, lessonSessionId, isInternal } = req.body || {};
  if (!['admin', 'teacher', 'assistant'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  if (req.user.role !== 'admin' && !hasPermission(req.user, 'write_feedback')) {
    return res.status(403).json({ error: 'Нет права оставлять отзывы' });
  }
  if (!studentId || !text || !['lesson', 'course', 'general'].includes(type)) {
    return res.status(400).json({ error: 'studentId, корректный type и text обязательны' });
  }
  const student = db.prepare("SELECT id FROM users WHERE id = ?").get(studentId);
  if (!student) return res.status(404).json({ error: 'Ученик не найден' });

  const id = genId('fb');
  db.prepare(`
    INSERT INTO feedback (id, teacher_id, student_id, type, lesson_session_id, module_id, text, is_internal, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, studentId, type, lessonSessionId || null, moduleId || null,
         String(text).trim(), isInternal ? 1 : 0, Date.now());

  const row = db.prepare(`
    SELECT f.*, t.name AS teacher_name FROM feedback f
    LEFT JOIN users t ON t.id = f.teacher_id WHERE f.id = ?`).get(id);
  res.status(201).json(rowToFeedback(row));
});

router.delete('/:id', requireRole('admin', 'teacher'), (req, res) => {
  const fb = db.prepare('SELECT * FROM feedback WHERE id = ?').get(req.params.id);
  if (!fb) return res.status(404).json({ error: 'Не найден' });
  if (req.user.role === 'teacher' && fb.teacher_id !== req.user.id) {
    return res.status(403).json({ error: 'Можно удалять только свои отзывы' });
  }
  db.prepare('DELETE FROM feedback WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
