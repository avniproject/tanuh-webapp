import { describe, expect, it } from "vitest";
import { createLimiter } from "./limiter";

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createLimiter", () => {
  // Review finding (#4): 1,500 pending patients meant 1,500 requests in one burst.
  it("never runs more than the limit at once, across callers, and starts the rest in order", async () => {
    const limit = createLimiter(3);
    const tasks = Array.from({ length: 8 }, () => deferred<number>());
    const started: number[] = [];
    let running = 0;
    let most = 0;
    const results = tasks.map((d, i) =>
      limit(async () => {
        started.push(i);
        most = Math.max(most, ++running);
        try {
          return await d.promise;
        } finally {
          running--;
        }
      }),
    );
    await tick();
    expect(started).toEqual([0, 1, 2]);
    tasks.forEach((d, i) => d.resolve(i));
    await expect(Promise.all(results)).resolves.toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(most).toBe(3);
  });

  it("frees the slot of a task that fails, and passes the failure on", async () => {
    const limit = createLimiter(1);
    const first = limit(() => Promise.reject(new Error("read failed")));
    const second = limit(() => Promise.resolve("next"));
    await expect(first).rejects.toThrow("read failed");
    await expect(second).resolves.toBe("next");
  });

  it("treats a task that throws before returning a promise as a failure", async () => {
    const limit = createLimiter(1);
    const broken = limit((): Promise<string> => {
      throw new Error("bad request");
    });
    await expect(broken).rejects.toThrow("bad request");
    await expect(limit(() => Promise.resolve("still free"))).resolves.toBe("still free");
  });
});
