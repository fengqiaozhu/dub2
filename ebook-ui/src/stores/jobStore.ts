import { defineStore } from 'pinia';
import request from '@/api/request';
import { createJobPoller, resolveCancelFailure } from './jobPolling';

export interface Job {
  id: string;
  job_name: string;
  type: string;
  target_id: string;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
  progress: number;
  result?: any;
  error?: any;
}

export const useJobStore = defineStore('job', {
  state: () => ({
    activeJobs: new Map<string, Job>(),
    pollingIntervals: new Map<string, () => void>(),
  }),
  
  actions: {
    startPolling(
      jobId: string,
      onComplete?: (result: any) => void,
      onError?: (err: any) => void,
      onCancelled?: () => void,
    ) {
      if (this.pollingIntervals.has(jobId)) return;
      
      const stop = createJobPoller<Job>({
        fetchJob: async () => (await request.get(`/jobs/${jobId}`)).data,
        onUpdate: (job) => { this.activeJobs.set(jobId, job); },
        onComplete: (result) => {
          this.stopPolling(jobId);
          onComplete?.(result);
        },
        onError: (error) => {
          this.stopPolling(jobId);
          onError?.(error);
        },
        onCancelled: (job) => {
          this.activeJobs.set(jobId, job);
          this.stopPolling(jobId);
          onCancelled?.();
        },
        schedule: (callback, delay) => window.setTimeout(callback, delay),
        cancel: (timer) => window.clearTimeout(timer),
      });
      this.pollingIntervals.set(jobId, stop);
    },

    stopPolling(jobId: string) {
      this.pollingIntervals.get(jobId)?.();
      this.pollingIntervals.delete(jobId);
    },

    // Ask the server to stop a pending/running job. Returns true when local
    // state may be cleared (stop confirmed, or the job no longer exists — 404).
    // On any other failure the request did not land: keep polling and keep the
    // job visible so the user can stop it again. The rejection notice is
    // returned so callers can surface it.
    async cancelJob(jobId: string): Promise<{ cleared: boolean; notice: string }> {
      try {
        await request.post(`/jobs/${jobId}/cancel`);
        this.stopPolling(jobId);
        this.activeJobs.delete(jobId);
        return { cleared: true, notice: '' };
      } catch (err: any) {
        const outcome = resolveCancelFailure(err);
        if (outcome.clearLocal) {
          this.stopPolling(jobId);
          this.activeJobs.delete(jobId);
          return { cleared: true, notice: '' };
        }
        console.error('Failed to cancel job:', err);
        return { cleared: false, notice: outcome.notice };
      }
    },

    getJob(jobId: string) {
      return this.activeJobs.get(jobId);
    }
  }
});
