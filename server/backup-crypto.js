const crypto = require('crypto');
const fs = require('fs');
const { pipeline } = require('stream/promises');

const MAGIC = Buffer.from('KURSORBK1');

function key() {
  const secret = String(process.env.BACKUP_ENCRYPTION_KEY || '');
  if (secret.length < 32) throw new Error('BACKUP_ENCRYPTION_KEY должен содержать не менее 32 символов');
  return crypto.createHash('sha256').update(secret).digest();
}

async function encryptFile(source, destination) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const output = fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  output.write(MAGIC); output.write(iv);
  await pipeline(fs.createReadStream(source), cipher, output, { end: false });
  await new Promise((resolve, reject) => {
    output.once('error', reject); output.end(cipher.getAuthTag(), resolve);
  });
  return destination;
}

async function decryptFile(source, destination) {
  const stat = fs.statSync(source);
  if (stat.size <= MAGIC.length + 12 + 16) throw new Error('Зашифрованная резервная копия повреждена');
  const fd = fs.openSync(source, 'r');
  const header = Buffer.alloc(MAGIC.length + 12);
  const tag = Buffer.alloc(16);
  try {
    fs.readSync(fd, header, 0, header.length, 0);
    fs.readSync(fd, tag, 0, tag.length, stat.size - tag.length);
  } finally { fs.closeSync(fd); }
  if (!crypto.timingSafeEqual(header.subarray(0, MAGIC.length), MAGIC)) throw new Error('Неизвестный формат резервной копии');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), header.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  await pipeline(
    fs.createReadStream(source, { start: header.length, end: stat.size - tag.length - 1 }),
    decipher,
    fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
  );
  return destination;
}

function isEncrypted(file) {
  const fd = fs.openSync(file, 'r');
  const prefix = Buffer.alloc(MAGIC.length);
  try { return fs.readSync(fd, prefix, 0, prefix.length, 0) === prefix.length && crypto.timingSafeEqual(prefix, MAGIC); }
  finally { fs.closeSync(fd); }
}

module.exports = { encryptFile, decryptFile, isEncrypted, MAGIC };
