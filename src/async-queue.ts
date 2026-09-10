/**
 * Minimal serialized async task queue.
 *
 * Tasks run strictly one at a time in FIFO order. A rejected task never
 * blocks subsequent tasks: its rejection is isolated to the enqueuer's
 * promise. `dispose()` rejects new enqueues gracefully and lets in-flight
 * tasks finish.
 */
export interface AsyncQueue {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
  dispose(): void;
}

export function createAsyncQueue(): AsyncQueue {
  let disposed = false;
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      if (disposed) {
        return Promise.reject(new Error("AsyncQueue is disposed"));
      }
      const result = tail.then(task, task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },

    dispose(): void {
      disposed = true;
    },
  };
}
