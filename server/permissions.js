/* ============================================================
   KURSOR — Гибкие права учителей/ассистентов (key-value).
   Таблица teacher_permissions (teacher_id, permission_key, value).
   ============================================================ */
const db = require('./db');

// Известные ключи прав + значения по умолчанию (если записи в БД нет).
// admin всегда имеет все права (см. hasPermission).
const PERMISSION_KEYS = {
  edit_materials:     { default: false, label: 'Может редактировать материалы курса' },
  manage_tasks:       { default: false, label: 'Может создавать/удалять модули и задачи' },
  see_subscriptions:  { default: true,  label: 'Видит остатки абонементов учеников' },
  conduct_lessons:    { default: true,  label: 'Может проводить занятия и отмечать посещаемость' },
  upload_artifacts:   { default: true,  label: 'Может загружать видеоотчёты и файлы работ' },
  write_feedback:     { default: true,  label: 'Может оставлять отзывы об учениках' },
  manage_whatsapp:    { default: false, label: 'Может отправлять WhatsApp-напоминания по своим группам' },
};

function getPermissions(teacherId) {
  const rows = db.prepare('SELECT permission_key, value FROM teacher_permissions WHERE teacher_id = ?').all(teacherId);
  const map = {};
  for (const key of Object.keys(PERMISSION_KEYS)) map[key] = PERMISSION_KEYS[key].default;
  for (const r of rows) map[r.permission_key] = !!r.value;
  return map;
}

function setPermission(teacherId, key, value) {
  if (!(key in PERMISSION_KEYS)) return false;
  db.prepare(`
    INSERT INTO teacher_permissions (teacher_id, permission_key, value)
    VALUES (?, ?, ?)
    ON CONFLICT(teacher_id, permission_key) DO UPDATE SET value = excluded.value
  `).run(teacherId, key, value ? 1 : 0);
  return true;
}

// user — объект из req.user (.role, .id)
function hasPermission(user, key) {
  if (!user) return false;
  if (user.role === 'admin') return true;          // админ может всё
  if (user.role !== 'teacher' && user.role !== 'assistant') return false;
  const perms = getPermissions(user.id);
  return !!perms[key];
}

module.exports = { PERMISSION_KEYS, getPermissions, setPermission, hasPermission };
