/* ============================================================
   KURSOR — Экспорт / импорт данных (CSV или JSON).
   /api/export/users|groups|modules|materials
   /api/import/users|groups|modules|materials   (?dryRun=true)
   В UI кнопки распределены по соответствующим вкладкам
   (ученики/учителя, группы, модули, материалы) — отдельной
   вкладки «Импорт/Экспорт» нет.
   ============================================================ */
const express = require('express');
const db = require('./db');
const { authRequired, requireRole, hashPassword } = require('./auth');
const { genId, toCsv, parseCsv } = require('./util');

const router = express.Router();
router.use(authRequired);

/* ============== ОПИСАНИЕ НАБОРОВ ============== */
// columns — порядок колонок в CSV; sensitive поля CRM экспортируются только админу.
const DATASETS = {
  users: {
    columns: ['id', 'login', 'name', 'role', 'age', 'group', 'languages', 'teacher_id'],
    fetch() {
      return db.prepare('SELECT * FROM users ORDER BY role, name').all().map(u => ({
        id: u.id, login: u.login, name: u.name, role: u.role, age: u.age,
        group: u.group_id, languages: u.languages, teacher_id: u.teacher_id || '',
      }));
    },
  },
  groups: {
    columns: ['id', 'name', 'course_id', 'branch_id', 'teacher_id', 'assistant_id', 'lesson_kind', 'status'],
    fetch() {
      return db.prepare('SELECT * FROM groups ORDER BY name').all().map(g => ({
        id: g.id, name: g.name, course_id: g.course_id || '', branch_id: g.branch_id,
        teacher_id: g.teacher_id, assistant_id: g.assistant_id || '',
        lesson_kind: g.lesson_kind, status: g.status,
      }));
    },
  },
  modules: {
    columns: ['id', 'lang', 'title', 'description', 'video', 'explanation', 'position'],
    fetch() {
      return db.prepare('SELECT * FROM modules ORDER BY position, id').all();
    },
  },
  materials: {
    columns: ['id', 'course_id', 'type', 'title', 'content', 'created_by', 'created_at'],
    fetch() {
      return db.prepare('SELECT * FROM materials ORDER BY created_at DESC').all();
    },
  },
};

/* ============== ЭКСПОРТ ============== */
function exportHandler(name) {
  return (req, res) => {
    const ds = DATASETS[name];
    const format = (req.query.format || 'json').toLowerCase();
    const rows = ds.fetch();
    if (format === 'csv') {
      const csv = toCsv(rows, ds.columns);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="kursor_${name}.csv"`);
      // BOM для корректной кириллицы в Excel
      return res.send('\uFEFF' + csv);
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="kursor_${name}.json"`);
    res.send(JSON.stringify(rows, null, 2));
  };
}

router.get('/export/users',     requireRole('admin'), exportHandler('users'));
router.get('/export/groups',    requireRole('admin'), exportHandler('groups'));
router.get('/export/modules',   requireRole('admin', 'teacher'), exportHandler('modules'));
router.get('/export/materials', requireRole('admin', 'teacher'), exportHandler('materials'));

/* ============== ИМПОРТ ============== */
// Тело: { format:'json'|'csv', data:<string|array> }. ?dryRun=true — без записи.
function parsePayload(body) {
  const format = (body.format || 'json').toLowerCase();
  if (format === 'csv') {
    return parseCsv(typeof body.data === 'string' ? body.data : '');
  }
  // json
  if (Array.isArray(body.data)) return body.data;
  if (typeof body.data === 'string') {
    try { const j = JSON.parse(body.data); return Array.isArray(j) ? j : []; }
    catch { return null; }
  }
  return null;
}

