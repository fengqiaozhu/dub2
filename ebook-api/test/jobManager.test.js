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
  const original = { find: jobRepository.findById, update: jobRepository.update, remove: manager.bree.remove };
  t.after(() => {
    jobRepository.findById = original.find;
    jobRepository.update = original.update;
    manager.bree.remove = original.remove;
    manager.cancelledJobIds.delete('job-cancel-active');
  });
  const removed = [];
  const updates = [];
  jobRepository.findById = async () => ({ id: 'job-cancel-active', job_name: 'test-job-cancel-active', status: 'RUNNING' });
  jobRepository.update = async (id, patch) => { updates.push({ id, ...patch }); return { id, ...patch }; };
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
