const test = require('node:test');
const assert = require('node:assert/strict');
const { sourceHash } = require('../server/audit-utils');

test('audit source identifiers are deterministic and do not expose raw IP', () => {
  const value = sourceHash('192.0.2.1');
  assert.equal(value, sourceHash('192.0.2.1'));
  assert.equal(value.includes('192.0.2.1'), false);
  assert.equal(value.length, 24);
});
