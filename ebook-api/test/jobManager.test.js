const test = require('node:test');
const assert = require('node:assert/strict');
const manager = require('../src/services/jobManager');
const { jobRepository } = require('../src/repositories');

test('worker launch failures become FAILED rather than leaving a pending job', async (t) => {
  const original = { create: jobRepository.create, update: jobRepository.update, add: manager.bree.add, start: manager.bree.start, remove: manager.bree.remove };
  t.after(() => {
    jobRepository.create = original.create;
    jobRepository.update = original.update;
    manager.bree.add = original.add;
    manager.bree.start = original.start;
    manager.bree.remove = original.remove;
  });
  for (const stage of ['add', 'start']) {
    const records = [];
    const updates = [];
    const removed = [];
    jobRepository.create = async (record) => records.push(record);
    jobRepository.update = async (id, patch) => updates.push({ id, ...patch });
    manager.bree.add = async () => { if (stage === 'add') throw new Error('registration failed'); };
    manager.bree.start = async () => { throw new Error('launch failed'); };
    manager.bree.remove = async (name) => removed.push(name);
    await assert.rejects(manager.startJob('test', '1', 'test.js'), /failed/);
    assert.equal(updates[0].id, records[0].id);
    assert.equal(updates[0].status, 'FAILED');
    assert.equal(removed[0], records[0].job_name);
  }
});

test('successful launches and deduplicated tasks preserve their job identity', async (t) => {
  const original = { create: jobRepository.create, find: jobRepository.findActiveByTypeAndTarget, add: manager.bree.add, start: manager.bree.start };
  t.after(() => {
    jobRepository.create = original.create;
    jobRepository.findActiveByTypeAndTarget = original.find;
    manager.bree.add = original.add;
    manager.bree.start = original.start;
  });
  let record;
  let starts = 0;
  jobRepository.create = async (value) => { record = value; };
  manager.bree.add = async () => {};
  manager.bree.start = async () => { starts++; };
  const id = await manager.startJob('test', '1', 'test.js');
  assert.equal(id, record.id);
  jobRepository.findActiveByTypeAndTarget = async () => ({ id });
  assert.equal(await manager.startJob('test', '1', 'test.js', {}, { dedupe: true }), id);
  assert.equal(starts, 1);
});

test('cancelling an active job stops the worker and marks it CANCELLED', async (t) => {
  const original = { find: jobRepository.findById, guardedUpdate: jobRepository.updateUnlessCancelled, remove: manager.bree.remove };
  t.after(() => {
    jobRepository.findById = original.find;
    jobRepository.updateUnlessCancelled = original.guardedUpdate;
    manager.bree.remove = original.remove;
    manager.cancelledJobIds.delete('job-cancel-active');
  });
  const removed = [];
  const updates = [];
  jobRepository.findById = async () => ({ id: 'job-cancel-active', job_name: 'test-job-cancel-active', status: 'RUNNING' });
  jobRepository.updateUnlessCancelled = async (id, patch) => { updates.push({ id, ...patch }); return { id, ...patch }; };
  manager.bree.workers.delete('test-job-cancel-active');
  manager.bree.remove = async (name) => removed.push(name);

  const result = await manager.cancelJob('job-cancel-active');

  assert.equal(result.status, 'CANCELLED');
  assert.deepEqual(removed, ['test-job-cancel-active']);
  assert.deepEqual(updates, [{ id: 'job-cancel-active', status: 'CANCELLED' }]);
});

test('cancelling is idempotent for unknown or terminal jobs', async (t) => {
  const original = { find: jobRepository.findById, remove: manager.bree.remove };
  t.after(() => {
    jobRepository.findById = original.find;
    manager.bree.remove = original.remove;
  });
  let removed = 0;
  manager.bree.remove = async () => { removed += 1; };

  jobRepository.findById = async () => null;
  assert.equal(await manager.cancelJob('missing'), null);

  jobRepository.findById = async () => ({ id: 'job-done', job_name: 'test-job-done', status: 'DONE' });
  const done = await manager.cancelJob('job-done');
  assert.equal(done.status, 'DONE');
  assert.equal(removed, 0);
});

