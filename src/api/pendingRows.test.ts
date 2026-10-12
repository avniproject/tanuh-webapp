import { describe, expect, it } from "vitest";
import type { CachedEncounter } from "./encounters";
import type { EncounterWithLocation } from "./impl";
import type { SubjectApiResponse } from "./types";
import {
  buildPendingRows,
  filterByPatientLocation,
  filterPendingRows,
  patientsToRead,
  rowsOnPage,
  sortPendingRows,
  type PatientLocationMatch,
  type PendingRow,
} from "./pendingRows";
import { MODEL_STATUS_CONCEPT, REVIEW_CATEGORY_CONCEPT, REVIEWED_ORAL_SCREENING_CONCEPT } from "@/constants/tanuhConcepts";

const t = (minute: number) => new Date(Date.UTC(2026, 9, 7, 10, minute)).toISOString();
const screening = (id: string, patient: string, minute: number, group?: string): CachedEncounter =>
  ({
    ID: id, "Subject ID": patient, Voided: false, "Encounter type": "Oral Screening", "Encounter date time": t(minute),
    observations: group ? { [MODEL_STATUS_CONCEPT.name]: group === "Not scored" ? "Not scored" : "Scored", [REVIEW_CATEGORY_CONCEPT.name]: group } : {},
    audit: { "Created at": t(minute) },
  }) as unknown as CachedEncounter;
const bookedRow = (id: string, patient: string): EncounterWithLocation => ({
  encounterUuid: id, encounterTypeName: "Clinician Review Form", encounterDateTime: null, earliestScheduledDate: t(0),
  voided: false, subject: { uuid: patient, externalId: null, displayName: "", location: {} }, lastModifiedBy: null,
});
const bookedReview = (id: string, patient: string, minute: number): CachedEncounter =>
  ({ ID: id, "Subject ID": patient, Voided: false, "Encounter date time": null, "Earliest scheduled date": t(minute), observations: {}, audit: { "Created at": t(minute) } }) as unknown as CachedEncounter;
const completedReviewOf = (screeningId: string): CachedEncounter =>
  ({ ID: `done-${screeningId}`, "Subject ID": "x", Voided: false, "Encounter date time": t(50), observations: { [REVIEWED_ORAL_SCREENING_CONCEPT.name]: screeningId } }) as unknown as CachedEncounter;
const subject = (id: string, voided = false) => ({ ID: id, Voided: voided, observations: {}, "External ID": null, "Subject type": "Individual" }) as SubjectApiResponse;
const subjectsFor = (...ids: string[]) => new Map<string, SubjectApiResponse | null>(ids.map((id) => [id, subject(id)]));
const ids = (rows: PendingRow[]) => rows.map((r) => (r.kind === "booked" ? r.review.encounterUuid : r.screening.ID));

describe("buildPendingRows", () => {
  it("lists the model's screenings sent for review and leaves closed, unscored and booked ones out", () => {
    const screenings = [screening("high", "p1", 1, "High Risk"), screening("closed", "p2", 2, "Closed"), screening("unscored", "p3", 3)];
    const rows = buildPendingRows([], screenings, [], subjectsFor("p1", "p2", "p3"));
    expect(ids(rows)).toEqual(["high"]);
  });
  it("keeps a booked review with its screening's group, and does not list that screening twice", () => {
    const screenings = [screening("s1", "p1", 1, "FLW override")];
    const rows = buildPendingRows([bookedRow("r1", "p1")], screenings, [bookedReview("r1", "p1", 1)], subjectsFor("p1"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "booked", group: "FLW override" });
  });
  it("keeps a booked review of a Closed screening", () => {
    const rows = buildPendingRows([bookedRow("r1", "p1")], [screening("s1", "p1", 1, "Closed")], [bookedReview("r1", "p1", 1)], subjectsFor("p1"));
    expect(ids(rows)).toEqual(["r1"]);
  });
  it("never lists a reviewed screening again, even after it is scored again", () => {
    const rescored = screening("s1", "p1", 1, "High Risk");
    expect(buildPendingRows([], [rescored], [completedReviewOf("s1")], subjectsFor("p1"))).toEqual([]);
  });
  it("drops a deleted patient's rows and keeps a row whose patient could not be read, or is not read yet", () => {
    const subjects = new Map<string, SubjectApiResponse | null>([["p1", subject("p1", true)], ["p2", null]]);
    const screenings = [screening("gone", "p1", 1, "High Risk"), screening("failed", "p2", 2, "Low Risk"), screening("later", "p3", 3, "Low Risk")];
    expect(ids(buildPendingRows([], screenings, [], subjects))).toEqual(["failed", "later"]);
  });
});

