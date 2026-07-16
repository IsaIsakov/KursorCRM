const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../server/storage');

test('generated artifact URL has a valid short-lived signature', () => {
  const now = 1_700_000_000_000;
  const url = new URL(storage.getUrl('artifact_1', now), 'http://localhost');
  assert.equal(storage.verifyUrl('artifact_1', url.searchParams.get('expires'), url.searchParams.get('signature'), now), true);
});

test('signature cannot be reused for another artifact', () => {
  const now = 1_700_000_000_000;
  const url = new URL(storage.getUrl('artifact_1', now), 'http://localhost');
  assert.equal(storage.verifyUrl('artifact_2', url.searchParams.get('expires'), url.searchParams.get('signature'), now), false);
});

test('expired and excessively future-dated URLs are rejected', () => {
  const now = 1_700_000_000_000;
  const url = new URL(storage.getUrl('artifact_1', now), 'http://localhost');
  const expires = url.searchParams.get('expires');
  const sig = url.searchParams.get('signature');
  assert.equal(storage.verifyUrl('artifact_1', expires, sig, now + 11 * 60 * 1000), false);
  assert.equal(storage.verifyUrl('artifact_1', expires, sig, now - 2 * 60 * 1000), false);
});
