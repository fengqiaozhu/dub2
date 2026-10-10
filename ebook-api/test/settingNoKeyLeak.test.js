const test = require('node:test');
const assert = require('node:assert/strict');
const settingController = require('../src/controllers/settingController');
const { aiConfigRepository, ttsConfigRepository } = require('../src/repositories');

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

test('AI config list never returns api_key, only has_api_key', async (t) => {
  const original = aiConfigRepository.findAll;
  aiConfigRepository.findAll = async () => ([
    {
      id: 1,
      name: 'deepseek',
      provider: 'deepseek',
      api_url: 'https://api.deepseek.com',
      api_key: 'sk-super-secret',
      model: 'deepseek-chat',
      is_reasoning: false,
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z'
    },
    {
      id: 2,
      name: 'empty',
      provider: 'deepseek',
      api_url: 'https://api.deepseek.com',
      api_key: '',
      model: null,
      is_reasoning: true,
      is_active: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z'
    }
  ]);
  t.after(() => {
    aiConfigRepository.findAll = original;
  });

  const response = createResponse();
  await settingController.getAiConfigs({}, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.length, 2);
  for (const row of response.body.data) {
    assert.equal('api_key' in row, false, 'api_key must not leak into the response');
    assert.equal('has_api_key' in row, true);
  }
  assert.equal(response.body.data[0].has_api_key, true);
  assert.equal(response.body.data[1].has_api_key, false);
  assert.deepEqual(
    Object.keys(response.body.data[0]).sort(),
    [
      'api_url', 'created_at', 'has_api_key', 'id', 'is_active',
      'is_reasoning', 'model', 'name', 'provider', 'updated_at'
    ].sort()
  );
});

test('TTS config list never returns api_key, only has_api_key', async (t) => {
  const original = ttsConfigRepository.findAll;
  ttsConfigRepository.findAll = async () => ([
    {
      id: 7,
      name: 'fish',
      provider: 'fish_audio',
      api_url: 'https://api.fish.audio',
      api_key: 'fish-secret-key',
      model: 's1',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z'
    }
  ]);
  t.after(() => {
    ttsConfigRepository.findAll = original;
  });

  const response = createResponse();
  await settingController.getTtsConfigs({}, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.length, 1);
  const row = response.body.data[0];
  assert.equal('api_key' in row, false, 'api_key must not leak into the response');
  assert.equal(row.has_api_key, true);
  assert.equal(row.provider, 'fish_audio');
});
