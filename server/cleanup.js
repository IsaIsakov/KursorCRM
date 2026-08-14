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
let timer = null;
let lessonTimer = null;

async function cleanupExpiredVideos() {
  try {
    const expired = db.prepare(
      "SELECT * FROM session_artifacts WHERE type='video' AND deleted=0 AND expires_at IS NOT NULL AND expires_at < ?"
    ).all(Date.now());
    for (const row of expired) {
      if (row.file_path) await storage.deleteFile(row.file_path);
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

function generateUnmarkedLessonNotifications() {
  try {
    const offset=Number(process.env.APP_TIMEZONE_OFFSET_MINUTES||300),now=Date.now();
    for(const daysAgo of [0,1]){
      const local=new Date(now+offset*60000-daysAgo*86400000);
      const ymd=`${local.getUTCFullYear()}-${String(local.getUTCMonth()+1).padStart(2,'0')}-${String(local.getUTCDate()).padStart(2,'0')}`;
      const weekday=local.getUTCDay();
      const schedules=db.prepare(`SELECT gs.start_time,gs.duration_min,g.id group_id,g.name group_name,g.branch_id
        FROM group_schedule gs JOIN groups g ON g.id=gs.group_id
        WHERE gs.weekday=? AND g.status='active'`).all(weekday);
      for(const row of schedules){
        const [hh,mm]=row.start_time.split(':').map(Number);
        const end=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate(),hh,mm)-offset*60000+row.duration_min*60000;
        if(end>=now)continue;
        const done=db.prepare("SELECT 1 FROM lesson_sessions WHERE group_id=? AND lesson_day=? AND status='conducted'").get(row.group_id,ymd);
        if(done)continue;
        const recipients=[
          ...db.prepare(`SELECT cb.curator_id id,'/curator/index.html#lessons' link FROM curator_branches cb WHERE cb.branch_id=?`).all(row.branch_id),
          ...db.prepare(`SELECT id,'/admin/index.html#calendar' link FROM users WHERE role='admin'`).all(),
        ];
        for(const recipient of recipients)db.prepare(`INSERT OR IGNORE INTO notifications
          (id,user_id,type,text,link,channel,read,created_at) VALUES (?,?, 'unmarked_lesson', ?, ?, 'in_app',0,?)`)
          .run(`unmarked_${row.group_id}_${ymd}_${recipient.id}`,recipient.id,
            `Занятие «${row.group_name}» ${ymd} в ${row.start_time} не проведено вовремя`,recipient.link,now);
      }
    }
  } catch(e){ console.error('[cleanup] Ошибка контроля непроведённых занятий:',e.message); }
}

async function runAll() {
  await cleanupExpiredVideos();
  generateNotifications();
}

function start() {
  if (timer) return;
  runAll().catch(error => console.error('[cleanup] Ошибка обслуживания:', error.message)); // при старте
  timer = setInterval(() => runAll().catch(error => console.error('[cleanup] Ошибка обслуживания:', error.message)), 24 * 60 * 60 * 1000); // раз в сутки
  timer.unref();
  generateUnmarkedLessonNotifications();
  lessonTimer=setInterval(generateUnmarkedLessonNotifications,5*60*1000);
  lessonTimer.unref();
  console.log('[cleanup] Фоновые задачи запущены (обслуживание раз в сутки, контроль уроков каждые 5 минут).');
}
function stop() { if (timer) clearInterval(timer);if(lessonTimer)clearInterval(lessonTimer);timer=null;lessonTimer=null; }

module.exports = { start, stop, runAll, cleanupExpiredVideos, generateNotifications, generateUnmarkedLessonNotifications };
