const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('child avatars are served only by an authenticated relationship-aware route', () => {
  const root = path.join(__dirname, '..');
  const index = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
  const users = fs.readFileSync(path.join(root, 'server', 'routes-users.js'), 'utf8');
  const migrations = fs.readFileSync(path.join(root, 'server', 'migrations.js'), 'utf8');
  assert.match(index, /app\.use\('\/uploads\/avatars',[\s\S]*status\(404\)/);
  assert.match(users, /router\.use\(authRequired\)/);
  assert.match(users, /router\.get\('\/:id\/avatar-file'/);
  assert.match(users, /canViewAvatar/);
  assert.match(users, /parent_children/);
  assert.match(migrations, /name: 'protect_user_avatars'/);
  assert.doesNotMatch(users, /const avatarUrl = `\/uploads\/avatars/);
});
