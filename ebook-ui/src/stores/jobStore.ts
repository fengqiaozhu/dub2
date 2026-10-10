import { defineStore } from 'pinia';
import request from '@/api/request';
import { createJobPoller } from './jobPolling';

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

    // Ask the server to stop a pending/running job, then stop local polling.
    // A lost job (404) still stops locally so the UI never hangs on a dead id.
    async cancelJob(jobId: string) {
      try {
        await request.post(`/jobs/${jobId}/cancel`);
      } catch (err) {
        console.error('Failed to cancel job:', err);
      } finally {
        this.stopPolling(jobId);
      }
    },

    getJob(jobId: string) {
      return this.activeJobs.get(jobId);
    }
  }
});
