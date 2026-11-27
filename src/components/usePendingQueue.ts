import { useCallback, useEffect, useRef, useState } from "react";
import { getCatchment, type Catchment } from "@/api/catchment";
import {
  getCachedEncounters,
  invalidateCachedEncounters,
  invalidateEncounterSweeps,
  isProgramEncounter,
  type CachedEncounter,
} from "@/api/encounters";
import {
  findInLocation,
  getAllEncountersWithLocation,
  type EncounterListParams,
  type EncounterWithLocation,
} from "@/api/impl";
import { getProgramEncountersWithLocation, readSubjects } from "@/api/programList";
import { takeCase, type TakeResult } from "@/api/caseHold";
import {
  chooseGroup,
  groupOrderFor,
  heldByViewer,
  reviewedToday,
  takeNextCase,
  waitingCounts,
  type GroupCounts,
} from "@/api/queueChoice";
import { isPlanned, selectQueueRows, type QueueRow } from "@/api/queueRows";
import type { SubjectApiResponse } from "@/api/types";
import { serverNow } from "@/auth/serverClock";
import { ENCOUNTER_TYPE, type QueueGroup } from "@/constants/tanuhConcepts";

export interface ReviewsByPlace {
  content: EncounterWithLocation[];
  totalElements: number;
  // Programme reviews left out because their patient could not be read, so they could not be placed (FW6).
  unread: number;
}

/** The chosen place when it is one of the physician's; a stale or foreign stored choice is none. */
export function chosenPlace(catchment: Catchment, chosen: string | null | undefined): string | null {
  return chosen && catchment.contains(chosen) ? chosen : null;
}

/** The places to read reviews in: the chosen place when it is one of the physician's, else each top place. */
export function placesToRead(catchment: Catchment, chosen: string | null | undefined): string[] {
  const place = chosenPlace(catchment, chosen);
  return place ? [place] : catchment.tops;
}

export interface PlacedScreenings {
  // The screenings in the physician's places.
  placed: Set<string>;
  // The screenings that could not be placed: one the lookups could not settle whose patient could not be read, or was
  // past the patient reads allowed in one load, and a programme screening whose patient could not be read. A list
  // leaves them out and counts them.
  unplaced: Set<string>;
  // The patients read to place screenings: those of programme screenings, and of screenings the lookups could not
  // settle, which may lie outside the physician's places and are never shown. Null where the read failed.
  subjects: ReadonlyMap<string, SubjectApiResponse | null>;
}

// At most this many patients are read in one load to place the screenings the lookups could not settle.
export const PLACEMENT_PATIENT_READS = 100;

// Each screening's answer, placed (true) or outside (false), per set of places. The places are read once and kept for
// the page's life, and cleared at sign-out, which reloads (getCatchment), so the answers last as long. A screening is
// keyed with its last change: a patient moved, or a date edited, changes it, and the screening is placed again.
const placements = new WeakMap<Catchment, Map<string, boolean>>();
const placementKey = (s: CachedEncounter) => `${s.ID}|${s.audit?.["Last modified at"] ?? ""}`;

/**
 * Which screenings lie in the physician's places (FW5, FW10), without reading the patients of the whole organisation.
 * A standalone screening is placed by the server's list of the completed Oral Screenings in each top place, read only
 * as far back as the screenings still to place (findInLocation, PE-304); the places share what they find. One the
 * lookups could not settle, because a read failed or stopped at its guard, is placed by its patient's Location ID, as
 * a programme screening is: up to PLACEMENT_PATIENT_READS of them, oldest first, so a patient outside the places is
 * read only then; one beyond that, or whose patient could not be read, is unplaced, and a list leaves it out and
 * counts it. Placed and outside answers are remembered; unplaced ones are asked again on the next load.
 */
