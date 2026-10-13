const { parentPort } = require('worker_threads');

/**
 * Respond to Bree's cancel handshake. Bree's stop() posts the string 'cancel'
 * to the worker and only terminates it once the worker replies 'cancelled' or
 * exits on its own. Without this handler a long-running worker can never be
 * cancelled and the caller hangs on bree.stop(); jobManager additionally
 * force-terminates after a grace period, but the handshake makes the stop
 * prompt and clean.
 *
 * @param {function|undefined} beforeExit best-effort hook for clearing local
 *   timers/streams before termination.
 * @returns {function} isCancelled(): true once the cancel signal arrived, so
 *   worker loops can skip the remaining work.
 */
module.exports = function registerCancelHandler(beforeExit) {
  let cancelled = false;
  if (parentPort) {
    parentPort.on('message', (message) => {
      if (message !== 'cancel') return;
      cancelled = true;
      try {
        if (typeof beforeExit === 'function') beforeExit();
      } catch {
        // Best effort only; termination is coming either way.
      }
      try {
        parentPort.postMessage('cancelled');
      } catch {
        // Channel may already be gone; termination covers it.
      }
      // Bree's ack listener is one-shot: if a progress message races in first
      // it gets consumed without terminating, so exit for good measure.
      setImmediate(() => process.exit(0));
    });
  }
  return () => cancelled;
};
