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
  assert.match(routes, /router\.get\('\/homework\/:id\/progress'/);
  assert.match(routes, /router\.post\('\/homework\/:id\/submit'/);
  assert.match(routes, /router\.post\('\/homework\/:id\/submission'/);
  assert.match(routes, /submissionMode: z\.enum\(\['platform','upload','both'\]\)/);
  assert.match(routes, /requiresTasks: mode === 'platform' \|\| mode === 'both'/);
  assert.match(routes, /requiresUpload: mode === 'upload' \|\| mode === 'both'/);
  assert.match(routes, /assignments\/:studentId\/file/);
  assert.match(admin, /Оба варианта/);
  assert.match(admin, /selectedHomeworkMode/);
  assert.match(dashboard, /uploadHomeworkSubmission/);
  assert.match(dashboard, /Загрузить ответ/);
  assert.match(admin, /Кто выполнил/);
  assert.match(admin, /openHomeworkProgress/);
  assert.match(dashboard, /hw\.fileUrl/);
  assert.match(dashboard, /submitDashboardHomework/);
  assert.match(fs.readFileSync('public/pages/parent.html', 'utf8'), /Ответ ребёнка:/);
});

test('mobile lesson cards never require horizontal scrolling', () => {
  const css = fs.readFileSync('public/css/style.css', 'utf8');
  assert.match(css, /\.lesson-modal-body\s*\{[^}]*overflow-x:hidden/);
  assert.match(css, /@media \(max-width:900px\)[\s\S]*\.lesson-student-main\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.lesson-student-main \.att_sel\s*\{\s*grid-column:1 \/ -1/);
  assert.match(css, /@media \(max-width:900px\)[\s\S]*\.homework-mode-picker\s*\{\s*grid-template-columns:1fr/);
});

test('common lists are searchable and logout requires confirmation', () => {
  const app = fs.readFileSync('public/js/app.js', 'utf8');
  const admin = fs.readFileSync('public/admin/index.html', 'utf8');
  const teacher = fs.readFileSync('public/pages/teacher.html', 'utf8');
  const curator = fs.readFileSync('public/curator/index.html', 'utf8');
  assert.match(app, /window\.confirm\(message\)/);
  assert.match(app, /function filterTableRows/);
  assert.match(admin, /id="groupsTable"/);
  assert.match(admin, /Поиск группы, филиала или преподавателя/);
  assert.match(teacher, /Поиск ученика или логина/);
  assert.match(curator, /filterCuratorCards/);
});

test('parent panel exposes assigned homework and lesson media', () => {
  const parent = fs.readFileSync('public/pages/parent.html', 'utf8');
  const teacher = fs.readFileSync('public/pages/teacher.html', 'utf8');
  assert.match(parent, /key: 'homework'/);
  assert.match(parent, /API\.getHomework\('student_id='/);
  assert.match(parent, /function buildParentHomework/);
  assert.match(parent, /function artifactBlockHtml/);
  assert.match(parent, /if \(a\.type === 'video'\) return videoBlockHtml/);
  assert.match(parent, /if \(a\.isImage \|\| a\.type === 'screenshot'\) return imageBlockHtml/);
  assert.match(parent, /hw\.assignmentStatus/);
  assert.match(teacher, /API\.getArtifacts\(\)/);
  assert.match(teacher, /Отчёты с занятий/);
});
