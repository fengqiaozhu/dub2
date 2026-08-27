function buildControlReport() {
  return {
    applied: [],
    approximated: [],
    ignored: [],
    warnings: []
  };
}

function formatEmotionPrompt(emotion) {
  return typeof emotion === 'string' ? emotion : JSON.stringify(emotion);
}

function planForProvider(provider, request) {
  const capabilities = provider.getCapabilities();
  const modelId = request.model || capabilities.defaultModel;
  const declaredModel = capabilities.models.find((item) => item.id === modelId);
  const capabilityModel = declaredModel
    || capabilities.models.find((item) => item.id === capabilities.defaultModel)
    || capabilities.models[0];
  const modelCapabilities = capabilityModel?.capabilities || {};
  const performance = request.intent?.performance || {};
  const output = request.intent?.output || {};
  const providerOptions = { ...(request.options || {}) };
  const report = buildControlReport();

  if (performance.expectedDurationSec && modelCapabilities.durationControl) {
    providerOptions.expected_duration_sec = performance.expectedDurationSec;
    report.applied.push('expectedDurationSec');
  } else if (performance.expectedDurationSec) {
    report.ignored.push('expectedDurationSec');
  }

  if (performance.speakingRate && modelCapabilities.speedControl) {
    providerOptions.speed = performance.speakingRate;
    report.applied.push('speakingRate');
  } else if (performance.speakingRate) {
    report.ignored.push('speakingRate');
  }

  if (performance.emotion) {
    if (modelCapabilities.emotionControl === 'native') {
      providerOptions.emotion = performance.emotion;
      report.applied.push('emotion');
    } else if (modelCapabilities.emotionControl === 'prompt') {
      const emotionPrompt = formatEmotionPrompt(performance.emotion);
      providerOptions.stylePrompt = performance.stylePrompt
        ? `${performance.stylePrompt}; ${emotionPrompt}`
        : emotionPrompt;
      report.applied.push('emotion');
      if (performance.stylePrompt) report.applied.push('stylePrompt');
    } else {
      report.ignored.push('emotion');
      report.warnings.push(`${provider.id} 不支持情绪控制，已忽略 emotion`);
    }
  }

  if (performance.stylePrompt) {
    if (modelCapabilities.stylePrompt && !providerOptions.stylePrompt) {
      providerOptions.stylePrompt = performance.stylePrompt;
      report.applied.push('stylePrompt');
    } else if (!modelCapabilities.stylePrompt && !report.applied.includes('emotion')) {
      report.ignored.push('stylePrompt');
    }
  }

  if (performance.pitch) {
    if (modelCapabilities.pitchControl) {
      providerOptions.pitch = performance.pitch;
      report.applied.push('pitch');
    } else {
      report.ignored.push('pitch');
    }
  }

  if (output.format && modelCapabilities.outputFormats?.length) {
    if (modelCapabilities.outputFormats.includes(output.format)) {
      providerOptions.outputFormat = output.format;
      report.applied.push('outputFormat');
    } else {
      report.ignored.push('outputFormat');
      report.warnings.push(`${provider.id} does not support ${output.format} output for ${modelId}`);
    }
  }

  return {
    model: modelId,
    providerOptions,
    appliedControls: report
  };
}

module.exports = {
  planForProvider
};
