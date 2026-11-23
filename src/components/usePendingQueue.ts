import { useCallback, useEffect, useRef, useState } from "react";
import { getCatchment, type Catchment } from "@/api/catchment";
import { getCachedEncounters, invalidateEncounterSweeps } from "@/api/encounters";
import { getAllEncountersWithLocation, type EncounterListParams, type EncounterWithLocation } from "@/api/impl";
import { getProgramEncountersWithLocation, readSubjects } from "@/api/programList";
import { chooseGroup, heldByViewer, reviewedToday, waitingCounts, type GroupCounts } from "@/api/queueChoice";
import { selectQueueRows, type QueueRow } from "@/api/queueRows";
import type { SubjectApiResponse } from "@/api/types";
import { ENCOUNTER_TYPE, type QueueGroup } from "@/constants/tanuhConcepts";

export interface ReviewsByPlace {
  content: EncounterWithLocation[];
  totalElements: number;
  // Program reviews kept although their patient could not be read, so could not be placed (programList.ts).
  unchecked: Set<string>;
}

/** The places to read reviews in: the chosen place when it is one of the physician's, else each top place. */
export function placesToRead(catchment: Catchment, chosen: string | null | undefined): string[] {
  return chosen && catchment.contains(chosen) ? [chosen] : catchment.tops;
}

/**
 * Reviews read one place at a time, standalone and programme, merged by uuid (PE-249). The places are the physician's
 * top places, or the one place chosen, so nothing outside their places is read. No places, no reviews.
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
  const programUuids = new Set<string>();
  const placed = new Set<string>();
  const unplaced = new Set<string>();
  let standaloneTotal = 0;
  for (const { standalone, program } of reads) {
    standaloneTotal += standalone.totalElements;
    for (const e of standalone.content) byUuid.set(e.encounterUuid, e);
    for (const e of program.rows) {
      byUuid.set(e.encounterUuid, e);
      programUuids.add(e.encounterUuid);
      (program.unchecked.has(e.encounterUuid) ? unplaced : placed).add(e.encounterUuid);
    }
  }
  return {
    content: [...byUuid.values()],
    // The places do not overlap, so the server's totals add up; past its page cap they exceed the rows read.
    totalElements: standaloneTotal + programUuids.size,
    unchecked: new Set([...unplaced].filter((uuid) => !placed.has(uuid))),
  };
}

export interface PendingQueue {
  catchment: Catchment;
  // Every case in the physician's places, whatever the list's filters (D7).
  rows: QueueRow[];
  // The patients of the screening rows, read to place them.
  subjects: ReadonlyMap<string, SubjectApiResponse>;
  // Cases left out because their patient could not be read.
  unread: number;
  waiting: GroupCounts & { total: number };
  reviewed: GroupCounts;
  next: QueueGroup | null;
  held: QueueRow | undefined;
  now: Date;
}

/**
 * The queue's own read (PE-249, D7): booked reviews in each of the physician's top places, and every screening and
 * review in the encounter store. A screening row stays only when its patient was read, is not deleted and lives in one
 * of the physician's places; a row whose patient could not be read is left out and counted, as is a programme review
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
  const now = new Date();
  const candidates = selectQueueRows(booked.content, screenings, reviews, viewer, now);
  // With no places there is nothing to place, so no patient is read.
  const toRead =
    catchment.tops.length > 0
      ? candidates.flatMap((r) => (r.kind === "screening" ? [r.screening["Subject ID"]] : []))
      : [];
  const read = toRead.length > 0 ? await readSubjects(toRead) : new Map<string, SubjectApiResponse | null>();
  const subjects = new Map<string, SubjectApiResponse>();
  let unread = 0;
  const rows = candidates.filter((row) => {
    if (row.kind === "booked") {
      if (!booked.unchecked.has(row.review.encounterUuid)) return true;
      unread += 1;
      return false;
    }
    if (catchment.tops.length === 0) return false;
    const subject = read.get(row.screening["Subject ID"]);
    if (!subject) {
      unread += 1;
      return false;
    }
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
