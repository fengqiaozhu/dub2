const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jobManager = require('../src/services/jobManager');
const jobRoutes = require('../src/routes/jobs');

test('HTTP cancel route supports POST and DELETE and reports missing jobs', async (t) => {
  const original = jobManager.cancelJob;
  const calls = [];
  jobManager.cancelJob = async (id) => { calls.push(id); return { id, status: 'CANCELLED' }; };

  const app = express();
  app.use('/api/jobs', jobRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  t.after(async () => {
    jobManager.cancelJob = original;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const base = `http://127.0.0.1:${server.address().port}/api/jobs/abc/cancel`;
  for (const method of ['POST', 'DELETE']) {
    const response = await fetch(base, { method });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.status, 'CANCELLED');
  }
  assert.deepEqual(calls, ['abc', 'abc']);

  jobManager.cancelJob = async () => null;
  const missing = await fetch(base, { method: 'POST' });
  assert.equal(missing.status, 404);
});
