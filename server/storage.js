/* ============================================================
   KURSOR — Единая точка хранения файлов работ/видеоотчётов.
   На старте — локальная ФС (public/uploads/sessions/...).
   Позже реализацию можно заменить на S3 без изменения роутов:
   достаточно переписать saveFile/deleteFile/getUrl.
   ============================================================ */
const path = require('path');
const fs = require('fs');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SESSIONS_ROOT = path.join(PUBLIC_DIR, 'uploads', 'sessions');
if (!fs.existsSync(SESSIONS_ROOT)) fs.mkdirSync(SESSIONS_ROOT, { recursive: true });

// relativePath — всегда вида "sessions/<student>/<session>/<file>"
function abs(relativePath) {
  const safe = String(relativePath).replace(/\.\.+/g, '').replace(/^\/+/, '');
  const full = path.join(PUBLIC_DIR, 'uploads', safe.replace(/^uploads\//, ''));
  if (!full.startsWith(path.join(PUBLIC_DIR, 'uploads'))) throw new Error('Недопустимый путь');
  return full;
}

function saveFile(buffer, relativePath) {
  const full = abs(relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer);
  return getUrl(relativePath);
}

function deleteFile(relativePath) {
  if (!relativePath) return;
  try {
    const full = abs(relativePath);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  } catch (e) { /* молча — файл мог быть уже удалён */ }
}

function getUrl(relativePath) {
  const clean = String(relativePath).replace(/^\/+/, '');
  return '/uploads/' + clean.replace(/^uploads\//, '');
}

module.exports = { saveFile, deleteFile, getUrl, SESSIONS_ROOT };
