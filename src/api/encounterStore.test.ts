import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/auth/httpClient", () => ({ http: { get: (...args: unknown[]) => get(...args) } }));
import type { EncounterApiResponse } from "./types";
import { trimForCache } from "./encounters";
import {
  AI_VERDICT_GROUP, AI_VERDICT_GROUP_CHILD, IN_REVIEW_BY_CONCEPT, IN_REVIEW_SINCE_CONCEPT, OCSHR_RESULT_CONCEPT,
  RANDOM_SAMPLE_ID_CONCEPT,
  ANY_SUSPICIOUS_LESION_CONCEPT, MODEL_RESULT_CONCEPT, MODEL_RUN_TIME_CONCEPT, MODEL_STATUS_CONCEPT,
  MODEL_VERSION_CONCEPT, ORAL_IMAGE_GROUP, PLACE_OF_REFERRAL_CONCEPT, REVIEW_CATEGORY_CONCEPT, WORKER_OPINION,
  OCSHR_CALL_MADE_CONCEPT, OCSHR_ERROR_CONCEPT, OCSHR_STATUS_CONCEPT, QC_STATUS_CONCEPT,
} from "@/constants/tanuhConcepts";

describe("trimForCache", () => {
  it("keeps the model's values, the referral place and the worker's opinion, and drops the photos", () => {
    const model = {
      [MODEL_RESULT_CONCEPT.name]: "Non Suspicious",
      [MODEL_STATUS_CONCEPT.name]: "Scored",
      [MODEL_VERSION_CONCEPT.name]: "stub",
      [MODEL_RUN_TIME_CONCEPT.name]: "2026-10-07T10:51:00.474Z",
      [REVIEW_CATEGORY_CONCEPT.name]: "FLW override",
      [PLACE_OF_REFERRAL_CONCEPT.name]: { District: "Bengaluru Rural", "Taluka Hospital": "Dental hospital" },
    };
    const screening = {
      ID: "s1", "Subject ID": "p1", "Encounter type": "Oral Screening", Voided: false, "Encounter date time": "2026-10-06T10:00:00.000Z",
      observations: { ...model, [ORAL_IMAGE_GROUP.name]: [{ "Oral Image": "https://s3/1.jpg", [ANY_SUSPICIOUS_LESION_CONCEPT.name]: "Yes" }] },
      audit: { "Created at": "2026-10-06T10:00:05.000Z", "Last modified at": "2026-10-06T10:01:00.000Z", "Created by": "worker" },
    } as unknown as EncounterApiResponse;

    const trimmed = trimForCache(screening);

    expect(trimmed.observations).toEqual(model);
    expect(trimmed.workerOpinion).toBe(WORKER_OPINION.suspicious);
  });

  it("trimForCache keeps the queue's values and derives the signals before dropping the photos", () => {
    const screening = {
      ID: "s2", "Subject ID": "p1", "Encounter type": "Oral Screening", Voided: false, "Encounter date time": "2026-10-06T10:00:00.000Z",
      observations: {
        [OCSHR_RESULT_CONCEPT.name]: "High Risk",
        [RANDOM_SAMPLE_ID_CONCEPT.name]: 0.02,
        [ORAL_IMAGE_GROUP.name]: [{ "Oral Image": "https://s3/1.jpg", [ANY_SUSPICIOUS_LESION_CONCEPT.name]: "Yes" }],
        [AI_VERDICT_GROUP.name]: [{ [AI_VERDICT_GROUP_CHILD.verdict.name]: "Suspicious" }],
      },
      audit: { "Created at": "2026-10-06T10:00:05.000Z", "Last modified at": "2026-10-06T10:01:00.000Z", "Created by": "worker" },
    } as unknown as EncounterApiResponse;

    const trimmed = trimForCache(screening);

    expect(trimmed.flwPositive).toBe(true);
    expect(trimmed.edgeVerdict).toBe("Suspicious");
    expect(trimmed.observations).toEqual({ [OCSHR_RESULT_CONCEPT.name]: "High Risk", [RANDOM_SAMPLE_ID_CONCEPT.name]: 0.02 });
    expect(trimmed.observations).not.toHaveProperty(ORAL_IMAGE_GROUP.name);
    expect(trimmed.observations).not.toHaveProperty(AI_VERDICT_GROUP.name);

    const noVerdict = trimForCache({ ...screening, observations: {} } as unknown as EncounterApiResponse);
    expect(noVerdict.edgeVerdict).toBeNull();

    const review = {
      ID: "r1", "Subject ID": "p1", "Encounter type": "Clinician Review", Voided: false,
      observations: { [IN_REVIEW_BY_CONCEPT.name]: "dr.a", [IN_REVIEW_SINCE_CONCEPT.name]: "2026-10-07T09:00:00.000Z" },
      audit: { "Last modified at": "2026-10-07T09:00:01.000Z" },
    } as unknown as EncounterApiResponse;
    const kept = trimForCache(review);
    expect(kept.observations).toEqual(review.observations);
    expect(kept.audit?.["Last modified at"]).toBe("2026-10-07T09:00:01.000Z");
  });

  it("keeps what tells a never-scored OCSHR case from a pending one: Call Made, Model Status, Model Error and QC status", () => {
    const ocshr = {
      [OCSHR_CALL_MADE_CONCEPT.name]: "Yes",
      [OCSHR_STATUS_CONCEPT.name]: "FAILED",
      [OCSHR_ERROR_CONCEPT.name]: "Bad image",
      [QC_STATUS_CONCEPT.name]: "QC Pass",
    };
    const screening = {
      ID: "s3", "Subject ID": "p1", "Encounter type": "Oral Screening", Voided: false, "Encounter date time": "2026-10-06T10:00:00.000Z",
      observations: { ...ocshr, [ORAL_IMAGE_GROUP.name]: [{ "Oral Image": "https://s3/1.jpg" }] },
      audit: { "Created at": "2026-10-06T10:00:05.000Z", "Last modified at": "2026-10-06T10:01:00.000Z", "Created by": "worker" },
    } as unknown as EncounterApiResponse;

    expect(trimForCache(screening).observations).toEqual(ocshr);
  });
});

