const mosiProvider = require('./providers/mosiProvider');

class ProviderRegistry {
  constructor() {
    this.providers = new Map();
    this.register(mosiProvider);
  }

  register(provider) {
    this.providers.set(provider.id, provider);
  }

  get(providerId = 'mosi') {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Unsupported TTS provider: ${providerId}`);
    }
    return provider;
  }

  list() {
    return Array.from(this.providers.values()).map((provider) => provider.getCapabilities());
  }
}

module.exports = new ProviderRegistry();
