import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ENCOUNTER_TYPE } from "@/constants/tanuhConcepts";

const { get, put, post, patch } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock("@/auth/httpClient", () => ({
  http: {
    get: (...a: unknown[]) => get(...a),
    put: (...a: unknown[]) => put(...a),
    post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a),
  },
}));
import type { QueueRow } from "./queueRows";
import type { EncounterApiResponse } from "./types";
import {
  confirmTake,
  createReviewVisit,
  decideTake,
  holdDetail,
  holdPatch,
  holdBody,
  holdStatus,
  isLiveHold,
  readHold,
  releaseCase,
  reviewUuidFor,
  takeCase,
  uuidV5,
} from "./caseHold";

const t0 = new Date("2026-11-23T10:00:00Z");
const minus = (d: Date, min: number) => new Date(d.getTime() - min * 60_000);

const booked: EncounterApiResponse = {
  ID: "r1",
  "Subject ID": "sub1",
  "Subject external ID": null,
  "Subject type": "Individual",
  Voided: false,
  "External ID": null,
  "Encounter type": "Clinician Review Form",
  "Encounter date time": null,
  "Earliest scheduled date": "2026-11-20T00:00:00.000Z",
  "Max scheduled date": "2026-11-22T23:59:59.999Z",
  "Cancel date time": null,
  observations: {},
};
const bookedWith = (observations: Record<string, unknown>, extra: Partial<EncounterApiResponse> = {}) => ({
  ...booked,
  observations,
  ...extra,
});
const heldBy = (by: string, at: Date) =>
  bookedWith(
    { "In review by": by, "In review since": at.toISOString() },
    { audit: { "Last modified at": at.toISOString() } },
  );
const completedReview = bookedWith({}, { "Encounter date time": "2026-11-23T09:00:00Z" });
const cancelledReview = bookedWith({}, { "Cancel date time": "2026-11-23T09:00:00Z" });
const voidedReview = bookedWith({}, { Voided: true });

describe("holds", () => {
  it("a hold lasts ten minutes from the server's write", () => {
    const h = { by: "dr.a", since: t0.toISOString(), takenAt: t0.toISOString() };
    expect(isLiveHold(h, new Date(t0.getTime() + 9 * 60_000 + 59_000))).toBe(true);
    expect(isLiveHold(h, new Date(t0.getTime() + 10 * 60_000))).toBe(false);
    expect(isLiveHold({ by: "dr.a", since: minus(t0, 30).toISOString(), takenAt: t0.toISOString() }, t0)).toBe(true);
    expect(isLiveHold({ by: "dr.a", since: new Date(t0.getTime() + 60_000).toISOString() }, t0)).toBe(true);
    expect(isLiveHold({ by: "dr.a", since: "garbage" }, t0)).toBe(false);
    expect(isLiveHold(undefined, t0)).toBe(false);
  });

  it("readHold needs both fields and takes takenAt from the audit", () => {
    expect(readHold(bookedWith({ "In review by": "dr.a" }))).toBeUndefined();
    expect(readHold(heldBy("dr.a", t0))).toEqual({
      by: "dr.a",
      since: t0.toISOString(),
      takenAt: t0.toISOString(),
    });
  });

  it("holdStatus is mine only for the viewer's live hold, and waiting once the review is over", () => {
    expect(holdStatus(heldBy("dr.a", t0), "dr.a", t0)).toEqual({ kind: "mine", since: t0.toISOString() });
    expect(holdStatus(heldBy("dr.b", t0), "dr.a", t0)).toEqual({ kind: "other", by: "dr.b" });
    expect(holdStatus(heldBy("dr.b", minus(t0, 11)), "dr.a", t0)).toEqual({ kind: "waiting" });
    expect(holdStatus(heldBy("dr.a", minus(t0, 11)), "dr.a", t0)).toEqual({ kind: "waiting" });
    expect(holdStatus(undefined, "dr.a", t0)).toEqual({ kind: "waiting" });
    for (const r of [completedReview, cancelledReview, voidedReview]) {
      expect(
        holdStatus({ ...r, observations: { "In review by": "dr.b", "In review since": t0.toISOString() } }, "dr.a", t0),
      ).toEqual({ kind: "waiting" });
    }
  });

  // The list's Status pill shows when another physician took the case; holdStatus itself is unchanged.
  it("holdDetail adds when another physician took the case, and is holdStatus otherwise", () => {
    expect(holdDetail(heldBy("dr.b", t0), "dr.a", t0)).toEqual({ kind: "other", by: "dr.b", since: t0.toISOString() });
    expect(holdDetail(heldBy("dr.a", t0), "dr.a", t0)).toEqual({ kind: "mine", since: t0.toISOString() });
    expect(holdDetail(heldBy("dr.b", minus(t0, 11)), "dr.a", t0)).toEqual({ kind: "waiting" });
    expect(holdDetail(undefined, "dr.a", t0)).toEqual({ kind: "waiting" });
  });

  it("decideTake refuses a completed, cancelled or deleted review and a live hold by someone else, and takes an expired or own one", () => {
    expect(decideTake(completedReview, "dr.a", t0)).toBe("completed");
    expect(decideTake(cancelledReview, "dr.a", t0)).toBe("gone");
    expect(decideTake(voidedReview, "dr.a", t0)).toBe("gone");
    expect(decideTake(heldBy("dr.b", t0), "dr.a", t0)).toBe("held");
    expect(decideTake(heldBy("dr.b", minus(t0, 11)), "dr.a", t0)).toBe("take");
    expect(decideTake(heldBy("dr.a", t0), "dr.a", t0)).toBe("take");
    expect(decideTake(null, "dr.a", t0)).toBe("take");
  });
});

