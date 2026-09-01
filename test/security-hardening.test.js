const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { contentSecurityPolicy, safeRequestPath } = require('../server/http-security');
const { validatePrefix } = require('../server/file-security');
const { toCsv, genId } = require('../server/util');
const backupCrypto = require('../server/backup-crypto');

test('security policy blocks framing, objects and foreign scripts', () => {
  const policy = contentSecurityPolicy({ NODE_ENV: 'production' });
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /base-uri 'none'/);
  assert.match(policy, /upgrade-insecure-requests/);
  assert.doesNotMatch(policy, /https:\/\/\*/);
});

test('secret webhook path is redacted before access and audit logging', () => {
  assert.equal(safeRequestPath('/api/sipuni/events/super-secret-token?event=2'), '/api/sipuni/events/:secret');
});

test('file validation rejects a renamed executable and accepts matching PNG bytes', () => {
  const fake = validatePrefix(Buffer.from('MZ executable'), { fileName: 'photo.png', mime: 'image/png', kind: 'screenshot' });
  assert.equal(fake.ok, false);
  const png = validatePrefix(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), { fileName: 'photo.png', mime: 'image/png', kind: 'screenshot' });
  assert.equal(png.ok, true);
});

test('CSV export neutralizes spreadsheet formulas and IDs use cryptographic randomness', () => {
  const csv = toCsv([{ name: '=HYPERLINK("https://evil")' }], ['name']);
  assert.match(csv, /'=HYPERLINK/);
  const ids = new Set(Array.from({ length: 1000 }, () => genId('t')));
  assert.equal(ids.size, 1000);
});

test('offsite backup encryption authenticates and restores bytes', async () => {
  const previous = process.env.BACKUP_ENCRYPTION_KEY;
  process.env.BACKUP_ENCRYPTION_KEY = 'backup-test-key-that-is-longer-than-thirty-two-characters';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kursor-backup-crypto-'));
  const source = path.join(dir, 'source.sqlite');
  const encrypted = path.join(dir, 'source.sqlite.enc');
  const restored = path.join(dir, 'restored.sqlite');
  try {
    fs.writeFileSync(source, Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(8192, 7)]));
    await backupCrypto.encryptFile(source, encrypted);
    assert.equal(backupCrypto.isEncrypted(encrypted), true);
    assert.notDeepEqual(fs.readFileSync(encrypted).subarray(0, 16), fs.readFileSync(source).subarray(0, 16));
    await backupCrypto.decryptFile(encrypted, restored);
    assert.deepEqual(fs.readFileSync(restored), fs.readFileSync(source));
  } finally {
    previous === undefined ? delete process.env.BACKUP_ENCRYPTION_KEY : process.env.BACKUP_ENCRYPTION_KEY = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
