import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Catchment } from "@/api/catchment";
import type { CachedEncounter } from "@/api/encounters";
import type { EncounterWithLocation, PlacementTarget } from "@/api/impl";
import { queueRowKey, rowHoldStatus, type QueueRow } from "@/api/queueRows";
import type { SubjectApiResponse } from "@/api/types";
import { noteServerDate, resetServerClock } from "@/auth/serverClock";
import {
  IN_REVIEW_BY_CONCEPT,
  IN_REVIEW_SINCE_CONCEPT,
  OCSHR_RESULT_CONCEPT,
  REVIEWED_ORAL_SCREENING_CONCEPT,
} from "@/constants/tanuhConcepts";

const m = vi.hoisted(() => ({
  getCatchment: vi.fn(),
  getCachedEncounters: vi.fn(),
  getAll: vi.fn(),
  getProgram: vi.fn(),
  readSubjects: vi.fn(),
  find: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@/api/catchment", () => ({ getCatchment: () => m.getCatchment() }));
vi.mock("@/api/encounters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/encounters")>()),
  getCachedEncounters: (type: string) => m.getCachedEncounters(type),
  invalidateCachedEncounters: () => m.invalidate(),
  invalidateEncounterSweeps: vi.fn(),
}));
vi.mock("@/api/impl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/impl")>()),
  getAllEncountersWithLocation: (p: unknown) => m.getAll(p),
  findInLocation: (type: string, place: string, targets: PlacementTarget[], foundElsewhere: Set<string>) =>
    m.find(type, place, targets, foundElsewhere),
}));
vi.mock("@/api/programList", () => ({
  getProgramEncountersWithLocation: (p: unknown) => m.getProgram(p),
  readSubjects: (ids: string[]) => m.readSubjects(ids),
}));

import {
  chosenPlace,
  lightRefresh,
  loadPendingQueue,
  placeScreenings,
  placesToRead,
  readReviewsByPlace,
  refreshPendingQueue,
  refreshQueue,
  startQueueRefresh,
  takeNextFromQueue,
  type PendingQueue,
  type RefreshGate,
} from "./usePendingQueue";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 23, 9, minute)).toISOString();

const catchment = (covered: string[], tops: string[]): Catchment => ({
  covered: new Set(covered),
  tops,
  contains: (uuid) => !!uuid && covered.includes(uuid),
  placesUnder: () => new Set(),
});
// A ready FLW-marked screening on its own patient.
const screening = (id: string, patient: string, minute: number): CachedEncounter =>
  ({
    ID: id,
    "Subject ID": patient,
    Voided: false,
    "Encounter type": "Oral Screening",
    "Encounter date time": at(minute),
    flwPositive: true,
    edgeVerdict: null,
    observations: { [OCSHR_RESULT_CONCEPT.name]: "Not High Risk" },
    audit: { "Created at": at(minute) },
  }) as unknown as CachedEncounter;
const review = (uuid: string, patient = "pb-" + uuid): EncounterWithLocation => ({
  encounterUuid: uuid,
  encounterTypeName: "Clinician Review Form",
  encounterDateTime: null,
  earliestScheduledDate: at(0),
  voided: false,
  subject: { uuid: patient, externalId: null, displayName: "", location: { Village: "V" } },
  lastModifiedBy: null,
});
const patient = (id: string, place: string, voided = false): SubjectApiResponse =>
  ({ ID: id, "External ID": null, "Subject type": "Person", Voided: voided, observations: {}, "Location ID": place }) as
    SubjectApiResponse;
const standalone = (rows: EncounterWithLocation[]) => ({ content: rows, totalElements: rows.length });
const program = (rows: EncounterWithLocation[], unchecked: string[] = []) => ({ rows, unchecked: new Set(unchecked) });

