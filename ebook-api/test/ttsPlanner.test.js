const test = require('node:test');
const assert = require('node:assert/strict');
const { planForProvider } = require('../src/services/tts/ttsPlanner');

const provider = {
  id: 'fish_audio',
  getCapabilities() {
    return {
      defaultModel: 's2.1-pro',
      models: [
        {
          id: 's2.1-pro',
          capabilities: {
            speedControl: true,
            outputFormats: ['mp3', 'wav']
          }
        }
      ]
    };
  }
};

test('passes a future Fish model through without falling back to a declared model', () => {
  const plan = planForProvider(provider, {
    model: 's2.2-pro',
    intent: {
      performance: { speakingRate: 1.1 },
      output: { format: 'wav' }
    }
  });

  assert.equal(plan.model, 's2.2-pro');
  assert.equal(plan.providerOptions.speed, 1.1);
  assert.equal(plan.providerOptions.outputFormat, 'wav');
});
