import { format, isValid, parseISO } from "date-fns";
import { holdStatus, readHold, type ReviewLike } from "@/api/caseHold";
import { isCompleted } from "@/api/encounters";
import type { EncounterApiResponse } from "@/api/types";
import { IN_REVIEW_BY_CONCEPT, IN_REVIEW_SINCE_CONCEPT } from "@/constants/tanuhConcepts";

// PE-249: what a case page says about who has the case, and whether the "In review by" hold lets the viewer edit it.
export type CaseNotice = { kind: "mine"; since: string } | { kind: "other"; by: string } | { kind: "waiting" };

export interface CaseAccess {
  // The hold keeps the page read-only. Completed, legacy and unavailable cases are read-only for their own reasons.
  locked: boolean;
  notice: CaseNotice | null;
}

/**
 * With the review queue on (D3), a booked review is editable only by the physician whose hold is live on it; anyone
 * else sees who has it, or that it waits for Review next case. A screening's page with no review would create one on
 * submit, which would bypass the queue, so it waits too. Completed and unavailable cases say nothing new. With the
 * queue off the page is as before.
 */
export function decideCaseAccess(
  queueOn: boolean,
  page: { review?: ReviewLike; unavailable?: string },
  viewer: string,
  now: Date,
): CaseAccess {
  if (!queueOn) return { locked: false, notice: null };
  if (page.unavailable) return { locked: true, notice: null };
  if (!page.review) return { locked: true, notice: { kind: "waiting" } };
  if (page.review["Encounter date time"]) return { locked: true, notice: null };
  const status = holdStatus(page.review, viewer, now);
  return { locked: status.kind !== "mine", notice: status };
}

export function caseNoticeText(notice: CaseNotice): string {
  switch (notice.kind) {
    case "mine": {
      const since = parseISO(notice.since);
      return isValid(since) ? `In review by you since ${format(since, "HH:mm")}` : "In review by you";
    }
    case "other":
      return `In review by ${notice.by}`;
    case "waiting":
      return "Waiting. Use Review next case on Pending Reviews to review it.";
  }
}

export type SubmitDecision = { kind: "refuse" } | { kind: "send"; markers: Record<string, string> };

/**
 * The submit's decision on the review as re-read at submit. Queue off: as before, a review someone completed meanwhile
 * is refused and nothing new is sent. Queue on: the later submission is kept (D9), and the review records who reviewed
 * it and since when: the time stored with the viewer's own hold, else now. Another physician's stored time is not this
 * physician's.
 */
export function decideSubmit(
  queueOn: boolean,
  current: EncounterApiResponse,
  viewer: string,
  now: Date,
): SubmitDecision {
  if (!queueOn) return isCompleted(current) ? { kind: "refuse" } : { kind: "send", markers: {} };
  const hold = readHold(current);
  const since = hold && hold.by === viewer ? hold.since : now.toISOString();
  return { kind: "send", markers: { [IN_REVIEW_BY_CONCEPT.name]: viewer, [IN_REVIEW_SINCE_CONCEPT.name]: since } };
}
