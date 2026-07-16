const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createSubscriptionService } = require('../server/subscriptions');

function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE tariffs(id TEXT PRIMARY KEY, visits_count INTEGER, duration_days INTEGER);
    CREATE TABLE students_crm(user_id TEXT PRIMARY KEY, tariff_id TEXT, subscription_issued_at INTEGER, visits_left INTEGER, status TEXT);
    CREATE TABLE subscriptions(id TEXT PRIMARY KEY, student_id TEXT NOT NULL, tariff_id TEXT, starts_at INTEGER NOT NULL,
      expires_at INTEGER, visits_total INTEGER NOT NULL, status TEXT NOT NULL, created_by TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE subscription_transactions(id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL, student_id TEXT NOT NULL,
      delta INTEGER NOT NULL, balance_after INTEGER NOT NULL CHECK(balance_after>=0), type TEXT NOT NULL,
      reference_type TEXT, reference_id TEXT, actor_id TEXT, note TEXT, created_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX idx_sub_tx_reference ON subscription_transactions(subscription_id,type,reference_type,reference_id) WHERE reference_id IS NOT NULL;
    CREATE TRIGGER subscription_transactions_no_update BEFORE UPDATE ON subscription_transactions BEGIN SELECT RAISE(ABORT, 'append-only'); END;
    CREATE TRIGGER subscription_transactions_no_delete BEFORE DELETE ON subscription_transactions BEGIN SELECT RAISE(ABORT, 'append-only'); END;
    INSERT INTO users VALUES ('student'),('admin');
    INSERT INTO tariffs VALUES ('tariff',8,30);
    INSERT INTO students_crm VALUES ('student',NULL,NULL,0,'active');
  `);
  return { db, service: createSubscriptionService(db) };
}

test('issue and attendance keep ledger and legacy CRM balance consistent', () => {
  const { db, service } = fixture();
  const sub = service.issue({ studentId: 'student', tariffId: 'tariff', startsAt: 1000, actorId: 'admin' });
  assert.equal(service.currentBalance(sub.id), 8);
  assert.equal(db.prepare('SELECT visits_left FROM students_crm').get().visits_left, 8);
  assert.deepEqual(service.applyDelta({ studentId: 'student', delta: -1, type: 'attendance', referenceType: 'lesson', referenceId: 'one' }),
    { applied: true, balance: 7, subscriptionId: sub.id });
  assert.equal(db.prepare('SELECT visits_left FROM students_crm').get().visits_left, 7);
});

test('balance cannot become negative and duplicate references are idempotent', () => {
  const { service } = fixture();
  const sub = service.issue({ studentId: 'student', visitsTotal: 1, actorId: 'admin' });
  assert.equal(service.applyDelta({ studentId: 'student', delta: -1, type: 'attendance', referenceType: 'lesson', referenceId: 'same' }).applied, true);
  assert.equal(service.applyDelta({ studentId: 'student', delta: -1, type: 'attendance', referenceType: 'lesson', referenceId: 'same' }).reason, 'duplicate');
  assert.equal(service.applyDelta({ studentId: 'student', delta: -1, type: 'attendance', referenceType: 'lesson', referenceId: 'other' }).reason, 'insufficient_visits');
  assert.equal(service.currentBalance(sub.id), 0);
});

test('transaction history is append-only', () => {
  const { db, service } = fixture();
  service.issue({ studentId: 'student', visitsTotal: 2, actorId: 'admin' });
  assert.throws(() => db.prepare('UPDATE subscription_transactions SET delta=99').run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM subscription_transactions').run(), /append-only/);
});

test('legacy CRM balance migrates once without changing it', () => {
  const { db, service } = fixture();
  db.prepare('UPDATE students_crm SET visits_left=5, tariff_id=\'tariff\', subscription_issued_at=1000').run();
  const first = service.ensureLegacy('student', 'admin');
  const second = service.ensureLegacy('student', 'admin');
  assert.equal(first.id, second.id);
  assert.equal(service.currentBalance(first.id), 5);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM subscriptions').get().n, 1);
});
