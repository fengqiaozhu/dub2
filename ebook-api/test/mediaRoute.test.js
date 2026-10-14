const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { Readable } = require('node:stream');
const storage = require('../src/services/storage/storageService');
const mediaRoutes = require('../src/routes/media');
const { mediaUrlForKey } = require('../src/services/storage/keyBuilder');

test('HTTP media route reads the exact object key after one URL decoding pass', async (t) => {
  const original = storage.getObjectStream;
  const keys = [];
  storage.getObjectStream = async (key) => {
    keys.push(key);
    return { stream: Readable.from(['audio']), contentLength: 5, contentType: 'audio/wav' };
  };
  const app = express();
  app.use('/media', mediaRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    storage.getObjectStream = original;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  for (const key of ['audio/100% 完成.wav', 'audio/literal%20.wav']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${mediaUrlForKey(key)}`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'audio');
    assert.equal(keys.at(-1), key);
  }
});
