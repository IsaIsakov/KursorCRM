const crypto = require('crypto');
const HASH_SECRET = process.env.JWT_SECRET || 'kursor-local-audit-not-for-production';
function sourceHash(value) {
  return crypto.createHmac('sha256', HASH_SECRET).update(String(value || 'unknown')).digest('hex').slice(0, 24);
}
module.exports = { sourceHash };
