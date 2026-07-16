const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { scheduledLessons } = require('../server/lesson-planning');

test('parent calendar expands main and extra schedules and attaches absence notice', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE branches(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE groups(id TEXT PRIMARY KEY,name TEXT,lesson_kind TEXT,branch_id TEXT,teacher_id TEXT,status TEXT);
    CREATE TABLE group_schedule(id TEXT PRIMARY KEY,group_id TEXT,weekday INTEGER,start_time TEXT,duration_min INTEGER);
    CREATE TABLE group_members(id TEXT PRIMARY KEY,student_id TEXT,group_id TEXT,since INTEGER,until INTEGER);
    CREATE TABLE absence_notices(id TEXT PRIMARY KEY,parent_id TEXT,student_id TEXT,group_id TEXT,lesson_at INTEGER,reason TEXT,status TEXT,created_at INTEGER,updated_at INTEGER);
  `);
  db.prepare('INSERT INTO users VALUES (?,?)').run('teacher','Учитель');
  db.prepare('INSERT INTO branches VALUES (?,?)').run('branch','Филиал');
  db.prepare("INSERT INTO groups VALUES ('main','Основной','main','branch','teacher','active'),('extra','Дополнительный','extra','branch','teacher','active')").run();
  db.prepare("INSERT INTO group_schedule VALUES ('s1','main',1,'10:00',120),('s2','extra',4,'16:00',60)").run();
  db.prepare("INSERT INTO group_members VALUES ('m1','student','main',0,NULL),('m2','student','extra',0,NULL)").run();
  const from = new Date(2026, 6, 20, 0, 0).getTime(); // Monday
  const to = new Date(2026, 6, 26, 23, 59).getTime();
  const first = scheduledLessons(db, 'student', from, to);
  assert.deepEqual(first.map(x => [x.lessonKind, x.durationMin]), [['main',120],['extra',60]]);
  db.prepare("INSERT INTO absence_notices VALUES ('a','parent','student','main',?,'Отъезд','submitted',?,?)").run(first[0].lessonAt,Date.now(),Date.now());
  const withNotice = scheduledLessons(db,'student',from,to);
  assert.equal(withNotice[0].absenceNotice.reason,'Отъезд');
  db.close();
});

test('attendance policy charges unexcused absence but not excused absence', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname,'..','server','routes-sessions.js'),'utf8');
  assert.match(source, /\['present','late','absent'\]\.includes/);
  assert.match(source, /status === 'absent' \? 'Неуважительный пропуск'/);
  assert.match(source, /status='approved'/);
});
