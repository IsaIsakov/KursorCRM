/* Private storage for lesson files. Files are deliberately kept outside
   public/ and are exposed only through short-lived signed capability URLs. */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PRIVATE_ROOT = path.resolve(process.env.FILE_STORAGE_DIR || path.join(__dirname, 'private-uploads'));
const LEGACY_ROOT = path.resolve(path.join(__dirname, '..', 'public', 'uploads'));
const URL_TTL_MS = Number(process.env.ARTIFACT_URL_TTL_MS) || 10 * 60 * 1000;
const SIGNING_SECRET = process.env.ARTIFACT_URL_SECRET || 'kursor-local-artifact-secret-not-for-production';
fs.mkdirSync(PRIVATE_ROOT, { recursive: true });

function safePath(root, relativePath) {
  const rel = String(relativePath || '').replace(/^[/\\]+/, '');
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('Недопустимый путь');
  return full;
}

function privatePath(relativePath) { return safePath(PRIVATE_ROOT, relativePath); }

function legacyPath(relativePath) {
  const clean = String(relativePath || '').replace(/^uploads[/\\]/, '');
  return safePath(LEGACY_ROOT, clean);
}

// Existing installations stored files under public/uploads. Move them on first
// access so an update does not break historic reports.
function resolveFile(relativePath) {
  const current = privatePath(relativePath);
  if (fs.existsSync(current)) return current;
  const old = legacyPath(relativePath);
  if (!fs.existsSync(old)) return null;
  fs.mkdirSync(path.dirname(current), { recursive: true });
  fs.renameSync(old, current);
  return current;
}

function saveFile(buffer, relativePath) {
  const full = privatePath(relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer, { mode: 0o600 });
  return relativePath;
}

function importFile(tempPath, relativePath) {
  const full = privatePath(relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  try { fs.renameSync(tempPath, full); }
  catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.copyFileSync(tempPath, full); fs.unlinkSync(tempPath);
  }
  fs.chmodSync(full, 0o600);
  return relativePath;
}

function deleteFile(relativePath) {
  if (!relativePath) return;
  for (const getter of [privatePath, legacyPath]) {
    try {
      const full = getter(relativePath);
      if (fs.existsSync(full)) fs.unlinkSync(full);
    } catch {}
  }
}

function signature(artifactId, expires) {
  return crypto.createHmac('sha256', SIGNING_SECRET)
    .update(`${artifactId}.${expires}`)
    .digest('base64url');
}

function getUrl(artifactId, now = Date.now()) {
  const expires = now + URL_TTL_MS;
  return `/api/session-artifacts/${encodeURIComponent(artifactId)}/content?expires=${expires}&signature=${signature(artifactId, expires)}`;
}

function verifyUrl(artifactId, expires, supplied, now = Date.now()) {
  const expiry = Number(expires);
  if (!Number.isSafeInteger(expiry) || expiry < now || expiry > now + URL_TTL_MS + 60_000) return false;
  const expected = signature(artifactId, expiry);
  const a = Buffer.from(String(supplied || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { saveFile, importFile, deleteFile, resolveFile, getUrl, verifyUrl, PRIVATE_ROOT };
