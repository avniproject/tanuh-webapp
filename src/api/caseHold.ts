import axios from "axios";
import { addDays, endOfDay, startOfDay } from "date-fns";
import { http } from "@/auth/httpClient";
import { serverNow } from "@/auth/serverClock";
import {
  ENCOUNTER_TYPE,
  IN_REVIEW_BY_CONCEPT,
  IN_REVIEW_SINCE_CONCEPT,
  REVIEWED_ORAL_SCREENING_CONCEPT,
} from "@/constants/tanuhConcepts";
import {
  getEncounter,
  invalidateEncounterSweeps,
  isProgramEncounter,
  listVisitsFor,
  patchEncounter,
  screeningsByReview,
  submitEncounter,
  type PatchEncounterBody,
  type UpsertEncounterBody,
} from "./encounters";
import type { QueueRow } from "./queueRows";
import { buildScheduledVisitRequest, type ScheduledVisitRequest } from "./scheduledVisit";
import type { EncounterApiResponse } from "./types";

// A case is a physician's for ten minutes from the server's write of the hold (D10).
export const HOLD_MS = 10 * 60 * 1000;

export interface Hold {
  by: string;
  // When the physician took it, by the server's clock as the browser reads it (serverClock.ts). Only the fallback for
  // takenAt.
  since: string;
  // The review's server time audit["Last modified at"]; the hold write sets it.
  takenAt?: string;
}

export type ReviewLike = {
  observations?: Record<string, unknown>;
  "Encounter date time"?: string | null;
  "Cancel date time"?: string | null;
  Voided?: boolean;
  audit?: { "Last modified at"?: string };
};

// `since` on another physician's hold is when they took the case; only holdDetail gives it.
export type HoldStatus =
  | { kind: "waiting" }
  | { kind: "mine"; since: string }
  | { kind: "other"; by: string; since?: string };

export function readHold(review: ReviewLike): Hold | undefined {
  const by = review.observations?.[IN_REVIEW_BY_CONCEPT.name];
  const since = review.observations?.[IN_REVIEW_SINCE_CONCEPT.name];
  if (typeof by !== "string" || !by || typeof since !== "string" || !since) return undefined;
  const takenAt = review.audit?.["Last modified at"];
  return takenAt ? { by, since, takenAt } : { by, since };
}

export function isLiveHold(hold: Hold | undefined, now: Date): boolean {
  if (!hold) return false;
  const start = Date.parse(hold.takenAt ?? hold.since);
  if (Number.isNaN(start)) return false;
  return now.getTime() - start < HOLD_MS;
}

const isCompleted = (r: ReviewLike) => !!r["Encounter date time"];
const isGone = (r: ReviewLike) => !!r["Cancel date time"] || r.Voided === true;

export function holdStatus(review: ReviewLike | undefined, viewer: string, now: Date): HoldStatus {
  if (!review || isCompleted(review) || isGone(review)) return { kind: "waiting" };
  const hold = readHold(review);
  if (!hold || !isLiveHold(hold, now)) return { kind: "waiting" };
  return hold.by === viewer ? { kind: "mine", since: hold.since } : { kind: "other", by: hold.by };
}

// The hold status, with the time another physician took the case, for the list's Status pill.
export function holdDetail(review: ReviewLike | undefined, viewer: string, now: Date): HoldStatus {
  const status = holdStatus(review, viewer, now);
  if (status.kind !== "other" || !review) return status;
  const since = readHold(review)?.since;
  return since ? { ...status, since } : status;
}

export function decideTake(
  current: EncounterApiResponse | null,
  viewer: string,
  now: Date,
): "take" | "completed" | "held" | "gone" {
  if (!current) return "take";
  if (isCompleted(current)) return "completed";
  if (isGone(current)) return "gone";
  const hold = readHold(current);
  if (hold && hold.by !== viewer && isLiveHold(hold, now)) return "held";
  return "take";
}

/**
 * Body for the whole-visit PUT that writes (hold) or removes (null) the marker on a planned PROGRAMME review, which
 * has no PATCH. The PUT replaces the observations and the schedule window with what is sent and keeps the visit planned
 * only while "Encounter date time" is null, so all of those are sent back.
 */
export function holdBody(
  review: EncounterApiResponse,
  hold: Hold | null,
  extra: Record<string, unknown> = {},
): UpsertEncounterBody {
  const observations = { ...review.observations };
  delete observations[IN_REVIEW_BY_CONCEPT.name];
  delete observations[IN_REVIEW_SINCE_CONCEPT.name];
  return {
    "Encounter type": review["Encounter type"],
    "Subject ID": review["Subject ID"],
    "Encounter date time": null,
    "Earliest scheduled date": review["Earliest scheduled date"],
    "Max scheduled date": review["Max scheduled date"],
    observations: {
      ...observations,
      ...(hold ? { [IN_REVIEW_BY_CONCEPT.name]: hold.by, [IN_REVIEW_SINCE_CONCEPT.name]: hold.since } : {}),
      ...extra,
    },
  };
}

