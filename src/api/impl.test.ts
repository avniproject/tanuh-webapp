import { beforeEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/auth/httpClient", () => ({ http: { get: (...args: unknown[]) => get(...args) } }));

import { findInLocation, getEncounterUuidsInLocation } from "./impl";

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

// PE-304: the pending list placed screenings by reading every completed screening in each top place, on every load and
// press (16 s on Tanuh UAT, one place past the 100-page guard). The server gives them newest first, so a read can stop
// once it has passed every screening it still has to place.
describe("findInLocation", () => {
  type FindParams = { params: { page: number; size: number } };
  const minute = (i: number) => new Date(Date.UTC(2026, 10, 27, 12) - i * 60_000).toISOString();
  // `n` screenings s0..s(n-1), newest first, one minute apart; `failPage` answers with an error.
  const serve = (n: number, { failPage, dates }: { failPage?: number; dates?: (i: number) => string } = {}) =>
    get.mockImplementation((_url: string, { params }: FindParams) => {
      if (params.page === failPage) return Promise.reject(new Error("503"));
      const from = params.page * params.size;
      const rows = Array.from({ length: Math.max(0, Math.min(params.size, n - from)) }, (_, k) => from + k).map((i) => ({
        encounterUuid: `s${i}`,
        encounterDateTime: (dates ?? minute)(i),
      }));
      return Promise.resolve({
        data: { content: rows, totalElements: n, totalPages: Math.ceil(n / params.size), pageSize: params.size },
      });
    });
  const target = (uuid: string, date: string | null) => ({ uuid, date });
  const pagesRead = () => get.mock.calls.map((call) => (call[1] as FindParams).params.page);

  beforeEach(() => {
    get.mockReset();
  });

  it("asks nothing without targets", async () => {
    serve(1000);
    expect(await findInLocation("Oral Screening", "d1", [], new Set())).toEqual({ found: new Set(), ruledOut: new Set() });
    expect(get).not.toHaveBeenCalled();
  });

  it("stops after the first page when every target is found", async () => {
    serve(10_000);
    const result = await findInLocation("Oral Screening", "d1", [target("s3", minute(3)), target("s150", minute(150))], new Set());
    expect([...result.found].sort()).toEqual(["s150", "s3"]);
    expect(pagesRead()).toEqual([0]);
  });

  it("rules out a target newer than the last row read", async () => {
    serve(10_000);
    const between = new Date(Date.parse(minute(150)) + 30_000).toISOString();
    const result = await findInLocation("Oral Screening", "d1", [target("s5", minute(5)), target("x", between)], new Set());
    expect([...result.found]).toEqual(["s5"]);
    expect([...result.ruledOut]).toEqual(["x"]);
    expect(pagesRead()).toEqual([0]);
  });

  it("does not rule out a target dated on the last row read", async () => {
    // s199 ends page 0 and s200 opens page 1 on the same minute; the target is written without milliseconds.
    serve(1000, { dates: (i) => minute(i === 200 ? 199 : i) });
    const sameMinute = minute(199).replace(".000Z", "Z");
    const result = await findInLocation("Oral Screening", "d1", [target("s200", sameMinute)], new Set());
    expect([...result.found]).toEqual(["s200"]);
    expect(result.ruledOut.size).toBe(0);
  });

  it("stops chasing a target another place has found", async () => {
    serve(10_000);
    const elsewhere = new Set(["y"]);
    const result = await findInLocation("Oral Screening", "d2", [target("s1", minute(1)), target("y", minute(20_000))], elsewhere);
    expect([...result.found]).toEqual(["s1"]);
    expect(result.ruledOut.has("y")).toBe(false);
    expect(pagesRead()).toEqual([0]);
    expect(elsewhere.has("s1")).toBe(true);
  });

  it("rules out an older target only at the last page", async () => {
    serve(600);
    const result = await findInLocation("Oral Screening", "d1", [target("old", minute(5000))], new Set());
    expect([...result.ruledOut]).toEqual(["old"]);
    expect(pagesRead().sort()).toEqual([0, 1, 2]);
  });

  it("leaves unsettled what a failed page had not passed", async () => {
    serve(1000, { failPage: 1 });
    const newer = new Date(Date.parse(minute(100)) + 30_000).toISOString();
    const result = await findInLocation("Oral Screening", "d1", [target("n", newer), target("o", minute(5000))], new Set());
    expect([...result.ruledOut]).toEqual(["n"]);
    expect(result.found.size).toBe(0);
  });

  it("leaves unsettled what the page guard cut off", async () => {
    serve(101 * 200);
    const result = await findInLocation("Oral Screening", "d1", [target("old", minute(50_000))], new Set());
    expect(get.mock.calls).toHaveLength(100);
    expect(result.found.size + result.ruledOut.size).toBe(0);
  });

  it("never has more than four pages in flight across places", async () => {
    let inFlight = 0;
    let most = 0;
    get.mockImplementation((_url: string, { params }: FindParams) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      const rows = Array.from({ length: params.size }, (_, k) => ({
        encounterUuid: `s${params.page * params.size + k}`,
        encounterDateTime: minute(params.page * params.size + k),
      }));
      return new Promise((resolve) =>
        setTimeout(() => {
          inFlight -= 1;
          resolve({ data: { content: rows, totalElements: 2000, totalPages: 10, pageSize: params.size } });
        }, 1),
      );
    });
    const old = [target("old", minute(50_000))];
    await Promise.all([findInLocation("Oral Screening", "d1", old, new Set()), findInLocation("Oral Screening", "d2", old, new Set())]);
    expect(get.mock.calls).toHaveLength(20);
    expect(most).toBeLessThanOrEqual(4);
  });

  it("reads on past a page whose last row has no date, and rules out at the last page", async () => {
    const between = new Date(Date.parse(minute(150)) - 30_000).toISOString();
    serve(400, { dates: (i) => (i === 199 ? (null as unknown as string) : minute(i)) });
    const result = await findInLocation("Oral Screening", "d1", [target("x", between)], new Set());
    expect(pagesRead()).toEqual([0, 1]);
    expect([...result.ruledOut]).toEqual(["x"]);
  });

  it("rules out a target with no date only at the last page", async () => {
    serve(600);
    const result = await findInLocation("Oral Screening", "d1", [target("x", null)], new Set());
    expect(pagesRead()).toEqual([0, 1, 2]);
    expect([...result.ruledOut]).toEqual(["x"]);
  });

  it("reads on past an empty page before the last", async () => {
    get.mockImplementation((_url: string, { params }: FindParams) => {
      const rows =
        params.page === 1
          ? []
          : Array.from({ length: 200 }, (_, k) => ({
              encounterUuid: `s${params.page * 200 + k}`,
              encounterDateTime: minute(params.page * 200 + k),
            }));
      return Promise.resolve({ data: { content: rows, totalElements: 600, totalPages: 3, pageSize: 200 } });
    });
    const result = await findInLocation("Oral Screening", "d1", [target("s450", minute(450))], new Set());
    expect([...result.found]).toEqual(["s450"]);
    expect(result.ruledOut.size).toBe(0);
  });

  it("stops chasing a target another place finds while it reads", async () => {
    const elsewhere = new Set<string>();
    serve(10_000);
    const inner = get.getMockImplementation()!;
    get.mockImplementation((url: string, opts: FindParams) => {
      if (opts.params.page === 1) elsewhere.add("t");
      return inner(url, opts);
    });
    const result = await findInLocation("Oral Screening", "d2", [target("t", minute(9_000))], elsewhere);
    expect(pagesRead()).toEqual([0, 1, 2, 3, 4]);
    expect(result.found.size + result.ruledOut.size).toBe(0);
  });
});
