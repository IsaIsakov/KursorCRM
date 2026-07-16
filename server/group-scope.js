function activeMemberIds(db, groupId, at = Date.now()) {
  return db.prepare(`
    SELECT DISTINCT student_id AS id FROM group_members
    WHERE group_id=? AND since<=? AND (until IS NULL OR until>=?)
  `).all(groupId, at, at).map(row => row.id);
}

function validateGroupStudents(db, groupId, studentIds, at = Date.now()) {
  const ids = (studentIds || []).map(String);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  const members = new Set(activeMemberIds(db, groupId, at));
  return {
    valid: duplicates.length === 0 && ids.every(id => members.has(id)),
    duplicates: [...new Set(duplicates)],
    outsiders: [...new Set(ids.filter(id => !members.has(id)))],
    memberIds: [...members],
  };
}

function sessionTimestamp(date) {
  const parsed = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

module.exports = { activeMemberIds, validateGroupStudents, sessionTimestamp };
