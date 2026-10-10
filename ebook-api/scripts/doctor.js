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

async function collectReferencedKeys(database = db, parser = keyFromMediaUrl) {
  const keys = new Set();
  for (const [table, column] of mediaColumns) {
    const rows = await database.many(`SELECT id, ${column} AS url FROM ${table} WHERE ${column} IS NOT NULL`);
    for (const row of rows) {
      const key = parser(row.url);
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

async function inspectStorageHealth({
  database = db,
  storage = storageService,
  storageRepo = storageObjectRepository,
  parser = keyFromMediaUrl
} = {}) {
  const referencedKeys = await collectReferencedKeys(database, parser);
  const storageRows = await storageRepo.findAll();
  const storageKeys = new Set(storageRows.map((row) => row.object_key));
  const missing = [];
  const untracked = [];

  for (const key of referencedKeys) {
    const head = await storage.headObject(key);
    if (!head) missing.push(key);
    if (!storageKeys.has(key)) untracked.push(key);
  }

  return {
    referenced: referencedKeys.size,
    storage_records: storageRows.length,
    missing_objects: missing,
    untracked_references: untracked,
    ok: missing.length === 0 && untracked.length === 0
  };
}

if (require.main === module) {
  (async () => {
    const ffmpeg = checkFfmpeg();
    const storageHealth = await inspectStorageHealth();
    const result = {
      ffmpeg,
      referenced: storageHealth.referenced,
      storage_records: storageHealth.storage_records,
      missing_objects: storageHealth.missing_objects,
      untracked_references: storageHealth.untracked_references,
      ok: storageHealth.ok && ffmpeg.ok
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
}

module.exports = {
  mediaColumns,
  collectReferencedKeys,
  inspectStorageHealth
};
