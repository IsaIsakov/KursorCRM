/* ============================================================
   KURSOR — Журнал занятий, посещаемость, домашние задания.
   /api/lesson-sessions, /api/attendance, /api/homework
   ============================================================ */
const express = require('express');
const db = require('./db');
const { authRequired, requireRole } = require('./auth');
const { genId } = require('./util');
const { hasPermission } = require('./permissions');
const { canAccessStudent } = require('./access-scope');
const { activeMemberIds, validateGroupStudents, sessionTimestamp } = require('./group-scope');
const subscriptions = require('./subscriptions').createSubscriptionService(db);
const { z, id: idSchema, optionalText, timestamp, validateBody } = require('./validation');

const router = express.Router();
router.use(authRequired);

const lessonSchema = z.strictObject({ groupId: idSchema, date: timestamp, topic: optionalText(500) });
const attendanceSchema = z.strictObject({ lessonSessionId: idSchema, records: z.array(z.strictObject({ studentId: idSchema, status: z.enum(['present','absent','excused','late']), reason: optionalText(1000) })).max(500) });
const homeworkSchema = z.strictObject({ lessonSessionId: idSchema, moduleId: idSchema.nullable().optional(), taskIds: z.array(z.coerce.number().int().positive()).max(500).optional(), dueDate: timestamp.nullable().optional(), studentIds: z.array(idSchema).max(500).optional() });

