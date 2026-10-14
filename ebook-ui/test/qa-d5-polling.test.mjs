// Independent regression suite for CMP-28 / D5 (job polling).
// Derived from the D5 acceptance criteria in CMP-25 defect-inventory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobPoller } from '../src/stores/jobPolling.ts';

function makeClock() {
  const pending = new Map();
  let seq = 0;
  return {
    pending,
    schedule(fn, delay) {
      const id = ++seq;
      pending.set(id, { fn, delay });
      return id;
    },
    cancel(id) {
      pending.delete(id);
    },
    get delays() {
      return [...pending.values()].map((t) => t.delay);
    },
    async flush() {
      const entry = pending.entries().next().value;
      if (!entry) return false;
      pending.delete(entry[0]);
      entry[1].fn();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      return true;
    },
  };
}

function setup(fetchJob) {
  const clock = makeClock();
  const events = { updates: [], completions: [], errors: [], calls: 0 };
  const stop = createJobPoller({
    fetchJob: async () => {
      events.calls += 1;
      return fetchJob(events.calls);
    },
    onUpdate: (job) => events.updates.push(job),
    onComplete: (result) => events.completions.push(result),
    onError: (error) => events.errors.push(error),
    schedule: clock.schedule,
    cancel: clock.cancel
  });
  return { clock, events, stop };
}

const running = { status: 'RUNNING', progress: 10 };
const done = { status: 'DONE', result: { ok: true } };

test('D5 only one request is in flight at a time', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { clock, events, stop } = setup(async () => {
    await gate;
    return running;
  });

  await clock.flush();
  assert.equal(events.calls, 1);
  // Long request: nothing may be queued while it is still open.
  assert.equal(clock.pending.size, 0);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.updates.length, 1);
  assert.equal(clock.delays.length, 1);
  assert.equal(clock.delays[0], 2000);
  stop();
});

test('D5 transient failures back off exponentially and the delay is capped', async () => {
  const { clock, events, stop } = setup(async () => { throw new Error('network down'); });

  await clock.flush();
  assert.deepEqual(clock.delays, [4000]);
  await clock.flush();
  assert.deepEqual(clock.delays, [8000]);
  await clock.flush();
  assert.deepEqual(clock.delays, [16000]);
  await clock.flush();
  assert.deepEqual(clock.delays, [30000]);
  await clock.flush();
  assert.deepEqual(clock.delays, [30000]);
  assert.equal(events.errors.length, 0, 'transient failures must not surface as terminal errors');
  stop();
});

test('D5 the backoff resets to the steady interval after a successful poll', async () => {
  const { clock, events, stop } = setup(async (call) => {
    if (call === 1) throw Object.assign(new Error('timeout'), { response: { status: 429 } });
    return running;
  });

  await clock.flush();
  assert.deepEqual(clock.delays, [4000], 'a 429 keeps polling with backoff');
  await clock.flush();
  assert.equal(events.updates.length, 1);
  assert.deepEqual(clock.delays, [2000], 'success resets the retry counter');
  stop();
});

test('D5 a hard client error stops polling and reports the failure once', async () => {
  const { clock, events, stop } = setup(async () => {
    throw Object.assign(new Error('not found'), { response: { status: 404 } });
  });

  await clock.flush();
  assert.equal(events.errors.length, 1);
  assert.equal(events.errors[0].response.status, 404);
  assert.equal(clock.pending.size, 0, 'a terminal error must not schedule another poll');
  stop();
});

test('D5 a response that arrives after stop never reaches the store or callbacks', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { clock, events, stop } = setup(async () => {
    await gate;
    return done;
  });

  await clock.flush();
  stop();
  release();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(events.updates.length, 0);
  assert.equal(events.completions.length, 0);
  assert.equal(clock.pending.size, 0);
});

test('D5 completion fires once and polling stops', async () => {
  const { clock, events, stop } = setup(async () => done);

  await clock.flush();
  await clock.flush();

  assert.deepEqual(events.completions, [{ ok: true }]);
  assert.equal(events.calls, 1);
  assert.equal(clock.pending.size, 0);
  stop();
});
