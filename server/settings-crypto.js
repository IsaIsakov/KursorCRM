const crypto = require('crypto');
const PREFIX = 'enc:v1:';

function key() {
  const secret = process.env.SETTINGS_ENCRYPTION_KEY || (process.env.NODE_ENV !== 'production' ? 'kursor-local-settings-key-not-for-production' : '');
  if (!secret) throw new Error('SETTINGS_ENCRYPTION_KEY не настроен');
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(value) {
  if (!value) return '';
  if (String(value).startsWith(PREFIX)) return String(value);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

function decrypt(value) {
  if (!value || !String(value).startsWith(PREFIX)) return String(value || ''); // legacy plaintext, rewritten on next save
  const packed = Buffer.from(String(value).slice(PREFIX.length), 'base64url');
  if (packed.length < 29) throw new Error('Повреждён зашифрованный секрет');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, PREFIX };
