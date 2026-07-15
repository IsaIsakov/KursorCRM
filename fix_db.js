/**
 * KURSOR — починка базы данных.
 * Запускается автоматически при RUN_DB_FIX=true
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'server', 'db', 'kursor.sqlite');
if (!fs.existsSync(DB_PATH)) { console.error('[fix_db] ❌ База не найдена:', DB_PATH); process.exit(1); }

console.log('[fix_db] 📂 База:', DB_PATH);
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF');

const allTables = () => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
const tableExists = (n) => !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='${n}'`).get();
const tableSql    = (n) => { const r = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${n}'`).get(); return r ? r.sql : ''; };

console.log('[fix_db] 📋 Таблицы до:', allTables().join(', '));

// ── 1. Почистить все *_old мусорные таблицы ───────────────────────────────────
for (const t of allTables()) {
  if (t.endsWith('_old')) {
    console.log(`[fix_db] 🗑  Удаляю мусор: ${t}`);
    db.exec(`DROP TABLE IF EXISTS ${t}`);
  }
}

// ── 2. Пересоздать users без CHECK(role IN) ───────────────────────────────────
if (tableSql('users').includes('CHECK(role IN')) {
  console.log('[fix_db] ⚠️  users: снимаю CHECK(role)...');
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  const want = ['id','login','password_hash','name','role','age','group_id','languages','teacher_id','avatar_url','created_at'];
  const copy = want.filter(c => cols.includes(c)).join(',');
  db.exec('ALTER TABLE users RENAME TO users_old');
  db.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY, login TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
    name TEXT NOT NULL, role TEXT NOT NULL, age INTEGER DEFAULT 0,
    group_id INTEGER DEFAULT 0, languages TEXT DEFAULT '[]',
    teacher_id TEXT, avatar_url TEXT, created_at INTEGER NOT NULL,
    FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE SET NULL
  )`);
  db.exec(`INSERT INTO users (${copy}) SELECT ${copy} FROM users_old`);
  db.exec('DROP TABLE users_old');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_role    ON users(role)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_teacher ON users(teacher_id)');
  console.log('[fix_db] ✅ users: CHECK(role) снят.');
}
try {
  if (!db.prepare('PRAGMA table_info(users)').all().map(c=>c.name).includes('avatar_url')) {
    db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT');
    console.log('[fix_db] ✅ users: добавлена avatar_url.');
  }
} catch {}

// ── 3. Пересоздать groups без NOT NULL на teacher_id ─────────────────────────
if (/teacher_id\s+TEXT\s+NOT\s+NULL/i.test(tableSql('groups'))) {
  console.log('[fix_db] ⚠️  groups: снимаю NOT NULL с teacher_id...');
  const cols = db.prepare('PRAGMA table_info(groups)').all().map(c => c.name);
  db.exec('ALTER TABLE groups RENAME TO groups_old');
  db.exec(`CREATE TABLE groups (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, course_id TEXT,
    branch_id TEXT NOT NULL, teacher_id TEXT, assistant_id TEXT,
    lesson_kind TEXT NOT NULL DEFAULT 'main' CHECK(lesson_kind IN ('main','extra')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
    FOREIGN KEY (branch_id) REFERENCES branches(id),
    FOREIGN KEY (teacher_id) REFERENCES users(id),
    FOREIGN KEY (assistant_id) REFERENCES users(id)
  )`);
  db.exec(`INSERT INTO groups (${cols.join(',')}) SELECT ${cols.join(',')} FROM groups_old`);
  db.exec('DROP TABLE groups_old');
  db.exec('CREATE INDEX IF NOT EXISTS idx_groups_branch  ON groups(branch_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_groups_teacher ON groups(teacher_id)');
  console.log('[fix_db] ✅ groups: NOT NULL снят.');
}

// ── 4. КЛЮЧЕВОЙ ФИКС: пересоздать ВСЕ таблицы со сломанным FK на *_old ─────────
// Когда users / groups / tasks переименовывались в *_old без PRAGMA legacy_alter_table = ON,
// SQLite ≥3.25 автоматически обновил FK во всех дочерних таблицах на *_old.
// После того как *_old была удалена, эти дочерние таблицы навечно ссылаются на
// несуществующие таблицы, и любая вставка в них падает с no such table: main.users_old
// (или groups_old / tasks_old). Единственный способ — пересоздать их.

const FK_FIX_TABLES = {
  progress: {
    create: `CREATE TABLE progress (
      user_id TEXT PRIMARY KEY,
      points INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      last_active INTEGER,
      badges TEXT NOT NULL DEFAULT '["beginner"]',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    indexes: [],
  },
  task_progress: {
    create: `CREATE TABLE task_progress (
      user_id TEXT NOT NULL, task_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('progress','done')),
      points INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
      used_hint INTEGER NOT NULL DEFAULT 0, submission TEXT,
      completed_at INTEGER, updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, task_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_task_progress_user ON task_progress(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_task_progress_task ON task_progress(task_id)',
    ],
  },
  lesson_progress: {
    create: `CREATE TABLE lesson_progress (
      user_id TEXT NOT NULL, module_id TEXT NOT NULL,
      intro_step INTEGER NOT NULL DEFAULT 0, intro_done INTEGER NOT NULL DEFAULT 0,
      mini_done INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, module_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
    )`,
    indexes: ['CREATE INDEX IF NOT EXISTS idx_lesson_progress_user ON lesson_progress(user_id)'],
  },
  feedback: {
    create: `CREATE TABLE feedback (
      id TEXT PRIMARY KEY, teacher_id TEXT NOT NULL, student_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('lesson','course','general')),
      lesson_session_id TEXT, module_id TEXT, text TEXT NOT NULL,
      is_internal INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
      FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_feedback_student ON feedback(student_id)',
      'CREATE INDEX IF NOT EXISTS idx_feedback_teacher ON feedback(teacher_id)',
    ],
  },
  teacher_course_access: {
    create: `CREATE TABLE teacher_course_access (
      id TEXT PRIMARY KEY, teacher_id TEXT NOT NULL, course_id TEXT NOT NULL,
      granted_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, granted_by TEXT NOT NULL,
      FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (course_id) REFERENCES modules(id) ON DELETE CASCADE
    )`,
    indexes: ['CREATE INDEX IF NOT EXISTS idx_tca_teacher ON teacher_course_access(teacher_id)'],
  },
  students_crm: {
    create: `CREATE TABLE students_crm (
      user_id TEXT PRIMARY KEY, full_name TEXT NOT NULL,
      birth_date TEXT, gender TEXT, branch_id TEXT, tariff_id TEXT,
      subscription_issued_at INTEGER, visits_left INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','frozen','inactive')),
      responsible_manager_id TEXT, parent_name TEXT, parent_phone TEXT,
      document_id TEXT, comment TEXT,
      video_consent INTEGER NOT NULL DEFAULT 0, video_consent_date INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES branches(id),
      FOREIGN KEY (tariff_id) REFERENCES tariffs(id),
      FOREIGN KEY (responsible_manager_id) REFERENCES users(id)
    )`,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_crm_branch  ON students_crm(branch_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_status  ON students_crm(status)',
    ],
  },
  teacher_permissions: {
    create: `CREATE TABLE teacher_permissions (
      teacher_id TEXT NOT NULL, permission_key TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (teacher_id, permission_key),
      FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    indexes: [],
  },
  lesson_sessions: {
    create: `CREATE TABLE lesson_sessions (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, date TEXT NOT NULL,
      topic TEXT, conducted_by TEXT, created_at INTEGER NOT NULL,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (conducted_by) REFERENCES users(id)
    )`,
    indexes: ['CREATE INDEX IF NOT EXISTS idx_ls_group ON lesson_sessions(group_id)'],
  },
  attendance: {
    create: `CREATE TABLE attendance (
      id TEXT PRIMARY KEY, lesson_session_id TEXT NOT NULL, student_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('present','absent','excused','late')),
      marked_at INTEGER NOT NULL,
      FOREIGN KEY (lesson_session_id) REFERENCES lesson_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    indexes: [
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique ON attendance(lesson_session_id, student_id)',
      'CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id)',
    ],
  },
  homework_assignments: {
    create: `CREATE TABLE homework_assignments (
      id TEXT PRIMARY KEY, homework_id TEXT NOT NULL, student_id TEXT NOT NULL,
      FOREIGN KEY (homework_id) REFERENCES homework(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_ha_student ON homework_assignments(student_id)',
      'CREATE INDEX IF NOT EXISTS idx_ha_hw      ON homework_assignments(homework_id)',
    ],
  },
  session_artifacts: {
    create: `CREATE TABLE session_artifacts (
      id TEXT PRIMARY KEY, lesson_session_id TEXT NOT NULL, student_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('video','screenshot','file','link')),
      title TEXT, file_path TEXT, url TEXT,
      created_at INTEGER NOT NULL, expires_at INTEGER,
      deleted INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (lesson_session_id) REFERENCES lesson_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_sa_student ON session_artifacts(student_id)',
      'CREATE INDEX IF NOT EXISTS idx_sa_session ON session_artifacts(lesson_session_id)',
      'CREATE INDEX IF NOT EXISTS idx_sa_expires ON session_artifacts(expires_at)',
    ],
  },
  parent_children: {
    create: `CREATE TABLE parent_children (
      id TEXT PRIMARY KEY, parent_id TEXT NOT NULL, student_id TEXT NOT NULL,
      since INTEGER NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_pc_parent  ON parent_children(parent_id)',
      'CREATE INDEX IF NOT EXISTS idx_pc_student ON parent_children(student_id)',
    ],
  },
  notifications: {
    create: `CREATE TABLE notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      text TEXT NOT NULL, link TEXT,
      channel TEXT NOT NULL DEFAULT 'in_app',
      read INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    indexes: ['CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read)'],
  },
  group_members: {
    create: `CREATE TABLE group_members (
      id TEXT PRIMARY KEY, student_id TEXT NOT NULL, group_id TEXT NOT NULL,
      since INTEGER NOT NULL, until INTEGER,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id)   REFERENCES groups(id) ON DELETE CASCADE
    )`,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_gm_student ON group_members(student_id)',
      'CREATE INDEX IF NOT EXISTS idx_gm_group   ON group_members(group_id)',
    ],
  },
  group_schedule: {
    create: `CREATE TABLE group_schedule (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL,
      weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
      start_time TEXT NOT NULL, duration_min INTEGER NOT NULL,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    )`,
    indexes: ['CREATE INDEX IF NOT EXISTS idx_gs_group ON group_schedule(group_id)'],
  },
};

function recreateBrokenTable(name, schema) {
  if (!tableExists(name)) return false;
  const sql = tableSql(name);
  const broken = /users_old|groups_old|tasks_old/i.test(sql);
  if (!broken) return false;
  console.log(`[fix_db] ⚠️  ${name}: FK сломан (ссылается на *_old) — пересоздаю...`);
  const oldCols = db.prepare(`PRAGMA table_info(${name})`).all().map(c => c.name);
  const tmp = `${name}_brokenfk_${Date.now()}`;
  db.pragma('legacy_alter_table = ON');
  db.exec(`ALTER TABLE ${name} RENAME TO ${tmp}`);
  db.pragma('legacy_alter_table = OFF');
  db.exec(schema.create);
  for (const idx of schema.indexes) db.exec(idx);
  const newCols = db.prepare(`PRAGMA table_info(${name})`).all().map(c => c.name);
  const common = oldCols.filter(c => newCols.includes(c));
  if (common.length) {
    db.exec(`INSERT INTO ${name} (${common.join(',')}) SELECT ${common.join(',')} FROM ${tmp}`);
  }
  db.exec(`DROP TABLE ${tmp}`);
  console.log(`[fix_db] ✅ ${name}: пересоздана.`);
  return true;
}

let fixedCount = 0;
for (const [name, schema] of Object.entries(FK_FIX_TABLES)) {
  try {
    if (recreateBrokenTable(name, schema)) fixedCount++;
  } catch (e) {
    console.error(`[fix_db] ❌ ${name}: ошибка починки —`, e.message);
  }
}
console.log(`[fix_db] 🔧 Починено сломанных FK: ${fixedCount}`);

// Историческая ветка «пересоздать для надёжности» group_members / group_schedule оставлена
// на случай, если FK не был сломан, но пользователь хочет жёстко прогнать пересоздание.
if (tableExists('group_members')) {
  const fkBroken = tableSql('group_members').includes('groups_old');
  if (fkBroken) {
    console.log('[fix_db] ⚠️  group_members: FK сломан (ссылается на groups_old) — пересоздаю...');
  } else {
    console.log('[fix_db] ℹ️  group_members: пересоздаю для надёжности...');
  }
  // Сохраняем данные
  const rows = db.prepare('SELECT * FROM group_members').all();
  db.exec('DROP TABLE group_members');
  db.exec(`CREATE TABLE group_members (
    id TEXT PRIMARY KEY, student_id TEXT NOT NULL, group_id TEXT NOT NULL,
    since INTEGER NOT NULL, until INTEGER,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id)   REFERENCES groups(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_gm_student ON group_members(student_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_gm_group   ON group_members(group_id)');
  if (rows.length) {
    const ins = db.prepare('INSERT INTO group_members (id,student_id,group_id,since,until) VALUES (?,?,?,?,?)');
    rows.forEach(r => ins.run(r.id, r.student_id, r.group_id, r.since, r.until));
    console.log(`[fix_db] ✅ group_members пересоздана, данные сохранены (${rows.length} строк).`);
  } else {
    console.log('[fix_db] ✅ group_members пересоздана (пустая).');
  }
}

if (tableExists('group_schedule')) {
  const fkBroken = tableSql('group_schedule').includes('groups_old');
  if (fkBroken) {
    console.log('[fix_db] ⚠️  group_schedule: FK сломан (ссылается на groups_old) — пересоздаю...');
  } else {
    console.log('[fix_db] ℹ️  group_schedule: пересоздаю для надёжности...');
  }
  const rows = db.prepare('SELECT * FROM group_schedule').all();
  db.exec('DROP TABLE group_schedule');
  db.exec(`CREATE TABLE group_schedule (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL,
    weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
    start_time TEXT NOT NULL, duration_min INTEGER NOT NULL,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_gs_group ON group_schedule(group_id)');
  if (rows.length) {
    const ins = db.prepare('INSERT INTO group_schedule (id,group_id,weekday,start_time,duration_min) VALUES (?,?,?,?,?)');
    rows.forEach(r => ins.run(r.id, r.group_id, r.weekday, r.start_time, r.duration_min));
    console.log(`[fix_db] ✅ group_schedule пересоздана, данные сохранены (${rows.length} строк).`);
  } else {
    console.log('[fix_db] ✅ group_schedule пересоздана (пустая).');
  }
}

// ── 5. Создать таблицы если вообще нет ───────────────────────────────────────
if (!tableExists('group_members')) {
  db.exec(`CREATE TABLE group_members (
    id TEXT PRIMARY KEY, student_id TEXT NOT NULL, group_id TEXT NOT NULL,
    since INTEGER NOT NULL, until INTEGER,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id)   REFERENCES groups(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_gm_student ON group_members(student_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_gm_group   ON group_members(group_id)');
  console.log('[fix_db] ✅ group_members создана.');
}
if (!tableExists('group_schedule')) {
  db.exec(`CREATE TABLE group_schedule (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL,
    weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
    start_time TEXT NOT NULL, duration_min INTEGER NOT NULL,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_gs_group ON group_schedule(group_id)');
  console.log('[fix_db] ✅ group_schedule создана.');
}

db.pragma('foreign_keys = ON');
console.log('[fix_db] 📋 Таблицы после:', allTables().join(', '));
console.log('[fix_db] 🎉 Готово!');
db.close();
