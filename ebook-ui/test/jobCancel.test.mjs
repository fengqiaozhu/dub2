import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCancelFailure } from '../src/stores/jobPolling.ts';

// A cancel request that failed at HTTP level must not clear the local job.
// Success is the caller's business (2xx never reaches resolveCancelFailure);
// 404 means the job is already gone, so ending local polling is safe.
// Network errors and 5xx keep the job visible and polling, with a notice.

test('404 clears local state because the job no longer exists', () => {
  const outcome = resolveCancelFailure({ response: { status: 404 } });
  assert.equal(outcome.clearLocal, true);
  assert.equal(outcome.notice, '');
});

test('network failures keep the local job and produce a retry notice', () => {
  const outcome = resolveCancelFailure(new Error('ECONNREFUSED'));
  assert.equal(outcome.clearLocal, false, 'a request that never landed must not clear the job');
  assert.match(outcome.notice, /停止任务失败/);
});

test('5xx responses keep the local job and surface the retry notice', () => {
  const outcome = resolveCancelFailure({ response: { status: 503, data: { error: '数据库暂时不可用' } } });
  assert.equal(outcome.clearLocal, false);
  assert.equal(outcome.notice, '数据库暂时不可用');
});

test('timeouts keep the local job and fall back to the default notice', () => {
  const outcome = resolveCancelFailure({ code: 'ECONNABORTED' });
  assert.equal(outcome.clearLocal, false);
  assert.equal(outcome.notice, '停止任务失败，任务仍在进行，请稍后重试');
});

test('null payloads fall back to the default keep-the-job outcome', () => {
  const outcome = resolveCancelFailure(null);
  assert.equal(outcome.clearLocal, false);
  assert.equal(outcome.notice, '停止任务失败，任务仍在进行，请稍后重试');
});
