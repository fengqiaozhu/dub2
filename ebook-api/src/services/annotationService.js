const {
  chapterRepository,
  chapterCharacterRepository,
  dialogueRepository,
  bookCharacterRepository,
  chapterAudioExportRepository
} = require('../repositories');

function buildParagraphs(content = '') {
  const paragraphs = [];
  let start = 0;
  const lines = String(content).split('\n');

  for (let index = 0; index < lines.length; index++) {
    const text = lines[index];
    const end = start + text.length;
    if (text.trim()) {
      paragraphs.push({
        text,
        char_start: start,
        char_end: end,
        paragraph_index: paragraphs.length
      });
    }
    start = end + 1;
  }

  return paragraphs;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function getAnnotationContent(chapter, charStart, charEnd) {
  return String(chapter.content || '').slice(charStart, charEnd);
}

function validateRange(chapter, charStart, charEnd) {
  const contentLength = String(chapter.content || '').length;
  if (!Number.isInteger(charStart) || !Number.isInteger(charEnd)) {
    throw new Error('char_start and char_end must be integers');
  }
  if (charStart < 0 || charEnd <= charStart || charEnd > contentLength) {
    throw new Error('Invalid annotation range');
  }
  if (!getAnnotationContent(chapter, charStart, charEnd).trim()) {
    throw new Error('Annotation range cannot be empty');
  }
}

async function replaceOverlaps(chapter, charStart, charEnd, excludeId = null) {
  const annotations = (await dialogueRepository
    .findByChapterId(chapter.id))
    .filter((dialogue) => dialogue.source !== 'narrator')
    .filter((dialogue) => !excludeId || Number(dialogue.id) !== Number(excludeId))
    .filter((dialogue) => rangesOverlap(charStart, charEnd, dialogue.char_start, dialogue.char_end));

  for (const annotation of annotations) {
    await dialogueRepository.delete(annotation.id);
  }
}

async function invalidateChapterNarrationAndExport(chapterId) {
  await dialogueRepository.deleteByChapterIdAndSource(chapterId, 'narrator');
  await chapterAudioExportRepository.deleteByChapterId(chapterId);
}

async function createAnnotation(chapterId, payload, options = {}) {
  const chapter = await chapterRepository.findById(chapterId);
  if (!chapter) throw new Error('Chapter not found');
  if (payload.type && payload.type !== 'dialogue') {
    throw new Error('Only dialogue annotations are supported');
  }

  const charStart = Number(payload.char_start);
  const charEnd = Number(payload.char_end);
  validateRange(chapter, charStart, charEnd);

  const characterName = String(payload.character_name || '').trim();
  if (!characterName) throw new Error('character_name is required');

  await replaceOverlaps(chapter, charStart, charEnd, options.excludeId);

  const chapterCharacterId = await chapterCharacterRepository.upsert(chapter.id, chapter.book_id, characterName);
  const annotation = {
    chapter_character_id: chapterCharacterId,
    segment_id: null,
    chapter_id: chapter.id,
    content: getAnnotationContent(chapter, charStart, charEnd),
    emotion: payload.emotion ?? '',
    char_start: charStart,
    char_end: charEnd,
    source: payload.source ?? 'manual',
    annotation_status: payload.confirmed ? 'confirmed' : (payload.annotation_status ?? 'manual'),
    updated_by: payload.updated_by ?? 'user',
    order_index: charStart
  };

  let id = options.updateId;
  if (id) {
    await dialogueRepository.update(id, annotation);
    await dialogueRepository.clearAudioById(id);
  } else {
    id = await dialogueRepository.create(annotation);
  }

  await chapterCharacterRepository.deleteUnusedByChapterId(chapter.id);
  await bookCharacterRepository.recalculateForBook(chapter.book_id);
  await invalidateChapterNarrationAndExport(chapter.id);
  return dialogueRepository.findById(id);
}

async function updateAnnotation(id, payload) {
  const existing = await dialogueRepository.findById(id);
  if (!existing) throw new Error('Annotation not found');
  const chapter = await chapterRepository.findById(existing.chapter_id);
  if (!chapter) throw new Error('Chapter not found');

  const charStart = payload.char_start !== undefined ? Number(payload.char_start) : existing.char_start;
  const charEnd = payload.char_end !== undefined ? Number(payload.char_end) : existing.char_end;
  const characterName = payload.character_name !== undefined
    ? String(payload.character_name || '').trim()
    : existing.character_name;
  if (!characterName) throw new Error('character_name is required');
  validateRange(chapter, charStart, charEnd);
  await replaceOverlaps(chapter, charStart, charEnd, id);

  const chapterCharacterId = await chapterCharacterRepository.upsert(chapter.id, chapter.book_id, characterName);
  const annotationStatus = payload.confirmed !== undefined
    ? (payload.confirmed ? 'confirmed' : 'manual')
    : (payload.annotation_status || existing.annotation_status || 'manual');

  await dialogueRepository.update(id, {
    chapter_character_id: chapterCharacterId,
    segment_id: null,
    content: getAnnotationContent(chapter, charStart, charEnd),
    emotion: payload.emotion ?? existing.emotion ?? '',
    char_start: charStart,
    char_end: charEnd,
    source: payload.source ?? existing.source ?? 'manual',
    annotation_status: annotationStatus,
    updated_by: payload.updated_by ?? 'user',
    order_index: charStart
  });
  await dialogueRepository.clearAudioById(id);

  await chapterCharacterRepository.deleteUnusedByChapterId(chapter.id);
  await bookCharacterRepository.recalculateForBook(chapter.book_id);
  await invalidateChapterNarrationAndExport(chapter.id);
  return dialogueRepository.findById(id);
}

async function deleteAnnotation(id) {
  const existing = await dialogueRepository.findById(id);
  if (!existing) throw new Error('Annotation not found');
  await dialogueRepository.delete(id);
  await chapterCharacterRepository.deleteUnusedByChapterId(existing.chapter_id);
  await bookCharacterRepository.recalculateForBook(existing.book_id);
  await invalidateChapterNarrationAndExport(existing.chapter_id);
  return existing;
}

module.exports = {
  buildParagraphs,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
  getAnnotationContent
};
