const test = require('node:test');
const assert = require('node:assert/strict');
const aiService = require('../src/services/aiService');

function httpError(status) {
  const error = new Error(`HTTP ${status}`);
  error.status = status;
  return error;
}

test('4xx errors fail immediately without any retry', async () => {
  let attempts = 0;
  await assert.rejects(
    () => aiService.retryableRequest(async () => {
      attempts += 1;
      throw httpError(400);
    }, 3, 1),
    /HTTP 400/
  );
  assert.equal(attempts, 1);
});

test('401 and 429 are also treated as non-retryable client errors', async () => {
  for (const status of [401, 404, 429]) {
    let attempts = 0;
    await assert.rejects(
      () => aiService.retryableRequest(async () => {
        attempts += 1;
        throw httpError(status);
      }, 3, 1)
    );
    assert.equal(attempts, 1, `status ${status} must not retry`);
  }
});

test('5xx errors are retried up to the retry budget and then succeed', async () => {
  let attempts = 0;
  const result = await aiService.retryableRequest(async () => {
    attempts += 1;
    if (attempts < 3) throw httpError(503);
    return 'ok';
  }, 3, 1);
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('5xx exhaustion throws the last error', async () => {
  let attempts = 0;
  await assert.rejects(
    () => aiService.retryableRequest(async () => {
      attempts += 1;
      throw httpError(500);
    }, 3, 1)
  );
  assert.equal(attempts, 3);
});

test('network connection errors are retried, timeouts included', async () => {
  const networkError = new Error('socket hang up');
  networkError.code = 'ECONNRESET';
  let attempts = 0;
  const result = await aiService.retryableRequest(async () => {
    attempts += 1;
    if (attempts < 2) throw networkError;
    return 'recovered';
  }, 3, 1);
  assert.equal(result, 'recovered');
  assert.equal(attempts, 2);

  const timeoutError = new Error('The operation was aborted due to timeout');
  timeoutError.code = 'ETIMEDOUT';
  let timeoutAttempts = 0;
  await assert.rejects(
    () => aiService.retryableRequest(async () => {
      timeoutAttempts += 1;
      throw timeoutError;
    }, 2, 1)
  );
  assert.equal(timeoutAttempts, 2);
});
