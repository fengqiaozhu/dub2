const test = require('node:test');
const assert = require('node:assert/strict');
const { extractMosiErrorCode, summarizeMosiBilling } = require('../src/services/mosiAccount');

test('Mosi billing exposes local usage while keeping the official balance unknown', () => {
  const billing = summarizeMosiBilling({
    request_count: '3',
    total_credit_cost: '27',
    last_credit_cost: '8',
    last_used_at: '2026-08-27T10:00:00.000Z'
  });

  assert.equal(billing.balance_available, false);
  assert.equal(billing.balance_status, 'unknown');
  assert.equal(billing.request_count, 3);
  assert.equal(billing.total_credit_cost, 27);
  assert.equal(billing.last_credit_cost, 8);
});

test('Mosi billing marks the last insufficient-credit response explicitly', () => {
  const billing = summarizeMosiBilling({
    last_error_code: '4020',
    last_error_message: 'Insufficient Credits'
  });

  assert.equal(billing.balance_status, 'insufficient');
  assert.match(billing.note, /余额不足/);
});

test('extracts Mosi error codes from documented and nested error shapes', () => {
  assert.equal(extractMosiErrorCode({ code: 4020 }), '4020');
  assert.equal(extractMosiErrorCode({ error: { code: '4011' } }), '4011');
  assert.equal(extractMosiErrorCode(null), null);
});
