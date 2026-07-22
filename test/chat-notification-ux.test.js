const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

test('student has a private teacher channel separate from parent dialogs',()=>{
  const routes=read('server/routes-chats.js');
  const page=read('public/pages/chats.html');
  assert.match(routes,/post\('\/chats\/student-threads', requireRole\('student'\)/);
  assert.match(routes,/Можно написать только своему преподавателю/);
  assert.match(page,/student_thread/);
  assert.match(page,/Приватно: ученик и преподаватель/);
});

test('notification badges count unread while read items remain visible',()=>{
  const routes=read('server/routes-notifications.js');
  const app=read('public/js/app.js');
  const curator=read('public/curator/index.html');
  assert.match(routes,/SELECT \* FROM notifications[\s\S]+LIMIT 100/);
  assert.match(routes,/read = 0 AND channel = 'in_app'/);
  assert.match(app,/openNotif\(event/);
  assert.match(app,/Прочитано/);
  assert.match(curator,/Прочитанные остаются в истории/);
  assert.match(curator,/readAllCuratorNotifications/);
});
