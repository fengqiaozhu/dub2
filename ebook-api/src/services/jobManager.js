const path = require('path');
const Bree = require('bree');
const { v4: uuidv4 } = require('uuid');
const { jobRepository } = require('../repositories');

class JobManager {
  constructor() {
    // Jobs the user cancelled. Late worker messages must not resurrect a
    // cancelled job back to RUNNING/DONE/FAILED.
    this.cancelledJobIds = new Set();
    this.bree = new Bree({
      root: path.join(__dirname, '../jobs'),
      jobs: [],
      workerMessageHandler: async (msg) => {
        try {
          const data = msg.message;
          if (!data || !data.type) return;

          if (data.jobId && this.cancelledJobIds.has(data.jobId)) {
            if (data.type === 'DONE' || data.type === 'ERROR') {
              this.cancelledJobIds.delete(data.jobId);
            }
            return;
          }

          if (data.type === 'PROGRESS') {
            // Update progress
            await jobRepository.update(data.jobId, {
              status: 'RUNNING',
              progress: data.value
            });
            console.log(`[JobManager] Job ${data.jobId} progress: ${data.value}%`);
          }
          
          if (data.type === 'DONE') {
            await jobRepository.update(data.jobId, {
              status: 'DONE',
              progress: 100,
              result: data.result
            });
            console.log(`[JobManager] Job ${data.jobId} done.`);
            this.bree.remove(data.jobName);
          }
          
          if (data.type === 'ERROR') {
            await jobRepository.update(data.jobId, {
              status: 'FAILED',
              error: data.error
            });
            console.error(`[JobManager] Job ${data.jobId} failed:`, data.error);
            this.bree.remove(data.jobName);
          }
        } catch (err) {
          console.error(`[JobManager] Error handling worker message:`, err);
        }
      }
    });
  }

  async start() {
    // 1. 修复重启前遗留的未完成僵尸任务（将所有 PENDING 或 RUNNING 状态的任务直接安全标记为 FAILED）
    const staleCount = await jobRepository.markStaleJobsAsFailed();
    if (staleCount > 0) {
      console.log(`[JobManager] Marked ${staleCount} stale jobs as FAILED.`);
    }

    // 2. 清理超过 7 天的历史任务，防止数据库膨胀
    const cleanedCount = await jobRepository.cleanupOldJobs(7);
    if (cleanedCount > 0) {
      console.log(`[JobManager] Cleaned up ${cleanedCount} old jobs.`);
    }

    await this.bree.start();
    console.log('[JobManager] Bree initialized and listening.');
  }

  /**
   * Add and start a new job
   * @param {string} type - e.g. 'analyze_chapter', 'mosi_clone', 'mosi_tts'
   * @param {string|null} targetId - e.g. chapterId or null
   * @param {string} scriptName - e.g. 'analyzeChapterJob.js'
   * @param {Object} params - extra params passed to workerData
   * @param {Object} options - e.g. { dedupe: true }
   */
  async startJob(type, targetId, scriptName, params = {}, options = {}) {
    if (options.dedupe && targetId) {
      const activeJob = await jobRepository.findActiveByTypeAndTarget(type, targetId);
      if (activeJob) {
        console.log(`[JobManager] Reusing active ${type} job ${activeJob.id} for target ${targetId}`);
        return activeJob.id;
      }
    }

    const jobId = uuidv4();
    const jobName = `${type}-${jobId}`;

    // 1. Save to DB
    await jobRepository.create({
      id: jobId,
      job_name: jobName,
      type: type,
      target_id: targetId,
      status: 'PENDING',
      progress: 0
    });

    try {
      // 2. Add to bree
      await this.bree.add({
        name: jobName,
        path: path.join(__dirname, '../jobs', scriptName),
        worker: {
          workerData: {
            jobId,
            jobName,
            params
          }
        }
      });

      // 3. Start job. Persist launch failures instead of leaving PENDING jobs.
      await this.bree.start(jobName);
    } catch (error) {
      await jobRepository.update(jobId, { status: 'FAILED', error: error.message });
      try {
        await this.bree.remove(jobName);
      } catch {
        // Registration can fail before Bree knows the job.
      }
      throw error;
    }

    return jobId;
  }

  /**
   * Cancel a pending or running job. Stops the Bree worker and marks the job
   * CANCELLED. Terminal jobs are returned unchanged so the call is idempotent.
   * @param {string} jobId
   * @returns {Promise<object|null>} the updated job, or null if it does not exist
   */
  async cancelJob(jobId) {
    const job = await jobRepository.findById(jobId);
    if (!job) return null;

    if (['DONE', 'FAILED', 'CANCELLED'].includes(job.status)) {
      return job;
    }

    this.cancelledJobIds.add(jobId);

    try {
      await this.bree.remove(job.job_name);
    } catch (error) {
      // The worker may not be registered yet (launch failed) or already gone.
      console.warn(`[JobManager] Could not remove job ${job.job_name}:`, error.message);
    }

    const updated = await jobRepository.update(jobId, { status: 'CANCELLED' });
    console.log(`[JobManager] Job ${jobId} cancelled.`);
    return updated;
  }
}

// Export singleton
module.exports = new JobManager();
