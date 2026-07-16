const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('admin journey works end-to-end with cookie, ledger and multipart files', { timeout: 30000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kursor-e2e-'));
  const port = 33000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), DB_PATH: path.join(root, 'test.sqlite'),
      FILE_STORAGE_DIR: path.join(root, 'files'), BACKUP_DIR: path.join(root, 'backups') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stopped = false;
  let logs = ''; child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; });
  t.after(() => { if (!stopped) child.kill('SIGKILL'); fs.rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      const health = await fetch(`${base}/api/health`);
      if (health.ok) { assert.ok(health.headers.get('x-request-id')); break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
    if (i === 49) assert.fail(`Сервер не стартовал: ${logs}`);
  }
  const ready = await fetch(`${base}/api/ready`);
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).schemaVersion, 5);

  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'admin', password: 'admin' }) });
  assert.equal(login.status, 200);
  const loginBody = await login.json();
  assert.equal(Object.hasOwn(loginBody, 'token'), false);
  const setCookies = login.headers.getSetCookie ? login.headers.getSetCookie() : [login.headers.get('set-cookie')];
  const cookie = setCookies.filter(Boolean).map(line => line.split(';')[0]).join('; ');
  let csrf = loginBody.csrfToken;

  async function api(method, url, body, expected = 200) {
    const headers = { Cookie: cookie };
    if (!['GET', 'HEAD'].includes(method)) headers['X-CSRF-Token'] = csrf;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const response = await fetch(base + url, { method, headers, body: payload });
    const text = await response.text();
    assert.equal(response.status, expected, `${method} ${url}: ${text}`);
    const type = response.headers.get('content-type') || '';
    return { response, body: type.includes('json') && text ? JSON.parse(text) : text };
  }

  await api('POST', '/api/auth/change-password', { oldPassword: 'admin', newPassword: 'Admin-test-2026!' });
  const branch = (await api('POST', '/api/branches', { name: 'E2E branch', address: '' }, 201)).body;
  const tariff = (await api('POST', '/api/tariffs', { name: 'E2E tariff', visitsCount: 4, durationDays: 30, price: 10000 }, 201)).body;
  const student = (await api('POST', '/api/users', { name: 'E2E Student', login: `student_${port}`, password: 'Student-2026!', role: 'student', languages: [] }, 201)).body;

  // Routers mounted at /api must not apply admin guards to unrelated student
  // endpoints such as /tasks. This reproduces the student dashboard requests.
  const studentLogin = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: `student_${port}`, password: 'Student-2026!' }) });
  assert.equal(studentLogin.status, 200);
  const studentLoginBody = await studentLogin.json();
  const studentCookies = studentLogin.headers.getSetCookie ? studentLogin.headers.getSetCookie() : [studentLogin.headers.get('set-cookie')];
  const studentCookie = studentCookies.filter(Boolean).map(line => line.split(';')[0]).join('; ');
  const studentChange = await fetch(`${base}/api/auth/change-password`, { method: 'POST',
    headers: { Cookie: studentCookie, 'Content-Type': 'application/json', 'X-CSRF-Token': studentLoginBody.csrfToken },
    body: JSON.stringify({ oldPassword: 'Student-2026!', newPassword: 'Student-final-2026!' }) });
  assert.equal(studentChange.status, 200);
  for (const endpoint of ['/api/tasks', '/api/modules', '/api/progress/me', '/api/homework/me']) {
    const response = await fetch(base + endpoint, { headers: { Cookie: studentCookie } });
    assert.equal(response.status, 200, `student dashboard endpoint ${endpoint}: ${await response.text()}`);
  }

  await api('POST', '/api/students-crm', { userId: student.id, fullName: student.name, branchId: branch.id,
    tariffId: tariff.id, subscriptionIssuedAt: Date.now(), videoConsent: true }, 201);
  const modules = (await api('GET', '/api/modules')).body;
  const group = (await api('POST', '/api/groups', { name: 'E2E group', branchId: branch.id, courseId: modules[0].id }, 201)).body;
  await api('POST', `/api/groups/${group.id}/members`, { studentId: student.id, since: Date.now() - 1000 }, 201);
  const lesson = (await api('POST', '/api/lesson-sessions', { groupId: group.id, date: Date.now(), topic: 'Integration' }, 201)).body;
  await api('POST', '/api/attendance', { lessonSessionId: lesson.id, records: [{ studentId: student.id, status: 'present' }] });
  const subscriptions = (await api('GET', `/api/subscriptions?student_id=${encodeURIComponent(student.id)}`)).body;
  assert.equal(subscriptions[0].visits_left, 3);

  const artifactForm = new FormData();
  for (const [key, value] of Object.entries({ lessonSessionId: lesson.id, studentId: student.id, type: 'screenshot', title: 'E2E image' })) artifactForm.append(key, value);
  artifactForm.append('file', new Blob([Buffer.from('fake-png-stream')], { type: 'image/png' }), 'screen.png');
  const artifact = (await api('POST', '/api/session-artifacts', artifactForm, 201)).body;
  assert.match(artifact.url, /^\/api\/session-artifacts\//);
  const file = await api('GET', artifact.url, undefined, 200);
  assert.equal(file.body, 'fake-png-stream');

  const materialForm = new FormData();
  for (const [key, value] of Object.entries({ courseId: modules[0].id, type: 'file', title: 'E2E material', content: '' })) materialForm.append(key, value);
  materialForm.append('file', new Blob([Buffer.from('streamed material')], { type: 'text/plain' }), 'notes.txt');
  const material = (await api('POST', '/api/materials', materialForm, 201)).body;
  assert.match(material.content, /^\/api\/materials\//);
  const materialFile = await api('GET', material.content, undefined, 200);
  assert.equal(materialFile.body, 'streamed material');

  await api('POST', '/api/auth/logout', {});
  const after = await fetch(`${base}/api/auth/me`, { headers: { Cookie: 'kursor_session=' } });
  assert.equal(after.status, 401);

  child.kill('SIGTERM');
  const exitCode = await new Promise(resolve => child.once('exit', resolve));
  stopped = true;
  assert.equal(exitCode, 0, logs);
});
