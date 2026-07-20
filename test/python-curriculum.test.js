const test = require('node:test');
const assert = require('node:assert/strict');
const lessons = require('../data/python-curriculum');

test('Python curriculum provides two ordered, substantial tracks', () => {
  assert.equal(lessons.length, 16);
  assert.deepEqual([...new Set(lessons.map(x => x.track))], ['Python', 'Python Pro']);
  assert.ok(lessons.reduce((sum, x) => sum + x.tasks.length, 0) >= 100);
  assert.equal(new Set(lessons.map(x => x.moduleId)).size, lessons.length);
  for (const lesson of lessons) {
    assert.ok(lesson.intro.length >= 5, lesson.moduleId);
    assert.ok(lesson.intro[0].video.startsWith('https://www.youtube.com/embed/'), lesson.moduleId);
    assert.ok(lesson.tasks.some(t => t.type === 'code'), lesson.moduleId);
    assert.ok(lesson.miniTask?.answer, lesson.moduleId);
  }
});

test('every module after the first in a track has a prerequisite', () => {
  for (const track of ['Python', 'Python Pro']) {
    const modules = lessons.filter(x => x.track === track);
    assert.equal(modules[0].prerequisiteId, '');
    modules.slice(1).forEach((item, i) => assert.equal(item.prerequisiteId, modules[i].moduleId));
  }
});
