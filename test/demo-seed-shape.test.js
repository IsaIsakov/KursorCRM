const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

test('demo seed creates exactly three groups with ten linked students each', { timeout: 30000 }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kursor-seed-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const dbPath = path.join(root, 'demo.sqlite');
  const run = spawnSync(process.execPath, ['server/seed-test-data.js'], {
    cwd: path.join(__dirname, '..'), encoding:'utf8',
    env: { ...process.env, NODE_ENV:'development', DB_PATH:dbPath, FILE_STORAGE_DIR:path.join(root,'files'), BACKUP_DIR:path.join(root,'backups') },
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const db = new Database(dbPath, { readonly:true });
  t.after(() => db.close());
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE role='student'").get().n, 30);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE role='parent'").get().n, 30);
  const groups = db.prepare(`SELECT g.id,COUNT(gm.student_id) members FROM groups g
    LEFT JOIN group_members gm ON gm.group_id=g.id AND gm.until IS NULL GROUP BY g.id ORDER BY g.id`).all();
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map(g => g.members), [10,10,10]);
});
