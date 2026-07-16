const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../server/login-guard');

test.beforeEach(() => guard.reset());

test('locks a source/login pair after five failed passwords', () => {
  const now = 1_700_000_000_000;
  for (let i = 0; i < 4; i++) assert.equal(guard.recordFailure('10.0.0.1', 'admin', now + i).locked, false);
  const fifth = guard.recordFailure('10.0.0.1', 'admin', now + 4);
  assert.equal(fifth.locked, true);
  assert.equal(guard.consume('10.0.0.1', 'admin', now + 5).allowed, false);
  assert.equal(guard.consume('10.0.0.1', 'another-user', now + 5).allowed, true);
});

test('successful authentication clears pair failures', () => {
  const now = 1_700_000_000_000;
  guard.recordFailure('10.0.0.1', 'admin', now);
  guard.recordSuccess('10.0.0.1', 'admin');
  for (let i = 0; i < 4; i++) assert.equal(guard.recordFailure('10.0.0.1', 'admin', now + i + 1).locked, false);
});

test('limits total login traffic from one source', () => {
  const now = 1_700_000_000_000;
  for (let i = 0; i < guard.constants.IP_LIMIT; i++) assert.equal(guard.consume('10.0.0.2', `user-${i}`, now).allowed, true);
  const blocked = guard.consume('10.0.0.2', 'last-user', now);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'ip_rate');
});

test('locks expire and raw identifiers are not returned', () => {
  const now = 1_700_000_000_000;
  let result;
  for (let i = 0; i < 5; i++) result = guard.recordFailure('private-ip', 'private-login', now + i);
  assert.equal(result.eventKey.includes('private'), false);
  assert.equal(guard.consume('private-ip', 'private-login', now + guard.constants.LOCK_MS + 10).allowed, true);
});
