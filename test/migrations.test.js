const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../server/migrations');

test('migrations run once in version order', () => {
  const db = new Database(':memory:'); const calls = [];
  const list = [
    { version: 2, name: 'second', up() { calls.push(2); } },
    { version: 1, name: 'first', up() { calls.push(1); } },
  ];
  runMigrations(db, list); runMigrations(db, list);
  assert.deepEqual(calls, [1, 2]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n, 2);
  assert.equal(db.pragma('user_version', { simple: true }), 2);
});

test('failed migration rolls back its schema and history row', () => {
  const db = new Database(':memory:');
  const list = [{ version: 1, name: 'broken', up(database) { database.exec('CREATE TABLE transient(id INTEGER)'); throw new Error('boom'); } }];
  assert.throws(() => runMigrations(db, list), /boom/);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='transient'").get(), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n, 0);
});

test('an applied migration cannot be silently edited', () => {
  const db = new Database(':memory:');
  runMigrations(db, [{ version: 1, name: 'stable', up() {} }]);
  assert.throws(() => runMigrations(db, [{ version: 1, name: 'changed', up() {} }]), /изменена после применения/);
});
