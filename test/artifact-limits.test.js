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

test('large lesson files use a verified direct Bucket upload with retry and fallback', () => {
  const route = fs.readFileSync(path.join(__dirname,'..','server','routes-artifacts.js'),'utf8');
  const api = fs.readFileSync(path.join(__dirname,'..','public','js','api.js'),'utf8');
  assert.match(route, /direct-upload\/complete/);
  assert.match(route, /storage\.headFile/);
  assert.match(route, /object\.size !== payload\.size/);
  assert.match(api, /directPut/);
  assert.match(api, /await retry/);
  assert.match(api, /if \(!uploaded\) return request\('POST', '\/api\/session-artifacts', fallbackForm\(\)\)/);
});
