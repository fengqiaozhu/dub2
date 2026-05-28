require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const ttsService = require('../services/tts');
const {
  providerVoiceRepository,
  voiceProfileRepository
} = require('../repositories');
const {
  buildMarker,
  ensureProfileSampleHash
} = require('../services/tts/voiceProfileIdentity');

const { jobId, jobName, params } = workerData;

(async () => {
  try {
    console.log(`[ttsCreateVoiceJob] Start creating ${params.provider || 'mosi'} voice clone for job ${jobId}`);
    const profile = params.voice_profile_id
      ? await voiceProfileRepository.findById(params.voice_profile_id)
      : null;
    if (profile) {
      await ensureProfileSampleHash(profile, voiceProfileRepository);
    }
    const marker = profile ? buildMarker(profile) : null;

    const result = await ttsService.cloneVoice({
      provider: params.provider || 'mosi',
      filePath: params.filePath,
      fileName: params.fileName,
      text: params.text || '',
      name: params.name,
      description: params.description,
      voice_profile_id: params.voice_profile_id,
      marker,
      onProgress: (progress) => {
        parentPort.postMessage({ type: 'PROGRESS', jobId, value: progress });
      }
    });

    if (result.voice_id || result.voiceId) {
      await providerVoiceRepository.upsert({
        voice_profile_id: params.voice_profile_id,
        provider: params.provider || 'mosi',
        provider_voice_id: result.voice_id || result.voiceId,
        provider_model: result.model,
        kind: 'clone',
        status: result.status,
        provider_meta: {
          ...result,
          marker
        }
      });
      try {
        await ttsService.syncProviderCloneVoices({ provider: params.provider || 'mosi' });
      } catch (syncError) {
        console.warn(`[ttsCreateVoiceJob] Failed to sync ${params.provider || 'mosi'} voices after clone:`, syncError.message);
      }
    }

    if (params.cleanupFile !== false && fs.existsSync(params.filePath)) {
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
    if (params.cleanupFile !== false && params.filePath && fs.existsSync(params.filePath)) {
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