// The physician covers district d1 (top) and its village v1. `inPlaces` is what the server's lookup places in d1; the
// lookup rules out every other screening when `complete`, and leaves it unsettled otherwise.
function given({
  tops = ["d1"],
  booked = [] as EncounterWithLocation[],
  programRows = program([]),
  screenings = [] as CachedEncounter[],
  reviews = [] as CachedEncounter[],
  patients = new Map<string, SubjectApiResponse | null>(),
  inPlaces = [] as string[],
  complete = true,
} = {}) {
  m.find.mockImplementation(
    (_type: string, _place: string, targets: PlacementTarget[], foundElsewhere: Set<string>) => {
      const found = new Set(targets.filter((t) => inPlaces.includes(t.uuid)).map((t) => t.uuid));
      found.forEach((uuid) => foundElsewhere.add(uuid));
      const ruledOut = new Set(complete ? targets.filter((t) => !found.has(t.uuid)).map((t) => t.uuid) : []);
      return Promise.resolve({ found, ruledOut });
    },
  );
  m.getCatchment.mockResolvedValue(catchment(tops.length ? ["d1", "v1"] : [], tops));
  m.getAll.mockResolvedValue(standalone(booked));
  m.getProgram.mockResolvedValue(programRows);
  m.getCachedEncounters.mockImplementation((type: string) =>
    Promise.resolve(type === "Oral Screening" ? screenings : reviews),
  );
  m.readSubjects.mockImplementation((ids: string[]) =>
    Promise.resolve(new Map(ids.map((id) => [id, patients.has(id) ? patients.get(id)! : null]))),
  );
}

describe("loadPendingQueue", () => {
  beforeEach(() => {
    Object.values(m).forEach((f) => f.mockReset());
  });

  // FW10: a screening is placed by the server's lookup, not by reading every patient in the organisation.
  it("keeps a screening the server places in the physician's places, and drops one outside them unread", async () => {
    given({
      screenings: [screening("sIn", "pIn", 1), screening("sOut", "pOut", 2)],
      patients: new Map([
        ["pIn", patient("pIn", "v1")],
        ["pOut", patient("pOut", "elsewhere")],
      ]),
      inPlaces: ["sIn"],
    });
    const q = await loadPendingQueue("dr.a");
    expect(q.rows.map(queueRowKey)).toEqual(["sIn"]);
    expect(q.unread).toBe(0);
    expect(q.waiting).toMatchObject({ "FLW marked": 1, total: 1 });
    expect([...q.subjects.keys()]).toEqual(["pIn"]);
    expect(m.find).toHaveBeenCalledWith("Oral Screening", "d1", expect.any(Array), expect.any(Set));
    // The patient outside the places is never read.
    expect(m.readSubjects.mock.calls.flatMap(([ids]) => ids)).toEqual(["pIn"]);
  });

  it("drops a screening an incomplete lookup could not place and whose patient could not be read, and counts it", async () => {
    given({
      screenings: [screening("sIn", "pIn", 1), screening("sUnknown", "pUnknown", 2)],
      patients: new Map([["pIn", patient("pIn", "v1")]]),
      inPlaces: ["sIn"],
      complete: false,
    });
    const q = await loadPendingQueue("dr.a");
    expect(q.rows.map(queueRowKey)).toEqual(["sIn"]);
    expect(q.unread).toBe(1);
    expect(m.readSubjects.mock.calls.flatMap(([ids]) => ids)).toEqual(["pUnknown", "pIn"]);
  });

  // Review finding: a patient whose read failed while placing one screening was taken as read for another.
  it("reads again a patient whose read failed while placing another of their screenings", async () => {
    given({
      screenings: [screening("sOpen", "p1", 1), screening("sPlaced", "p1", 2)],
      patients: new Map([["p1", patient("p1", "v1")]]),
      inPlaces: ["sPlaced"],
      complete: false,
    });
    m.readSubjects.mockImplementationOnce((ids: string[]) => Promise.resolve(new Map(ids.map((id) => [id, null]))));
    const q = await loadPendingQueue("dr.a");
    expect(q.rows.map(queueRowKey)).toEqual(["sPlaced"]);
    expect(q.unread).toBe(1);
  });

  it("drops a placed screening whose patient could not be read, and counts it", async () => {
    given({
      screenings: [screening("sIn", "pIn", 1), screening("sUnread", "pUnread", 2)],
      patients: new Map([["pIn", patient("pIn", "v1")]]),
      inPlaces: ["sIn", "sUnread"],
    });
    const q = await loadPendingQueue("dr.a");
    expect(q.rows.map(queueRowKey)).toEqual(["sIn"]);
    expect(q.unread).toBe(1);
  });

  it("drops a placed screening whose patient is deleted, without counting it", async () => {
    given({
      screenings: [screening("sGone", "pGone", 1)],
      patients: new Map([["pGone", patient("pGone", "v1", true)]]),
      inPlaces: ["sGone"],
    });
    const q = await loadPendingQueue("dr.a");
    expect(q.rows).toEqual([]);
    expect(q.unread).toBe(0);
  });

  it("places a programme screening by its patient's place, which the lookup cannot see", async () => {
    const inProgramme = (id: string, p: string, minute: number) =>
      ({ ...screening(id, p, minute), "Enrolment ID": "e-" + p }) as CachedEncounter;
    given({
      screenings: [inProgramme("sP", "pP", 1), inProgramme("sQ", "pQ", 2), inProgramme("sR", "pR", 3)],
      patients: new Map([
        ["pP", patient("pP", "v1")],
        ["pQ", patient("pQ", "elsewhere")],
      ]),
    });
    const q = await loadPendingQueue("dr.a");
    expect(q.rows.map(queueRowKey)).toEqual(["sP"]);
    expect(q.unread).toBe(1);
    expect(m.find).not.toHaveBeenCalled();
  });

  it("reads nothing and lists nothing when the physician has no places", async () => {
    given({ tops: [], screenings: [screening("s1", "p1", 1)], patients: new Map([["p1", patient("p1", "v1")]]) });
    const q = await loadPendingQueue("dr.a");
    expect(q.rows).toEqual([]);
    expect(q.unread).toBe(0);
    expect(m.getAll).not.toHaveBeenCalled();
    expect(m.getProgram).not.toHaveBeenCalled();
    expect(m.readSubjects).not.toHaveBeenCalled();
    expect(m.find).not.toHaveBeenCalled();
  });

  it("drops a programme review that could not be placed, and counts it; keeps the booked reviews read by place", async () => {
    given({ booked: [review("rA")], programRows: program([review("rP")], ["rP"]) });
    const q = await loadPendingQueue("dr.a");
    expect(q.rows.map(queueRowKey)).toEqual(["rA"]);
    expect(q.unread).toBe(1);
    expect(m.getAll).toHaveBeenCalledWith(
      expect.objectContaining({ encounterType: "Clinician Review Form", status: "scheduled", locationUuid: "d1" }),
    );
  });

  it("fails when the physician's places cannot be read", async () => {
    given();
    m.getCatchment.mockRejectedValue(new Error("place list cut short"));
    await expect(loadPendingQueue("dr.a")).rejects.toThrow("place list cut short");
  });
});

