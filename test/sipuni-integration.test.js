const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('Sipuni integration is server-side, scoped to curator cases and stores call lifecycle',()=>{
  const route=fs.readFileSync('server/routes-sipuni.js','utf8');
  const migration=fs.readFileSync('server/migrations.js','utf8');
  const curator=fs.readFileSync('public/curator/index.html','utf8');
  assert.match(route,/SIPUNI_WEBHOOK_TOKEN/);
  assert.match(route,/sipuni\.com/);
  assert.match(route,/Сначала возьмите клиента в работу/);
  assert.match(route,/call_record_link/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS sipuni_calls/);
  assert.match(curator,/Позвонить родителю/);
  assert.match(curator,/История звонков/);
});
