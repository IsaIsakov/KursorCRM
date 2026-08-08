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
const { parseMultipart } = require('./multipart');
const storage = require('./storage');
const { lessonDay: normalizedLessonDay, lessonTimestamp } = require('./lesson-date');

const router = express.Router();
router.use(authRequired);

const lessonSchema = z.strictObject({
  groupId: idSchema, date: timestamp, lessonDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  durationMin: z.coerce.number().int().min(10).max(720).optional(),
  teacherId: idSchema.nullable().optional(), assistantId: idSchema.nullable().optional(),
  topic: optionalText(500),
});
const attendanceSchema = z.strictObject({ lessonSessionId: idSchema, records: z.array(z.strictObject({ studentId: idSchema, status: z.enum(['present','absent','excused','late']), reason: optionalText(1000) })).max(500) });
const homeworkSchema = z.strictObject({
  lessonSessionId: idSchema,
  moduleId: idSchema.nullable().optional(),
  taskIds: z.array(z.coerce.number().int().positive()).max(500).optional(),
  dueDate: timestamp.nullable().optional(),
  studentIds: z.array(idSchema).max(500).optional(),
  description: optionalText(5000),
  linkUrl: z.string().url().max(2048).refine(v => /^https?:\/\//i.test(v), 'Разрешены только http/https ссылки').nullable().optional(),
  submissionMode: z.enum(['platform','upload','both']).optional(),
});
const homeworkReviewSchema = z.strictObject({
  status: z.enum(['assigned','submitted','checking','checked','missing']),
  score: z.coerce.number().int().min(1).max(5).nullable().optional(),
});
const lessonManageSchema = z.strictObject({
  teacherId: idSchema.nullable().optional(),
  assistantId: idSchema.nullable().optional(),
  studentIds: z.array(idSchema).max(500).optional(),
  topic: optionalText(500),
});

function canManageGroup(user, groupId) {
  if (user.role === 'admin') return true;
  if (user.role === 'curator') return !!db.prepare(`SELECT 1 FROM groups g JOIN curator_branches cb ON cb.branch_id=g.branch_id
    WHERE g.id=? AND cb.curator_id=?`).get(groupId,user.id);
  if (user.role !== 'teacher') return false;
  const g = db.prepare('SELECT teacher_id, assistant_id,branch_id FROM groups WHERE id = ?').get(groupId);
  if (!g) return false;
  if (g.teacher_id === user.id || g.assistant_id === user.id) return true;
  return false;
}
function canManageSession(user, session) {
  if (!session) return false;
  if (canManageGroup(user,session.group_id)) return true;
  return user.role==='teacher' && [session.scheduled_teacher_id,session.scheduled_assistant_id].includes(user.id);
}

function effectiveLessonMembers(session) {
  const overrides = db.prepare(`
    SELECT lsm.student_id, lsm.active, u.name, u.login, u.avatar_url
    FROM lesson_session_members lsm
    JOIN users u ON u.id=lsm.student_id AND u.role='student'
    WHERE lsm.lesson_session_id=? ORDER BY u.name
  `).all(session.id);
  if (overrides.length) return overrides.filter(r => r.active);
  const at = sessionTimestamp(session.date);
  return db.prepare(`
    SELECT gm.student_id,1 active,u.name,u.login,u.avatar_url
    FROM group_members gm
    JOIN users u ON u.id=gm.student_id AND u.role='student'
    WHERE gm.group_id=? AND gm.since<=? AND (gm.until IS NULL OR gm.until>=?)
    ORDER BY u.name
  `).all(session.group_id,at,at);
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
    id: r.id, groupId: r.group_id, date: lessonTimestamp(r), topic: r.topic || '',
    lessonDay: normalizedLessonDay(r.date, normalizedLessonDay(r.lesson_day)) || null, status: r.status || 'conducted',
    startTime: r.start_time || null, durationMin: r.duration_min || null,
    teacherId: r.scheduled_teacher_id || null, assistantId: r.scheduled_assistant_id || null,
    conductedBy: r.conducted_by || null, conductorName: r.conductor_name || null,
    createdAt: r.created_at, updatedAt: r.updated_at || r.created_at, presentCount: r.present_count || 0,
  })));
});

