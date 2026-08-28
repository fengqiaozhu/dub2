const test = require('node:test');
const assert = require('node:assert/strict');
const providerConfigService = require('../src/services/tts/providerConfigService');
const { ttsConfigRepository } = require('../src/repositories');

function preserveEnvironment(t, names) {
  const originals = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  t.after(() => {
    for (const [name, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

test('an active database configuration is the effective provider configuration', async (t) => {
  const originalFindByProvider = ttsConfigRepository.findByProvider;
  preserveEnvironment(t, ['FISH_API_KEY', 'FISH_DEFAULT_MODEL']);
  process.env.FISH_API_KEY = 'environment-key';
  process.env.FISH_DEFAULT_MODEL = 'environment-model';
  ttsConfigRepository.findByProvider = async () => [{
    id: 12,
    name: 'Fish production',
    provider: 'fish_audio',
    api_key: 'database-key',
    model: 's2.1-pro',
    is_active: true
  }];
  t.after(() => {
    ttsConfigRepository.findByProvider = originalFindByProvider;
  });

  const config = await providerConfigService.resolveProviderConfig('fish_audio');

  assert.equal(config.id, 12);
  assert.equal(config.api_key, 'database-key');
  assert.equal(config.source, 'database');
});

test('stored but inactive configurations prevent a hidden environment fallback', async (t) => {
  const originalFindByProvider = ttsConfigRepository.findByProvider;
  preserveEnvironment(t, ['MOSI_API_KEY']);
  process.env.MOSI_API_KEY = 'environment-key';
  ttsConfigRepository.findByProvider = async () => [{
    id: 8,
    name: 'Mosi standby',
    provider: 'mosi',
    api_key: 'database-key',
    is_active: false
  }];
  t.after(() => {
    ttsConfigRepository.findByProvider = originalFindByProvider;
  });

  const config = await providerConfigService.resolveProviderConfig('mosi');

  assert.equal(config, null);
});

test('environment variables become a visible compatibility configuration only when no stored config exists', async (t) => {
  const originalFindByProvider = ttsConfigRepository.findByProvider;
  preserveEnvironment(t, ['FISH_SELF_HOSTED_BASE_URL']);
  process.env.FISH_SELF_HOSTED_BASE_URL = 'http://fish.local:8080/';
  ttsConfigRepository.findByProvider = async () => [];
  t.after(() => {
    ttsConfigRepository.findByProvider = originalFindByProvider;
  });

  const capabilities = [{
    provider: 'fish_audio_self_hosted',
    displayName: 'Fish Audio Self-hosted',
    models: []
  }];
  const groups = await providerConfigService.buildProviderGroups(capabilities, [{
    provider: 'fish_audio_self_hosted',
    synthesis_available: true
  }]);

  assert.equal(groups[0].configuration_state, 'active');
  assert.equal(groups[0].active_config.source, 'environment');
  assert.equal(groups[0].active_config.read_only, true);
  assert.equal(groups[0].active_config.api_url, 'http://fish.local:8080/');
  assert.equal(groups[0].status.synthesis_available, true);
});

test('public provider groups never expose API keys', async (t) => {
  const originalFindByProvider = ttsConfigRepository.findByProvider;
  ttsConfigRepository.findByProvider = async () => [{
    id: 9,
    name: 'Primary Mosi',
    provider: 'mosi',
    api_key: 'must-not-leak',
    model: 'moss-tts',
    is_active: true
  }];
  t.after(() => {
    ttsConfigRepository.findByProvider = originalFindByProvider;
  });

  const [group] = await providerConfigService.buildProviderGroups([{
    provider: 'mosi',
    displayName: 'Mosi',
    models: []
  }]);

  assert.equal(group.active_config.has_api_key, true);
  assert.equal('api_key' in group.active_config, false);
  assert.equal(JSON.stringify(group).includes('must-not-leak'), false);
});
