function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function extractMosiErrorCode(data) {
  if (!data) return null;
  const value = data.code
    ?? data.error?.code
    ?? data.detail?.code
    ?? data.status?.code;
  return value === undefined || value === null ? null : String(value);
}

function summarizeMosiBilling(usage = null) {
  const lastErrorCode = usage?.last_error_code ? String(usage.last_error_code) : null;
  const insufficient = lastErrorCode === '4020';
  return {
    source: 'local_usage',
    balance_available: false,
    balance_status: insufficient ? 'insufficient' : 'unknown',
    note: insufficient
      ? '上次请求返回余额不足；Mosi 官方未公开余额查询接口'
      : 'Mosi 官方未公开余额查询接口，以下仅统计本项目成功的 TTS 请求',
    request_count: toFiniteNumber(usage?.request_count),
    total_credit_cost: toFiniteNumber(usage?.total_credit_cost),
    last_credit_cost: usage?.last_credit_cost === null || usage?.last_credit_cost === undefined
      ? null
      : toFiniteNumber(usage.last_credit_cost),
    last_used_at: usage?.last_used_at || null,
    last_error_code: lastErrorCode,
    last_error_message: usage?.last_error_message || null,
    last_error_at: usage?.last_error_at || null
  };
}

module.exports = {
  extractMosiErrorCode,
  summarizeMosiBilling
};