describe("holdBody", () => {
  it("keeps the window, stays planned, and swaps only the marker", () => {
    const b = holdBody(
      bookedWith({ "Reviewed Oral Screening": "s1", "In review by": "x", "In review since": "y" }),
      { by: "dr.a", since: "t", takenAt: "never written" },
    );
    expect(b["Encounter date time"]).toBeNull();
    expect(b["Encounter type"]).toBe("Clinician Review Form");
    expect(b["Subject ID"]).toBe("sub1");
    expect(b["Earliest scheduled date"]).toBe(booked["Earliest scheduled date"]);
    expect(b["Max scheduled date"]).toBe(booked["Max scheduled date"]);
    expect(b).not.toHaveProperty("External ID");
    expect(b.observations).toEqual({ "Reviewed Oral Screening": "s1", "In review by": "dr.a", "In review since": "t" });
    expect(holdBody(bookedWith({ "In review by": "x", "In review since": "y" }), null).observations).toEqual({});
  });

  it("adds extra observations", () => {
    expect(holdBody(bookedWith({ a: 1 }), null, { b: 2 }).observations).toEqual({ a: 1, b: 2 });
  });
});

describe("review uuid", () => {
  it("uuidV5 matches the RFC vector", async () => {
    expect(await uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(
      "2ed6657d-e927-568b-95e1-2665a8aea6a2",
    );
  });

  it("reviewUuidFor is stable, differs per screening and from the screening's own uuid", async () => {
    const s1 = "11111111-1111-4111-8111-111111111111";
    const s2 = "22222222-2222-4222-8222-222222222222";
    const a = await reviewUuidFor(s1);
    expect(await reviewUuidFor(s1)).toBe(a);
    expect(a).not.toBe(s1);
    expect(a).not.toBe(await reviewUuidFor(s2));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("createReviewVisit", () => {
  const screening = { ...booked, ID: "scr1", "Subject ID": "sub9" };
  const today = new Date(2026, 10, 23, 15, 30);

  it("names the visit and uses the rule's window", () => {
    const { url, body } = createReviewVisit(screening, "rev-uuid", today);
    expect(url).toBe("/web/encounters");
    expect(body).toMatchObject({
      uuid: "rev-uuid",
      encounterTypeUUID: ENCOUNTER_TYPE.physicianReviewForm.uuid,
      name: "Clinician Review Form",
      individualUUID: "sub9",
      earliestVisitDateTime: new Date(2026, 10, 23, 0, 0, 0, 0).toISOString(),
      maxVisitDateTime: new Date(2026, 10, 25, 23, 59, 59, 999).toISOString(),
    });
  });

  it("goes to /web/programEncounters inside an enrolment", () => {
    const { url, body } = createReviewVisit({ ...screening, "Enrolment ID": "enr1" }, "rev-uuid", today);
    expect(url).toBe("/web/programEncounters");
    expect(body).toMatchObject({ programEnrolmentUUID: "enr1" });
  });
});

// FW3: a standalone hold write sends only the marker, so a submit, cancel or delete landing meanwhile stands.
describe("holdPatch", () => {
  it("sends the encounter type and the two marker fields, and nothing else", () => {
    expect(holdPatch(booked, { by: "dr.a", since: "t" })).toEqual({
      "Encounter type": "Clinician Review Form",
      observations: { "In review by": "dr.a", "In review since": "t" },
    });
  });
  it("removes the marker with nulls, and adds extra observations", () => {
    expect(holdPatch(booked, null)).toEqual({
      "Encounter type": "Clinician Review Form",
      observations: { "In review by": null, "In review since": null },
    });
    expect(holdPatch(booked, { by: "dr.a", since: "t" }, { "Reviewed Oral Screening": "s1" }).observations).toEqual({
      "In review by": "dr.a",
      "In review since": "t",
      "Reviewed Oral Screening": "s1",
    });
  });
});

// FW3: after a take write the review is read again; the case is the viewer's only when the marker just written is
// still there on an open review.
describe("confirmTake", () => {
  const since = t0.toISOString();
  it("is mine when the review is open and carries the viewer's marker as written", () => {
    expect(confirmTake(heldBy("dr.a", t0), "dr.a", since)).toBe("mine");
  });
  it("compares the time as an instant, whatever form the server gives it back in", () => {
    const back = bookedWith({ "In review by": "dr.a", "In review since": "2026-11-23T15:30:00.000+05:30" });
    expect(confirmTake(back, "dr.a", since)).toBe("mine");
  });
  it("is held when another physician's write landed after the viewer's, or the viewer's other window's", () => {
    expect(confirmTake(heldBy("dr.b", t0), "dr.a", since)).toBe("held");
    expect(confirmTake(heldBy("dr.a", minus(t0, 1)), "dr.a", since)).toBe("held");
    expect(confirmTake(booked, "dr.a", since)).toBe("held");
    expect(confirmTake(bookedWith({ "In review by": "dr.a", "In review since": "garbage" }), "dr.a", "garbage")).toBe("held");
  });
  it("is completed or gone when a submit, cancel or delete landed", () => {
    expect(confirmTake({ ...heldBy("dr.a", t0), "Encounter date time": "2026-11-23T10:01:00Z" }, "dr.a", since)).toBe(
      "completed",
    );
    expect(confirmTake({ ...heldBy("dr.a", t0), "Cancel date time": "2026-11-23T10:01:00Z" }, "dr.a", since)).toBe("gone");
    expect(confirmTake({ ...heldBy("dr.a", t0), Voided: true }, "dr.a", since)).toBe("gone");
    expect(confirmTake(null, "dr.a", since)).toBe("gone");
  });
});

const notFound = () => new AxiosError("nf", "ERR_BAD_REQUEST", undefined, undefined, { status: 404 } as never);
const serverError = () => new AxiosError("boom", "ERR_BAD_RESPONSE", undefined, undefined, { status: 500 } as never);
const stamp = { "In review by": "dr.a", "In review since": t0.toISOString() };
const reply = (data: unknown) => Promise.resolve({ data });
const copy = <T,>(v: T): T => structuredClone(v);

// A small stand-in for the server: the reviews by uuid, and every patient's visits for the visit lists. A read gives
// what the last write left; a PATCH merges observations (null removes one), a PUT replaces them and the window, a web
// POST creates a planned review. `stamped` is the server time each write sets as "Last modified at".
function fakeServer(reviews: EncounterApiResponse[], visits: EncounterApiResponse[] = []) {
  const store = new Map(reviews.map((r) => [r.ID, copy(r)]));
  const stamped = "2026-11-23T10:00:01.000Z";
  const touch = (r: EncounterApiResponse) => ({ ...r, audit: { ...r.audit, "Last modified at": stamped } });
  get.mockImplementation((url: string, config?: { params?: { encounterType?: string } }) => {
    const one = /^\/api\/(encounter|programEncounter)\/(.+)$/.exec(url);
    if (one) {
      const r = store.get(one[2]);
      if (!r || !!r["Enrolment ID"] !== (one[1] === "programEncounter")) return Promise.reject(notFound());
      return reply(copy(r));
    }
    if (url === "/api/encounters" || url === "/api/programEncounters") {
      const content = [...visits, ...store.values()].filter((v) => v["Encounter type"] === config?.params?.encounterType);
      return reply({ content: copy(content), totalElements: content.length, totalPages: 1 });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  patch.mockImplementation((url: string, body: { observations: Record<string, unknown> }) => {
    const id = url.replace("/api/encounter/", "");
    const r = store.get(id);
    if (!r || r["Enrolment ID"]) return Promise.reject(notFound());
    const observations = { ...r.observations };
    for (const [k, v] of Object.entries(body.observations)) {
      if (v === null) delete observations[k];
      else observations[k] = v;
    }
    store.set(id, touch({ ...r, observations }));
    return reply(copy(store.get(id)));
  });
  put.mockImplementation((url: string, body: Partial<EncounterApiResponse>) => {
    const id = url.replace(/^\/api\/(encounter|programEncounter)\//, "");
    const r = store.get(id);
    if (!r) return Promise.reject(notFound());
    store.set(
      id,
      touch({
        ...r,
        observations: { ...body.observations },
        "Encounter date time": body["Encounter date time"] ?? null,
        "Earliest scheduled date": body["Earliest scheduled date"] ?? null,
        "Max scheduled date": body["Max scheduled date"] ?? null,
      }),
    );
    return reply(copy(store.get(id)));
  });
  post.mockImplementation((_url: string, body: { uuid: string; programEnrolmentUUID?: string }) => {
    store.set(
      body.uuid,
      touch({
        ...booked,
        ID: body.uuid,
        observations: {},
        ...(body.programEnrolmentUUID ? { "Enrolment ID": body.programEnrolmentUUID } : {}),
      }),
    );
    return reply({ success: true });
  });
  return { store, stamped };
}

describe("takeCase and releaseCase", () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    post.mockReset();
    patch.mockReset();
  });

  const bookedRow = { kind: "booked", review: { encounterUuid: "r1" } } as unknown as QueueRow;
  const screening = { ...booked, ID: "scr1", "Subject ID": "sub1", "Encounter type": "Oral Screening", "Encounter date time": "2026-11-20T00:00:00Z" };
  const screeningRow = { kind: "screening", screening } as unknown as QueueRow;
  const programReview = (extra: Partial<EncounterApiResponse> = {}) => bookedWith({ Other: "x" }, { "Enrolment ID": "enr1", ...extra });

  it("a standalone booked take PATCHes only the encounter type and the marker, then reads the review again", async () => {
    const { store } = fakeServer([bookedWith({ Other: "x" })]);
    expect(await takeCase(bookedRow, "dr.a", t0)).toEqual({ reviewUuid: "r1" });
    expect(put).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledTimes(1);
    const [url, body] = patch.mock.calls[0];
    expect(url).toBe("/api/encounter/r1");
    expect(body).toEqual({ "Encounter type": "Clinician Review Form", observations: stamp });
    expect(get.mock.calls.map(([u]) => u)).toEqual(["/api/encounter/r1", "/api/encounter/r1"]);
    expect(store.get("r1")?.observations).toEqual({ Other: "x", ...stamp });
  });

  it("a submit that lands between the read and the hold write stands, and the take is refused as completed", async () => {
    const { store } = fakeServer([booked]);
    patch.mockImplementationOnce(() => {
      // The other physician's submit lands first; the hold write then merges its two fields only.
      store.set("r1", { ...booked, "Encounter date time": "2026-11-23T10:00:00.500Z", observations: { Diagnosis: "d" } });
      const r = store.get("r1")!;
      store.set("r1", { ...r, observations: { ...r.observations, ...stamp } });
      return reply({});
    });
    expect(await takeCase(bookedRow, "dr.a", t0)).toEqual({ refused: "completed" });
    expect(store.get("r1")?.["Encounter date time"]).toBe("2026-11-23T10:00:00.500Z");
    expect(store.get("r1")?.observations).toMatchObject({ Diagnosis: "d" });
  });

  it("two takes that overlap: the one whose marker the re-read does not show is refused as held", async () => {
    const { store } = fakeServer([booked]);
    patch.mockImplementationOnce(() => {
      // dr.b's write lands just after dr.a's.
      store.set("r1", heldBy("dr.b", t0));
      return reply({});
    });
    expect(await takeCase(bookedRow, "dr.a", t0)).toEqual({ refused: "held" });
  });

  it("a programme booked take sends the whole-visit PUT on the programme endpoint, and reads the review again", async () => {
    const { store } = fakeServer([programReview()]);
    expect(await takeCase(bookedRow, "dr.a", t0)).toEqual({ reviewUuid: "r1" });
    expect(patch).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledTimes(1);
    const [url, body] = put.mock.calls[0];
    expect(url).toBe("/api/programEncounter/r1");
    expect(body).toMatchObject({
      cancelObservations: {},
      "Encounter date time": null,
      "Earliest scheduled date": booked["Earliest scheduled date"],
      "Max scheduled date": booked["Max scheduled date"],
    });
    expect(body).not.toHaveProperty("Subject ID");
    expect(body.observations).toEqual({ Other: "x", ...stamp });
    expect(store.get("r1")?.observations).toEqual({ Other: "x", ...stamp });
  });

  it.each([
    ["completed", completedReview],
    ["gone", cancelledReview],
    ["gone", voidedReview],
    ["held", heldBy("dr.b", t0)],
  ])("a booked take refused as %s writes nothing", async (refused, review) => {
    fakeServer([review]);
    expect(await takeCase(bookedRow, "dr.a", t0)).toEqual({ refused });
    expect(patch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("a booked review that is deleted (404 from both endpoints) is refused as gone", async () => {
    fakeServer([]);
    expect(await takeCase(bookedRow, "dr.a", t0)).toEqual({ refused: "gone" });
    expect(patch).not.toHaveBeenCalled();
  });

  it("an unbooked take whose derived review is a 404 sends the web POST, then the PATCH with the stamp", async () => {
    const uuid = await reviewUuidFor("scr1");
    const { store } = fakeServer([], [screening]);
    expect(await takeCase(screeningRow, "dr.a", t0)).toEqual({ reviewUuid: uuid });
    expect(post).toHaveBeenCalledTimes(1);
    const expected = createReviewVisit(screening, uuid, t0);
    expect(post.mock.calls[0]).toEqual([expected.url, expected.body]);
    expect(put).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledTimes(1);
    const [url, body] = patch.mock.calls[0];
    expect(url).toBe(`/api/encounter/${uuid}`);
    expect(body).toEqual({
      "Encounter type": "Clinician Review Form",
      observations: { ...stamp, "Reviewed Oral Screening": "scr1" },
    });
    expect(post.mock.invocationCallOrder[0]).toBeLessThan(patch.mock.invocationCallOrder[0]);
    expect(store.get(uuid)?.observations).toEqual({ ...stamp, "Reviewed Oral Screening": "scr1" });
  });

  it("an unbooked programme take sends the programme web POST, then the PUT with the stamp", async () => {
    const uuid = await reviewUuidFor("scr1");
    const inProgramme = { ...screening, "Enrolment ID": "enr1" };
    fakeServer([], [inProgramme]);
    expect(await takeCase({ kind: "screening", screening: inProgramme } as unknown as QueueRow, "dr.a", t0)).toEqual({
      reviewUuid: uuid,
    });
    expect(post.mock.calls[0][0]).toBe("/web/programEncounters");
    expect(patch).not.toHaveBeenCalled();
    expect(put.mock.calls[0][0]).toBe(`/api/programEncounter/${uuid}`);
    expect(put.mock.calls[0][1].observations).toEqual({ ...stamp, "Reviewed Oral Screening": "scr1" });
  });

  it("an unbooked take whose derived review exists sends no POST, only the PATCH", async () => {
    const uuid = await reviewUuidFor("scr1");
    fakeServer([{ ...booked, ID: uuid }], [screening]);
    expect(await takeCase(screeningRow, "dr.a", t0)).toEqual({ reviewUuid: uuid });
    expect(post).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0][1].observations).toEqual({ ...stamp, "Reviewed Oral Screening": "scr1" });
  });

  it("an unbooked take whose derived review is held by someone else writes nothing", async () => {
    const uuid = await reviewUuidFor("scr1");
    fakeServer([{ ...heldBy("dr.b", t0), ID: uuid }], [screening]);
    expect(await takeCase(screeningRow, "dr.a", t0)).toEqual({ refused: "held" });
    expect(patch).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("a web POST answering success false throws and writes nothing", async () => {
    fakeServer([], [screening]);
    post.mockResolvedValue({ data: { success: false, errorMessage: "outside catchment" } });
    await expect(takeCase(screeningRow, "dr.a", t0)).rejects.toThrow("outside catchment");
    expect(patch).not.toHaveBeenCalled();
  });

  it("a failed POST that left a completed review behind is refused as completed", async () => {
    const uuid = await reviewUuidFor("scr1");
    const { store } = fakeServer([], [screening]);
    post.mockImplementation(() => {
      store.set(uuid, { ...completedReview, ID: uuid });
      return Promise.reject(serverError());
    });
    expect(await takeCase(screeningRow, "dr.a", t0)).toEqual({ refused: "completed" });
    expect(patch).not.toHaveBeenCalled();
  });

  it("a failed POST with no review behind it is rethrown", async () => {
    fakeServer([], [screening]);
    post.mockRejectedValue(serverError());
    await expect(takeCase(screeningRow, "dr.a", t0)).rejects.toThrow("boom");
    expect(patch).not.toHaveBeenCalled();
  });

  it("a GET failure other than 404 is rethrown", async () => {
    get.mockImplementation(() => Promise.reject(serverError()));
    await expect(takeCase(screeningRow, "dr.a", t0)).rejects.toThrow("boom");
    expect(post).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("a hold write failing once is retried and the take succeeds", async () => {
    fakeServer([booked]);
    const real = patch.getMockImplementation()!;
    patch.mockImplementationOnce(() => Promise.reject(serverError()));
    patch.mockImplementationOnce(real);
    expect(await takeCase(bookedRow, "dr.a", t0)).toEqual({ reviewUuid: "r1" });
    expect(patch).toHaveBeenCalledTimes(2);
  });

  it("a hold write failing twice throws", async () => {
    fakeServer([booked]);
    patch.mockImplementation(() => Promise.reject(serverError()));
    await expect(takeCase(bookedRow, "dr.a", t0)).rejects.toThrow("boom");
    expect(patch).toHaveBeenCalledTimes(2);
  });

  it("a first hold write that fails, then a re-read showing the review completed, sends no second write", async () => {
    const { store } = fakeServer([booked]);
    patch.mockImplementationOnce(() => {
      store.set("r1", completedReview);
      return Promise.reject(serverError());
    });
    expect(await takeCase(bookedRow, "dr.a", t0)).toEqual({ refused: "completed" });
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it("a first hold write that fails, then a re-read showing another physician's live hold, sends no second write", async () => {
    const { store } = fakeServer([booked]);
    patch.mockImplementationOnce(() => {
      store.set("r1", heldBy("dr.b", t0));
      return Promise.reject(serverError());
    });
    expect(await takeCase(bookedRow, "dr.a", t0)).toEqual({ refused: "held" });
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it("a retried programme take is built from the fresh copy", async () => {
    const { store } = fakeServer([programReview()]);
    const real = put.getMockImplementation()!;
    put.mockImplementationOnce(() => {
      store.set("r1", programReview({ observations: { Fresh: "y" } }));
      return Promise.reject(serverError());
    });
    put.mockImplementationOnce(real);
    expect(await takeCase(bookedRow, "dr.a", t0)).toEqual({ reviewUuid: "r1" });
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[1][1].observations).toEqual({ Fresh: "y", ...stamp });
  });

  it("a review read after a successful POST that is no longer takeable is refused with no write", async () => {
    const uuid = await reviewUuidFor("scr1");
    const { store } = fakeServer([], [screening]);
    post.mockImplementation(() => {
      store.set(uuid, { ...completedReview, ID: uuid });
      return reply({ success: true });
    });
    expect(await takeCase(screeningRow, "dr.a", t0)).toEqual({ refused: "completed" });
    expect(patch).not.toHaveBeenCalled();
  });

  it("a web POST answering 200 without the success flag throws", async () => {
    fakeServer([], [screening]);
    post.mockResolvedValue({ data: {} });
    await expect(takeCase(screeningRow, "dr.a", t0)).rejects.toThrow();
    expect(patch).not.toHaveBeenCalled();
  });

  // FW7: the load can miss the screening's real review (a capped read, a cold cache), so before a new review is made the
  // patient's reviews are read from the server.
  describe("a screening that has a review this load did not see", () => {
    const at = (min: number) => new Date(Date.UTC(2026, 10, 20, 9, min)).toISOString();
    const scr = { ...screening, audit: { "Created at": at(0) } };
    const other = { ...screening, ID: "scr0", "Encounter date time": "2026-11-10T00:00:00Z", audit: { "Created at": at(-60 * 24 * 10) } };
    const bookedFor = (id: string, extra: Partial<EncounterApiResponse> = {}): EncounterApiResponse => ({
      ...booked,
      ID: id,
      audit: { "Created at": at(0) },
      ...extra,
    });

    it.each([
      ["a planned review the screening booked", bookedFor("rB")],
      ["a completed review stamped with the screening", bookedFor("rC", { "Encounter date time": at(30), observations: { "Reviewed Oral Screening": "scr1" } })],
    ])("refuses with no POST when the patient has %s", async (_n, review) => {
      fakeServer([], [scr, review]);
      expect(await takeCase({ kind: "screening", screening: scr } as unknown as QueueRow, "dr.a", t0)).toEqual({
        refused: "reviewed",
      });
      expect(post).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
      expect(get.mock.calls.some(([u, c]) => u === "/api/encounters" && c?.params?.subjectId === "sub1")).toBe(true);
    });

    it.each([
      ["voided", { Voided: true }],
      ["cancelled", { "Cancel date time": at(5), "Earliest scheduled date": at(0) }],
    ])("creates the review when the only one that pairs is %s", async (_n, extra) => {
      const uuid = await reviewUuidFor("scr1");
      fakeServer([], [scr, bookedFor("rX", { observations: { "Reviewed Oral Screening": "scr1" }, ...extra })]);
      expect(await takeCase({ kind: "screening", screening: scr } as unknown as QueueRow, "dr.a", t0)).toEqual({
        reviewUuid: uuid,
      });
      expect(post).toHaveBeenCalledTimes(1);
    });

    it("creates the review when the patient's review covers another of their screenings", async () => {
      const uuid = await reviewUuidFor("scr1");
      const done = bookedFor("rOld", { "Encounter date time": "2026-11-11T00:00:00Z", observations: { "Reviewed Oral Screening": "scr0" } });
      fakeServer([], [scr, other, done]);
      expect(await takeCase({ kind: "screening", screening: scr } as unknown as QueueRow, "dr.a", t0)).toEqual({
        reviewUuid: uuid,
      });
      expect(post).toHaveBeenCalledTimes(1);
    });

    it("reads a programme screening's reviews in its enrolment", async () => {
      const inProgramme = { ...scr, "Enrolment ID": "enr1" };
      fakeServer([], [inProgramme, bookedFor("rB", { "Enrolment ID": "enr1" })]);
      expect(await takeCase({ kind: "screening", screening: inProgramme } as unknown as QueueRow, "dr.a", t0)).toEqual({
        refused: "reviewed",
      });
      expect(post).not.toHaveBeenCalled();
      expect(get.mock.calls.some(([u, c]) => u === "/api/programEncounters" && c?.params?.programEnrolmentId === "enr1")).toBe(true);
    });
  });

  // FW7: a POST can fail after it, or another physician's take, made the review.
  it.each([
    ["fails", () => Promise.reject(serverError())],
    ["answers success false", () => reply({ success: false, errorMessage: "already exists" })],
  ])("a POST that %s but left an open review behind goes on to the hold write", async (_n, answer) => {
    const uuid = await reviewUuidFor("scr1");
    const { store } = fakeServer([], [screening]);
    post.mockImplementation(() => {
      store.set(uuid, { ...booked, ID: uuid });
      return answer();
    });
    expect(await takeCase(screeningRow, "dr.a", t0)).toEqual({ reviewUuid: uuid });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(store.get(uuid)?.observations).toEqual({ ...stamp, "Reviewed Oral Screening": "scr1" });
  });

  it("a failed POST that left a review another physician holds is refused as held", async () => {
    const uuid = await reviewUuidFor("scr1");
    const { store } = fakeServer([], [screening]);
    post.mockImplementation(() => {
      store.set(uuid, { ...heldBy("dr.b", t0), ID: uuid });
      return Promise.reject(serverError());
    });
    expect(await takeCase(screeningRow, "dr.a", t0)).toEqual({ refused: "held" });
    expect(patch).not.toHaveBeenCalled();
  });

  it("release by the holder PATCHes nulls for both marker fields and nothing else", async () => {
    const { store } = fakeServer([bookedWith({ ...stamp, Other: "x" })]);
    await releaseCase("r1", "dr.a");
    expect(put).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]).toEqual([
      "/api/encounter/r1",
      { "Encounter type": "Clinician Review Form", observations: { "In review by": null, "In review since": null } },
    ]);
    expect(store.get("r1")?.observations).toEqual({ Other: "x" });
  });

  it("release of a programme review by the holder sends the whole-visit PUT without the marker", async () => {
    fakeServer([programReview({ observations: { ...stamp, Other: "x" } })]);
    await releaseCase("r1", "dr.a");
    expect(patch).not.toHaveBeenCalled();
    const [url, body] = put.mock.calls[0];
    expect(url).toBe("/api/programEncounter/r1");
    expect(body).toMatchObject({ "Encounter date time": null, "Max scheduled date": booked["Max scheduled date"] });
    expect(body.observations).toEqual({ Other: "x" });
  });

  it.each([
    ["cancelled", { "Cancel date time": "2026-11-23T09:00:00Z" }],
    ["voided", { Voided: true }],
  ])("release of a %s review held by the viewer sends nothing", async (_n, extra) => {
    fakeServer([bookedWith(stamp, extra)]);
    await releaseCase("r1", "dr.a");
    expect(patch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("a retried release stops when the re-read shows the review completed", async () => {
    const { store } = fakeServer([bookedWith(stamp)]);
    patch.mockImplementationOnce(() => {
      store.set("r1", completedReview);
      return Promise.reject(serverError());
    });
    await releaseCase("r1", "dr.a");
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it("release of the viewer's own expired marker still removes it", async () => {
    const { store } = fakeServer([heldBy("dr.a", minus(t0, 30))]);
    await releaseCase("r1", "dr.a");
    expect(patch).toHaveBeenCalledTimes(1);
    expect(store.get("r1")?.observations).toEqual({});
  });

  it("release by a non-holder, on an unheld review or on a completed one sends nothing", async () => {
    for (const review of [heldBy("dr.b", t0), booked, { ...completedReview, observations: stamp }]) {
      fakeServer([review]);
      await releaseCase("r1", "dr.a");
    }
    expect(patch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});
