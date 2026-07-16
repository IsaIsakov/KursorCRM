const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('demo seed is impossible in production', () => {
  const result = spawnSync(process.execPath, ['server/seed-test-data.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'production' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /Демонстрационные данные запрещено/);
});
