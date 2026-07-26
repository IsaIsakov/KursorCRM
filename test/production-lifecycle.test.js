const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('password recovery is generic and does not expose admin recovery UI', () => {
  const login = read('public/index.html');
  const auth = read('server/routes-auth.js');
  assert.match(login, /Забыли пароль/);
  assert.doesNotMatch(login, /recoveryCode|ADMIN_RECOVERY_CODE|Код восстановления/);
  assert.match(auth, /password-reset\/request/);
  assert.match(auth, /Ответ всегда одинаковый/);
});

test('a group has only one lesson per calendar day and conducted status is explicit', () => {
  const migrations = read('server/migrations.js');
  const sessions = read('server/routes-sessions.js');
  assert.match(migrations, /UNIQUE INDEX IF NOT EXISTS idx_lesson_unique_day/);
  assert.match(sessions, /status='conducted'/);
  assert.match(sessions, /status:'draft'/);
  assert.match(sessions, /existing:true/);
});

test('assistant is a teacher assignment, not a creatable account role', () => {
  const users = read('server/routes-users.js');
  const admin = read('public/admin/index.html');
  assert.match(users, /const ROLES = \['admin', 'teacher', 'curator', 'student', 'parent'\]/);
  assert.doesNotMatch(admin, /<option value="assistant"/);
  assert.match(admin, /ассистент только в этой группе/);
});

test('admin and curator can manage staff and roster for one lesson', () => {
  const sessions = read('server/routes-sessions.js');
  const curator = read('public/curator/index.html');
  assert.match(sessions, /lesson-sessions\/:id\/manage/);
  assert.match(sessions, /lesson_session_members/);
  assert.match(curator, /manageCuratorLesson/);
  assert.match(curator, /Второй преподаватель \(ассистент только на этом уроке\)/);
});

test('overdue lessons are checked in Kazakhstan time and notify staff in background', () => {
  const cleanup = read('server/cleanup.js');
  assert.match(cleanup, /APP_TIMEZONE_OFFSET_MINUTES\|\|300/);
  assert.match(cleanup, /generateUnmarkedLessonNotifications/);
  assert.match(cleanup, /5\*60\*1000/);
});
