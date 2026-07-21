const db = require('./db');
const { genId } = require('./util');

function curatorIds(branchId) {
  return db.prepare(`SELECT cb.curator_id id FROM curator_branches cb JOIN users u ON u.id=cb.curator_id
    WHERE cb.branch_id=? AND u.role='curator'`).all(branchId).map(x => x.id);
}

function notifyBranch(branchId, text, link = '/curator/index.html#cases', type = 'curator_case') {
  const now = Date.now();
  const insert = db.prepare(`INSERT INTO notifications(id,user_id,type,text,link,channel,read,created_at)
    VALUES (?,?,?,?,?,'in_app',0,?)`);
  for (const userId of curatorIds(branchId)) insert.run(genId('ntf'), userId, type, text, link, now);
}

function createCase({ studentId, category, description, source = 'system' }) {
  const student = db.prepare(`SELECT sc.full_name,sc.branch_id FROM students_crm sc WHERE sc.user_id=?`).get(studentId);
  if (!student?.branch_id) return null;
  const existing = db.prepare("SELECT * FROM curator_cases WHERE student_id=? AND category=? AND status<>'resolved'").get(studentId, category);
  if (existing) return existing;
  const now = Date.now(), id = genId('case');
  db.prepare(`INSERT INTO curator_cases(id,student_id,branch_id,category,status,source,description,created_at,updated_at)
    VALUES (?,?,?,?,'new',?,?,?,?)`).run(id, studentId, student.branch_id, category, source, description || null, now, now);
  const label = { debtor:'Должник', at_risk:'Потенциальная потеря', absence:'Отсутствие' }[category];
  notifyBranch(student.branch_id, `Новая задача: ${label} — ${student.full_name}`);
  return db.prepare('SELECT * FROM curator_cases WHERE id=?').get(id);
}

function syncAutomaticCases(branchIds) {
  if (!branchIds.length) return;
  const ph = branchIds.map(() => '?').join(',');
  const debtors = db.prepare(`SELECT user_id,full_name,visits_left,next_payment_at FROM students_crm
    WHERE branch_id IN (${ph}) AND status='active' AND (visits_left<=0 OR (next_payment_at IS NOT NULL AND next_payment_at<?))`).all(...branchIds, Date.now());
  debtors.forEach(s => createCase({ studentId:s.user_id, category:'debtor', description:s.visits_left<=0?'Закончились занятия в абонементе':'Просрочена плановая оплата' }));
  const risks = db.prepare(`SELECT sa.student_id,AVG(COALESCE(sa.class_score,3)) class_avg,AVG(COALESCE(sa.homework_score,3)) hw_avg
    FROM student_assessments sa JOIN students_crm sc ON sc.user_id=sa.student_id
    WHERE sc.branch_id IN (${ph}) AND sa.updated_at>? GROUP BY sa.student_id
    HAVING COUNT(*)>=2 AND (class_avg<3 OR hw_avg<3)`).all(...branchIds, Date.now()-45*86400000);
  risks.forEach(s => createCase({ studentId:s.student_id, category:'at_risk', description:'Средняя оценка ниже 3 за последние занятия' }));
}

module.exports = { createCase, syncAutomaticCases, notifyBranch, curatorIds };
