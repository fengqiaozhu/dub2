// CMP-38 chapter export delivery tests: default MP3 (192 kbps CBR,
// loudnorm provisional-spoken-v1, existing-field metadata), the
// EXPORT_PROFILE=wav-legacy fallback, and corrupt-segment failure without
// writing an export record. Requires DATABASE_URL + S3 env; uses the real
// resolved ffmpeg for synthesis, and ffprobe/ffmpeg only to read results
// back (tests are allowed to do explicit read-back checks).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Worker } = require('worker_threads');

const HAS_DB = Boolean(process.env.DATABASE_URL);
const HAS_S3 = Boolean(process.env.S3_ENDPOINT);
const dbTest = (HAS_DB && HAS_S3) ? test : test.skip;

const db = require('../src/repositories/postgres/db');
const {
  bookRepository,
  chapterRepository,
  chapterCharacterRepository,
  chapterAudioExportRepository,
  characterVoiceBindingRepository,
  dialogueRepository
} = require('../src/repositories');
const storageService = require('../src/services/storage/storageService');
const { dialogueAudioKey, mediaUrlForKey, keyFromMediaUrl } = require('../src/services/storage/keyBuilder');
const dubbingPlanner = require('../src/services/tts/dubbingPlanner');
const { computeChapterSourceHash } = require('../src/services/chapterAudioState');
const { resolveExportProfile, EXPORT_PROFILES } = require('../src/services/exportProfile');

function preserveEnvironment(t, names) {
  const originals = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  t.after(() => {
    for (const [name, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args);
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stderr });
      else reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

function runFfprobeJson(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]);
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(JSON.parse(stdout));
      else reject(new Error(`ffprobe exited with code ${code}`));
    });
  });
}

async function makeSineWav(filePath, { frequency = 440, seconds = 6, volume = 0.3 } = {}) {
  await runFfmpeg([
    '-y', '-nostdin', '-hide_banner',
    '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=44100`,
    '-af', `volume=${volume}`,
    '-t', String(seconds),
    '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2',
    filePath
  ]);
  return fs.readFileSync(filePath);
}

function runExportWorker(chapterId, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const worker = new Worker(path.join(__dirname, '..', 'src', 'jobs', 'exportChapterAudioJob.js'), {
      workerData: {
        jobId: `cmp38-export-${chapterId}`,
        jobName: 'chapter_audio_export',
        params: { chapterId }
      },
      env: {
        ...process.env,
        MOSI_API_KEY: 'cmp38-export-test',
        EXPORT_PROFILE: String(extraEnv.EXPORT_PROFILE ?? ''),
        EXPORT_EARLY_PROBE: String(extraEnv.EXPORT_EARLY_PROBE ?? '')
      }
    });
    worker.on('message', (message) => {
      if (message && typeof message === 'object') {
        messages.push(message);
        // The export worker thread does not exit by itself after posting
        // its terminal message; jobManager normally unrefs/terminates it.
        if (message.type === 'DONE' || message.type === 'ERROR') {
          worker.terminate();
        }
      }
    });
    worker.on('error', reject);
    worker.on('exit', () => {
      const done = messages.find((message) => message.type === 'DONE');
      const error = messages.find((message) => message.type === 'ERROR');
      const records = messages.filter((message) => message.type === 'PROGRESS');
      resolve({ done, error: error ? error.error : null, records });
    });
  });
}

const MP3_PROFILE = EXPORT_PROFILES['mp3-192k'];

async function seedExportScenario({ content, coverAuthor = null, publishYear = null } = {}) {
  const slug = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const bookId = await bookRepository.create({
    title: `CMP-38 导出书 ${slug}`,
    format: 'txt',
    author: coverAuthor,
    publish_year: publishYear
  });
  const chapterId = await chapterRepository.create({
    book_id: bookId,
    title: '第一章',
    content,
    chapter_index: 0
  });
  await chapterCharacterRepository.upsert(chapterId, bookId, '罗辑');
  await characterVoiceBindingRepository.upsert(bookId, '罗辑', {
    voice_id: 'sys-voice-1',
    provider: 'mosi',
    voice_source: 'system'
  });
  return { bookId, chapterId, bookTitle: `CMP-38 导出书 ${slug}` };
}

async function seedCoveredDialogues({ bookId, chapterId, content, segments }) {
  const chapterCharacter = (await chapterCharacterRepository.findByChapterId(chapterId))[0];
  const keys = [];
  const boundary = Math.ceil(content.length / segments.length);
  for (let index = 0; index < segments.length; index += 1) {
    const dialogueId = await dialogueRepository.create({
      chapter_character_id: chapterCharacter.id,
      chapter_id: chapterId,
      content: content.slice(index * boundary, Math.min(content.length, (index + 1) * boundary)),
      char_start: index * boundary,
      char_end: Math.min(content.length, (index + 1) * boundary),
      order_index: index,
      source: 'manual'
    });
    keys.push({ dialogueId, key: dialogueAudioKey(bookId, chapterId, dialogueId, '.wav'), segment: segments[index] });
  }
  return keys;
}

