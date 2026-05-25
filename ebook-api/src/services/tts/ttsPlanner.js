function buildControlReport() {
  return {
    applied: [],
    approximated: [],
    ignored: [],
    warnings: []
  };
}

function planForProvider(provider, request) {
  const capabilities = provider.getCapabilities();
  const modelId = request.model || capabilities.defaultModel;
  const model = capabilities.models.find((item) => item.id === modelId) || capabilities.models[0];
  const modelCapabilities = model?.capabilities || {};
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
    } else if (modelCapabilities.emotionControl === 'prompt' && performance.stylePrompt) {
      providerOptions.stylePrompt = `${performance.stylePrompt}; emotion=${JSON.stringify(performance.emotion)}`;
      report.approximated.push('emotion');
    } else {
      report.ignored.push('emotion');
    }
  }

  if (performance.stylePrompt) {
    if (modelCapabilities.stylePrompt) {
      providerOptions.stylePrompt = performance.stylePrompt;
      report.applied.push('stylePrompt');
    } else if (!report.approximated.includes('emotion')) {
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
      report.warnings.push(`${provider.id} does not support ${output.format} output for ${model.id}`);
    }
  }

  return {
    model: model?.id || modelId,
    providerOptions,
    appliedControls: report
  };
}

module.exports = {
  planForProvider
};
