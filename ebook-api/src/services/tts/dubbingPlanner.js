const SqliteChapterRepository = require('../../repositories/sqlite/SqliteChapterRepository');
const SqliteDialogueRepository = require('../../repositories/sqlite/SqliteDialogueRepository');
const SqliteChapterCharacterRepository = require('../../repositories/sqlite/SqliteChapterCharacterRepository');
const SqliteCharacterVoiceBindingRepository = require('../../repositories/sqlite/SqliteCharacterVoiceBindingRepository');
const { resolveBinding } = require('./voiceResolver');
const { computeDialogueAudioHash, buildNarratorRanges } = require('../chapterAudioState');

const chapterRepository = new SqliteChapterRepository();
const dialogueRepository = new SqliteDialogueRepository();
const chapterCharacterRepository = new SqliteChapterCharacterRepository();
const characterVoiceBindingRepository = new SqliteCharacterVoiceBindingRepository();

function createEmptyProviderSummary(provider) {
  return {
    provider,
    dialogue_count: 0,
    role_count: 0,
    roles: []
  };
}

function buildProviderSummary(tasks) {
  const grouped = new Map();
  const roleSets = new Map();

  for (const task of tasks) {
    if (!grouped.has(task.provider)) {
      grouped.set(task.provider, createEmptyProviderSummary(task.provider));
      roleSets.set(task.provider, new Set());
    }

    const summary = grouped.get(task.provider);
    const roles = roleSets.get(task.provider);
    summary.dialogue_count += 1;
    roles.add(task.characterName);
  }

  for (const [provider, roles] of roleSets) {
    const summary = grouped.get(provider);
    summary.roles = Array.from(roles);
    summary.role_count = summary.roles.length;
  }

  return Array.from(grouped.values());
}

function getDubbingRoles(chapterId) {
  const roles = new Set(['旁白']);
  const dialogues = dialogueRepository.findByChapterId(chapterId);
  for (const dialogue of dialogues) {
    if (dialogue.character_name && dialogue.content && dialogue.source !== 'narrator') {
      roles.add(dialogue.character_name);
    }
  }
  return Array.from(roles);
}

function buildNarratorDialogues(chapter, annotations) {
  return buildNarratorRanges(chapter, annotations);
}

function needsDubbing(dialogue, sourceHash, options) {
  if (options.includeCompleted) return true;
  if (!dialogue.audio_url) return true;
  if (dialogue.audio_status === 'failed') return true;
  return dialogue.audio_source_hash !== sourceHash;
}

function createPlan(chapterId, options = {}) {
  const chapter = chapterRepository.findById(chapterId);
  if (!chapter) {
    throw new Error('Chapter not found');
  }

  const storedDialogues = dialogueRepository.findByChapterId(chapterId);
  const hasNarratorRows = storedDialogues.some((dialogue) => dialogue.source === 'narrator');
  const dialogues = (hasNarratorRows ? storedDialogues : storedDialogues.concat(buildNarratorDialogues(chapter, storedDialogues)))
    .filter((dialogue) => (
      dialogue.content &&
      dialogue.character_name &&
      (dialogue.source === 'narrator' || dialogue.char_start >= 0)
    ));
  const bindings = characterVoiceBindingRepository.findByBookId(chapter.book_id);
  const bindingMap = new Map(bindings.map((binding) => [binding.character_name, binding]));
  const roles = getDubbingRoles(chapterId);

  const rolePlans = roles.map((characterName) => {
    const binding = bindingMap.get(characterName);
    if (!binding) {
      return {
        character_name: characterName,
        ready: false,
        status: 'missing_binding',
        message: '未绑定音色'
      };
    }

    const resolved = resolveBinding(binding, { requireActive: true });
    return {
      character_name: characterName,
      ready: resolved.ready,
      status: resolved.status,
      message: resolved.message,
      provider: resolved.provider,
      provider_voice_id: resolved.providerVoiceId,
      voice_profile_id: resolved.voiceProfileId,
      model: resolved.model,
      voice_source: binding.voice_source,
      binding_mode: binding.voice_profile_id ? 'voice_profile' : 'provider_voice',
      route: resolved.ready ? {
        provider: resolved.provider,
        provider_voice_id: resolved.providerVoiceId,
        voice_profile_id: resolved.voiceProfileId,
        model: resolved.model,
        source: resolved.source
      } : null,
      intent: resolved.intent
    };
  });

  const rolePlanMap = new Map(rolePlans.map((role) => [role.character_name, role]));
  const tasks = [];
  const blockedDialogues = [];

  for (const dialogue of dialogues) {
    const rolePlan = rolePlanMap.get(dialogue.character_name);
    if (!rolePlan?.ready) {
      blockedDialogues.push({
        dialogueId: dialogue.id,
        characterName: dialogue.character_name,
        text: dialogue.content,
        status: rolePlan?.status || 'missing_binding',
        message: rolePlan?.message || '未绑定音色'
      });
      continue;
    }

    const task = {
      dialogueId: dialogue.id,
      characterName: dialogue.character_name,
      text: dialogue.content,
      provider: rolePlan.route.provider,
      voiceId: rolePlan.route.provider_voice_id,
      providerVoiceId: rolePlan.route.provider_voice_id,
      voiceProfileId: rolePlan.route.voice_profile_id,
      model: rolePlan.route.model,
      intent: rolePlan.intent,
      orderIndex: dialogue.segment_index ?? dialogue.order_index,
      charStart: dialogue.char_start
    };
    task.sourceHash = computeDialogueAudioHash(dialogue, task);
    if (!needsDubbing(dialogue, task.sourceHash, options)) continue;
    tasks.push(task);
  }

  const blockingRoles = rolePlans.filter((role) => !role.ready);

  return {
    chapter: {
      id: chapter.id,
      book_id: chapter.book_id,
      title: chapter.title
    },
    ready: blockingRoles.length === 0 && blockedDialogues.length === 0,
    roles: rolePlans,
    tasks,
    blocked_dialogues: blockedDialogues,
    provider_summary: buildProviderSummary(tasks),
    stats: {
      roles_total: rolePlans.length,
      roles_ready: rolePlans.length - blockingRoles.length,
      roles_blocked: blockingRoles.length,
      dialogue_total: dialogues.length,
      dialogue_ready: tasks.length,
      dialogue_blocked: blockedDialogues.length
    }
  };
}

module.exports = {
  createPlan
};