async function arrangeCurrentAudio(chapterId, keys, segmentBuffers) {
  const plan = await dubbingPlanner.createPlan(chapterId, { includeCompleted: true });
  const taskByDialogueId = new Map((plan.tasks || []).map((task) => [String(task.dialogueId), task]));
  for (const [index, entry] of keys.entries()) {
    const task = taskByDialogueId.get(String(entry.dialogueId));
    assert.ok(task, `planner produced a task for dialogue ${entry.dialogueId}`);
    await storageService.putObject(entry.key, segmentBuffers[index], { contentType: 'audio/wav' });
    await dialogueRepository.update(entry.dialogueId, {
      audio_url: mediaUrlForKey(entry.key),
      audio_source_hash: task.sourceHash,
      audio_duration: 6
    });
  }
  return plan;
}

async function exportRecordCount(chapterId) {
  const rows = await db.query('SELECT COUNT(*)::int AS n FROM chapter_audio_exports WHERE chapter_id = $1', [chapterId]);
  return rows.rows[0].n;
}

// End-to-end check of the production default: an actual MP3 delivery should
// only ever happen through the profile gate (API-side checks already cover
// hash-blindness); this row exists to pin the assertion set in one place.
function assertDefaultDeliveryShape(outcome) {
  assert.equal(outcome.done.result.format, 'mp3');
  assert.equal(outcome.done.result.exportProfile, 'mp3-192k');
}

dbTest('default export profile delivers MP3 (192k CBR, provisional-spoken-v1 loudness, existing-field metadata)', async (t) => {
  preserveEnvironment(t, ['MOSI_API_KEY']);
  const { bookId, chapterId, bookTitle } = await seedExportScenario({
    content: '你好世界。再见星球。',
    coverAuthor: '刘慈欣',
    publishYear: 2024
  });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp38-export-'));
  const keys = await seedCoveredDialogues({ bookId, chapterId, content: '你好世界。再见星球。', segments: 2 });
  const first = await makeSineWav(path.join(tmpDir, 'a.wav'), { frequency: 440 });
  const second = await makeSineWav(path.join(tmpDir, 'b.wav'), { frequency: 330 });
  try {
    await arrangeCurrentAudio(chapterId, keys, [first, second]);

    const outcome = await runExportWorker(chapterId);
    assert.ok(!outcome.error, `export job should succeed, got: ${outcome.error}`);
    assertDefaultDeliveryShape(outcome);
    assert.equal(outcome.done.result.itemCount, 2);

    const record = await chapterAudioExportRepository.findLatestByChapterId(chapterId);
    assert.ok(record, 'an export record was written');
    assert.equal(record.format, 'mp3');
    assert.equal(record.item_count, 2);

    const dialoguesAfter = await dialogueRepository.findByChapterId(chapterId);
    const items = dialoguesAfter
      .filter((dialogue) => dialogue.audio_url)
      .sort((a, b) => a.char_start - b.char_start)
      .map((dialogue) => ({ dialogue, objectKey: keyFromMediaUrl(dialogue.audio_url) }));
    const profile = resolveExportProfile({ EXPORT_PROFILE: '' });
    const expectedHash = computeChapterSourceHash(items, profile);
    assert.equal(record.source_hash, expectedHash, 'export identity is the dedicated export-identity hash');

    const exportedKey = keyFromMediaUrl(record.audio_url);
    const storageRow = await db.query('SELECT content_type FROM storage_objects WHERE object_key = $1', [exportedKey]);
    assert.equal(storageRow.rows[0].content_type, 'audio/mpeg');

    const mp3Buffer = await storageService.getObjectBuffer(exportedKey);
    const mp3Path = path.join(tmpDir, 'delivered.mp3');
    fs.writeFileSync(mp3Path, mp3Buffer);

    const probe = await runFfprobeJson(mp3Path);
    const audioStream = probe.streams.find((stream) => stream.codec_type === 'audio');
    assert.ok(audioStream, 'one audio stream in the delivered MP3');
    assert.equal(audioStream.codec_name, 'mp3');
    assert.equal(audioStream.sample_rate, '44100');
    assert.equal(Number(audioStream.channels), 2);
    assert.ok(
      Math.abs(Number(audioStream.bit_rate) - 192000) <= 3000,
      `bit_rate near 192000, got ${audioStream.bit_rate}`
    );
    const tags = probe.format.tags || {};
    assert.ok(
      String(tags.title || tags.TITLE || '').includes('CMP-38 导出书'),
      `title tag contains book name, got: ${tags.title || tags.TITLE}`
    );
    assert.ok(String(tags.title || tags.TITLE || '').includes('第一章'));
    assert.equal(tags.artist || tags.ARTIST, '刘慈欣');
    assert.equal(tags.album || tags.ALBUM, bookTitle, 'album uses the book title');
    assert.ok(tags.date || tags.DATE, 'date written because publish_year exists');
    assert.ok(probe.format.duration && Number(probe.format.duration) > 10, 'delivered duration covers both segments');

    const loudness = await runFfmpeg(['-nostdin', '-hide_banner', '-nostats', '-i', mp3Path, '-filter_complex', 'ebur128', '-f', 'null', '-']);
    const match = loudness.stderr.match(/I:\s*(-?\d+\.?\d*)\s*LUFS/);
    assert.ok(match, `ebur128 summary parsed from ffmpeg output: ${loudness.stderr.slice(-400)}`);
    const integrated = Number(match[1]);
    assert.ok(
      integrated >= -17 && integrated <= -15,
      `integrated loudness within ±1 LU of -16 LUFS, got ${integrated}`
    );

    await storageService.deleteObject(exportedKey);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await bookRepository.delete(bookId);
  }
});

