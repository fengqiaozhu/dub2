require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const ttsService = require('../services/tts');
const { providerVoiceRepository } = require('../repositories');

const { jobId, jobName, params } = workerData;
const { filePath, text } = params;

(async () => {
  try {
    console.log(`[mosiCreateVoiceJob] Start creating voice clone for job ${jobId}`);

    const result = await ttsService.cloneVoice({
      provider: 'mosi',
      filePath,
      text,
      onProgress: (progress) => {
        parentPort.postMessage({ type: 'PROGRESS', jobId, value: progress });
      }
    });

    if (result.voice_id || result.voiceId) {
      await providerVoiceRepository.upsert({
        provider: 'mosi',
        provider_voice_id: result.voice_id || result.voiceId,
        provider_model: result.model,
        kind: 'clone',
        status: result.status,
        provider_meta: result
      });
    }

    // Cleanup local file after success
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    parentPort.postMessage({
      type: 'DONE',
      jobId,
      jobName,
      result
    });

    // Notify Bree to clean up
    parentPort.postMessage('done');
  } catch (error) {
    // Cleanup local file on error
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
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