router.post('/lesson-sessions', validateBody(lessonSchema), (req, res) => {
  const { groupId, date, topic, lessonDay, startTime, durationMin, teacherId, assistantId } = req.body || {};
  if (!groupId || !date) return res.status(400).json({ error: 'groupId, date обязательны' });
  if (!canManageGroup(req.user, groupId)) return res.status(403).json({ error: 'Это не ваша группа' });
  if (!['admin','curator'].includes(req.user.role) && !hasPermission(req.user, 'conduct_lessons')) {
    return res.status(403).json({ error: 'Нет права проводить занятия' });
  }
  const day=lessonDay||_ymd(new Date(Number(date)));
  const existing=db.prepare('SELECT * FROM lesson_sessions WHERE group_id=? AND lesson_day=?').get(groupId,day);
  if(existing) return res.json({id:existing.id,groupId,date:existing.date,lessonDay:existing.lesson_day,status:existing.status,existing:true});
  const group=db.prepare('SELECT teacher_id,assistant_id FROM groups WHERE id=?').get(groupId);
  for(const staffId of [teacherId,assistantId].filter(Boolean)) {
    if(!db.prepare("SELECT 1 FROM users WHERE id=? AND role='teacher'").get(staffId)) return res.status(400).json({error:'На занятие можно назначить только преподавателя'});
  }
  const id = genId('ls'),now=Date.now();
  try {
    db.prepare(`INSERT INTO lesson_sessions
      (id,group_id,date,lesson_day,status,start_time,duration_min,scheduled_teacher_id,scheduled_assistant_id,topic,conducted_by,created_at,updated_at)
      VALUES (?,?,?,?,'draft',?,?,?,?,?,?,?,?)`)
      .run(id,groupId,date,day,startTime||null,durationMin||null,teacherId||group?.teacher_id||null,
        assistantId||group?.assistant_id||null,topic||null,null,now,now);
  } catch(error) {
    if(String(error.code||'').startsWith('SQLITE_CONSTRAINT')) {
      const same=db.prepare('SELECT * FROM lesson_sessions WHERE group_id=? AND lesson_day=?').get(groupId,day);
      if(same)return res.json({id:same.id,groupId,date:same.date,lessonDay:same.lesson_day,status:same.status,existing:true});
    }
    throw error;
  }
  res.status(201).json({ id, groupId, date, lessonDay:day, status:'draft', topic: topic || '', conductedBy: null });
});

