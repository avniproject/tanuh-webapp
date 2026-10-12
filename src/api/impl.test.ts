import { beforeEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/auth/httpClient", () => ({ http: { get: (...args: unknown[]) => get(...args) } }));

import { getEncounterUuidsInLocation } from "./impl";

type Params = { params: { page: number } };
const page = (uuids: string[], totalPages: number) => ({
  data: { content: uuids.map((encounterUuid) => ({ encounterUuid })), totalElements: 0, totalPages, pageSize: 200 },
});

// Review finding (#4): the location filter now asks the server which screenings are in the location.
describe("getEncounterUuidsInLocation", () => {
  beforeEach(() => {
    get.mockReset();
  });

  it("reads every page and reports the read complete", async () => {
    get.mockImplementation((_url: string, { params }: Params) =>
      Promise.resolve(page([`s${params.page}a`, `s${params.page}b`], 3)),
    );
    const result = await getEncounterUuidsInLocation("Oral Screening", "completed", "village");
    expect([...result.uuids].sort()).toEqual(["s0a", "s0b", "s1a", "s1b", "s2a", "s2b"]);
    expect(result.complete).toBe(true);
    expect(get.mock.calls).toHaveLength(3);
  });

  it("is complete after one request when the location has no screenings", async () => {
    get.mockResolvedValue(page([], 0));
    expect(await getEncounterUuidsInLocation("Oral Screening", "completed", "village")).toEqual({ uuids: new Set(), complete: true });
    expect(get.mock.calls).toHaveLength(1);
  });

  it("keeps what it read and reports the read incomplete when a page fails", async () => {
    get.mockImplementation((_url: string, { params }: Params) =>
      params.page === 1 ? Promise.reject(new Error("503")) : Promise.resolve(page([`s${params.page}`], 3)),
    );
    const result = await getEncounterUuidsInLocation("Oral Screening", "completed", "village");
    expect([...result.uuids].sort()).toEqual(["s0", "s2"]);
    expect(result.complete).toBe(false);
  });

  it("reports the read incomplete when the first page fails", async () => {
    get.mockRejectedValue(new Error("503"));
    expect(await getEncounterUuidsInLocation("Oral Screening", "completed", "village")).toEqual({ uuids: new Set(), complete: false });
  });

  it("stops at its guard of 100 pages and says so", async () => {
    get.mockImplementation((_url: string, { params }: Params) => Promise.resolve(page([`s${params.page}`], 150)));
    const result = await getEncounterUuidsInLocation("Oral Screening", "completed", "village");
    expect(get.mock.calls).toHaveLength(100);
    expect(result.complete).toBe(false);
  });
});
