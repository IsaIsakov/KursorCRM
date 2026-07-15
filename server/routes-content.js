/* ============================================================
   KURSOR — Модули и задачи: /api/modules, /api/tasks
   ============================================================ */
const express = require('express');
const db = require('./db');
const { authRequired, requireRole } = require('./auth');
const { hasPermission } = require('./permissions');

const router = express.Router();
router.use(authRequired);

// Право «Управлять задачами» (manage_tasks) — это создание/редактирование/удаление
// модулей и задач. Админ — всегда может. Для teacher/assistant — только если выдано право.
// Раньше эти ручки использовали requireRole('admin','teacher'), и переключатель
// manage_tasks был декоративным.
function requireManageTasks(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  if (!req.user || !['teacher', 'assistant'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  if (!hasPermission(req.user, 'manage_tasks')) {
    return res.status(403).json({ error: 'Нет права управлять модулями и задачами' });
  }
  next();
}

function moduleRow(r) {
  return {
    id: r.id, lang: r.lang, title: r.title,
    description: r.description || '', video: r.video || '', explanation: r.explanation || ''
  };
}

function taskRow(r) {
  const t = {
    id: r.id, module: r.module_id, type: r.type, title: r.title,
    description: r.description || '', difficulty: r.difficulty || 1, explain: r.explain || '',
  };
  if (r.options) t.options = JSON.parse(r.options);
  if (r.answer !== null && r.answer !== undefined) {
    if (r.type === 'quiz') t.answer = parseInt(r.answer);
    else t.answer = r.answer;
  }
  if (r.items) t.items = JSON.parse(r.items);
  if (r.expected_output) t.expectedOutput = r.expected_output;
  if (r.starter) t.starter = r.starter;
  if (r.stdin) t.stdin = r.stdin;
  if (r.scratch_project_id) t.scratchProjectId = r.scratch_project_id;
  return t;
}

router.get('/modules', (req, res) => {
  const rows = db.prepare('SELECT * FROM modules ORDER BY position, id').all();
  res.json(rows.map(moduleRow));
});

router.post('/modules', requireManageTasks, (req, res) => {
  const { id, lang, title, description, video, explanation } = req.body || {};
  if (!id || !lang || !title) return res.status(400).json({ error: 'id, lang, title обязательны' });
  const exists = db.prepare('SELECT 1 FROM modules WHERE id = ?').get(id);
  if (exists) return res.status(409).json({ error: 'Модуль с таким ID уже существует' });
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0)+1 AS p FROM modules').get().p;
  db.prepare(`
    INSERT INTO modules (id, lang, title, description, video, explanation, position)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, lang, title, description || '', video || '', explanation || '', pos);
  res.status(201).json(moduleRow(db.prepare('SELECT * FROM modules WHERE id = ?').get(id)));
});

router.put('/modules/:id', requireManageTasks, (req, res) => {
  const cur = db.prepare('SELECT * FROM modules WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Не найден' });
  const { lang, title, description, video, explanation } = req.body || {};
  db.prepare(`
    UPDATE modules SET lang=?, title=?, description=?, video=?, explanation=? WHERE id=?
  `).run(
    lang || cur.lang,
    title || cur.title,
    description !== undefined ? description : cur.description,
    video !== undefined ? video : cur.video,
    explanation !== undefined ? explanation : cur.explanation,
    req.params.id
  );
  res.json(moduleRow(db.prepare('SELECT * FROM modules WHERE id = ?').get(req.params.id)));
});

router.delete('/modules/:id', requireManageTasks, (req, res) => {
  const info = db.prepare('DELETE FROM modules WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Не найден' });
  res.json({ ok: true });
});

router.get('/tasks', (req, res) => {
  const rows = db.prepare('SELECT * FROM tasks ORDER BY id').all();
  res.json(rows.map(taskRow));
});

router.post('/tasks', requireManageTasks, (req, res) => {
  const t = req.body || {};
  if (!t.module || !t.type || !t.title) return res.status(400).json({ error: 'module, type, title обязательны' });
  const nextId = (db.prepare('SELECT COALESCE(MAX(id), 0)+1 AS n FROM tasks').get().n) || 1;
  const id = t.id || nextId;
  db.prepare(`
    INSERT INTO tasks (id, module_id, type, title, description, difficulty, explain,
                       options, answer, items, expected_output, starter, stdin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, t.module, t.type, t.title, t.description || '', t.difficulty || 1, t.explain || '',
    t.options ? JSON.stringify(t.options) : null,
    t.answer !== undefined && t.answer !== null ? String(t.answer) : null,
    t.items ? JSON.stringify(t.items) : null,
    t.expectedOutput || null,
    t.starter || null,
    t.stdin || null
  );
  if (t.scratchProjectId !== undefined) {
    db.prepare('UPDATE tasks SET scratch_project_id=? WHERE id=?').run(t.scratchProjectId || null, id);
  }
  res.status(201).json(taskRow(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)));
});

router.put('/tasks/:id', requireManageTasks, (req, res) => {
  const id = parseInt(req.params.id);
  const cur = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'Не найдена' });
  const t = req.body || {};
  db.prepare(`
    UPDATE tasks SET module_id=?, type=?, title=?, description=?, difficulty=?, explain=?,
                     options=?, answer=?, items=?, expected_output=?, starter=?, stdin=?
    WHERE id=?
  `).run(
    t.module || cur.module_id,
    t.type || cur.type,
    t.title || cur.title,
    t.description !== undefined ? t.description : cur.description,
    t.difficulty || cur.difficulty,
    t.explain !== undefined ? t.explain : cur.explain,
    t.options !== undefined ? (t.options ? JSON.stringify(t.options) : null) : cur.options,
    t.answer !== undefined ? (t.answer !== null ? String(t.answer) : null) : cur.answer,
    t.items !== undefined ? (t.items ? JSON.stringify(t.items) : null) : cur.items,
    t.expectedOutput !== undefined ? t.expectedOutput : cur.expected_output,
    t.starter !== undefined ? t.starter : cur.starter,
    t.stdin !== undefined ? t.stdin : cur.stdin,
    id
  );
  if (t.scratchProjectId !== undefined) {
    db.prepare('UPDATE tasks SET scratch_project_id=? WHERE id=?').run(t.scratchProjectId || null, id);
  }
  res.json(taskRow(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)));
});

router.delete('/tasks/:id', requireManageTasks, (req, res) => {
  const info = db.prepare('DELETE FROM tasks WHERE id = ?').run(parseInt(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'Не найдена' });
  res.json({ ok: true });
});

module.exports = router;
