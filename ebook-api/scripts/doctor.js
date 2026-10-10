require('dotenv').config();

const { spawnSync } = require('child_process');
const db = require('../src/repositories/postgres/db');
const storageService = require('../src/services/storage/storageService');
const ffmpegBinary = require('../src/services/ffmpegBinary');
const { storageObjectRepository } = require('../src/repositories');
const { keyFromMediaUrl } = require('../src/services/storage/keyBuilder');

const mediaColumns = [
  ['books', 'cover_url'],
  ['dialogues', 'audio_url'],
  ['voice_profiles', 'sample_audio_url'],
  ['chapter_audio_exports', 'audio_url']
];

async function collectReferencedKeys() {
  const keys = new Set();
  for (const [table, column] of mediaColumns) {
    const rows = await db.many(`SELECT id, ${column} AS url FROM ${table} WHERE ${column} IS NOT NULL`);
    for (const row of rows) {
      const key = keyFromMediaUrl(row.url);
      if (key) keys.add(key);
    }
  }
  return keys;
}

function checkFfmpeg() {
  const resolved = ffmpegBinary.resolveFfmpegPath();
  const check = {
    path: resolved.path,
    source: resolved.source,
    version: null,
    ok: false,
    error: resolved.error
  };
  if (resolved.path) {
    const probe = spawnSync(resolved.path, ['-version'], { encoding: 'utf8', timeout: 10000 });
    if (probe.status === 0) {
      check.ok = true;
      check.version = String(probe.stdout || '').split('\n')[0] || null;
    } else {
      check.error = `ffmpeg ${resolved.path} 无法执行（exit=${probe.status}）${probe.error ? `：${probe.error.message}` : ''}`;
    }
  }
  return check;
}

(async () => {
  const ffmpeg = checkFfmpeg();
  const referencedKeys = await collectReferencedKeys();
  const storageRows = await storageObjectRepository.findAll();
  const storageKeys = new Set(storageRows.map((row) => row.object_key));
  const missing = [];
  const untracked = [];

  for (const key of referencedKeys) {
    const head = await storageService.headObject(key);
    if (!head) missing.push(key);
    if (!storageKeys.has(key)) untracked.push(key);
  }

  const result = {
    ffmpeg,
    referenced: referencedKeys.size,
    storage_records: storageRows.length,
    missing_objects: missing,
    untracked_references: untracked,
    ok: missing.length === 0 && untracked.length === 0 && ffmpeg.ok
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
})().catch(async (error) => {
  console.error(error);
  await db.close().catch(() => {});
  process.exit(1);
}).finally(async () => {
  await db.close().catch(() => {});
});
