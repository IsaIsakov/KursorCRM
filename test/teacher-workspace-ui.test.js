const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const admin = fs.readFileSync(path.join(root, 'public/admin/index.html'), 'utf8');
const teacher = fs.readFileSync(path.join(root, 'public/pages/teacher.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');

test('teacher workspace has direct work links and a return path', () => {
  assert.match(teacher, /admin\/index\.html#calendar/);
  assert.match(teacher, /admin\/index\.html#sessions/);
  assert.match(teacher, /admin\/index\.html#homework/);
  assert.match(admin, /id="teacherBackLink"[^>]+pages\/teacher\.html/);
  assert.match(admin, /defaultTab = user && user\.role !== 'admin' \? 'calendar'/);
});

test('lesson modal keeps attendance, assessments, reports and guided homework', () => {
  for (const marker of ['att_sel', 'assess_class', 'assess_hw', 'assess_private', 'art_desc']) {
    assert.match(admin, new RegExp(marker));
  }
  assert.match(admin, /lessonHomeworkHtml/);
  assert.match(admin, /renderLessonTaskPicker/);
  assert.match(admin, /tasksForModule/);
  assert.match(css, /\.lesson-student-details\s*\{\s*display:block/);
  assert.doesNotMatch(admin, /toggleAllLessonRows|toggleLessonRow/);
  assert.doesNotMatch(admin, /videoConsent|Согласие на видеосъёмку|Видео: нет согласия/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'server/routes-artifacts.js'), 'utf8'), /video_consent|Нет согласия на видеосъёмку/);
  assert.doesNotMatch(css, /\.lesson-student-main \.assess_class,[^\n]+display:none/);
});

test('staff student cards expose safe avatar editing', () => {
  const usersRoute = fs.readFileSync(path.join(root, 'server/routes-users.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
  const curator = fs.readFileSync(path.join(root, 'public/curator/index.html'), 'utf8');
  assert.match(admin, /changeClientAvatar/);
  assert.match(teacher, /changeTeacherStudentAvatar/);
  assert.match(app, /enhanceCuratorStudentPhoto/);
  assert.match(curator, /student-photo/);
  assert.match(usersRoute, /user\.role === 'curator'/);
  assert.match(usersRoute, /accessibleStudentIds\(db, user\)/);
});

test('standalone homework form uses task choices instead of manual task IDs', () => {
  assert.match(admin, /id="hwf_task_picker"/);
  assert.match(admin, /taskPickerHtml\(tasksForModule\(moduleId\),'hwf-task'\)/);
  assert.doesNotMatch(admin, /id="hwf_tasks"/);
});
