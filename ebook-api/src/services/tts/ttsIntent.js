const DEFAULT_INTENT = {
  performance: {},
  output: {
    format: 'wav'
  }
};

function normalizeIntent(input = {}) {
  const legacyOptions = input.options || {};
  const intent = {
    ...DEFAULT_INTENT,
    ...(input.intent || {}),
    performance: {
      ...DEFAULT_INTENT.performance,
      ...(input.intent?.performance || {}),
      ...(input.performance || {})
    },
    output: {
      ...DEFAULT_INTENT.output,
      ...(input.intent?.output || {}),
      ...(input.output || {})
    }
  };

  if (legacyOptions.expected_duration_sec) {
    intent.performance.expectedDurationSec = legacyOptions.expected_duration_sec;
  }
  if (legacyOptions.speed) {
    intent.performance.speakingRate = legacyOptions.speed;
  }
  if (legacyOptions.emotion) {
    intent.performance.emotion = legacyOptions.emotion;
  }
  if (legacyOptions.stylePrompt) {
    intent.performance.stylePrompt = legacyOptions.stylePrompt;
  }

  return intent;
}

module.exports = {
  normalizeIntent
};
