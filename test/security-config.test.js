const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectSecurityConfig, assertSecurityConfig, isAcceptablePassword } = require('../server/security-config');

const strong = 'a'.repeat(64);
const other = 'b'.repeat(64);
const settings = 'c'.repeat(64);
const origin = { APP_ORIGIN: 'https://crm.example.kz' };

test('production accepts three independent strong secrets', () => {
  const result = inspectSecurityConfig({ NODE_ENV: 'production', JWT_SECRET: strong, ARTIFACT_URL_SECRET: other, SETTINGS_ENCRYPTION_KEY: settings, ...origin });
  assert.deepEqual(result.errors, []);
});

test('production rejects missing and weak secrets', () => {
  const result = inspectSecurityConfig({ NODE_ENV: 'production', JWT_SECRET: 'change-me', ...origin });
  assert.equal(result.errors.length, 3);
  assert.throws(() => assertSecurityConfig({ NODE_ENV: 'production' }, { warn() {} }), /Небезопасная production-конфигурация/);
});

test('long placeholder text is not mistaken for a strong secret', () => {
  assert.equal(inspectSecurityConfig({
    NODE_ENV: 'production',
    JWT_SECRET: 'replace-with-a-random-secret-at-least-32-characters',
    ARTIFACT_URL_SECRET: other,
    SETTINGS_ENCRYPTION_KEY: settings,
    ...origin,
  }).errors.length, 1);
});

test('production rejects reusing secrets', () => {
  const result = inspectSecurityConfig({ NODE_ENV: 'production', JWT_SECRET: strong, ARTIFACT_URL_SECRET: strong, SETTINGS_ENCRYPTION_KEY: strong, ...origin });
  assert.equal(result.errors.some(e => e.includes('должны быть разными')), true);
});

test('development warns instead of blocking startup', () => {
  const result = inspectSecurityConfig({ NODE_ENV: 'development' });
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 3);
});

test('temporary and replacement passwords require at least 10 characters', () => {
  assert.equal(isAcceptablePassword('123456789'), false);
  assert.equal(isAcceptablePassword('1234567890'), true);
  assert.equal(isAcceptablePassword(null), false);
});
