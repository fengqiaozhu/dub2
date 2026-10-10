const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ffmpegBinary = require('../src/services/ffmpegBinary');

function makeExecutableFile(dir, name, mode = 0o755) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(filePath, mode);
  return filePath;
}

function fakeStaticLoader(staticPath) {
  return () => {
    if (staticPath === null) {
      throw new Error("Cannot find module 'ffmpeg-static'");
    }
    return staticPath;
  };
}

test('FFMPEG_PATH wins when it points at an executable file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpegbin-'));
  try {
    const bin = makeExecutableFile(dir, 'ffmpeg');
    const resolved = ffmpegBinary.resolveFfmpegPath({ env: { FFMPEG_PATH: bin } });
    assert.equal(resolved.path, bin);
    assert.equal(resolved.source, 'FFMPEG_PATH');
    assert.equal(resolved.error, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a broken FFMPEG_PATH fails fast instead of silently falling back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpegbin-'));
  try {
    const usable = makeExecutableFile(dir, 'ffmpeg');
    const resolved = ffmpegBinary.resolveFfmpegPath({
      env: { FFMPEG_PATH: path.join(dir, 'missing'), PATH: dir },
      loadFfmpegStatic: fakeStaticLoader(usable)
    });
    assert.equal(resolved.path, null);
    assert.match(resolved.error, /FFMPEG_PATH/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('uses the ffmpeg-static binary when it exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpegbin-'));
  try {
    const bin = makeExecutableFile(dir, 'ffmpeg');
    const resolved = ffmpegBinary.resolveFfmpegPath({
      env: {},
      loadFfmpegStatic: fakeStaticLoader(bin)
    });
    assert.equal(resolved.path, bin);
    assert.equal(resolved.source, 'ffmpeg-static');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to system PATH when ffmpeg-static has no binary (npm ci --ignore-scripts)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpegbin-'));
  try {
    const bin = makeExecutableFile(dir, 'ffmpeg');
    const resolved = ffmpegBinary.resolveFfmpegPath({
      env: { PATH: dir },
      loadFfmpegStatic: fakeStaticLoader(path.join(dir, 'no-such-ffmpeg'))
    });
    assert.equal(resolved.path, bin);
    assert.equal(resolved.source, 'system');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('also falls back to system PATH when the ffmpeg-static package is absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpegbin-'));
  try {
    const bin = makeExecutableFile(dir, 'ffmpeg');
    const resolved = ffmpegBinary.resolveFfmpegPath({
      env: { PATH: dir },
      loadFfmpegStatic: fakeStaticLoader(null)
    });
    assert.equal(resolved.path, bin);
    assert.equal(resolved.source, 'system');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reports null with an explanatory error when nothing is available', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpegbin-'));
  try {
    const resolved = ffmpegBinary.resolveFfmpegPath({
      env: { PATH: dir },
      loadFfmpegStatic: fakeStaticLoader(path.join(dir, 'no-such-ffmpeg'))
    });
    assert.equal(resolved.path, null);
    assert.match(resolved.error, /ffmpeg-static/);
    assert.match(resolved.error, /FFMPEG_PATH/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isUsableFile rejects directories, missing files and empty values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpegbin-'));
  try {
    assert.equal(ffmpegBinary.isUsableFile(''), false);
    assert.equal(ffmpegBinary.isUsableFile(null), false);
    assert.equal(ffmpegBinary.isUsableFile(path.join(dir, 'missing')), false);
    assert.equal(ffmpegBinary.isUsableFile(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('environment gate: a usable ffmpeg binary must exist here (anti-regression for export jobs)', () => {
  const resolved = ffmpegBinary.resolveFfmpegPath();
  assert.ok(resolved.path, `no usable ffmpeg in this environment: ${resolved.error}`);
  const probe = spawnSync(resolved.path, ['-version'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(probe.status, 0, `resolved ffmpeg ${resolved.path} failed to run: ${probe.error}`);
  assert.match(String(probe.stdout), /ffmpeg version/);
});

test('export job resolves ffmpeg through the shared resolver and gates before running it', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/jobs/exportChapterAudioJob.js'), 'utf8');
  assert.match(src, /require\('\.\.\/services\/ffmpegBinary'\)/);
  assert.match(src, /resolveFfmpegOrFail\(\)/);
  const resolution = src.indexOf('resolveFfmpegOrFail()');
  const firstRun = src.indexOf('runFfmpeg(');
  assert.ok(resolution !== -1 && firstRun !== -1, 'resolver call and ffmpeg invocation must both exist');
  assert.ok(resolution < firstRun, 'ffmpeg must be resolved before the concat is started');
});

test('doctor reports ffmpeg availability as part of its verdict', () => {
  const src = fs.readFileSync(path.join(__dirname, '../scripts/doctor.js'), 'utf8');
  assert.match(src, /ffmpegBinary\.resolveFfmpegPath\(\)/);
  assert.match(src, /ok: missing\.length === 0 && untracked\.length === 0 && ffmpeg\.ok/);
});
