/* ============================================================
   KURSOR — CRM-ядро: филиалы, тарифы, группы, расписание,
   состав групп, карточки клиентов.
   ============================================================ */
const express = require('express');
const db = require('./db');
const { authRequired, requireRole } = require('./auth');
const { genId } = require('./util');
const { hasPermission } = require('./permissions');

const router = express.Router();
router.use(authRequired);

/* ============== ХЕЛПЕРЫ ============== */
function isStaff(u) { return ['admin', 'teacher', 'assistant'].includes(u.role); }

// группы, где пользователь — учитель или ассистент
function teacherGroupIds(userId) {
  return db.prepare('SELECT id FROM groups WHERE teacher_id = ? OR assistant_id = ?')
    .all(userId, userId).map(r => r.id);
}

function rowToTariff(r) {
  return {
    id: r.id, name: r.name, visitsCount: r.visits_count, durationDays: r.duration_days,
    price: r.price || 0, comment: r.comment || '', extraLessonsSeparate: !!r.extra_lessons_separate,
  };
}
function rowToGroup(r) {
  return {
    id: r.id, name: r.name, courseId: r.course_id || null, branchId: r.branch_id,
    teacherId: r.teacher_id, assistantId: r.assistant_id || null,
    lessonKind: r.lesson_kind, status: r.status,
    branchName: r.branch_name || null, teacherName: r.teacher_name || null,
    assistantName: r.assistant_name || null, courseTitle: r.course_title || null,
    memberCount: r.member_count != null ? r.member_count : undefined,
  };
}
function rowToCrm(r) {
  return {
    userId: r.user_id, fullName: r.full_name, birthDate: r.birth_date || null,
    gender: r.gender || null, branchId: r.branch_id || null, tariffId: r.tariff_id || null,
    subscriptionIssuedAt: r.subscription_issued_at || null, visitsLeft: r.visits_left || 0,
    status: r.status, responsibleManagerId: r.responsible_manager_id || null,
    parentName: r.parent_name || null, parentPhone: r.parent_phone || null,
    documentId: r.document_id || null, comment: r.comment || null,
    videoConsent: !!r.video_consent, videoConsentDate: r.video_consent_date || null,
    branchName: r.branch_name || null, tariffName: r.tariff_name || null,
    login: r.login || null, name: r.name || null,
  };
}

/* ============================================================
   ФИЛИАЛЫ /api/branches
   ============================================================ */
router.get('/branches', (req, res) => {
  res.json(db.prepare('SELECT * FROM branches ORDER BY name').all());
});
router.post('/branches', requireRole('admin'), (req, res) => {
  const { name, address } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name обязателен' });
  const id = genId('br');
  db.prepare('INSERT INTO branches (id, name, address) VALUES (?,?,?)').run(id, String(name).trim(), address || null);
  res.status(201).json(db.prepare('SELECT * FROM branches WHERE id = ?').get(id));
});
router.put('/branches/:id', requireRole('admin'), (req, res) => {
  const cur = db.prepare('SELECT * FROM branches WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Не найден' });
  const { name, address } = req.body || {};
  db.prepare('UPDATE branches SET name=?, address=? WHERE id=?')
    .run(name !== undefined ? String(name).trim() : cur.name, address !== undefined ? address : cur.address, req.params.id);
  res.json(db.prepare('SELECT * FROM branches WHERE id = ?').get(req.params.id));
});
router.delete('/branches/:id', requireRole('admin'), (req, res) => {
  const info = db.prepare('DELETE FROM branches WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Не найден' });
  res.json({ ok: true });
});

/* ============================================================
   ТАРИФЫ /api/tariffs  (price — в тенге; comment — описание)
   ============================================================ */
