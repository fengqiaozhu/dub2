const test = require('node:test');
const assert = require('node:assert/strict');
const { buildChapterAudioItems, computeDialogueAudioHash, getChapterAudioItems, getChapterExportReadiness } = require('../src/services/chapterAudioState');
const { mediaUrlForKey, keyFromMediaUrl } = require('../src/services/storage/keyBuilder');

function line(id, start, end, content) {
  const item = { id, char_start: start, char_end: end, content, source: 'manual', character_name: '甲', audio_url: mediaUrlForKey(`audio/${id}.wav`) };
  item.audio_source_hash = computeDialogueAudioHash(item);
  return item;
}

test('export blocks incomplete narration rather than silently exporting only dialogue', () => {
  const chapter = { content: '旁白对白' };
  const items = buildChapterAudioItems(chapter, [line(1, 2, 4, '对白')]);
  assert.equal(items.length, 2);
  assert.deepEqual(getChapterExportReadiness(items), { ready: false, total: 2, pending: 1, missing: 1, stale: 0, failed: 0 });
  const skipped = buildChapterAudioItems(chapter, [line(1, 2, 4, '对白')], new Map(), [{ char_start: 0, char_end: 2 }]);
  assert.equal(getChapterExportReadiness(skipped).ready, true);
});

test('text and voice changes invalidate audio and block export', () => {
  const original = line(1, 0, 2, '对白');
  const changed = { ...original, content: '新词' };
  assert.equal(getChapterExportReadiness(buildChapterAudioItems({ content: '新词' }, [changed])).stale, 1);
  const items = buildChapterAudioItems({ content: '对白' }, [original], new Map([['1', { voiceId: 'new-voice' }]]));
  assert.equal(getChapterExportReadiness(items).ready, false);
});

test('failed and empty chapters cannot be merged', () => {
  assert.equal(getChapterExportReadiness([]).ready, false);
  assert.equal(getChapterExportReadiness([{ audio_status: 'skipped' }]).ready, false);
  assert.equal(getChapterExportReadiness([{ audio_status: 'failed' }]).failed, 1);
});

test('audio concatenation follows text order without mutating stored dialogue order', () => {
  const stored = [line(2, 2, 4, '乙乙'), line(1, 0, 2, '甲甲')];
  assert.deepEqual(getChapterAudioItems(stored).map((item) => item.dialogue.id), [1, 2]);
  assert.deepEqual(stored.map((item) => item.id), [2, 1]);
});

test('media keys round trip percent sequences and malformed URLs are excluded', () => {
  const key = 'audio/100%20 完成.wav';
  assert.equal(keyFromMediaUrl(mediaUrlForKey(key)), key);
  assert.equal(keyFromMediaUrl('/media/%broken'), null);
  assert.equal(keyFromMediaUrl('/media/'), null);
  assert.equal(getChapterAudioItems([{ audio_url: '/media/%broken' }]).length, 0);
  const invalid = { ...line(1, 0, 2, '对白'), audio_url: '/media/%broken' };
  const items = buildChapterAudioItems({ content: '对白' }, [invalid]);
  assert.equal(getChapterExportReadiness(items).ready, false);
  assert.equal(items[0].audio_status, 'missing');
});
