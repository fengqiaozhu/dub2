const test = require('node:test');
const assert = require('node:assert/strict');
const fishAudioService = require('../src/services/fishAudioService');

test('uses the account recommendation when no model is configured', async (t) => {
  const originalGetActiveConfig = fishAudioService.getActiveConfig;
  const originalEnvModel = process.env.FISH_DEFAULT_MODEL;
  fishAudioService.getActiveConfig = async () => null;
  delete process.env.FISH_DEFAULT_MODEL;
  t.after(() => {
    fishAudioService.getActiveConfig = originalGetActiveConfig;
    if (originalEnvModel === undefined) delete process.env.FISH_DEFAULT_MODEL;
    else process.env.FISH_DEFAULT_MODEL = originalEnvModel;
  });

  const model = await fishAudioService.getConfiguredModel({
    accountStatus: { recommended_model: 's2.1-pro-free' }
  });

  assert.equal(model, 's2.1-pro-free');
});

test('an explicitly configured model takes precedence over account recommendations', async (t) => {
  const originalGetActiveConfig = fishAudioService.getActiveConfig;
  fishAudioService.getActiveConfig = async () => ({ model: 's2.2-pro' });
  t.after(() => {
    fishAudioService.getActiveConfig = originalGetActiveConfig;
  });

  const model = await fishAudioService.getConfiguredModel({
    accountStatus: { recommended_model: 's2.1-pro-free' }
  });

  assert.equal(model, 's2.2-pro');
});
