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
}));
vi.mock("@/api/programList", () => ({
  getProgramEncountersWithLocation: (p: unknown) => m.getProgram(p),
  readSubjects: (ids: string[]) => m.readSubjects(ids),
}));

import { loadPendingQueue, placesToRead, readReviewsByPlace } from "./usePendingQueue";

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

// The physician covers district d1 (top) and its village v1.
function given({
  tops = ["d1"],
  booked = [] as EncounterWithLocation[],
  programRows = program([]),
  screenings = [] as CachedEncounter[],
  patients = new Map<string, SubjectApiResponse | null>(),
} = {}) {
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

  it("keeps a screening whose patient lives in the physician's places, and drops one outside them", async () => {
    given({
      screenings: [screening("sIn", "pIn", 1), screening("sOut", "pOut", 2)],
      patients: new Map([
        ["pIn", patient("pIn", "v1")],
        ["pOut", patient("pOut", "elsewhere")],
      ]),
    });
    const q = await loadPendingQueue("dr.a");
    expect(q.rows.map(queueRowKey)).toEqual(["sIn"]);
    expect(q.unread).toBe(0);
    expect(q.waiting).toMatchObject({ "FLW marked": 1, total: 1 });
    expect([...q.subjects.keys()]).toEqual(["pIn"]);
  });

  it("drops a screening whose patient could not be read, and counts it", async () => {
    given({
      screenings: [screening("sIn", "pIn", 1), screening("sUnread", "pUnread", 2)],
      patients: new Map([["pIn", patient("pIn", "v1")]]),
    });
    const q = await loadPendingQueue("dr.a");
    expect(q.rows.map(queueRowKey)).toEqual(["sIn"]);
    expect(q.unread).toBe(1);
  });

  it("drops a screening whose patient is deleted, without counting it", async () => {
    given({
      screenings: [screening("sGone", "pGone", 1)],
      patients: new Map([["pGone", patient("pGone", "v1", true)]]),
    });
    const q = await loadPendingQueue("dr.a");
    expect(q.rows).toEqual([]);
    expect(q.unread).toBe(0);
  });

  it("reads nothing and lists nothing when the physician has no places", async () => {
    given({ tops: [], screenings: [screening("s1", "p1", 1)], patients: new Map([["p1", patient("p1", "v1")]]) });
    const q = await loadPendingQueue("dr.a");
    expect(q.rows).toEqual([]);
    expect(q.unread).toBe(0);
    expect(m.getAll).not.toHaveBeenCalled();
    expect(m.getProgram).not.toHaveBeenCalled();
    expect(m.readSubjects).not.toHaveBeenCalled();
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

  it("reads each place and merges the reviews by uuid", async () => {
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
    expect(read.content.map((e) => e.encounterUuid).sort()).toEqual(["a", "b", "c", "p1", "p2"]);
    expect([...read.unchecked]).toEqual(["p2"]);
    expect(m.getAll.mock.calls.map(([p]) => (p as { locationUuid: string }).locationUuid)).toEqual(["d1", "d2"]);
    expect(m.getProgram.mock.calls.map(([p]) => (p as { locationUuid: string }).locationUuid)).toEqual(["d1", "d2"]);
  });

  it("reads nothing for no places", async () => {
    const read = await readReviewsByPlace([], { encounterType: "Clinician Review Form", status: "scheduled" });
    expect(read.content).toEqual([]);
    expect(m.getAll).not.toHaveBeenCalled();
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
