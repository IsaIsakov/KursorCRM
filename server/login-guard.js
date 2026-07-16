const crypto = require('crypto');

const WINDOW_MS = 10 * 60 * 1000;
const IP_LIMIT = 30;
const FAILURE_LIMIT = 5;
const LOCK_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 10_000;

// Do not retain raw usernames/IP addresses in limiter keys or security logs.
const KEY_SECRET = process.env.JWT_SECRET || 'kursor-local-login-guard-not-for-production';
const ipWindows = new Map();
const failures = new Map();

function opaque(value) {
  return crypto.createHmac('sha256', KEY_SECRET).update(String(value || '')).digest('hex');
}

function normalizedLogin(login) { return String(login || '').trim().toLocaleLowerCase('en-US'); }
function keys(ip, login) {
  const ipKey = opaque(ip);
  return { ipKey, pairKey: opaque(`${ipKey}:${normalizedLogin(login)}`) };
}

function retrySeconds(until, now) { return Math.max(1, Math.ceil((until - now) / 1000)); }

function prune(now = Date.now()) {
  for (const [key, value] of ipWindows) if (value.windowStart + WINDOW_MS <= now) ipWindows.delete(key);
  for (const [key, value] of failures) if ((!value.lockUntil || value.lockUntil <= now) && value.lastFailure + LOCK_MS <= now) failures.delete(key);
  while (ipWindows.size > MAX_ENTRIES) ipWindows.delete(ipWindows.keys().next().value);
  while (failures.size > MAX_ENTRIES) failures.delete(failures.keys().next().value);
}

function consume(ip, login, now = Date.now()) {
  prune(now);
  const { ipKey, pairKey } = keys(ip, login);
  let window = ipWindows.get(ipKey);
  if (!window || window.windowStart + WINDOW_MS <= now) window = { count: 0, windowStart: now };
  window.count += 1;
  ipWindows.set(ipKey, window);
  if (window.count > IP_LIMIT) {
    return { allowed: false, reason: 'ip_rate', retryAfter: retrySeconds(window.windowStart + WINDOW_MS, now), eventKey: ipKey.slice(0, 12) };
  }
  const state = failures.get(pairKey);
  if (state && state.lockUntil > now) {
    return { allowed: false, reason: 'locked', retryAfter: retrySeconds(state.lockUntil, now), eventKey: pairKey.slice(0, 12) };
  }
  return { allowed: true, eventKey: pairKey.slice(0, 12) };
}

function recordFailure(ip, login, now = Date.now()) {
  const { pairKey } = keys(ip, login);
  const previous = failures.get(pairKey);
  const count = previous && previous.lastFailure + LOCK_MS > now ? previous.count + 1 : 1;
  const lockUntil = count >= FAILURE_LIMIT ? now + LOCK_MS : 0;
  failures.set(pairKey, { count, lastFailure: now, lockUntil });
  return { count, locked: !!lockUntil, retryAfter: lockUntil ? retrySeconds(lockUntil, now) : 0, eventKey: pairKey.slice(0, 12) };
}

function recordSuccess(ip, login) { failures.delete(keys(ip, login).pairKey); }
function reset() { ipWindows.clear(); failures.clear(); }

module.exports = {
  consume, recordFailure, recordSuccess, prune, reset,
  constants: { WINDOW_MS, IP_LIMIT, FAILURE_LIMIT, LOCK_MS, MAX_ENTRIES },
};
