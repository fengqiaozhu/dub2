// CMP-38 golden samples and hash/alias semantics. The golden values below are
// captured from the unmodified 6d601ab implementation and must never be
// regenerated from a modified function.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeDialogueAudioHash,
  computeChapterAudioHash,
  computeChapterSourceHash,
  normalizeDialogueContent
} = require('../src/services/chapterAudioState');
const needsDubbing = require('../src/services/tts/dubbingPlanner').needsDubbing;
const { resolveExportProfile, EXPORT_PROFILES } = require('../src/services/exportProfile');
const pronunciationService = require('../src/services/tts/pronunciationService');

const GOLDEN_HASH = 'fc455bc1bdeecc1653078ca76e7b807a7356ae753e31c6111d12f7a3270a848e';

function goldenInputs(content = '你好') {
  return {
    dialogue: { source: 'manual', character_name: '罗辑', content, char_start: 0, char_end: 2, emotion: '' },
    route: {
      provider: 'mosi',
      providerConfigId: 'cfg-1',
      providerConfigSource: 'book',
      model: 'm1',
      voiceId: 'v1',
      voiceProfileId: null,
      intent: null
    }
  };
}

test('golden sample: computeDialogueAudioHash matches the pinned digest', () => {
  const { dialogue, route } = goldenInputs();
  assert.equal(computeDialogueAudioHash(dialogue, route), GOLDEN_HASH);
});

test('golden sample: zero-width normalization keeps the digest identical', () => {
  const { route } = goldenInputs();
  const { dialogue } = goldenInputs(' \u200B你好\uFEFF ');
  assert.equal(computeDialogueAudioHash(dialogue, route), GOLDEN_HASH);
});

test('spoken text only enters the hash when it differs from normalized content', () => {
  const { dialogue, route } = goldenInputs();
  const zeroWidthCopy = { ...dialogue, content: ' \u200B你好\uFEFF ' };
  assert.equal(
    computeDialogueAudioHash(zeroWidthCopy, { ...route, spokenText: '你好' }),
    GOLDEN_HASH
  );
  const aliased = computeDialogueAudioHash(dialogue, { ...route, spokenText: '你好啊' });
  assert.notEqual(aliased, GOLDEN_HASH);
});

test('needsDubbing: only re-dubs missing/failed/hash-mismatched sentences, honors includeCompleted', () => {
  const { dialogue, route } = goldenInputs();
  const { spokenText } = { spokenText: '罗辑曰你好' };
  const aliasedHash = computeDialogueAudioHash(dialogue, { ...route, spokenText });
  const voiceOnlyHash = computeDialogueAudioHash(dialogue, { ...route, voiceId: 'v2' });
  const plainHash = computeDialogueAudioHash(dialogue, route);
  // Alias (or voice) changes on top of the golden identical case.

  const currentDialogue = { dialogue, audio_url: '/media/a.wav', audio_source_hash: plainHash, audio_status: 'current' };
  assert.equal(needsDubbing(currentDialogue, plainHash, {}), false, 'unaffected current sentence is not re-dubbed');

  const aliasedDialogue = { dialogue, audio_url: '/media/a.wav', audio_source_hash: plainHash, audio_status: 'current' };
  assert.equal(needsDubbing(aliasedDialogue, aliasedHash, {}), true, 'alias-driven spoken-text change makes the sentence need re-dubbing');

  const voiceChangedDialogue = { dialogue, audio_url: '/media/a.wav', audio_source_hash: plainHash, audio_status: 'current' };
  assert.equal(needsDubbing(voiceChangedDialogue, voiceOnlyHash, {}), true, 'voice-id change makes the sentence need re-dubbing');

  const missingDialogue = { dialogue, audio_url: null, audio_source_hash: plainHash, audio_status: 'missing' };
  assert.equal(needsDubbing(missingDialogue, plainHash, {}), true);
  const failedDialogue = { dialogue, audio_url: '/media/a.wav', audio_source_hash: plainHash, audio_status: 'failed', audio_error: 'x' };
  assert.equal(needsDubbing(failedDialogue, plainHash, {}), true);

  assert.equal(needsDubbing(currentDialogue, plainHash, { includeCompleted: true }), true, 'includeCompleted forces re-planning');
});

test('profile grouping alone (same spoken text, same voice) keeps sentence hashes stable', () => {
  const { dialogue, route } = goldenInputs();
  assert.equal(computeDialogueAudioHash(dialogue, { ...route, spokenText: '你好' }), GOLDEN_HASH);
});

