const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');

process.env.APP_TIMEZONE_OFFSET_MINUTES = '300';
const daily = require('../server/daily-operations');

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT);
    CREATE TABLE branches(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE groups(id TEXT PRIMARY KEY,name TEXT,lesson_kind TEXT,branch_id TEXT,teacher_id TEXT,assistant_id TEXT,status TEXT);
    CREATE TABLE group_schedule(id TEXT PRIMARY KEY,group_id TEXT,weekday INTEGER,start_time TEXT,duration_min INTEGER);
    CREATE TABLE group_members(id TEXT PRIMARY KEY,student_id TEXT,group_id TEXT,since INTEGER,until INTEGER);
    CREATE TABLE lesson_sessions(id TEXT PRIMARY KEY,group_id TEXT,lesson_day TEXT,status TEXT,start_time TEXT,duration_min INTEGER,scheduled_teacher_id TEXT,scheduled_assistant_id TEXT,topic TEXT);
    CREATE TABLE lesson_session_members(lesson_session_id TEXT,student_id TEXT,active INTEGER);
    CREATE TABLE attendance(id TEXT PRIMARY KEY,lesson_session_id TEXT,student_id TEXT,status TEXT,marked_at INTEGER);
    CREATE TABLE session_artifacts(id TEXT PRIMARY KEY,lesson_session_id TEXT,student_id TEXT,deleted INTEGER);
    CREATE TABLE teacher_pay_rates(teacher_id TEXT PRIMARY KEY,rate_type TEXT,main_rate REAL,assistant_rate REAL,currency TEXT);
    CREATE TABLE teacher_day_reports(
      id TEXT PRIMARY KEY,teacher_id TEXT,branch_id TEXT,report_day TEXT,status TEXT,planned_lessons INTEGER,
      ended_lessons INTEGER,conducted_lessons INTEGER,missed_lessons INTEGER,scheduled_minutes INTEGER,
      conducted_minutes INTEGER,attendance_expected INTEGER,attendance_marked INTEGER,present_count INTEGER,
      late_count INTEGER,absent_count INTEGER,excused_count INTEGER,reports_required INTEGER,reports_uploaded INTEGER,
      reports_missing INTEGER,salary_amount REAL,salary_configured INTEGER,details_json TEXT,generated_at INTEGER,updated_at INTEGER,
      UNIQUE(teacher_id,branch_id,report_day));
    CREATE TABLE crm_tasks(
      id TEXT PRIMARY KEY,title TEXT,description TEXT,due_at INTEGER,priority TEXT,status TEXT,assigned_to TEXT,
      student_id TEXT,lead_id TEXT,created_by TEXT,created_at INTEGER,completed_at INTEGER,branch_id TEXT,
      task_type TEXT,source_key TEXT UNIQUE,teacher_id TEXT,lesson_session_id TEXT,resolved_by TEXT,resolution_note TEXT,updated_at INTEGER);
    CREATE TABLE curator_branches(curator_id TEXT,branch_id TEXT);
    CREATE TABLE notifications(id TEXT PRIMARY KEY,user_id TEXT,type TEXT,text TEXT,link TEXT,channel TEXT,read INTEGER,created_at INTEGER);
  `);
  db.exec(`
    INSERT INTO users VALUES ('teacher','Айбек','teacher'),('curator','Ясмин','curator'),('s1','Алия','student'),('s2','Нуржан','student');
    INSERT INTO branches VALUES ('branch','Жошы Хан');
    INSERT INTO groups VALUES ('group','Python','main','branch','teacher',NULL,'active');
    INSERT INTO group_schedule VALUES ('schedule','group',3,'10:00',120);
    INSERT INTO group_members VALUES ('m1','s1','group',0,NULL),('m2','s2','group',0,NULL);
    INSERT INTO lesson_sessions VALUES ('lesson','group','2026-09-02','conducted','10:00',120,'teacher',NULL,'Переменные');
    INSERT INTO attendance VALUES ('a1','lesson','s1','present',1),('a2','lesson','s2','absent',1);
    INSERT INTO session_artifacts VALUES ('photo','lesson','s1',0);
    INSERT INTO teacher_pay_rates VALUES ('teacher','per_lesson',5000,2500,'KZT');
    INSERT INTO curator_branches VALUES ('curator','branch');
  `);
  return db;
}

test('daily report joins schedule, attendance, photo reports and salary', () => {
  const db = database();
  const now = daily.scheduledAt('2026-09-02','13:00');
  const report = daily.refreshTeacherDay({ db,teacherId:'teacher',branchId:'branch',reportDay:'2026-09-02',now });
  assert.equal(report.status, 'complete');
  assert.equal(report.plannedLessons, 1);
  assert.equal(report.conductedLessons, 1);
  assert.equal(report.attendanceExpected, 2);
  assert.equal(report.attendanceMarked, 2);
  assert.equal(report.presentCount, 1);
  assert.equal(report.absentCount, 1);
  assert.equal(report.reportsRequired, 1);
  assert.equal(report.reportsUploaded, 1);
  assert.equal(report.salaryAmount, 5000);
  assert.equal(report.salaryConfigured, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_tasks').get().n, 0);
  db.close();
});

test('one curator task is updated idempotently and auto-closes after correction', () => {
  const db = database();
  const now = daily.scheduledAt('2026-09-02','13:00');
  db.prepare('UPDATE lesson_sessions SET topic=NULL WHERE id=?').run('lesson');
  db.prepare('DELETE FROM session_artifacts').run();
  const first = daily.refreshTeacherDay({ db,teacherId:'teacher',branchId:'branch',reportDay:'2026-09-02',now });
  assert.equal(first.status, 'needs_attention');
  assert.equal(first.reportsMissing, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM crm_tasks WHERE status='open'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE type='teacher_day_issue'").get().n, 1);

  daily.refreshTeacherDay({ db,teacherId:'teacher',branchId:'branch',reportDay:'2026-09-02',now:now+1000 });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_tasks').get().n, 1);

  db.prepare("UPDATE lesson_sessions SET topic='Переменные' WHERE id='lesson'").run();
  db.prepare("INSERT INTO session_artifacts VALUES ('photo2','lesson','s1',0)").run();
  const fixed = daily.refreshTeacherDay({ db,teacherId:'teacher',branchId:'branch',reportDay:'2026-09-02',now:now+2000 });
  assert.equal(fixed.status, 'complete');
  assert.equal(db.prepare('SELECT status FROM crm_tasks').get().status, 'done');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE type='teacher_day_issue'").get().n, 0);
  db.close();
});

test('hourly assistant rate uses actual lesson duration', () => {
  const db = database();
  db.prepare("INSERT INTO users VALUES ('assistant','Дана','teacher')").run();
  db.prepare("UPDATE groups SET assistant_id='assistant'").run();
  db.prepare("INSERT INTO teacher_pay_rates VALUES ('assistant','hourly',3000,1800,'KZT')").run();
  const report = daily.refreshTeacherDay({ db,teacherId:'assistant',branchId:'branch',reportDay:'2026-09-02',now:daily.scheduledAt('2026-09-02','13:00') });
  assert.equal(report.salaryAmount, 3600);
  assert.equal(report.details[0].role, 'assistant');
  db.close();
});

test('admin, teacher and curator interfaces expose the connected daily workflow', () => {
  const root = path.join(__dirname, '..');
  const admin = fs.readFileSync(path.join(root,'public/admin/index.html'),'utf8');
  const teacher = fs.readFileSync(path.join(root,'public/pages/teacher.html'),'utf8');
  const curator = fs.readFileSync(path.join(root,'public/curator/index.html'),'utf8');
  const sessions = fs.readFileSync(path.join(root,'server/routes-sessions.js'),'utf8');
  const artifacts = fs.readFileSync(path.join(root,'server/routes-artifacts.js'),'utf8');
  assert.match(admin, /f_main_rate/);
  assert.match(admin, /f_assistant_rate/);
  assert.match(teacher, /teacher\/day-reports/);
  assert.match(curator, /curator\/operations-tasks/);
  assert.match(curator, /Итог дня преподавателей/);
  assert.match(sessions, /refreshSessionDay\(lessonSessionId\)/);
  assert.match(artifacts, /refreshDailyReport\(lessonSessionId\)/);
});
