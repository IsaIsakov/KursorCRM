/* ============================================================
   KURSOR — Журнал занятий, посещаемость, домашние задания.
   /api/lesson-sessions, /api/attendance, /api/homework
   ============================================================ */
const express = require('express');
const db = require('./db');
const { authRequired, requireRole } = require('./auth');
const { genId } = require('./util');
const { hasPermission } = require('./permissions');

const router = express.Router();
router.use(authRequired);

function canManageGroup(user, groupId) {
  if (user.role === 'admin') return true;
  if (!['teacher', 'assistant'].includes(user.role)) return false;
  const g = db.prepare('SELECT teacher_id, assistant_id FROM groups WHERE id = ?').get(groupId);
  return g && (g.teacher_id === user.id || g.assistant_id === user.id);
}

/* ============================================================
   ЗАНЯТИЯ /api/lesson-sessions
   ============================================================ */
router.get('/lesson-sessions', (req, res) => {
  const { group_id, from, to } = req.query;
  if (!group_id) return res.status(400).json({ error: 'group_id обязателен' });
  if (!canManageGroup(req.user, group_id) && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Это не ваша группа' });
  }
  const where = ['ls.group_id = ?']; const params = [group_id];
  if (from) { where.push('ls.date >= ?'); params.push(from); }
  if (to) { where.push('ls.date <= ?'); params.push(to); }
  const rows = db.prepare(`
    SELECT ls.*, u.name AS conductor_name,
      (SELECT COUNT(*) FROM attendance a WHERE a.lesson_session_id = ls.id AND a.status IN ('present','late')) AS present_count
    FROM lesson_sessions ls
    LEFT JOIN users u ON u.id = ls.conducted_by
    WHERE ${where.join(' AND ')}
    ORDER BY ls.date DESC, ls.created_at DESC
  `).all(...params);
  res.json(rows.map(r => ({
    id: r.id, groupId: r.group_id, date: r.date, topic: r.topic || '',
    conductedBy: r.conducted_by || null, conductorName: r.conductor_name || null,
    createdAt: r.created_at, presentCount: r.present_count || 0,
  })));
});

