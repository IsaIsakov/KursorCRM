const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const db = require('./db');

const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, 'backups'));
const RETENTION_DAYS = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS) || 14);
let running = false;
let startTimer = null;
let intervalTimer = null;

function stamp(date = new Date()) { return date.toISOString().replace(/[:.]/g, '-'); }
function removeSidecars(file) {
  for (const suffix of ['-wal', '-shm']) try { if (fs.existsSync(file + suffix)) fs.unlinkSync(file + suffix); } catch {}
}

function verifyBackup(file) {
  const check = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const integrity = check.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`integrity_check: ${integrity}`);
    check.prepare('SELECT COUNT(*) AS n FROM users').get();
    check.prepare('SELECT COUNT(*) AS n FROM audit_log').get();
    return true;
  } finally { check.close(); }
}

function enforceRetention(now = Date.now()) {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  const cutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const removed = [];
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    if (!/^kursor-.*\.sqlite$/.test(name)) continue;
    const file = path.join(BACKUP_DIR, name);
    if (fs.statSync(file).mtimeMs < cutoff) { fs.unlinkSync(file); removed.push(name); }
  }
  return removed;
}

async function createBackup(now = new Date()) {
  if (running) return null;
  running = true;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const finalFile = path.join(BACKUP_DIR, `kursor-${stamp(now)}.sqlite`);
  const tempFile = `${finalFile}.tmp`;
  try {
    await db.backup(tempFile);
    verifyBackup(tempFile);
    removeSidecars(tempFile);
    fs.renameSync(tempFile, finalFile);
    enforceRetention(now.getTime());
    console.log(`[backup] Создан и проверен: ${path.basename(finalFile)}`);
    return finalFile;
  } catch (error) {
    try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch {}
    removeSidecars(tempFile);
    throw error;
  } finally { running = false; }
}

function startScheduler() {
  if (startTimer || intervalTimer) return;
  const run = () => createBackup().catch(error => console.error('[backup] Ошибка:', error.message));
  startTimer = setTimeout(run, 60_000); startTimer.unref();
  intervalTimer = setInterval(run, 24 * 60 * 60 * 1000); intervalTimer.unref();
  console.log(`[backup] Планировщик запущен, хранение ${RETENTION_DAYS} дней.`);
}
function stopScheduler() {
  if (startTimer) clearTimeout(startTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  startTimer = null; intervalTimer = null;
}

if (require.main === module) createBackup().then(file => { console.log(file); db.close(); }).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { createBackup, verifyBackup, enforceRetention, startScheduler, stopScheduler, BACKUP_DIR };
