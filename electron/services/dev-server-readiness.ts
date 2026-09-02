import { get as httpGet } from 'node:http';
import { OperationCanceledError } from './keyed-single-flight';

const READY_PROBE_TIMEOUT_MS = 60_000;
const READY_PROBE_INTERVAL_MS = 400;

/** Waits for the Vite server and releases all request/timer resources on cancellation. */
export function probeDevServerReady(url: string, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + READY_PROBE_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let settled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let activeRequest: ReturnType<typeof httpGet> | undefined;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (retryTimer) clearTimeout(retryTimer);
      signal.removeEventListener('abort', onAbort);
      activeRequest?.destroy();
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(new OperationCanceledError());
    const retry = () => {
      if (settled) return;
      if (signal.aborted) {
        onAbort();
        return;
      }
      if (Date.now() > deadline) {
        finish(new Error('dev server did not become ready in time'));
        return;
      }
      retryTimer = setTimeout(attempt, READY_PROBE_INTERVAL_MS);
    };
    const attempt = () => {
      if (settled) return;
      if (signal.aborted) {
        onAbort();
        return;
      }
      let attemptFinished = false;
      const retryAttempt = () => {
        if (attemptFinished || settled) return;
        attemptFinished = true;
        activeRequest = undefined;
        retry();
      };
      const req = httpGet(url, (res) => {
        res.on('data', () => undefined);
        if ((res.statusCode ?? 0) < 500) {
          attemptFinished = true;
          activeRequest = undefined;
          finish();
        } else {
          retryAttempt();
        }
      });
      activeRequest = req;
      req.on('error', retryAttempt);
      req.setTimeout(2_000, () => {
        req.destroy();
        retryAttempt();
      });
    };

    signal.addEventListener('abort', onAbort, { once: true });
    attempt();
  });
}
