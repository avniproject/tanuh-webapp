import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ENCOUNTER_TYPE } from "@/constants/tanuhConcepts";

const { get, put, post } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock("@/auth/httpClient", () => ({
  http: {
    get: (...a: unknown[]) => get(...a),
    put: (...a: unknown[]) => put(...a),
    post: (...a: unknown[]) => post(...a),
  },
}));
import type { QueueRow } from "./queueRows";
import type { EncounterApiResponse } from "./types";
import {
  createReviewVisit,
  decideTake,
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

const notFound = () => new AxiosError("nf", "ERR_BAD_REQUEST", undefined, undefined, { status: 404 } as never);
const serverError = () => new AxiosError("boom", "ERR_BAD_RESPONSE", undefined, undefined, { status: 500 } as never);
const stamp = { "In review by": "dr.a", "In review since": t0.toISOString() };

describe("takeCase and releaseCase", () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    post.mockReset();
    put.mockResolvedValue({ data: {} });
  });

  const bookedRow = { kind: "booked", review: { encounterUuid: "r1" } } as unknown as QueueRow;
  const screening = { ...booked, ID: "scr1", "Subject ID": "sub1", "Encounter date time": "2026-11-20T00:00:00Z" };
  const screeningRow = { kind: "screening", screening } as unknown as QueueRow;
  const reply = (data: unknown) => Promise.resolve({ data });

  it("a booked take sends one PUT carrying the marker and the window", async () => {
    get.mockImplementation(() => reply(bookedWith({ "Other": "x" })));
    expect(await takeCase(bookedRow, "dr.a", t0)).toEqual({ reviewUuid: "r1" });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe("/api/encounter/r1");
    expect(put).toHaveBeenCalledTimes(1);
    const [url, body] = put.mock.calls[0];
    expect(url).toBe("/api/encounter/r1");
    expect(body).toMatchObject({
      cancelObservations: {},
      "Encounter date time": null,
      "Earliest scheduled date": booked["Earliest scheduled date"],
      "Max scheduled date": booked["Max scheduled date"],
    });
    expect(body.observations).toEqual({ Other: "x", ...stamp });
  });

  it("a booked take inside a programme uses the programme endpoint", async () => {
    get.mockImplementation(() => reply(bookedWith({}, { "Enrolment ID": "enr1" })));
    await takeCase(bookedRow, "dr.a", t0);
    expect(put.mock.calls[0][0]).toBe("/api/programEncounter/r1");
  });

  it.each([
    ["completed", completedReview],
    ["gone", cancelledReview],
    ["gone", voidedReview],
    ["held", heldBy("dr.b", t0)],
  ])("a booked take refused as %s writes nothing", async (refused, review) => {
    get.mockImplementation(() => reply(review));
    expect(await takeCase(bookedRow, "dr.a", t0)).toEqual({ refused });
    expect(put).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("a booked review that is deleted (404 from both endpoints) is refused as gone", async () => {
    get.mockImplementation(() => Promise.reject(notFound()));
    expect(await takeCase(bookedRow, "dr.a", t0)).toEqual({ refused: "gone" });
    expect(put).not.toHaveBeenCalled();
  });

  it("an unbooked take whose derived review is a 404 sends the web POST, then the PUT with the stamp", async () => {
    const uuid = await reviewUuidFor("scr1");
    let created = false;
    get.mockImplementation(() => {
      if (!created) return Promise.reject(notFound());
      return reply({ ...booked, ID: uuid });
    });
    post.mockImplementation(() => {
      created = true;
      return reply({ success: true });
    });
    expect(await takeCase(screeningRow, "dr.a", t0)).toEqual({ reviewUuid: uuid });
    expect(post).toHaveBeenCalledTimes(1);
    const expected = createReviewVisit(screening, uuid, t0);
    expect(post.mock.calls[0]).toEqual([expected.url, expected.body]);
    expect(put).toHaveBeenCalledTimes(1);
    const [url, body] = put.mock.calls[0];
    expect(url).toBe(`/api/encounter/${uuid}`);
    expect(body).toMatchObject({
      cancelObservations: {},
      "Encounter date time": null,
      "Earliest scheduled date": booked["Earliest scheduled date"],
      observations: { ...stamp, "Reviewed Oral Screening": "scr1" },
    });
    expect(post.mock.invocationCallOrder[0]).toBeLessThan(put.mock.invocationCallOrder[0]);
  });

  it("an unbooked take whose derived review exists sends no POST, only the PUT", async () => {
    const uuid = await reviewUuidFor("scr1");
    get.mockImplementation(() => reply({ ...booked, ID: uuid }));
    expect(await takeCase(screeningRow, "dr.a", t0)).toEqual({ reviewUuid: uuid });
    expect(post).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][1].observations).toEqual({ ...stamp, "Reviewed Oral Screening": "scr1" });
  });

  it("an unbooked take whose derived review is held by someone else writes nothing", async () => {
    get.mockImplementation(() => reply(heldBy("dr.b", t0)));
    expect(await takeCase(screeningRow, "dr.a", t0)).toEqual({ refused: "held" });
    expect(put).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("a web POST answering success false throws and sends no PUT", async () => {
    get.mockImplementation(() => Promise.reject(notFound()));
    post.mockResolvedValue({ data: { success: false, errorMessage: "outside catchment" } });
    await expect(takeCase(screeningRow, "dr.a", t0)).rejects.toThrow("outside catchment");
    expect(put).not.toHaveBeenCalled();
  });

  it("a failed POST that left a completed review behind is refused as completed", async () => {
    let posted = false;
    get.mockImplementation(() => (posted ? reply(completedReview) : Promise.reject(notFound())));
    post.mockImplementation(() => {
      posted = true;
      return Promise.reject(serverError());
    });
    expect(await takeCase(screeningRow, "dr.a", t0)).toEqual({ refused: "completed" });
    expect(put).not.toHaveBeenCalled();
  });

  it("a failed POST with no completed review behind it is rethrown", async () => {
    get.mockImplementation(() => Promise.reject(notFound()));
    post.mockRejectedValue(serverError());
    await expect(takeCase(screeningRow, "dr.a", t0)).rejects.toThrow("boom");
    expect(put).not.toHaveBeenCalled();
  });

  it("a GET failure other than 404 is rethrown", async () => {
    get.mockImplementation(() => Promise.reject(serverError()));
    await expect(takeCase(screeningRow, "dr.a", t0)).rejects.toThrow("boom");
    expect(post).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("a PUT failing once is retried and the take succeeds", async () => {
    get.mockImplementation(() => reply(booked));
    put.mockRejectedValueOnce(serverError()).mockResolvedValueOnce({ data: {} });
    expect(await takeCase(bookedRow, "dr.a", t0)).toEqual({ reviewUuid: "r1" });
    expect(put).toHaveBeenCalledTimes(2);
  });

  it("a PUT failing twice throws", async () => {
    get.mockImplementation(() => reply(booked));
    put.mockRejectedValue(serverError());
    await expect(takeCase(bookedRow, "dr.a", t0)).rejects.toThrow("boom");
    expect(put).toHaveBeenCalledTimes(2);
  });

  it("release by the holder removes the marker and keeps the rest and the window", async () => {
    get.mockImplementation(() => reply(bookedWith({ ...stamp, Other: "x" })));
    await releaseCase("r1", "dr.a");
    expect(put).toHaveBeenCalledTimes(1);
    const [url, body] = put.mock.calls[0];
    expect(url).toBe("/api/encounter/r1");
    expect(body).toMatchObject({
      cancelObservations: {},
      "Encounter date time": null,
      "Max scheduled date": booked["Max scheduled date"],
    });
    expect(body.observations).toEqual({ Other: "x" });
  });

  it.each([
    ["cancelled", { "Cancel date time": "2026-11-23T09:00:00Z" }],
    ["voided", { Voided: true }],
  ])("release of a %s review held by the viewer sends nothing", async (_n, extra) => {
    get.mockImplementation(() => reply(bookedWith(stamp, extra)));
    await releaseCase("r1", "dr.a");
    expect(put).not.toHaveBeenCalled();
  });

  it("a first PUT that fails, then a re-read showing the review completed, sends no second PUT", async () => {
    get.mockResolvedValueOnce({ data: booked }).mockResolvedValueOnce({ data: completedReview });
    put.mockRejectedValueOnce(serverError());
    expect(await takeCase(bookedRow, "dr.a", t0)).toEqual({ refused: "completed" });
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("a first PUT that fails, then a re-read showing another physician's live hold, sends no second PUT", async () => {
    get.mockResolvedValueOnce({ data: booked }).mockResolvedValueOnce({ data: heldBy("dr.b", t0) });
    put.mockRejectedValueOnce(serverError());
    expect(await takeCase(bookedRow, "dr.a", t0)).toEqual({ refused: "held" });
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("a retried take is built from the fresh copy", async () => {
    get.mockResolvedValueOnce({ data: booked }).mockResolvedValueOnce({ data: bookedWith({ Fresh: "y" }) });
    put.mockRejectedValueOnce(serverError()).mockResolvedValueOnce({ data: {} });
    expect(await takeCase(bookedRow, "dr.a", t0)).toEqual({ reviewUuid: "r1" });
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[1][1].observations).toEqual({ Fresh: "y", ...stamp });
  });

  it("a retried release stops when the re-read shows the review completed", async () => {
    get.mockResolvedValueOnce({ data: bookedWith(stamp) }).mockResolvedValueOnce({ data: completedReview });
    put.mockRejectedValueOnce(serverError());
    await releaseCase("r1", "dr.a");
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("a review read after a successful POST that is no longer takeable is refused with no PUT", async () => {
    let posted = false;
    get.mockImplementation(() => (posted ? reply(completedReview) : Promise.reject(notFound())));
    post.mockImplementation(() => {
      posted = true;
      return reply({ success: true });
    });
    expect(await takeCase(screeningRow, "dr.a", t0)).toEqual({ refused: "completed" });
    expect(put).not.toHaveBeenCalled();
  });

  it("a web POST answering 200 without the success flag throws", async () => {
    get.mockImplementation(() => (post.mock.calls.length ? reply(booked) : Promise.reject(notFound())));
    post.mockResolvedValue({ data: {} });
    await expect(takeCase(screeningRow, "dr.a", t0)).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });

  it("release of the viewer's own expired marker still removes it", async () => {
    get.mockImplementation(() => reply(heldBy("dr.a", minus(t0, 30))));
    await releaseCase("r1", "dr.a");
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][1].observations).toEqual({});
  });

  it("release by a non-holder, on an unheld review or on a completed one sends nothing", async () => {
    for (const review of [heldBy("dr.b", t0), booked, { ...completedReview, observations: stamp }]) {
      get.mockImplementation(() => reply(review));
      await releaseCase("r1", "dr.a");
    }
    expect(put).not.toHaveBeenCalled();
  });
});
