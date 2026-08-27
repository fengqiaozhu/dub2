const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeFishAccount } = require('../src/services/fishAudioAccount');

test('free package balance makes Fish Audio available and selects free model', () => {
  const result = summarizeFishAccount({
    creditData: { credit: '0.000000' },
    packageData: { type: 'free', total: 8000, balance: 8000, extra_balance: 0 }
  });

  assert.equal(result.available, true);
  assert.equal(result.package.balance, 8000);
  assert.equal(result.recommended_model, 's2.1-pro-free');
});

test('paid API credit selects the paid model', () => {
  const result = summarizeFishAccount({
    creditData: { credit: '2.5' },
    packageData: { type: 'free', balance: 0 }
  });

  assert.equal(result.available, true);
  assert.equal(result.credit, 2.5);
  assert.equal(result.recommended_model, 's2.1-pro');
});

test('a non-free package balance remains available without forcing the free model', () => {
  const result = summarizeFishAccount({
    creditData: { credit: '0' },
    packageData: { type: 'subscription', balance: 4000 }
  });

  assert.equal(result.available, true);
  assert.equal(result.recommended_model, 's2.1-pro');
});

test('zero credit and zero package balance is unavailable', () => {
  const result = summarizeFishAccount({
    creditData: { credit: '0' },
    packageData: { type: 'free', balance: 0, extra_balance: 0 }
  });

  assert.equal(result.available, false);
});
