import { describe, expect, it } from "vitest";
import { clearReviewDrafts, reviewDraftKey } from "./reviewDrafts";

function fakeStorage(entries: Record<string, string>) {
  const m = new Map(Object.entries(entries));
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

// FW11: a review's unsent answers are kept per case for the session; they are not the next physician's to see.
describe("review drafts", () => {
  it("are keyed by the review, or by the screening on a case page", () => {
    expect(reviewDraftKey({ encounterUuid: "r1" })).toBe("review-form:r1");
    expect(reviewDraftKey({ screeningUuid: "s1" })).toBe("review-form:case:s1");
  });

  it("are all cleared on sign-out, and nothing else is", () => {
    const s = fakeStorage({
      "review-form:r1": "{}",
      "review-form:case:s1": "{}",
      "list-state:1071:u1": "{}",
      other: "x",
    });
    clearReviewDrafts(s);
    expect([...s.m.keys()]).toEqual(["list-state:1071:u1", "other"]);
  });

  it("does not stop sign-out when storage cannot be read", () => {
    const broken = {
      key: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {},
      length: 1,
    };
    expect(() => clearReviewDrafts(broken)).not.toThrow();
  });
});
