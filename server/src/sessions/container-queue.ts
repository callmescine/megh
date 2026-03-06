import { getConfig } from '../config.js';

/**
 * Container creation queue — limits how many Docker containers
 * can be created in parallel to prevent overwhelming the Docker daemon.
 *
 * Configurable via config.containers.container_concurrency (default: 2)
 * and config.containers.queue_timeout (default: 30 seconds).
 */

type QueuedTask<T> = {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

let running = 0;
const queue: QueuedTask<unknown>[] = [];

function processQueue(): void {
  const config = getConfig();
  const maxConcurrency = config.containers.container_concurrency;

  while (running < maxConcurrency && queue.length > 0) {
    const task = queue.shift()!;
    clearTimeout(task.timer);
    running++;

    task.fn()
      .then((result) => {
        running--;
        task.resolve(result);
        processQueue();
      })
      .catch((err) => {
        running--;
        task.reject(err);
        processQueue();
      });
  }
}

/**
 * Enqueue a container creation task. Resolves when the task completes.
 * Rejects if the queue timeout is exceeded.
 */
export function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const config = getConfig();
  const timeoutMs = config.containers.queue_timeout * 1000;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      // Remove from queue if still waiting
      const idx = queue.findIndex((t) => t.resolve === resolve);
      if (idx !== -1) {
        queue.splice(idx, 1);
        reject(new Error('Session creation timed out — server is busy. Please try again.'));
      }
    }, timeoutMs);

    queue.push({ fn, resolve, reject, timer } as QueuedTask<unknown>);
    processQueue();
  });
}

/**
 * Returns current queue stats for monitoring.
 */
export function getQueueStats(): { running: number; queued: number; maxConcurrency: number } {
  const config = getConfig();
  return {
    running,
    queued: queue.length,
    maxConcurrency: config.containers.container_concurrency,
  };
}
