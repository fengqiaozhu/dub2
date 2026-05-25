const jobManager = require('./src/services/jobManager');
(async () => {
  await jobManager.start();
  // Simulate a worker sending DONE
  const jobId = 'test-job-123';
  jobManager.bree.config.workerMessageHandler({
    name: `analyze_chapter-${jobId}`,
    message: {
      type: 'DONE',
      jobId: jobId,
      jobName: `analyze_chapter-${jobId}`,
      result: { ok: true }
    }
  });
  console.log('Fired workerMessageHandler manually.');
})();