import {
  fetchEncountersSince,
  getCachedEncounters,
  invalidateCachedEncounters,
  refreshStoredEncounters,
  type CachedEncounters,
  type EncounterLister,
} from "./encounters";

// The server's list, in memory: changed strictly after lastModifiedDateTime and strictly before now,
// ordered by (time, id), offset pages counted from 0.
function serverWith(rows: { ID: string; at: string }[], onRequest?: (n: number) => void) {
  let requests = 0;
  const list: EncounterLister = async ({ lastModifiedDateTime, now, page, size }) => {
    requests++;
    onRequest?.(requests);
    const after = Date.parse(lastModifiedDateTime);
    const before = now ? Date.parse(now) : Infinity;
    const matching = rows
      .filter((r) => Date.parse(r.at) > after && Date.parse(r.at) < before)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.ID.localeCompare(b.ID));
    const content = matching.slice(page * size, page * size + size)
      .map((r) => ({ ID: r.ID, audit: { "Last modified at": r.at } }) as unknown as EncounterApiResponse);
    return { content, totalElements: matching.length, totalPages: Math.ceil(matching.length / size), pageSize: size };
  };
  return { list, requests: () => requests };
}

const at = (second: number) => new Date(Date.UTC(2026, 9, 7, 10, 0, second)).toISOString();