export async function placeScreenings(screenings: CachedEncounter[], catchment: Catchment): Promise<PlacedScreenings> {
  const placed = new Set<string>();
  const unplaced = new Set<string>();
  if (screenings.length === 0 || catchment.tops.length === 0) return { placed, unplaced, subjects: new Map() };
  let known = placements.get(catchment);
  if (!known) {
    known = new Map();
    placements.set(catchment, known);
  }
  const remembered = known;
  const programme = screenings.filter(isProgramEncounter);
  const toFind: CachedEncounter[] = [];
  for (const s of screenings) {
    if (isProgramEncounter(s)) continue;
    const answer = remembered.get(placementKey(s));
    if (answer === true) placed.add(s.ID);
    else if (answer === undefined) toFind.push(s);
  }
  const targets = toFind.map((s) => ({ uuid: s.ID, date: s["Encounter date time"] }));
  const found = new Set<string>();
  const [lookups, programmeSubjects] = await Promise.all([
    targets.length > 0
      ? Promise.all(
          catchment.tops.map((top) => findInLocation(ENCOUNTER_TYPE.oralScreening.name, top, targets, found)),
        )
      : Promise.resolve([]),
    programme.length > 0
      ? readSubjects(programme.map((s) => s["Subject ID"]))
      : Promise.resolve(new Map<string, SubjectApiResponse | null>()),
  ]);
  const unsettled: CachedEncounter[] = [];
  for (const s of toFind) {
    if (found.has(s.ID)) {
      placed.add(s.ID);
      remembered.set(placementKey(s), true);
    } else if (lookups.every((l) => l.ruledOut.has(s.ID))) {
      remembered.set(placementKey(s), false);
    } else {
      unsettled.push(s);
    }
  }
  const byDate = (s: CachedEncounter) => Date.parse(s["Encounter date time"] ?? "") || 0;
  const toRead = [...unsettled].sort((a, b) => byDate(a) - byDate(b)).slice(0, PLACEMENT_PATIENT_READS);
  const patients =
    toRead.length > 0
      ? await readSubjects(toRead.map((s) => s["Subject ID"]))
      : new Map<string, SubjectApiResponse | null>();
  const reading = new Set(toRead);
  for (const s of unsettled) {
    const subject = reading.has(s) ? patients.get(s["Subject ID"]) : undefined;
    if (!subject) {
      unplaced.add(s.ID);
      continue;
    }
    const inside = catchment.contains(subject["Location ID"]);
    remembered.set(placementKey(s), inside);
    if (inside) placed.add(s.ID);
  }
  for (const s of programme) {
    const subject = programmeSubjects.get(s["Subject ID"]);
    if (!subject) unplaced.add(s.ID);
    else if (catchment.contains(subject["Location ID"])) placed.add(s.ID);
  }
  // A patient read for both kinds keeps the read that worked.
  const subjects = new Map(programmeSubjects);
  for (const [id, subject] of patients) if (subject || !subjects.has(id)) subjects.set(id, subject);
  return { placed, unplaced, subjects };
}

/**
 * Reviews read one place at a time, standalone and programme, merged by uuid (PE-249). The places are the physician's
 * top places, or the one place chosen, so nothing outside their places is read. No places, no reviews. A programme
 * review whose patient could not be read cannot be placed, so it is left out of the rows and the total, and counted
 * (FW6).
 */
export async function readReviewsByPlace(
  places: readonly string[],
  params: Omit<EncounterListParams, "page" | "size" | "locationUuid">,
): Promise<ReviewsByPlace> {
  const reads = await Promise.all(
    places.map(async (locationUuid) => {
      const [standalone, program] = await Promise.all([
        getAllEncountersWithLocation({ ...params, locationUuid }),
        getProgramEncountersWithLocation({ ...params, locationUuid }),
      ]);
      return { standalone, program };
    }),
  );
  const byUuid = new Map<string, EncounterWithLocation>();
  const programme = new Map<string, EncounterWithLocation>();
  const placed = new Set<string>();
  let standaloneTotal = 0;
  for (const { standalone, program } of reads) {
    standaloneTotal += standalone.totalElements;
    for (const e of standalone.content) byUuid.set(e.encounterUuid, e);
    for (const e of program.rows) {
      programme.set(e.encounterUuid, e);
      if (!program.unchecked.has(e.encounterUuid)) placed.add(e.encounterUuid);
    }
  }
  for (const [uuid, e] of programme) if (placed.has(uuid)) byUuid.set(uuid, e);
  return {
    content: [...byUuid.values()],
    // The places do not overlap, so the server's totals add up; past its page cap they exceed the rows read.
    totalElements: standaloneTotal + placed.size,
    unread: programme.size - placed.size,
  };
}

export interface PendingQueue {
  catchment: Catchment;
  // Every case in the physician's places, whatever the list's filters (D7).
  rows: QueueRow[];
  // What the last full load read, kept so a light refresh can rebuild the rows from fresh reviews alone: the booked
  // reviews in the physician's places, the live screenings, and the screenings it placed and listed.
  booked: EncounterWithLocation[];
  screenings: CachedEncounter[];
  placed: ReadonlySet<string>;
  // The patients of the screening rows that are listed.
  subjects: ReadonlyMap<string, SubjectApiResponse>;
  // Cases left out because they could not be placed, or their patient could not be read.
  unread: number;
  waiting: GroupCounts & { total: number };
  reviewed: GroupCounts;
  next: QueueGroup | null;
  held: QueueRow | undefined;
  now: Date;
}

