const {
  chapterSegmentRepository,
  dialogueRepository
} = require('../repositories');

const SENTENCE_END = new Set(['。', '！', '？', '!', '?', '…']);
const CLOSING_QUOTES = new Set(['"', "'", '”', '’', '」', '』', '）', ')', '】', '》']);

function shouldBreakAt(text, index) {
  const char = text[index];
  if (char === '\n') return true;
  if (char === '.' && !/\d/.test(text[index - 1] || '') && !/\d/.test(text[index + 1] || '')) return true;
  return SENTENCE_END.has(char);
}

function consumeClosingQuotes(text, index) {
  let end = index + 1;
  while (end < text.length && SENTENCE_END.has(text[end])) {
    end += 1;
  }
  while (end < text.length && CLOSING_QUOTES.has(text[end])) {
    end += 1;
  }
  return end;
}

function pushSegment(segments, content, start, end) {
  let left = start;
  let right = end;
  while (left < right && /\s/.test(content[left])) left += 1;
  while (right > left && /\s/.test(content[right - 1])) right -= 1;
  if (right <= left) return;

  segments.push({
    content: content.slice(left, right),
    segment_index: segments.length,
    char_start: left,
    char_end: right,
    segment_type: 'unknown'
  });
}

function splitContentIntoSegments(content = '') {
  const segments = [];
  let start = 0;
  let index = 0;

  while (index < content.length) {
    if (shouldBreakAt(content, index)) {
      const end = content[index] === '\n'
        ? index
        : consumeClosingQuotes(content, index);
      pushSegment(segments, content, start, end);
      start = content[index] === '\n' ? index + 1 : end;
      index = start;
      continue;
    }
    index += 1;
  }

  pushSegment(segments, content, start, content.length);
  return segments;
}

async function ensureSegmentsForChapter(chapter) {
  let segments = await chapterSegmentRepository.findByChapterId(chapter.id);
  if (segments.length > 0) return segments;

  const generated = splitContentIntoSegments(chapter.content || '');
  if (generated.length === 0) return [];
  await chapterSegmentRepository.createMany(chapter.id, generated);
  segments = await chapterSegmentRepository.findByChapterId(chapter.id);
  await backfillDialogueSegmentIds(chapter.id, segments);
  return chapterSegmentRepository.findByChapterId(chapter.id);
}

function findBestSegmentForRange(segments, start, end) {
  if (typeof start !== 'number' || typeof end !== 'number' || start < 0 || end <= start) {
    return null;
  }

  return segments.find((segment) => (
    start >= segment.char_start &&
    end <= segment.char_end
  )) || null;
}

function findBestSegmentForText(segments, text) {
  const normalized = String(text || '').trim();
  if (!normalized) return null;
  return segments.find((segment) => segment.content.trim() === normalized) ||
    segments.find((segment) => segment.content.includes(normalized) || normalized.includes(segment.content.trim())) ||
    null;
}

async function backfillDialogueSegmentIds(chapterId, segments) {
  const dialogues = await dialogueRepository.findByChapterId(chapterId);
  for (const dialogue of dialogues) {
    if (dialogue.segment_id) continue;
    const segment = findBestSegmentForRange(segments, dialogue.char_start, dialogue.char_end) ||
      findBestSegmentForText(segments, dialogue.content);
    if (segment) {
      await dialogueRepository.update(dialogue.id, {
        segment_id: segment.id,
        annotation_status: dialogue.source === 'manual' ? 'manual' : 'ai'
      });
      if (dialogue.source !== 'narrator') {
        await chapterSegmentRepository.updateType(segment.id, 'dialogue');
      }
    }
  }
}

module.exports = {
  splitContentIntoSegments,
  ensureSegmentsForChapter,
  findBestSegmentForRange,
  findBestSegmentForText,
  backfillDialogueSegmentIds
};
