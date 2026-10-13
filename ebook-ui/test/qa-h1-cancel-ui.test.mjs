// Independent regression suite for CMP-28 / H1 (job cancellation) — frontend side.
// Runs the real polling state machine from src/stores/jobPolling.ts against fake
// clocks, and pins the wiring that connects the stop controls to the cancel API.
//
// The pinia store (src/stores/jobStore.ts) imports `@/api/request`, an alias that
// only vite resolves, so its wiring is asserted at the source level and reported as
// such in the CMP-28 test report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJobPoller } from '../src/stores/jobPolling.ts';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src');

function fakeClock() {
  const pending = new Map();
  let seq = 0;
  return {
    delays: () => [...pending.values()].map((entry) => entry.delay),
    schedule(fn, delay) {
      const id = ++seq;
      pending.set(id, { fn, delay });
      return id;
    },
    cancel(id) {
      pending.delete(id);
    },
    async flush() {
      const entry = pending.entries().next().value;
      if (!entry) return false;
      pending.delete(entry[0]);
      entry[1].fn();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      return true;
    }
  };
}

function poll(job) {
  const clock = fakeClock();
  const events = { updates: [], completions: [], errors: [], cancelled: [] };
  const stop = createJobPoller({
    fetchJob: async () => job,
    onUpdate: (value) => events.updates.push(value.status),
    onComplete: (result) => events.completions.push(result),
    onError: (error) => events.errors.push(error),
    onCancelled: (value) => events.cancelled.push(value.status),
    schedule: clock.schedule,
    cancel: clock.cancel
  });
  return { clock, events, stop };
}

test('H1 a job the server reports as CANCELLED stops polling and reports the cancellation', async () => {
  const { clock, events, stop } = poll({ id: 'job-1', status: 'CANCELLED', progress: 40 });

  assert.equal(await clock.flush(), true, 'the poller must issue the first request');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(events.cancelled, ['CANCELLED']);
  assert.deepEqual(events.updates, ['CANCELLED'], 'the terminal job is published once before it stops');
  assert.deepEqual(events.completions, [], 'a cancelled job is not a completion');
  assert.deepEqual(events.errors, [], 'a cancelled job is not an error');
  assert.deepEqual(clock.delays(), [], 'a terminal status must not schedule another poll');
  assert.equal(stop(), undefined);
});

test('H1 the stop controls call the cancel API and only clear local state when the stop landed', () => {
  const store = readFileSync(path.join(srcDir, 'stores/jobStore.ts'), 'utf8');
  assert.match(store, /request\.post\(`\/jobs\/\$\{jobId\}\/cancel`\)/, 'the store must POST the cancel endpoint');
  assert.doesNotMatch(
    store,
    /finally\s*\{[\s\S]{0,120}this\.stopPolling\(jobId\)/,
    'an unconditional finally-stop would hide a failed cancel from the user'
  );
  assert.match(
    store,
    /resolveCancelFailure/,
    'failures must be classified: only a confirmed stop or a gone job (404) clears the local state'
  );

  for (const file of ['views/Workspace.vue', 'components/workspace/DialogueView.vue']) {
    const source = readFileSync(path.join(srcDir, file), 'utf8');
    assert.ok(
      source.includes('jobStore.cancelJob('),
      `${file} must expose a stop control wired to jobStore.cancelJob`
    );
    assert.ok(
      /cleared/.test(source),
      `${file} must react to the cleared outcome instead of assuming the stop landed`
    );
  }

  const request = readFileSync(path.join(srcDir, 'api/request.ts'), 'utf8');
  assert.match(request, /DEFAULT_TIMEOUT = 10000/, 'the cancel POST inherits the 10s default JSON timeout');
});

test('H1 a failed cancel request surfaces a retry notice instead of pretending the job stopped', () => {
  const store = readFileSync(path.join(srcDir, 'stores/jobStore.ts'), 'utf8');
  const cancelAction = store.slice(store.indexOf('async cancelJob'), store.indexOf('getJob(jobId'));
  assert.match(
    cancelAction,
    /console\.error\('Failed to cancel job:', err\)/,
    'the failed request is still logged for diagnosis'
  );
  assert.match(
    cancelAction,
    /notice\s*:\s*outcome\.notice/,
    'the store must return the classified failure notice to the caller'
  );

  const workspace = readFileSync(path.join(srcDir, 'views/Workspace.vue'), 'utf8');
  assert.match(workspace, /停止配音失败|停止拼接失败/, 'the workspace must surface the failed stop to the user');

  const dialogue = readFileSync(path.join(srcDir, 'components/workspace/DialogueView.vue'), 'utf8');
  assert.match(dialogue, /停止解析失败/, 'the analysis stop must surface the failed cancel to the user');
});
