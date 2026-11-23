import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Catchment } from "@/api/catchment";
import type { CachedEncounter } from "@/api/encounters";
import type { EncounterWithLocation } from "@/api/impl";
import { queueRowKey } from "@/api/queueRows";
import type { SubjectApiResponse } from "@/api/types";
import { OCSHR_RESULT_CONCEPT } from "@/constants/tanuhConcepts";

const m = vi.hoisted(() => ({
  getCatchment: vi.fn(),
  getCachedEncounters: vi.fn(),
  getAll: vi.fn(),
  getProgram: vi.fn(),
  readSubjects: vi.fn(),
  lookup: vi.fn(),
}));
vi.mock("@/api/catchment", () => ({ getCatchment: () => m.getCatchment() }));
vi.mock("@/api/encounters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/encounters")>()),
  getCachedEncounters: (type: string) => m.getCachedEncounters(type),
  invalidateEncounterSweeps: vi.fn(),
}));
vi.mock("@/api/impl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/impl")>()),
  getAllEncountersWithLocation: (p: unknown) => m.getAll(p),
  getEncounterUuidsInLocation: (type: string, status: string, place: string) => m.lookup(type, status, place),
}));
vi.mock("@/api/programList", () => ({
  getProgramEncountersWithLocation: (p: unknown) => m.getProgram(p),
  readSubjects: (ids: string[]) => m.readSubjects(ids),
}));

import { chosenPlace, loadPendingQueue, placeScreenings, placesToRead, readReviewsByPlace } from "./usePendingQueue";

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

// The physician covers district d1 (top) and its village v1. `inPlaces` is what the server's lookup places in d1.
function given({
  tops = ["d1"],
  booked = [] as EncounterWithLocation[],
  programRows = program([]),
  screenings = [] as CachedEncounter[],
  patients = new Map<string, SubjectApiResponse | null>(),
  inPlaces = [] as string[],
  complete = true,
} = {}) {
  m.lookup.mockResolvedValue({ uuids: new Set(inPlaces), complete });
  m.getCatchment.mockResolvedValue(catchment(tops.length ? ["d1", "v1"] : [], tops));
  m.getAll.mockResolvedValue(standalone(booked));
  m.getProgram.mockResolvedValue(programRows);
  m.getCachedEncounters.mockImplementation((type: string) =>
    Promise.resolve(type === "Oral Screening" ? screenings : []),
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
    expect(m.lookup).toHaveBeenCalledWith("Oral Screening", "completed", "d1");
    // The patient outside the places is never read.
    expect(m.readSubjects.mock.calls.flatMap(([ids]) => ids)).toEqual(["pIn"]);
  });

  it("drops the screenings an incomplete lookup could not place, and counts them", async () => {
    given({
      screenings: [screening("sIn", "pIn", 1), screening("sUnknown", "pUnknown", 2)],
      patients: new Map([["pIn", patient("pIn", "v1")]]),
      inPlaces: ["sIn"],
      complete: false,
    });
    const q = await loadPendingQueue("dr.a");
    expect(q.rows.map(queueRowKey)).toEqual(["sIn"]);
    expect(q.unread).toBe(1);
    expect(m.readSubjects.mock.calls.flatMap(([ids]) => ids)).toEqual(["pIn"]);
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
    expect(m.lookup).not.toHaveBeenCalled();
  });

  it("reads nothing and lists nothing when the physician has no places", async () => {
    given({ tops: [], screenings: [screening("s1", "p1", 1)], patients: new Map([["p1", patient("p1", "v1")]]) });
    const q = await loadPendingQueue("dr.a");
    expect(q.rows).toEqual([]);
    expect(q.unread).toBe(0);
    expect(m.getAll).not.toHaveBeenCalled();
    expect(m.getProgram).not.toHaveBeenCalled();
    expect(m.readSubjects).not.toHaveBeenCalled();
    expect(m.lookup).not.toHaveBeenCalled();
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
  const c2 = catchment(["d1", "v1", "d2"], ["d1", "d2"]);

  it("places standalone screenings by the lookup in every top place, together", async () => {
    m.lookup.mockImplementation((_t: string, _s: string, place: string) =>
      Promise.resolve({ uuids: new Set(place === "d1" ? ["s1"] : ["s2"]), complete: true }),
    );
    const placed = await placeScreenings([screening("s1", "p1", 1), screening("s2", "p2", 2), screening("s3", "p3", 3)], c2);
    expect([...placed.placed].sort()).toEqual(["s1", "s2"]);
    expect(placed.unplaced.size).toBe(0);
    expect(m.lookup.mock.calls.map(([, , place]) => place)).toEqual(["d1", "d2"]);
    expect(m.readSubjects).not.toHaveBeenCalled();
  });

  it("leaves unplaced what an incomplete lookup could not place", async () => {
    m.lookup.mockImplementation((_t: string, _s: string, place: string) =>
      Promise.resolve({ uuids: new Set(place === "d1" ? ["s1"] : []), complete: place === "d1" }),
    );
    const placed = await placeScreenings([screening("s1", "p1", 1), screening("s2", "p2", 2)], c2);
    expect([...placed.placed]).toEqual(["s1"]);
    expect([...placed.unplaced]).toEqual(["s2"]);
  });

  it("asks nothing when there is no screening, or no place", async () => {
    expect((await placeScreenings([], c2)).placed.size).toBe(0);
    const none = await placeScreenings([screening("s1", "p1", 1)], catchment([], []));
    expect(none.placed.size + none.unplaced.size).toBe(0);
    expect(m.lookup).not.toHaveBeenCalled();
    expect(m.readSubjects).not.toHaveBeenCalled();
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
