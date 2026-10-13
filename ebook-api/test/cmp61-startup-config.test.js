const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { createApp } = require('../src/app');
const { resolveAuthConfig } = require('../src/middleware/auth');
const ffmpegBinary = require('../src/services/ffmpegBinary');

const TOKEN = 'cmp61-independent-token';
const repoRoot = path.resolve(__dirname, '../..');

function startApp(authConfig) {
  const app = createApp(authConfig);
  const server = app.listen(0, '127.0.0.1');
  return new Promise((resolve) => server.once('listening', () => resolve(server)));
}

test('examples list the new startup options', () => {
  const rootExample = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
  const apiExample = fs.readFileSync(path.join(repoRoot, 'ebook-api/.env.example'), 'utf8');
  for (const text of [rootExample, apiExample]) {
    assert.match(text, /DUB_ACCESS_TOKEN=/);
    assert.match(text, /DUB_AUTH_MODE=disabled/);
    assert.match(text, /EXPORT_PROFILE=/);
    assert.match(text, /FFMPEG_PATH=/);
    assert.match(text, /Fail-closed|refuses to start|拒绝启动/i);
    assert.doesNotMatch(text, /^DUB_AUTH_MODE=disabled\s*$/m);
    assert.doesNotMatch(text, /DUB_ACCESS_TOKEN=\S+/);
  }
});

test('compose passes user-selected auth, export and ffmpeg values without disabling auth by default', () => {
  const compose = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
  assert.match(compose, /DUB_ACCESS_TOKEN: \$\{DUB_ACCESS_TOKEN:-\}/);
  assert.match(compose, /DUB_AUTH_MODE: \$\{DUB_AUTH_MODE:-\}/);
  assert.match(compose, /EXPORT_PROFILE: \$\{EXPORT_PROFILE:-\}/);
  assert.match(compose, /FFMPEG_PATH: \$\{FFMPEG_PATH:-\}/);
  assert.doesNotMatch(compose, /DUB_AUTH_MODE:.*disabled/);
  assert.doesNotMatch(compose, /DUB_ACCESS_TOKEN: (?!\$\{DUB_ACCESS_TOKEN:-\})\S+/);
});

test('unconfigured auth refuses to start with configuration guidance', () => {
  assert.throws(
    () => resolveAuthConfig({}),
    /DUB_ACCESS_TOKEN is not set[\s\S]*DUB_AUTH_MODE=disabled/
  );
  assert.throws(
    () => resolveAuthConfig({ DUB_ACCESS_TOKEN: '  ', DUB_AUTH_MODE: '' }),
    /DUB_ACCESS_TOKEN is not set/
  );
});

test('token mode enables auth; explicit disabled is the only open-access path', () => {
  assert.deepEqual(resolveAuthConfig({ DUB_ACCESS_TOKEN: ` ${TOKEN} ` }), {
    enabled: true,
    token: TOKEN
  });
  assert.deepEqual(resolveAuthConfig({ DUB_AUTH_MODE: 'disabled' }), {
    enabled: false,
    token: ''
  });
  assert.equal(
    resolveAuthConfig({ DUB_ACCESS_TOKEN: TOKEN, DUB_AUTH_MODE: 'disabled' }).enabled,
    true,
    'a configured token keeps auth on even if disabled is also set'
  );
});

test('token mode: health is public, books and media require the token', async (t) => {
  const server = await startApp({ enabled: true, token: TOKEN });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const health = await fetch(`${base}/api/health`);
  assert.notEqual(health.status, 401, 'health must stay reachable without a token');

  const noToken = await fetch(`${base}/api/books`);
  assert.equal(noToken.status, 401);

  const bearer = await fetch(`${base}/api/books`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  assert.notEqual(bearer.status, 401);

  const query = await fetch(`${base}/media/example.mp3?access_token=${encodeURIComponent(TOKEN)}`);
  assert.notEqual(query.status, 401);
});

test('explicit disabled: books are reachable without a token', async (t) => {
  const server = await startApp({ enabled: false, token: '' });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/books`);
  assert.notEqual(response.status, 401);
});

test('illegal FFMPEG_PATH fails fast and does not fall back', () => {
  const missing = path.join(os.tmpdir(), 'cmp61-missing-ffmpeg');
  const resolved = ffmpegBinary.resolveFfmpegPath({
    env: { FFMPEG_PATH: missing, PATH: os.tmpdir() }
  });
  assert.equal(resolved.path, null);
  assert.equal(resolved.source, 'FFMPEG_PATH');
  assert.match(resolved.error, /FFMPEG_PATH/);
  assert.match(resolved.error, /不存在或不可执行/);
});

function spawnIndex(extraEnv) {
  return spawn(process.execPath, ['index.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PORT: '0',
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function collectOutput(child) {
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk.toString(); });
  child.stderr.on('data', (chunk) => { out += chunk.toString(); });
  return {
    get text() { return out; },
    waitFor(pattern, timeoutMs) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), timeoutMs);
        const check = () => {
          if (pattern.test(out)) {
            clearTimeout(timer);
            resolve(true);
          }
        };
        child.stdout.on('data', check);
        child.stderr.on('data', check);
        check();
      });
    }
  };
}

test('real index.js refuses to start when auth is unconfigured', async () => {
  const child = spawnIndex({});
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(code, 1);
  assert.match(stderr, /Refusing to start: DUB_ACCESS_TOKEN is not set/);
  assert.match(stderr, /DUB_AUTH_MODE=disabled/);
});

test('real index.js accepts a configured token before database init', async () => {
  const child = spawnIndex({ DUB_ACCESS_TOKEN: TOKEN });
  const output = collectOutput(child);
  const seen = await output.waitFor(/Authentication enabled/, 8000);
  child.kill('SIGKILL');
  await new Promise((resolve) => child.on('exit', resolve));
  assert.ok(seen, output.text);
});

test('real index.js accepts explicit DUB_AUTH_MODE=disabled before database init', async () => {
  const child = spawnIndex({ DUB_AUTH_MODE: 'disabled' });
  const output = collectOutput(child);
  const seen = await output.waitFor(/AUTHENTICATION IS DISABLED/, 8000);
  child.kill('SIGKILL');
  await new Promise((resolve) => child.on('exit', resolve));
  assert.ok(seen, output.text);
});
