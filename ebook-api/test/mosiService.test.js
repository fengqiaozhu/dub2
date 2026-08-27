const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const storageService = require('../src/services/storage/storageService');
const mosiService = require('../src/services/mosiService');

test('records credit_cost returned by a successful Mosi synthesis', async (t) => {
  const originals = {
    post: axios.post,
    putObject: storageService.putObject,
    getBaseUrl: mosiService.getBaseUrl,
    getHeaders: mosiService.getHeaders,
    recordUsage: mosiService.recordUsage
  };
  let recordedCost;

  axios.post = async () => ({
    data: {
      audio_data: Buffer.from('audio').toString('base64'),
      duration_s: 1,
      usage: { credit_cost: 12 }
    }
  });
  storageService.putObject = async () => {};
  mosiService.getBaseUrl = async () => 'https://studio.mosi.cn';
  mosiService.getHeaders = async () => ({ Authorization: 'Bearer test' });
  mosiService.recordUsage = async (cost) => { recordedCost = cost; };

  t.after(() => {
    axios.post = originals.post;
    storageService.putObject = originals.putObject;
    mosiService.getBaseUrl = originals.getBaseUrl;
    mosiService.getHeaders = originals.getHeaders;
    mosiService.recordUsage = originals.recordUsage;
  });

  const result = await mosiService.synthesizeSpeech('测试', 'voice-id');
  assert.equal(recordedCost, 12);
  assert.equal(result.usage.credit_cost, 12);
});

test('records a documented Mosi insufficient-credit error', async (t) => {
  const originals = {
    post: axios.post,
    getBaseUrl: mosiService.getBaseUrl,
    getHeaders: mosiService.getHeaders,
    recordError: mosiService.recordError
  };
  let recordedError;
  const apiError = Object.assign(new Error('Insufficient Credits'), {
    response: { status: 402, data: { code: 4020, message: 'Insufficient Credits' } }
  });

  axios.post = async () => { throw apiError; };
  mosiService.getBaseUrl = async () => 'https://studio.mosi.cn';
  mosiService.getHeaders = async () => ({ Authorization: 'Bearer test' });
  mosiService.recordError = async (error) => { recordedError = error; };

  t.after(() => {
    axios.post = originals.post;
    mosiService.getBaseUrl = originals.getBaseUrl;
    mosiService.getHeaders = originals.getHeaders;
    mosiService.recordError = originals.recordError;
  });

  await assert.rejects(
    () => mosiService.synthesizeSpeech('测试', 'voice-id'),
    (error) => error.code === '4020' && error.statusCode === 402
  );
  assert.equal(recordedError, apiError);
});
