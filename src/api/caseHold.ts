import { addDays, endOfDay, startOfDay } from "date-fns";
import {
  ENCOUNTER_TYPE,
  IN_REVIEW_BY_CONCEPT,
  IN_REVIEW_SINCE_CONCEPT,
} from "@/constants/tanuhConcepts";
import type { UpsertEncounterBody } from "./encounters";
import { buildScheduledVisitRequest, type ScheduledVisitRequest } from "./scheduledVisit";
import type { EncounterApiResponse } from "./types";

// A case is a physician's for ten minutes from the server's write of the hold (D10).
export const HOLD_MS = 10 * 60 * 1000;

export interface Hold {
  by: string;
  // The browser clock when the physician took it. Only the fallback for takenAt.
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

export type HoldStatus = { kind: "waiting" } | { kind: "mine"; since: string } | { kind: "other"; by: string };

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
 * Body for PUT /api/encounter/{uuid} that writes (hold) or removes (null) the marker on a planned review. The PUT
 * replaces the observations and the schedule window with what is sent and keeps the visit planned only while
 * "Encounter date time" is null, so all of those are sent back.
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