// ---- users ----
router.post('/import/users', requireRole('admin'), (req, res) => {
  const dryRun = req.query.dryRun === 'true';
  const rows = parsePayload(req.body || {});
  if (!rows) return res.status(400).json({ error: 'Не удалось разобрать данные (JSON/CSV)' });

  const ROLES = ['admin', 'teacher', 'assistant', 'student', 'parent'];
  const result = { total: rows.length, toCreate: 0, toUpdate: 0, errors: [], items: [] };
  const existingLogins = new Map(db.prepare('SELECT id, login FROM users').all().map(u => [u.login, u.id]));

  rows.forEach((r, i) => {
    const line = i + 2;
    const name = (r.name || '').toString().trim();
    const login = (r.login || '').toString().trim();
    const role = (r.role || 'student').toString().trim();
    if (!name || !login) { result.errors.push({ line, error: 'Пустые имя или логин' }); return; }
    if (!ROLES.includes(role)) { result.errors.push({ line, error: `Неизвестная роль "${role}"` }); return; }
    const existsId = existingLogins.get(login);
    const action = existsId ? 'update' : 'create';
    if (action === 'create') result.toCreate++; else result.toUpdate++;
    result.items.push({ line, login, name, role, action });

    if (!dryRun) {
      const langs = (() => {
        if (Array.isArray(r.languages)) return JSON.stringify(r.languages);
        const s = (r.languages || '').toString().trim();
        if (!s) return '[]';
        try { const j = JSON.parse(s); return JSON.stringify(Array.isArray(j) ? j : []); }
        catch { return JSON.stringify(s.split(/[;|]/).map(x => x.trim()).filter(Boolean)); }
      })();
      if (existsId) {
        db.prepare('UPDATE users SET name=?, role=?, age=?, group_id=?, languages=?, teacher_id=? WHERE id=?')
          .run(name, role, parseInt(r.age) || 0, parseInt(r.group) || 0, langs, r.teacher_id || null, existsId);
      } else {
        const id = genId('u');
        const pwd = (r.password || 'kursor123').toString();
        db.prepare(`INSERT INTO users (id, login, password_hash, name, role, age, group_id, languages, teacher_id, created_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .run(id, login, hashPassword(pwd), name, role, parseInt(r.age) || 0, parseInt(r.group) || 0, langs, r.teacher_id || null, Date.now());
        if (role === 'student') db.prepare("INSERT OR IGNORE INTO progress (user_id, points, streak, badges) VALUES (?,0,0,'[\"beginner\"]')").run(id);
        existingLogins.set(login, id);
      }
    }
  });
  res.json({ dryRun, ...result });
});

// ---- groups ----
router.post('/import/groups', requireRole('admin'), (req, res) => {
  const dryRun = req.query.dryRun === 'true';
  const rows = parsePayload(req.body || {});
  if (!rows) return res.status(400).json({ error: 'Не удалось разобрать данные' });
  const result = { total: rows.length, toCreate: 0, toUpdate: 0, errors: [], items: [] };
  const existing = new Set(db.prepare('SELECT id FROM groups').all().map(g => g.id));

  rows.forEach((r, i) => {
    const line = i + 2;
    const name = (r.name || '').toString().trim();
    if (!name || !r.branch_id || !r.teacher_id) { result.errors.push({ line, error: 'Нужны name, branch_id, teacher_id' }); return; }
    const id = (r.id || '').toString().trim() || genId('grp');
    const action = existing.has(id) ? 'update' : 'create';
    if (action === 'create') result.toCreate++; else result.toUpdate++;
    result.items.push({ line, id, name, action });
    if (!dryRun) {
      const kind = ['main', 'extra'].includes(r.lesson_kind) ? r.lesson_kind : 'main';
      const status = ['active', 'archived'].includes(r.status) ? r.status : 'active';
      if (existing.has(id)) {
        db.prepare('UPDATE groups SET name=?, course_id=?, branch_id=?, teacher_id=?, assistant_id=?, lesson_kind=?, status=? WHERE id=?')
          .run(name, r.course_id || null, r.branch_id, r.teacher_id, r.assistant_id || null, kind, status, id);
      } else {
        db.prepare('INSERT INTO groups (id, name, course_id, branch_id, teacher_id, assistant_id, lesson_kind, status) VALUES (?,?,?,?,?,?,?,?)')
          .run(id, name, r.course_id || null, r.branch_id, r.teacher_id, r.assistant_id || null, kind, status);
        existing.add(id);
      }
    }
  });
  res.json({ dryRun, ...result });
});

// ---- modules ----
router.post('/import/modules', requireRole('admin'), (req, res) => {
  const dryRun = req.query.dryRun === 'true';
  const rows = parsePayload(req.body || {});
  if (!rows) return res.status(400).json({ error: 'Не удалось разобрать данные' });
  const result = { total: rows.length, toCreate: 0, toUpdate: 0, errors: [], items: [] };
  const existing = new Set(db.prepare('SELECT id FROM modules').all().map(m => m.id));

  rows.forEach((r, i) => {
    const line = i + 2;
    const id = (r.id || '').toString().trim();
    if (!id || !r.lang || !r.title) { result.errors.push({ line, error: 'Нужны id, lang, title' }); return; }
    const action = existing.has(id) ? 'update' : 'create';
    if (action === 'create') result.toCreate++; else result.toUpdate++;
    result.items.push({ line, id, title: r.title, action });
    if (!dryRun) {
      if (existing.has(id)) {
        db.prepare('UPDATE modules SET lang=?, title=?, description=?, video=?, explanation=? WHERE id=?')
          .run(r.lang, r.title, r.description || '', r.video || '', r.explanation || '', id);
      } else {
        const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM modules').get().p;
        db.prepare('INSERT INTO modules (id, lang, title, description, video, explanation, position) VALUES (?,?,?,?,?,?,?)')
          .run(id, r.lang, r.title, r.description || '', r.video || '', r.explanation || '', pos);
        existing.add(id);
      }
    }
  });
  res.json({ dryRun, ...result });
});

// ---- materials ----
router.post('/import/materials', requireRole('admin'), (req, res) => {
  const dryRun = req.query.dryRun === 'true';
  const rows = parsePayload(req.body || {});
  if (!rows) return res.status(400).json({ error: 'Не удалось разобрать данные' });
  const result = { total: rows.length, toCreate: 0, toUpdate: 0, errors: [], items: [] };
  const existing = new Set(db.prepare('SELECT id FROM materials').all().map(m => m.id));
  const modules = new Set(db.prepare('SELECT id FROM modules').all().map(m => m.id));

  rows.forEach((r, i) => {
    const line = i + 2;
    if (!r.course_id || !r.title || !['presentation', 'task', 'text', 'file'].includes(r.type)) {
      result.errors.push({ line, error: 'Нужны course_id, корректный type, title' }); return;
    }
    if (!modules.has(r.course_id)) { result.errors.push({ line, error: `Курс ${r.course_id} не найден` }); return; }
    const id = (r.id || '').toString().trim() || genId('mat');
    const action = existing.has(id) ? 'update' : 'create';
    if (action === 'create') result.toCreate++; else result.toUpdate++;
    result.items.push({ line, id, title: r.title, action });
    if (!dryRun) {
      if (existing.has(id)) {
        db.prepare('UPDATE materials SET course_id=?, type=?, title=?, content=? WHERE id=?')
          .run(r.course_id, r.type, r.title, r.content || '', id);
      } else {
        db.prepare('INSERT INTO materials (id, course_id, type, title, content, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
          .run(id, r.course_id, r.type, r.title, r.content || '', req.user.id, Date.now());
        existing.add(id);
      }
    }
  });
  res.json({ dryRun, ...result });
});

module.exports = router;
