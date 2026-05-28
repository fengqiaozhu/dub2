require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const storageService = require('../src/services/storage/storageService');
const db = require('../src/repositories/postgres/db');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
}

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

(async () => {
  const backupDir = path.resolve(process.argv[2] || '');
  if (!backupDir || !fs.existsSync(backupDir)) {
    throw new Error('Usage: npm run restore -- /path/to/backup-dir');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const databaseDump = path.join(backupDir, 'database.dump');
  if (!fs.existsSync(databaseDump)) throw new Error('database.dump not found');

  run('pg_restore', ['--clean', '--if-exists', '--no-owner', '--dbname', databaseUrl, databaseDump]);

  await storageService.ensureBucket();
  const objectsDir = path.join(backupDir, 'objects');
  if (fs.existsSync(objectsDir)) {
    for (const file of walk(objectsDir)) {
      const key = path.relative(objectsDir, file).split(path.sep).join('/');
      await storageService.putObject(key, fs.readFileSync(file), {
        contentType: 'application/octet-stream',
        record: false
      });
    }
  }
  console.log(`Restore completed from ${backupDir}`);
})().catch(async (error) => {
  console.error(error);
  await db.close().catch(() => {});
  process.exit(1);
}).finally(async () => {
  await db.close().catch(() => {});
});
