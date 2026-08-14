/* Private file storage: local Volume for legacy files, Railway Bucket for new files. */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand, HeadObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const PRIVATE_ROOT = path.resolve(process.env.FILE_STORAGE_DIR || path.join(__dirname, 'private-uploads'));
const LEGACY_ROOT = path.resolve(path.join(__dirname, '..', 'public', 'uploads'));
const URL_TTL_MS = Number(process.env.ARTIFACT_URL_TTL_MS) || 10 * 60 * 1000;
const SIGNING_SECRET = process.env.ARTIFACT_URL_SECRET || 'kursor-local-artifact-secret-not-for-production';
const BUCKET_PREFIX = 'bucket:';
const bucketNames = ['BUCKET', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 'REGION', 'ENDPOINT'];
const bucketValues = bucketNames.map(name => String(process.env[name] || '').trim());
const BUCKET_ENABLED = bucketValues.every(Boolean);
const BUCKET_PARTIAL = bucketValues.some(Boolean) && !BUCKET_ENABLED;
fs.mkdirSync(PRIVATE_ROOT, { recursive: true });

let s3 = null;
function bucketClient() {
  if (!BUCKET_ENABLED) return null;
  if (!s3) s3 = new S3Client({
    region: process.env.REGION, endpoint: process.env.ENDPOINT,
    forcePathStyle: process.env.BUCKET_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId: process.env.ACCESS_KEY_ID, secretAccessKey: process.env.SECRET_ACCESS_KEY },
  });
  return s3;
}
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
function isBucketPath(value) { return String(value || '').startsWith(BUCKET_PREFIX); }
function asBucketPath(key) { return BUCKET_PREFIX + key; }
function bucketKey(value) {
  const key = String(value || '').slice(BUCKET_PREFIX.length).replace(/^\/+/, '');
  if (!key || key.includes('..') || key.includes('\\')) throw new Error('Недопустимый ключ файла');
  return key;
}
function managedRelativePath(value) { return isBucketPath(value) ? bucketKey(value) : String(value || ''); }
function isManagedPath(value, prefix) { return managedRelativePath(value).startsWith(prefix); }

// Old releases used public/uploads. Move a legacy file into private storage on first access.
function resolveFile(relativePath) {
  if (isBucketPath(relativePath)) return null;
  const current = privatePath(relativePath);
  if (fs.existsSync(current)) return current;
  const old = legacyPath(relativePath);
  if (!fs.existsSync(old)) return null;
  fs.mkdirSync(path.dirname(current), { recursive: true });
  fs.renameSync(old, current);
  return current;
}

async function saveFile(buffer, relativePath, options = {}) {
  if (BUCKET_ENABLED) {
    await bucketClient().send(new PutObjectCommand({ Bucket: process.env.BUCKET, Key: relativePath, Body: buffer,
      ContentType: options.contentType || 'application/octet-stream' }));
    return BUCKET_PREFIX + relativePath;
  }
  const full = privatePath(relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer, { mode: 0o600 });
  return relativePath;
}

