require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { parentPort, workerData } = require('worker_threads');
const ttsService = require('../services/tts');

const { jobId, jobName, params } = workerData;
const { text, voice_id, options, intent, performance, output } = params;

(async () => {
  try {
    console.log(`[mosiSynthesizeJob] Start synthesizing speech for job ${jobId}`);

    parentPort.postMessage({ type: 'PROGRESS', jobId, value: 10 });

    const result = await ttsService.synthesize({
      provider: 'mosi',
      text,
      voice_id,
      options,
      intent,
      performance,
      output
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
