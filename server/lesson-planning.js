function asMs(value) {
  if (typeof value === 'number') return value;
  if (/^\d+$/.test(String(value || ''))) return Number(value);
  return Date.parse(value);
}

function scheduledLessons(db, studentId, from, to) {
  const start = asMs(from), end = asMs(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const memberships = db.prepare(`
    SELECT gm.group_id,gm.since,gm.until,g.name,g.lesson_kind,g.branch_id,
           gs.weekday,gs.start_time,gs.duration_min,u.name AS teacher_name,b.name AS branch_name
    FROM group_members gm JOIN groups g ON g.id=gm.group_id
    JOIN group_schedule gs ON gs.group_id=g.id
    LEFT JOIN users u ON u.id=g.teacher_id LEFT JOIN branches b ON b.id=g.branch_id
    WHERE gm.student_id=? AND g.status='active' AND gm.since<=? AND (gm.until IS NULL OR gm.until>=?)
    ORDER BY g.name,gs.weekday,gs.start_time
  `).all(studentId, end, start);
  const notices = db.prepare(`SELECT * FROM absence_notices WHERE student_id=? AND lesson_at BETWEEN ? AND ? AND status!='cancelled'`)
    .all(studentId, start, end);
  const noticeByKey = new Map(notices.map(n => [`${n.group_id}:${n.lesson_at}`, n]));
  const result = [];
  const cursor = new Date(start); cursor.setHours(0, 0, 0, 0);
  const last = new Date(end); last.setHours(23, 59, 59, 999);
  for (; cursor <= last; cursor.setDate(cursor.getDate() + 1)) {
    for (const m of memberships) {
      if (cursor.getDay() !== m.weekday) continue;
      const [hour, minute] = m.start_time.split(':').map(Number);
      const at = new Date(cursor); at.setHours(hour, minute, 0, 0);
      const lessonAt = at.getTime();
      if (lessonAt < start || lessonAt > end || lessonAt < m.since || (m.until && lessonAt > m.until)) continue;
      const notice = noticeByKey.get(`${m.group_id}:${lessonAt}`);
      result.push({ groupId:m.group_id, groupName:m.name, lessonKind:m.lesson_kind, branchId:m.branch_id,
        branchName:m.branch_name || '', teacherName:m.teacher_name || '', lessonAt, durationMin:m.duration_min,
        absenceNotice: notice ? { id:notice.id, reason:notice.reason, status:notice.status } : null });
    }
  }
  return result.sort((a, b) => a.lessonAt - b.lessonAt);
}

module.exports = { asMs, scheduledLessons };