async function importFile(tempPath, relativePath, options = {}) {
  if (BUCKET_ENABLED) {
    try {
      await bucketClient().send(new PutObjectCommand({ Bucket: process.env.BUCKET, Key: relativePath,
        Body: fs.createReadStream(tempPath), ContentLength: options.size,
        ContentType: options.contentType || 'application/octet-stream' }));
      return BUCKET_PREFIX + relativePath;
    } finally { try { fs.unlinkSync(tempPath); } catch {} }
  }
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

async function deleteFile(relativePath) {
  if (!relativePath) return;
  if (isBucketPath(relativePath)) {
    await bucketClient().send(new DeleteObjectCommand({ Bucket: process.env.BUCKET, Key: bucketKey(relativePath) }));
    return;
  }
  for (const getter of [privatePath, legacyPath]) {
    try { const full = getter(relativePath); if (fs.existsSync(full)) fs.unlinkSync(full); } catch {}
  }
}

async function downloadUrl(relativePath, { fileName, contentType, expiresIn = 600 } = {}) {
  if (!isBucketPath(relativePath)) return null;
  const command = new GetObjectCommand({ Bucket: process.env.BUCKET, Key: bucketKey(relativePath),
    ResponseContentType: contentType || undefined,
    ResponseContentDisposition: fileName ? `inline; filename*=UTF-8''${encodeURIComponent(fileName)}` : undefined });
  return getSignedUrl(bucketClient(), command, { expiresIn: Math.max(60, Math.min(3600, expiresIn)) });
}

async function uploadUrl(relativePath, { contentType, expiresIn = 900 } = {}) {
  if (!BUCKET_ENABLED) return null;
  const command = new PutObjectCommand({ Bucket: process.env.BUCKET, Key: relativePath,
    ContentType: contentType || 'application/octet-stream' });
  return getSignedUrl(bucketClient(), command, { expiresIn: Math.max(60, Math.min(1800, expiresIn)) });
}

async function headFile(relativePath) {
  if (!isBucketPath(relativePath)) return null;
  const result = await bucketClient().send(new HeadObjectCommand({ Bucket: process.env.BUCKET, Key: bucketKey(relativePath) }));
  return { size: Number(result.ContentLength || 0), contentType: result.ContentType || null };
}

async function copyLocalFile(localPath, relativePath, options = {}) {
  if (!BUCKET_ENABLED) return null;
  const size = fs.statSync(localPath).size;
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => fs.createReadStream(localPath).on('data', chunk => hash.update(chunk)).on('end', resolve).on('error', reject));
  const sha256 = hash.digest('hex');
  await bucketClient().send(new PutObjectCommand({ Bucket: process.env.BUCKET, Key: relativePath,
    Body: fs.createReadStream(localPath), ContentLength: size,
    ContentType: options.contentType || 'application/octet-stream', Metadata: { sha256 } }));
  const checked = await bucketClient().send(new HeadObjectCommand({ Bucket: process.env.BUCKET, Key: relativePath }));
  if (Number(checked.ContentLength || 0) !== size || checked.Metadata?.sha256 !== sha256) {
    throw new Error('Проверка внешней копии файла не пройдена');
  }
  return asBucketPath(relativePath);
}

async function pruneBucket(prefix, olderThanMs) {
  if (!BUCKET_ENABLED) return [];
  const removed = [];
  let continuationToken;
  do {
    const page = await bucketClient().send(new ListObjectsV2Command({ Bucket: process.env.BUCKET, Prefix: prefix, ContinuationToken: continuationToken }));
    for (const object of page.Contents || []) {
      if (object.Key && object.LastModified && object.LastModified.getTime() < olderThanMs) {
        await bucketClient().send(new DeleteObjectCommand({ Bucket: process.env.BUCKET, Key: object.Key }));
        removed.push(object.Key);
      }
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return removed;
}

async function sendStoredFile(res, relativePath, options = {}) {
  if (isBucketPath(relativePath)) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.redirect(302, await downloadUrl(relativePath, options));
    return true;
  }
  const full = resolveFile(relativePath);
  if (!full) return false;
  if (options.contentType) res.setHeader('Content-Type', options.contentType);
  if (options.fileName) res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(options.fileName)}`);
  res.setHeader('Cache-Control', options.cacheControl || 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(full);
  return true;
}

async function checkReady() {
  if (BUCKET_PARTIAL) throw new Error(`Railway Bucket настроен частично: нужны ${bucketNames.join(', ')}`);
  if (BUCKET_ENABLED) {
    await bucketClient().send(new HeadBucketCommand({ Bucket: process.env.BUCKET }));
    return { mode: 'bucket' };
  }
  fs.accessSync(PRIVATE_ROOT, fs.constants.R_OK | fs.constants.W_OK);
  return { mode: 'local' };
}

function signature(artifactId, expires) {
  return crypto.createHmac('sha256', SIGNING_SECRET).update(`${artifactId}.${expires}`).digest('base64url');
}
function getUrl(artifactId, now = Date.now()) {
  const expires = now + URL_TTL_MS;
  return `/api/session-artifacts/${encodeURIComponent(artifactId)}/content?expires=${expires}&signature=${signature(artifactId, expires)}`;
}
function verifyUrl(artifactId, expires, supplied, now = Date.now()) {
  const expiry = Number(expires);
  if (!Number.isSafeInteger(expiry) || expiry < now || expiry > now + URL_TTL_MS + 60_000) return false;
  const expected = signature(artifactId, expiry);
  const a = Buffer.from(String(supplied || '')); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { saveFile, importFile, deleteFile, resolveFile, sendStoredFile, downloadUrl, uploadUrl, headFile, copyLocalFile, pruneBucket, checkReady,
  getUrl, verifyUrl, isBucketPath, asBucketPath, isManagedPath, managedRelativePath, PRIVATE_ROOT, BUCKET_ENABLED, BUCKET_PARTIAL };