describe("takeNextFromQueue", () => {
  beforeEach(() => {
    Object.values(m).forEach((f) => f.mockReset());
  });

  // The review page's Complete and review next case: the same pick as the list's Review next case button.
  it("reads the queue afresh and takes the oldest waiting case of the chosen group", async () => {
    given({
      screenings: [screening("sNew", "p1", 5), screening("sOld", "p2", 1)],
      patients: new Map([
        ["p1", patient("p1", "v1")],
        ["p2", patient("p2", "v1")],
      ]),
      inPlaces: ["sNew", "sOld"],
    });
    const take = vi.fn().mockResolvedValue({ reviewUuid: "r-old" });
    expect(await takeNextFromQueue("dr.a", take)).toBe("r-old");
    expect(take).toHaveBeenCalledTimes(1);
    expect(queueRowKey(take.mock.calls[0][0] as QueueRow)).toBe("sOld");
  });

  it("is null, and takes nothing, when no case is waiting", async () => {
    given();
    const take = vi.fn();
    expect(await takeNextFromQueue("dr.a", take)).toBeNull();
    expect(take).not.toHaveBeenCalled();
  });

  it("fails when the queue cannot be read", async () => {
    given();
    m.getCatchment.mockRejectedValue(new Error("places unreadable"));
    await expect(takeNextFromQueue("dr.a", vi.fn())).rejects.toThrow("places unreadable");
  });
});

describe("readReviewsByPlace", () => {
  beforeEach(() => {
    Object.values(m).forEach((f) => f.mockReset());
  });

  // FW6: a programme review whose patient could not be read cannot be placed, so it is left out and counted.
  it("reads each place, merges the reviews by uuid, and leaves out and counts the reviews it could not place", async () => {
    m.getAll.mockImplementation(({ locationUuid }: { locationUuid: string }) =>
      Promise.resolve(
        locationUuid === "d1"
          ? standalone([review("a"), review("b")])
          : standalone([review("b"), review("c")]),
      ),
    );
    m.getProgram.mockImplementation(({ locationUuid }: { locationUuid: string }) =>
      // p1 is placed under d1; p2 could be placed under neither.
      Promise.resolve(locationUuid === "d1" ? program([review("p1"), review("p2")], ["p2"]) : program([review("p1"), review("p2")], ["p1", "p2"])),
    );
    const read = await readReviewsByPlace(["d1", "d2"], { encounterType: "Clinician Review Form", status: "scheduled" });
    expect(read.content.map((e) => e.encounterUuid).sort()).toEqual(["a", "b", "c", "p1"]);
    expect(read.unread).toBe(1);
    // The standalone totals of the two places, 2 + 2, and the one placed programme review.
    expect(read.totalElements).toBe(5);
    expect(m.getAll.mock.calls.map(([p]) => (p as { locationUuid: string }).locationUuid)).toEqual(["d1", "d2"]);
    expect(m.getProgram.mock.calls.map(([p]) => (p as { locationUuid: string }).locationUuid)).toEqual(["d1", "d2"]);
  });

  it("reads nothing for no places", async () => {
    const read = await readReviewsByPlace([], { encounterType: "Clinician Review Form", status: "scheduled" });
    expect(read.content).toEqual([]);
    expect(m.getAll).not.toHaveBeenCalled();
  });
});