describe("fetchEncountersSince", () => {
  it("loses no row when the job changes one it has already read", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ ID: `s${String(i).padStart(2, "0")}`, at: at(i) }));
    const server = serverWith(rows, (n) => {
      if (n === 2) rows[3].at = at(59); // the job scores s03 after the first page was read
    });

    const fetched = await fetchEncountersSince(server.list, "2000-01-01T00:00:00.000Z", 10);

    expect(new Set(fetched.map((e) => e.ID))).toEqual(new Set(rows.map((r) => r.ID)));
  });

  it("reads every row of a millisecond that holds more rows than a page", async () => {
    const rows = [
      ...Array.from({ length: 23 }, (_, i) => ({ ID: `b${String(i).padStart(2, "0")}`, at: at(5) })),
      { ID: "later", at: at(9) },
    ];
    const fetched = await fetchEncountersSince(serverWith(rows).list, "2000-01-01T00:00:00.000Z", 10);

    expect(fetched.map((e) => e.ID).sort()).toEqual(rows.map((r) => r.ID).sort());
  });

  it("loses no row when the job changes one inside a shared millisecond mid-read", async () => {
    const rows = Array.from({ length: 23 }, (_, i) => ({ ID: `b${String(i).padStart(2, "0")}`, at: at(5) }));
    const server = serverWith(rows, (n) => {
      if (n === 3) rows[2].at = at(40); // written while that millisecond is being read by offset
    });

    const fetched = await fetchEncountersSince(server.list, "2000-01-01T00:00:00.000Z", 10);

    expect(new Set(fetched.map((e) => e.ID))).toEqual(new Set(rows.map((r) => r.ID)));
  });

  // The write lands after the millisecond's first page is read: the row it moves out shifts the next page's first row
  // back onto a page already read, and only a further pass finds it.
  it("loses no row when a write between two pages of a shared millisecond shifts one back", async () => {
    const rows = Array.from({ length: 23 }, (_, i) => ({ ID: `b${String(i).padStart(2, "0")}`, at: at(5) }));
    const server = serverWith(rows, (n) => {
      if (n === 4) rows[2].at = at(40); // after the millisecond's first page (request 3), before its second
    });

    const fetched = await fetchEncountersSince(server.list, "2000-01-01T00:00:00.000Z", 10);

    expect(new Set(fetched.map((e) => e.ID))).toEqual(new Set(rows.map((r) => r.ID)));
  });

  // Review finding: reading a bulk-stamped millisecond counted against the load's cap, which cut it off inside that
  // millisecond; the watermark then stayed on it and every later load stopped at the same place.
  it("reads past a millisecond too large for the load's request cap, at the real page size", async () => {
    const rows = [
      ...Array.from({ length: 6700 }, (_, i) => ({ ID: `b${String(i).padStart(4, "0")}`, at: at(5) })),
      { ID: "later", at: at(9) },
    ];

    const fetched = await fetchEncountersSince(serverWith(rows).list, "2000-01-01T00:00:00.000Z");

    expect(fetched.length).toBe(6701);
    expect(fetched.some((e) => e.ID === "later")).toBe(true);
  });

  it("stops at the request cap and returns what it read", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ ID: `s${String(i).padStart(3, "0")}`, at: at(i % 60) }));
    const server = serverWith(rows);

    const fetched = await fetchEncountersSince(server.list, "2000-01-01T00:00:00.000Z", 10, 3);

    expect(server.requests()).toBe(3);
    expect(fetched.length).toBeGreaterThan(0);
  });
});

// PE-304: on Tanuh UAT a first read of the stored copy took over nine minutes, and a reload threw it all away, since the
// copy was saved only when the read ended.
describe("saving the stored copy as its read goes", () => {
  // 4,500 rows one second apart.
  const rowAt = (i: number) => new Date(Date.UTC(2026, 9, 7) + i * 1000);
  const rows = () => Array.from({ length: 4500 }, (_, i) => ({ ID: `s${String(i).padStart(4, "0")}`, at: rowAt(i).toISOString() }));

  it("hands over what it has read every 20 requests", async () => {
    const handed: { count: number; watermark: string }[] = [];
    await fetchEncountersSince(serverWith(rows()).list, "2000-01-01T00:00:00.000Z", 100, 200, (read, watermark) =>
      handed.push({ count: read.length, watermark }),
    );
    // Each request after the first reads the previous page's last row again.
    expect(handed).toEqual([
      { count: 1981, watermark: new Date(rowAt(1980).getTime() - 1).toISOString() },
      { count: 3961, watermark: new Date(rowAt(3960).getTime() - 1).toISOString() },
    ]);
  });

  it("keeps the rows read before a failure, and the next load carries on from there", async () => {
    const all = rows();
    const saves: CachedEncounters[] = [];
    const save = (next: CachedEncounters) => saves.push(next);
    const failing = serverWith(all, (n) => {
      if (n === 25) throw new Error("reload");
    });
    await expect(refreshStoredEncounters(undefined, failing.list, save)).rejects.toThrow("reload");
    const kept = saves[saves.length - 1];
    expect(kept.records).toHaveLength(1981);

    const asked: string[] = [];
    const working: EncounterLister = (p) => {
      asked.push(p.lastModifiedDateTime);
      return serverWith(all).list(p);
    };
    const records = await refreshStoredEncounters(kept, working, save);
    expect(asked[0]).toBe(new Date(Date.parse(kept.watermark) - 5 * 60 * 1000).toISOString());
    expect(records).toHaveLength(4500);
    expect(new Set(records.map((r) => r.ID)).size).toBe(4500);
  });

  it("saves at the end as before", async () => {
    const few = rows().slice(0, 150);
    const saves: CachedEncounters[] = [];
    await refreshStoredEncounters(undefined, serverWith(few).list, (next) => saves.push(next));
    expect(saves).toHaveLength(1);
    expect(saves[0].watermark).toBe(few[149].at);
    expect(saves[0].records).toHaveLength(150);
  });
});