test('a cancel that lands while a PROGRESS write is in flight keeps the job CANCELLED', async (t) => {
  // Reproduces the interleaving the CTO review rejected: the worker sent a
  // PROGRESS whose repository update was already underway when cancelJob
  // committed CANCELLED. The guarded write must lose against the cancel
  // instead of overwriting it back to RUNNING. The stub emulates the database
  // contract implemented by JobRepository.updateUnlessCancelled.
  const jobId = 'job-cancel-race';
  const original = {
    find: jobRepository.findById,
    update: jobRepository.update,
    guardedUpdate: jobRepository.updateUnlessCancelled,
    remove: manager.bree.remove
  };
  t.after(() => {
    jobRepository.findById = original.find;
    jobRepository.update = original.update;
    jobRepository.updateUnlessCancelled = original.guardedUpdate;
    manager.bree.remove = original.remove;
    manager.cancelledJobIds.delete(jobId);
  });

  const dbJob = { id: jobId, job_name: `${jobId}-name`, status: 'RUNNING', progress: 0 };
  const calls = [];
  let releaseInFlightWrite;
  const inFlightGate = new Promise((resolve) => { releaseInFlightWrite = resolve; });

  jobRepository.findById = async () => ({ ...dbJob });
  jobRepository.update = async (id, patch) => {
    calls.push({ via: 'update', patch });
    Object.assign(dbJob, patch);
    return { ...dbJob };
  };
  jobRepository.updateUnlessCancelled = async (id, patch) => {
    calls.push({ via: 'updateUnlessCancelled', patch });
    // Only the stale PROGRESS write is parked in flight. cancelJob's own
    // CANCELLED write must commit immediately, or the test deadlocks on the
    // gate it is supposed to release after cancelJob settles.
    if (patch.progress !== undefined) {
      await inFlightGate;
      if (dbJob.status === 'CANCELLED') return { ...dbJob };
    }
    Object.assign(dbJob, patch);
    return { ...dbJob };
  };
  manager.bree.remove = async () => {};

  const deliver = manager.bree.config.workerMessageHandler;
  const progressWrite = deliver({ name: dbJob.job_name, message: { type: 'PROGRESS', jobId, value: 40 } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [{ via: 'updateUnlessCancelled', patch: { status: 'RUNNING', progress: 40 } }],
    'worker status writes must go through the cancellation guard');

  const cancelled = await manager.cancelJob(jobId);
  assert.equal(cancelled.status, 'CANCELLED');
  releaseInFlightWrite();
  await progressWrite;

  assert.deepEqual(
    { ...dbJob },
    { id: jobId, job_name: dbJob.job_name, status: 'CANCELLED', progress: 0 },
    'an already-dispatched write must not resurrect the cancelled job to RUNNING'
  );
});

test('worker writes sent before the cancel marker was set still cannot overwrite CANCELLED', async (t) => {
  const jobId = 'job-guard-refuses';
  const original = {
    find: jobRepository.findById,
    update: jobRepository.update,
    guardedUpdate: jobRepository.updateUnlessCancelled,
    remove: manager.bree.remove
  };
  t.after(() => {
    jobRepository.findById = original.find;
    jobRepository.update = original.update;
    jobRepository.updateUnlessCancelled = original.guardedUpdate;
    manager.bree.remove = original.remove;
    manager.cancelledJobIds.delete(jobId);
  });

  const dbJob = { id: jobId, job_name: `${jobId}-name`, status: 'RUNNING' };
  jobRepository.findById = async () => ({ ...dbJob });
  jobRepository.update = async (id, patch) => {
    Object.assign(dbJob, patch);
    return { ...dbJob };
  };
  jobRepository.updateUnlessCancelled = async (id, patch) => {
    if (dbJob.status === 'CANCELLED') return { ...dbJob };
    Object.assign(dbJob, patch);
    return { ...dbJob };
  };
  manager.bree.remove = async () => {};
  const deliver = manager.bree.config.workerMessageHandler;

  await manager.cancelJob(jobId);
  await deliver({ name: dbJob.job_name, message: { type: 'PROGRESS', jobId, value: 90 } });
  await deliver({ name: dbJob.job_name, message: { type: 'DONE', jobId, result: {} } });

  assert.equal(dbJob.status, 'CANCELLED', 'the guard refuses every late write for a cancelled job');
});

test('the guarded repository update refuses to overwrite CANCELLED rows', async (t) => {
  // Source-level check for the SQL condition: the WHERE clause must exclude
  // CANCELLED rows from the UPDATE so concurrent in-flight writes lose even
  // when they left the client before the cancel committed.
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(
    path.join(__dirname, '../src/repositories/postgres/repositories.js'),
    'utf8'
  );
  const method = source.split('async updateUnlessCancelled')[1].split('async findAll')[0];
  assert.match(method, /status <> 'CANCELLED'/, 'the guarded UPDATE WHERE clause must exclude CANCELLED rows');
  const managerSource = fs.readFileSync(path.join(__dirname, '../src/services/jobManager.js'), 'utf8');
  assert.equal(
    /await jobRepository\.update\(data\.jobId/.test(managerSource),
    false,
    'worker status writes must not bypass the guarded update'
  );
});

test('cancelJob persists CANCELLED before stopping the worker, even when the stop never settles', async (t) => {
  // The worker only has to outlive the stop attempt once (a busy worker
  // thread that never answers Bree's cancel message) for an unbounded
  // breeze.stop()/remove() chain to hang the caller: the status write must
  // happen first and the request must settle regardless.
  const jobId = 'job-cancel-hang';
  const jobName = `${jobId}-name`;
  const original = {
    find: jobRepository.findById,
    guardedUpdate: jobRepository.updateUnlessCancelled,
    stop: manager.bree.stop,
    remove: manager.bree.remove
  };
  t.after(() => {
    jobRepository.findById = original.find;
    jobRepository.updateUnlessCancelled = original.guardedUpdate;
    manager.bree.stop = original.stop;
    manager.bree.remove = original.remove;
    manager.cancelledJobIds.delete(jobId);
  });

  const order = [];
  jobRepository.findById = async () => ({ id: jobId, job_name: jobName, status: 'RUNNING' });
  jobRepository.updateUnlessCancelled = async () => {
    order.push('persist:CANCELLED');
    return { id: jobId, job_name: jobName, status: 'CANCELLED' };
  };
  manager.bree.stop = () => new Promise(() => {
    // Stubborn worker: the stop promise never resolves or rejects.
    order.push('stop:signalled');
  });
  manager.bree.remove = () => new Promise(() => {
    order.push('remove:signalled');
  });

  const cancelled = await manager.cancelJob(jobId);

  assert.equal(cancelled.status, 'CANCELLED');
  assert.deepEqual(
    order,
    ['persist:CANCELLED', 'stop:signalled', 'remove:signalled'],
    'cancel must not order a worker stop before the CANCELLED persistence'
  );
  assert.equal(manager.cancelledJobIds.has(jobId), false, 'the cancel marker must be released when cancelJob settles');
});
