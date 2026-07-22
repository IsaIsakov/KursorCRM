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
  assert.match(css, /\.lesson-student-card\.expanded/);
  assert.doesNotMatch(css, /\.lesson-student-main \.assess_class,[^\n]+display:none/);
});

test('standalone homework form uses task choices instead of manual task IDs', () => {
  assert.match(admin, /id="hwf_task_picker"/);
  assert.match(admin, /taskPickerHtml\(tasksForModule\(moduleId\),'hwf-task'\)/);
  assert.doesNotMatch(admin, /id="hwf_tasks"/);
});
