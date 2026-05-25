const providerRegistry = require('./providerRegistry');
const { normalizeIntent } = require('./ttsIntent');
const { planForProvider } = require('./ttsPlanner');

class TtsService {
  getProviders() {
    return providerRegistry.list();
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

  async synthesize(params = {}) {
    const providerId = params.provider || 'mosi';
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
