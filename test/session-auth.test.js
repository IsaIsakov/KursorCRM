const test = require('node:test');
const assert = require('node:assert/strict');

function freshAuth(env = {}) {
  const previous = { NODE_ENV: process.env.NODE_ENV, API_AUTH_BEARER: process.env.API_AUTH_BEARER };
  Object.assign(process.env, env);
  delete require.cache[require.resolve('../server/auth')];
  const auth = require('../server/auth');
  return { auth, restore() {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
    delete require.cache[require.resolve('../server/auth')];
  } };
}

test('production session uses Secure __Host cookies and hides JWT from JavaScript', () => {
  const { auth, restore } = freshAuth({ NODE_ENV: 'production' });
  try {
    const headers = {};
    const res = { setHeader(name, value) { headers[name] = value; } };
    const csrf = auth.issueSession(res, 'signed.jwt');
    assert.equal(csrf.length >= 32, true);
    assert.match(headers['Set-Cookie'][0], /^__Host-kursor_session=/);
    assert.match(headers['Set-Cookie'][0], /HttpOnly/);
    assert.match(headers['Set-Cookie'][0], /Secure/);
    assert.match(headers['Set-Cookie'][0], /SameSite=Strict/);
    assert.doesNotMatch(headers['Set-Cookie'][1], /HttpOnly/);
  } finally { restore(); }
});

test('cookie parser ignores malformed values and extracts the session', () => {
  const { auth, restore } = freshAuth({ NODE_ENV: 'development' });
  try {
    assert.equal(auth.tokenFromCookie('x=1; kursor_session=abc.def; broken=%E0%A4%A'), 'abc.def');
    assert.equal(auth.tokenFromCookie('x=1'), null);
  } finally { restore(); }
});

test('logout expires both session and CSRF cookies', () => {
  const { auth, restore } = freshAuth({ NODE_ENV: 'production' });
  try {
    const headers = {};
    auth.clearSession({ setHeader(name, value) { headers[name] = value; } });
    assert.equal(headers['Set-Cookie'].length, 2);
    for (const line of headers['Set-Cookie']) assert.match(line, /Max-Age=0/);
  } finally { restore(); }
});
