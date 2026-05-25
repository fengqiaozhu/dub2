import { defineStore } from 'pinia';
import request from '@/api/request';

export interface Job {
  id: string;
  job_name: string;
  type: string;
  target_id: string;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  progress: number;
  result?: any;
  error?: any;
}

export const useJobStore = defineStore('job', {
  state: () => ({
    activeJobs: new Map<string, Job>(),
    pollingIntervals: new Map<string, number>(),
  }),
  
  actions: {
    startPolling(jobId: string, onComplete?: (result: any) => void, onError?: (err: any) => void) {
      if (this.pollingIntervals.has(jobId)) return;
      
      const intervalId = window.setInterval(async () => {
        try {
          const res = await request.get(`/jobs/${jobId}`);
          const job = res.data;
          this.activeJobs.set(jobId, job);
          
          if (job.status === 'DONE') {
            this.stopPolling(jobId);
            if (onComplete) onComplete(job.result);
          } else if (job.status === 'FAILED') {
            this.stopPolling(jobId);
            if (onError) onError(job.error);
          }
        } catch (err) {
          console.error('Failed to poll job:', err);
          this.stopPolling(jobId);
          if (onError) onError(err);
        }
      }, 2000); // Poll every 2 seconds
      
      this.pollingIntervals.set(jobId, intervalId);
    },
    
    stopPolling(jobId: string) {
      const intervalId = this.pollingIntervals.get(jobId);
      if (intervalId) {
        clearInterval(intervalId);
        this.pollingIntervals.delete(jobId);
      }
    },
    
    getJob(jobId: string) {
      return this.activeJobs.get(jobId);
    }
  }
});
