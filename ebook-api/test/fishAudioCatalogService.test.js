const test = require('node:test');
const assert = require('node:assert/strict');
const { extractModelsFromOpenApi } = require('../src/services/fishAudioCatalogService');

test('extracts TTS backend models from the Fish OpenAPI model header', () => {
  const models = extractModelsFromOpenApi({
    paths: {
      '/v1/tts': {
        post: {
          parameters: [
            { in: 'header', name: 'model', schema: { enum: ['s2.1-pro', 's2.2-pro'] } }
          ]
        }
      }
    }
  });

  assert.deepEqual(models, ['s2.1-pro', 's2.2-pro']);
});

test('returns an empty list when the OpenAPI document has no model header', () => {
  assert.deepEqual(extractModelsFromOpenApi({ paths: {} }), []);
});
