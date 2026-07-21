const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pages = [
  'public/index.html', 'public/change-password.html', 'public/admin/index.html',
  'public/pages/dashboard.html', 'public/pages/catalog.html', 'public/pages/leaderboard.html',
  'public/pages/profile.html', 'public/pages/lesson.html', 'public/pages/task.html',
  'public/pages/teacher.html', 'public/pages/parent.html', 'public/pages/chats.html',
];

test('every user-facing page opts into safe-area mobile layout and versioned CSS', () => {
  for (const file of pages) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(html, /viewport-fit=cover/, file);
    assert.match(html, /\/css\/style\.css\?v=12/, file);
  }
});

test('mobile navigation and admin drawer remain present in release assets', () => {
  const css = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');
  const admin = fs.readFileSync(path.join(root, 'public/admin/index.html'), 'utf8');
  assert.match(css, /--mobile-nav-height/);
  assert.match(css, /\.navbar-menu\s*\{[\s\S]*position:fixed/);
  assert.match(css, /\.admin-nav-open \.admin-sidebar/);
  assert.match(admin, /toggleMobileAdminNav/);
});