// FW5 and FW10: the screenings a list may show are those in the physician's places.
describe("placeScreenings", () => {
  beforeEach(() => {
    Object.values(m).forEach((f) => f.mockReset());
  });
  // A new pair of places per test: answers are remembered per set of places.
  const places = () => catchment(["d1", "v1", "d2"], ["d1", "d2"]);
  // `byPlace` says what each place's lookup finds; `settled` whether it rules out the rest (true) or leaves them open.
  const lookups = (byPlace: Record<string, string[]>, settled: Record<string, boolean> = {}) =>
    m.find.mockImplementation((_t: string, place: string, targets: PlacementTarget[], foundElsewhere: Set<string>) => {
      const found = new Set(targets.filter((t) => byPlace[place]?.includes(t.uuid)).map((t) => t.uuid));
      found.forEach((uuid) => foundElsewhere.add(uuid));
      const rest = targets.filter((t) => !found.has(t.uuid)).map((t) => t.uuid);
      return Promise.resolve({ found, ruledOut: new Set(settled[place] === false ? [] : rest) });
    });
  const patientsAt = (where: Record<string, string | null>) =>
    m.readSubjects.mockImplementation((ids: string[]) =>
      Promise.resolve(new Map(ids.map((id) => [id, where[id] ? patient(id, where[id]!) : null]))),
    );
  const asked = () => m.find.mock.calls.map(([, place, targets]) => [place, (targets as PlacementTarget[]).map((t) => t.uuid)]);

  it("asks each top place only for the screenings to place, with their dates", async () => {
    lookups({ d1: ["s1"] });
    await placeScreenings([screening("s1", "p1", 1), screening("s2", "p2", 2)], places());
    expect(asked()).toEqual([
      ["d1", ["s1", "s2"]],
      ["d2", ["s1", "s2"]],
    ]);
    expect(m.find.mock.calls[0][2]).toEqual([
      { uuid: "s1", date: at(1) },
      { uuid: "s2", date: at(2) },
    ]);
  });

  it("places a screening found in any top place, and leaves out one every place ruled out", async () => {
    lookups({ d1: ["s1"], d2: ["s2"] });
    const placed = await placeScreenings([screening("s1", "p1", 1), screening("s2", "p2", 2), screening("s3", "p3", 3)], places());
    expect([...placed.placed].sort()).toEqual(["s1", "s2"]);
    expect(placed.unplaced.size).toBe(0);
    expect(m.readSubjects).not.toHaveBeenCalled();
  });

  it("places what the lookups could not settle by the patient's own place", async () => {
    lookups({}, { d2: false });
    patientsAt({ pIn: "v1", pOut: "elsewhere", pUnread: null });
    const placed = await placeScreenings(
      [screening("sIn", "pIn", 1), screening("sOut", "pOut", 2), screening("sUnread", "pUnread", 3)],
      places(),
    );
    expect([...placed.placed]).toEqual(["sIn"]);
    expect([...placed.unplaced]).toEqual(["sUnread"]);
    expect([...placed.subjects.keys()].sort()).toEqual(["pIn", "pOut", "pUnread"]);
  });

  it("reads at most 100 patients to place what the lookups could not settle", async () => {
    lookups({}, { d1: false, d2: false });
    patientsAt({});
    const many = Array.from({ length: 120 }, (_, i) => screening(`s${i}`, `p${i}`, i));
    const placed = await placeScreenings(many, places());
    expect(m.readSubjects.mock.calls.flatMap(([ids]) => ids)).toHaveLength(100);
    expect(placed.unplaced.size).toBe(120);
  });

  it("remembers what it placed and ruled out for the same places", async () => {
    const same = places();
    lookups({ d1: ["s1"] });
    await placeScreenings([screening("s1", "p1", 1), screening("s2", "p2", 2)], same);
    m.find.mockClear();
    const again = await placeScreenings([screening("s1", "p1", 1), screening("s2", "p2", 2)], same);
    expect([...again.placed]).toEqual(["s1"]);
    expect(m.find).not.toHaveBeenCalled();
    await placeScreenings([screening("s1", "p1", 1), screening("s2", "p2", 2), screening("s3", "p3", 3)], same);
    expect(asked()).toEqual([
      ["d1", ["s3"]],
      ["d2", ["s3"]],
    ]);
  });

  it("asks again about a screening it could not place", async () => {
    const same = places();
    lookups({}, { d2: false });
    patientsAt({});
    expect([...(await placeScreenings([screening("s2", "p2", 2)], same)).unplaced]).toEqual(["s2"]);
    m.find.mockClear();
    await placeScreenings([screening("s2", "p2", 2)], same);
    expect(asked()).toEqual([
      ["d1", ["s2"]],
      ["d2", ["s2"]],
    ]);
  });

  it("asks again about a screening that changed since", async () => {
    const same = places();
    lookups({});
    const changed = (minute: number) =>
      ({ ...screening("s1", "p1", 1), audit: { "Last modified at": at(minute) } }) as unknown as CachedEncounter;
    await placeScreenings([changed(1)], same);
    m.find.mockClear();
    await placeScreenings([changed(9)], same);
    expect(asked()).toEqual([
      ["d1", ["s1"]],
      ["d2", ["s1"]],
    ]);
  });

  it("starts afresh for new places", async () => {
    lookups({ d1: ["s1"] });
    await placeScreenings([screening("s1", "p1", 1)], places());
    m.find.mockClear();
    await placeScreenings([screening("s1", "p1", 1)], places());
    expect(asked()).toEqual([
      ["d1", ["s1"]],
      ["d2", ["s1"]],
    ]);
  });

  it("asks nothing when there is no screening, or no place", async () => {
    expect((await placeScreenings([], places())).placed.size).toBe(0);
    const none = await placeScreenings([screening("s1", "p1", 1)], catchment([], []));
    expect(none.placed.size + none.unplaced.size).toBe(0);
    expect(m.find).not.toHaveBeenCalled();
    expect(m.readSubjects).not.toHaveBeenCalled();
  });

  it("reads the patients of the oldest unsettled screenings first", async () => {
    lookups({}, { d1: false, d2: false });
    patientsAt({});
    const many = Array.from({ length: 120 }, (_, i) => screening(`s${i}`, `p${i}`, i)).reverse();
    await placeScreenings(many, places());
    const read = m.readSubjects.mock.calls.flatMap(([ids]) => ids);
    expect([...read].sort()).toEqual(Array.from({ length: 100 }, (_, i) => `p${i}`).sort());
  });

  it("places a patient's programme screening and unsettled standalone screening alike", async () => {
    lookups({}, { d2: false });
    patientsAt({ pX: "v1" });
    const inProgramme = { ...screening("sP", "pX", 1), "Enrolment ID": "e1" } as unknown as CachedEncounter;
    const placed = await placeScreenings([inProgramme, screening("sS", "pX", 2)], places());
    expect([...placed.placed].sort()).toEqual(["sP", "sS"]);
    expect(placed.unplaced.size).toBe(0);
    expect(placed.subjects.get("pX")?.["Location ID"]).toBe("v1");
    expect(asked()).toEqual([
      ["d1", ["sS"]],
      ["d2", ["sS"]],
    ]);
  });

  it("keeps a patient read for a programme screening when the second read of them fails", async () => {
    lookups({}, { d2: false });
    m.readSubjects
      .mockResolvedValueOnce(new Map([["pX", patient("pX", "v1")]]))
      .mockResolvedValueOnce(new Map([["pX", null]]));
    const inProgramme = { ...screening("sP", "pX", 1), "Enrolment ID": "e1" } as unknown as CachedEncounter;
    const placed = await placeScreenings([inProgramme, screening("sS", "pX", 2)], places());
    expect([...placed.placed]).toEqual(["sP"]);
    expect([...placed.unplaced]).toEqual(["sS"]);
    expect(placed.subjects.get("pX")?.["Location ID"]).toBe("v1");
  });
});

