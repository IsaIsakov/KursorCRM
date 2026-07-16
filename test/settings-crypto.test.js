const test = require('node:test');
const assert = require('node:assert/strict');

test('integration secrets are authenticated and encrypted at rest', () => {
  const previous = process.env.SETTINGS_ENCRYPTION_KEY;
  process.env.SETTINGS_ENCRYPTION_KEY = 'c'.repeat(64);
  delete require.cache[require.resolve('../server/settings-crypto')];
  const { encrypt, decrypt, PREFIX } = require('../server/settings-crypto');
  try {
    const stored = encrypt('green-api-token');
    assert.match(stored, new RegExp(`^${PREFIX}`));
    assert.doesNotMatch(stored, /green-api-token/);
    assert.equal(decrypt(stored), 'green-api-token');
    const encoded = stored.slice(PREFIX.length);
    const packed = Buffer.from(encoded, 'base64url');
    packed[packed.length - 1] ^= 1;
    const damaged = PREFIX + packed.toString('base64url');
    assert.throws(() => decrypt(damaged));
  } finally {
    previous === undefined ? delete process.env.SETTINGS_ENCRYPTION_KEY : process.env.SETTINGS_ENCRYPTION_KEY = previous;
    delete require.cache[require.resolve('../server/settings-crypto')];
  }
});
