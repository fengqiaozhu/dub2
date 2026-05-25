require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const ttsService = require('../services/tts');
const { providerVoiceRepository } = require('../repositories');

const { jobId, jobName, params } = workerData;

(async () => {
  try {
    console.log(`[ttsCreateVoiceJob] Start creating ${params.provider || 'mosi'} voice clone for job ${jobId}`);

    const result = await ttsService.cloneVoice({
      provider: params.provider || 'mosi',
      filePath: params.filePath,
      text: params.text || '',
      voice_profile_id: params.voice_profile_id,
      onProgress: (progress) => {
        parentPort.postMessage({ type: 'PROGRESS', jobId, value: progress });
      }
    });

    if (result.voice_id || result.voiceId) {
      providerVoiceRepository.upsert({
        voice_profile_id: params.voice_profile_id,
        provider: params.provider || 'mosi',
        provider_voice_id: result.voice_id || result.voiceId,
        provider_model: result.model,
        kind: 'clone',
        status: result.status,
        provider_meta: result
      });
    }

    if (fs.existsSync(params.filePath)) {
      fs.unlinkSync(params.filePath);
    }

    parentPort.postMessage({
      type: 'DONE',
      jobId,
      jobName,
      result
    });

    parentPort.postMessage('done');
  } catch (error) {
    if (params.filePath && fs.existsSync(params.filePath)) {
      fs.unlinkSync(params.filePath);
    }

    parentPort.postMessage({
      type: 'ERROR',
      jobId,
      jobName,
      error: error.message
    });

    parentPort.postMessage('done');
  }
})();
