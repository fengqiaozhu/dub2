const aiService = require('./aiService');
const annotationService = require('./annotationService');
const {
  buildChapterAudioItems,
  getChapterAudioItems,
  computeChapterAudioHash,
  rangesOverlap
} = require('./chapterAudioState');
const dubbingPlanner = require('./tts/dubbingPlanner');
const {
  bookRepository,
  chapterRepository,
  chapterCharacterRepository,
  dialogueRepository,
  characterVoiceBindingRepository,
  chapterAudioExportRepository,
  chapterAudioSkipRangeRepository
} = require('../repositories');

const PACKAGE_VERSION = '1.0';

const makeParagraphId = (paragraph) => `p_${String(paragraph.paragraph_index + 1).padStart(4, '0')}`;

const makeSpeechId = (item, index) => {
  if (item.dialogue_id) return `dialogue_${item.dialogue_id}`;
  return `${item.type}_${String(index + 1).padStart(4, '0')}_${item.char_start}_${item.char_end}`;
};

const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildSourceRefs = (paragraphs, charStart, charEnd) => paragraphs
  .filter((paragraph) => rangesOverlap(charStart, charEnd, paragraph.char_start, paragraph.char_end))
  .map((paragraph) => ({
    paragraph_id: paragraph.paragraph_id,
    paragraph_index: paragraph.paragraph_index,
    char_start: Math.max(charStart, paragraph.char_start),
    char_end: Math.min(charEnd, paragraph.char_end),
    usage: 'speech_source'
  }));

const buildAudioTimeline = (speechUnits, audioItems) => {
  let cursor = 0;
  let timelineComplete = true;
  const timeline = [];

  const assets = audioItems.map((item, index) => {
    const speech = speechUnits[index];
    const duration = numberOrNull(item.audio_duration);
    const playable = item.audio_status === 'current' && !item.skip_audio && item.audio_url;
    const startTime = playable && duration !== null && timelineComplete ? cursor : null;
    const endTime = startTime !== null ? startTime + duration : null;

    if (playable && duration !== null && timelineComplete) {
      timeline.push({
        speech_id: speech.speech_id,
        audio_url: item.audio_url,
        start_time: startTime,
        end_time: endTime,
        duration
      });
      cursor = endTime;
    } else if (playable) {
      timelineComplete = false;
    }

    return {
      speech_id: speech.speech_id,
      dialogue_id: item.dialogue_id,
      audio_url: item.audio_url || null,
      duration,
      status: item.audio_status,
      skip_audio: item.skip_audio,
      source_hash: item.source_hash,
      error: item.error || null,
      timeline: {
        start_time: startTime,
        end_time: endTime
      }
    };
  });

  return {
    audio_assets: assets,
    audio_timeline: {
      complete: timelineComplete,
      duration: timelineComplete ? cursor : null,
      items: timeline
    }
  };
};

async function ensureAnalysisTables(chapter, characters) {
  if (characters.length > 0 || !chapter.ai_analysis) return characters;
  try {
    await aiService.persistAnalysisResult(chapter, JSON.parse(chapter.ai_analysis));
    return chapterCharacterRepository.findByChapterId(chapter.id);
  } catch (error) {
    console.warn(`[StorySourcePackage] Failed to repair analysis tables for chapter ${chapter.id}:`, error.message);
    return characters;
  }
}

