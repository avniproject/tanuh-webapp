import { afterEach, describe, expect, it, vi } from "vitest";
import { pageAfterComplete } from "./completeAndNext";

describe("pageAfterComplete", () => {
  afterEach(() => vi.restoreAllMocks());

  it("goes back to the list after Complete, taking nothing", async () => {
    const takeNext = vi.fn();
    expect(await pageAfterComplete(false, takeNext)).toEqual({ path: "/pending" });
    expect(takeNext).not.toHaveBeenCalled();
  });

  // The case page it leaves is replaced in the history, so the page's back arrow returns to the list rather than
  // walking back through the cases already completed.
  it("opens the case taken after Complete and review next case, in place of the page it leaves", async () => {
    expect(await pageAfterComplete(true, () => Promise.resolve("r-2"))).toEqual({ path: "/review/r-2", replace: true });
  });

  it("goes back to the list when no case is waiting", async () => {
    expect(await pageAfterComplete(true, () => Promise.resolve(null))).toEqual({ path: "/pending", replace: true });
  });

  it("goes back to the list, saying the take failed, when the next case cannot be taken", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await pageAfterComplete(true, () => Promise.reject(new Error("offline")))).toEqual({
      path: "/pending",
      replace: true,
      takeFailed: true,
    });
    expect(logged).toHaveBeenCalled();
  });
});
