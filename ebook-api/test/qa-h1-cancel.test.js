/**
 * CMP-28 independent regression probe for H1 (job cancellation).
 *
 * These tests drive the real `jobManager` / real `bree` (9.2.9) instances and the
 * real express route table. Only the database repository is stubbed, so nothing
 * here depends on a live Postgres, MinIO or any paid TTS/LLM provider.
 *
 * Naming convention: tests prefixed `H1-DEFECT-WITNESS` captured the (wrong)
 * behaviour that existed when the defect round-trip started. Every witness in
 * this file has since been converted to assert the FIXED behaviour; only tests
 * without the prefix remain, and they assert required behaviour.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const manager = require('../src/services/jobManager');
const jobRoutes = require('../src/routes/jobs');
const { jobRepository } = require('../src/repositories');

const jobScriptDir = path.join(__dirname, '../src/jobs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp28-h1-'));

/**
 * @param {string} fileName
 * @param {boolean} cooperative when true the worker answers Bree's `cancel`
 *   message with `cancelled`, which is what `bree.stop()` waits for.
 */
function writeWorker(fileName, cooperative, runForMs) {
  const file = path.join(tmpDir, fileName);
  fs.writeFileSync(
    file,
    `const { parentPort, workerData } = require('worker_threads');
const started = Date.now();
let ticks = 0;
const timer = setInterval(() => {
  ticks += 1;
  parentPort.postMessage({ type: 'PROGRESS', jobId: workerData.jobId, value: ticks });
}, 50);
setTimeout(() => {
  clearInterval(timer);
  parentPort.postMessage({
    type: 'DONE',
    jobId: workerData.jobId,
    jobName: workerData.jobName,
    result: { ticks, ranForMs: Date.now() - started }
  });
}, ${runForMs});
${
  cooperative
    ? `parentPort.on('message', (message) => {
  if (message === 'cancel') {
    clearInterval(timer);
    parentPort.postMessage('cancelled');
  }
});`
    : '// No parentPort listener: this worker never acknowledges the cancel message.'
}
`
  );
  return file;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function settled(promise) {
  return Promise.race([
    promise.then(
      (value) => ({ settled: true, value }),
      (error) => ({ settled: true, error })
    ),
    sleep(2000).then(() => ({ settled: false }))
  ]);
}

async function waitForWorker(name, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (manager.bree.workers.has(name)) return true;
    await sleep(25);
  }
  return false;
}

async function teardownWorker(name) {
  const worker = manager.bree.workers.get(name);
  if (worker) {
    await worker.terminate();
  }
  const deadline = Date.now() + 2000;
  while (manager.bree.workers.has(name) && Date.now() < deadline) {
    await sleep(25);
  }
  try {
    await manager.bree.remove(name);
  } catch {
    // Already removed.
  }
}

function stubRepository(t, job) {
  const original = {
    findById: jobRepository.findById,
    update: jobRepository.update,
    updateUnlessCancelled: jobRepository.updateUnlessCancelled,
    create: jobRepository.create
  };
  const updates = [];
  jobRepository.findById = async () => job;
  jobRepository.update = async (id, patch) => {
    updates.push({ id, ...patch });
    Object.assign(job, patch);
    return { ...job };
  };
  // Emulates the SQL contract of JobRepository.updateUnlessCancelled:
  // `UPDATE ... WHERE id = $n AND status <> 'CANCELLED'` matches nothing once
  // the row is CANCELLED, so a late worker write never lands. Only applied
  // patches are recorded, mirroring the observable database state.
  jobRepository.updateUnlessCancelled = async (id, patch) => {
    if (job.status === 'CANCELLED') return { ...job };
    updates.push({ id, ...patch });
    Object.assign(job, patch);
    return { ...job };
  };
  t.after(() => {
    jobRepository.findById = original.findById;
    jobRepository.update = original.update;
    jobRepository.updateUnlessCancelled = original.updateUnlessCancelled;
    jobRepository.create = original.create;
  });
  return updates;
}

test('H1 cancelling a pending job that never started resolves and never runs it', async (t) => {
  const jobId = 'qa-h1-pending';
  const jobName = `qa-h1-pending-${Date.now()}`;
  const updates = stubRepository(t, { id: jobId, job_name: jobName, status: 'PENDING', progress: 0 });
  manager.cancelledJobIds.add(jobId);
  t.after(() => manager.cancelledJobIds.delete(jobId));

  await manager.bree.add({ name: jobName, path: writeWorker('pending.js', false, 50) });

  const result = await manager.cancelJob(jobId);

  assert.equal(result.status, 'CANCELLED');
  assert.deepEqual(updates, [{ id: jobId, status: 'CANCELLED' }]);
  assert.equal(
    manager.bree.config.jobs.some((job) => job.name === jobName),
    false,
    'a cancelled pending job must be deregistered so it can never start'
  );
});

