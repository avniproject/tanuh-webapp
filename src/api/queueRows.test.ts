import { describe, expect, it } from "vitest";
import type { CachedEncounter } from "./encounters";
import type { EncounterWithLocation } from "./impl";
import {
  filterQueueRows,
  narrowQueueRows,
  queueRowDate,
  queueRowKey,
  queueRowSubjectId,
  rowHoldStatus,
  rowReason,
  selectQueueRows,
  sortQueueRows,
  type QueueRow,
} from "./queueRows";
import { IN_REVIEW_BY_CONCEPT, IN_REVIEW_SINCE_CONCEPT, OCSHR_RESULT_CONCEPT, PLACE_OF_REFERRAL_CONCEPT, RANDOM_SAMPLE_ID_CONCEPT, REVIEWED_ORAL_SCREENING_CONCEPT } from "@/constants/tanuhConcepts";

const t = (minute: number) => new Date(Date.UTC(2026, 9, 7, 10, minute)).toISOString();
const NOW = new Date(Date.UTC(2026, 9, 7, 10, 30));

type Sig = { flw?: boolean; edge?: "Suspicious" | "Non-Suspicious" | null; ocshr?: string; sample?: number; opinion?: "Suspicious" | "Not suspicious" };
const screening = (id: string, patient: string, minute: number, sig: Sig = {}): CachedEncounter =>
  ({
    ID: id, "Subject ID": patient, Voided: false, "Encounter type": "Oral Screening", "Encounter date time": t(minute),
    flwPositive: sig.flw ?? false, edgeVerdict: sig.edge === undefined ? null : sig.edge, workerOpinion: sig.opinion,
    observations: {
      ...(sig.ocshr ? { [OCSHR_RESULT_CONCEPT.name]: sig.ocshr } : {}),
      ...(sig.sample !== undefined ? { [RANDOM_SAMPLE_ID_CONCEPT.name]: sig.sample } : {}),
    },
    audit: { "Created at": t(minute) },
  }) as unknown as CachedEncounter;
const ready = (id: string, patient: string, minute: number, extra: Sig = {}) => screening(id, patient, minute, { edge: "Suspicious", ocshr: "Not High Risk", ...extra });

const bookedRow = (id: string, patient: string, minute = 0): EncounterWithLocation => ({
  encounterUuid: id, encounterTypeName: "Clinician Review Form", encounterDateTime: null, earliestScheduledDate: t(minute),
  voided: false, subject: { uuid: patient, externalId: null, displayName: "", location: {} }, lastModifiedBy: null,
});
const planned = (id: string, patient: string, minute: number, obs: Record<string, unknown> = {}): CachedEncounter =>
  ({ ID: id, "Subject ID": patient, Voided: false, "Encounter date time": null, "Earliest scheduled date": t(minute), observations: obs, audit: { "Created at": t(minute), "Last modified at": t(minute) } }) as unknown as CachedEncounter;
const completedReview = (id: string, patient: string, minute: number, stamp?: string): CachedEncounter =>
  ({ ID: id, "Subject ID": patient, Voided: false, "Encounter date time": t(minute), observations: stamp ? { [REVIEWED_ORAL_SCREENING_CONCEPT.name]: stamp } : {}, audit: { "Created at": t(minute) } }) as unknown as CachedEncounter;

const keys = (rows: QueueRow[]) => rows.map(queueRowKey);