describe("chosenPlace", () => {
  const c = catchment(["d1", "v1"], ["d1"]);
  it("is the chosen place when it is one of the physician's, and none for a stale or foreign one", () => {
    expect(chosenPlace(c, "v1")).toBe("v1");
    expect(chosenPlace(c, "other")).toBeNull();
    expect(chosenPlace(c, null)).toBeNull();
    expect(chosenPlace(c, undefined)).toBeNull();
  });
});

describe("placesToRead", () => {
  const c = catchment(["d1", "v1", "d2"], ["d1", "d2"]);
  it("reads the chosen place when it is one of the physician's", () => {
    expect(placesToRead(c, "v1")).toEqual(["v1"]);
  });
  it("reads every top place when none is chosen", () => {
    expect(placesToRead(c, null)).toEqual(["d1", "d2"]);
  });
  it("ignores a chosen place outside the physician's places", () => {
    expect(placesToRead(c, "other")).toEqual(["d1", "d2"]);
  });
  it("reads nothing for a physician with no places", () => {
    expect(placesToRead(catchment([], []), "v1")).toEqual([]);
  });
});

// PE-249 follow-up: the pending tab follows takes, releases, submits and lapsed holds without a reload.
describe("refreshQueue", () => {
  const LOAD = new Date(Date.UTC(2026, 10, 23, 9, 30));
  beforeEach(() => {
    Object.values(m).forEach((f) => f.mockReset());
    vi.useFakeTimers();
    vi.setSystemTime(LOAD);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // A review of patient `p` written at `minute`, open unless `done`.
  const reviewOf = (id: string, p: string, minute: number, obs: Record<string, unknown>, done = false): CachedEncounter =>
    ({
      ID: id,
      "Subject ID": p,
      Voided: false,
      "Encounter type": "Clinician Review Form",
      "Encounter date time": done ? at(minute) : null,
      "Cancel date time": null,
      "Earliest scheduled date": at(0),
      observations: obs,
      audit: { "Created at": at(minute), "Last modified at": at(minute) },
    }) as unknown as CachedEncounter;
  const takenBy = (screeningId: string, by: string, minute: number) => ({
    [REVIEWED_ORAL_SCREENING_CONCEPT.name]: screeningId,
    [IN_REVIEW_BY_CONCEPT.name]: by,
    [IN_REVIEW_SINCE_CONCEPT.name]: at(minute),
  });
  const rowOf = (q: PendingQueue, key: string) => q.rows.find((r) => queueRowKey(r) === key) as QueueRow;

  // Two ready FLW-marked screenings in the physician's places, and nothing taken.
  async function loaded(extra: Parameters<typeof given>[0] = {}) {
    given({
      screenings: [screening("s1", "p1", 1), screening("s2", "p2", 2)],
      patients: new Map([
        ["p1", patient("p1", "v1")],
        ["p2", patient("p2", "v1")],
      ]),
      inPlaces: ["s1", "s2"],
      ...extra,
    });
    return loadPendingQueue("dr.a");
  }

  it("shows a case another physician took through a new review, and frees it once the hold lapses", async () => {
    const q = await loaded();
    expect(q.waiting.total).toBe(2);
    const reviews = [reviewOf("d1", "p1", 29, takenBy("s1", "dr.b", 29))];

    const taken = refreshQueue(q, reviews, "dr.a", LOAD);
    expect(rowHoldStatus(rowOf(taken, "s1"), "dr.a", taken.now)).toEqual({ kind: "other", by: "dr.b" });
    expect(taken.waiting).toMatchObject({ "FLW marked": 1, total: 1 });
    expect(taken.next).toBe("FLW marked");
    expect(taken.now).toBe(LOAD);

    // Ten minutes after the take, judged by the clock at the refresh.
    const lapsed = refreshQueue(q, reviews, "dr.a", new Date(Date.UTC(2026, 10, 23, 9, 39)));
    expect(rowHoldStatus(rowOf(lapsed, "s1"), "dr.a", lapsed.now)).toEqual({ kind: "waiting" });
    expect(lapsed.waiting.total).toBe(2);
  });

  it("drops a case whose screening now has a completed review, counts it in Reviewed today, and keeps the load's patients, places and unread count", async () => {
    const q = await loaded();
    const done = reviewOf("d1", "p1", 29, takenBy("s1", "dr.a", 20), true);
    const r = refreshQueue(q, [done], "dr.a", LOAD);
    expect(r.rows.map(queueRowKey)).toEqual(["s2"]);
    expect(r.reviewed["FLW marked"]).toBe(1);
    expect(r.waiting.total).toBe(1);
    expect(r.subjects).toBe(q.subjects);
    expect(r.catchment).toBe(q.catchment);
    expect(r.unread).toBe(q.unread);
  });

  it("gives the case the viewer holds as the one to continue, and no next group when nothing waits", async () => {
    const q = await loaded();
    expect(q.held).toBeUndefined();
    const r = refreshQueue(
      q,
      [reviewOf("d1", "p1", 29, takenBy("s1", "dr.a", 29)), reviewOf("d2", "p2", 29, takenBy("s2", "dr.b", 29))],
      "dr.a",
      LOAD,
    );
    expect(r.held && queueRowKey(r.held)).toBe("s1");
    expect(r.waiting.total).toBe(0);
    expect(r.next).toBeNull();
  });

  it("adds no case the last full load did not place, and keeps its booked reviews", async () => {
    // sDone was reviewed at the load, so it was never placed; its review is deleted before the refresh.
    const doneReview = reviewOf("dDone", "pDone", 5, takenBy("sDone", "dr.b", 5), true);
    const q = await loaded({
      booked: [review("rA")],
      screenings: [screening("s1", "p1", 1), screening("sOut", "pOut", 2), screening("sDone", "pDone", 3)],
      reviews: [doneReview],
      inPlaces: ["s1", "sDone"],
    });
    expect(q.rows.map(queueRowKey).sort()).toEqual(["rA", "s1"]);
    const r = refreshQueue(q, [{ ...doneReview, Voided: true }], "dr.a", LOAD);
    expect(r.rows.map(queueRowKey).sort()).toEqual(["rA", "s1"]);
  });

  // A full load reads only booked reviews still planned, so the refresh does not keep one that is over.
  it("drops a booked review that is now completed, cancelled or deleted, and keeps one the store does not have", async () => {
    const q = await loaded({ booked: [review("rDone"), review("rCancelled"), review("rDeleted"), review("rUnseen")] });
    expect(q.rows.map(queueRowKey).sort()).toEqual(["rCancelled", "rDeleted", "rDone", "rUnseen", "s1", "s2"]);
    const done = reviewOf("rDone", "pb-rDone", 29, {}, true);
    const cancelled = { ...reviewOf("rCancelled", "pb-rCancelled", 29, {}), "Cancel date time": at(29) };
    const deleted = { ...reviewOf("rDeleted", "pb-rDeleted", 29, {}), Voided: true };
    const r = refreshQueue(q, [done, cancelled, deleted], "dr.a", LOAD);
    expect(r.rows.map(queueRowKey).sort()).toEqual(["rUnseen", "s1", "s2"]);
  });
});

describe("refreshPendingQueue", () => {
  beforeEach(() => {
    Object.values(m).forEach((f) => f.mockReset());
  });

  it("reads only the review store's delta: no booked reviews by place, no place lookups, no patients", async () => {
    given({
      booked: [review("rA")],
      screenings: [screening("s1", "p1", 1)],
      patients: new Map([["p1", patient("p1", "v1")]]),
      inPlaces: ["s1"],
    });
    const q = await loadPendingQueue("dr.a");
    Object.values(m).forEach((f) => f.mockClear());

    const r = await refreshPendingQueue(q, "dr.a");
    expect(m.invalidate).toHaveBeenCalledTimes(1);
    expect(m.getCachedEncounters.mock.calls).toEqual([["Clinician Review Form"]]);
    expect(m.invalidate.mock.invocationCallOrder[0]).toBeLessThan(m.getCachedEncounters.mock.invocationCallOrder[0]);
    for (const read of [m.getCatchment, m.getAll, m.getProgram, m.find, m.readSubjects]) expect(read).not.toHaveBeenCalled();
    expect(r.rows.map(queueRowKey).sort()).toEqual(["rA", "s1"]);
  });

  // FW2: a hold lapses by the server's clock at the refresh, not by the time of the last load or the browser's clock.
  it("judges holds by the server's clock at the refresh", async () => {
    const LOAD = new Date(Date.UTC(2026, 10, 23, 9, 30));
    vi.useFakeTimers();
    vi.setSystemTime(LOAD);
    try {
      given({ screenings: [screening("s1", "p1", 1)], patients: new Map([["p1", patient("p1", "v1")]]), inPlaces: ["s1"] });
      const q = await loadPendingQueue("dr.a");
      // dr.b takes the case as the load ends.
      const taken = {
        ID: "d1",
        "Subject ID": "p1",
        Voided: false,
        "Encounter date time": null,
        "Cancel date time": null,
        "Earliest scheduled date": LOAD.toISOString(),
        observations: {
          [REVIEWED_ORAL_SCREENING_CONCEPT.name]: "s1",
          [IN_REVIEW_BY_CONCEPT.name]: "dr.b",
          [IN_REVIEW_SINCE_CONCEPT.name]: LOAD.toISOString(),
        },
        audit: { "Created at": LOAD.toISOString(), "Last modified at": LOAD.toISOString() },
      } as unknown as CachedEncounter;
      m.getCachedEncounters.mockResolvedValue([taken]);
      // The browser's clock still reads the load's time; the server's reads ten minutes later.
      noteServerDate(new Date(LOAD.getTime() + 10 * 60_000).toUTCString(), LOAD.getTime());
      const r = await refreshPendingQueue(q, "dr.a");
      expect(r.now.getTime()).toBe(LOAD.getTime() + 10 * 60_000 + 500);
      expect(rowHoldStatus(r.rows.find((row) => queueRowKey(row) === "s1") as QueueRow, "dr.a", r.now)).toEqual({
        kind: "waiting",
      });
      expect(r.waiting.total).toBe(1);
    } finally {
      resetServerClock();
      vi.useRealTimers();
    }
  });
});

describe("lightRefresh", () => {
  let queue: PendingQueue;
  beforeEach(async () => {
    Object.values(m).forEach((f) => f.mockReset());
    given({ screenings: [screening("s1", "p1", 1)], patients: new Map([["p1", patient("p1", "v1")]]), inPlaces: ["s1"] });
    queue = await loadPendingQueue("dr.a");
    Object.values(m).forEach((f) => f.mockClear());
  });
  const gate = (over: Partial<RefreshGate> = {}): RefreshGate => ({ latest: 1, reading: 0, paused: false, queue, ...over });

  it("lands the refreshed queue when nothing else is reading", async () => {
    const g = gate();
    const land = vi.fn();
    await lightRefresh(g, "dr.a", land);
    expect(land).toHaveBeenCalledTimes(1);
    expect((land.mock.calls[0][0] as PendingQueue).rows.map(queueRowKey)).toEqual(["s1"]);
    expect(g).toMatchObject({ latest: 2, reading: 0 });
  });

  it("does not run during a full load or a Review next case press, or before a queue has loaded", async () => {
    const land = vi.fn();
    for (const g of [gate({ reading: 1 }), gate({ paused: true }), gate({ queue: null })]) {
      await lightRefresh(g, "dr.a", land);
      expect(g.latest).toBe(1);
    }
    expect(m.getCachedEncounters).not.toHaveBeenCalled();
    expect(land).not.toHaveBeenCalled();
  });

  it("gives way to a full load or press that starts while it reads", async () => {
    let answer: (reviews: CachedEncounter[]) => void = () => {};
    m.getCachedEncounters.mockReturnValue(new Promise<CachedEncounter[]>((resolve) => (answer = resolve)));
    const g = gate();
    const land = vi.fn();
    const running = lightRefresh(g, "dr.a", land);
    expect(g.reading).toBe(1);
    // A second refresh while one is reading does nothing.
    await lightRefresh(g, "dr.a", land);
    expect(m.getCachedEncounters).toHaveBeenCalledTimes(1);
    // A full load starts: it takes the next ticket.
    g.latest += 1;
    answer([]);
    await running;
    expect(land).not.toHaveBeenCalled();
    expect(g.reading).toBe(0);
  });

  it("leaves the queue as it is when the read fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    m.getCachedEncounters.mockRejectedValue(new Error("offline"));
    const g = gate();
    const land = vi.fn();
    await expect(lightRefresh(g, "dr.a", land)).resolves.toBeUndefined();
    expect(land).not.toHaveBeenCalled();
    expect(g.reading).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("startQueueRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const page = (visibilityState: string) => Object.assign(new EventTarget(), { visibilityState });

  it("refreshes every 15 seconds while the page is visible, and not while it is hidden", () => {
    const doc = page("visible");
    const refresh = vi.fn();
    const stop = startQueueRefresh(refresh, doc, new EventTarget());
    vi.advanceTimersByTime(14_999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    doc.visibilityState = "hidden";
    vi.advanceTimersByTime(45_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it("refreshes at once when the page becomes visible again or the window regains focus", () => {
    const doc = page("hidden");
    const win = new EventTarget();
    const refresh = vi.fn();
    const stop = startQueueRefresh(refresh, doc, win);
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).not.toHaveBeenCalled();
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops when the tab is left", () => {
    const doc = page("visible");
    const win = new EventTarget();
    const refresh = vi.fn();
    startQueueRefresh(refresh, doc, win)();
    vi.advanceTimersByTime(60_000);
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("focus"));
    expect(refresh).not.toHaveBeenCalled();
  });
});
