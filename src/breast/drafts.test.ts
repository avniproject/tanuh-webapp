import { describe, expect, it } from "vitest";
import { clearDrafts, deleteDraft, draftMarks, loadDraft, saveDraft, type DraftScope } from "./drafts";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}
const me: DraftScope = { orgId: 1071, userUuid: "dr-a" };
const other: DraftScope = { orgId: 1071, userUuid: "dr-b" };

describe("drafts", () => {
  it("gives back what was saved for that screening and form", () => {
    const s = memoryStorage();
    saveDraft(s, me, "scr-1", "assessment", { c1: "a1", c2: 4 });
    expect(loadDraft(s, me, "scr-1", "assessment")?.answers).toEqual({ c1: "a1", c2: 4 });
    expect(loadDraft(s, me, "scr-1", "clinician")).toBeNull();
    expect(loadDraft(s, me, "scr-2", "assessment")).toBeNull();
  });

  it("keeps one clinician's drafts from another on the same browser", () => {
    const s = memoryStorage();
    saveDraft(s, me, "scr-1", "assessment", { c1: "a1" });
    expect(loadDraft(s, other, "scr-1", "assessment")).toBeNull();
    expect(draftMarks(s, other).size).toBe(0);
  });

  it("lists the drafts for the worklist", () => {
    const s = memoryStorage();
    saveDraft(s, me, "scr-1", "assessment", { c1: "a1" });
    saveDraft(s, me, "scr-2", "clinician", { c1: "a1" });
    expect([...draftMarks(s, me)].sort()).toEqual(["scr-1|assessment", "scr-2|clinician"]);
  });

  it("does not keep an empty draft", () => {
    const s = memoryStorage();
    saveDraft(s, me, "scr-1", "assessment", { c1: "a1" });
    saveDraft(s, me, "scr-1", "assessment", { c1: "", c2: [], c3: undefined });
    expect(loadDraft(s, me, "scr-1", "assessment")).toBeNull();
  });

  it("forgets a draft once the form is submitted, and every draft on sign-out", () => {
    const s = memoryStorage();
    s.setItem("unrelated", "kept");
    saveDraft(s, me, "scr-1", "assessment", { c1: "a1" });
    saveDraft(s, me, "scr-2", "assessment", { c1: "a1" });
    saveDraft(s, other, "scr-1", "assessment", { c1: "a1" });
    deleteDraft(s, me, "scr-1", "assessment");
    expect(loadDraft(s, me, "scr-1", "assessment")).toBeNull();
    expect(loadDraft(s, me, "scr-2", "assessment")).not.toBeNull();
    clearDrafts(s);
    expect(draftMarks(s, me).size).toBe(0);
    expect(draftMarks(s, other).size).toBe(0);
    expect(s.getItem("unrelated")).toBe("kept");
  });

  it("treats a damaged entry as no draft", () => {
    const s = memoryStorage();
    saveDraft(s, me, "scr-1", "assessment", { c1: "a1" });
    s.setItem(s.key(0)!, "{not json");
    expect(loadDraft(s, me, "scr-1", "assessment")).toBeNull();
  });
});
