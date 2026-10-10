const path = require('path');
const Bree = require('bree');
const { v4: uuidv4 } = require('uuid');
const { jobRepository } = require('../repositories');

const WORKER_CANCEL_GRACE_MS = 500;

// Always unref'd so a pending settle timer can never hold the process open.
const sleep = (ms) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  if (typeof timer.unref === 'function') timer.unref();
});

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
            // Everything a cancelled job sends is dropped. The marker is only
            // released by cancelJob() after the worker stop attempt settles,
            // never by worker messages, so a second terminal message cannot
            // overwrite CANCELLED either (the database guard is the backstop).
            return;
          }

          if (data.type === 'PROGRESS') {
            // Cancel may land while this update is already in the database:
            // the guard makes the in-flight write lose against CANCELLED.
            await jobRepository.updateUnlessCancelled(data.jobId, {
              status: 'RUNNING',
              progress: data.value
            });
            console.log(`[JobManager] Job ${data.jobId} progress: ${data.value}%`);
          }

          if (data.type === 'DONE') {
            await jobRepository.updateUnlessCancelled(data.jobId, {
              status: 'DONE',
              progress: 100,
              result: data.result
            });
            console.log(`[JobManager] Job ${data.jobId} done.`);
            this.bree.remove(data.jobName).catch((error) => {
              console.warn(`[JobManager] Could not deregister finished job ${data.jobName}:`, error.message);
            });
          }

          if (data.type === 'ERROR') {
            await jobRepository.updateUnlessCancelled(data.jobId, {
              status: 'FAILED',
              error: data.error
            });
            console.error(`[JobManager] Job ${data.jobId} failed:`, data.error);
            this.bree.remove(data.jobName).catch((error) => {
              console.warn(`[JobManager] Could not deregister failed job ${data.jobName}:`, error.message);
            });
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
   * Cancel a pending or running job. Persists CANCELLED, then stops the Bree
   * worker (cooperative ack first, forced terminate on expiry, then
   * deregistration). Terminal jobs are returned unchanged so the call is
   * idempotent.
   * @param {string} jobId
   * @returns {Promise<object|null>} the updated job, or null if it does not exist
   */
  async cancelJob(jobId) {
    const job = await jobRepository.findById(jobId);
    if (!job) return null;

    if (['DONE', 'FAILED', 'CANCELLED'].includes(job.status)) {
      return job;
    }

    // 1. Flip the marker before anything else: from now on every worker
    // message for this job is dropped in the message handler, even while the
    // stop attempt below is still in flight.
    this.cancelledJobIds.add(jobId);

    try {
      // 2. Persist CANCELLED immediately, before touching Bree. A stubborn
      // worker that never acknowledges the cancel signal can make
      // bree.stop()/bree.remove() wait indefinitely, and that must neither
      // delay nor swallow the caller's cancellation. The SQL guard
      // (status <> 'CANCELLED') means an in-flight worker write can never
      // resurrect the row afterwards.
      const updated = await jobRepository.updateUnlessCancelled(jobId, { status: 'CANCELLED' });

      // 3. Stop the worker stop attempt is bounded: never hang the request.
      await this.stopWorker(job.job_name);

      console.log(`[JobManager] Job ${jobId} cancelled.`);
      return updated;
    } finally {
      // 4. Release the marker here, not in worker messages: cancelJob owns
      // its lifecycle, so a worker killed mid-run cannot leak the marker for
      // the rest of the process. Any message that slips through after this
      // point is blocked by the database guard instead.
      this.cancelledJobIds.delete(jobId);
    }
  }

  /**
   * Stop a worker for good, without ever waiting longer than one grace
   * period per phase. Cooperative workers acknowledge Bree's 'cancel'
   * message and exit promptly; stubborn workers are terminated.
   * @param {string} jobName
   */
  async stopWorker(jobName) {
    // The race losers may settle later with a rejection; nobody is listening,
    // so both promises are made rejection-proof up front.
    const stop = Promise.resolve(this.bree.stop(jobName)).catch((error) => {
      console.warn(`[JobManager] Failed to signal job ${jobName}:`, error.message);
    });
    await Promise.race([stop, sleep(WORKER_CANCEL_GRACE_MS)]);

    const worker = this.bree.workers.get(jobName);
    if (worker) {
      // The worker never acknowledged the cancel message (busy event loop or
      // no message handler). Terminate it so the exit handler clears the
      // workers map and the pending bree.stop() settles on its own.
      worker.terminate();
      await Promise.race([stop, sleep(WORKER_CANCEL_GRACE_MS)]);
    }

    const remove = Promise.resolve(this.bree.remove(jobName)).catch((error) => {
      // The job may not be registered yet (launch failed) or already gone.
      console.warn(`[JobManager] Could not deregister job ${jobName}:`, error.message);
    });
    await Promise.race([remove, sleep(WORKER_CANCEL_GRACE_MS)]);
  }
}

// Export singleton
module.exports = new JobManager();
