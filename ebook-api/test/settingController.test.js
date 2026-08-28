const test = require('node:test');
const assert = require('node:assert/strict');
const settingController = require('../src/controllers/settingController');
const fishAudioCatalogService = require('../src/services/fishAudioCatalogService');
const fishAudioService = require('../src/services/fishAudioService');
const { ttsConfigRepository } = require('../src/repositories');

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

test('Fish model endpoint combines OpenAPI suggestions with account recommendation', async (t) => {
  const originalListModels = fishAudioCatalogService.listModels;
  const originalGetApiCredit = fishAudioService.getApiCredit;
  fishAudioCatalogService.listModels = async () => ({
    models: ['s2.1-pro', 's2.1-pro-free', 's2.2-pro'],
    defaultModel: 's2.1-pro',
    source: 'fish_openapi'
  });
  fishAudioService.getApiCredit = async () => ({
    available: true,
    recommended_model: 's2.1-pro-free'
  });
  t.after(() => {
    fishAudioCatalogService.listModels = originalListModels;
    fishAudioService.getApiCredit = originalGetApiCredit;
  });

  const response = createResponse();
  await settingController.getFishAudioModels({ query: {} }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.data.models, ['s2.1-pro', 's2.1-pro-free', 's2.2-pro']);
  assert.equal(response.body.data.recommendedModel, 's2.1-pro-free');
});

test('TTS configuration persists a manually entered future model', async (t) => {
  const originalCreate = ttsConfigRepository.create;
  let savedConfig;
  ttsConfigRepository.create = async (config) => {
    savedConfig = config;
    return 42;
  };
  t.after(() => {
    ttsConfigRepository.create = originalCreate;
  });

  const response = createResponse();
  await settingController.createTtsConfig({
    body: {
      name: 'Future Fish',
      provider: 'fish_audio',
      api_key: 'redacted-test-key',
      model: '  s2.2-pro  ',
      is_active: false
    }
  }, response);

  assert.equal(response.statusCode, 201);
  assert.equal(savedConfig.model, 's2.2-pro');
});

test('TTS configuration rejects providers outside the three supported types', async () => {
  const response = createResponse();
  await settingController.createTtsConfig({
    body: {
      name: 'Unknown provider',
      provider: 'other_tts',
      api_key: 'redacted-test-key'
    }
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, 'Unsupported TTS provider');
});