router.post('/lesson-sessions', (req, res) => {
  const { groupId, date, topic } = req.body || {};
  if (!groupId || !date) return res.status(400).json({ error: 'groupId, date обязательны' });
  if (!canManageGroup(req.user, groupId)) return res.status(403).json({ error: 'Это не ваша группа' });
  if (req.user.role !== 'admin' && !hasPermission(req.user, 'conduct_lessons')) {
    return res.status(403).json({ error: 'Нет права проводить занятия' });
  }
  const id = genId('ls');
  db.prepare('INSERT INTO lesson_sessions (id, group_id, date, topic, conducted_by, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, groupId, date, topic || null, req.user.id, Date.now());
  res.status(201).json({ id, groupId, date, topic: topic || '', conductedBy: req.user.id });
});

router.delete('/lesson-sessions/:id', (req, res) => {
  const ls = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(req.params.id);
  if (!ls) return res.status(404).json({ error: 'Не найдено' });
  if (!canManageGroup(req.user, ls.group_id)) return res.status(403).json({ error: 'Это не ваша группа' });
  // вернуть посещения, списанные за это занятие
  // «present» и «late» в равной степени списывали визит — возвращаем оба.
  const present = db.prepare("SELECT student_id FROM attendance WHERE lesson_session_id = ? AND status IN ('present','late')").all(req.params.id);
  const refund = db.prepare("UPDATE students_crm SET visits_left = visits_left + 1 WHERE user_id = ? AND status='active'");
  const txn = db.transaction(() => {
    for (const p of present) refund.run(p.student_id);
    db.prepare('DELETE FROM lesson_sessions WHERE id = ?').run(req.params.id);
  });
  txn();
  res.json({ ok: true });
});

// Детали занятия с посещаемостью
router.get('/lesson-sessions/:id/attendance', (req, res) => {
  const ls = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(req.params.id);
  if (!ls) return res.status(404).json({ error: 'Не найдено' });
  if (!canManageGroup(req.user, ls.group_id) && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Недоступно' });
  }
  const rows = db.prepare(`
    SELECT a.*, u.name FROM attendance a JOIN users u ON u.id = a.student_id
    WHERE a.lesson_session_id = ? ORDER BY u.name
  `).all(req.params.id);
  res.json(rows.map(r => ({ studentId: r.student_id, name: r.name, status: r.status, markedAt: r.marked_at })));
});

/* ============================================================
   ПОСЕЩАЕМОСТЬ /api/attendance (массовое сохранение)
   Тело: { lessonSessionId, records: [{studentId, status}] }
   Логика списания абонемента — см. ТЗ 3.2 / 3.4.
   ============================================================ */
router.post('/attendance', (req, res) => {
  const { lessonSessionId, records } = req.body || {};
  if (!lessonSessionId || !Array.isArray(records)) {
    return res.status(400).json({ error: 'lessonSessionId и массив records обязательны' });
  }
  const ls = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(lessonSessionId);
  if (!ls) return res.status(404).json({ error: 'Занятие не найдено' });
  if (!canManageGroup(req.user, ls.group_id)) return res.status(403).json({ error: 'Это не ваша группа' });
  if (req.user.role !== 'admin' && !hasPermission(req.user, 'conduct_lessons')) {
    return res.status(403).json({ error: 'Нет права отмечать посещаемость' });
  }

  const getPrev = db.prepare('SELECT status FROM attendance WHERE lesson_session_id = ? AND student_id = ?');
  const upsert = db.prepare(`
    INSERT INTO attendance (id, lesson_session_id, student_id, status, marked_at)
    VALUES (?,?,?,?,?)
    ON CONFLICT(lesson_session_id, student_id) DO UPDATE SET status=excluded.status, marked_at=excluded.marked_at
  `);
  const getCrm = db.prepare("SELECT status, visits_left FROM students_crm WHERE user_id = ?");
  const decVisit = db.prepare("UPDATE students_crm SET visits_left = MAX(0, visits_left - 1) WHERE user_id = ?");
  const incVisit = db.prepare("UPDATE students_crm SET visits_left = visits_left + 1 WHERE user_id = ?");

  const charged = [];
  const txn = db.transaction(() => {
    for (const rec of records) {
      const { studentId, status } = rec;
      // Разрешённые статусы: present, absent, excused (уважительно), late (опоздал).
      // «Опоздал» трактуется как присутствие для списания абонемента (см. ниже).
      if (!studentId || !['present', 'absent', 'excused', 'late'].includes(status)) {
        // Не «continue» молча — явно логируем, чтобы не было «сохранено» для брака.
        console.warn('[attendance] пропущена запись: studentId=%s status=%s', studentId, status);
        continue;
      }
      const prev = getPrev.get(lessonSessionId, studentId);
      const prevStatus = prev ? prev.status : null;
      upsert.run(genId('att'), lessonSessionId, studentId, status, Date.now());

      const crm = getCrm.get(studentId);
      if (!crm) continue; // нет CRM-карточки — не списываем
      // Для списания «опоздал» (late) считаем присутствием — ученик всё-таки был на занятии.
      const isPresent = (s) => s === 'present' || s === 'late';
      // списание только для активных абонементов
      if (isPresent(status) && !isPresent(prevStatus)) {
        if (crm.status === 'active') { decVisit.run(studentId); charged.push({ studentId, action: 'charged' }); }
      } else if (isPresent(prevStatus) && !isPresent(status)) {
        // возврат посещения при исправлении
        if (crm.status === 'active') { incVisit.run(studentId); charged.push({ studentId, action: 'refunded' }); }
      }
    }
  });
  txn();

  // -------- Проверка: всем присутствовавшим ученикам загружен отчёт (работа/видео)? --------
  // Если нет — предупреждаем того, кто проводил занятие, и всех админов (уведомление "красным").
  // Используем детерминированный id уведомления (привязан к занятию+получателю), чтобы при
  // повторном сохранении обновлять одно и то же напоминание, а не плодить дубликаты, и снимать
  // его автоматически, как только все отчёты будут загружены.
  let missingReports = [];
  try {
    const presentIds = [...new Set(
      records.filter(r => r && r.studentId && ['present', 'late'].includes(r.status)).map(r => r.studentId)
    )];
    if (presentIds.length) {
      const ph = presentIds.map(() => '?').join(',');
      const reported = new Set(
        db.prepare(`SELECT DISTINCT student_id FROM session_artifacts WHERE lesson_session_id = ? AND deleted = 0 AND student_id IN (${ph})`)
          .all(lessonSessionId, ...presentIds)
          .map(r => r.student_id)
      );
      const missingIds = presentIds.filter(sid => !reported.has(sid));
      if (missingIds.length) {
        const mph = missingIds.map(() => '?').join(',');
        const names = db.prepare(`SELECT id, name FROM users WHERE id IN (${mph})`).all(...missingIds);
        const nameById = Object.fromEntries(names.map(n => [n.id, n.name]));
        missingReports = missingIds.map(sid => ({ studentId: sid, name: nameById[sid] || sid }));
      }

      const group = db.prepare('SELECT name FROM groups WHERE id = ?').get(ls.group_id);
      const groupName = group ? group.name : '';
      const recipients = new Set([req.user.id]);
      db.prepare("SELECT id FROM users WHERE role = 'admin'").all().forEach(a => recipients.add(a.id));

      const del = db.prepare('DELETE FROM notifications WHERE id = ?');
      const put = db.prepare(`
        INSERT OR REPLACE INTO notifications (id, user_id, type, text, link, channel, read, created_at)
        VALUES (?, ?, 'missing_report', ?, '/admin/index.html', 'in_app', 0, ?)
      `);
      const namesList = missingReports.map(m => m.name).join(', ');
      const roleLabel = req.user.role === 'assistant' ? 'ассистент' : req.user.role === 'admin' ? 'администратор' : 'преподаватель';
      for (const uid of recipients) {
        const notifId = `missing_report_${lessonSessionId}_${uid}`;
        if (missingReports.length) {
          const text = uid === req.user.id
            ? `Вы не загрузили отчёт (работа/видео) по занятию «${groupName}» для: ${namesList}`
            : `${req.user.name || 'Сотрудник'} (${roleLabel}) не загрузил(а) отчёт по занятию «${groupName}» для: ${namesList}`;
          put.run(notifId, uid, text, Date.now());
        } else {
          del.run(notifId); // все отчёты загружены — снимаем напоминание
        }
      }
    }
  } catch (e) {
    console.error('[attendance] проверка отчётов не выполнена:', e.message);
  }

  res.json({ ok: true, charged, missingReports });
});

/* ============================================================
   ДОМАШНИЕ ЗАДАНИЯ /api/homework
   ============================================================ */
function rowToHw(r) {
  let taskIds = [];
  try { taskIds = r.task_ids ? JSON.parse(r.task_ids) : []; } catch {}
  return {
    id: r.id, lessonSessionId: r.lesson_session_id, moduleId: r.module_id || null,
    taskIds, dueDate: r.due_date || null, createdAt: r.created_at,
    groupId: r.group_id || null, sessionDate: r.session_date || null,
    moduleTitle: r.module_title || null,
  };
}

router.post('/homework', (req, res) => {
  const { lessonSessionId, moduleId, taskIds, dueDate, studentIds } = req.body || {};
  if (!lessonSessionId) return res.status(400).json({ error: 'lessonSessionId обязателен' });
  const ls = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(lessonSessionId);
  if (!ls) return res.status(404).json({ error: 'Занятие не найдено' });
  if (!canManageGroup(req.user, ls.group_id)) return res.status(403).json({ error: 'Это не ваша группа' });

  const id = genId('hw');
  db.prepare('INSERT INTO homework (id, lesson_session_id, module_id, task_ids, due_date, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, lessonSessionId, moduleId || null, taskIds && taskIds.length ? JSON.stringify(taskIds) : null, dueDate || null, Date.now());

  // назначения: конкретным ученикам или всей группе (по составу)
  let targets = Array.isArray(studentIds) && studentIds.length
    ? studentIds
    : db.prepare('SELECT DISTINCT student_id FROM group_members WHERE group_id = ?').all(ls.group_id).map(r => r.student_id);
  const insA = db.prepare('INSERT INTO homework_assignments (id, homework_id, student_id) VALUES (?,?,?)');
  const txn = db.transaction(() => { for (const sid of targets) insA.run(genId('ha'), id, sid); });
  txn();

  // уведомления ученикам (фаза 6, мягко — если таблица есть)
  try {
    const insN = db.prepare('INSERT INTO notifications (id, user_id, type, text, link, channel, read, created_at) VALUES (?,?,?,?,?,?,0,?)');
    const txnN = db.transaction(() => {
      for (const sid of targets) insN.run(genId('ntf'), sid, 'homework', 'Назначено новое домашнее задание', '/pages/dashboard.html', 'in_app', Date.now());
    });
    txnN();
  } catch {}

  res.status(201).json({ id, lessonSessionId, moduleId: moduleId || null, taskIds: taskIds || [], dueDate: dueDate || null, assigned: targets.length });
});

router.get('/homework', (req, res) => {
  const { group_id, student_id } = req.query;
  if (group_id) {
    if (!canManageGroup(req.user, group_id) && req.user.role !== 'admin') return res.status(403).json({ error: 'Недоступно' });
    const rows = db.prepare(`
      SELECT h.*, ls.group_id, ls.date AS session_date, m.title AS module_title
      FROM homework h JOIN lesson_sessions ls ON ls.id = h.lesson_session_id
      LEFT JOIN modules m ON m.id = h.module_id
      WHERE ls.group_id = ? ORDER BY h.created_at DESC
    `).all(group_id);
    return res.json(rows.map(rowToHw));
  }
  if (student_id) {
    if (req.user.role === 'student' && req.user.id !== student_id) return res.status(403).json({ error: 'Недоступно' });
    const rows = db.prepare(`
      SELECT h.*, ls.group_id, ls.date AS session_date, m.title AS module_title
      FROM homework h
      JOIN homework_assignments ha ON ha.homework_id = h.id
      JOIN lesson_sessions ls ON ls.id = h.lesson_session_id
      LEFT JOIN modules m ON m.id = h.module_id
      WHERE ha.student_id = ? ORDER BY h.created_at DESC
    `).all(student_id);
    return res.json(rows.map(rowToHw));
  }
  res.status(400).json({ error: 'Нужен group_id или student_id' });
});

// ДЗ текущего ученика + статусы выполнения (из task_progress)
router.get('/homework/me', requireRole('student'), (req, res) => {
  const rows = db.prepare(`
    SELECT h.*, ls.date AS session_date, m.title AS module_title
    FROM homework h
    JOIN homework_assignments ha ON ha.homework_id = h.id
    JOIN lesson_sessions ls ON ls.id = h.lesson_session_id
    LEFT JOIN modules m ON m.id = h.module_id
    WHERE ha.student_id = ? ORDER BY h.created_at DESC
  `).all(req.user.id);

  const out = rows.map(r => {
    const hw = rowToHw(r);
    // статусы задач
    const ids = [...hw.taskIds];
    if (hw.moduleId) {
      const modTasks = db.prepare('SELECT id FROM tasks WHERE module_id = ?').all(hw.moduleId).map(t => t.id);
      for (const tid of modTasks) if (!ids.includes(tid)) ids.push(tid);
    }
    const statuses = {};
    for (const tid of ids) {
      const tp = db.prepare("SELECT status FROM task_progress WHERE user_id = ? AND task_id = ?").get(req.user.id, tid);
      statuses[tid] = tp ? tp.status : 'new';
    }
    const total = ids.length;
    const done = Object.values(statuses).filter(s => s === 'done').length;
    return { ...hw, taskList: ids, statuses, total, done, allDone: total > 0 && done === total };
  });
  res.json(out);
});

router.delete('/homework/:id', (req, res) => {
  const hw = db.prepare('SELECT h.*, ls.group_id FROM homework h JOIN lesson_sessions ls ON ls.id = h.lesson_session_id WHERE h.id = ?').get(req.params.id);
  if (!hw) return res.status(404).json({ error: 'Не найдено' });
  if (!canManageGroup(req.user, hw.group_id)) return res.status(403).json({ error: 'Это не ваша группа' });
  db.prepare('DELETE FROM homework WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ============================================================
   КАЛЕНДАРЬ /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD[&branch_id=]
   Разворачивает недельное расписание групп в конкретные даты диапазона
   и присоединяет уже проведённые занятия (lesson_sessions).
   weekday: 0=Вс..6=Сб (как у JS Date.getDay()).
   ============================================================ */

// Безопасный разбор даты занятия: ms-число, числовая строка или ISO-строка.
function _toDateServer(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isNaN(v) ? null : new Date(v);
  const s = String(v).trim();
  const d = /^\d{8,}$/.test(s) ? new Date(Number(s)) : new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
// Локальная дата в формат YYYY-MM-DD
function _ymd(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

router.get('/calendar', (req, res) => {
  const { from, to, branch_id } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from и to обязательны (YYYY-MM-DD)' });
  const fromD = _toDateServer(from), toD = _toDateServer(to);
  if (!fromD || !toD) return res.status(400).json({ error: 'Некорректные from/to' });

  // Группы, видимые пользователю
  let groups = db.prepare(`
    SELECT g.*, b.name AS branch_name, m.title AS course_title,
           tu.name AS teacher_name, au.name AS assistant_name
    FROM groups g
    LEFT JOIN branches b ON b.id = g.branch_id
    LEFT JOIN modules  m ON m.id = g.course_id
    LEFT JOIN users   tu ON tu.id = g.teacher_id
    LEFT JOIN users   au ON au.id = g.assistant_id
    WHERE g.status = 'active'
  `).all();
  if (branch_id) groups = groups.filter(g => g.branch_id === branch_id);
  if (req.user.role !== 'admin') {
    groups = groups.filter(g => g.teacher_id === req.user.id || g.assistant_id === req.user.id);
  }
  if (!groups.length) return res.json([]);

  const groupIds = groups.map(g => g.id);
  const gById = Object.fromEntries(groups.map(g => [g.id, g]));
  const ph = groupIds.map(() => '?').join(',');

  const schedules = db.prepare(`SELECT * FROM group_schedule WHERE group_id IN (${ph})`).all(...groupIds);

  // Все занятия этих групп; фильтруем по дате в JS (date хранится по-разному).
  const sessionRows = db.prepare(`
    SELECT ls.*,
      (SELECT COUNT(*) FROM attendance a WHERE a.lesson_session_id = ls.id AND a.status IN ('present','late')) AS present_count
    FROM lesson_sessions ls WHERE ls.group_id IN (${ph})
  `).all(...groupIds);

  // Карта занятий по ключу groupId|YYYY-MM-DD (массив — на случай нескольких в день)
  const sessByKey = {};
  for (const s of sessionRows) {
    const d = _toDateServer(s.date);
    if (!d) continue;
    const key = s.group_id + '|' + _ymd(d);
    (sessByKey[key] = sessByKey[key] || []).push(s);
  }

  const events = [];
  const used = new Set(); // занятые занятия (по id), чтобы не дублировать
  // Идём по дням диапазона
  for (let d = new Date(fromD.getFullYear(), fromD.getMonth(), fromD.getDate());
       d <= toD; d.setDate(d.getDate() + 1)) {
    const ymd = _ymd(d), wd = d.getDay();
    for (const sc of schedules) {
      if (sc.weekday !== wd) continue;
      const g = gById[sc.group_id];
      if (!g) continue;
      const key = sc.group_id + '|' + ymd;
      const pool = sessByKey[key] || [];
      const sess = pool.find(s => !used.has(s.id));
      if (sess) used.add(sess.id);
      events.push({
        date: ymd, weekday: wd, startTime: sc.start_time, durationMin: sc.duration_min,
        groupId: g.id, groupName: g.name, lessonKind: g.lesson_kind,
        branchId: g.branch_id, branchName: g.branch_name || '',
        courseTitle: g.course_title || '', teacherName: g.teacher_name || '',
        assistantName: g.assistant_name || '',
        sessionId: sess ? sess.id : null,
        conducted: !!sess,
        presentCount: sess ? (sess.present_count || 0) : 0,
        topic: sess ? (sess.topic || '') : '',
      });
    }
  }

  // Внеплановые занятия (есть запись, но нет слота в расписании в этот день)
  for (const s of sessionRows) {
    if (used.has(s.id)) continue;
    const d = _toDateServer(s.date);
    if (!d || d < fromD || d > toD) continue;
    const g = gById[s.group_id]; if (!g) continue;
    events.push({
      date: _ymd(d), weekday: d.getDay(), startTime: null, durationMin: 60,
      groupId: g.id, groupName: g.name, lessonKind: g.lesson_kind,
      branchId: g.branch_id, branchName: g.branch_name || '',
      courseTitle: g.course_title || '', teacherName: g.teacher_name || '',
      assistantName: g.assistant_name || '',
      sessionId: s.id, conducted: true, adhoc: true,
      presentCount: s.present_count || 0, topic: s.topic || '',
    });
  }

  res.json(events);
});

module.exports = router;
