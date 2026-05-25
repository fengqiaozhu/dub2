require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { parentPort, workerData } = require('worker_threads');
const ttsService = require('../services/tts');

const { jobId, jobName, params } = workerData;

(async () => {
  try {
    console.log(`[ttsSynthesizeJob] Start synthesizing speech for job ${jobId}`);

    parentPort.postMessage({ type: 'PROGRESS', jobId, value: 10 });

    const result = await ttsService.synthesize({
      provider: params.provider || 'mosi',
      text: params.text,
      voice_id: params.voice_id,
      model: params.model,
      options: params.options || {},
      intent: params.intent,
      performance: params.performance,
      output: params.output
    });

    parentPort.postMessage({
      type: 'DONE',
      jobId,
      jobName,
      result
    });

    parentPort.postMessage('done');
  } catch (error) {
    parentPort.postMessage({
      type: 'ERROR',
      jobId,
      jobName,
      error: error.message
    });
    parentPort.postMessage('done');
  }
})();
