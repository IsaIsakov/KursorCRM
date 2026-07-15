/* ============================================================
   KURSOR — Фоновые задачи (раз в сутки):
   1) Удаление просроченных видео (старше 30 дней), пометка deleted=1.
   2) Генерация уведомлений: низкий остаток абонемента,
      скорое окончание доступа учителя к курсу.
   Текстовый фидбек и не-видео артефакты сохраняются навсегда.
   ============================================================ */
const db = require('./db');
const storage = require('./storage');
const { genId } = require('./util');

function cleanupExpiredVideos() {
  try {
    const expired = db.prepare(
      "SELECT * FROM session_artifacts WHERE type='video' AND deleted=0 AND expires_at IS NOT NULL AND expires_at < ?"
    ).all(Date.now());
    for (const row of expired) {
      if (row.file_path) storage.deleteFile(row.file_path);
      db.prepare("UPDATE session_artifacts SET deleted=1 WHERE id=?").run(row.id);
    }
    if (expired.length) console.log(`[cleanup] Удалено просроченных видео: ${expired.length}`);
  } catch (e) {
    console.error('[cleanup] Ошибка очистки видео:', e.message);
  }
}

// Не дублируем одинаковые уведомления чаще раза в сутки
function notifyOnce(userId, type, text, link) {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recent = db.prepare(
    'SELECT 1 FROM notifications WHERE user_id=? AND type=? AND created_at > ? LIMIT 1'
  ).get(userId, type, dayAgo);
  if (recent) return;
  db.prepare('INSERT INTO notifications (id, user_id, type, text, link, channel, read, created_at) VALUES (?,?,?,?,?,?,0,?)')
    .run(genId('ntf'), userId, type, text, link || null, 'in_app', Date.now());
}

function generateNotifications() {
  try {
    // 1) Низкий остаток (<=2) — менеджеру и родителям
    const low = db.prepare("SELECT user_id, full_name, responsible_manager_id, visits_left FROM students_crm WHERE status='active' AND visits_left <= 2").all();
    for (const s of low) {
      const text = `У ученика «${s.full_name}» осталось занятий: ${s.visits_left}`;
      if (s.responsible_manager_id) notifyOnce(s.responsible_manager_id, 'low_visits', text, '/admin/index.html');
      const parents = db.prepare('SELECT parent_id FROM parent_children WHERE student_id = ?').all(s.user_id);
      for (const p of parents) notifyOnce(p.parent_id, 'low_visits', text, '/pages/parent.html');
    }
    // 2) Доступ учителя к курсу истекает в течение 7 дней
    const soon = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const expiring = db.prepare('SELECT teacher_id, course_id, expires_at FROM teacher_course_access WHERE expires_at > ? AND expires_at < ?').all(Date.now(), soon);
    for (const a of expiring) {
      const m = db.prepare('SELECT title FROM modules WHERE id = ?').get(a.course_id);
      notifyOnce(a.teacher_id, 'access_expiring', `Доступ к курсу «${m ? m.title : a.course_id}» скоро закончится`, '/pages/teacher.html');
    }
  } catch (e) {
    console.error('[cleanup] Ошибка генерации уведомлений:', e.message);
  }
}

function runAll() {
  cleanupExpiredVideos();
  generateNotifications();
}

function start() {
  runAll(); // при старте
  setInterval(runAll, 24 * 60 * 60 * 1000); // раз в сутки
  console.log('[cleanup] Фоновые задачи запущены (раз в сутки).');
}

module.exports = { start, runAll, cleanupExpiredVideos, generateNotifications };
