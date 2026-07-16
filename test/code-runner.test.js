const test = require('node:test');
const assert = require('node:assert/strict');
const { payloadFor, normalizeOutput, gradeCode, consumeRunnerQuota } = require('../server/code-runner');

test('builds fixed runner payloads without accepting an arbitrary language', () => {
  assert.equal(payloadFor('code', 'print(1)').language, 'python');
  assert.equal(payloadFor('java', 'class Main {}').files[0].name, 'Main.java');
  assert.throws(() => payloadFor('shell', 'rm -rf /'), /Неподдерживаемый/);
});

test('normalizes line endings and rejects oversized/empty code', () => {
  assert.equal(normalizeOutput('ok\r\n'), 'ok');
  assert.throws(() => payloadFor('code', ''), /размер/);
  assert.throws(() => payloadFor('code', 'x'.repeat(50_001)), /размер/);
});

test('server compares runner stdout instead of trusting the browser', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ run: { stdout: '42\n', stderr: '' } }) });
  assert.equal((await gradeCode({ type: 'code', expected_output: '42' }, 'print(42)', fakeFetch)).correct, true);
  assert.equal((await gradeCode({ type: 'code', expected_output: '41' }, 'print(42)', fakeFetch)).correct, false);
});

test('code runner quota prevents authenticated resource abuse', () => {
  const now = 1_700_000_000_000;
  for (let i = 0; i < 20; i++) assert.equal(consumeRunnerQuota('quota-user', now).allowed, true);
  assert.equal(consumeRunnerQuota('quota-user', now).allowed, false);
  assert.equal(consumeRunnerQuota('quota-user', now + 10 * 60 * 1000 + 1).allowed, true);
});