test('H1 a worker that acknowledges the Bree cancel message is stopped promptly', async (t) => {
  const jobId = 'qa-h1-cooperative';
  const jobName = `qa-h1-cooperative-${Date.now()}`;
  const updates = stubRepository(t, { id: jobId, job_name: jobName, status: 'RUNNING', progress: 0 });
  t.after(async () => {
    manager.cancelledJobIds.delete(jobId);
    await teardownWorker(jobName);
  });

  await manager.bree.add({
    name: jobName,
    path: writeWorker('cooperative.js', true, 30000),
    worker: { workerData: { jobId, jobName } }
  });
  await manager.bree.start(jobName);
  assert.equal(await waitForWorker(jobName), true, 'the worker should be running');

  const outcome = await settled(manager.cancelJob(jobId));

  assert.equal(outcome.settled, true, 'a cooperative worker must not block the cancel request');
  assert.equal(outcome.value.status, 'CANCELLED');
  assert.deepEqual(updates, [{ id: jobId, status: 'CANCELLED' }]);
  assert.equal(manager.bree.workers.has(jobName), false, 'the worker thread must be gone');
});

test('H1 cancelling a running worker that never acknowledges the cancel signal still settles', async (t) => {
  const jobId = 'qa-h1-running';
  const jobName = `qa-h1-running-${Date.now()}`;
  const updates = stubRepository(t, { id: jobId, job_name: jobName, status: 'RUNNING', progress: 0 });
  t.after(async () => {
    manager.cancelledJobIds.delete(jobId);
    await teardownWorker(jobName);
  });

  await manager.bree.add({
    name: jobName,
    path: writeWorker('stubborn.js', false, 20000),
    worker: { workerData: { jobId, jobName } }
  });
  await manager.bree.start(jobName);
  assert.equal(await waitForWorker(jobName), true, 'the worker should be running');

  const outcome = await settled(manager.cancelJob(jobId));

  assert.equal(
    outcome.settled,
    true,
    'FIXED: a stubborn worker must not hang the cancel request (grace + forced terminate)'
  );
  assert.equal(outcome.value.status, 'CANCELLED');
  assert.deepEqual(
    updates.filter((u) => u.status !== 'RUNNING'),
    [{ id: jobId, status: 'CANCELLED' }],
    'CANCELLED is persisted; no RUNNING/FAILED/DONE lifecycle write ever lands again'
  );
  assert.equal(manager.bree.workers.has(jobName), false, 'FIXED: the worker thread is terminated after the grace period');

  // A late message that somehow arrives after cancelJob settled must not
  // change the persisted state either (marker is gone; the DB guard refuses).
  await manager.bree.config.workerMessageHandler({ name: jobName, message: { type: 'PROGRESS', jobId, value: 99 } });
  await manager.bree.config.workerMessageHandler({ name: jobName, message: { type: 'DONE', jobId, result: {} } });
  assert.deepEqual(
    updates.filter((u) => u.status !== 'RUNNING'),
    [{ id: jobId, status: 'CANCELLED' }],
    'late messages after the cancel cannot change the status'
  );
});

test('H1 every shipped worker job answers the Bree cancel message', () => {
  const scripts = fs.readdirSync(jobScriptDir).filter((name) => name.endsWith('.js') && name !== 'index.js');
  const withoutHandshake = scripts.filter((name) => {
    const source = fs.readFileSync(path.join(jobScriptDir, name), 'utf8');
    return !/registerCancelHandler/.test(source);
  });
  assert.deepEqual(
    withoutHandshake,
    [],
    'FIXED: every worker script registers the cancel handshake (src/jobs/cancelSignal.js) so bree.stop() can stop it'
  );
});

