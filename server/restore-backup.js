const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function verify(file) {
  const source = new Database(file, { readonly: true, fileMustExist: true });
  try {
    if (source.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Backup не прошёл integrity_check');
    source.prepare('SELECT COUNT(*) FROM users').get();
    source.prepare('SELECT COUNT(*) FROM audit_log').get();
  } finally { source.close(); }
}

function restore(sourcePath, targetPath) {
  const source = path.resolve(sourcePath);
  const target = path.resolve(targetPath);
  if (source === target) throw new Error('Источник и целевая БД совпадают');
  verify(source);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.restore-tmp`;
  fs.copyFileSync(source, temp);
  verify(temp);
  for (const suffix of ['-wal', '-shm']) try { fs.unlinkSync(target + suffix); } catch {}
  let previous = null;
  if (fs.existsSync(target)) {
    previous = `${target}.pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.renameSync(target, previous);
  }
  fs.renameSync(temp, target);
  return { target, previous };
}

if (require.main === module) {
  const source = process.argv[2];
  const target = process.env.DB_PATH || path.join(__dirname, 'db', 'kursor.sqlite');
  if (process.env.CONFIRM_RESTORE !== 'YES' || !source) {
    console.error('Остановите сервер и запустите: CONFIRM_RESTORE=YES npm run restore -- /path/to/backup.sqlite');
    process.exit(2);
  }
  try { console.log(restore(source, target)); } catch (error) { console.error(error.message); process.exit(1); }
}

module.exports = { verify, restore };