describe("selectQueueRows", () => {
  it("lists a ready screening with no review", () => {
    const rows = selectQueueRows([], [ready("s1", "p1", 1)], []);
    expect(keys(rows)).toEqual(["s1"]);
    expect(rows[0].kind).toBe("screening");
  });
  it("lists an AI-marked screening when the patient has one unstamped completed review, which covers the older screening", () => {
    const rows = selectQueueRows([], [ready("old", "p1", 1), ready("ai", "p1", 5)], [completedReview("r1", "p1", 20)]);
    expect(keys(rows)).toEqual(["ai"]);
  });
  it("leaves out an excluded screening and an OCSHR-pending one", () => {
    const excluded = screening("ex", "p1", 1, { edge: "Non-Suspicious", ocshr: "Not High Risk" });
    const pending = screening("pend", "p2", 2, { flw: true });
    expect(selectQueueRows([], [excluded, pending], [])).toEqual([]);
  });
  it("keeps a booked FLW review whose OCSHR is pending, with the reason OCSHR pending", () => {
    const rows = selectQueueRows([bookedRow("r1", "p1")], [screening("s1", "p1", 1, { flw: true })], [planned("r1", "p1", 1)]);
    expect(keys(rows)).toEqual(["r1"]);
    expect(rowReason(rows[0])).toBe("OCSHR pending");
  });
  it("drops a booked review whose screening already has a completed review", () => {
    const rows = selectQueueRows([bookedRow("r1", "p1")], [ready("s1", "p1", 1)], [planned("r1", "p1", 1), completedReview("done", "p1", 40, "s1")]);
    expect(rows).toEqual([]);
  });
  it("gives one row for two booked reviews on one screening, the live-held one winning", () => {
    const held = planned("r2", "p1", 2, { [IN_REVIEW_BY_CONCEPT.name]: "dr-a", [IN_REVIEW_SINCE_CONCEPT.name]: t(28) });
    held.audit = { "Created at": t(2), "Last modified at": t(28) };
    const rows = selectQueueRows(
      [bookedRow("r1", "p1"), bookedRow("r2", "p1")],
      [ready("s1", "p1", 1)],
      [planned("r1", "p1", 1), held],
      "dr-b",
      NOW,
    );
    expect(keys(rows)).toEqual(["r2"]);
  });
  it("keeps the earliest created of two unheld booked reviews on one screening", () => {
    const rows = selectQueueRows(
      [bookedRow("r2", "p1"), bookedRow("r1", "p1")],
      [ready("s1", "p1", 1)],
      [planned("r2", "p1", 2), planned("r1", "p1", 1)],
      "dr-b",
      NOW,
    );
    expect(keys(rows)).toEqual(["r1"]);
  });
  it("keeps a booked review with no paired screening, with no reason", () => {
    const rows = selectQueueRows([bookedRow("r1", "p1")], [], [planned("r1", "p1", 1)]);
    expect(keys(rows)).toEqual(["r1"]);
    expect(rows[0]).toMatchObject({ kind: "booked", cls: undefined });
    expect(rowReason(rows[0])).toBeUndefined();
  });
  it("does not list a reviewed screening, and does not list a screening a booked row already shows", () => {
    expect(selectQueueRows([], [ready("s1", "p1", 1)], [completedReview("d", "p1", 9, "s1")])).toEqual([]);
    const rows = selectQueueRows([bookedRow("r1", "p1")], [ready("s1", "p1", 1)], [planned("r1", "p1", 1)]);
    expect(keys(rows)).toEqual(["r1"]);
  });
  it("leaves out a voided screening", () => {
    const s = ready("s1", "p1", 1);
    s.Voided = true;
    expect(selectQueueRows([], [s], [])).toEqual([]);
  });
});

describe("row helpers", () => {
  const screeningRow = selectQueueRows([], [ready("s1", "p1", 3)], [])[0];
  const bookedNoScreening = selectQueueRows([bookedRow("r1", "p9", 7)], [], [planned("r1", "p9", 7)])[0];
  it("reads key, subject and date by kind", () => {
    expect([queueRowKey(screeningRow), queueRowSubjectId(screeningRow), queueRowDate(screeningRow)]).toEqual(["s1", "p1", t(3)]);
    expect([queueRowKey(bookedNoScreening), queueRowSubjectId(bookedNoScreening), queueRowDate(bookedNoScreening)]).toEqual(["r1", "p9", t(7)]);
  });
  it("takes the booked row's date from its screening when it has one", () => {
    const row = selectQueueRows([bookedRow("r1", "p1", 0)], [ready("s1", "p1", 1)], [planned("r1", "p1", 1)])[0];
    expect(queueRowDate(row)).toBe(t(1));
  });
  it("gives a date of empty text when nothing has one", () => {
    const b = bookedRow("r1", "p1");
    b.earliestScheduledDate = null;
    expect(queueRowDate({ kind: "booked", review: b })).toBe("");
  });
  it("says waiting for a screening row and the review's hold for a booked row", () => {
    expect(rowHoldStatus(screeningRow, "dr", NOW)).toEqual({ kind: "waiting" });
    const held = planned("r1", "p9", 7, { [IN_REVIEW_BY_CONCEPT.name]: "dr-a", [IN_REVIEW_SINCE_CONCEPT.name]: t(28) });
    held.audit = { "Created at": t(7), "Last modified at": t(28) };
    const row = selectQueueRows([bookedRow("r1", "p9", 7)], [], [held])[0];
    expect(rowHoldStatus(row, "dr-b", NOW)).toEqual({ kind: "other", by: "dr-a" });
  });
  it("gives a booked case in no group the reason undefined", () => {
    const s = screening("s1", "p1", 1, { edge: "Non-Suspicious", ocshr: "Not High Risk" });
    const row = selectQueueRows([bookedRow("r1", "p1")], [s], [planned("r1", "p1", 1)])[0];
    expect(rowReason(row)).toBeUndefined();
  });
});