/**
 * The queue's own read (PE-249, D7): booked reviews in each of the physician's top places, and every screening and
 * review in the encounter store. A screening row stays only when it lies in one of the physician's places (FW10: the
 * server's lookup, or the patient's own place where the lookup cannot tell, placeScreenings) and its patient, read for
 * the Village column, is not deleted.
 * A row that could not be placed, or whose patient could not be read, is left out and counted, as is a programme review
 * that could not be placed. Fails when the physician's places cannot be read.
 */
export async function loadPendingQueue(viewer: string): Promise<PendingQueue> {
  const catchment = await getCatchment();
  const [booked, storedScreenings, reviews] = await Promise.all([
    readReviewsByPlace(catchment.tops, { encounterType: ENCOUNTER_TYPE.physicianReviewForm.name, status: "scheduled" }),
    getCachedEncounters(ENCOUNTER_TYPE.oralScreening.name),
    getCachedEncounters(ENCOUNTER_TYPE.physicianReviewForm.name),
  ]);
  const screenings = storedScreenings.filter((s) => !s.Voided);
  // Holds are judged by the server's clock (FW2).
  const now = serverNow();
  const candidates = selectQueueRows(booked.content, screenings, reviews, viewer, now);
  const where = await placeScreenings(
    candidates.flatMap((r) => (r.kind === "screening" ? [r.screening] : [])),
    catchment,
  );
  // Only the patients of placed rows are read, each once; one read to place a screening is not read again, unless that
  // read failed.
  const toRead = candidates.flatMap((r) =>
    r.kind === "screening" && where.placed.has(r.screening.ID) && where.subjects.get(r.screening["Subject ID"]) == null
      ? [r.screening["Subject ID"]]
      : [],
  );
  const read = new Map(where.subjects);
  if (toRead.length > 0) for (const [id, subject] of await readSubjects(toRead)) read.set(id, subject);
  const subjects = new Map<string, SubjectApiResponse>();
  let unread = booked.unread + where.unplaced.size;
  const rows = candidates.filter((row) => {
    if (row.kind === "booked") return true;
    if (!where.placed.has(row.screening.ID)) return false;
    const subject = read.get(row.screening["Subject ID"]);
    if (!subject) {
      unread += 1;
      return false;
    }
    // The patient's own place is checked again: a patient moved since the lookup is not shown.
    if (subject.Voided || !catchment.contains(subject["Location ID"])) return false;
    subjects.set(row.screening["Subject ID"], subject);
    return true;
  });
  return {
    catchment,
    rows,
    booked: booked.content,
    screenings,
    placed: new Set(rows.flatMap((r) => (r.kind === "screening" ? [r.screening.ID] : []))),
    subjects,
    unread,
    ...counted(rows, reviews, screenings, viewer, now),
  };
}

/**
 * Review next case from the review page (PE-249, Complete and review next case): the queue read afresh, and the case
 * the list's button would take. The taken review's uuid; null when no case could be taken. Fails as `loadPendingQueue`
 * and `takeNextCase` do.
 */
export async function takeNextFromQueue(
  viewer: string,
  take: (row: QueueRow) => Promise<TakeResult> = (row) => takeCase(row, viewer),
): Promise<string | null> {
  invalidateEncounterSweeps();
  const fresh = await loadPendingQueue(viewer);
  return takeNextCase(fresh.rows, fresh.reviewed, viewer, fresh.now, take, fresh.held);
}

// What the tiles, Reviewed today, the Next case line and Continue case show for these rows.
function counted(rows: QueueRow[], reviews: CachedEncounter[], screenings: CachedEncounter[], viewer: string, now: Date) {
  const reviewed = reviewedToday(reviews, screenings, viewer, now);
  const waiting = waitingCounts(rows, viewer, now);
  const next = chooseGroup(reviewed, waiting, groupOrderFor(viewer, now));
  return { waiting, reviewed, next, held: heldByViewer(rows, viewer, now), now };
}

/**
 * The queue rebuilt from fresh reviews, without reading anything else again (PE-249 follow-up): who holds each case,
 * judged at `now`, so a lapsed hold is waiting again; cases whose screening now has a completed review drop out, as
 * does a booked review that is itself over, which a full load would no longer read; the tiles, Reviewed today, the
 * next group and the case the viewer holds follow. Only cases the last full load placed are kept, so a refresh never
 * lists a case nobody has placed; its patients, places and unread count stay as they were.
 */
export function refreshQueue(queue: PendingQueue, reviews: CachedEncounter[], viewer: string, now: Date): PendingQueue {
  const byId = new Map(reviews.map((r) => [r.ID, r]));
  const booked = queue.booked.filter((b) => {
    const stored = byId.get(b.encounterUuid);
    return !stored || isPlanned(stored);
  });
  const rows = selectQueueRows(booked, queue.screenings, reviews, viewer, now).filter(
    (row) => row.kind === "booked" || queue.placed.has(row.screening.ID),
  );
  return { ...queue, rows, ...counted(rows, reviews, queue.screenings, viewer, now) };
}

