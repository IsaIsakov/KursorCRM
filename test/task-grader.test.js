const test = require('node:test');
const assert = require('node:assert/strict');
const { gradeTask } = require('../server/task-grader');

test('quiz accepts only the stored option index', () => {
  const task = { type: 'quiz', answer: '2' };
  assert.equal(gradeTask(task, 2).correct, true);
  assert.equal(gradeTask(task, 1).correct, false);
  assert.equal(gradeTask(task, undefined).correct, false);
});

test('fill ignores surrounding whitespace and letter case', () => {
  const task = { type: 'fill', answer: 'Переменная' };
  assert.equal(gradeTask(task, '  переменная ').correct, true);
  assert.equal(gradeTask(task, 'функция').correct, false);
});

test('order requires every item in the exact order', () => {
  const task = { type: 'order', items: JSON.stringify(['one', 'two', 'three']) };
  assert.equal(gradeTask(task, JSON.stringify(['one', 'two', 'three'])).correct, true);
  assert.equal(gradeTask(task, JSON.stringify(['two', 'one', 'three'])).correct, false);
  assert.equal(gradeTask(task, 'not-json').correct, false);
});

test('open and code tasks are not falsely treated as auto-graded', () => {
  assert.deepEqual(gradeTask({ type: 'project' }, 'work'), { gradable: false, correct: false });
});

test('HTML and Blockly expected fragments are checked server-side', () => {
  assert.equal(gradeTask({ type: 'htmlcss', expected_output: '<h1>Hello</h1>' }, '  <H1>Hello</H1> ').correct, true);
  assert.equal(gradeTask({ type: 'blockly', expected_output: 'repeat(10)' }, 'repeat(5)').correct, false);
});
