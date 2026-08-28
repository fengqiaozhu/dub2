const test = require('node:test');
const assert = require('node:assert/strict');
const providerRegistry = require('../src/services/tts/providerRegistry');
const providerConfigService = require('../src/services/tts/providerConfigService');
const ttsService = require('../src/services/tts/ttsService');

test('provider status endpoint data keeps Mosi billing details', async (t) => {
  const originalList = providerRegistry.list;
  const originalGet = providerRegistry.get;
  const billing = {
    source: 'local_usage',
    balance_available: false,
    balance_status: 'unknown',
    total_credit_cost: 25
  };

  providerRegistry.list = () => [{ provider: 'mosi' }];
  providerRegistry.get = () => ({
    getStatus: async () => ({
      available: true,
      configured: true,
      reason: null,
      status: 'ready',
      billing
    })
  });
  t.after(() => {
    providerRegistry.list = originalList;
    providerRegistry.get = originalGet;
  });

  const statuses = await ttsService.getProviderStatuses();
  assert.deepEqual(statuses[0].billing, billing);
  assert.equal(statuses[0].synthesis_available, true);
});

test('synthesis uses the active provider configuration model over a stale binding model', async (t) => {
  const originalResolve = providerConfigService.resolveProviderConfig;
  const originalGet = providerRegistry.get;
  let synthesizedModel;

  providerConfigService.resolveProviderConfig = async () => ({
    id: 17,
    name: 'Current Mosi',
    provider: 'mosi',
    model: 'moss-tts-current',
    source: 'database',
    is_active: true
  });
  providerRegistry.get = () => ({
    id: 'mosi',
    getCapabilities: () => ({
      defaultModel: 'moss-tts',
      models: [{ id: 'moss-tts', capabilities: {} }]
    }),
    synthesize: async ({ model }) => {
      synthesizedModel = model;
      return { url: '/media/test.wav' };
    }
  });
  t.after(() => {
    providerConfigService.resolveProviderConfig = originalResolve;
    providerRegistry.get = originalGet;
  });

  const result = await ttsService.synthesize({
    provider: 'mosi',
    text: '测试',
    voice_id: 'voice-1',
    model: 'stale-binding-model'
  });

  assert.equal(synthesizedModel, 'moss-tts-current');
  assert.equal(result.model, 'moss-tts-current');
  assert.deepEqual(result.provider_config, {
    id: 17,
    name: 'Current Mosi',
    source: 'database',
    model: 'moss-tts-current'
  });
});

test('synthesis fails before calling a provider when no configuration is active', async (t) => {
  const originalResolve = providerConfigService.resolveProviderConfig;
  providerConfigService.resolveProviderConfig = async () => null;
  t.after(() => {
    providerConfigService.resolveProviderConfig = originalResolve;
  });

  await assert.rejects(
    () => ttsService.synthesize({ provider: 'fish_audio_self_hosted', text: '测试', voice_id: 'voice-1' }),
    (error) => error.statusCode === 503 && error.provider === 'fish_audio_self_hosted'
  );
});
