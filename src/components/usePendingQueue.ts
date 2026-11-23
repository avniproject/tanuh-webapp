import { useCallback, useEffect, useRef, useState } from "react";
import { getCatchment, type Catchment } from "@/api/catchment";
import { getCachedEncounters, invalidateEncounterSweeps, isProgramEncounter, type CachedEncounter } from "@/api/encounters";
import {
  getAllEncountersWithLocation,
  getEncounterUuidsInLocation,
  type EncounterListParams,
  type EncounterWithLocation,
} from "@/api/impl";
import { getProgramEncountersWithLocation, readSubjects } from "@/api/programList";
import { chooseGroup, heldByViewer, reviewedToday, waitingCounts, type GroupCounts } from "@/api/queueChoice";
import { selectQueueRows, type QueueRow } from "@/api/queueRows";
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
  // The screenings that could not be placed: a lookup cut short, or a programme screening whose patient could not be
  // read. A list leaves them out and counts them.
  unplaced: Set<string>;
  // The programme screenings' patients, read to place them; null where the read failed.
  subjects: ReadonlyMap<string, SubjectApiResponse | null>;
}

/**
 * Which screenings lie in the physician's places (FW5, FW10), without reading the patients of the whole organisation.
 * A standalone screening is placed by the server's lookup of the completed Oral Screenings in each top place; when a
 * lookup is cut short, a screening none of them placed cannot be ruled in or out and is unplaced. A programme
 * screening, which the lookup cannot see, is placed by its patient's Location ID. Anything else is outside the places.
 */
export async function placeScreenings(screenings: CachedEncounter[], catchment: Catchment): Promise<PlacedScreenings> {
  const placed = new Set<string>();
  const unplaced = new Set<string>();
  if (screenings.length === 0 || catchment.tops.length === 0) return { placed, unplaced, subjects: new Map() };
  const standalone = screenings.filter((s) => !isProgramEncounter(s));
  const programme = screenings.filter(isProgramEncounter);
  const [lookups, subjects] = await Promise.all([
    standalone.length > 0
      ? Promise.all(
          catchment.tops.map((top) => getEncounterUuidsInLocation(ENCOUNTER_TYPE.oralScreening.name, "completed", top)),
        )
      : Promise.resolve([]),
    programme.length > 0
      ? readSubjects(programme.map((s) => s["Subject ID"]))
      : Promise.resolve(new Map<string, SubjectApiResponse | null>()),
  ]);
  const inPlaces = new Set(lookups.flatMap((l) => [...l.uuids]));
  const complete = lookups.every((l) => l.complete);
  for (const s of standalone) {
    if (inPlaces.has(s.ID)) placed.add(s.ID);
    else if (!complete) unplaced.add(s.ID);
  }
  for (const s of programme) {
    const subject = subjects.get(s["Subject ID"]);
    if (!subject) unplaced.add(s.ID);
    else if (catchment.contains(subject["Location ID"])) placed.add(s.ID);
  }
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
 * server's lookup, or a programme screening's patient) and its patient, read for the Village column, is not deleted.
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
  // Only the patients of placed rows are read; a programme screening's was read to place it.
  const toRead = candidates.flatMap((r) =>
    r.kind === "screening" && where.placed.has(r.screening.ID) && !where.subjects.has(r.screening["Subject ID"])
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
  const reviewed = reviewedToday(reviews, screenings, viewer, now);
  const waiting = waitingCounts(rows, viewer, now);
  return {
    catchment,
    rows,
    subjects,
    unread,
    waiting,
    reviewed,
    next: chooseGroup(reviewed, waiting),
    held: heldByViewer(rows, viewer, now),
    now,
  };
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * The queue for the pending tab, loaded when `enabled`. `reload` drops the encounter caches and reads everything
 * again, as the button does on every press; its errors go to the caller and leave the loaded queue in place.
 */
export function usePendingQueue(enabled: boolean, viewer: string) {
  const [state, setState] = useState<{ data: PendingQueue | null; error: string | null }>({ data: null, error: null });
  // Only the latest load may land; an older one finishing late is dropped.
  const latest = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const ticket = ++latest.current;
    setState({ data: null, error: null });
    loadPendingQueue(viewer).then(
      (data) => {
        if (ticket === latest.current) setState({ data, error: null });
      },
      (err: unknown) => {
        if (ticket === latest.current) setState({ data: null, error: messageOf(err) });
      },
    );
    return () => {
      latest.current += 1;
    };
  }, [enabled, viewer]);

  const reload = useCallback(async (): Promise<PendingQueue> => {
    invalidateEncounterSweeps();
    const ticket = ++latest.current;
    const data = await loadPendingQueue(viewer);
    if (ticket === latest.current) setState({ data, error: null });
    return data;
  }, [viewer]);

  return { ...state, reload };
}
