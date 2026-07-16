const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('lesson artifacts consistently permit files up to 150 MB', () => {
  const route = fs.readFileSync(path.join(__dirname,'..','server','routes-artifacts.js'),'utf8');
  const admin = fs.readFileSync(path.join(__dirname,'..','public','admin','index.html'),'utf8');
  assert.match(route, /ARTIFACT_MAX_BYTES = 150 \* 1024 \* 1024/);
  assert.match(admin, /file\.size > 150 \* 1024 \* 1024/);
});
