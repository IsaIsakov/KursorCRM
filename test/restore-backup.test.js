const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { restore } = require('../server/restore-backup');

test('verified backup can be restored atomically', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kursor-restore-'));
  const source = path.join(dir, 'backup.sqlite');
  const target = path.join(dir, 'restored.sqlite');
  const db = new Database(source);
  db.exec('CREATE TABLE users(id TEXT); CREATE TABLE audit_log(id TEXT); INSERT INTO users VALUES (\'u1\')');
  db.close();
  const result = restore(source, target);
  assert.equal(result.target, target);
  const restored = new Database(target, { readonly: true });
  assert.equal(restored.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
  restored.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
