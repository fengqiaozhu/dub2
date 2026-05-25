require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { parentPort, workerData } = require('worker_threads');
const aiService = require('../services/aiService');

const { jobId, jobName, params } = workerData;
const { chapterId } = params;

(async () => {
  try {
    console.log(`[analyzeChapterJob] Start processing chapter ${chapterId} for job ${jobId}`);

    // Report starting progress
    parentPort.postMessage({ type: 'PROGRESS', jobId, value: 10 });

    // Calling the original aiService logic
    // This blocks the worker thread, but not the main thread
    const analysisResult = await aiService.analyzeChapter(chapterId);

    // Done
    parentPort.postMessage({
      type: 'DONE',
      jobId,
      jobName,
      result: analysisResult
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
