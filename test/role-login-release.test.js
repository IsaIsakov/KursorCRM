const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rolePages = [
  'public/index.html',
  'public/change-password.html',
  'public/pages/dashboard.html',
  'public/pages/parent.html',
  'public/pages/teacher.html',
  'public/pages/chats.html',
  'public/curator/index.html',
  'public/admin/index.html',
];

test('all role panels load the same current auth client release', () => {
  for (const file of rolePages) {
    const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    assert.match(source, /\/js\/api\.js\?v=19/, `${file} must use current auth client`);
    assert.doesNotMatch(source, /\?v=(16|17)/, `${file} contains a stale release asset`);
  }
});

test('HTML is never stored while executable assets must revalidate', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'server/index.js'), 'utf8');
  assert.match(source, /no-store, max-age=0/);
  assert.match(source, /no-cache, max-age=0, must-revalidate/);
});
