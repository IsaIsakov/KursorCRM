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
