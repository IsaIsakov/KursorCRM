const crypto = require('crypto');

function checksum(migration) {
  return crypto.createHash('sha256').update(`${migration.version}:${migration.name}:${migration.up.toString()}`).digest('hex');
}

const MIGRATIONS = [
  {
    version: 1,
    name: 'baseline_core_schema',
    up(db) {
      const required = ['users', 'modules', 'tasks'];
      for (const table of required) {
        if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
          throw new Error(`Отсутствует базовая таблица ${table}`);
        }
      }
    },
  },
  {
    version: 2,
    name: 'subscription_accounting_indexes',
    up(db) {
      const required = ['subscriptions', 'subscription_transactions', 'subscription_payments', 'subscription_freezes'];
      for (const table of required) {
        if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
          throw new Error(`Отсутствует таблица абонементов ${table}`);
        }
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_subscriptions_expiry ON subscriptions(expires_at) WHERE status='active';
        CREATE INDEX IF NOT EXISTS idx_sub_payments_student ON subscription_payments(student_id, paid_at DESC);
      `);
    },
  },
  {
    version: 3,
    name: 'security_audit_indexes',
    up(db) {
      db.exec('CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource, created_at DESC)');
    },
  },
  {
    version: 4,
    name: 'production_query_indexes',
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_notifications_user_channel_created ON notifications(user_id, channel, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read) WHERE read=0;
        CREATE INDEX IF NOT EXISTS idx_feedback_student_created ON feedback(student_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_feedback_teacher_created ON feedback(teacher_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_lesson_sessions_group_date ON lesson_sessions(group_id, date DESC);
        CREATE INDEX IF NOT EXISTS idx_homework_session_created ON homework(lesson_session_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_artifacts_session_student ON session_artifacts(lesson_session_id, student_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_group_members_active ON group_members(group_id, student_id, since, until);
        CREATE INDEX IF NOT EXISTS idx_crm_manager ON students_crm(responsible_manager_id, status);
      `);
      db.pragma('optimize');
    },
  },
  {
    version: 5,
    name: 'encrypt_integration_secrets',
    up(db) {
      const row = db.prepare("SELECT value FROM app_settings WHERE key='whatsapp'").get();
      if (!row) return;
      const value = JSON.parse(row.value);
      if (!value.apiToken || String(value.apiToken).startsWith('enc:v1:')) return;
      value.apiToken = require('./settings-crypto').encrypt(value.apiToken);
      db.prepare("UPDATE app_settings SET value=? WHERE key='whatsapp'").run(JSON.stringify(value));
    },
  },
  {
    version: 6,
    name: 'crm_onboarding_and_work_queue',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS account_credentials (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE,
          login TEXT NOT NULL,
          password_encrypted TEXT NOT NULL,
          account_kind TEXT NOT NULL CHECK(account_kind IN ('student','parent')),
          created_by TEXT,
          created_at INTEGER NOT NULL,
          revealed_at INTEGER,
          revoked_at INTEGER,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_credentials_active ON account_credentials(user_id, revoked_at);

        CREATE TABLE IF NOT EXISTS crm_leads (
          id TEXT PRIMARY KEY,
          child_name TEXT NOT NULL,
          parent_name TEXT,
          phone TEXT NOT NULL,
          source TEXT,
          course_interest TEXT,
          status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','trial','decision','won','lost')),
          responsible_manager_id TEXT,
          next_contact_at INTEGER,
          comment TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (responsible_manager_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_leads_status_next ON crm_leads(status, next_contact_at);
        CREATE INDEX IF NOT EXISTS idx_leads_manager ON crm_leads(responsible_manager_id, status);

        CREATE TABLE IF NOT EXISTS crm_tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          due_at INTEGER,
          priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')),
          assigned_to TEXT,
          student_id TEXT,
          lead_id TEXT,
          created_by TEXT,
          created_at INTEGER NOT NULL,
          completed_at INTEGER,
          FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (lead_id) REFERENCES crm_leads(id) ON DELETE CASCADE,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_crm_tasks_queue ON crm_tasks(status, due_at, assigned_to);
      `);
    },
  },
  {
    version: 7,
    name: 'education_operations_and_parent_requests',
    up(db) {
      const attendanceCols = db.prepare('PRAGMA table_info(attendance)').all().map(c => c.name);
      if (!attendanceCols.includes('reason')) db.exec('ALTER TABLE attendance ADD COLUMN reason TEXT');
      if (!attendanceCols.includes('source')) db.exec("ALTER TABLE attendance ADD COLUMN source TEXT NOT NULL DEFAULT 'staff'");
      const subscriptionCols = db.prepare('PRAGMA table_info(subscriptions)').all().map(c => c.name);
      if (!subscriptionCols.includes('amount_paid')) db.exec('ALTER TABLE subscriptions ADD COLUMN amount_paid INTEGER NOT NULL DEFAULT 0');
      if (!subscriptionCols.includes('unit_price')) db.exec('ALTER TABLE subscriptions ADD COLUMN unit_price REAL NOT NULL DEFAULT 0');
      db.exec(`
        CREATE TABLE IF NOT EXISTS absence_notices (
          id TEXT PRIMARY KEY,
          parent_id TEXT NOT NULL,
          student_id TEXT NOT NULL,
          group_id TEXT NOT NULL,
          lesson_at INTEGER NOT NULL,
          reason TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','acknowledged','cancelled')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY(parent_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
          UNIQUE(student_id, group_id, lesson_at)
        );
        CREATE INDEX IF NOT EXISTS idx_absence_notices_lesson ON absence_notices(group_id, lesson_at, status);
        CREATE INDEX IF NOT EXISTS idx_absence_notices_parent ON absence_notices(parent_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS freeze_requests (
          id TEXT PRIMARY KEY,
          parent_id TEXT NOT NULL,
          student_id TEXT NOT NULL,
          starts_at INTEGER NOT NULL,
          ends_at INTEGER NOT NULL,
          reason TEXT NOT NULL,
          lessons_count INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
          reviewed_by TEXT,
          review_comment TEXT,
          reviewed_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY(parent_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(reviewed_by) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_freeze_requests_queue ON freeze_requests(status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_freeze_requests_student_dates ON freeze_requests(student_id, starts_at, ends_at, status);
      `);
    },
  },
  {
    version: 8,
    name: 'group_chats_and_parent_teacher_dialogs',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS group_chat_messages (
          id TEXT PRIMARY KEY,
          group_id TEXT NOT NULL,
          sender_id TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          edited_at INTEGER,
          deleted_at INTEGER,
          FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
          FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_group_chat_messages ON group_chat_messages(group_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS parent_teacher_threads (
          id TEXT PRIMARY KEY,
          parent_id TEXT NOT NULL,
          student_id TEXT NOT NULL,
          teacher_id TEXT NOT NULL,
          subject TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          closed_at INTEGER,
          FOREIGN KEY(parent_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(teacher_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_parent_threads_parent ON parent_teacher_threads(parent_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_parent_threads_teacher ON parent_teacher_threads(teacher_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS parent_teacher_messages (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          sender_id TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          read_at INTEGER,
          FOREIGN KEY(thread_id) REFERENCES parent_teacher_threads(id) ON DELETE CASCADE,
          FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_parent_messages_thread ON parent_teacher_messages(thread_id, created_at);

        CREATE TABLE IF NOT EXISTS chat_read_state (
          user_id TEXT NOT NULL,
          channel_type TEXT NOT NULL CHECK(channel_type IN ('group','parent_thread')),
          channel_id TEXT NOT NULL,
          read_at INTEGER NOT NULL,
          PRIMARY KEY(user_id, channel_type, channel_id),
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
    },
  },
  {
    version: 9,
    name: 'python_curriculum_reset_and_admin_only',
    up(db) {
      // This release intentionally starts a clean pilot: the owner requested
      // removal of every account except administrators and replacement of the
      // legacy Python course. Keep this as an immutable, one-shot migration so
      // a restart can never repeat or broaden the deletion.
      const totalUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
      const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get().n;
      // A brand-new database is migrated before seedAdmin() runs; there is
      // nothing to delete there. Existing databases must retain an admin.
      if (totalUsers && !admins) throw new Error('Очистка пользователей отменена: в базе нет администратора');

      const moduleCols = db.prepare('PRAGMA table_info(modules)').all().map(c => c.name);
      if (!moduleCols.includes('track')) db.exec("ALTER TABLE modules ADD COLUMN track TEXT NOT NULL DEFAULT ''");
      if (!moduleCols.includes('level')) db.exec("ALTER TABLE modules ADD COLUMN level TEXT NOT NULL DEFAULT ''");
      if (!moduleCols.includes('estimated_min')) db.exec('ALTER TABLE modules ADD COLUMN estimated_min INTEGER NOT NULL DEFAULT 60');
      if (!moduleCols.includes('prerequisite_id')) db.exec('ALTER TABLE modules ADD COLUMN prerequisite_id TEXT');

      // Append-only accounting protects normal application traffic. During the
      // explicitly requested full account reset we temporarily remove only its
      // delete guard and restore it before the migration commits.
      db.exec('DROP TRIGGER IF EXISTS subscription_transactions_no_delete');
      db.exec(`
        DELETE FROM subscription_transactions WHERE student_id IN (SELECT id FROM users WHERE role<>'admin');
        DELETE FROM subscription_payments WHERE student_id IN (SELECT id FROM users WHERE role<>'admin');
        DELETE FROM subscription_freezes WHERE subscription_id IN (SELECT id FROM subscriptions WHERE student_id IN (SELECT id FROM users WHERE role<>'admin'));
        DELETE FROM subscriptions WHERE student_id IN (SELECT id FROM users WHERE role<>'admin');
        DELETE FROM crm_tasks;
        DELETE FROM crm_leads;
        DELETE FROM groups;
        UPDATE users SET teacher_id=NULL WHERE role<>'admin';
        DELETE FROM users WHERE role<>'admin';
        DELETE FROM modules WHERE lang='python';
        CREATE TRIGGER IF NOT EXISTS subscription_transactions_no_delete BEFORE DELETE ON subscription_transactions
        BEGIN SELECT RAISE(ABORT, 'subscription transactions are append-only'); END;
      `);
    },
  },
];

function runMigrations(db, migrations = MIGRATIONS) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  const versions = new Set();
  for (const migration of ordered) {
    if (!Number.isInteger(migration.version) || migration.version <= 0 || versions.has(migration.version)) throw new Error('Некорректная версия миграции');
    versions.add(migration.version);
    const hash = checksum(migration);
    const applied = db.prepare('SELECT * FROM schema_migrations WHERE version=?').get(migration.version);
    if (applied) {
      if (applied.name !== migration.name || applied.checksum !== hash) throw new Error(`Миграция ${migration.version} была изменена после применения`);
      continue;
    }
    db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES (?,?,?,?)')
        .run(migration.version, migration.name, hash, Date.now());
    })();
    console.log(`[db] Миграция v${migration.version} применена: ${migration.name}`);
  }
  db.pragma(`user_version = ${ordered.length ? ordered[ordered.length - 1].version : 0}`);
  return db.prepare('SELECT version,name,checksum,applied_at FROM schema_migrations ORDER BY version').all();
}

module.exports = { MIGRATIONS, checksum, runMigrations };