router.get('/tariffs', (req, res) => {
  res.json(db.prepare('SELECT * FROM tariffs ORDER BY name').all().map(rowToTariff));
});
router.post('/tariffs', requireRole('admin'), (req, res) => {
  const { name, visitsCount, durationDays, price, comment, extraLessonsSeparate } = req.body || {};
  if (!name || visitsCount == null || durationDays == null) {
    return res.status(400).json({ error: 'name, visitsCount, durationDays обязательны' });
  }
  const id = genId('tar');
  db.prepare(`INSERT INTO tariffs (id, name, visits_count, duration_days, price, comment, extra_lessons_separate)
              VALUES (?,?,?,?,?,?,?)`)
    .run(id, String(name).trim(), parseInt(visitsCount) || 0, parseInt(durationDays) || 0,
         parseInt(price) || 0, comment || null, extraLessonsSeparate ? 1 : 0);
  res.status(201).json(rowToTariff(db.prepare('SELECT * FROM tariffs WHERE id = ?').get(id)));
});
router.put('/tariffs/:id', requireRole('admin'), (req, res) => {
  const cur = db.prepare('SELECT * FROM tariffs WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Не найден' });
  const { name, visitsCount, durationDays, price, comment, extraLessonsSeparate } = req.body || {};
  db.prepare(`UPDATE tariffs SET name=?, visits_count=?, duration_days=?, price=?, comment=?, extra_lessons_separate=? WHERE id=?`)
    .run(
      name !== undefined ? String(name).trim() : cur.name,
      visitsCount !== undefined ? parseInt(visitsCount) || 0 : cur.visits_count,
      durationDays !== undefined ? parseInt(durationDays) || 0 : cur.duration_days,
      price !== undefined ? parseInt(price) || 0 : cur.price,
      comment !== undefined ? comment : cur.comment,
      extraLessonsSeparate !== undefined ? (extraLessonsSeparate ? 1 : 0) : cur.extra_lessons_separate,
      req.params.id
    );
  res.json(rowToTariff(db.prepare('SELECT * FROM tariffs WHERE id = ?').get(req.params.id)));
});
router.delete('/tariffs/:id', requireRole('admin'), (req, res) => {
  const info = db.prepare('DELETE FROM tariffs WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Не найден' });
  res.json({ ok: true });
});

/* ============================================================
   ГРУППЫ /api/groups (+ /:id/schedule, /:id/members)
   ============================================================ */
const GROUP_SELECT = `
  SELECT g.*, b.name AS branch_name, t.name AS teacher_name, a.name AS assistant_name,
         m.title AS course_title,
         (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count
  FROM groups g
  LEFT JOIN branches b ON b.id = g.branch_id
  LEFT JOIN users t ON t.id = g.teacher_id
  LEFT JOIN users a ON a.id = g.assistant_id
  LEFT JOIN modules m ON m.id = g.course_id
`;

router.get('/groups', (req, res) => {
  if (!isStaff(req.user)) return res.status(403).json({ error: 'Недостаточно прав' });
  let rows;
  if (req.user.role === 'admin') {
    rows = db.prepare(`${GROUP_SELECT} ORDER BY g.status, g.name`).all();
  } else {
    rows = db.prepare(`${GROUP_SELECT} WHERE g.teacher_id = ? OR g.assistant_id = ? ORDER BY g.name`)
      .all(req.user.id, req.user.id);
  }
  res.json(rows.map(rowToGroup));
});

router.get('/groups/:id', (req, res) => {
  if (!isStaff(req.user)) return res.status(403).json({ error: 'Недостаточно прав' });
  const g = db.prepare(`${GROUP_SELECT} WHERE g.id = ?`).get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Не найдена' });
  if (req.user.role !== 'admin' && g.teacher_id !== req.user.id && g.assistant_id !== req.user.id) {
    return res.status(403).json({ error: 'Это не ваша группа' });
  }
  res.json(rowToGroup(g));
});

