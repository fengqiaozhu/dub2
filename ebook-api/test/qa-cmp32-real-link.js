// CMP-32 local real-link evidence: ffmpeg concat, PostgreSQL schema init + rw, S3 put/get.
// Run:
//   DATABASE_URL=postgres://ebook:ebook@localhost:5432/cmp32ebook \
//   S3_ENDPOINT=http://localhost:9000 S3_REGION=us-east-1 S3_BUCKET=ebook-cmp32 \
//   S3_ACCESS_KEY_ID=rustfsadmin S3_SECRET_ACCESS_KEY=rustfsadmin S3_FORCE_PATH_STYLE=true \
//   node test/qa-cmp32-real-link.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const results = [];

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return { cmd: `${cmd} ${args.join(' ')}`, status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}

async function ffmpegLink() {
  const ffmpegBinary = require('../src/services/ffmpegBinary');
  const resolved = ffmpegBinary.resolveFfmpegPath();
  console.log(`[ffmpeg] resolved path = ${resolved.path} (source=${resolved.source}, error=${resolved.error})`);
  if (!resolved.path) throw new Error('no ffmpeg binary resolved: ' + resolved.error);
  const ffmpegPath = resolved.path;

  const version = run(ffmpegPath, ['-version']);
  console.log(`[ffmpeg] ${version.cmd}\n         exit=${version.status}\n         first-line=${(version.stdout.split('\n')[0] || '').trim()}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp32-ffmpeg-'));
  const a = path.join(tmp, 'a.wav');
  const b = path.join(tmp, 'b.wav');
  const out = path.join(tmp, 'merged.wav');
  const listPath = path.join(tmp, 'list.txt');

  const genA = run(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ac', '2', '-ar', '44100', a]);
  const genB = run(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', '-ac', '2', '-ar', '44100', b]);
  console.log(`[ffmpeg] generate clips exit=${genA.status}/${genB.status}`);
  if (genA.status !== 0 || genB.status !== 0) throw new Error('failed to generate test clips:\n' + genA.stderr + genB.stderr);

  fs.writeFileSync(listPath, [`file '${a}'`, `file '${b}'`].join('\n'));
  // Same concat invocation shape as exportChapterAudioJob.
  const concat = run(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', out]);
  console.log(`[ffmpeg] concat exit=${concat.status}`);
  if (concat.status !== 0) throw new Error('concat failed:\n' + concat.stderr);

  const size = fs.statSync(out).size;
  const probe = run(ffmpegPath, ['-i', out]);
  const durLine = (probe.stderr.match(/Duration:\s*([0-9:.]+)/) || [])[1] || 'unknown';
  console.log(`[ffmpeg] merged.wav size=${size} bytes duration=${durLine} (exit=${probe.status})`);
  if (size <= 0) throw new Error('merged output empty');
  fs.rmSync(tmp, { recursive: true, force: true });
  results.push({ link: 'ffmpeg', ok: true, binary: ffmpegPath, source: resolved.source, version: (version.stdout.split('\n')[0] || '').trim(), concatExit: concat.status, outputBytes: size });
}

async function postgresLink() {
  const { initSchema } = require('../src/repositories/postgres/schema');
  const db = require('../src/repositories/postgres/db');
  await initSchema();
  console.log('[pg] schema init OK');
  const title = `cmp32-real-link-${Date.now()}`;
  const ins = await db.query('INSERT INTO books (title, format) VALUES ($1, $2) RETURNING id', [title, 'txt']);
  const id = ins.rows[0].id;
  const sel = await db.query('SELECT id, title, format FROM books WHERE id = $1', [id]);
  const upd = await db.query('UPDATE books SET author = $2 WHERE id = $1 RETURNING author', [id, 'cmp32-author']);
  const del = await db.query('DELETE FROM books WHERE id = $1', [id]);
  const after = await db.query('SELECT id FROM books WHERE id = $1', [id]);
  console.log(`[pg] insert id=${id} -> select title=${sel.rows[0].title} -> update author=${upd.rows[0].author} -> delete rowCount=${del.rowCount}, rowsAfter=${after.rows.length}`);
  if (sel.rows[0].title !== title) throw new Error('read-back mismatch');
  if (after.rows.length !== 0) throw new Error('delete failed');
  await db.close();
  results.push({ link: 'postgres', ok: true, insertId: id, deleted: true });
}

async function s3Link() {
  const storageService = require('../src/services/storage/storageService');
  const key = `cmp32/real-link/${Date.now()}-probe.bin`;
  const payload = crypto.randomBytes(2048);
  const put = await storageService.putObject(key, payload, { contentType: 'application/octet-stream', record: false });
  const got = await storageService.getObjectBuffer(key);
  const match = Buffer.compare(payload, got) === 0;
  console.log(`[s3] bucket=${storageService.bucket} key=${key} putBytes=${put.size} getBytes=${got.length} match=${match} sha256=${put.sha256}`);
  if (!match) throw new Error('s3 roundtrip mismatch');
  results.push({ link: 's3', ok: true, bucket: storageService.bucket, key, bytes: got.length, sha256: put.sha256 });
}

(async () => {
  try {
    await ffmpegLink();
  } catch (e) { console.error('[ffmpeg] FAILED:', e.message); results.push({ link: 'ffmpeg', ok: false, error: e.message }); }
  try {
    await postgresLink();
  } catch (e) { console.error('[pg] FAILED:', e.message); results.push({ link: 'postgres', ok: false, error: e.message }); }
  try {
    await s3Link();
  } catch (e) { console.error('[s3] FAILED:', e.message); results.push({ link: 's3', ok: false, error: e.message }); }

  console.log('\n=== CMP-32 REAL-LINK SUMMARY ===');
  for (const r of results) console.log(JSON.stringify(r));
  const allOk = results.length === 3 && results.every((r) => r.ok);
  process.exit(allOk ? 0 : 2);
})();
