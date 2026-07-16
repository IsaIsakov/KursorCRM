const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('change-password page verifies the HttpOnly session without reading a token', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'change-password.html'), 'utf8');

  assert.doesNotMatch(source, /API\.getToken\s*\(/);
  assert.match(source, /await API\.refreshCurrentUser\s*\(\)/);
  assert.match(source, /<form id="changeForm" hidden>/);
});
