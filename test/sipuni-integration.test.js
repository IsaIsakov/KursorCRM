const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('Sipuni integration is server-side, scoped to curator cases and stores call lifecycle',()=>{
  const route=fs.readFileSync('server/routes-sipuni.js','utf8');
  const migration=fs.readFileSync('server/migrations.js','utf8');
  const curator=fs.readFileSync('public/curator/index.html','utf8');
  assert.match(route,/SIPUNI_WEBHOOK_TOKEN/);
  assert.match(route,/sipuni\.com/);
  assert.match(route,/crypto\.randomBytes\(32\)/);
  assert.match(route,/encrypt\(webhookToken\)/);
  assert.match(route,/settings\/prepare/);
  assert.match(route,/callUrlTemplate: encrypt/);
  assert.match(route,/Сначала возьмите клиента в работу/);
  assert.match(route,/call_record_link/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS sipuni_calls/);
  assert.match(curator,/Позвонить родителю/);
  assert.match(curator,/История звонков/);
});

test('Sipuni can be configured from the admin panel without Railway variables',()=>{
  const admin=fs.readFileSync('public/admin/index.html','utf8');
  const security=fs.readFileSync('server/security-config.js','utf8');
  assert.match(admin,/Телефония Sipuni/);
  assert.match(admin,/Проверить и подключить/);
  assert.doesNotMatch(security,/SIPUNI_CALL_URL_TEMPLATE должен быть/);
});
