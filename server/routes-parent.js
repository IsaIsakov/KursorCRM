/* ============================================================
   KURSOR — Кабинет родителя (read-only): /api/parent/*
   Доступ строго к своим детям (через parent_children).
   ============================================================ */
const express = require('express');
const db = require('./db');
const { authRequired, requireRole } = require('./auth');
const storage = require('./storage');

const router = express.Router();
router.use(authRequired);
router.use(requireRole('parent'));

function ownsChild(parentId, studentId) {
  return !!db.prepare('SELECT 1 FROM parent_children WHERE parent_id = ? AND student_id = ?').get(parentId, studentId);
}
function guard(req, res, next) {
  const sid = req.params.studentId;
  if (!ownsChild(req.user.id, sid)) return res.status(403).json({ error: 'Это не ваш ребёнок' });
  next();
}

// type='screenshot' всегда картинка (так его помечает клиент при загрузке по MIME).
// Доп. проверка по расширению — на случай старых записей с типом 'file', где файл
// на самом деле картинка (например, если браузер не определил image/* при выборе).
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
function isImageArtifact(a) {
  if (a.type === 'screenshot') return true;
  if (a.type === 'file') {
    const path = a.url || a.file_path || '';
    return IMAGE_EXT.test(path);
  }
  return false;
}

