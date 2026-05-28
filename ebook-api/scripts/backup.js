require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const storageService = require('../src/services/storage/storageService');
const db = require('../src/repositories/postgres/db');

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
}

async function backupObjects(objectsDir) {
  const objects = await storageService.listObjects('');
  const manifest = [];
  for (const object of objects) {
    const key = object.Key;
    if (!key) continue;
    const target = path.join(objectsDir, key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const buffer = await storageService.getObjectBuffer(key);
    fs.writeFileSync(target, buffer);
    manifest.push({
      key,
      size: object.Size,
      lastModified: object.LastModified
    });
  }
  return manifest;
}

(async () => {
  const outDir = path.resolve(process.argv[2] || path.join(process.cwd(), 'backups', `backup-${timestamp()}`));
  const objectsDir = path.join(outDir, 'objects');
  fs.mkdirSync(objectsDir, { recursive: true });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const databaseDump = path.join(outDir, 'database.dump');
  run('pg_dump', ['--format=custom', '--file', databaseDump, databaseUrl]);

  const objects = await backupObjects(objectsDir);
  const envExample = path.join(__dirname, '../.env.example');
  if (fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, path.join(outDir, 'env.example'));
  }
  const manifest = {
    created_at: new Date().toISOString(),
    app: 'dub2-ebook',
    database: {
      engine: 'postgresql',
      dump: 'database.dump'
    },
    storage: {
      bucket: storageService.bucket,
      object_count: objects.length,
      objects_manifest: 'objects.manifest.json'
    },
    config_template: fs.existsSync(path.join(outDir, 'env.example')) ? 'env.example' : null
  };
  fs.writeFileSync(path.join(outDir, 'objects.manifest.json'), JSON.stringify(objects, null, 2));
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Backup written to ${outDir}`);
})().catch(async (error) => {
  console.error(error);
  await db.close().catch(() => {});
  process.exit(1);
}).finally(async () => {
  await db.close().catch(() => {});
});