test('H1 the cancel route keeps a terminal job terminal and unknown jobs 404', async (t) => {
  const updates = [];
  const original = {
    findById: jobRepository.findById,
    update: jobRepository.update,
    remove: manager.bree.remove
  };
  t.after(() => {
    jobRepository.findById = original.findById;
    jobRepository.update = original.update;
    manager.bree.remove = original.remove;
  });
  const removed = [];
  manager.bree.remove = async (name) => removed.push(name);
  jobRepository.update = async (id, patch) => {
    updates.push({ id, ...patch });
    return { id, ...patch };
  };

  const app = express();
  app.use('/api/jobs', jobRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const url = `http://127.0.0.1:${server.address().port}/api/jobs`;

  jobRepository.findById = async () => null;
  const missing = await fetch(`${url}/no-such-job/cancel`, { method: 'POST' });
  assert.equal(missing.status, 404);

  jobRepository.findById = async () => ({ id: 'done-job', job_name: 'done-job', status: 'DONE' });
  const done = await fetch(`${url}/done-job/cancel`, { method: 'DELETE' });
  assert.equal(done.status, 200);
  assert.equal((await done.json()).data.status, 'DONE', 'a finished job must not be relabelled CANCELLED');
  assert.deepEqual(removed, [], 'a finished job must not touch the worker registry');
  assert.deepEqual(updates, []);
});

test('H1 late worker messages cannot revive a cancelled job', async (t) => {
  const jobId = 'qa-h1-late';
  const updates = stubRepository(t, { id: jobId, job_name: 'qa-h1-late', status: 'RUNNING', progress: 0 });
  const original = manager.bree.remove;
  t.after(() => {
    manager.bree.remove = original;
    manager.cancelledJobIds.delete(jobId);
  });
  manager.bree.remove = async () => {};
  const deliver = manager.bree.config.workerMessageHandler;

  await manager.cancelJob(jobId);
  assert.deepEqual(updates, [{ id: jobId, status: 'CANCELLED' }]);

  await deliver({ name: 'qa-h1-late', message: { type: 'PROGRESS', jobId, value: 90 } });
  await deliver({ name: 'qa-h1-late', message: { type: 'DONE', jobId, result: {} } });
  assert.deepEqual(updates, [{ id: jobId, status: 'CANCELLED' }], 'no late message may change the status');
  assert.equal(
    manager.cancelledJobIds.has(jobId),
    false,
    'the marker is released by cancelJob itself, never by worker messages'
  );
});

test('H1 a second terminal message after the marker is released does not revive the job', async (t) => {
  const jobId = 'qa-h1-revive';
  const updates = stubRepository(t, { id: jobId, job_name: 'qa-h1-revive', status: 'RUNNING', progress: 0 });
  const original = manager.bree.remove;
  t.after(() => {
    manager.bree.remove = original;
    manager.cancelledJobIds.delete(jobId);
  });
  manager.bree.remove = async () => {};
  const deliver = manager.bree.config.workerMessageHandler;

  await manager.cancelJob(jobId);
  await deliver({ name: 'qa-h1-revive', message: { type: 'DONE', jobId, result: {} } });
  await deliver({ name: 'qa-h1-revive', message: { type: 'ERROR', jobId, error: 'late failure' } });

  assert.deepEqual(
    updates,
    [{ id: jobId, status: 'CANCELLED' }],
    'FIXED: the marker is already released, but the database guard (status <> CANCELLED) still refuses the revive'
  );
});

test('H1 cancelling releases the cancel marker even when the worker removal hangs', async (t) => {
  const jobId = 'qa-h1-leak';
  const updates = stubRepository(t, { id: jobId, job_name: 'qa-h1-leak', status: 'RUNNING', progress: 0 });
  const original = manager.bree.remove;
  t.after(() => {
    manager.bree.remove = original;
    manager.cancelledJobIds.delete(jobId);
  });
  manager.bree.remove = () => new Promise(() => {
    // Stubborn worker: the removal (which includes stop) never settles.
  });
  const deliver = manager.bree.config.workerMessageHandler;
  const sizeBefore = manager.cancelledJobIds.size;

  const cancelled = await manager.cancelJob(jobId);

  await deliver({ name: 'qa-h1-leak', message: { type: 'PROGRESS', jobId, value: 10 } });
  await deliver({ name: 'qa-h1-leak', message: { type: 'PROGRESS', jobId, value: 20 } });

  assert.equal(cancelled.status, 'CANCELLED');
  assert.deepEqual(
    updates,
    [{ id: jobId, status: 'CANCELLED' }],
    'the cancellation lands even though the removal never settles'
  );
  assert.equal(
    manager.cancelledJobIds.size,
    sizeBefore,
    'FIXED: the marker is released by cancelJob once the cancellation settles, not leaked for the process lifetime'
  );
});
