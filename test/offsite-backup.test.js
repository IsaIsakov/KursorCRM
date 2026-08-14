const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('verified SQLite backups are copied to Bucket and retained independently', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'backup.js'), 'utf8');
  assert.match(source, /verifyBackup\(tempFile\)/);
  assert.match(source, /storage\.copyLocalFile\(finalFile/);
  assert.match(source, /storage\.pruneBucket\('backups\/'/);
  assert.match(source, /REQUIRE_OFFSITE_BACKUP/);
});
