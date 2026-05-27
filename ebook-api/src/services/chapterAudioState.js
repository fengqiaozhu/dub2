const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const publicDir = path.resolve(__dirname, '../../public');

function normalizeHashInput(value) {
  if (Array.isArray(value)) return value.map(normalizeHashInput);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = normalizeHashInput(value[key]);
      return acc;
    }, {});
  }
  return value ?? null;
}

function hashObject(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(normalizeHashInput(value)))
    .digest('hex');
}

function normalizeDialogueContent(content) {
  return String(content || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/&zwnj;|&zwj;|&ZeroWidthSpace;/gi, '')
    .trim();
}

function hasSpeakableContent(dialogue) {
  return Boolean(normalizeDialogueContent(dialogue?.content));
}

function computeDialogueAudioHash(dialogue, route = {}) {
  return hashObject({
    type: dialogue.source === 'narrator' ? 'narration' : 'dialogue',
    character_name: dialogue.character_name,
    content: normalizeDialogueContent(dialogue.content),
    char_start: dialogue.char_start,
    char_end: dialogue.char_end,
    emotion: dialogue.emotion || '',
    provider: route.provider,
    model: route.model,
    voice_id: route.voiceId || route.providerVoiceId || route.provider_voice_id,
    voice_profile_id: route.voiceProfileId || route.voice_profile_id,
    intent: route.intent || null
  });
}

function resolveAudioStatus(dialogue, sourceHash) {
  if (dialogue.audio_status === 'failed' && dialogue.audio_error) return 'failed';
  if (!dialogue.audio_url) return 'missing';
  if (dialogue.audio_source_hash && sourceHash && dialogue.audio_source_hash === sourceHash) return 'current';
  return 'stale';
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return Number(aStart) < Number(bEnd) && Number(bStart) < Number(aEnd);
}

function isAudioSkipped(dialogue, skipRanges = []) {
  if (!dialogue || dialogue.char_start < 0 || dialogue.char_end <= dialogue.char_start) return false;
  return skipRanges.some((range) => rangesOverlap(
    dialogue.char_start,
    dialogue.char_end,
    range.char_start,
    range.char_end
  ));
}

function buildNarratorRanges(chapter, dialogues) {
  const content = chapter.content || '';
  const narrators = [];
  const sorted = dialogues
    .filter((dialogue) => dialogue.source !== 'narrator')
    .filter((dialogue) => dialogue.char_start >= 0 && dialogue.char_end > dialogue.char_start)
    .sort((a, b) => a.char_start - b.char_start);
  let cursor = 0;

  const pushLines = (start, end) => {
    const text = content.slice(start, end);
    let offset = 0;
    for (const line of text.split('\n')) {
      const absoluteStart = start + offset;
      const absoluteEnd = absoluteStart + line.length;
      const normalizedLine = normalizeDialogueContent(line);
      if (normalizedLine) {
        narrators.push({
          id: `narrator-${absoluteStart}-${absoluteEnd}`,
          character_name: '旁白',
          content: normalizedLine,
          emotion: '',
          char_start: absoluteStart,
          char_end: absoluteEnd,
          order_index: absoluteStart,
          source: 'narrator'
        });
      }
      offset += line.length + 1;
    }
  };

  for (const dialogue of sorted) {
    if (dialogue.char_start > cursor) pushLines(cursor, dialogue.char_start);
    if (dialogue.char_end > cursor) cursor = dialogue.char_end;
  }
  if (cursor < content.length) pushLines(cursor, content.length);
  return narrators;
}

function buildChapterAudioItems(chapter, dialogues, taskMap = new Map(), skipRanges = []) {
  const storedNarrators = dialogues.filter((dialogue) => dialogue.source === 'narrator');
  const sourceItems = storedNarrators.length > 0
    ? dialogues
    : dialogues.filter((dialogue) => dialogue.source !== 'narrator').concat(buildNarratorRanges(chapter, dialogues));

  return sourceItems
    .filter((dialogue) => hasSpeakableContent(dialogue) && dialogue.char_start >= 0 && dialogue.char_end > dialogue.char_start)
    .map((dialogue) => {
      const route = taskMap.get(String(dialogue.id)) || {};
      const sourceHash = computeDialogueAudioHash(dialogue, route);
      const content = normalizeDialogueContent(dialogue.content);
      const skipAudio = isAudioSkipped(dialogue, skipRanges);
      return {
        id: dialogue.id,
        dialogue_id: typeof dialogue.id === 'number' ? dialogue.id : null,
        type: dialogue.source === 'narrator' ? 'narration' : 'dialogue',
        character_name: dialogue.character_name,
        content,
        char_start: dialogue.char_start,
        char_end: dialogue.char_end,
        audio_url: dialogue.audio_url || null,
        audio_duration: dialogue.audio_duration ?? null,
        audio_status: skipAudio ? 'skipped' : resolveAudioStatus(dialogue, sourceHash),
        skip_audio: skipAudio,
        source_hash: sourceHash,
        error: dialogue.audio_error || null
      };
    })
    .sort((a, b) => a.char_start - b.char_start || a.char_end - b.char_end);
}

function getChapterAudioItems(dialogues) {
  return dialogues
    .filter((dialogue) => dialogue.audio_url && dialogue.audio_status !== 'failed')
    .map((dialogue) => {
      const audioPath = path.resolve(publicDir, String(dialogue.audio_url).replace(/^\/+/, ''));
      return { dialogue, audioPath };
    })
    .filter((item) => item.audioPath.startsWith(publicDir) && fs.existsSync(item.audioPath));
}

function computeChapterAudioHash(audioItems) {
  return hashObject(audioItems.map((item) => {
    const dialogue = item.dialogue || item;
    return {
      id: dialogue.id,
      character_name: dialogue.character_name,
      source: dialogue.source,
      content: normalizeDialogueContent(dialogue.content),
      audio_url: dialogue.audio_url,
      audio_duration: dialogue.audio_duration,
      audio_source_hash: dialogue.audio_source_hash,
      order_index: dialogue.order_index
    };
  }));
}

module.exports = {
  publicDir,
  computeDialogueAudioHash,
  buildChapterAudioItems,
  buildNarratorRanges,
  rangesOverlap,
  isAudioSkipped,
  getChapterAudioItems,
  computeChapterAudioHash,
  normalizeDialogueContent,
  hasSpeakableContent
};