/**
 * Body for PATCH /api/encounter/{uuid} that writes (hold) or removes (null) the marker on a STANDALONE review (FW3).
 * Only the marker fields, and `extra`, are sent; the server merges them into the stored observations and a null removes
 * one. Nothing else on the review is touched, so a submit, cancel or delete that lands between the read and this write
 * stands.
 */
export function holdPatch(
  review: Pick<EncounterApiResponse, "Encounter type">,
  hold: Hold | null,
  extra: Record<string, unknown> = {},
): PatchEncounterBody {
  return {
    "Encounter type": review["Encounter type"],
    observations: {
      [IN_REVIEW_BY_CONCEPT.name]: hold ? hold.by : null,
      [IN_REVIEW_SINCE_CONCEPT.name]: hold ? hold.since : null,
      ...extra,
    },
  };
}

const sameInstant = (a: string, b: string) => {
  const t = Date.parse(a);
  return !Number.isNaN(t) && t === Date.parse(b);
};

/**
 * The review as read again after a take write (FW3): the viewer's only when it is still open and carries the marker
 * just written, the viewer's name and the same time. Two takes that overlap both write; the one written last stays, so
 * the other reads someone else's marker, or its own name with another window's time, and is refused as held.
 */
export function confirmTake(
  review: ReviewLike | null,
  viewer: string,
  since: string,
): "mine" | "completed" | "held" | "gone" {
  if (!review) return "gone";
  if (isCompleted(review)) return "completed";
  if (isGone(review)) return "gone";
  const hold = readHold(review);
  return hold && hold.by === viewer && sameInstant(hold.since, since) ? "mine" : "held";
}

export const REVIEW_UUID_NAMESPACE = "3f0a6d52-6b1c-4d0e-9a51-7c2e0b249249";

const uuidBytes = (u: string) => {
  const hex = u.replace(/-/g, "");
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
};

// RFC 4122 version 5: SHA-1 of the namespace bytes then the name bytes.
export async function uuidV5(name: string, namespace: string): Promise<string> {
  const nameBytes = new TextEncoder().encode(name);
  const data = new Uint8Array(16 + nameBytes.length);
  data.set(uuidBytes(namespace), 0);
  data.set(nameBytes, 16);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", data)).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function reviewUuidFor(screeningUuid: string): Promise<string> {
  return uuidV5(screeningUuid, REVIEW_UUID_NAMESPACE);
}

// The planned review for a case that has none yet, with the phone rule's window: start of today to the end of the
// day two days later.
export function createReviewVisit(screening: EncounterApiResponse, uuid: string, today: Date): ScheduledVisitRequest {
  return buildScheduledVisitRequest(
    {
      encounterType: { name: ENCOUNTER_TYPE.physicianReviewForm.name, uuid: ENCOUNTER_TYPE.physicianReviewForm.uuid },
      subjectId: screening["Subject ID"],
      enrolmentId: screening["Enrolment ID"],
      earliestVisitDateTime: startOfDay(today).toISOString(),
      maxVisitDateTime: endOfDay(addDays(today, 2)).toISOString(),
    },
    uuid,
  );
}

// "reviewed": the screening has a review of its own already, which this load did not see (FW7).
export type TakeRefusal = "completed" | "held" | "gone" | "reviewed";
export type TakeResult = { reviewUuid: string } | { refused: TakeRefusal };

const isNotFound = (err: unknown) => axios.isAxiosError(err) && err.response?.status === 404;

