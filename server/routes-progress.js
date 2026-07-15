/* ============================================================
   KURSOR — Прогресс ученика: /api/progress/*
   ============================================================ */
const express = require('express');
const db = require('./db');
const { authRequired, requireRole } = require('./auth');
const ws = require('./ws');

const router = express.Router();
router.use(authRequired);

function ensureProgress(userId) {
  const row = db.prepare('SELECT * FROM progress WHERE user_id = ?').get(userId);
  if (row) return row;
  db.prepare(`
    INSERT INTO progress (user_id, points, streak, last_active, badges)
    VALUES (?, 0, 0, NULL, '["beginner"]')
  `).run(userId);
  return db.prepare('SELECT * FROM progress WHERE user_id = ?').get(userId);
}

function buildProgress(userId) {
  const p = ensureProgress(userId);
  const taskRows = db.prepare('SELECT * FROM task_progress WHERE user_id = ?').all(userId);
  const tasks = {};
  for (const r of taskRows) {
    tasks[r.task_id] = {
      status: r.status, points: r.points, attempts: r.attempts,
      usedHint: !!r.used_hint, submission: r.submission, completedAt: r.completed_at,
    };
  }
  return {
    userId, points: p.points, streak: p.streak, lastActive: p.last_active,
    badges: JSON.parse(p.badges || '["beginner"]'), tasks,
  };
}

router.get('/me', (req, res) => {
  res.json(buildProgress(req.user.id));
});

// Публичный рейтинг (доступен всем авторизованным, включая учеников)
router.get('/leaderboard', (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.name, p.points, p.streak, p.badges,
           (SELECT COUNT(*) FROM task_progress tp WHERE tp.user_id = u.id AND tp.status='done') AS done
    FROM users u
    LEFT JOIN progress p ON p.user_id = u.id
    WHERE u.role='student'
    ORDER BY COALESCE(p.points, 0) DESC
  `).all();
  res.json(rows.map(r => ({
    id: r.id, name: r.name,
    points: r.points || 0, streak: r.streak || 0, done: r.done || 0,
    badges: JSON.parse(r.badges || '["beginner"]').length,
  })));
});

router.get('/', requireRole('teacher', 'admin'), (req, res) => {
  let students;
  if (req.user.role === 'teacher') {
    students = db.prepare(`
      SELECT id FROM users WHERE role='student' AND (teacher_id IS NULL OR teacher_id = ?)
    `).all(req.user.id);
  } else {
    students = db.prepare("SELECT id FROM users WHERE role='student'").all();
  }
  res.json(students.map(s => buildProgress(s.id)));
});

router.get('/:userId', requireRole('teacher', 'admin'), (req, res) => {
  res.json(buildProgress(req.params.userId));
});

router.post('/attempt', requireRole('student'), (req, res) => {
  const { taskId } = req.body || {};
  if (!taskId) return res.status(400).json({ error: 'taskId обязателен' });
  const id = parseInt(taskId);
  const userId = req.user.id;
  ensureProgress(userId);

  const existing = db.prepare('SELECT * FROM task_progress WHERE user_id=? AND task_id=?').get(userId, id);
  if (existing && existing.status === 'done') return res.json(buildProgress(userId));

  if (existing) {
    db.prepare(`
      UPDATE task_progress SET attempts = attempts + 1, updated_at = ?
      WHERE user_id=? AND task_id=?
    `).run(Date.now(), userId, id);
  } else {
    db.prepare(`
      INSERT INTO task_progress (user_id, task_id, status, points, attempts, used_hint, updated_at)
      VALUES (?, ?, 'progress', 0, 1, 0, ?)
    `).run(userId, id, Date.now());
  }
  const progress = buildProgress(userId);
  ws.broadcastProgress(userId, progress);
  res.json(progress);
});

router.post('/complete', requireRole('student'), (req, res) => {
  const { taskId, points, usedHint, submission } = req.body || {};
  if (!taskId) return res.status(400).json({ error: 'taskId обязателен' });
  const tid = parseInt(taskId);

  const task = db.prepare('SELECT id, type FROM tasks WHERE id = ?').get(tid);
  if (!task) return res.status(404).json({ error: 'Задача не найдена' });

  // Серверная политика начисления очков — не доверяем клиенту
  const POINTS = { quiz: 10, fill: 15, order: 20, code: 25, project: 50 };
  const base = POINTS[task.type] || 10;
  let earned = base;
  if (!usedHint) earned += 5;
  if (typeof points === 'number' && points >= 0) earned = Math.min(earned, points);

  const userId = req.user.id;
  ensureProgress(userId);
  const existing = db.prepare('SELECT * FROM task_progress WHERE user_id=? AND task_id=?').get(userId, tid);

  let firstDone = !existing || existing.status !== 'done';
  const now = Date.now();

  if (existing) {
    db.prepare(`
      UPDATE task_progress
      SET status='done',
          points = CASE WHEN status='done' THEN points ELSE ? END,
          used_hint = ?, submission = COALESCE(?, submission),
          attempts = attempts + 1, completed_at = COALESCE(completed_at, ?), updated_at = ?
      WHERE user_id=? AND task_id=?
    `).run(earned, usedHint ? 1 : 0, submission || null, now, now, userId, tid);
  } else {
    db.prepare(`
      INSERT INTO task_progress (user_id, task_id, status, points, attempts, used_hint, submission, completed_at, updated_at)
      VALUES (?, ?, 'done', ?, 1, ?, ?, ?, ?)
    `).run(userId, tid, earned, usedHint ? 1 : 0, submission || null, now, now);
  }

  if (firstDone) {
    const p = ensureProgress(userId);
    const lastDay = p.last_active ? new Date(p.last_active).toDateString() : null;
    const today = new Date(now).toDateString();
    const yesterday = new Date(now - 86400000).toDateString();
    let streak = p.streak;
    if (lastDay !== today) {
      streak = (lastDay === yesterday) ? streak + 1 : 1;
    }
    const badges = JSON.parse(p.badges || '["beginner"]');
    if (streak >= 3 && !badges.includes('streak_3')) badges.push('streak_3');
    if (streak >= 7 && !badges.includes('streak_7')) badges.push('streak_7');
    if (streak >= 30 && !badges.includes('streak_30')) badges.push('streak_30');
    const projectsDone = db.prepare("SELECT COUNT(*) AS n FROM task_progress WHERE user_id=? AND status='done'").get(userId).n;
    if (projectsDone >= 1 && !badges.includes('first_code')) badges.push('first_code');

    db.prepare(`
      UPDATE progress SET points = points + ?, streak = ?, last_active = ?, badges = ?
      WHERE user_id = ?
    `).run(earned, streak, now, JSON.stringify(badges), userId);
  }

  const progress = buildProgress(userId);
  ws.broadcastProgress(userId, progress);
  res.json(progress);
});

module.exports = router;