dbTest('EXPORT_PROFILE=wav-legacy still delivers WAV through the historical concat path', async (t) => {
  preserveEnvironment(t, ['MOSI_API_KEY']);
  const { bookId, chapterId } = await seedExportScenario({ content: '你好世界。' });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp38-export-legacy-'));
  const keys = await seedCoveredDialogues({ bookId, chapterId, content: '你好世界。', segments: 1 });
  const wav = await makeSineWav(path.join(tmpDir, 'a.wav'), { frequency: 440 });
  try {
    await arrangeCurrentAudio(chapterId, keys, [wav]);
    const outcome = await runExportWorker(chapterId, { EXPORT_PROFILE: 'wav-legacy' });
    assert.ok(!outcome.error, `legacy export should succeed, got: ${outcome.error}`);
    assert.equal(outcome.done.result.format, 'wav');

    const record = await chapterAudioExportRepository.findLatestByChapterId(chapterId);
    assert.equal(record.format, 'wav');
    const legacyItems = (await dialogueRepository.findByChapterId(chapterId))
      .filter((dialogue) => dialogue.audio_url)
      .sort((a, b) => a.char_start - b.char_start)
      .map((dialogue) => ({ dialogue, objectKey: dialogue.audio_url.replace(/^\/media\//, '') }));
    assert.equal(record.source_hash, computeChapterSourceHash(legacyItems, EXPORT_PROFILES['wav-legacy']), 'legacy WAV keeps the historical item-list hash');

    const buffer = await storageService.getObjectBuffer(record.audio_url.replace(/^\/media\//, ''));
    assert.equal(String(buffer.slice(0, 4)), 'RIFF', 'delivered file is WAV/PCM');
    await storageService.deleteObject(record.audio_url.replace(/^\/media\//, ''));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await bookRepository.delete(bookId);
  }
});

dbTest('a corrupt segment fails the whole chapter export with the segment index and no new export record', async (t) => {
  preserveEnvironment(t, ['MOSI_API_KEY']);
  const { bookId, chapterId } = await seedExportScenario({ content: '你好世界。' });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp38-export-corrupt-'));
  const keys = await seedCoveredDialogues({ bookId, chapterId, content: '你好世界。', segments: 1 });
  try {
    await arrangeCurrentAudio(chapterId, keys, [Buffer.from('this-is-definitely-not-a-wav-file')]);
    const before = await exportRecordCount(chapterId);
    // Early probe runs the corrupt-decode path before the readiness gate; the
    // failure surface (segment index, no record) must be identical.
    const earlyOutcome = await runExportWorker(chapterId, { EXPORT_EARLY_PROBE: 'true' });
    assert.ok(earlyOutcome.error, 'early-probe export job must fail on a non-decodable segment');
    assert.ok(
      /第 1 段/.test(earlyOutcome.error),
      `early-probe path also names the segment index, got: ${earlyOutcome.error}`
    );
    assert.equal(await exportRecordCount(chapterId), before, 'no record after early-probe failure');

    const outcome = await runExportWorker(chapterId);
    assert.ok(outcome.error, 'export job must fail on a non-decodable segment');
    assert.ok(
      /第 1 段/.test(outcome.error),
      `failure names the segment index, got: ${outcome.error}`
    );
    const after = await exportRecordCount(chapterId);
    assert.equal(after, before, 'no half-written export record');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await bookRepository.delete(bookId);
  }
});