describe("sort and filter", () => {
  const flw = ready("flw", "a", 3, { flw: true, opinion: "Not suspicious" });
  const ai = ready("ai", "b", 1, { opinion: "Suspicious" });
  const safety = screening("safety", "c", 2, { edge: "Non-Suspicious", ocshr: "Not High Risk", sample: 0.01 });
  const flwOld = ready("flwOld", "d", 0, { flw: true });
  const pendingBooked = selectQueueRows([bookedRow("pb", "e")], [screening("pbs", "e", 9, { flw: true })], [planned("pb", "e", 9)])[0];
  const all = selectQueueRows([], [flw, ai, safety, flwOld], []);
  const withPending = [pendingBooked, ...all];
  it("sorts by group FLW, AI, Safety, then the rest, oldest first within", () => {
    expect(keys(sortQueueRows(withPending, "group"))).toEqual(["flwOld", "flw", "ai", "safety", "pb"]);
  });
  it("sorts by date, newest first", () => {
    expect(keys(sortQueueRows(all, "date"))).toEqual(["flw", "safety", "ai", "flwOld"]);
  });
  it("sorts by the worker's opinion, then group order", () => {
    expect(keys(sortQueueRows(all, "opinion"))).toEqual(["ai", "flw", "flwOld", "safety"]);
  });
  it("returns a new array", () => {
    const copy = [...all];
    expect(sortQueueRows(all, "group")).not.toBe(all);
    expect(all).toEqual(copy);
  });
  it("filters by group label", () => {
    expect(filterQueueRows(withPending, "all")).toHaveLength(5);
    expect(keys(filterQueueRows(withPending, "flw")).sort()).toEqual(["flw", "flwOld"]);
    expect(keys(filterQueueRows(withPending, "ai"))).toEqual(["ai"]);
    expect(keys(filterQueueRows(withPending, "safety"))).toEqual(["safety"]);
  });
});

// PE-249: the list's location and referral filters over the queue's rows (the counts and the button ignore them).
describe("narrowQueueRows", () => {
  const referredTo = (s: CachedEncounter, place: Record<string, string>) => {
    s.observations = { ...s.observations, [PLACE_OF_REFERRAL_CONCEPT.name]: place };
    return s;
  };
  // Two booked reviews (no screening paired) and three screenings, each on its own patient.
  const rows = selectQueueRows(
    [bookedRow("rIn", "pb1"), bookedRow("rOut", "pb2")],
    [
      referredTo(ready("sVillage", "p1", 1), { District: "D1", "Taluka Hospital": "H1" }),
      referredTo(ready("sOther", "p2", 2), { District: "D1", "Taluka Hospital": "H2" }),
      ready("sNoPatient", "p3", 3),
    ],
    [],
  );
  const subjects = new Map([
    ["p1", { "Location ID": "village-1" }],
    ["p2", { "Location ID": "village-9" }],
  ]);
  const none = { bookedListed: null, placesUnder: null, referralChain: null, subjects };

  it("keeps every row when nothing is chosen", () => {
    expect(keys(narrowQueueRows(rows, none))).toEqual(["rIn", "rOut", "sVillage", "sOther", "sNoPatient"]);
  });

  it("keeps a screening row only when its patient lives in the chosen place or below it", () => {
    const narrowed = narrowQueueRows(rows, { ...none, placesUnder: new Set(["taluka-1", "village-1"]) });
    expect(keys(narrowed).filter((k) => k.startsWith("s"))).toEqual(["sVillage"]);
  });

  it("keeps a booked row only when the list's own filtered read returned it", () => {
    const narrowed = narrowQueueRows(rows, { ...none, bookedListed: new Set(["rIn"]) });
    expect(keys(narrowed)).toEqual(["rIn", "sVillage", "sOther", "sNoPatient"]);
  });

  it("keeps a screening row only when its place of referral lies in the chosen facility, and leaves booked rows to the read", () => {
    const narrowed = narrowQueueRows(rows, {
      ...none,
      bookedListed: new Set(["rIn", "rOut"]),
      referralChain: { District: "D1", "Taluka Hospital": "H1" },
    });
    expect(keys(narrowed)).toEqual(["rIn", "rOut", "sVillage"]);
  });
});