describe("sortPendingRows", () => {
  it("orders by group, oldest first within a group, with a booked review of a Closed screening among Low Risk", () => {
    const screenings = [
      screening("safety", "p1", 1, "Safety sample"), screening("low-new", "p2", 9, "Low Risk"), screening("notscored", "p3", 3, "Not scored"),
      screening("flw", "p4", 4, "FLW override"), screening("high-new", "p5", 8, "High Risk"), screening("high-old", "p6", 2, "High Risk"),
      screening("closed", "p7", 5, "Closed"),
    ];
    const rows = buildPendingRows([bookedRow("r-closed", "p7")], screenings, [bookedReview("r-closed", "p7", 5)], subjectsFor("p1", "p2", "p3", "p4", "p5", "p6", "p7"));
    expect(ids(sortPendingRows(rows, "group"))).toEqual(["high-old", "high-new", "flw", "notscored", "r-closed", "low-new", "safety"]);
  });
});

describe("filterPendingRows", () => {
  it("keeps only the chosen group", () => {
    const rows = buildPendingRows([], [screening("a", "p1", 1, "Safety sample"), screening("b", "p2", 2, "High Risk")], [], subjectsFor("p1", "p2"));
    expect(ids(filterPendingRows(rows, "safety-sample"))).toEqual(["a"]);
    expect(ids(filterPendingRows(rows, "all"))).toEqual(["a", "b"]);
  });
});

// Review finding (#4): the location filter read every pending patient, and a failed read dropped its row silently.
describe("filterByPatientLocation", () => {
  const chain = { State: "Karnataka", District: "Bengaluru Rural" };
  const inChain = (id: string) => ({ ...subject(id), location: { ...chain, Village: "Begur" } }) as SubjectApiResponse;
  const elsewhere = (id: string) => ({ ...subject(id), location: { State: "Karnataka", District: "Mysuru" } }) as SubjectApiResponse;
  const inProgram = (s: CachedEncounter) => ({ ...s, "Enrolment ID": "e1" }) as CachedEncounter;
  const match = (over: Partial<PatientLocationMatch>): PatientLocationMatch =>
    ({ inLocation: new Set(), complete: true, chain, subjects: new Map(), ...over });

  it("keeps booked reviews and the screenings the server placed in the location, and drops the rest", () => {
    const rows = buildPendingRows([bookedRow("r1", "p9")], [screening("here", "p1", 1, "High Risk"), screening("away", "p2", 2, "High Risk")], [bookedReview("r1", "p9", 0)], new Map());
    const result = filterByPatientLocation(rows, match({ inLocation: new Set(["here"]) }));
    expect(ids(result.rows).sort()).toEqual(["here", "r1"]);
    expect(result.unchecked.size).toBe(0);
  });
  it("keeps and counts the screenings it cannot rule out when the server's read stopped short", () => {
    const rows = buildPendingRows([], [screening("here", "p1", 1, "High Risk"), screening("unknown", "p2", 2, "High Risk")], [], new Map());
    const result = filterByPatientLocation(rows, match({ inLocation: new Set(["here"]), complete: false }));
    expect(ids(result.rows)).toEqual(["here", "unknown"]);
    expect([...result.unchecked]).toEqual(["unknown"]);
  });
  it("matches a screening inside a program by its patient's address, and keeps and counts one whose patient could not be read", () => {
    const rows = buildPendingRows([], [inProgram(screening("here", "p1", 1, "High Risk")), inProgram(screening("away", "p2", 2, "High Risk")), inProgram(screening("failed", "p3", 3, "High Risk"))], [], new Map());
    const subjects = new Map<string, SubjectApiResponse | null>([["p1", inChain("p1")], ["p2", elsewhere("p2")], ["p3", null]]);
    const result = filterByPatientLocation(rows, match({ subjects }));
    expect(ids(result.rows)).toEqual(["here", "failed"]);
    expect([...result.unchecked]).toEqual(["failed"]);
  });
});

// Review finding (#4): the pending tab read every pending patient to show 50.
describe("reading the patients on screen", () => {
  const view = (subjectId: string) => ({ subjectId });
  const views = ["a", "a", "b", "c", "d"].map(view);
  it("reads only the patients of the page shown, each once", () => {
    expect(patientsToRead(rowsOnPage(views, 0, 2), new Map())).toEqual(["a"]);
    expect(patientsToRead(rowsOnPage(views, 1, 2), new Map())).toEqual(["b", "c"]);
    expect(patientsToRead(rowsOnPage(views, 2, 2), new Map())).toEqual(["d"]);
  });
  it("leaves out patients already read, a failed read included, until the list reloads", () => {
    const known = new Map<string, SubjectApiResponse | null>([["b", subject("b")], ["c", null]]);
    expect(patientsToRead(rowsOnPage(views, 1, 2), known)).toEqual([]);
  });
});