function canManageGroup(user, groupId) {
  if (user.role === 'admin') return true;
  if (!['teacher', 'assistant'].includes(user.role)) return false;
  const g = db.prepare('SELECT teacher_id, assistant_id,branch_id FROM groups WHERE id = ?').get(groupId);
  if (!g) return false;
  if (g.teacher_id === user.id || g.assistant_id === user.id) return true;
  // Ассистент выполняет роль куратора филиала: назначение хотя бы в одну группу
  // филиала даёт ему управление учебным календарём этого филиала.
  return user.role === 'assistant' && !!db.prepare('SELECT 1 FROM groups WHERE assistant_id=? AND branch_id=? LIMIT 1').get(user.id,g.branch_id);
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

router.post('/lesson-sessions', validateBody(lessonSchema), (req, res) => {
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
  const present = db.prepare("SELECT student_id FROM attendance WHERE lesson_session_id = ? AND status IN ('present','late','absent')").all(req.params.id);
  const txn = db.transaction(() => {
    for (const p of present) {
      const prefix = `${req.params.id}:${p.student_id}:%`;
      const net = db.prepare(`SELECT COALESCE(SUM(delta),0) AS total FROM subscription_transactions
        WHERE student_id=? AND reference_id LIKE ? AND reference_type IN ('lesson_session','lesson_session_refund')`)
        .get(p.student_id,prefix).total;
      if (net < 0) subscriptions.applyDelta({ studentId:p.student_id,delta:-net,type:'refund',referenceType:'lesson_delete',
        referenceId:`${req.params.id}:${p.student_id}`,actorId:req.user.id,note:'Удаление занятия',allowInactive:true });
    }
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
    SELECT a.*, u.name,sa.class_score,sa.homework_score,sa.homework_status,sa.engagement,sa.difficulty,sa.interest,sa.private_comment
    FROM attendance a JOIN users u ON u.id = a.student_id
    LEFT JOIN student_assessments sa ON sa.lesson_session_id=a.lesson_session_id AND sa.student_id=a.student_id
    WHERE a.lesson_session_id = ? ORDER BY u.name
  `).all(req.params.id);
  const lessonAt = sessionTimestamp(ls.date);
  const notices = db.prepare("SELECT student_id,reason FROM absence_notices WHERE group_id=? AND lesson_at BETWEEN ? AND ? AND status!='cancelled'")
    .all(ls.group_id, lessonAt - 60000, lessonAt + 60000);
  const noticeMap = new Map(notices.map(n => [n.student_id, n.reason]));
  const out = rows.map(r => ({ studentId: r.student_id, name: r.name, status: r.status, reason: r.reason || noticeMap.get(r.student_id) || '', parentNotice: noticeMap.has(r.student_id), markedAt: r.marked_at,
    classScore:r.class_score,homeworkScore:r.homework_score,homeworkStatus:r.homework_status||'none',engagement:r.engagement,difficulty:r.difficulty,interest:r.interest,privateComment:r.private_comment||'' }));
  const seen = new Set(out.map(r => r.studentId));
  for (const studentId of activeMemberIds(db, ls.group_id, lessonAt)) {
    if (!noticeMap.has(studentId) || seen.has(studentId)) continue;
    const student = db.prepare('SELECT name FROM users WHERE id=?').get(studentId);
    // Предупреждение родителя не является автоматическим признанием причины
    // уважительной: окончательное решение принимает сотрудник при проведении урока.
    out.push({ studentId, name:student?.name || studentId, status:'absent', reason:noticeMap.get(studentId), parentNotice:true, markedAt:null });
  }
  out.sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  res.json(out);
});

/* ============================================================
   ПОСЕЩАЕМОСТЬ /api/attendance (массовое сохранение)
   Тело: { lessonSessionId, records: [{studentId, status}] }
   Логика списания абонемента — см. ТЗ 3.2 / 3.4.
   ============================================================ */
router.post('/attendance', validateBody(attendanceSchema), (req, res) => {
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
  const malformed = records.filter(rec => !rec || !rec.studentId || !['present', 'absent', 'excused', 'late'].includes(rec.status));
  if (malformed.length) return res.status(400).json({ error: 'Все записи посещаемости должны содержать корректные studentId и status' });
  const membership = validateGroupStudents(db, ls.group_id, records.map(r => r.studentId), sessionTimestamp(ls.date));
  if (!membership.valid) return res.status(400).json({
    error: membership.duplicates.length ? 'Список посещаемости содержит дубликаты учеников' : 'Один или несколько учеников не состоят в этой группе',
    invalidStudentIds: membership.duplicates.length ? membership.duplicates : membership.outsiders,
  });

  const getPrev = db.prepare('SELECT status FROM attendance WHERE lesson_session_id = ? AND student_id = ?');
  const upsert = db.prepare(`
    INSERT INTO attendance (id, lesson_session_id, student_id, status, reason, source, marked_at)
    VALUES (?,?,?,?,?,'staff',?)
    ON CONFLICT(lesson_session_id, student_id) DO UPDATE SET status=excluded.status,reason=excluded.reason,source='staff',marked_at=excluded.marked_at
  `);
  const charged = [];
  const txn = db.transaction(() => {
    for (const rec of records) {
      const { studentId, status } = rec;
      const reason = String(rec.reason || '').trim() || null;
      const prev = getPrev.get(lessonSessionId, studentId);
      const prevStatus = prev ? prev.status : null;
      upsert.run(genId('att'), lessonSessionId, studentId, status, reason, Date.now());
      db.prepare("UPDATE absence_notices SET status='acknowledged',updated_at=? WHERE student_id=? AND group_id=? AND lesson_at BETWEEN ? AND ? AND status='submitted'")
        .run(Date.now(),studentId,ls.group_id,sessionTimestamp(ls.date)-60000,sessionTimestamp(ls.date)+60000);

      // Для списания «опоздал» (late) считаем присутствием — ученик всё-таки был на занятии.
      const lessonAt = sessionTimestamp(ls.date);
      const approvedFreeze = db.prepare("SELECT 1 FROM freeze_requests WHERE student_id=? AND status='approved' AND starts_at<=? AND ends_at>=? LIMIT 1")
        .get(studentId, lessonAt, lessonAt);
      const group = db.prepare('SELECT lesson_kind FROM groups WHERE id=?').get(ls.group_id);
      const tariff = db.prepare(`SELECT t.extra_lessons_separate FROM students_crm sc LEFT JOIN tariffs t ON t.id=sc.tariff_id WHERE sc.user_id=?`).get(studentId);
      const separateExtra = group?.lesson_kind === 'extra' && tariff?.extra_lessons_separate;
      const isPresent = (s) => ['present','late','absent'].includes(s) && !approvedFreeze && !separateExtra;
      // списание только для активных абонементов
      if (isPresent(status) && !isPresent(prevStatus)) {
        const result = subscriptions.applyDelta({ studentId, delta: -1, type: 'attendance',
          referenceType: 'lesson_session', referenceId: `${lessonSessionId}:${studentId}:${Date.now()}`,
          actorId: req.user.id, note: status === 'absent' ? 'Неуважительный пропуск' : 'Посещение занятия' });
        if (result.applied) {
          charged.push({ studentId, action: 'charged', balance: result.balance });
          if (result.balance <= 2) {
            const parents = db.prepare('SELECT parent_id FROM parent_children WHERE student_id=?').all(studentId);
            const put = db.prepare(`INSERT OR IGNORE INTO notifications(id,user_id,type,text,link,channel,read,created_at) VALUES (?,?, 'low_balance', ?, '/pages/parent.html', 'in_app',0,?)`);
            for (const p of parents) put.run(`low_balance_${result.subscriptionId}_${result.balance}_${p.parent_id}`,p.parent_id,`В абонементе осталось ${result.balance} занятия. Пора продлить обучение.`,Date.now());
          }
        }
      } else if (isPresent(prevStatus) && !isPresent(status)) {
        // возврат посещения при исправлении
        const result = subscriptions.applyDelta({ studentId, delta: 1, type: 'refund',
          referenceType: 'lesson_session_refund', referenceId: `${lessonSessionId}:${studentId}:${Date.now()}`,
          actorId: req.user.id, note: 'Исправление посещаемости', allowInactive: true });
        if (result.applied) charged.push({ studentId, action: 'refunded', balance: result.balance });
      }
    }
  });
  txn();

  try {
    const { createCase } = require('./curator-cases');
    for (const rec of records.filter(r => ['absent','excused'].includes(r.status))) {
      createCase({ studentId:rec.studentId, category:'absence',
        description:rec.status==='excused' ? `Уважительное отсутствие: ${rec.reason||'причина не указана'}` : `Неуважительный пропуск: ${rec.reason||'причина не указана'}`,
        source:'attendance' });
    }
  } catch (e) { console.warn('[curator] Не удалось создать задачу по отсутствию:', e.message); }

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

router.post('/homework', validateBody(homeworkSchema), (req, res) => {
  const { lessonSessionId, moduleId, taskIds, dueDate, studentIds } = req.body || {};
  if (!lessonSessionId) return res.status(400).json({ error: 'lessonSessionId обязателен' });
  const ls = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(lessonSessionId);
  if (!ls) return res.status(404).json({ error: 'Занятие не найдено' });
  if (!canManageGroup(req.user, ls.group_id)) return res.status(403).json({ error: 'Это не ваша группа' });

  const id = genId('hw');
  // назначения: конкретным ученикам или всей группе (по составу)
  let targets = Array.isArray(studentIds) && studentIds.length
    ? [...new Set(studentIds.map(String))]
    : activeMemberIds(db, ls.group_id, sessionTimestamp(ls.date));
  const targetCheck = validateGroupStudents(db, ls.group_id, targets, sessionTimestamp(ls.date));
  if (!targetCheck.valid) return res.status(400).json({ error: 'Домашнее задание содержит ученика не из этой группы', invalidStudentIds: targetCheck.outsiders });
  const insA = db.prepare('INSERT INTO homework_assignments (id, homework_id, student_id) VALUES (?,?,?)');
  const insertHomework = db.prepare('INSERT INTO homework (id, lesson_session_id, module_id, task_ids, due_date, created_at) VALUES (?,?,?,?,?,?)');
  const txn = db.transaction(() => {
    insertHomework.run(id, lessonSessionId, moduleId || null, taskIds && taskIds.length ? JSON.stringify(taskIds) : null, dueDate || null, Date.now());
    for (const sid of targets) insA.run(genId('ha'), id, sid);
  });
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
    if (!canAccessStudent(db, req.user, student_id)) return res.status(403).json({ error: 'Недоступно' });
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
  if (req.user.role === 'teacher') {
    groups = groups.filter(g => g.teacher_id === req.user.id || g.assistant_id === req.user.id);
  } else if (req.user.role === 'assistant') {
    const branches = new Set(db.prepare('SELECT DISTINCT branch_id FROM groups WHERE assistant_id=?').all(req.user.id).map(r=>r.branch_id));
    groups = groups.filter(g => branches.has(g.branch_id));
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