/** A light refresh's read: only what changed in the review store since its last read, judged by the server's clock. */
export async function refreshPendingQueue(queue: PendingQueue, viewer: string): Promise<PendingQueue> {
  // Drops only the in-memory copy; the stored reviews and their watermark stay, so this reads the changes alone.
  invalidateCachedEncounters();
  const reviews = await getCachedEncounters(ENCOUNTER_TYPE.physicianReviewForm.name);
  return refreshQueue(queue, reviews, viewer, serverNow());
}

// Shared by the full loads and the light refreshes of one pending tab.
export interface RefreshGate {
  // The latest read's ticket: only that read may land.
  latest: number;
  // Full loads and refreshes still reading.
  reading: number;
  // A Review next case press is running.
  paused: boolean;
  // The queue on screen; none while a full load runs, or after one failed.
  queue: PendingQueue | null;
}

/**
 * One light refresh, unless a full load, a press or another refresh is running, or no queue has loaded. It takes a
 * ticket like a full load, so a full load or press that starts while it reads wins. A failed refresh leaves the queue
 * on screen as it is.
 */
export async function lightRefresh(
  gate: RefreshGate,
  viewer: string,
  land: (queue: PendingQueue) => void,
): Promise<void> {
  const queue = gate.queue;
  if (!queue || gate.reading > 0 || gate.paused) return;
  const ticket = ++gate.latest;
  gate.reading += 1;
  try {
    const fresh = await refreshPendingQueue(queue, viewer);
    if (ticket === gate.latest) land(fresh);
  } catch (err) {
    console.warn("Could not refresh the pending reviews", err);
  } finally {
    gate.reading -= 1;
  }
}

export const QUEUE_REFRESH_MS = 15_000;

/**
 * Calls `refresh` every 15 seconds while the page is visible, and at once when it becomes visible again or the window
 * regains focus. Gives the function that stops it.
 */
export function startQueueRefresh(
  refresh: () => void,
  doc: EventTarget & { visibilityState: string },
  win: EventTarget,
  everyMs: number = QUEUE_REFRESH_MS,
): () => void {
  const ifVisible = () => {
    if (doc.visibilityState === "visible") refresh();
  };
  const timer = setInterval(ifVisible, everyMs);
  doc.addEventListener("visibilitychange", ifVisible);
  win.addEventListener("focus", ifVisible);
  return () => {
    clearInterval(timer);
    doc.removeEventListener("visibilitychange", ifVisible);
    win.removeEventListener("focus", ifVisible);
  };
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * The queue for the pending tab, loaded when `enabled`. `reload` drops the encounter caches and reads everything
 * again, as the button does on every press; its errors go to the caller and leave the loaded queue in place. While the
 * tab is open the queue is refreshed lightly from the review store (`lightRefresh`), except while `paused`, which the
 * list sets for the length of a Review next case press.
 */
export function usePendingQueue(enabled: boolean, viewer: string, paused = false) {
  const [state, setState] = useState<{ data: PendingQueue | null; error: string | null }>({ data: null, error: null });
  // Only the latest load or refresh may land; an older one finishing late is dropped.
  const gate = useRef<RefreshGate>({ latest: 0, reading: 0, paused: false, queue: null });

  useEffect(() => {
    gate.current.paused = paused;
  }, [paused]);

  const land = useCallback((data: PendingQueue) => {
    gate.current.queue = data;
    setState({ data, error: null });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const g = gate.current;
    const ticket = ++g.latest;
    g.queue = null;
    g.reading += 1;
    setState({ data: null, error: null });
    loadPendingQueue(viewer)
      .then(
        (data) => {
          if (ticket === g.latest) land(data);
        },
        (err: unknown) => {
          if (ticket === g.latest) setState({ data: null, error: messageOf(err) });
        },
      )
      .finally(() => {
        g.reading -= 1;
      });
    return () => {
      g.latest += 1;
    };
  }, [enabled, viewer, land]);

  useEffect(() => {
    if (!enabled) return;
    return startQueueRefresh(() => void lightRefresh(gate.current, viewer, land), document, window);
  }, [enabled, viewer, land]);

  const reload = useCallback(async (): Promise<PendingQueue> => {
    invalidateEncounterSweeps();
    const g = gate.current;
    const ticket = ++g.latest;
    g.reading += 1;
    try {
      const data = await loadPendingQueue(viewer);
      if (ticket === g.latest) land(data);
      return data;
    } finally {
      g.reading -= 1;
    }
  }, [viewer, land]);

  return { ...state, reload };
}
