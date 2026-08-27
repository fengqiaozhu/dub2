const axios = require('axios');

const OPENAPI_URL = process.env.FISH_OPENAPI_URL || 'https://api.fish.audio/openapi.json';
const CACHE_TTL_MS = Number(process.env.FISH_MODEL_CACHE_TTL_MS) || 6 * 60 * 60 * 1000;
const FALLBACK_MODELS = ['s2.1-pro', 's2.1-pro-free', 's2-pro', 's1'];

function uniqueModels(models = []) {
  return [...new Set(models
    .map((model) => String(model || '').trim())
    .filter(Boolean))];
}

function extractModelsFromOpenApi(document = {}) {
  const parameters = document.paths?.['/v1/tts']?.post?.parameters || [];
  const modelParameter = parameters.find((parameter) => (
    parameter?.in === 'header' && parameter?.name === 'model'
  ));
  return uniqueModels(modelParameter?.schema?.enum || []);
}

class FishAudioCatalogService {
  constructor() {
    this.cache = null;
  }

  async listModels({ refresh = false } = {}) {
    const now = Date.now();
    if (!refresh && this.cache && now - this.cache.fetchedAt < CACHE_TTL_MS) {
      return { ...this.cache, cached: true };
    }

    try {
      const response = await axios.get(OPENAPI_URL, { timeout: 15000 });
      const models = extractModelsFromOpenApi(response.data);
      if (models.length === 0) {
        throw new Error('Fish Audio OpenAPI does not declare any TTS models');
      }

      this.cache = {
        models,
        defaultModel: response.data?.paths?.['/v1/tts']?.post?.parameters
          ?.find((parameter) => parameter?.in === 'header' && parameter?.name === 'model')
          ?.schema?.default || models[0],
        freeDefaultModel: models.includes('s2.1-pro-free') ? 's2.1-pro-free' : null,
        source: 'fish_openapi',
        fetchedAt: now
      };
      return { ...this.cache, cached: false };
    } catch (error) {
      const cachedModels = this.cache?.models || FALLBACK_MODELS;
      return {
        models: cachedModels,
        defaultModel: this.cache?.defaultModel || 's2.1-pro',
        freeDefaultModel: this.cache?.freeDefaultModel || 's2.1-pro-free',
        source: this.cache ? 'stale_cache' : 'fallback',
        fetchedAt: this.cache?.fetchedAt || null,
        cached: Boolean(this.cache),
        warning: error.message
      };
    }
  }
}

module.exports = new FishAudioCatalogService();
module.exports.FALLBACK_MODELS = FALLBACK_MODELS;
module.exports.extractModelsFromOpenApi = extractModelsFromOpenApi;
