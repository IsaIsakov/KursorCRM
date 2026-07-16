const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectPersistence } = require('../server/persistence-config');
const fs = require('node:fs');
const path = require('node:path');

test('Railway production refuses to start without a persistent volume', () => {
  const result = inspectPersistence({ NODE_ENV: 'production', RAILWAY_PROJECT_ID: 'project',
    DB_PATH: '/data/kursor.sqlite', FILE_STORAGE_DIR: '/data/files', BACKUP_DIR: '/data/backups' });
  assert.match(result.errors.join(' '), /Volume не подключён/);
});

test('Railway production accepts a /data volume and paths', () => {
  const result = inspectPersistence({ NODE_ENV: 'production', RAILWAY_PROJECT_ID: 'project', RAILWAY_VOLUME_MOUNT_PATH: '/data',
    DB_PATH: '/data/kursor.sqlite', FILE_STORAGE_DIR: '/data/files', BACKUP_DIR: '/data/backups' });
  assert.deepEqual(result.errors, []);
});

test('Docker entrypoint repairs mounted volume ownership before dropping root', () => {
  const source = fs.readFileSync(path.join(__dirname,'..','docker-entrypoint.sh'),'utf8');
  assert.match(source,/chown -R node:node/);
  assert.match(source,/exec gosu node/);
  assert.match(source,/test -w/);
});
