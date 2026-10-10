// Independent regression suite for CMP-28 (D1-D6).
// Written from the acceptance criteria in CMP-25 defect-inventory, not copied
// from the engineer-authored tests in this directory.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const state = require('../src/services/chapterAudioState');
const { keyFromMediaUrl, mediaUrlForKey } = require('../src/services/storage/keyBuilder');

function dialogue(id, start, end, extra = {}) {
  return {
    id,
    char_start: start,
    char_end: end,
    content: `句子${id}`,
    source: 'manual',
    character_name: '甲',
    ...extra
  };
}

function spoken(d) {
  return { ...d, audio_url: mediaUrlForKey(`books/1/chapters/2/dialogues/${d.id}.wav`) };
}

function readyItem(d, route = {}) {
  const withAudio = spoken(d);
  return { ...withAudio, audio_source_hash: state.computeDialogueAudioHash(withAudio, route) };
}

// ---------------------------------------------------------------- D1

test('D1 readiness is blocked by every incomplete sentence state', () => {
  const base = [readyItem(dialogue(1, 0, 3))];
  assert.equal(state.getChapterExportReadiness(state.buildChapterAudioItems({ content: '' }, base)).ready, true);

  const missing = state.buildChapterAudioItems({ content: '' }, [...base, dialogue(2, 4, 7)]);
  assert.deepEqual(state.getChapterExportReadiness(missing), {
    ready: false, total: 2, pending: 1, missing: 1, stale: 0, failed: 0
  });

  const stale = state.buildChapterAudioItems({ content: '' }, [
    readyItem(dialogue(1, 0, 3)),
    { ...readyItem(dialogue(2, 4, 7)), audio_source_hash: 'outdated-hash' }
  ]);
  const staleReadiness = state.getChapterExportReadiness(stale);
  assert.equal(staleReadiness.ready, false);
  assert.equal(staleReadiness.stale, 1);

  const failed = state.buildChapterAudioItems({ content: '' }, [
    ...base,
    { ...spoken(dialogue(3, 8, 11)), audio_status: 'failed', audio_error: 'provider 500' }
  ]);
  const failedReadiness = state.getChapterExportReadiness(failed);
  assert.equal(failedReadiness.ready, false);
  assert.equal(failedReadiness.failed, 1);
});

test('D1 an empty chapter is never exportable', () => {
  assert.equal(state.getChapterExportReadiness(state.buildChapterAudioItems({ content: '' }, [])).ready, false);
  assert.equal(state.getChapterExportReadiness(state.buildChapterAudioItems({ content: '只有正文' }, [])).ready, false);
});

test('D1 the export job re-checks readiness before touching ffmpeg', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/jobs/exportChapterAudioJob.js'), 'utf8');
  assert.match(src, /getChapterExportReadiness\(/);
  assert.match(src, /if \(!readiness\.ready\)/);
  const gate = src.indexOf('if (!readiness.ready)');
  const firstFfmpeg = src.indexOf('runFfmpeg(');
  assert.ok(gate !== -1 && firstFfmpeg !== -1, 'gate and ffmpeg call must both exist');
  assert.ok(gate < firstFfmpeg, `readiness gate (${gate}) must precede first runFfmpeg call (${firstFfmpeg})`);
});

// ---------------------------------------------------------------- D2

test('D2 an old merged track stops being current as soon as a new sentence is unfinished', () => {
  const done = readyItem(dialogue(1, 0, 3));
  const completedSet = state.buildChapterAudioItems({ content: '' }, [done]);
  const storedExportHash = state.computeChapterAudioHash(completedSet);

  const withNewPendingSentence = state.buildChapterAudioItems({ content: '' }, [done, dialogue(2, 4, 7)]);
  const currentHash = state.computeChapterAudioHash(withNewPendingSentence);

  // The hash alone already differs, but readiness must also block: that is what
  // protects the case where the pending sentence carries a stale-but-equal hash.
  assert.equal(state.getChapterExportReadiness(withNewPendingSentence).ready, false);
  assert.notEqual(storedExportHash, currentHash);
});

test('D2 merged_audio_export.is_current is wired to export readiness in the controller', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/controllers/chapterController.js'), 'utf8');
  const line = src.split('\n').find((l) => l.includes('is_current:'));
  assert.ok(line, 'controller must compute merged_audio_export.is_current');
  assert.match(line, /export_readiness\.ready/);
  assert.match(line, /source_hash\s*===\s*currentHash/);
});

