// CMP-32 independent verification of fix #3: authentication / access control.
// Run with: DATABASE_URL=postgres://ebook:ebook@localhost:5432/cmp32ebook node --test test/qa-cmp32-auth.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const { createApp } = require('../src/app');
const { resolveAuthConfig } = require('../src/middleware/auth');

const TOKEN = 'cmp32-access-token-xyz';

function listen(app, host = '127.0.0.1') {
  const server = app.listen(0, host);
  return new Promise((resolve) => server.once('listening', () => resolve(server)));
}

test('#3 startup refuses to run without DUB_ACCESS_TOKEN unless explicitly disabled', () => {
  assert.throws(() => resolveAuthConfig({}), /DUB_ACCESS_TOKEN is not set/);
  assert.throws(() => resolveAuthConfig({ DUB_AUTH_MODE: 'enabled' }), /DUB_ACCESS_TOKEN is not set/);
  assert.deepEqual(resolveAuthConfig({ DUB_AUTH_MODE: 'disabled' }), { enabled: false, token: '' });
  assert.deepEqual(resolveAuthConfig({ DUB_ACCESS_TOKEN: ` ${TOKEN} ` }), { enabled: true, token: TOKEN });
  // token wins even when disabled is also present
  assert.deepEqual(resolveAuthConfig({ DUB_ACCESS_TOKEN: TOKEN, DUB_AUTH_MODE: 'disabled' }), { enabled: true, token: TOKEN });
});

test('#3 with DUB_ACCESS_TOKEN: /api/books + /media/* need creds, /api/health is open, valid creds pass', async (t) => {
  const app = createApp({ enabled: true, token: TOKEN });
  const server = await listen(app);
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const health = await fetch(`${base}/api/health`);
  assert.notEqual(health.status, 401, 'health must never require credentials');
  if (process.env.DATABASE_URL && process.env.S3_ENDPOINT) {
    assert.equal(health.status, 200, 'with Postgres+S3 reachable health must be 200');
  }

  const booksNoAuth = await fetch(`${base}/api/books`);
  assert.equal(booksNoAuth.status, 401);
  assert.deepEqual(await booksNoAuth.json(), { error: 'unauthorized' });

  const mediaNoAuth = await fetch(`${base}/media/audio/whatever.wav`);
  assert.equal(mediaNoAuth.status, 401);

  const mediaQueryNoAuth = await fetch(`${base}/media/audio/whatever.wav?access_token=wrong`);
  assert.equal(mediaQueryNoAuth.status, 401);

  const booksBearer = await fetch(`${base}/api/books`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.notEqual(booksBearer.status, 401, 'valid bearer must not be rejected');
  if (process.env.DATABASE_URL) {
    assert.equal(booksBearer.status, 200, 'with DB, authorized /api/books should be 200');
  }

  const booksWrong = await fetch(`${base}/api/books`, { headers: { Authorization: 'Bearer nope' } });
  assert.equal(booksWrong.status, 401);

  const mediaQuery = await fetch(`${base}/media/audio/whatever.wav?access_token=${encodeURIComponent(TOKEN)}`);
  assert.notEqual(mediaQuery.status, 401, 'valid query token must not be rejected (404 file is acceptable)');

  const preflight = await fetch(`${base}/api/books`, { method: 'OPTIONS' });
  assert.notEqual(preflight.status, 401, 'CORS preflight must not require a token');
});

test('#3 with auth disabled: /api/books is reachable without credentials', async (t) => {
  const app = createApp({ enabled: false, token: '' });
  const server = await listen(app);
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/api/books`);
  assert.notEqual(res.status, 401, 'disabled mode must not require credentials');
  if (process.env.DATABASE_URL) {
    assert.equal(res.status, 200);
  }
});

test('#3 real index.js refuses to start when no token and not disabled (exit 1)', async () => {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DATABASE_URL: process.env.DATABASE_URL || 'postgres://ebook:ebook@localhost:5432/cmp32ebook'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(code, 1, 'index.js should exit 1. stderr=' + stderr);
  assert.match(stderr, /Refusing to start/);
});

test('#3 real index.js starts with DUB_AUTH_MODE=disabled and logs the warning', async () => {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PORT: '0',
      DUB_AUTH_MODE: 'disabled',
      DATABASE_URL: process.env.DATABASE_URL || 'postgres://ebook:ebook@localhost:5432/cmp32ebook',
      S3_ENDPOINT: process.env.S3_ENDPOINT || 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'ebook',
      S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || 'rustfsadmin',
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || 'rustfsadmin',
      S3_FORCE_PATH_STYLE: 'true'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });

  const started = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 15000);
    const check = () => {
      if (/AUTHENTICATION IS DISABLED/.test(out) && /running at/.test(out)) {
        clearTimeout(timer);
        resolve(true);
      }
    };
    child.stdout.on('data', check);
    child.stderr.on('data', check);
  });

  child.kill('SIGKILL');
  await new Promise((resolve) => child.on('exit', resolve));
  assert.ok(started, 'expected disabled-mode warning + running banner. output:\n' + out);
  assert.match(out, /AUTHENTICATION IS DISABLED/);
});
