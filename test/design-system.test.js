const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('primary panels use the local KURSOR logo and SVG icon system', () => {
  assert.ok(fs.statSync(path.join(root, 'public/img/kursor-logo.webp')).size > 1000);
  const sprite = read('public/img/ui-icons.svg');
  for (const icon of ['calendar','student','groups','tasks','book','chart','bell','logout','building']) {
    assert.match(sprite, new RegExp(`id="${icon}"`));
  }
  for (const page of ['public/index.html','public/admin/index.html','public/curator/index.html']) {
    assert.match(read(page), /\/img\/kursor-logo\.webp/, page);
  }
  const curator = read('public/curator/index.html');
  assert.doesNotMatch(curator, /📅|👨‍🎓|👥|🎯|📚|📊|🔔|☰/);
});

test('long single-page panels return to the top when switching sections', () => {
  assert.match(read('public/curator/index.html'), /window\.scrollTo\(\{top:0,behavior:'smooth'\}\)/);
  assert.match(read('public/admin/index.html'), /window\.scrollTo\(\{ top: 0, behavior: 'smooth' \}\)/);
  assert.match(read('public/pages/parent.html'), /window\.scrollTo\(\{ top: 0, behavior: 'smooth' \}\)/);
});