// A review that is not there is null; any other failure is the caller's.
async function readReview(uuid: string): Promise<EncounterApiResponse | null> {
  try {
    return await getEncounter(uuid);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

// The hold write: a PATCH of the marker on a standalone review, the whole-visit PUT on a programme one.
function writeHold(review: EncounterApiResponse, hold: Hold | null, extra: Record<string, unknown> = {}) {
  if (isProgramEncounter(review)) return submitEncounter(review.ID, holdBody(review, hold, extra), { program: true });
  return patchEncounter(review.ID, holdPatch(review, hold, extra));
}

// The hold write, retried once. The first write may have landed before it failed, so the retry re-reads the review and
// decides again: `stop` gives the reason not to write again, or undefined to write from the fresh copy. A second
// failure is thrown.
async function writeHoldOnce<Stop extends string>(
  current: EncounterApiResponse,
  hold: Hold | null,
  extra: Record<string, unknown>,
  stop: (fresh: EncounterApiResponse) => Stop | undefined,
): Promise<Stop | "gone" | undefined> {
  try {
    await writeHold(current, hold, extra);
    return undefined;
  } catch {
    const fresh = await readReview(current.ID);
    if (!fresh) return "gone";
    const reason = stop(fresh);
    if (reason) return reason;
    await writeHold(fresh, hold, extra);
    return undefined;
  }
}

/**
 * Whether the screening already has a live review other than the derived one (FW7). The queue's load can miss it: the
 * booked reviews are read up to a cap per place and the encounter cache has its own caps. So the patient's reviews,
 * or for a programme screening its enrolment's, are read from the server and paired as everywhere else. A voided or
 * cancelled review cannot be completed, so it does not count.
 */
async function hasOwnReview(screening: EncounterApiResponse, derivedUuid: string): Promise<boolean> {
  const [reviews, screenings] = await Promise.all([
    listVisitsFor(screening, ENCOUNTER_TYPE.physicianReviewForm.name),
    listVisitsFor(screening, ENCOUNTER_TYPE.oralScreening.name),
  ]);
  const paired = screeningsByReview(reviews, screenings);
  return reviews.some((r) => r.ID !== derivedUuid && !isGone(r) && paired.get(r.ID)?.ID === screening.ID);
}

/**
 * Creates the derived review on the web save (D1) and gives it as read back. The POST can fail after it, or another
 * physician's take, made the review; the review is then read again and given when it is there (FW7). With none
 * there, the failure is thrown.
 */
async function createReview(screening: EncounterApiResponse, uuid: string, now: Date): Promise<EncounterApiResponse> {
  const { url, body } = createReviewVisit(screening, uuid, now);
  try {
    const response = await http.post<{ success: boolean; errorMessage?: string }>(url, body);
    if (!response.data.success) {
      throw new Error(response.data.errorMessage || `${url} refused the review`);
    }
  } catch (err) {
    const after = await readReview(uuid).catch(() => null);
    if (after) return after;
    throw err;
  }
  return getEncounter(uuid);
}

// Writes the hold on a review the take has decided to take, then reads it again: the case is the viewer's only when
// the marker just written is what the server now holds (FW3).
async function holdAndConfirm(
  current: EncounterApiResponse,
  hold: Hold,
  extra: Record<string, unknown>,
  viewer: string,
  now: Date,
): Promise<TakeResult> {
  const stopped = await writeHoldOnce<TakeRefusal>(current, hold, extra, (fresh) => {
    const again = decideTake(fresh, viewer, now);
    return again === "take" ? undefined : again;
  });
  if (stopped) return { refused: stopped };
  invalidateEncounterSweeps();
  const confirmed = confirmTake(await readReview(current.ID), viewer, hold.since);
  return confirmed === "mine" ? { reviewUuid: current.ID } : { refused: confirmed };
}

/**
 * Takes a case for `viewer`: writes the hold on the case's review, creating the review first when a completed
 * screening has none, and keeps the case only when the review read back afterwards carries that hold. Nothing is
 * written when the review is completed, cancelled, deleted or held by someone else.
 */
export async function takeCase(row: QueueRow, viewer: string, now: Date = serverNow()): Promise<TakeResult> {
  const hold: Hold = { by: viewer, since: now.toISOString() };

  if (row.kind === "booked") {
    const current = await readReview(row.review.encounterUuid);
    if (!current) return { refused: "gone" };
    const verdict = decideTake(current, viewer, now);
    if (verdict !== "take") return { refused: verdict };
    return holdAndConfirm(current, hold, {}, viewer, now);
  }

  const screening = row.screening;
  const stamp = { [REVIEWED_ORAL_SCREENING_CONCEPT.name]: screening.ID };
  const uuid = await reviewUuidFor(screening.ID);
  let current = await readReview(uuid);
  if (current) {
    const verdict = decideTake(current, viewer, now);
    if (verdict !== "take") return { refused: verdict };
  } else {
    if (await hasOwnReview(screening, uuid)) return { refused: "reviewed" };
    current = await createReview(screening, uuid, now);
    const verdict = decideTake(current, viewer, now);
    if (verdict !== "take") return { refused: verdict };
  }
  return holdAndConfirm(current, hold, stamp, viewer, now);
}

const canRelease = (r: EncounterApiResponse, viewer: string) =>
  !isCompleted(r) && !isGone(r) && readHold(r)?.by === viewer;

/** Removes the viewer's own hold from a review; a review held by someone else, or already over, is left alone. */
export async function releaseCase(reviewUuid: string, viewer: string): Promise<void> {
  const current = await readReview(reviewUuid);
  if (!current || !canRelease(current, viewer)) return;
  const stopped = await writeHoldOnce(current, null, {}, (fresh) =>
    canRelease(fresh, viewer) ? undefined : ("skip" as const),
  );
  if (stopped) return;
  invalidateEncounterSweeps();
}
