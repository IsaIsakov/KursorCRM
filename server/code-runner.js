const RUNNER_URL = process.env.CODE_RUNNER_URL || 'https://emkc.org/api/v2/piston/execute';
const TIMEOUT_MS = Math.min(15_000, Math.max(1_000, Number(process.env.CODE_RUNNER_TIMEOUT_MS) || 8_000));
const MAX_CODE_LENGTH = 50_000;
const QUOTA_WINDOW_MS = 10 * 60 * 1000;
const QUOTA_LIMIT = 20;
const quotas = new Map();

function normalizeOutput(value) { return String(value || '').replace(/\r\n/g, '\n').trim(); }

function payloadFor(type, code, stdin = '') {
  if (typeof code !== 'string' || !code.trim() || code.length > MAX_CODE_LENGTH) throw new Error('Некорректный размер исходного кода');
  if (type === 'code') return { language: 'python', version: '3.10.0', files: [{ name: 'main.py', content: code }], stdin };
  if (type === 'java') return { language: 'java', version: '15.0.2', files: [{ name: 'Main.java', content: code }], stdin };
  if (type === 'cpp') return { language: 'cpp', version: '10.2.0', files: [{ name: 'main.cpp', content: code }], stdin };
  throw new Error('Неподдерживаемый язык');
}

function consumeRunnerQuota(userId, now = Date.now()) {
  const key = String(userId);
  let state = quotas.get(key);
  if (!state || state.start + QUOTA_WINDOW_MS <= now) state = { start: now, count: 0 };
  state.count += 1; quotas.set(key, state);
  if (state.count > QUOTA_LIMIT) return { allowed: false, retryAfter: Math.max(1, Math.ceil((state.start + QUOTA_WINDOW_MS - now) / 1000)) };
  return { allowed: true, remaining: QUOTA_LIMIT - state.count };
}

async function gradeCode(task, code, fetchImpl = fetch) {
  if (!/^https:\/\//i.test(RUNNER_URL)) throw new Error('CODE_RUNNER_URL должен использовать HTTPS');
  const response = await fetchImpl(RUNNER_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payloadFor(task.type, code, task.stdin || '')),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Сервис проверки кода недоступен (${response.status})`);
  const data = await response.json();
  const compileError = data.compile && data.compile.stderr;
  const runError = data.run && data.run.stderr;
  if (compileError || runError) return { correct: false, error: String(compileError || runError).slice(0, 1000) };
  return { correct: normalizeOutput(data.run && data.run.stdout) === normalizeOutput(task.expected_output) };
}

module.exports = { gradeCode, payloadFor, normalizeOutput, consumeRunnerQuota, MAX_CODE_LENGTH };
