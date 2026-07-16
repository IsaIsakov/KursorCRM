const test = require('node:test');
const assert = require('node:assert/strict');
const { activeMemberIds, validateGroupStudents, sessionTimestamp } = require('../server/group-scope');

function fakeDb(rows) {
  return { prepare: () => ({ all: (_group, at) => rows.filter(r => r.since <= at && (!r.until || r.until >= at)).map(r => ({ id: r.id })) }) };
}

test('membership respects since and until at lesson time', () => {
  const db = fakeDb([
    { id: 'active', since: 100, until: null },
    { id: 'ended', since: 10, until: 90 },
    { id: 'future', since: 200, until: null },
  ]);
  assert.deepEqual(activeMemberIds(db, 'g1', 150), ['active']);
});

test('rejects outsiders and duplicate attendance rows before mutation', () => {
  const db = fakeDb([{ id: 's1', since: 0, until: null }, { id: 's2', since: 0, until: null }]);
  assert.deepEqual(validateGroupStudents(db, 'g1', ['s1', 'outsider'], 100).outsiders, ['outsider']);
  const duplicate = validateGroupStudents(db, 'g1', ['s1', 's1'], 100);
  assert.equal(duplicate.valid, false);
  assert.deepEqual(duplicate.duplicates, ['s1']);
});

test('lesson date is converted to a stable timestamp', () => {
  assert.equal(sessionTimestamp('2026-07-15'), Date.parse('2026-07-15T12:00:00Z'));
});
