const { providerVoiceRepository } = require('../../repositories');

function parseJson(value) {
  if (!value) return undefined;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return undefined;
  }
}

function normalizeStatus(status) {
  return String(status || 'ACTIVE').toUpperCase();
}

function isActive(status) {
  return ['ACTIVE', 'DONE'].includes(normalizeStatus(status));
}

async function resolveBinding(binding, options = {}) {
  const provider = binding.provider || binding.preferred_provider || 'mosi';
  const rawProviderVoiceId = binding.provider_voice_id || (
    binding.voice_id && !String(binding.voice_id).startsWith('profile:') ? binding.voice_id : null
  );
  const providerVoiceId = rawProviderVoiceId && !String(rawProviderVoiceId).startsWith('profile:')
    ? rawProviderVoiceId
    : null;

  if (providerVoiceId) {
    const providerVoice = await providerVoiceRepository.findByProviderVoiceId(provider, providerVoiceId);
    if (binding.voice_source === 'system') {
      return {
        ready: true,
        status: 'ready',
        source: 'provider_voice',
        provider,
        voiceId: providerVoiceId,
        providerVoiceId,
        voiceProfileId: null,
        model: binding.tts_model || providerVoice?.provider_model || undefined,
        intent: parseJson(binding.intent_defaults),
        providerVoice
      };
    }
    if (!providerVoice) {
      return {
        ready: false,
        status: 'provider_voice_missing',
        message: `${provider} 音色 ${providerVoiceId} 未在当前平台账号中确认存在`,
        binding,
        provider,
        providerVoiceId
      };
    }
    if (!isActive(providerVoice.status)) {
      return {
        ready: false,
        status: 'provider_voice_not_ready',
        message: `${provider} 音色 ${providerVoiceId} 当前状态为 ${providerVoice.status || 'UNKNOWN'}`,
        binding,
        provider,
        providerVoice
      };
    }

    return {
      ready: true,
      status: 'ready',
      source: binding.voice_profile_id ? 'voice_profile_projection' : 'provider_voice',
      provider,
      voiceId: providerVoiceId,
      providerVoiceId,
      voiceProfileId: binding.voice_profile_id || providerVoice?.voice_profile_id || null,
      model: binding.tts_model || providerVoice?.provider_model || undefined,
      intent: parseJson(binding.intent_defaults),
      providerVoice
    };
  }

  if (binding.voice_profile_id) {
    const providerVoice = await providerVoiceRepository.findActiveByProfileId(binding.voice_profile_id, provider);
    if (!providerVoice) {
      return {
        ready: false,
        status: 'needs_projection',
        message: `音色资产尚未克隆到 ${provider}`,
        binding,
        provider,
        voiceProfileId: binding.voice_profile_id
      };
    }

    return {
      ready: true,
      status: 'ready',
      source: 'voice_profile_projection',
      provider: providerVoice.provider,
      voiceId: providerVoice.provider_voice_id,
      providerVoiceId: providerVoice.provider_voice_id,
      voiceProfileId: binding.voice_profile_id,
      model: binding.tts_model || providerVoice.provider_model || undefined,
      intent: parseJson(binding.intent_defaults),
      providerVoice
    };
  }

  return {
    ready: false,
    status: 'missing_binding',
    message: '未绑定音色',
    binding,
    provider
  };
}

module.exports = {
  resolveBinding
};
