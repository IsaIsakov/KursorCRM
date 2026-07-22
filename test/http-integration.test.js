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
  assert.equal((await ready.json()).schemaVersion, 11);

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
  const lead = (await api('POST', '/api/crm/leads', { childName:'Lead Child', parentName:'Lead Parent', phone:'+77770000000', status:'new' }, 201)).body;
  await api('PUT', `/api/crm/leads/${lead.id}`, { status:'trial', nextContactAt:Date.now()+86400000 });
  const crmTask = (await api('POST', '/api/crm/tasks', { title:'Confirm trial lesson', leadId:lead.id, dueAt:Date.now()+3600000 }, 201)).body;
  await api('PUT', `/api/crm/tasks/${crmTask.id}`, { status:'done' });
  assert.equal((await api('GET','/api/crm/overview')).body.leads.trial, 1);
  const student = (await api('POST', '/api/users', { name: 'E2E Student', login: `student_${port}`, password: 'Student-2026!', role: 'student', languages: [] }, 201)).body;
  const teacher = (await api('POST', '/api/users', { name: 'E2E Teacher', login: `teacher_${port}`, password: 'Teacher-2026!', role: 'teacher', languages: [] }, 201)).body;
  const curator = (await api('POST', '/api/users', { name: 'E2E Curator', login: `curator_${port}`, password: 'Curator-2026!', role: 'curator', languages: [] }, 201)).body;
  await api('PUT', `/api/curator/admin/${curator.id}/branches`, { branchIds: [branch.id] });

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
  const group = (await api('POST', '/api/groups', { name: 'E2E group', branchId: branch.id, courseId: modules[0].id,
    teacherId: teacher.id, assistantId: null, lessonKind: 'main' }, 201)).body;
  const onboarded = (await api('POST', '/api/import/clients', { format: 'json', data: [{
    student_name: 'Тестовый Ребёнок', parent_name: 'Тестовый Родитель', parent_phone: '+7 777 123 45 67',
    branch_id: branch.id, tariff_id: tariff.id, group_id: group.id, languages: 'python', video_consent: 'да',
  }] })).body;
  assert.equal(onboarded.created, 1);
  assert.equal(onboarded.credentials.length, 1);
  assert.ok(onboarded.credentials[0].student.password.length >= 10);
  assert.ok(onboarded.credentials[0].parent.password.length >= 10);
  assert.equal(onboarded.credentials[0].student.login.split('.').length, 2);
  assert.ok(onboarded.credentials[0].parent.login.startsWith('p.'));
  const generatedCredentials = (await api('GET', `/api/client-credentials?student_id=${encodeURIComponent(onboarded.credentials[0].studentId)}`)).body;
  assert.equal(generatedCredentials.length, 2);
  const clientOverview = (await api('GET', `/api/students-crm/${encodeURIComponent(onboarded.credentials[0].studentId)}/overview`)).body;
  assert.equal(clientOverview.groups.length, 1);
  assert.equal(clientOverview.student.fullName, 'Тестовый Ребёнок');

  await api('POST', `/api/groups/${group.id}/members`, { studentId: student.id, since: Date.now() - 1000 }, 201);
  async function sessionApi(cookieValue, csrfValue, method, url, body, expected=200) {
    const headers={Cookie:cookieValue};
    if(!['GET','HEAD'].includes(method))headers['X-CSRF-Token']=csrfValue;
    if(body!==undefined)headers['Content-Type']='application/json';
    const response=await fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    const text=await response.text();
    assert.equal(response.status,expected,`${method} ${url}: ${text}`);
    return text?JSON.parse(text):null;
  }
  const privateThread=await sessionApi(studentCookie,studentLoginBody.csrfToken,'POST','/api/chats/student-threads',{teacherId:teacher.id,subject:'Вопрос по проекту'},201);
  await sessionApi(studentCookie,studentLoginBody.csrfToken,'POST',`/api/chats/student-threads/${privateThread.id}/messages`,{body:'Помогите проверить проект'},201);
  const teacherLogin=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:`teacher_${port}`,password:'Teacher-2026!'})});
  const teacherLoginBody=await teacherLogin.json();
  const teacherCookie=(teacherLogin.headers.getSetCookie?teacherLogin.headers.getSetCookie():[teacherLogin.headers.get('set-cookie')]).filter(Boolean).map(line=>line.split(';')[0]).join('; ');
  await sessionApi(teacherCookie,teacherLoginBody.csrfToken,'POST','/api/auth/change-password',{oldPassword:'Teacher-2026!',newPassword:'Teacher-final-2026!'});
  const teacherChats=await sessionApi(teacherCookie,teacherLoginBody.csrfToken,'GET','/api/chats');
  assert.equal(teacherChats.studentThreads[0].unread,1);
  const privateMessages=await sessionApi(teacherCookie,teacherLoginBody.csrfToken,'GET',`/api/chats/student-threads/${privateThread.id}/messages`);
  assert.equal(privateMessages.messages[0].body,'Помогите проверить проект');
  await sessionApi(teacherCookie,teacherLoginBody.csrfToken,'POST',`/api/chats/student-threads/${privateThread.id}/messages`,{body:'Да, посмотрю сегодня'},201);
  const lesson = (await api('POST', '/api/lesson-sessions', { groupId: group.id, date: Date.now(), topic: 'Integration' }, 201)).body;
  await api('POST', '/api/attendance', { lessonSessionId: lesson.id, records: [{ studentId: student.id, status: 'present' }] });
  const subscriptions = (await api('GET', `/api/subscriptions?student_id=${encodeURIComponent(student.id)}`)).body;
  assert.equal(subscriptions[0].visits_left, 3);

  const absenceCase = (await api('POST', '/api/curator/cases', { studentId: student.id, category: 'absence', description: 'E2E absence' }, 201)).body;
  const debtorCase = (await api('POST', '/api/curator/cases', { studentId: student.id, category: 'debtor', description: 'E2E debt' }, 201)).body;
  const curatorLogin = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: `curator_${port}`, password: 'Curator-2026!' }) });
  assert.equal(curatorLogin.status, 200);
  const curatorLoginBody = await curatorLogin.json();
  const curatorCookie = (curatorLogin.headers.getSetCookie ? curatorLogin.headers.getSetCookie() : [curatorLogin.headers.get('set-cookie')])
    .filter(Boolean).map(line => line.split(';')[0]).join('; ');
  async function curatorApi(method, url, body, expected = 200) {
    const headers = { Cookie: curatorCookie };
    if (!['GET', 'HEAD'].includes(method)) headers['X-CSRF-Token'] = curatorLoginBody.csrfToken;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    assert.equal(response.status, expected, `${method} ${url}: ${text}`);
    return text ? JSON.parse(text) : null;
  }
  await curatorApi('POST', '/api/auth/change-password', { oldPassword: 'Curator-2026!', newPassword: 'Curator-final-2026!' });
  const curatorBootstrap = await curatorApi('GET', '/api/curator/bootstrap');
  assert.deepEqual(curatorBootstrap.branches.map(item => item.id), [branch.id]);
  assert.ok((await curatorApi('GET', '/api/curator/students')).some(item => item.user_id === student.id));
  await curatorApi('POST', `/api/curator/cases/${absenceCase.id}/take`, { comment: 'Calling parent' });
  await curatorApi('POST', `/api/curator/cases/${debtorCase.id}/take`, { comment: 'Second client' }, 409);
  await curatorApi('POST', `/api/curator/cases/${absenceCase.id}/complete`, { comment: 'Parent confirmed the next lesson', outcome: 'resolved' });
  await curatorApi('POST', `/api/curator/cases/${debtorCase.id}/take`, { comment: 'Now available' });

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
