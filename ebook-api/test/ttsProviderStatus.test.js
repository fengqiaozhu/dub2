const test = require('node:test');
const assert = require('node:assert/strict');
const providerRegistry = require('../src/services/tts/providerRegistry');
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