// ---------------------------------------------------------------- D3

test('D3 chapter audio order follows the text, not the stored order', () => {
  const stored = [spoken(dialogue(3, 20, 24)), spoken(dialogue(1, 0, 4)), spoken(dialogue(2, 8, 12))];
  const items = state.getChapterAudioItems(stored);
  assert.deepEqual(items.map((i) => i.dialogue.id), [1, 2, 3]);
});

test('D3 sorting does not mutate the caller array', () => {
  const stored = [dialogue(2, 8, 12), dialogue(1, 0, 4)];
  const snapshot = stored.map((d) => d.id);
  state.getChapterAudioItems(stored);
  assert.deepEqual(stored.map((d) => d.id), snapshot);
});

test('D3 failed and unusable rows never reach the merge input', () => {
  const stored = [
    spoken(dialogue(1, 0, 4)),
    { ...spoken(dialogue(2, 8, 12)), audio_status: 'failed' },
    { ...dialogue(3, 16, 20), audio_url: '/media/voices/bad%ZZ.wav' }
  ];
  const items = state.getChapterAudioItems(stored);
  assert.deepEqual(items.map((i) => i.dialogue.id), [1]);
});

// ---------------------------------------------------------------- D4

test('D4 a launch failure is persisted as FAILED and the registration is cleaned up', async () => {
  const { jobRepository } = require('../src/repositories');
  const updates = [];
  const originalCreate = jobRepository.create;
  const originalUpdate = jobRepository.update;
  jobRepository.create = async (row) => { jobRepository.__created = row; return row; };
  jobRepository.update = async (id, patch) => { updates.push({ id, patch }); return patch; };
  delete require.cache[require.resolve('../src/services/jobManager')];
  const jobManager = require('../src/services/jobManager');
  const removed = [];
  jobManager.bree.add = async () => { throw new Error('bree add exploded'); };
  jobManager.bree.remove = async (name) => { removed.push(name); };

  await assert.rejects(() => jobManager.startJob('qa_type', 'chapter-1', 'analyzeChapterJob.js'), /bree add exploded/);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].patch.status, 'FAILED');
  assert.match(updates[0].patch.error, /bree add exploded/);
  assert.deepEqual(removed, [jobRepository.__created.job_name]);

  jobRepository.create = originalCreate;
  jobRepository.update = originalUpdate;
  delete require.cache[require.resolve('../src/services/jobManager')];
});

// ---------------------------------------------------------------- D6

test('D6 malformed media urls are treated as missing audio instead of bad merge input', () => {
  assert.equal(keyFromMediaUrl('/media/voices/bad%ZZ.wav'), null);
  assert.equal(keyFromMediaUrl('http://example.com/audio/a.wav'), null);
  assert.equal(keyFromMediaUrl(null), null);
  assert.equal(keyFromMediaUrl('/media/'), null);
  assert.equal(keyFromMediaUrl(mediaUrlForKey('books/1/chapters/2/100% ready.wav')), 'books/1/chapters/2/100% ready.wav');

  const items = state.buildChapterAudioItems({ content: '' }, [
    { ...dialogue(1, 0, 3), audio_url: '/media/voices/bad%ZZ.wav', audio_source_hash: 'ignored' }
  ]);
  assert.equal(items[0].audio_status, 'missing');
  assert.equal(state.getChapterExportReadiness(items).ready, false);
});

test('D6 the media route reads the express-decoded key exactly once', async () => {
  const storageService = require('../src/services/storage/storageService');
  const original = storageService.getObjectStream;
  const requested = [];
  storageService.getObjectStream = async (key) => {
    requested.push(key);
    return { contentType: 'audio/wav', contentLength: 3, stream: { pipe: () => {} } };
  };
  const mediaController = require('../src/controllers/mediaController');
  const headers = {};
  const res = {
    setHeader: (k, v) => { headers[k] = v; },
    status() { return res; },
    json() {}
  };

  await mediaController.getMedia({ params: ['books/1/chapters/2/100% ready.wav'] }, res);
  await mediaController.getMedia({ params: ['books/1/chapters/2/%E5%8F%B0%E8%AF%8D.wav'] }, res);

  assert.deepEqual(requested, [
    'books/1/chapters/2/100% ready.wav',
    'books/1/chapters/2/%E5%8F%B0%E8%AF%8D.wav'
  ]);
  storageService.getObjectStream = original;
});
