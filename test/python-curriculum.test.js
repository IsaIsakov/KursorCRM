const test = require('node:test');
const assert = require('node:assert/strict');
const lessons = require('../data/python-curriculum');

test('Python curriculum provides two ordered, substantial tracks', () => {
  assert.equal(lessons.length, 16);
  assert.deepEqual([...new Set(lessons.map(x => x.track))], ['Python', 'Python Pro']);
  assert.equal(lessons.reduce((sum, x) => sum + x.tasks.length, 0), 240);
  assert.equal(new Set(lessons.map(x => x.moduleId)).size, lessons.length);
  for (const lesson of lessons) {
    assert.ok(lesson.intro.length >= 5, lesson.moduleId);
    assert.ok(lesson.intro[0].video.startsWith('https://www.youtube.com/embed/'), lesson.moduleId);
    assert.equal(lesson.tasks.length, 15, lesson.moduleId);
    assert.ok(lesson.tasks.filter(t => t.type === 'code').length >= 5, lesson.moduleId);
    assert.ok(lesson.tasks.filter(t => t.type === 'quiz').length >= 5, lesson.moduleId);
    assert.equal(new Set(lesson.tasks.map(t => t.title)).size, 15, lesson.moduleId);
    const independent = lesson.tasks.at(-1);
    assert.equal(independent.type, 'code', lesson.moduleId);
    assert.match(independent.title, /^Сам пишу код:/, lesson.moduleId);
    assert.ok(independent.expectedOutput, lesson.moduleId);
    assert.ok(independent.starter.length < 600, lesson.moduleId);
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
