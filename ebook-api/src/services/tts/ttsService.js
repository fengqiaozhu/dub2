const providerRegistry = require('./providerRegistry');
const { normalizeIntent } = require('./ttsIntent');
const { planForProvider } = require('./ttsPlanner');

class TtsService {
  getProviders() {
    return providerRegistry.list();
  }

  async getProviderStatuses() {
    const providers = providerRegistry.list();
    const statuses = await Promise.all(providers.map(async (provider) => {
      const providerInstance = providerRegistry.get(provider.provider);
      if (typeof providerInstance.getStatus === 'function') {
        const status = await providerInstance.getStatus();
        return {
          provider: provider.provider,
          synthesis_available: status.available,
          reason: status.reason,
          configured: status.configured,
          status: status.status
        };
      }

      if (provider.provider !== 'fish_audio') {
        return {
          provider: provider.provider,
          synthesis_available: true,
          reason: null
        };
      }

      const fishAudioService = require('../fishAudioService');
      const credit = await fishAudioService.getApiCredit();
      return {
        provider: provider.provider,
        synthesis_available: credit.available,
        reason: credit.reason,
        credit: credit.credit,
        configured: credit.configured,
        status: credit.status
      };
    }));

    return statuses;
  }

  getProvider(providerId = 'mosi') {
    return providerRegistry.get(providerId);
  }

  async listVoices(params = {}) {
    const provider = this.getProvider(params.provider || 'mosi');
    return provider.listVoices(params);
  }

  async cloneVoice(params = {}) {
    const provider = this.getProvider(params.provider || 'mosi');
    return provider.cloneVoice(params);
  }

  async deleteVoice({ provider, voiceId }) {
    const providerInstance = this.getProvider(provider);
    if (typeof providerInstance.deleteVoice !== 'function') {
      return { skipped: true, reason: `${provider} does not support remote voice deletion` };
    }
    return providerInstance.deleteVoice(voiceId);
  }

  async synthesize(params = {}) {
    const providerId = params.provider || 'mosi';
    if (providerId === 'fish_audio') {
      const fishAudioService = require('../fishAudioService');
      const credit = await fishAudioService.getApiCredit();
      if (!credit.available) {
        const error = new Error(credit.reason || 'Fish Audio API credit is insufficient');
        error.statusCode = 402;
        error.provider = providerId;
        error.credit = credit.credit;
        throw error;
      }
    }

    const provider = this.getProvider(providerId);
    const intent = normalizeIntent(params);
    const plan = planForProvider(provider, { ...params, intent });
    const result = await provider.synthesize({
      text: params.text,
      voiceId: params.voiceId || params.voice_id,
      model: plan.model,
      options: plan.providerOptions
    });

    return {
      ...result,
      provider: providerId,
      model: plan.model,
      applied_controls: plan.appliedControls
    };
  }
}

module.exports = new TtsService();
