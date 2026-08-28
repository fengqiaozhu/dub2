const {
  chapterRepository,
  dialogueRepository,
  characterVoiceBindingRepository,
  chapterAudioSkipRangeRepository
} = require('../../repositories');
const { resolveBinding } = require('./voiceResolver');
const {
  computeDialogueAudioHash,
  buildNarratorRanges,
  isAudioSkipped,
  normalizeDialogueContent,
  hasSpeakableContent
} = require('../chapterAudioState');
const providerRegistry = require('./providerRegistry');
const providerConfigService = require('./providerConfigService');

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

function mergeTaskIntent(baseIntent, dialogue) {
  const emotion = String(dialogue.emotion || '').trim();
  if (!emotion) return baseIntent;

  return {
    ...(baseIntent || {}),
    performance: {
      ...(baseIntent?.performance || {}),
      emotion
    }
  };
}

function buildEmotionWarnings(tasks) {
  const grouped = new Map();

  for (const task of tasks) {
    if (!task.intent?.performance?.emotion) continue;

    const provider = providerRegistry.get(task.provider);
    const capabilities = provider.getCapabilities();
    const modelId = task.model || capabilities.defaultModel;
    const model = capabilities.models.find((item) => item.id === modelId) || capabilities.models[0];
    if (model?.capabilities?.emotionControl && model.capabilities.emotionControl !== 'none') continue;

    if (!grouped.has(task.provider)) {
      grouped.set(task.provider, {
        provider: task.provider,
        dialogue_count: 0,
        roles: new Set()
      });
    }
    const warning = grouped.get(task.provider);
    warning.dialogue_count += 1;
    warning.roles.add(task.characterName);
  }

  return Array.from(grouped.values()).map((warning) => ({
    provider: warning.provider,
    type: 'emotion_unsupported',
    dialogue_count: warning.dialogue_count,
    roles: Array.from(warning.roles),
    message: `${warning.provider}：本章 ${warning.dialogue_count} 句包含 emotion，但该平台不支持情绪控制，配音时将忽略。`
  }));
}

async function getDubbingRoles(chapterId, skipRanges = []) {
  const roles = new Set(['旁白']);
  const dialogues = await dialogueRepository.findByChapterId(chapterId);
  for (const dialogue of dialogues) {
    if (
      dialogue.character_name &&
      hasSpeakableContent(dialogue) &&
      dialogue.source !== 'narrator' &&
      !isAudioSkipped(dialogue, skipRanges)
    ) {
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

async function createPlan(chapterId, options = {}) {
  const chapter = await chapterRepository.findById(chapterId);
  if (!chapter) {
    throw new Error('Chapter not found');
  }

  const storedDialogues = await dialogueRepository.findByChapterId(chapterId);
  const skipRanges = await chapterAudioSkipRangeRepository.findByChapterId(chapterId);
  const hasNarratorRows = storedDialogues.some((dialogue) => dialogue.source === 'narrator');
  const dialogues = (hasNarratorRows ? storedDialogues : storedDialogues.concat(buildNarratorDialogues(chapter, storedDialogues)))
    .filter((dialogue) => (
      hasSpeakableContent(dialogue) &&
      dialogue.character_name &&
      (dialogue.source === 'narrator' || dialogue.char_start >= 0) &&
      !isAudioSkipped(dialogue, skipRanges)
    ));
  const bindings = await characterVoiceBindingRepository.findByBookId(chapter.book_id);
  const bindingMap = new Map(bindings.map((binding) => [binding.character_name, binding]));
  const roles = await getDubbingRoles(chapterId, skipRanges);
  const providerConfigCache = new Map();

  const getActiveProviderConfig = async (provider) => {
    if (!providerConfigCache.has(provider)) {
      providerConfigCache.set(provider, providerConfigService.resolveProviderConfig(provider));
    }
    return await providerConfigCache.get(provider);
  };

  const rolePlans = await Promise.all(roles.map(async (characterName) => {
    const binding = bindingMap.get(characterName);
    if (!binding) {
      return {
        character_name: characterName,
        ready: false,
        status: 'missing_binding',
        message: '未绑定音色'
      };
    }

    const resolved = await resolveBinding(binding, { requireActive: true });
    const providerConfig = resolved.ready
      ? await getActiveProviderConfig(resolved.provider)
      : null;
    const providerReady = resolved.ready && Boolean(providerConfig);
    const effectiveModel = String(providerConfig?.model || '').trim()
      || resolved.model
      || (providerReady ? providerRegistry.get(resolved.provider).getCapabilities().defaultModel : undefined);
    return {
      character_name: characterName,
      ready: providerReady,
      status: resolved.ready && !providerConfig ? 'provider_unconfigured' : resolved.status,
      message: resolved.ready && !providerConfig
        ? `${resolved.provider} 没有生效的 TTS 配置`
        : resolved.message,
      provider: resolved.provider,
      provider_voice_id: resolved.providerVoiceId,
      voice_profile_id: resolved.voiceProfileId,
      model: effectiveModel,
      voice_source: binding.voice_source,
      binding_mode: binding.voice_profile_id ? 'voice_profile' : 'provider_voice',
      route: providerReady ? {
        provider: resolved.provider,
        provider_voice_id: resolved.providerVoiceId,
        voice_profile_id: resolved.voiceProfileId,
        model: effectiveModel,
        provider_config_id: providerConfig.id ?? null,
        provider_config_source: providerConfig.source || 'database',
        source: resolved.source
      } : null,
      intent: resolved.intent
    };
  }));

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

    const intent = mergeTaskIntent(rolePlan.intent, dialogue);
    const text = normalizeDialogueContent(dialogue.content);
    const task = {
      dialogueId: dialogue.id,
      characterName: dialogue.character_name,
      text,
      provider: rolePlan.route.provider,
      voiceId: rolePlan.route.provider_voice_id,
      providerVoiceId: rolePlan.route.provider_voice_id,
      voiceProfileId: rolePlan.route.voice_profile_id,
      model: rolePlan.route.model,
      intent,
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
    warnings: buildEmotionWarnings(tasks),
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
