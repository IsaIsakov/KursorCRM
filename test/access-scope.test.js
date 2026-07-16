const test = require('node:test');
const assert = require('node:assert/strict');
const { accessibleStudentIds, canAccessStudent } = require('../server/access-scope');

function fakeDb() {
  const students = ['s1', 's2', 's3'];
  const staff = { teacher1: ['s1'], assistant1: ['s2'] };
  const parents = { parent1: ['s3'] };
  return {
    prepare(sql) {
      return {
        all(...args) {
          if (sql.includes("role='student'") && !sql.includes('teacher_id')) return students.map(id => ({ id }));
          if (sql.includes('group_members')) return (staff[args[0]] || []).map(id => ({ id }));
          if (sql.includes('teacher_id=?')) return [];
          if (sql.includes('parent_children')) return (parents[args[0]] || []).map(id => ({ id }));
          throw new Error(`Unexpected query: ${sql}`);
        },
      };
    },
  };
}

test('admin and student scopes are explicit', () => {
  const db = fakeDb();
  assert.deepEqual(accessibleStudentIds(db, { id: 'a1', role: 'admin' }), ['s1', 's2', 's3']);
  assert.deepEqual(accessibleStudentIds(db, { id: 's2', role: 'student' }), ['s2']);
});

test('teacher and assistant see only assigned group students', () => {
  const db = fakeDb();
  assert.deepEqual(accessibleStudentIds(db, { id: 'teacher1', role: 'teacher' }), ['s1']);
  assert.deepEqual(accessibleStudentIds(db, { id: 'assistant1', role: 'assistant' }), ['s2']);
  assert.equal(canAccessStudent(db, { id: 'teacher1', role: 'teacher' }, 's2'), false);
});

test('parent sees only linked children', () => {
  const db = fakeDb();
  assert.deepEqual(accessibleStudentIds(db, { id: 'parent1', role: 'parent' }), ['s3']);
  assert.equal(canAccessStudent(db, { id: 'parent1', role: 'parent' }, 's1'), false);
});
