const crypto = require('crypto');

const WINDOW_MS = 60_000;
const MAX_ENTRIES = 25_000;
const buckets = new Map();
const secret = process.env.JWT_SECRET || 'kursor-local-request-limits';

function opaque(value) {
  return crypto.createHmac('sha256', secret).update(String(value || '')).digest('hex');
}

function consume(key, limit, now = Date.now()) {
  if (buckets.size > MAX_ENTRIES) {
    for (const [entry, state] of buckets) if (state.startedAt + WINDOW_MS <= now) buckets.delete(entry);
    while (buckets.size > MAX_ENTRIES) buckets.delete(buckets.keys().next().value);
  }
  let state = buckets.get(key);
  if (!state || state.startedAt + WINDOW_MS <= now) state = { count: 0, startedAt: now };
  state.count += 1;
  buckets.set(key, state);
  const retryAfter = Math.max(1, Math.ceil((state.startedAt + WINDOW_MS - now) / 1000));
  return { allowed: state.count <= limit, retryAfter, remaining: Math.max(0, limit - state.count) };
}

function userRequest(req) {
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const upload = /upload|\/file(?:\/|$)|avatar/i.test(req.path || req.originalUrl || '');
  const limit = upload ? 30 : write ? 180 : 900;
  return consume(`user:${opaque(req.user?.id)}:${upload ? 'upload' : write ? 'write' : 'read'}`, limit);
}

function publicRequest(source, namespace, limit = 120) {
  return consume(`public:${namespace}:${opaque(source)}`, limit);
}

function reset() { buckets.clear(); }

module.exports = { userRequest, publicRequest, reset, constants: { WINDOW_MS, MAX_ENTRIES } };
