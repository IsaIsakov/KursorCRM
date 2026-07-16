const test = require('node:test');
const assert = require('node:assert/strict');
const { z, id, validateBody, safeJson } = require('../server/validation');

function response() {
  return {
    statusCode: 200, payload: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
  };
}

function run(middleware, body) {
  const req = { body }; const res = response(); let next = false;
  middleware(req, res, () => { next = true; });
  return { req, res, next };
}

test('strict body schemas reject unknown fields and report their paths', () => {
  const schema = z.strictObject({ studentId: id, count: z.coerce.number().int().min(0).max(10) });
  const result = run(validateBody(schema), { studentId: 'student_1', count: 3, admin: true });
  assert.equal(result.res.statusCode, 400);
  assert.equal(result.next, false);
  assert.equal(result.res.payload.error, 'Некорректные данные запроса');
  assert.ok(result.res.payload.details.length);
});

test('validated data is normalized before reaching a route', () => {
  const schema = z.strictObject({ studentId: id, count: z.coerce.number().int().min(0).max(10) });
  const result = run(validateBody(schema), { studentId: ' student_1 ', count: '4' });
  assert.equal(result.next, true);
  assert.deepEqual(result.req.body, { studentId: 'student_1', count: 4 });
});

test('invalid ranges and malformed identifiers are rejected', () => {
  const schema = z.strictObject({ studentId: id, count: z.number().int().min(0).max(10) });
  assert.equal(run(validateBody(schema), { studentId: '../etc/passwd', count: 2 }).res.statusCode, 400);
  assert.equal(run(validateBody(schema), { studentId: 'ok', count: 999 }).res.statusCode, 400);
});

test('global JSON guard rejects pollution keys and excessive nesting', () => {
  const polluted = JSON.parse('{"safe":1,"__proto__":{"admin":true}}');
  assert.equal(run(safeJson, polluted).res.statusCode, 400);
  let nested = {}; let cursor = nested;
  for (let i = 0; i < 14; i++) { cursor.child = {}; cursor = cursor.child; }
  assert.equal(run(safeJson, nested).res.statusCode, 400);
  assert.equal(run(safeJson, { normal: [{ value: 1 }] }).next, true);
});
