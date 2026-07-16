const path = require('path');

function inspectPersistence(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const root = path.resolve(env.PERSISTENT_DATA_DIR || '/data');
  const paths = {
    database: path.resolve(env.DB_PATH || path.join(root, 'kursor.sqlite')),
    files: path.resolve(env.FILE_STORAGE_DIR || path.join(root, 'files')),
    backups: path.resolve(env.BACKUP_DIR || path.join(root, 'backups')),
  };
  const insideRoot = value => value === root || value.startsWith(root + path.sep);
  const errors = [];
  if (production && Object.entries(paths).some(([, value]) => !insideRoot(value))) {
    errors.push(`DB_PATH, FILE_STORAGE_DIR и BACKUP_DIR должны находиться внутри ${root}`);
  }
  // Railway's container filesystem is ephemeral. Refuse a production start
  // when the service is clearly on Railway but no Volume is attached.
  const onRailway = !!(env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID);
  if (production && onRailway && env.REQUIRE_PERSISTENT_STORAGE !== 'false' && !env.RAILWAY_VOLUME_MOUNT_PATH) {
    errors.push(`Railway Volume не подключён. Создайте Volume с Mount Path ${root}; иначе аккаунты исчезнут после деплоя`);
  }
  if (production && env.RAILWAY_VOLUME_MOUNT_PATH && path.resolve(env.RAILWAY_VOLUME_MOUNT_PATH) !== root) {
    errors.push(`Railway Volume смонтирован в ${env.RAILWAY_VOLUME_MOUNT_PATH}, ожидается ${root}`);
  }
  return { root, paths, onRailway, errors };
}

function assertPersistenceConfig(env = process.env) {
  const result = inspectPersistence(env);
  if (result.errors.length) throw new Error(`Небезопасная конфигурация хранения:\n- ${result.errors.join('\n- ')}`);
  return result;
}

module.exports = { inspectPersistence, assertPersistenceConfig };
