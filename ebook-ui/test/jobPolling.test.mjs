import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobPoller } from '../src/stores/jobPolling.ts';

function harness(fetchJob) {
  const timers = new Map();
  const updates = [];
  const completions = [];
  const errors = [];
  const cancellations = [];
  let nextId = 0;
  const stop = createJobPoller({
    fetchJob,
    onUpdate: (job) => updates.push(job),
    onComplete: (result) => completions.push(result),
    onError: (error) => errors.push(error),
    onCancelled: (job) => cancellations.push(job),
    schedule: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, delay }); return id; },
    cancel: (id) => timers.delete(id),
  });
  return {
    timers, updates, completions, errors, cancellations, stop,
    async tick() {
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.fn();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test('temporary network failure recovers and calls completion exactly once', async () => {
  let attempts = 0;
  const h = harness(async () => {
    if (++attempts === 1) throw new Error('offline');
    return { status: 'DONE', result: 'audio.wav' };
  });
  await h.tick();
  assert.equal([...h.timers.values()][0].delay, 4000);
  assert.deepEqual(h.errors, []);
  await h.tick();
  assert.deepEqual(h.completions, ['audio.wav']);
  assert.equal(h.timers.size, 0);
});

test('slow requests do not overlap and stopped requests cannot update the store', async () => {
  let resolve;
  let calls = 0;
  const h = harness(() => { calls++; return new Promise((done) => { resolve = done; }); });
  await h.tick();
  assert.equal(calls, 1);
  assert.equal(h.timers.size, 0);
  h.stop();
  resolve({ status: 'DONE' });
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(h.updates, []);
  assert.deepEqual(h.completions, []);
});

test('missing jobs stop while rate limiting retries', async () => {
  const missing = harness(async () => { throw { response: { status: 404 } }; });
  await missing.tick();
  assert.equal(missing.errors.length, 1);
  assert.equal(missing.timers.size, 0);
  const limited = harness(async () => { throw { response: { status: 429 } }; });
  await limited.tick();
  assert.equal(limited.errors.length, 0);
  assert.equal(limited.timers.size, 1);
  limited.stop();
});

test('retry delays are bounded and reset after a successful response', async () => {
  let calls = 0;
  const h = harness(async () => {
    if (++calls <= 6) throw { response: { status: 503 } };
    return { status: 'RUNNING' };
  });
  for (let i = 0; i < 6; i++) {
    await h.tick();
    assert.ok([...h.timers.values()][0].delay <= 30000);
  }
  await h.tick();
  assert.equal([...h.timers.values()][0].delay, 2000);
  h.stop();
});

test('failed jobs surface their error once and stop', async () => {
  const h = harness(async () => ({ status: 'FAILED', error: 'provider failed' }));
  await h.tick();
  assert.deepEqual(h.errors, ['provider failed']);
  assert.equal(h.timers.size, 0);
});

test('cancelled jobs stop polling and never call completion or error', async () => {
  const h = harness(async () => ({ status: 'CANCELLED' }));
  await h.tick();
  assert.equal(h.cancellations.length, 1);
  assert.deepEqual(h.completions, []);
  assert.deepEqual(h.errors, []);
  assert.equal(h.timers.size, 0);
});