test('export identity is separate from sentence hashes and stays aligned with the job', () => {
  const { dialogue } = goldenInputs();
  const item = (hash, url, order) => ({
    dialogue: { ...dialogue, audio_source_hash: hash, audio_url: url, audio_duration: 1, order_index: order }
  });
  const audioHash = computeDialogueAudioHash(dialogue, goldenInputs().route);
  const items = [item(audioHash, 'a.wav', 0), item(audioHash, 'b.wav', 1)];
  const legacy = computeChapterSourceHash(items, EXPORT_PROFILES['wav-legacy']);
  const mp3 = computeChapterSourceHash(items, EXPORT_PROFILES['mp3-192k']);
  const mp3Alt = computeChapterSourceHash(items, { ...EXPORT_PROFILES['mp3-192k'], bitrateKbps: 128 });

  assert.equal(legacy, computeChapterAudioHash([
    { ...dialogue, audio_source_hash: audioHash, audio_url: 'a.wav', audio_duration: 1, order_index: 0 },
    { ...dialogue, audio_source_hash: audioHash, audio_url: 'b.wav', audio_duration: 1, order_index: 1 }
  ]));
  assert.notEqual(legacy, mp3, 'wav and mp3 exports must have distinct identities');
  assert.notEqual(
    mp3,
    mp3Alt,
    'changing the export profile only expires chapter exports, not sentences'
  );
});

test('resolveExportProfile defaults to mp3-192k and supports wav-legacy', () => {
  assert.equal(resolveExportProfile({}).id, 'mp3-192k');
  assert.equal(resolveExportProfile({ EXPORT_PROFILE: '' }).id, 'mp3-192k');
  assert.equal(resolveExportProfile({ EXPORT_PROFILE: 'wav-legacy' }).id, 'wav-legacy');
  assert.throws(() => resolveExportProfile({ EXPORT_PROFILE: 'aac-premium' }), /EXPORT_PROFILE/);
  const loud = resolveExportProfile({}).loudnessProfile;
  assert.deepEqual(loud, { id: 'provisional-spoken-v1', integrated_lufs: -16, true_peak_dbtp: -1.5, lra: 11 });
});

test('applyAliasRules sorts by priority desc, match length desc, id asc, replacing without overlap', () => {
  const rules = pronunciationService.sortRules([
    { id: 3, rule_type: 'alias', match_text: '小米', replacement: '小 Substitute', priority: 1, enabled: true },
    { id: 1, rule_type: 'alias', match_text: '小行星', replacement: '小行星维基', priority: 0, enabled: true },
    { id: 2, rule_type: 'alias', match_text: '小米', replacement: 'Xiaomi', priority: 5, enabled: true }
  ]);
  assert.deepEqual(rules.map((rule) => rule.id), [2, 3, 1]);
  const { text } = pronunciationService.applyAliasRules('小米和小行星', rules, null);
  assert.equal(text, 'Xiaomi和小行星维基');
});

test('applyAliasRules respects per-profile scoping and enabled filter', () => {
  const rules = [
    { id: 10, rule_type: 'alias', match_text: '蓝', replacement: 'Blue', priority: 9, enabled: true, profile_id: 7 },
    { id: 11, rule_type: 'alias', match_text: '红', replacement: 'Red', priority: 8, enabled: false, profile_id: null },
    { id: 12, rule_type: 'alias', match_text: '绿', replacement: 'Green', priority: 7, enabled: true, profile_id: null }
  ];
  assert.equal(pronunciationService.applyAliasRules('蓝红绿', rules, 7).text, 'Blue红Green');
  assert.equal(pronunciationService.applyAliasRules('蓝红绿', rules, null).text, '蓝红Green');
  assert.equal(pronunciationService.applyAliasRules('蓝红绿', rules, 99).text, '蓝红Green');
});

test('applyAliasRules does not loop on self-referencing replacements', () => {
  const rules = [{ id: 1, rule_type: 'alias', match_text: 'a', replacement: 'b', priority: 0, enabled: true }];
  assert.equal(pronunciationService.applyAliasRules('ab', rules, null).text, 'bb');
});

test('zero-width characters are normalized before rule matching', () => {
  assert.equal(normalizeDialogueContent(' \u200B哈哈\uFEFF '), '哈哈');
});
