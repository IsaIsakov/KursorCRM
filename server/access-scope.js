// Central row-level access rules. UI filtering is never considered security.
function staffStudentIds(db, user) {
  if (!user || !['teacher', 'assistant'].includes(user.role)) return [];
  const groupRows = db.prepare(`
    SELECT DISTINCT gm.student_id AS id
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    WHERE g.teacher_id = ? OR g.assistant_id = ?
  `).all(user.id, user.id);
  const ids = new Set(groupRows.map(r => r.id));
  // Preserve compatibility with the original one-teacher student model.
  if (user.role === 'teacher') {
    for (const row of db.prepare("SELECT id FROM users WHERE role='student' AND teacher_id=?").all(user.id)) ids.add(row.id);
  }
  return [...ids];
}

function parentStudentIds(db, parentId) {
  return db.prepare('SELECT student_id AS id FROM parent_children WHERE parent_id=?').all(parentId).map(r => r.id);
}

function accessibleStudentIds(db, user) {
  if (!user) return [];
  if (user.role === 'admin') return db.prepare("SELECT id FROM users WHERE role='student'").all().map(r => r.id);
  if (user.role === 'student') return [user.id];
  if (user.role === 'parent') return parentStudentIds(db, user.id);
  return staffStudentIds(db, user);
}

function canAccessStudent(db, user, studentId) {
  return accessibleStudentIds(db, user).includes(String(studentId));
}

module.exports = { staffStudentIds, parentStudentIds, accessibleStudentIds, canAccessStudent };
