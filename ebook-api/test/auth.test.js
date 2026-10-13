const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  createAuthMiddleware,
  resolveAuthConfig
} = require('../src/middleware/auth');

const TOKEN = 'test-secret-token';

function startStubServer(authConfig) {
  const app = express();
  app.use(createAuthMiddleware(authConfig));
  app.use('/media', (req, res) => res.json({ served: 'media', path: req.path }));
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api', (req, res) => res.json({ ok: true, path: req.path }));
  const server = app.listen(0, '127.0.0.1');
  return new Promise((resolve) => server.once('listening', () => resolve(server)));
}

test('a configured DUB_ACCESS_TOKEN enables authentication', () => {
  const config = resolveAuthConfig({ DUB_ACCESS_TOKEN: ` ${TOKEN} ` });
  assert.equal(config.enabled, true);
  assert.equal(config.token, TOKEN);
});

test('process refuses to start without a token unless auth is explicitly disabled', () => {
  assert.throws(
    () => resolveAuthConfig({}),
    /DUB_ACCESS_TOKEN is not set/
  );
  assert.deepEqual(resolveAuthConfig({ DUB_AUTH_MODE: 'disabled' }), {
    enabled: false,
    token: ''
  });
});

test('with token configured: missing credentials return 401, health stays 200, valid credentials pass', async (t) => {
  const server = await startStubServer({ enabled: true, token: TOKEN });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const noAuthBooks = await fetch(`${base}/api/books`);
  assert.equal(noAuthBooks.status, 401);
  assert.deepEqual(await noAuthBooks.json(), { error: 'unauthorized' });

  const noAuthMedia = await fetch(`${base}/media/audio/ch1.wav`);
  assert.equal(noAuthMedia.status, 401);

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal(health.ok, true);

  const wrongToken = await fetch(`${base}/api/books`, {
    headers: { Authorization: 'Bearer wrong-token' }
  });
  assert.equal(wrongToken.status, 401);

  const bearer = await fetch(`${base}/api/books`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  assert.equal(bearer.status, 200);
  assert.equal((await bearer.json()).ok, true);

  const queryToken = await fetch(`${base}/media/audio/ch1.wav?access_token=${encodeURIComponent(TOKEN)}`);
  assert.equal(queryToken.status, 200);

  const corsPreflight = await fetch(`${base}/api/books`, { method: 'OPTIONS' });
  assert.notEqual(corsPreflight.status, 401);
});

test('with auth disabled: endpoints are open without credentials', async (t) => {
  const server = await startStubServer({ enabled: false, token: '' });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/books`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});
