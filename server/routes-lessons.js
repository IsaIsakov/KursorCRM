/* ============================================================
   KURSOR — Уроки: /api/lessons/*
   Структура: intro (массив экранов) → miniTask → tasks (из таблицы tasks).
   ============================================================ */
const express = require('express');
const db = require('./db');
const { authRequired, requireRole } = require('./auth');
const ws = require('./ws');

const router = express.Router();
router.use(authRequired);

function buildLesson(moduleId, userId) {
  const mod = db.prepare('SELECT * FROM modules WHERE id = ?').get(moduleId);
  if (!mod) return null;
  const lessonRow = db.prepare('SELECT * FROM lessons WHERE module_id = ?').get(moduleId);
  const taskRows = db.prepare(
    'SELECT id, type, title, description, difficulty, explain FROM tasks WHERE module_id = ? ORDER BY difficulty, id'
  ).all(moduleId);

  let progress = null;
  if (userId) {
    progress = db.prepare(
      'SELECT intro_step, intro_done, mini_done FROM lesson_progress WHERE user_id=? AND module_id=?'
    ).get(userId, moduleId) || { intro_step: 0, intro_done: 0, mini_done: 0 };
  }

  return {
    moduleId: mod.id, lang: mod.lang, title: mod.title, description: mod.description || '',
    intro: lessonRow ? JSON.parse(lessonRow.intro || '[]') : [],
    miniTask: lessonRow && lessonRow.mini_task ? JSON.parse(lessonRow.mini_task) : null,
    tasks: taskRows,
    progress: progress ? {
      introStep: progress.intro_step,
      introDone: !!progress.intro_done,
      miniDone: !!progress.mini_done,
    } : null,
  };
}

router.get('/:moduleId', (req, res) => {
  const userId = req.user.role === 'student' ? req.user.id : null;
  const lesson = buildLesson(req.params.moduleId, userId);
  if (!lesson) return res.status(404).json({ error: 'Модуль не найден' });
  res.json(lesson);
});

router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT m.id, m.lang, m.title, m.description,
           (CASE WHEN l.module_id IS NOT NULL THEN 1 ELSE 0 END) AS has_lesson
    FROM modules m
    LEFT JOIN lessons l ON l.module_id = m.id
    ORDER BY m.position, m.id
  `).all();
  res.json(rows.map(r => ({ ...r, has_lesson: !!r.has_lesson })));
});

router.post('/:moduleId/intro-step', requireRole('student'), (req, res) => {
  const { step, total } = req.body || {};
  if (!Number.isInteger(step) || step < 0) return res.status(400).json({ error: 'step должен быть >=0' });
  const userId = req.user.id;
  const moduleId = req.params.moduleId;
  if (!db.prepare('SELECT 1 FROM modules WHERE id = ?').get(moduleId))
    return res.status(404).json({ error: 'Модуль не найден' });

  const cur = db.prepare('SELECT * FROM lesson_progress WHERE user_id=? AND module_id=?').get(userId, moduleId);
  const isLast = Number.isInteger(total) && step >= total - 1;
  const introDone = ((cur && cur.intro_done) || isLast) ? 1 : 0;
  const newStep = Math.max(cur ? cur.intro_step : 0, step);

  if (cur) {
    db.prepare(`UPDATE lesson_progress SET intro_step=?, intro_done=?, updated_at=? WHERE user_id=? AND module_id=?`)
      .run(newStep, introDone, Date.now(), userId, moduleId);
  } else {
    db.prepare(`INSERT INTO lesson_progress (user_id, module_id, intro_step, intro_done, mini_done, updated_at)
                VALUES (?, ?, ?, ?, 0, ?)`).run(userId, moduleId, newStep, introDone, Date.now());
  }
  ws.broadcastProgress(userId, { type: 'lesson', moduleId, introStep: newStep, introDone: !!introDone });
  res.json({ ok: true, introStep: newStep, introDone: !!introDone });
});

router.post('/:moduleId/mini-task', requireRole('student'), (req, res) => {
  const moduleId = req.params.moduleId;
  const lessonRow = db.prepare('SELECT mini_task FROM lessons WHERE module_id=?').get(moduleId);
  if (!lessonRow || !lessonRow.mini_task) return res.status(404).json({ error: 'Мини-задача не найдена' });

  const mini = JSON.parse(lessonRow.mini_task);
  const { answer } = req.body || {};
  let correct = false;
  if      (mini.type === 'quiz')  correct = parseInt(answer) === mini.answer;
  else if (mini.type === 'fill')  correct = String(answer || '').trim().toLowerCase() === String(mini.answer).trim().toLowerCase();
  else if (mini.type === 'order') correct = JSON.stringify(answer) === JSON.stringify(mini.items);
  else if (mini.type === 'code')  correct = String(answer || '').replace(/\r\n/g, '\n').trim() === String(mini.expectedOutput || '').trim();
  else return res.status(400).json({ error: 'Неизвестный тип мини-задачи' });

  const userId = req.user.id;
  const cur = db.prepare('SELECT * FROM lesson_progress WHERE user_id=? AND module_id=?').get(userId, moduleId);
  const firstSolve = correct && (!cur || !cur.mini_done);
  const earned = firstSolve ? (parseInt(mini.points) > 0 ? parseInt(mini.points) : 5) : 0;

  if (correct) {
    if (cur) {
      db.prepare(`UPDATE lesson_progress SET mini_done=1, updated_at=? WHERE user_id=? AND module_id=?`)
        .run(Date.now(), userId, moduleId);
    } else {
      db.prepare(`INSERT INTO lesson_progress (user_id, module_id, intro_step, intro_done, mini_done, updated_at)
                  VALUES (?, ?, 0, 0, 1, ?)`).run(userId, moduleId, Date.now());
    }
    if (firstSolve) {
      db.prepare(`INSERT INTO progress (user_id, points, streak, badges)
                  VALUES (?, ?, 0, '["beginner"]')
                  ON CONFLICT(user_id) DO UPDATE SET points = points + ?, last_active = ?`)
        .run(userId, earned, earned, Date.now());
    }
    ws.broadcastProgress(userId, { type: 'mini-task', moduleId, correct: true, earned });
  }
  res.json({ correct, earned, explain: mini.explain || '' });
});

module.exports = router;
