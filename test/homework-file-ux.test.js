const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('lesson homework supports text, links and a protected file', () => {
  const routes = fs.readFileSync('server/routes-sessions.js', 'utf8');
  const admin = fs.readFileSync('public/admin/index.html', 'utf8');
  const dashboard = fs.readFileSync('public/pages/dashboard.html', 'utf8');
  assert.match(routes, /description:\s*optionalText\(5000\)/);
  assert.match(routes, /router\.post\('\/homework\/:id\/file'/);
  assert.match(routes, /router\.get\('\/homework\/:id\/file'/);
  assert.match(routes, /homework_assignments WHERE homework_id=\? AND student_id=\?/);
  assert.match(admin, /PDF или другой файл/);
  assert.match(admin, /uploadHomeworkFile/);
  assert.match(admin, /Сохранить всё занятие/);
  assert.match(admin, /if\(homeworkDraftPresent\(\)\)/);
  assert.match(admin, /Дождитесь окончания загрузки файлов/);
  assert.match(dashboard, /hw\.fileUrl/);
});

test('mobile lesson cards never require horizontal scrolling', () => {
  const css = fs.readFileSync('public/css/style.css', 'utf8');
  assert.match(css, /\.lesson-modal-body\s*\{[^}]*overflow-x:hidden/);
  assert.match(css, /@media \(max-width:900px\)[\s\S]*\.lesson-student-main\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.lesson-student-main \.att_sel\s*\{\s*grid-column:1 \/ -1/);
});

test('parent panel exposes assigned homework and lesson media', () => {
  const parent = fs.readFileSync('public/pages/parent.html', 'utf8');
  assert.match(parent, /key: 'homework'/);
  assert.match(parent, /API\.getHomework\('student_id='/);
  assert.match(parent, /function buildParentHomework/);
  assert.match(parent, /function artifactBlockHtml/);
  assert.match(parent, /if \(a\.type === 'video'\) return videoBlockHtml/);
  assert.match(parent, /if \(a\.isImage \|\| a\.type === 'screenshot'\) return imageBlockHtml/);
});