// Список детей
router.get('/children', (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.name, u.avatar_url, c.visits_left, c.status AS crm_status, t.name AS tariff_name,
           t.visits_count, t.price, t.duration_days, c.subscription_issued_at, c.birth_date, c.gender,
           g.name AS group_name
    FROM parent_children pc
    JOIN users u ON u.id = pc.student_id
    LEFT JOIN students_crm c ON c.user_id = u.id
    LEFT JOIN tariffs t ON t.id = c.tariff_id
    LEFT JOIN groups g ON g.id = u.group_id
    WHERE pc.parent_id = ? ORDER BY u.name
  `).all(req.user.id);
  res.json(rows.map(r => ({
    id: r.id, name: r.name, avatarUrl: r.avatar_url || null,
    visitsLeft: r.visits_left != null ? r.visits_left : null,
    crmStatus: r.crm_status || null, tariffName: r.tariff_name || null,
    tariffVisits: r.visits_count || null,
    tariffPrice: r.price || null,
    tariffDays: r.duration_days || null,
    subscriptionIssuedAt: r.subscription_issued_at || null,
    birthDate: r.birth_date || null,
    gender: r.gender || null,
    groupName: r.group_name || null,
  })));
});

// Прогресс ребёнка
router.get('/progress/:studentId', guard, (req, res) => {
  const sid = req.params.studentId;
  const p = db.prepare('SELECT * FROM progress WHERE user_id = ?').get(sid) || { points: 0, streak: 0, badges: '["beginner"]' };
  const taskRows = db.prepare('SELECT * FROM task_progress WHERE user_id = ?').all(sid);
  const tasks = {};
  for (const r of taskRows) tasks[r.task_id] = { status: r.status, points: r.points, completedAt: r.completed_at };
  res.json({
    userId: sid, points: p.points || 0, streak: p.streak || 0,
    badges: JSON.parse(p.badges || '["beginner"]'), tasks,
  });
});

// Посещаемость + остаток абонемента
router.get('/attendance/:studentId', guard, (req, res) => {
  const sid = req.params.studentId;
  const crm = db.prepare('SELECT visits_left, status, subscription_issued_at FROM students_crm WHERE user_id = ?').get(sid);
  const rows = db.prepare(`
    SELECT a.status, a.marked_at, ls.date, ls.topic, g.name AS group_name, ls.id AS session_id
    FROM attendance a
    JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
    LEFT JOIN groups g ON g.id = ls.group_id
    WHERE a.student_id = ? ORDER BY ls.date DESC LIMIT 200
  `).all(sid);
  res.json({
    visitsLeft: crm ? crm.visits_left : null,
    subscriptionStatus: crm ? crm.status : null,
    subscriptionIssuedAt: crm ? crm.subscription_issued_at : null,
    records: rows.map(r => ({
      status: r.status, date: r.date, topic: r.topic || '',
      groupName: r.group_name || '', markedAt: r.marked_at, sessionId: r.session_id,
    })),
  });
});

// Отзывы / отчёты о работе (только не внутренние)
router.get('/feedback/:studentId', guard, (req, res) => {
  const rows = db.prepare(`
    SELECT f.*, t.name AS teacher_name FROM feedback f
    LEFT JOIN users t ON t.id = f.teacher_id
    WHERE f.student_id = ? AND f.is_internal = 0 ORDER BY f.created_at DESC
  `).all(req.params.studentId);
  res.json(rows.map(r => ({
    id: r.id, type: r.type, text: r.text, teacherName: r.teacher_name || null,
    moduleId: r.module_id || null, createdAt: r.created_at,
  })));
});

// Видео/файлы по занятиям ребёнка
router.get('/artifacts/:studentId', guard, (req, res) => {
  const rows = db.prepare(`
    SELECT sa.*, ls.date AS session_date, ls.topic
    FROM session_artifacts sa
    JOIN lesson_sessions ls ON ls.id = sa.lesson_session_id
    WHERE sa.student_id = ? ORDER BY sa.created_at DESC
  `).all(req.params.studentId);
  res.json(rows.map(r => ({
    id: r.id, type: r.type, title: r.title || null, sessionDate: r.session_date || null,
    topic: r.topic || '', createdAt: r.created_at, expiresAt: r.expires_at || null,
    deleted: !!r.deleted, isImage: !r.deleted && isImageArtifact(r),
    url: r.deleted ? null : (r.url || (r.file_path ? storage.getUrl(r.file_path) : null)),
    unavailable: r.deleted ? (r.type === 'video' ? 'Видео больше не доступно (срок хранения истёк)' : 'Файл удалён') : null,
  })));
});

// Сводная лента (все события сразу) — сгруппирована по занятиям: один урок = один «пост»,
// внутри которого все работы, видео и комментарий учителя за этот урок. Отдельно идут
// общие отзывы (тип 'course'/'general'), не привязанные к конкретному занятию.
router.get('/feed/:studentId', guard, (req, res) => {
  const sid = req.params.studentId;

  // Отзывы учителя
  const feedbackRows = db.prepare(`
    SELECT f.*, t.name AS teacher_name FROM feedback f
    LEFT JOIN users t ON t.id = f.teacher_id
    WHERE f.student_id = ? AND f.is_internal = 0 ORDER BY f.created_at ASC LIMIT 300
  `).all(sid);

  // Артефакты (работы и видео)
  const artifactRows = db.prepare(`
    SELECT sa.*, ls.date AS session_date, ls.topic, ls.group_id, ls.id AS session_id
    FROM session_artifacts sa
    JOIN lesson_sessions ls ON ls.id = sa.lesson_session_id
    WHERE sa.student_id = ? ORDER BY sa.created_at ASC LIMIT 300
  `).all(sid);

  function artToObj(a) {
    return {
      id: a.id, type: a.type, title: a.title || null,
      createdAt: a.created_at, expiresAt: a.expires_at || null,
      deleted: !!a.deleted, isImage: !a.deleted && isImageArtifact(a),
      url: a.deleted ? null : (a.url || (a.file_path ? storage.getUrl(a.file_path) : null)),
      unavailable: a.deleted ? (a.type === 'video' ? 'Видео больше не доступно (срок хранения истёк)' : 'Файл удалён') : null,
    };
  }

  // Группируем артефакты и привязанные к занятию отзывы по lesson_session_id —
  // получаем один «пост» на урок.
  const sessionIds = [...new Set(artifactRows.map(a => a.session_id))];
  for (const f of feedbackRows) if (f.lesson_session_id && !sessionIds.includes(f.lesson_session_id)) sessionIds.push(f.lesson_session_id);

  const sessionMeta = {};
  for (const a of artifactRows) {
    if (!sessionMeta[a.session_id]) sessionMeta[a.session_id] = { date: a.session_date, topic: a.topic, groupId: a.group_id };
  }
  // Для сессий, известных только по отзыву (артефактов нет), подтянем дату/тему урока отдельно
  const missingMeta = sessionIds.filter(id => !sessionMeta[id]);
  if (missingMeta.length) {
    const ph = missingMeta.map(() => '?').join(',');
    const ls = db.prepare(`SELECT id, date, topic, group_id FROM lesson_sessions WHERE id IN (${ph})`).all(...missingMeta);
    for (const l of ls) sessionMeta[l.id] = { date: l.date, topic: l.topic, groupId: l.group_id };
  }
  const groupIds = [...new Set(Object.values(sessionMeta).map(m => m.groupId).filter(Boolean))];
  const groupNames = {};
  if (groupIds.length) {
    const ph = groupIds.map(() => '?').join(',');
    db.prepare(`SELECT id, name FROM groups WHERE id IN (${ph})`).all(...groupIds).forEach(g => { groupNames[g.id] = g.name; });
  }

  const posts = sessionIds.map(sessionId => {
    const arts = artifactRows.filter(a => a.session_id === sessionId).map(artToObj);
    const cmts = feedbackRows.filter(f => f.lesson_session_id === sessionId)
      .map(f => ({ id: f.id, text: f.text, teacherName: f.teacher_name || null, createdAt: f.created_at }));
    const meta = sessionMeta[sessionId] || {};
    const timestamps = [...arts.map(a => a.createdAt), ...cmts.map(c => c.createdAt)];
    return {
      id: 'session_' + sessionId, kind: 'lesson', sessionId,
      date: meta.date || null, topic: meta.topic || '', groupName: groupNames[meta.groupId] || '',
      createdAt: timestamps.length ? Math.max(...timestamps) : 0,
      works: arts.filter(a => a.type === 'screenshot' || a.type === 'file'),
      videos: arts.filter(a => a.type === 'video'),
      links: arts.filter(a => a.type === 'link'),
      comments: cmts,
    };
  });

  // Общие отзывы без привязки к занятию — отдельными карточками
  const generalItems = feedbackRows
    .filter(f => !f.lesson_session_id)
    .map(f => ({
      id: 'fb_' + f.id, kind: 'general_feedback', createdAt: f.created_at,
      text: f.text, teacherName: f.teacher_name || null, type: f.type,
    }));

  const feed = [...posts, ...generalItems].sort((a, b) => b.createdAt - a.createdAt);
  res.json(feed.slice(0, 150));
});

module.exports = router;
