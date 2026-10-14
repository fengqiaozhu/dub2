import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCESS_TOKEN_STORAGE_KEY,
  clearAccessToken,
  envAccessToken,
  readAccessToken,
  writeAccessToken
} from '../src/api/accessToken.ts';

function memoryStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    data
  };
}

test('stored token wins over the Vite env fallback', () => {
  const storage = memoryStorage({ [ACCESS_TOKEN_STORAGE_KEY]: 'from-ui' });
  assert.equal(readAccessToken(storage, 'from-env'), 'from-ui');
});

test('empty storage falls back to VITE_DUB_ACCESS_TOKEN', () => {
  const storage = memoryStorage();
  assert.equal(readAccessToken(storage, envAccessToken({ VITE_DUB_ACCESS_TOKEN: ' baked ' })), 'baked');
});

test('writing a token persists the trimmed value and clearing removes it', () => {
  const storage = memoryStorage();
  assert.equal(writeAccessToken('  secret-token  ', storage), 'secret-token');
  assert.equal(storage.data[ACCESS_TOKEN_STORAGE_KEY], 'secret-token');
  clearAccessToken(storage);
  assert.equal(Object.prototype.hasOwnProperty.call(storage.data, ACCESS_TOKEN_STORAGE_KEY), false);
});

test('blank write removes the stored token and does not implant a default', () => {
  const storage = memoryStorage({ [ACCESS_TOKEN_STORAGE_KEY]: 'old' });
  writeAccessToken('   ', storage);
  assert.equal(readAccessToken(storage, ''), '');
  assert.equal(readAccessToken(storage, 'from-env'), 'from-env');
});
