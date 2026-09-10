import { describe, expect, it, vi } from "vitest";
import { createAsyncQueue } from "../src/async-queue.js";

describe("createAsyncQueue", () => {
  it("executes tasks serially in FIFO order", async () => {
    // Given
    const queue = createAsyncQueue();
    const order: string[] = [];
    const makeTask = (name: string, delayMs: number) => async (): Promise<string> => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      order.push(name);
      return name;
    };

    // When
    const first = queue.enqueue(makeTask("first", 20));
    const second = queue.enqueue(makeTask("second", 5));
    const third = queue.enqueue(makeTask("third", 0));
    const results = await Promise.all([first, second, third]);

    // Then
    expect(order).toEqual(["first", "second", "third"]);
    expect(results).toEqual(["first", "second", "third"]);
  });

  it("resolves enqueued tasks with their own values", async () => {
    // Given
    const queue = createAsyncQueue();

    // When
    const result = await queue.enqueue(async () => 42);

    // Then
    expect(result).toBe(42);
  });

  it("isolates a rejected task so subsequent tasks still run", async () => {
    // Given
    const queue = createAsyncQueue();
    const ran: boolean[] = [];

    // When
    const failing = queue.enqueue(async () => {
      throw new Error("task failed");
    });
    const following = queue.enqueue(async () => {
      ran.push(true);
      return "after";
    });
    await expect(failing).rejects.toThrow("task failed");
    const followingResult = await following;

    // Then
    expect(ran).toEqual([true]);
    expect(followingResult).toBe("after");
  });

  it("propagates synchronous task failures and runs the following task", async () => {
    // Given
    const queue = createAsyncQueue();
    const ran: boolean[] = [];

    // When
    const failing = queue.enqueue(() => {
      throw new TypeError("sync-ish failure");
    });
    const following = queue.enqueue(async () => {
      ran.push(true);
      return "after";
    });

    // Then
    await expect(failing).rejects.toThrow(TypeError);
    await expect(following).resolves.toBe("after");
    expect(ran).toEqual([true]);
  });

  it("rejects new tasks gracefully after dispose", async () => {
    // Given
    const queue = createAsyncQueue();

    // When
    queue.dispose();
    const rejected = queue.enqueue(async () => "never");

    // Then
    await expect(rejected).rejects.toThrow("AsyncQueue is disposed");
  });

  it("lets in-flight tasks finish after dispose", async () => {
    // Given
    const queue = createAsyncQueue();
    let finished = false;
    const inFlight = queue.enqueue(async (): Promise<string> => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      finished = true;
      return "done";
    });

    // When
    queue.dispose();
    const result = await inFlight;

    // Then
    expect(result).toBe("done");
    expect(finished).toBe(true);
  });

  it("keeps running later tasks when an earlier task throws synchronously", async () => {
    // Given
    const queue = createAsyncQueue();
    const order: string[] = [];

    // When
    const first = queue.enqueue(async () => {
      order.push("first");
      return "first";
    });
    const boom = queue.enqueue(async (): Promise<never> => {
      throw new Error("boom");
    });
    const third = queue.enqueue(async () => {
      order.push("third");
      return "third";
    });
    await expect(boom).rejects.toThrow("boom");
    const [firstResult, thirdResult] = await Promise.all([first, third]);

    // Then
    expect(order).toEqual(["first", "third"]);
    expect(firstResult).toBe("first");
    expect(thirdResult).toBe("third");
  });

  it("runs enqueued tasks one at a time without overlap", async () => {
    // Given
    const queue = createAsyncQueue();
    let running = 0;
    let maxConcurrent = 0;
    const track = async (): Promise<number> => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return maxConcurrent;
    };

    // When
    await Promise.all([
      queue.enqueue(track),
      queue.enqueue(track),
      queue.enqueue(track),
      queue.enqueue(track),
    ]);

    // Then
    expect(maxConcurrent).toBe(1);
  });

  it("exposes enqueue returning distinct promises per task", async () => {
    // Given
    const queue = createAsyncQueue();
    const spy = vi.fn(async (value: number) => value * 2);

    // When
    const results = await Promise.all([queue.enqueue(() => spy(1)), queue.enqueue(() => spy(2))]);

    // Then
    expect(results).toEqual([2, 4]);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