router.delete('/lesson-sessions/:id', (req, res) => {
  const ls = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(req.params.id);
  if (!ls) return res.status(404).json({ error: 'Не найдено' });
  if (!canManageSession(req.user, ls)) return res.status(403).json({ error: 'Это не ваше занятие' });
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

// Состав и преподаватели конкретного занятия. Изменение не затрагивает
// постоянный состав группы и удобно для замен/разовых посещений.
router.get('/lesson-sessions/:id/manage', (req, res) => {
  const ls = db.prepare(`SELECT ls.*,g.branch_id,g.name group_name,
    COALESCE(ls.scheduled_teacher_id,g.teacher_id) teacher_id,
    COALESCE(ls.scheduled_assistant_id,g.assistant_id) assistant_id
    FROM lesson_sessions ls JOIN groups g ON g.id=ls.group_id WHERE ls.id=?`).get(req.params.id);
  if (!ls) return res.status(404).json({ error: 'Занятие не найдено' });
  if (!canManageSession(req.user,ls)) return res.status(403).json({ error: 'Нет доступа к занятию' });
  const staff = db.prepare("SELECT id,name FROM users WHERE role='teacher' ORDER BY name").all();
  const students = db.prepare(`SELECT u.id,u.name,sc.branch_id
    FROM users u LEFT JOIN students_crm sc ON sc.user_id=u.id
    WHERE u.role='student' AND (sc.branch_id=? OR sc.branch_id IS NULL) ORDER BY u.name`).all(ls.branch_id);
  const selected = new Set(effectiveLessonMembers(ls).map(r => r.student_id));
  res.json({
    id:ls.id,groupId:ls.group_id,groupName:ls.group_name,lessonDay:ls.lesson_day,
    status:ls.status,startTime:ls.start_time,durationMin:ls.duration_min,topic:ls.topic||'',
    teacherId:ls.teacher_id||null,assistantId:ls.assistant_id||null,staff,
    students:students.map(s=>({id:s.id,name:s.name,selected:selected.has(s.id)})),
  });
});

router.put('/lesson-sessions/:id/manage', requireRole('admin','curator'), validateBody(lessonManageSchema), (req, res) => {
  const ls = db.prepare('SELECT * FROM lesson_sessions WHERE id=?').get(req.params.id);
  if (!ls) return res.status(404).json({ error: 'Занятие не найдено' });
  if (!canManageGroup(req.user,ls.group_id)) return res.status(403).json({ error: 'Нет доступа к занятию' });
  const { teacherId,assistantId,studentIds,topic } = req.body || {};
  if (teacherId && !db.prepare("SELECT 1 FROM users WHERE id=? AND role='teacher'").get(teacherId)) {
    return res.status(400).json({ error:'Основной преподаватель не найден' });
  }
  if (assistantId && !db.prepare("SELECT 1 FROM users WHERE id=? AND role='teacher'").get(assistantId)) {
    return res.status(400).json({ error:'Вторым преподавателем можно назначить только преподавателя' });
  }
  if (teacherId && assistantId && teacherId === assistantId) {
    return res.status(400).json({ error:'Основной и второй преподаватель должны быть разными' });
  }
  const uniqueStudents = studentIds === undefined ? null : [...new Set(studentIds)];
  if (uniqueStudents) {
    const valid = uniqueStudents.length ? db.prepare(`SELECT id FROM users WHERE role='student' AND id IN (${uniqueStudents.map(()=>'?').join(',')})`).all(...uniqueStudents) : [];
    if (valid.length !== uniqueStudents.length) return res.status(400).json({ error:'Один из выбранных учеников не найден' });
  }
  db.transaction(() => {
    db.prepare(`UPDATE lesson_sessions SET scheduled_teacher_id=?,scheduled_assistant_id=?,
      topic=?,updated_at=? WHERE id=?`).run(
      teacherId !== undefined ? (teacherId||null) : ls.scheduled_teacher_id,
      assistantId !== undefined ? (assistantId||null) : ls.scheduled_assistant_id,
      topic !== undefined ? (String(topic||'').trim()||null) : ls.topic,
      Date.now(),ls.id);
    if (uniqueStudents) {
      db.prepare('DELETE FROM lesson_session_members WHERE lesson_session_id=?').run(ls.id);
      const put=db.prepare(`INSERT INTO lesson_session_members
        (lesson_session_id,student_id,active,updated_by,updated_at) VALUES (?,?,1,?,?)`);
      for (const sid of uniqueStudents) put.run(ls.id,sid,req.user.id,Date.now());
    }
  })();
  res.json({ok:true});
});

router.get('/lesson-sessions/:id/members', (req, res) => {
  const ls=db.prepare('SELECT * FROM lesson_sessions WHERE id=?').get(req.params.id);
  if(!ls)return res.status(404).json({error:'Занятие не найдено'});
  if(!canManageSession(req.user,ls))return res.status(403).json({error:'Нет доступа'});
  res.json(effectiveLessonMembers(ls).map(r=>({
    studentId:r.student_id,name:r.name,login:r.login,avatarUrl:r.avatar_url||null,
  })));
});

// Детали занятия с посещаемостью
router.get('/lesson-sessions/:id/attendance', (req, res) => {
  const ls = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(req.params.id);
  if (!ls) return res.status(404).json({ error: 'Не найдено' });
  if (!canManageSession(req.user, ls)) {
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
  if (!canManageSession(req.user, ls)) return res.status(403).json({ error: 'Это не ваше занятие' });
  if (!['admin','curator'].includes(req.user.role) && !hasPermission(req.user, 'conduct_lessons')) {
    return res.status(403).json({ error: 'Нет права отмечать посещаемость' });
  }
  const malformed = records.filter(rec => !rec || !rec.studentId || !['present', 'absent', 'excused', 'late'].includes(rec.status));
  if (malformed.length) return res.status(400).json({ error: 'Все записи посещаемости должны содержать корректные studentId и status' });
  const ids=records.map(r=>r.studentId),duplicates=ids.filter((id,i)=>ids.indexOf(id)!==i);
  const allowed=new Set(effectiveLessonMembers(ls).map(r=>r.student_id));
  const outsiders=ids.filter(id=>!allowed.has(id));
  if (duplicates.length || outsiders.length) return res.status(400).json({
    error: duplicates.length ? 'Список посещаемости содержит дубликаты учеников' : 'Один или несколько учеников не входят в состав этого занятия',
    invalidStudentIds: duplicates.length ? [...new Set(duplicates)] : outsiders,
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
    db.prepare("UPDATE lesson_sessions SET status='conducted',conducted_by=?,updated_at=? WHERE id=?")
      .run(req.user.id,Date.now(),lessonSessionId);
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
      const roleLabel = req.user.role === 'admin' ? 'администратор' : req.user.role === 'curator' ? 'куратор' : 'преподаватель';
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
    description: r.description || '', linkUrl: r.link_url || null,
    submissionMode: r.submission_mode || 'legacy',
    fileName: r.file_name || null, fileMime: r.file_mime || null, fileSize: r.file_size || null,
    fileUrl: r.file_path ? `/api/homework/${encodeURIComponent(r.id)}/file` : null,
  };
}

function homeworkTaskIds(row) {
  let ids = [];
  try { ids = row.task_ids ? JSON.parse(row.task_ids) : []; } catch {}
  ids = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))];
  // Если преподаватель выбрал конкретные задачи, считаем только их. Весь
  // модуль становится домашней работой только когда список задач не задан.
  if (!ids.length && row.module_id) {
    ids = db.prepare('SELECT id FROM tasks WHERE module_id=? ORDER BY id').all(row.module_id).map(x => x.id);
  }
  return ids;
}

function homeworkRequirements(row) {
  const taskIds = homeworkTaskIds(row);
  const mode = ['platform','upload','both'].includes(row.submission_mode) ? row.submission_mode : 'legacy';
  return {
    mode,
    taskIds,
    requiresTasks: mode === 'platform' || mode === 'both' || (mode === 'legacy' && taskIds.length > 0),
    requiresUpload: mode === 'upload' || mode === 'both',
    manualConfirm: mode === 'legacy' && taskIds.length === 0,
  };
}

function homeworkAssignmentProgress(homework, assignment) {
  const requirements = homeworkRequirements(homework);
  const taskIds = requirements.taskIds;
  const statuses = {};
  let done = 0;
  for (const taskId of taskIds) {
    const progress = db.prepare('SELECT status FROM task_progress WHERE user_id=? AND task_id=?')
      .get(assignment.student_id, taskId);
    const status = progress?.status || 'new';
    statuses[taskId] = status;
    if (status === 'done') done++;
  }
  const tasksCompleted = !requirements.requiresTasks || (taskIds.length > 0 && done === taskIds.length);
  const uploadCompleted = !requirements.requiresUpload || !!assignment.submission_file_path;
  const requirementsCompleted = tasksCompleted && uploadCompleted;
  let status = assignment.status || 'assigned';
  if (requirementsCompleted && !requirements.manualConfirm && status === 'assigned') {
    const submittedAt = assignment.submitted_at || Date.now();
    db.prepare("UPDATE homework_assignments SET status='submitted',submitted_at=? WHERE id=?")
      .run(submittedAt, assignment.id);
    status = 'submitted';
    assignment.submitted_at = submittedAt;
  }
  const completed = ['submitted','checking','checked'].includes(status);
  return {
    assignmentId: assignment.id,
    studentId: assignment.student_id,
    studentName: assignment.student_name || null,
    status,
    score: assignment.score || null,
    submittedAt: assignment.submitted_at || null,
    checkedAt: assignment.checked_at || null,
    submissionNote: assignment.submission_note || '',
    submissionFileName: assignment.submission_file_name || null,
    submissionFileMime: assignment.submission_file_mime || null,
    submissionFileSize: assignment.submission_file_size || null,
    submissionFileUrl: assignment.submission_file_path
      ? `/api/homework/${encodeURIComponent(homework.id)}/assignments/${encodeURIComponent(assignment.student_id)}/file`
      : null,
    submissionMode: requirements.mode,
    requiresTasks: requirements.requiresTasks,
    requiresUpload: requirements.requiresUpload,
    tasksCompleted,
    uploadCompleted,
    taskIds,
    statuses,
    done,
    total: taskIds.length,
    percent: taskIds.length ? Math.round(done * 100 / taskIds.length) : (completed ? 100 : 0),
    completed,
    overdue: !!homework.due_date && Number(homework.due_date) < Date.now() && !completed,
  };
}

function homeworkProgressRows(homework) {
  const assignments = db.prepare(`
    SELECT ha.*,u.name student_name FROM homework_assignments ha
    JOIN users u ON u.id=ha.student_id
    WHERE ha.homework_id=? ORDER BY u.name
  `).all(homework.id);
  return assignments.map(row => homeworkAssignmentProgress(homework, row));
}

router.post('/homework', validateBody(homeworkSchema), (req, res) => {
  const { lessonSessionId, moduleId, taskIds, dueDate, studentIds, description, linkUrl, submissionMode } = req.body || {};
  const effectiveSubmissionMode = submissionMode || ((moduleId || (taskIds && taskIds.length)) ? 'platform' : 'legacy');
  if (!lessonSessionId) return res.status(400).json({ error: 'lessonSessionId обязателен' });
  const ls = db.prepare('SELECT * FROM lesson_sessions WHERE id = ?').get(lessonSessionId);
  if (!ls) return res.status(404).json({ error: 'Занятие не найдено' });
  if (!canManageSession(req.user, ls)) return res.status(403).json({ error: 'Это не ваше занятие' });

  const id = genId('hw');
  // назначения: конкретным ученикам или всей группе (по составу)
  let targets = Array.isArray(studentIds) && studentIds.length
    ? [...new Set(studentIds.map(String))]
    : effectiveLessonMembers(ls).map(r=>r.student_id);
  const allowedTargets=new Set(effectiveLessonMembers(ls).map(r=>r.student_id));
  const invalidTargets=targets.filter(id=>!allowedTargets.has(id));
  if (invalidTargets.length) return res.status(400).json({ error: 'Домашнее задание содержит ученика не из состава этого занятия', invalidStudentIds: invalidTargets });
  const insA = db.prepare('INSERT INTO homework_assignments (id, homework_id, student_id) VALUES (?,?,?)');
  if (!moduleId && !(taskIds && taskIds.length) && !String(description || '').trim() && !linkUrl) {
    return res.status(400).json({ error: 'Добавьте задачи платформы, текст, ссылку или файл' });
  }
  if (['platform','both'].includes(effectiveSubmissionMode) && !moduleId && !(taskIds && taskIds.length)) {
    return res.status(400).json({ error: 'Для этого формата выберите модуль или хотя бы одну задачу платформы' });
  }
  if (moduleId && !db.prepare('SELECT 1 FROM modules WHERE id=?').get(moduleId)) {
    return res.status(400).json({ error: 'Выбранный модуль не найден' });
  }
  const selectedTaskIds = [...new Set((taskIds || []).map(Number))];
  if (selectedTaskIds.length) {
    const placeholders = selectedTaskIds.map(() => '?').join(',');
    const selectedTasks = db.prepare(`SELECT id,module_id FROM tasks WHERE id IN (${placeholders})`).all(...selectedTaskIds);
    if (selectedTasks.length !== selectedTaskIds.length) {
      return res.status(400).json({ error: 'Одна или несколько выбранных задач не найдены' });
    }
    if (moduleId && selectedTasks.some(task => task.module_id !== moduleId)) {
      return res.status(400).json({ error: 'Все задачи должны относиться к выбранному модулю' });
    }
  }
  const insertHomework = db.prepare('INSERT INTO homework (id, lesson_session_id, module_id, task_ids, due_date, description, link_url, submission_mode, created_at) VALUES (?,?,?,?,?,?,?,?,?)');
  const txn = db.transaction(() => {
    insertHomework.run(id, lessonSessionId, moduleId || null, selectedTaskIds.length ? JSON.stringify(selectedTaskIds) : null,
      dueDate || null, String(description || '').trim() || null, linkUrl || null, effectiveSubmissionMode, Date.now());
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

  const created = db.prepare(`SELECT h.*, ls.group_id, ls.date session_date, m.title module_title
    FROM homework h JOIN lesson_sessions ls ON ls.id=h.lesson_session_id LEFT JOIN modules m ON m.id=h.module_id WHERE h.id=?`).get(id);
  res.status(201).json({ ...rowToHw(created), assigned: targets.length });
});

const homeworkUpload = parseMultipart({ maxFileBytes: 30 * 1024 * 1024, maxFields: 2 });
router.post('/homework/:id/file', homeworkUpload, (req, res) => {
  if (!req.upload?.size) return res.status(400).json({ error: 'Выберите файл' });
  const hw = db.prepare(`SELECT h.*,ls.group_id,ls.scheduled_teacher_id,ls.scheduled_assistant_id FROM homework h JOIN lesson_sessions ls ON ls.id=h.lesson_session_id WHERE h.id=?`).get(req.params.id);
  if (!hw) return res.status(404).json({ error: 'Домашнее задание не найдено' });
  if (!canManageSession(req.user,hw)) return res.status(403).json({ error: 'Это не ваше занятие' });
  if (hw.file_path) storage.deleteFile(hw.file_path);
  const safeId = String(hw.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  const original = String(req.upload.filename || 'homework-file').slice(0, 180);
  const ext = original.includes('.') ? original.split('.').pop().replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) : 'bin';
  const rel = `homework/${safeId}/${genId('file')}.${ext || 'bin'}`;
  storage.importFile(req.upload.tempPath, rel);
  db.prepare('UPDATE homework SET file_path=?,file_name=?,file_mime=?,file_size=? WHERE id=?')
    .run(rel, original, req.upload.mime, req.upload.size, hw.id);
  const updated = db.prepare(`SELECT h.*,ls.group_id,ls.date session_date,m.title module_title
    FROM homework h JOIN lesson_sessions ls ON ls.id=h.lesson_session_id LEFT JOIN modules m ON m.id=h.module_id WHERE h.id=?`).get(hw.id);
  res.json(rowToHw(updated));
});

router.get('/homework/:id/file', (req, res) => {
  const hw = db.prepare(`SELECT h.*,ls.group_id,ls.scheduled_teacher_id,ls.scheduled_assistant_id FROM homework h JOIN lesson_sessions ls ON ls.id=h.lesson_session_id WHERE h.id=?`).get(req.params.id);
  if (!hw?.file_path) return res.status(404).json({ error: 'Файл не найден' });
  const assigned = req.user.role === 'student' && db.prepare('SELECT 1 FROM homework_assignments WHERE homework_id=? AND student_id=?').get(hw.id, req.user.id);
  const allowed = assigned || canManageSession(req.user,hw) ||
    (req.user.role === 'parent' && !!db.prepare(`SELECT 1 FROM homework_assignments ha JOIN parent_children pc ON pc.student_id=ha.student_id
      WHERE ha.homework_id=? AND pc.parent_id=?`).get(hw.id, req.user.id));
  if (!allowed) return res.status(403).json({ error: 'Недостаточно прав' });
  const full = storage.resolveFile(hw.file_path);
  if (!full) return res.status(404).json({ error: 'Файл не найден' });
  res.setHeader('Content-Type', hw.file_mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(hw.file_name || 'homework-file')}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(full);
});

const homeworkSubmissionUpload = parseMultipart({ maxFileBytes: 30 * 1024 * 1024, maxFields: 2 });
router.post('/homework/:id/submission', requireRole('student'), homeworkSubmissionUpload, (req, res) => {
  if (!req.upload?.size) return res.status(400).json({ error: 'Выберите файл или фотографию выполненной работы' });
  const homework = db.prepare('SELECT * FROM homework WHERE id=?').get(req.params.id);
  if (!homework) return res.status(404).json({ error: 'Домашнее задание не найдено' });
  const requirements = homeworkRequirements(homework);
  if (!requirements.requiresUpload) return res.status(409).json({ error: 'Для этого задания загрузка файла не требуется' });
  const assignment = db.prepare('SELECT * FROM homework_assignments WHERE homework_id=? AND student_id=?')
    .get(homework.id, req.user.id);
  if (!assignment) return res.status(403).json({ error: 'Это домашнее задание вам не назначено' });
  if (assignment.status === 'checked') return res.status(409).json({ error: 'Работа уже проверена. Попросите преподавателя вернуть её на доработку' });

  const original = String(req.upload.filename || 'homework-answer').slice(0, 180);
  const ext = original.includes('.') ? original.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) : '';
  const allowedExt = new Set(['jpg','jpeg','png','webp','heic','heif','pdf','doc','docx','ppt','pptx','xls','xlsx','txt','zip']);
  if (!allowedExt.has(ext)) return res.status(400).json({ error: 'Разрешены фото, PDF, документы Office, TXT и ZIP' });
  const safeHomework = String(homework.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeStudent = String(req.user.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  const rel = `homework-submissions/${safeHomework}/${safeStudent}/${genId('answer')}.${ext}`;
  storage.importFile(req.upload.tempPath, rel);
  db.prepare(`UPDATE homework_assignments SET submission_file_path=?,submission_file_name=?,
    submission_file_mime=?,submission_file_size=?,submission_note=?,status='assigned',submitted_at=NULL,checked_at=NULL
    WHERE id=?`).run(rel, original, req.upload.mime, req.upload.size,
      String(req.body?.note || '').trim().slice(0, 1000) || null, assignment.id);
  if (assignment.submission_file_path && assignment.submission_file_path !== rel) storage.deleteFile(assignment.submission_file_path);
  const updated = db.prepare('SELECT * FROM homework_assignments WHERE id=?').get(assignment.id);
  const progress = homeworkAssignmentProgress(homework, { ...updated, student_name: req.user.name });
  res.json({ ok:true, ...progress });
});

router.get('/homework/:id/assignments/:studentId/file', (req, res) => {
  const homework = db.prepare(`SELECT h.*,ls.group_id,ls.scheduled_teacher_id,ls.scheduled_assistant_id
    FROM homework h JOIN lesson_sessions ls ON ls.id=h.lesson_session_id WHERE h.id=?`).get(req.params.id);
  if (!homework) return res.status(404).json({ error: 'Домашнее задание не найдено' });
  const assignment = db.prepare('SELECT * FROM homework_assignments WHERE homework_id=? AND student_id=?')
    .get(homework.id, req.params.studentId);
  if (!assignment?.submission_file_path) return res.status(404).json({ error: 'Файл ответа не найден' });
  const isOwner = req.user.role === 'student' && req.user.id === req.params.studentId;
  const isParent = req.user.role === 'parent' && !!db.prepare('SELECT 1 FROM parent_children WHERE parent_id=? AND student_id=?')
    .get(req.user.id, req.params.studentId);
  if (!isOwner && !isParent && !canManageSession(req.user, homework)) return res.status(403).json({ error: 'Недостаточно прав' });
  const full = storage.resolveFile(assignment.submission_file_path);
  if (!full) return res.status(404).json({ error: 'Файл ответа не найден' });
  res.setHeader('Content-Type', assignment.submission_file_mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(assignment.submission_file_name || 'homework-answer')}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(full);
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
    return res.json(rows.map(row => {
      const progress = homeworkProgressRows(row);
      return {
        ...rowToHw(row),
        assignedCount: progress.length,
        completedCount: progress.filter(x => x.completed).length,
        checkedCount: progress.filter(x => x.status === 'checked').length,
      };
    }));
  }
  if (student_id) {
    if (!canAccessStudent(db, req.user, student_id)) return res.status(403).json({ error: 'Недоступно' });
    const rows = db.prepare(`
      SELECT h.*,ha.id assignment_id,ha.status assignment_status,ha.submitted_at,ha.checked_at,ha.score,
        ha.submission_file_path,ha.submission_file_name,ha.submission_file_mime,ha.submission_file_size,ha.submission_note,
        ls.group_id,ls.date AS session_date,m.title AS module_title
      FROM homework h
      JOIN homework_assignments ha ON ha.homework_id = h.id
      JOIN lesson_sessions ls ON ls.id = h.lesson_session_id
      LEFT JOIN modules m ON m.id = h.module_id
      WHERE ha.student_id = ? ORDER BY h.created_at DESC
    `).all(student_id);
    return res.json(rows.map(row => {
      const progress = homeworkAssignmentProgress(row, {
        id: row.assignment_id,
        student_id,
        status: row.assignment_status,
        submitted_at: row.submitted_at,
        checked_at: row.checked_at,
        score: row.score,
        submission_file_path: row.submission_file_path,
        submission_file_name: row.submission_file_name,
        submission_file_mime: row.submission_file_mime,
        submission_file_size: row.submission_file_size,
        submission_note: row.submission_note,
      });
      return {
        ...rowToHw(row),
        assignmentStatus: progress.status,
        assignmentScore: progress.score,
        done: progress.done,
        total: progress.total,
        percent: progress.percent,
        completed: progress.completed,
        submittedAt: progress.submittedAt,
        checkedAt: progress.checkedAt,
        submissionFileUrl: progress.submissionFileUrl,
        submissionFileName: progress.submissionFileName,
        submissionMode: progress.submissionMode,
        requiresTasks: progress.requiresTasks,
        requiresUpload: progress.requiresUpload,
      };
    }));
  }
  res.status(400).json({ error: 'Нужен group_id или student_id' });
});

// ДЗ текущего ученика + статусы выполнения (из task_progress)
router.get('/homework/me', requireRole('student'), (req, res) => {
  const rows = db.prepare(`
    SELECT h.*,ha.id assignment_id,ha.status assignment_status,ha.submitted_at,ha.checked_at,ha.score,
      ha.submission_file_path,ha.submission_file_name,ha.submission_file_mime,ha.submission_file_size,ha.submission_note,
      ls.date AS session_date, m.title AS module_title
    FROM homework h
    JOIN homework_assignments ha ON ha.homework_id = h.id
    JOIN lesson_sessions ls ON ls.id = h.lesson_session_id
    LEFT JOIN modules m ON m.id = h.module_id
    WHERE ha.student_id = ? ORDER BY h.created_at DESC
  `).all(req.user.id);

  const out = rows.map(r => {
    const hw = rowToHw(r);
    const progress = homeworkAssignmentProgress(r, {
      id: r.assignment_id,
      student_id: req.user.id,
      status: r.assignment_status,
      submitted_at: r.submitted_at,
      checked_at: r.checked_at,
      score: r.score,
      submission_file_path: r.submission_file_path,
      submission_file_name: r.submission_file_name,
      submission_file_mime: r.submission_file_mime,
      submission_file_size: r.submission_file_size,
      submission_note: r.submission_note,
    });
    return {
      ...hw,
      assignmentStatus: progress.status,
      assignmentScore: progress.score,
      submittedAt: progress.submittedAt,
      checkedAt: progress.checkedAt,
      taskList: progress.taskIds,
      statuses: progress.statuses,
      total: progress.total,
      done: progress.done,
      percent: progress.percent,
      allDone: progress.completed,
      submissionMode: progress.submissionMode,
      requiresTasks: progress.requiresTasks,
      requiresUpload: progress.requiresUpload,
      tasksCompleted: progress.tasksCompleted,
      uploadCompleted: progress.uploadCompleted,
      submissionFileUrl: progress.submissionFileUrl,
      submissionFileName: progress.submissionFileName,
      canUpload: progress.requiresUpload && progress.status !== 'checked',
      canSubmit: progress.status === 'assigned' && !progress.requiresUpload &&
        (!progress.requiresTasks || progress.tasksCompleted),
    };
  });
  res.json(out);
});

// Полный прогресс ДЗ для администратора или преподавателя группы.
router.get('/homework/:id/progress', (req, res) => {
  const homework = db.prepare(`
    SELECT h.*,ls.group_id,ls.date session_date,ls.topic,g.name group_name,m.title module_title
    FROM homework h
    JOIN lesson_sessions ls ON ls.id=h.lesson_session_id
    JOIN groups g ON g.id=ls.group_id
    LEFT JOIN modules m ON m.id=h.module_id
    WHERE h.id=?
  `).get(req.params.id);
  if (!homework) return res.status(404).json({ error: 'Домашнее задание не найдено' });
  if (!canManageSession(req.user, homework)) return res.status(403).json({ error: 'Это не ваше занятие' });
  const students = homeworkProgressRows(homework);
  res.json({
    homework: rowToHw(homework),
    groupName: homework.group_name,
    students,
    summary: {
      assigned: students.length,
      completed: students.filter(x => x.completed).length,
      checked: students.filter(x => x.status === 'checked').length,
      overdue: students.filter(x => x.overdue).length,
    },
  });
});

// Legacy-текстовое ДЗ ученик подтверждает сам. Для новых форматов сервер
// проверяет каждое требование: задачи платформы, загруженный ответ или оба.
router.post('/homework/:id/submit', requireRole('student'), (req, res) => {
  const homework = db.prepare('SELECT * FROM homework WHERE id=?').get(req.params.id);
  if (!homework) return res.status(404).json({ error: 'Домашнее задание не найдено' });
  const assignment = db.prepare('SELECT * FROM homework_assignments WHERE homework_id=? AND student_id=?')
    .get(homework.id, req.user.id);
  if (!assignment) return res.status(403).json({ error: 'Это домашнее задание вам не назначено' });
  if (assignment.status === 'checked') return res.status(409).json({ error: 'Домашнее задание уже проверено' });
  const progress = homeworkAssignmentProgress(homework, { ...assignment, student_name: req.user.name });
  if (progress.requiresTasks && !progress.tasksCompleted) {
    return res.status(409).json({ error: `Сначала выполните все задачи: готово ${progress.done} из ${progress.total}` });
  }
  if (progress.requiresUpload && !progress.uploadCompleted) {
    return res.status(409).json({ error: 'Сначала прикрепите файл или фотографию выполненной работы' });
  }
  const now = Date.now();
  db.prepare("UPDATE homework_assignments SET status='submitted',submitted_at=?,checked_at=NULL WHERE id=?")
    .run(now, assignment.id);
  res.json({ ok: true, status: 'submitted', submittedAt: now });
});

router.put('/homework/:id/assignments/:studentId', validateBody(homeworkReviewSchema), (req, res) => {
  const homework = db.prepare(`
    SELECT h.*,ls.group_id,ls.scheduled_teacher_id,ls.scheduled_assistant_id
    FROM homework h JOIN lesson_sessions ls ON ls.id=h.lesson_session_id WHERE h.id=?
  `).get(req.params.id);
  if (!homework) return res.status(404).json({ error: 'Домашнее задание не найдено' });
  if (!canManageSession(req.user, homework)) return res.status(403).json({ error: 'Это не ваше занятие' });
  const assignment = db.prepare('SELECT * FROM homework_assignments WHERE homework_id=? AND student_id=?')
    .get(homework.id, req.params.studentId);
  if (!assignment) return res.status(404).json({ error: 'Назначение ученика не найдено' });
  const { status, score } = req.body;
  const now = Date.now();
  const submittedAt = ['submitted','checking','checked'].includes(status)
    ? (assignment.submitted_at || now) : null;
  const checkedAt = status === 'checked' ? now : null;
  const finalScore = score === undefined ? assignment.score : score;
  db.transaction(() => {
    db.prepare('UPDATE homework_assignments SET status=?,score=?,submitted_at=?,checked_at=? WHERE id=?')
      .run(status, finalScore, submittedAt, checkedAt, assignment.id);
    const mappedStatus = status;
    const updated = db.prepare(`
      UPDATE student_assessments SET homework_score=?,homework_status=?,updated_by=?,updated_at=?
      WHERE lesson_session_id=? AND student_id=?
    `).run(finalScore, mappedStatus, req.user.id, now, homework.lesson_session_id, req.params.studentId);
    if (!updated.changes) {
      db.prepare(`
        INSERT INTO student_assessments
        (lesson_session_id,student_id,homework_score,homework_status,updated_by,updated_at)
        VALUES (?,?,?,?,?,?)
      `).run(homework.lesson_session_id, req.params.studentId, finalScore, mappedStatus, req.user.id, now);
    }
  })();
  res.json({ ok: true, status, score: finalScore, submittedAt, checkedAt });
});

router.delete('/homework/:id', (req, res) => {
  const hw = db.prepare('SELECT h.*,ls.group_id,ls.scheduled_teacher_id,ls.scheduled_assistant_id FROM homework h JOIN lesson_sessions ls ON ls.id = h.lesson_session_id WHERE h.id = ?').get(req.params.id);
  if (!hw) return res.status(404).json({ error: 'Не найдено' });
  if (!canManageSession(req.user, hw)) return res.status(403).json({ error: 'Это не ваше занятие' });
  if (hw.file_path) storage.deleteFile(hw.file_path);
  for (const row of db.prepare('SELECT submission_file_path FROM homework_assignments WHERE homework_id=? AND submission_file_path IS NOT NULL').all(hw.id)) {
    storage.deleteFile(row.submission_file_path);
  }
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
function _scheduledAt(ymd,time) {
  const [y,m,d]=ymd.split('-').map(Number),[hh,mm]=String(time||'00:00').split(':').map(Number);
  const offset=Number(process.env.APP_TIMEZONE_OFFSET_MINUTES||300);
  return Date.UTC(y,m-1,d,hh,mm)-offset*60000;
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
    groups = groups.filter(g => {
      g._baseTeacher = g.teacher_id===req.user.id || g.assistant_id===req.user.id;
      return g._baseTeacher || !!db.prepare(`SELECT 1 FROM lesson_sessions WHERE group_id=?
        AND lesson_day BETWEEN ? AND ? AND (scheduled_teacher_id=? OR scheduled_assistant_id=?) LIMIT 1`)
        .get(g.id,from,to,req.user.id,req.user.id);
    });
  }
  if (!groups.length) return res.json([]);

  const groupIds = groups.map(g => g.id);
  const gById = Object.fromEntries(groups.map(g => [g.id, g]));
  const ph = groupIds.map(() => '?').join(',');

  const schedules = db.prepare(`SELECT * FROM group_schedule WHERE group_id IN (${ph})`).all(...groupIds);

  // Все занятия этих групп; фильтруем по дате в JS (date хранится по-разному).
  const sessionRows = db.prepare(`
    SELECT ls.*,stu.name scheduled_teacher_name,sau.name scheduled_assistant_name,
      (SELECT COUNT(*) FROM attendance a WHERE a.lesson_session_id = ls.id AND a.status IN ('present','late')) AS present_count
    FROM lesson_sessions ls
    LEFT JOIN users stu ON stu.id=ls.scheduled_teacher_id
    LEFT JOIN users sau ON sau.id=ls.scheduled_assistant_id
    WHERE ls.group_id IN (${ph})
  `).all(...groupIds);

  // Карта занятий по ключу groupId|YYYY-MM-DD (массив — на случай нескольких в день)
  const sessByKey = {};
  for (const s of sessionRows) {
    const d = _toDateServer(s.date);
    if (!d && !s.lesson_day) continue;
    const key = s.group_id + '|' + (s.lesson_day || _ymd(d));
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
      if(req.user.role==='teacher' && !g._baseTeacher &&
        ![sess?.scheduled_teacher_id,sess?.scheduled_assistant_id].includes(req.user.id)) continue;
      if (sess) used.add(sess.id);
      events.push({
        date: ymd, weekday: wd, startTime: sc.start_time, durationMin: sc.duration_min,
        groupId: g.id, groupName: g.name, lessonKind: g.lesson_kind,
        branchId: g.branch_id, branchName: g.branch_name || '',
        courseTitle: g.course_title || '', teacherName: sess?.scheduled_teacher_name || g.teacher_name || '',
        assistantName: sess?.scheduled_assistant_name || g.assistant_name || '',
        sessionId: sess ? sess.id : null,
        conducted: !!sess && sess.status === 'conducted',
        draft: !!sess && sess.status !== 'conducted',
        overdue: (!sess || sess.status !== 'conducted') && (_scheduledAt(ymd,sc.start_time)+sc.duration_min*60000<Date.now()),
        presentCount: sess ? (sess.present_count || 0) : 0,
        topic: sess ? (sess.topic || '') : '',
      });
    }
  }

  // Внеплановые занятия (есть запись, но нет слота в расписании в этот день)
  for (const s of sessionRows) {
    if (used.has(s.id)) continue;
    if(req.user.role==='teacher' && !gById[s.group_id]?._baseTeacher &&
      ![s.scheduled_teacher_id,s.scheduled_assistant_id].includes(req.user.id)) continue;
    const d = _toDateServer(s.date);
    if (!d || d < fromD || d > toD) continue;
    const g = gById[s.group_id]; if (!g) continue;
    events.push({
      date: _ymd(d), weekday: d.getDay(), startTime: null, durationMin: 60,
      groupId: g.id, groupName: g.name, lessonKind: g.lesson_kind,
      branchId: g.branch_id, branchName: g.branch_name || '',
      courseTitle: g.course_title || '', teacherName: g.teacher_name || '',
      assistantName: g.assistant_name || '',
      sessionId: s.id, conducted: s.status === 'conducted', draft:s.status !== 'conducted', adhoc: true,
      presentCount: s.present_count || 0, topic: s.topic || '',
    });
  }

  res.json(events);
});

module.exports = router;
