import { describe, expect, it } from "vitest";
import { DEFAULT_LIST_STATE, clearListStates, loadListState, saveListState } from "./listState";

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

describe("list state", () => {
  it("keeps each tab's choices for the signed-in scope", () => {
    const s = fakeStorage();
    saveListState(s, "1071:u1", "pending", { ...DEFAULT_LIST_STATE, sort: "opinion", group: "safety-sample", search: "P01" });
    expect(loadListState(s, "1071:u1", "pending")).toMatchObject({ sort: "opinion", group: "safety-sample", search: "P01" });
    expect(loadListState(s, "1071:u1", "completed")).toEqual(DEFAULT_LIST_STATE);
    expect(loadListState(s, "1113:u2", "pending")).toEqual(DEFAULT_LIST_STATE);
  });
  it("is back to the default after sign-out", () => {
    const s = fakeStorage();
    saveListState(s, "1071:u1", "pending", { ...DEFAULT_LIST_STATE, sort: "date" });
    clearListStates(s);
    expect(loadListState(s, "1071:u1", "pending")).toEqual(DEFAULT_LIST_STATE);
  });
  it("ignores a damaged entry", () => {
    const s = fakeStorage();
    s.setItem("list-state:1071:u1", "{not json");
    expect(loadListState(s, "1071:u1", "pending")).toEqual(DEFAULT_LIST_STATE);
  });
});
