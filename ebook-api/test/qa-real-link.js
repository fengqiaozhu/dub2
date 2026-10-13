/**
 * QA harness (not a *.test.js, so it is NOT picked up by `npm test`).
 *
 * Verifies the REAL local data links required by CMP-28 / CEO scope decision:
 *   1. PostgreSQL: real schema init + real read/write through product repositories.
 *   2. Object storage: real S3 PutObject + GetObject through the product storageService.
 *   3. ffmpeg: runs the REAL src/jobs/exportChapterAudioJob.js worker (readiness gate +
 *      S3 download + concat + S3 upload) with only repositories/dubbingPlanner/ffmpeg-path
 *      substituted. No TTS/LLM provider is ever contacted.
 *
 * Run:
 *   DATABASE_URL=postgres://ebook:ebook@127.0.0.1:5432/ebook \
 *   S3_ENDPOINT=http://127.0.0.1:9000 S3_ACCESS_KEY_ID=rustfsadmin \
 *   S3_SECRET_ACCESS_KEY=rustfsadmin S3_FORCE_PATH_STYLE=true S3_BUCKET=ebook \
 *   node test/qa-real-link.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { spawnSync } = require('child_process');

const API_ROOT = path.resolve(__dirname, '..');
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} :: ${name} :: ${detail}`);
}

// Informational finding: does not move the harness exit code.
function info(name, detail) {
  console.log(`INFO :: ${name} :: ${detail}`);
}

async function main() {
  // ---------------------------------------------------------------- ffmpeg binary
  const ffmpegStaticPath = require('ffmpeg-static');
  const staticExists = fs.existsSync(ffmpegStaticPath);
  const systemFfmpeg = spawnSync('/usr/bin/ffmpeg', ['-version'], { encoding: 'utf8' });
  const versionLine = (systemFfmpeg.stdout || '').split('\n')[0] || '';
  record(
    'ffmpeg/binary-resolution',
    true,
    `ffmpeg-static resolves to ${ffmpegStaticPath}; exists=${staticExists}. ` +
    `system /usr/bin/ffmpeg usable=${systemFfmpeg.status === 0}; "${versionLine}"`
  );
  if (!staticExists) {
    info(
      'ffmpeg/finding',
      (staticExists
        ? 'ffmpeg-static binary present; resolver should pick it. '
        : 'ffmpeg-static still has NO binary (the npm ci --ignore-scripts condition). ') +
      'This run does NOT stub ffmpeg: the product resolver (src/services/ffmpegBinary.js) must ' +
      'find a usable binary on its own.'
    );
  }

  // ---------------------------------------------------------------- 1. postgres
  const db = require(path.join(API_ROOT, 'src/repositories/postgres/db'));
  const { bookRepository, chapterRepository, storageObjectRepository } = require(
    path.join(API_ROOT, 'src/repositories')
  );

  const slug = `qa-real-link-${Date.now()}`;
  const bookId = await bookRepository.create({
    title: `CMP-28 QA book ${slug}`,
    format: 'txt',
    author: 'qa-harness',
    status: 'draft'
  });
  const fetched = await bookRepository.findById(bookId);
  const listed = await bookRepository.findAll({ q: slug });
  assert.ok(fetched && String(fetched.id) === String(bookId), 'book read-back mismatch');
  assert.ok(
    (listed || []).some((b) => String(b.id) === String(bookId)),
    'created book missing from findAll'
  );
  record(
    'postgres/read-write',
    true,
    `INSERT books id=${bookId} -> findById ok -> findAll(q) contains it; ` +
    `title="${fetched.title}" format=${fetched.format} status=${fetched.status}`
  );

  const chapterId = await chapterRepository.create({
    book_id: bookId,
    title: 'chapter 1',
    chapter_index: 1,
    content: 'first line here'
  });
  record(
    'postgres/chapter-write',
    Boolean(chapterId),
    `INSERT chapters id=${chapterId} book_id=${bookId}; row now visible: ` +
    `${Boolean(await chapterRepository.findById(chapterId))}`
  );

  // ---------------------------------------------------------------- 2. S3 put/get
  const storageService = require(path.join(API_ROOT, 'src/services/storage/storageService'));
  await storageService.ensureBucket();
  const putKey = `qa/cmp28/${slug}/probe.bin`;
  const payload = Buffer.from(`cmp28-s3-probe-${slug}-${'x'.repeat(1024)}`);
  const putResult = await storageService.putObject(putKey, payload, {
    contentType: 'application/octet-stream',
    entityType: 'qa_probe',
    entityId: String(bookId)
  });
  const got = await storageService.getObjectBuffer(putKey);
  const byteEqual = Buffer.compare(payload, got) === 0;
  const head = await storageService.headObject(putKey);
  const storedRow = await storageObjectRepository.findByKey(putKey);
  record(
    's3/put-get-roundtrip',
    byteEqual && Boolean(head),
    `put size=${putResult.size} sha256=${putResult.sha256.slice(0, 16)}...; ` +
    `get bytes=${got.length} byteEqual=${byteEqual}; head ContentLength=${head && head.ContentLength}; ` +
    `storage_objects row=${storedRow ? `sha256=${String(storedRow.sha256).slice(0, 16)}...` : 'MISSING'}`
  );

  // ---------------------------------------------------------------- 3. real export job
  const ffmpegArgsOverride = process.env.QA_FFMPEG_PATH || '/usr/bin/ffmpeg';  // used only to synthesise input segments
  const exportJobPath = path.join(API_ROOT, 'src/jobs/exportChapterAudioJob.js');

  // Build 3 real wav segments with the system ffmpeg and push them into S3, so the job
  // downloads REAL objects from REAL object storage before concatenating.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp28-reallink-'));
  const segments = [
    { freq: 440, dur: 1 },
    { freq: 660, dur: 2 },
    { freq: 880, dur: 0.5 }
  ];
  const segmentKeys = [];
  for (let i = 0; i < segments.length; i += 1) {
    const file = path.join(tmp, `seg${i + 1}.wav`);
    const gen = spawnSync(
      ffmpegArgsOverride,
      ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
        '-i', `sine=frequency=${segments[i].freq}:duration=${segments[i].dur}`,
        '-ac', '1', '-ar', '8000', file],
      { encoding: 'utf8' }
    );
    assert.strictEqual(gen.status, 0, `segment ${i} ffmpeg failed: ${gen.stderr}`);
    const key = `qa/cmp28/${slug}/seg${i + 1}.wav`;
    await storageService.putObject(key, fs.readFileSync(file), {
      contentType: 'audio/wav',
      entityType: 'qa_segment'
    });
    segmentKeys.push({ key, freq: segments[i].freq, dur: segments[i].dur });
  }
  record('s3/segment-upload', true, `uploaded ${segmentKeys.length} real wav segments to S3`);

  // Bootstrap: substitute ONLY the repositories, dubbingPlanner and ffmpeg binary path.
const workerBootstrap = path.join(tmp, 'bootstrap.js');
fs.writeFileSync(workerBootstrap, `
const path = require('path');
const fs = require('fs');
const Module = require('module');
const TRACE = ${JSON.stringify(path.join(tmp, 'trace.log'))};
function trace(msg) { fs.appendFileSync(TRACE, msg + String.fromCharCode(10), { flag: 'a' }); }
const API_ROOT = ${JSON.stringify(API_ROOT)};
const EXPORT_JOB = ${JSON.stringify(exportJobPath)};
const FFMPEG = ${JSON.stringify(ffmpegArgsOverride)};
const SEGMENT_KEYS = ${JSON.stringify(segmentKeys.map((s) => s.key))};
const { keyFromMediaUrl, mediaUrlForKey } = require(path.join(API_ROOT, 'src/services/storage/keyBuilder'));

const chapter = { id: 4242, book_id: 77, title: 'chapter 1', order_index: 1, content: '' };
const dialogues = SEGMENT_KEYS.map((key, i) => ({
  id: i + 1,
  chapter_id: 4242,
  character_name: 'role' + (i + 1),
  content: 'line ' + (i + 1),
  char_start: i * 5,
  char_end: i * 5 + 5,
  order_index: i,
  source: 'dialogue',
  audio_url: mediaUrlForKey(key),
  audio_source_hash: 'UNSET'
}));

// Two-pass hash fix: buildChapterAudioItems computes the source hash from the dialogue
// + route. Reuse the product's own hash so every item lands on 'current'.
const chapterAudioState = require(path.join(API_ROOT, 'src/services/chapterAudioState'));
const routes = { 1: { provider: 'qa', providerConfigId: 1, model: 'qa', voiceId: 'qa' },
                2: { provider: 'qa', providerConfigId: 1, model: 'qa', voiceId: 'qa' },
                3: { provider: 'qa', providerConfigId: 1, model: 'qa', voiceId: 'qa' } };
const BREAK_MODE = process.env.QA_EXPORT_BREAK_MODE || '';
dialogues.forEach((d) => {
  d.audio_source_hash = chapterAudioState.computeDialogueAudioHash(d, routes[d.id]);
});
if (BREAK_MODE === 'missing') {
  dialogues[1].audio_url = null;
  dialogues[1].audio_source_hash = null;
}

const repoStub = {
  chapterRepository: { findById: async () => chapter },
  dialogueRepository: { findByChapterId: async () => dialogues },
  chapterAudioSkipRangeRepository: { findByChapterId: async () => [] },
  chapterAudioExportRepository: { create: async (row) => { global.__exportRow = row; return row; } },
  storageObjectRepository: require(path.join(API_ROOT, 'src/repositories')).storageObjectRepository
};

function stub(stubPath) {
  if (stubPath === 'repositories') {
    const orig = Module._load;
    Module._load = function (req, parent, isMain) {
      trace('LOAD ' + req + ' parent=' + (parent && parent.filename));
      if (req === '../repositories' && parent && parent.filename === EXPORT_JOB) {
        trace('STUB-HIT repositories');
        return repoStub;
      }
      return orig.apply(this, arguments);
    };
  }
  if (stubPath === 'dubbingPlanner') {
    const orig = Module._load;
    Module._load = function (req, parent, isMain) {
      if (req === '../services/tts/dubbingPlanner' && parent && parent.filename === EXPORT_JOB) {
        return { createPlan: async () => ({ tasks: Object.keys(routes).map((id) => ({ dialogueId: Number(id), ...routes[id] })) }) };
      }
      return orig.apply(this, arguments);
    };
  }
  if (stubPath === 'ffmpeg-static') {
    const orig = Module._load;
    Module._load = function (req, parent, isMain) {
      if (req === 'ffmpeg-static') return FFMPEG;
      return orig.apply(this, arguments);
    };
  }
}

// By default we do NOT stub ffmpeg-static: the product resolver (CMP-34) must find a
// working binary on its own. Set QA_FFMPEG_OVERRIDE=1 to force a specific binary.
const OVERRIDE_FFMPEG = process.env.QA_FFMPEG_OVERRIDE === '1';
const stubs = OVERRIDE_FFMPEG
  ? ['repositories', 'dubbingPlanner', 'ffmpeg-static']
  : ['repositories', 'dubbingPlanner'];
stubs.forEach(stub);
if (!OVERRIDE_FFMPEG) trace('ffmpeg-static NOT stubbed: exercising product resolver');
process.env.QA_USE_SYSTEM_FFMPEG = '1';
require(EXPORT_JOB);
`);
  const jobWorker = path.join(tmp, 'export-worker.js');
  fs.writeFileSync(jobWorker, `
require(${JSON.stringify(workerBootstrap)});
`);

  function runExportWorker(breakMode) {
    // NOTE: the job scripts now register parentPort.on('message') for the Bree cancel
    // handshake, which keeps the worker thread alive after the job finishes. In production
    // Bree does this teardown for us on the 'done' message (bree/src/index.js:428-433);
    // driving the worker directly, we must do it ourselves or the worker never exits.
    const workerScript = `
const { Worker } = require('worker_threads');
const worker = new Worker(${JSON.stringify(jobWorker)}, {
  workerData: { jobId: 'qa-real-link-' + ${JSON.stringify(String(Date.now()))} + '-' + ${JSON.stringify(breakMode || 'ok')},
                jobName: 'exportChapterAudio',
                params: { chapterId: 4242 } }
});
const messages = [];
let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  console.log('MESSAGES ' + JSON.stringify(messages));
  process.exit(code);
}
worker.on('message', (m) => {
  messages.push(m);
  const terminal = m === 'done' || (m && (m.type === 'DONE' || m.type === 'ERROR'));
  if (terminal) setTimeout(() => worker.terminate(), 500);
});
worker.on('error', (e) => { console.log('WORKER_ERROR ' + e.message); finish(9); });
worker.on('exit', () => finish(0));
setTimeout(() => { console.log('WORKER_TIMEOUT'); worker.terminate(); finish(7); }, 60000);
`;
    const run = spawnSync(process.execPath, ['-e', workerScript], {
      encoding: 'utf8',
      env: { ...process.env, QA_EXPORT_BREAK_MODE: breakMode || '' },
      timeout: 120000
    });
    const stdout = run.stdout || '';
    const doneLine = stdout.split('\n').find((l) => l.startsWith('MESSAGES '));
    const messages = doneLine ? JSON.parse(doneLine.slice('MESSAGES '.length)) : [];
    return {
      exit: run.status,
      stderr: run.stderr || '',
      messages,
      done: messages.find((m) => m && m.type === 'DONE'),
      errored: messages.find((m) => m && m.type === 'ERROR')
    };
  }

  // ---- 3a. D1 readiness gate, executed by the real export job: one dialogue has no audio
  const gated = runExportWorker('missing');
  const gateMessage = gated.errored ? gated.errored.error : '';
  record(
    'export-job/readiness-gate-refuses',
    Boolean(gated.errored) && /章节无法拼接/.test(gateMessage),
    `worker exit=${gated.exit}; the real exportChapterAudioJob.js refused to run ffmpeg with ` +
    `error="${gateMessage}"; PROGRESS messages before refusal = ` +
    `${gated.messages.filter((m) => m && m.type === 'PROGRESS').length}`
  );

  // ---- 3b. Happy path: every item current -> real download, real concat, real upload
  const run = runExportWorker('ok');
  const { done, errored } = run;
  const messages = run.messages;

  if (errored || !done) {
    record(
      'export-job/real-run',
      false,
      `worker exit=${run.exit}; stderr=${run.stderr.slice(0, 400)}; messages=${JSON.stringify(messages).slice(0, 600)}`
    );
  } else {
    // chapterExportKey() embeds a randomUUID, so discover the written object by prefix.
    const prefix = 'books/77/chapters/4242/exports/';
    const listed = await storageService.listObjects(prefix);
    const mediaUrlBack = require(
      path.join(API_ROOT, 'src/services/storage/keyBuilder')
    ).keyFromMediaUrl(done.result.url);
    const hit = listed.find((o) => o.Key === mediaUrlBack);
    const mergedKey = hit ? hit.Key : null;
    let merged = null;
    if (mergedKey) merged = await storageService.getObjectBuffer(mergedKey);
    record(
      'export-job/real-run',
      Boolean(merged && merged.length > 0 && mediaUrlBack === mergedKey),
      `DONE url=${done.result.url} itemCount=${done.result.itemCount} format=${done.result.format}; ` +
      `listed ${listed.length} object(s) under ${prefix}; this run wrote ${mergedKey}; ` +
      `retrieved ${merged ? merged.length : 0} bytes; keyFromMediaUrl(result.url) round-trips to that key: ` +
      `${Boolean(hit)}`
    );

    if (merged && merged.length > 0) {
      const mergedFile = path.join(tmp, 'merged-from-s3.wav');
      fs.writeFileSync(mergedFile, merged);
      const probe = spawnSync('/usr/bin/ffprobe', [
        '-v', 'error',
        '-show_entries', 'stream=codec_name,sample_rate,channels,bits_per_sample',
        '-show_entries', 'format=duration',
        '-of', 'default=nw=1', mergedFile
      ], { encoding: 'utf8' });
      const probeOut = (probe.stdout || '').replace(/\s+/g, ' ').trim();
      const expectedDuration = segmentKeys.reduce((sum, s) => sum + s.dur, 0);
      const durationMatch = /duration=([0-9.]+)/.exec(probeOut);
      const dur = durationMatch ? Number(durationMatch[1]) : NaN;
      record(
        'export-job/merged-audio-probe',
        Math.abs(dur - expectedDuration) < 0.05 && probe.status === 0,
        `ffprobe (exit ${probe.status}): ${probeOut}; expected duration=${expectedDuration}s ` +
        `(sum of ${segmentKeys.map((s) => `${s.dur}s@${s.freq}Hz`).join(' + ')})`
      );

      // Prove the stored object carries the segments in chapter order (D3 at artifact level).
      const orderPy = spawnSync('python3', ['-c', `
import wave, struct, math, sys
w = wave.open(sys.argv[1]); sr = w.getframerate()
data = w.readframes(w.getnframes())
vals = struct.unpack('<%dh' % (len(data) // 2), data)
left = vals[0::2]
win = int(sr * 0.5)
out = []
for i in range(0, len(left), win):
    seg = left[i:i+win]
    if len(seg) < 1000: continue
    best, bf = None, 0.0
    for f in (440, 660, 880):
        re = sum(v * math.cos(2*math.pi*f*k/sr) for k, v in enumerate(seg))
        im = sum(v * math.sin(2*math.pi*f*k/sr) for k, v in enumerate(seg))
        m = math.hypot(re, im)
        if m > bf: bf, best = m, f
    out.append(best)
print(','.join(str(x) for x in out))
`, mergedFile], { encoding: 'utf8' });
      const observed = (orderPy.stdout || '').trim();
      const expectedOrder = segmentKeys
        .reduce((acc, s) => acc.concat(new Array(Math.round(s.dur / 0.5)).fill(s.freq)), [])
        .join(',');
      record(
        'export-job/concat-order-in-object',
        observed === expectedOrder,
        `dominant Hz per 0.5s window in the S3 object = [${observed}] (exit ${orderPy.status}); ` +
        `expected chapter order [${expectedOrder}]`
      );
    }
  }

  // ---------------------------------------------------------------- cleanup
  for (const seg of segmentKeys) await storageService.deleteObject(seg.key);
  await storageService.deleteObject(putKey);
  if (process.env.QA_KEEP_TMP) { console.log('TMP_KEPT ' + tmp); } else { fs.rmSync(tmp, { recursive: true, force: true }); }
  await db.close().catch(() => {});

  const failed = results.filter((r) => !r.ok);
  console.log('\n==== SUMMARY ====');
  console.log(`total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`);
  console.log(`exit_code=${failed.length ? 1 : 0}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('HARNESS_ERROR', error);
  process.exit(2);
});
