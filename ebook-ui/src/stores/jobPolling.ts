interface PollJob {
  status: string;
  result?: unknown;
  error?: unknown;
}

const TERMINAL_STATUSES = ['DONE', 'FAILED', 'CANCELLED'];

// Decide how the UI must react to a failed cancel request, computed from the
// error alone so tests can pin it without axios or the pinia store.
// - Success is handled by the caller (HTTP 2xx never reaches here).
// - 404 means the job no longer exists: stop local polling safely.
// - Any other failure (network error, 5xx, timeout): the stop request did NOT
//   land, so the job must stay visible, polling continues and the user can try
//   again.
export function resolveCancelFailure(error: any): { clearLocal: boolean; notice: string } {
  const status = error?.response?.status;
  if (status === 404) return { clearLocal: true, notice: '' };
  const notice = error?.response?.data?.error || '停止任务失败，任务仍在进行，请稍后重试';
  return { clearLocal: false, notice };
}

// Schedule after a response so slow requests never overlap.
export function createJobPoller<T extends PollJob>(options: {
  fetchJob: () => Promise<T>;
  onUpdate: (job: T) => void;
  onComplete: (result: unknown) => void;
  onError: (error: unknown) => void;
  onCancelled?: (job: T) => void;
  schedule: (callback: () => void, delay: number) => number;
  cancel: (timer: number) => void;
}) {
  let stopped = false;
  let timer: number | undefined;
  let failures = 0;
  const stop = () => {
    stopped = true;
    if (timer !== undefined) options.cancel(timer);
  };
  const poll = async () => {
    let job: T;
    try {
      job = await options.fetchJob();
    } catch (error: any) {
      if (stopped) return;
      const status = error?.response?.status;
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
        stop();
        options.onError(error);
        return;
      }
      failures += 1;
      timer = options.schedule(() => { void poll(); }, Math.min(2000 * 2 ** Math.min(failures, 4), 30000));
      return;
    }
    if (stopped) return;
    failures = 0;
    options.onUpdate(job);
    if (TERMINAL_STATUSES.includes(job.status)) {
      stop();
      if (job.status === 'DONE') options.onComplete(job.result);
      else if (job.status === 'CANCELLED') options.onCancelled?.(job);
      else options.onError(job.error);
      return;
    }
    timer = options.schedule(() => { void poll(); }, 2000);
  };
  // Defer the first request so the caller can register the stop handle.
  timer = options.schedule(() => { void poll(); }, 0);
  return stop;
}