// PE-304: a press, a release or a tab change dropped a read still running and started another beside it, so on Tanuh
// UAT two reads of 20,000 screenings ran at once.
describe("getCachedEncounters", () => {
  const empty = { data: { content: [], totalElements: 0, totalPages: 0, pageSize: 100 } };
  let answer: (() => void)[] = [];
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const answerAll = () => {
    const now = answer;
    answer = [];
    now.forEach((a) => a());
  };

  beforeEach(() => {
    answer = [];
    get.mockReset();
    get.mockImplementation(() => new Promise((resolve) => answer.push(() => resolve(empty))));
    invalidateCachedEncounters();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a call during a running read joins it, however long the read has run", async () => {
    vi.useFakeTimers();
    const first = getCachedEncounters("Oral Screening");
    await vi.advanceTimersByTimeAsync(90_000);
    const second = getCachedEncounters("Oral Screening");
    await vi.advanceTimersByTimeAsync(0);
    expect(get).toHaveBeenCalledTimes(2); // one request for each source
    answerAll();
    expect(await second).toBe(await first);
  });

  it("an invalidate during a running read reads the changes once it ends", async () => {
    const first = getCachedEncounters("Oral Screening");
    await flush();
    invalidateCachedEncounters();
    const second = getCachedEncounters("Oral Screening");
    await flush();
    expect(get).toHaveBeenCalledTimes(2);
    answerAll();
    await first;
    await flush();
    expect(get).toHaveBeenCalledTimes(4);
    answerAll();
    await second;
  });

  // Review finding: with no timeout on the client, a read the server never answered would hold the store until reload.
  it("a read the server never answers fails after two minutes, and the next call reads afresh", async () => {
    vi.useFakeTimers();
    const stuck = getCachedEncounters("Oral Screening");
    const failed = expect(stuck).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(120_000);
    await failed;
    getCachedEncounters("Oral Screening");
    await vi.advanceTimersByTimeAsync(0);
    expect(get).toHaveBeenCalledTimes(4);
    answerAll();
  });

  it("a read that fails is not kept: the next call reads afresh", async () => {
    get.mockRejectedValueOnce(new Error("503"));
    await expect(getCachedEncounters("Oral Screening")).rejects.toThrow("503");
    const next = getCachedEncounters("Oral Screening");
    await flush();
    answerAll();
    await expect(next).resolves.toEqual([]);
  });

  it("a read queued behind one that fails still runs", async () => {
    let fail: (e: Error) => void = () => {};
    get.mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)));
    const first = getCachedEncounters("Oral Screening");
    const firstFailed = expect(first).rejects.toThrow("503");
    await flush();
    invalidateCachedEncounters();
    const second = getCachedEncounters("Oral Screening");
    await flush();
    answerAll(); // the programme source's answer to the first read
    fail(new Error("503"));
    await firstFailed;
    await flush();
    answerAll();
    await expect(second).resolves.toEqual([]);
  });

  it("reuses a finished read for 60 seconds after it ends, however long it ran", async () => {
    vi.useFakeTimers();
    const first = getCachedEncounters("Oral Screening");
    await vi.advanceTimersByTimeAsync(90_000);
    answerAll();
    await first;
    await vi.advanceTimersByTimeAsync(30_000);
    getCachedEncounters("Oral Screening");
    expect(get).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(31_000);
    getCachedEncounters("Oral Screening");
    await vi.advanceTimersByTimeAsync(0);
    expect(get).toHaveBeenCalledTimes(4);
    answerAll();
  });
});
