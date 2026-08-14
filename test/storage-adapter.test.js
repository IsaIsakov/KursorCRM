const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

test('local storage remains compatible with existing unprefixed paths', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kursor-storage-'));
  process.env.FILE_STORAGE_DIR = root;
  for (const name of ['BUCKET', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 'REGION', 'ENDPOINT']) delete process.env[name];
  delete require.cache[require.resolve('../server/storage')];
  const storage = require('../server/storage');
  const stored = await storage.saveFile(Buffer.from('lesson report'), 'sessions/student/lesson/report.txt', { contentType: 'text/plain' });
  assert.equal(stored, 'sessions/student/lesson/report.txt');
  assert.equal(fs.readFileSync(storage.resolveFile(stored), 'utf8'), 'lesson report');
  assert.deepEqual(await storage.checkReady(), { mode: 'local' });
  await storage.deleteFile(stored);
  assert.equal(storage.resolveFile(stored), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('bucket object paths are explicit and preserve their logical prefix', () => {
  const storage = require('../server/storage');
  assert.equal(storage.isBucketPath('bucket:sessions/student/video.mp4'), true);
  assert.equal(storage.isManagedPath('bucket:materials/guide.pdf', 'materials/'), true);
  assert.equal(storage.managedRelativePath('bucket:materials/guide.pdf'), 'materials/guide.pdf');
  assert.equal(storage.isBucketPath('sessions/legacy-video.mp4'), false);
});

test('bucket adapter uploads, signs, checks readiness and deletes objects', async () => {
  const requests = [];
  let lastPut = null;
  const server = http.createServer((req, res) => {
    let bytes = 0;
    req.on('data', chunk => { bytes += chunk.length; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, bytes });
      if (req.method === 'PUT') lastPut = { bytes, sha256: req.headers['x-amz-meta-sha256'] };
      res.statusCode = req.method === 'DELETE' ? 204 : 200;
      if (req.method === 'PUT') res.setHeader('ETag', '"test-etag"');
      if (req.method === 'HEAD' && /backup/.test(req.url) && lastPut) {
        res.setHeader('Content-Length', '12');
        res.setHeader('x-amz-meta-sha256', crypto.createHash('sha256').update('backup-bytes').digest('hex'));
      }
      res.end();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  Object.assign(process.env, { BUCKET: 'kursor-test', ACCESS_KEY_ID: 'access', SECRET_ACCESS_KEY: 'secret', REGION: 'auto', ENDPOINT: endpoint });
  delete require.cache[require.resolve('../server/storage')];
  const storage = require('../server/storage');
  try {
    const stored = await storage.saveFile(Buffer.from('bucket-video'), 'sessions/student/lesson/video.mp4', { contentType: 'video/mp4' });
    assert.equal(stored, 'bucket:sessions/student/lesson/video.mp4');
    const signed = await storage.downloadUrl(stored, { fileName: 'lesson.mp4', contentType: 'video/mp4' });
    assert.match(signed, /X-Amz-Signature=/);
    assert.deepEqual(await storage.checkReady(), { mode: 'bucket' });
    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kursor-bucket-copy-'));
    const backup = path.join(backupDir, 'backup.sqlite');
    fs.writeFileSync(backup, 'backup-bytes');
    assert.equal(await storage.copyLocalFile(backup, 'backups/backup.sqlite'), 'bucket:backups/backup.sqlite');
    fs.rmSync(backupDir, { recursive: true, force: true });
    await storage.deleteFile(stored);
    assert.equal(requests.some(r => r.method === 'PUT' && r.bytes === 12), true);
    assert.equal(requests.some(r => r.method === 'HEAD'), true);
    assert.equal(requests.some(r => r.method === 'DELETE'), true);
    assert.equal(requests.some(r => r.method === 'PUT' && /backup/.test(r.url)), true);
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const name of ['BUCKET', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 'REGION', 'ENDPOINT']) delete process.env[name];
  }
});
