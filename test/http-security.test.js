const test = require('node:test');
const assert = require('node:assert/strict');
const { originAllowed, configuredOrigins } = require('../server/http-security');

test('production validates supplied browser origins and permits server-side requests', () => {
  const env = { NODE_ENV: 'production', APP_ORIGIN: 'https://crm.example.kz,https://school.example.kz' };
  assert.deepEqual(configuredOrigins(env), ['https://crm.example.kz', 'https://school.example.kz']);
  assert.equal(originAllowed('https://crm.example.kz', env), true);
  assert.equal(originAllowed('https://evil.example', env), false);
  assert.equal(originAllowed(undefined, env), true);
});

test('development permits local tools without CORS configuration', () => {
  assert.equal(originAllowed(undefined, { NODE_ENV: 'development' }), true);
});