async function createStorySourcePackage(chapterId) {
  const chapter = await chapterRepository.findById(chapterId);
  if (!chapter) {
    throw new Error('Chapter not found');
  }

  const book = await bookRepository.findById(chapter.book_id);
  let characters = await ensureAnalysisTables(chapter, await chapterCharacterRepository.findByChapterId(chapterId));
  const dialogues = await dialogueRepository.findByChapterId(chapterId);
  const skipRanges = await chapterAudioSkipRangeRepository.findByChapterId(chapterId);
  const paragraphs = annotationService.buildParagraphs(chapter.content || '').map((paragraph) => ({
    paragraph_id: makeParagraphId(paragraph),
    ...paragraph,
    skip_audio: skipRanges.some((range) => rangesOverlap(
      paragraph.char_start,
      paragraph.char_end,
      range.char_start,
      range.char_end
    ))
  }));

  let plan = { roles: [], tasks: [], blocked_dialogues: [], provider_summary: [], stats: null };
  try {
    plan = await dubbingPlanner.createPlan(chapterId, { includeCompleted: true });
  } catch (error) {
    console.warn(`[StorySourcePackage] Failed to build dubbing plan for chapter ${chapterId}:`, error.message);
  }

  const taskMap = new Map((plan.tasks || []).map((task) => [String(task.dialogueId), task]));
  const rolePlanMap = new Map((plan.roles || []).map((role) => [role.character_name, role]));
  const bindingMap = new Map(
    (await characterVoiceBindingRepository
      .findByBookId(chapter.book_id))
      .map((binding) => [binding.character_name, binding])
  );
  const audioItems = buildChapterAudioItems(chapter, dialogues, taskMap, skipRanges);

  const characterNames = new Set(characters.map((character) => character.character_name));
  audioItems.forEach((item) => {
    if (item.character_name) characterNames.add(item.character_name);
  });
  if (audioItems.some((item) => item.type === 'narration')) characterNames.add('旁白');

  characters = Array.from(characterNames).sort((a, b) => {
    if (a === '旁白') return -1;
    if (b === '旁白') return 1;
    return a.localeCompare(b, 'zh-Hans-CN');
  }).map((name) => {
    const existing = characters.find((character) => character.character_name === name);
    const binding = bindingMap.get(name) || null;
    const rolePlan = rolePlanMap.get(name) || null;
    return {
      character_id: existing?.id ? `character_${existing.id}` : `character_${name}`,
      chapter_character_id: existing?.id || null,
      name,
      dialogue_count: existing?.dialogue_count || audioItems.filter((item) => item.character_name === name).length,
      voice_binding: binding ? {
        status: rolePlan?.ready ? 'ready' : (rolePlan?.status || 'bound'),
        provider: binding.provider || null,
        voice_id: binding.voice_id || null,
        provider_voice_id: binding.provider_voice_id || null,
        voice_profile_id: binding.voice_profile_id || null,
        voice_source: binding.voice_source || null,
        model: binding.tts_model || rolePlan?.model || null
      } : {
        status: rolePlan?.status || 'missing_binding',
        provider: null,
        voice_id: null,
        provider_voice_id: null,
        voice_profile_id: null,
        voice_source: null,
        model: null
      }
    };
  });

  const dialogueMap = new Map(dialogues.map((dialogue) => [String(dialogue.id), dialogue]));
  const speechUnits = audioItems.map((item, index) => {
    const dialogue = item.dialogue_id ? dialogueMap.get(String(item.dialogue_id)) : null;
    return {
      speech_id: makeSpeechId(item, index),
      dialogue_id: item.dialogue_id,
      type: item.type,
      speaker: item.character_name,
      text: item.content,
      emotion: dialogue?.emotion || '',
      source: dialogue?.source || (item.type === 'narration' ? 'narrator' : 'derived'),
      char_start: item.char_start,
      char_end: item.char_end,
      source_refs: buildSourceRefs(paragraphs, item.char_start, item.char_end),
      order_index: index
    };
  });

  const { audio_assets: audioAssets, audio_timeline: audioTimeline } = buildAudioTimeline(speechUnits, audioItems);
  const currentIds = new Set(audioItems
    .filter((item) => item.audio_status === 'current')
    .map((item) => String(item.dialogue_id || item.id)));
  const currentAudioItems = getChapterAudioItems(dialogues.filter((dialogue) => currentIds.has(String(dialogue.id))));
  const currentSourceHash = computeChapterAudioHash(currentAudioItems);
  const mergedAudio = await chapterAudioExportRepository.findLatestByChapterId(chapterId);

  return {
    version: PACKAGE_VERSION,
    type: 'story_source_package',
    exported_at: new Date().toISOString(),
    book: book ? {
      id: book.id,
      title: book.title,
      format: book.format,
      author: book.author || null,
      language: book.language || null,
      cover_url: book.cover_url || null
    } : null,
    chapter: {
      id: chapter.id,
      book_id: chapter.book_id,
      title: chapter.title,
      chapter_index: chapter.chapter_index
    },
    text_map: {
      content: chapter.content || '',
      paragraphs
    },
    characters,
    speech_units: speechUnits,
    audio_assets: audioAssets,
    audio_timeline: audioTimeline,
    merged_audio: mergedAudio ? {
      id: mergedAudio.id,
      audio_url: mergedAudio.audio_url,
      format: mergedAudio.format,
      item_count: mergedAudio.item_count,
      source_hash: mergedAudio.source_hash,
      current_source_hash: currentSourceHash,
      is_current: mergedAudio.source_hash === currentSourceHash,
      updated_at: mergedAudio.updated_at
    } : null,
    dubbing_plan: {
      ready: plan.ready === true,
      provider_summary: plan.provider_summary || [],
      stats: plan.stats || null,
      blocked_dialogues: plan.blocked_dialogues || []
    },
    exports: {
      story_source_package_url: `/api/chapters/${chapter.id}/story-source-package`,
      audio_archive_url: `/api/chapters/${chapter.id}/export-audio`,
      merged_audio_export_url: `/api/chapters/${chapter.id}/export-audio/merged`
    }
  };
}

module.exports = {
  createStorySourcePackage
};