router.post('/groups', requireRole('admin'), (req, res) => {
  const { name, courseId, branchId, teacherId, assistantId, lessonKind, status } = req.body || {};
  if (!name || !branchId) return res.status(400).json({ error: 'name, branchId обязательны' });
  const id = genId('grp');
  db.prepare(`INSERT INTO groups (id, name, course_id, branch_id, teacher_id, assistant_id, lesson_kind, status)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, String(name).trim(), courseId || null, branchId, teacherId || null, assistantId || null,
         ['main', 'extra'].includes(lessonKind) ? lessonKind : 'main',
         ['active', 'archived'].includes(status) ? status : 'active');
  res.status(201).json(rowToGroup(db.prepare(`${GROUP_SELECT} WHERE g.id = ?`).get(id)));
});

router.put('/groups/:id', requireRole('admin'), (req, res) => {
  const cur = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Не найдена' });
  const { name, courseId, branchId, teacherId, assistantId, lessonKind, status } = req.body || {};
  db.prepare(`UPDATE groups SET name=?, course_id=?, branch_id=?, teacher_id=?, assistant_id=?, lesson_kind=?, status=? WHERE id=?`)
    .run(
      name !== undefined ? String(name).trim() : cur.name,
      courseId !== undefined ? (courseId || null) : cur.course_id,
      branchId || cur.branch_id,
      teacherId || cur.teacher_id,
      assistantId !== undefined ? (assistantId || null) : cur.assistant_id,
      lessonKind && ['main', 'extra'].includes(lessonKind) ? lessonKind : cur.lesson_kind,
      status && ['active', 'archived'].includes(status) ? status : cur.status,
      req.params.id
    );
  res.json(rowToGroup(db.prepare(`${GROUP_SELECT} WHERE g.id = ?`).get(req.params.id)));
});

router.delete('/groups/:id', requireRole('admin'), (req, res) => {
  const info = db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Не найдена' });
  res.json({ ok: true });
});

// --- Расписание группы ---
router.get('/groups/:id/schedule', (req, res) => {
  if (!isStaff(req.user)) return res.status(403).json({ error: 'Недостаточно прав' });
  const rows = db.prepare('SELECT * FROM group_schedule WHERE group_id = ? ORDER BY weekday, start_time').all(req.params.id);
  res.json(rows.map(r => ({ id: r.id, groupId: r.group_id, weekday: r.weekday, startTime: r.start_time, durationMin: r.duration_min })));
});
router.post('/groups/:id/schedule', requireRole('admin'), (req, res) => {
  const { weekday, startTime, durationMin } = req.body || {};
  if (weekday == null || !startTime || !durationMin) return res.status(400).json({ error: 'weekday, startTime, durationMin обязательны' });
  const wd = parseInt(weekday);
  if (wd < 0 || wd > 6) return res.status(400).json({ error: 'weekday 0..6 (0=Вс)' });
  const id = genId('gs');
  db.prepare('INSERT INTO group_schedule (id, group_id, weekday, start_time, duration_min) VALUES (?,?,?,?,?)')
    .run(id, req.params.id, wd, String(startTime), parseInt(durationMin) || 60);
  res.status(201).json({ id, groupId: req.params.id, weekday: wd, startTime, durationMin: parseInt(durationMin) || 60 });
});
router.delete('/groups/:gid/schedule/:sid', requireRole('admin'), (req, res) => {
  const info = db.prepare('DELETE FROM group_schedule WHERE id = ? AND group_id = ?').run(req.params.sid, req.params.gid);
  if (!info.changes) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// --- Состав группы ---
router.get('/groups/:id/members', (req, res) => {
  if (!isStaff(req.user)) return res.status(403).json({ error: 'Недостаточно прав' });
  if (req.user.role !== 'admin') {
    const g = db.prepare('SELECT teacher_id, assistant_id FROM groups WHERE id = ?').get(req.params.id);
    if (!g || (g.teacher_id !== req.user.id && g.assistant_id !== req.user.id)) {
      return res.status(403).json({ error: 'Это не ваша группа' });
    }
  }
  const rows = db.prepare(`
    SELECT gm.*, u.name, u.login, u.avatar_url FROM group_members gm
    JOIN users u ON u.id = gm.student_id
    WHERE gm.group_id = ? ORDER BY u.name
  `).all(req.params.id);
  res.json(rows.map(r => ({
    id: r.id, studentId: r.student_id, groupId: r.group_id, since: r.since, until: r.until || null,
    name: r.name, login: r.login, avatarUrl: r.avatar_url || null,
  })));
});
router.post('/groups/:id/members', requireRole('admin'), (req, res) => {
  const { studentId, since, until } = req.body || {};
  if (!studentId) return res.status(400).json({ error: 'studentId обязателен' });
  const exists = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND student_id = ? AND (until IS NULL OR until > ?)')
    .get(req.params.id, studentId, Date.now());
  if (exists) return res.status(409).json({ error: 'Ученик уже в этой группе' });
  const id = genId('gm');
  db.prepare('INSERT INTO group_members (id, student_id, group_id, since, until) VALUES (?,?,?,?,?)')
    .run(id, studentId, req.params.id, since || Date.now(), until || null);
  res.status(201).json({ id, studentId, groupId: req.params.id });
});
router.delete('/groups/:gid/members/:mid', requireRole('admin'), (req, res) => {
  const info = db.prepare('DELETE FROM group_members WHERE id = ? AND group_id = ?').run(req.params.mid, req.params.gid);
  if (!info.changes) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

/* ============================================================
   КАРТОЧКИ КЛИЕНТОВ /api/students-crm
   ============================================================ */
const CRM_SELECT = `
  SELECT c.*, b.name AS branch_name, t.name AS tariff_name, u.login, u.name
  FROM students_crm c
  LEFT JOIN branches b ON b.id = c.branch_id
  LEFT JOIN tariffs t ON t.id = c.tariff_id
  LEFT JOIN users u ON u.id = c.user_id
`;

// ученики групп учителя/ассистента
router.get('/students-crm/me-as-teacher', (req, res) => {
  if (!['teacher', 'assistant'].includes(req.user.role)) return res.status(403).json({ error: 'Только для учителей' });
  const gids = teacherGroupIds(req.user.id);
  if (!gids.length) return res.json([]);
  const placeholders = gids.map(() => '?').join(',');
  const studentIds = db.prepare(`SELECT DISTINCT student_id FROM group_members WHERE group_id IN (${placeholders})`).all(...gids).map(r => r.student_id);
  if (!studentIds.length) return res.json([]);
  const sp = studentIds.map(() => '?').join(',');
  const rows = db.prepare(`${CRM_SELECT} WHERE c.user_id IN (${sp}) ORDER BY c.full_name`).all(...studentIds);
  const showSubs = hasPermission(req.user, 'see_subscriptions');
  res.json(rows.map(r => {
    const o = rowToCrm(r);
    // скрываем чувствительные ПД от учителей
    delete o.documentId; o.parentPhone = o.parentPhone ? '••••' : null;
    if (!showSubs) { o.visitsLeft = null; o.tariffName = null; }
    return o;
  }));
});

router.get('/students-crm', requireRole('admin'), (req, res) => {
  const { branch, group, status, manager } = req.query;
  const p2 = [];
  let base = CRM_SELECT;
  if (group) { base += ` JOIN group_members gm ON gm.student_id = c.user_id AND gm.group_id = ? `; p2.push(group); }
  const w = [];
  if (branch) { w.push('c.branch_id = ?'); p2.push(branch); }
  if (status) { w.push('c.status = ?'); p2.push(status); }
  if (manager) { w.push('c.responsible_manager_id = ?'); p2.push(manager); }
  base += (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY c.full_name';
  res.json(db.prepare(base).all(...p2).map(rowToCrm));
});

router.get('/students-crm/:id', requireRole('admin'), (req, res) => {
  const row = db.prepare(`${CRM_SELECT} WHERE c.user_id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Карточка не найдена' });
  res.json(rowToCrm(row));
});

router.post('/students-crm', requireRole('admin'), (req, res) => {
  const b = req.body || {};
  if (!b.userId || !b.fullName) return res.status(400).json({ error: 'userId, fullName обязательны' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(b.userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const exists = db.prepare('SELECT 1 FROM students_crm WHERE user_id = ?').get(b.userId);
  if (exists) return res.status(409).json({ error: 'Карточка уже существует' });

  // если выдан абонемент — рассчитаем visits_left из тарифа
  let visitsLeft = parseInt(b.visitsLeft) || 0;
  if (b.tariffId && b.subscriptionIssuedAt && !b.visitsLeft) {
    const tar = db.prepare('SELECT visits_count FROM tariffs WHERE id = ?').get(b.tariffId);
    if (tar) visitsLeft = tar.visits_count;
  }
  db.prepare(`INSERT INTO students_crm
    (user_id, full_name, birth_date, gender, branch_id, tariff_id, subscription_issued_at,
     visits_left, status, responsible_manager_id, parent_name, parent_phone, document_id,
     comment, video_consent, video_consent_date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(b.userId, String(b.fullName).trim(), b.birthDate || null,
         ['m', 'f'].includes(b.gender) ? b.gender : null, b.branchId || null, b.tariffId || null,
         b.subscriptionIssuedAt || null, visitsLeft,
         ['active', 'frozen', 'inactive'].includes(b.status) ? b.status : 'active',
         b.responsibleManagerId || null, b.parentName || null, b.parentPhone || null,
         b.documentId || null, b.comment || null,
         b.videoConsent ? 1 : 0, b.videoConsent ? (b.videoConsentDate || Date.now()) : null);
  res.status(201).json(rowToCrm(db.prepare(`${CRM_SELECT} WHERE c.user_id = ?`).get(b.userId)));
});

router.put('/students-crm/:id', requireRole('admin'), (req, res) => {
  const cur = db.prepare('SELECT * FROM students_crm WHERE user_id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Карточка не найдена' });
  const b = req.body || {};
  const pick = (camel, snake) => b[camel] !== undefined ? b[camel] : cur[snake];

  // авто-пересчёт остатка при смене тарифа + новой дате выдачи
  let visitsLeft = b.visitsLeft !== undefined ? (parseInt(b.visitsLeft) || 0) : cur.visits_left;
  if (b.tariffId && b.subscriptionIssuedAt && b.tariffId !== cur.tariff_id && b.visitsLeft === undefined) {
    const tar = db.prepare('SELECT visits_count FROM tariffs WHERE id = ?').get(b.tariffId);
    if (tar) visitsLeft = tar.visits_count;
  }

  db.prepare(`UPDATE students_crm SET
    full_name=?, birth_date=?, gender=?, branch_id=?, tariff_id=?, subscription_issued_at=?,
    visits_left=?, status=?, responsible_manager_id=?, parent_name=?, parent_phone=?,
    document_id=?, comment=?, video_consent=?, video_consent_date=? WHERE user_id=?`)
    .run(
      b.fullName !== undefined ? String(b.fullName).trim() : cur.full_name,
      pick('birthDate', 'birth_date'),
      b.gender !== undefined ? (['m', 'f'].includes(b.gender) ? b.gender : null) : cur.gender,
      pick('branchId', 'branch_id'),
      pick('tariffId', 'tariff_id'),
      pick('subscriptionIssuedAt', 'subscription_issued_at'),
      visitsLeft,
      b.status && ['active', 'frozen', 'inactive'].includes(b.status) ? b.status : cur.status,
      pick('responsibleManagerId', 'responsible_manager_id'),
      pick('parentName', 'parent_name'),
      pick('parentPhone', 'parent_phone'),
      pick('documentId', 'document_id'),
      pick('comment', 'comment'),
      b.videoConsent !== undefined ? (b.videoConsent ? 1 : 0) : cur.video_consent,
      b.videoConsent !== undefined ? (b.videoConsent ? (b.videoConsentDate || Date.now()) : null) : cur.video_consent_date,
      req.params.id
    );
  res.json(rowToCrm(db.prepare(`${CRM_SELECT} WHERE c.user_id = ?`).get(req.params.id)));
});

router.delete('/students-crm/:id', requireRole('admin'), (req, res) => {
  const info = db.prepare('DELETE FROM students_crm WHERE user_id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Не найдена' });
  res.json({ ok: true });
});

module.exports = router;
