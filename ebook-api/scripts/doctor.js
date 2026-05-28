require('dotenv').config();

const db = require('../src/repositories/postgres/db');
const storageService = require('../src/services/storage/storageService');
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

(async () => {
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
    referenced: referencedKeys.size,
    storage_records: storageRows.length,
    missing_objects: missing,
    untracked_references: untracked,
    ok: missing.length === 0 && untracked.length === 0
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
