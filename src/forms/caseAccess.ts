import { format, isValid, parseISO } from "date-fns";
import { holdStatus, readHold, type ReviewLike } from "@/api/caseHold";
import { classify, signalsOf } from "@/api/caseSignals";
import { isCompleted } from "@/api/encounters";
import { signalDetailsOf } from "@/api/signalDetails";
import type { EncounterApiResponse } from "@/api/types";
import type { WaitingFor } from "@/components/holdPill";
import { IN_REVIEW_BY_CONCEPT, IN_REVIEW_SINCE_CONCEPT } from "@/constants/tanuhConcepts";

// PE-249: what a case page says about who has the case, and whether the "In review by" hold lets the viewer edit it.
// A waiting case's `reason` says why Review next case does not give it out (FW8): its OCSHR result is pending, the OCSHR
// model will never score it (no result, and the screening shows it was not sent, failed the quality check, or failed
// scoring), or it is in no review group.
export type CaseNotice =
  | { kind: "mine"; since: string }
  | { kind: "other"; by: string }
  | { kind: "waiting"; reason?: "ocshr-pending" | "ocshr-never" | "no-group" };

export interface CaseAccess {
  // The hold keeps the page read-only. Completed, legacy and unavailable cases are read-only for their own reasons.
  locked: boolean;
  notice: CaseNotice | null;
}

// A waiting case, with the reason the button does not give it out when there is one (FW8).
function waiting(screening: { observations?: Record<string, unknown> } | undefined): CaseNotice {
  if (!screening) return { kind: "waiting" };
  const cls = classify(signalsOf(screening));
  if (cls.ocshrPending) {
    const never = signalDetailsOf(screening).ocshr.state === "unavailable";
    return { kind: "waiting", reason: never ? "ocshr-never" : "ocshr-pending" };
  }
  if (!cls.group) return { kind: "waiting", reason: "no-group" };
  return { kind: "waiting" };
}

/**
 * With the review queue on (D3), a booked review is editable only by the physician whose hold is live on it; anyone
 * else sees who has it, or that it waits for Review next case, or why the button does not give it out. A screening's
 * page with no review would create one on submit, which would bypass the queue, so it waits too. Completed and
 * unavailable cases say nothing new. With the queue off the page is as before.
 */
export function decideCaseAccess(
  queueOn: boolean,
  page: { review?: ReviewLike; unavailable?: string; screening?: { observations?: Record<string, unknown> } },
  viewer: string,
  now: Date,
): CaseAccess {
  if (!queueOn) return { locked: false, notice: null };
  if (page.unavailable) return { locked: true, notice: null };
  if (!page.review) return { locked: true, notice: waiting(page.screening) };
  if (page.review["Encounter date time"]) return { locked: true, notice: null };
  const status = holdStatus(page.review, viewer, now);
  return { locked: status.kind !== "mine", notice: status.kind === "waiting" ? waiting(page.screening) : status };
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
      if (notice.reason === "ocshr-pending") return "Not handed out yet: this case's OCSHR result is pending.";
      if (notice.reason === "ocshr-never") return "Not handed out: the OCSHR model will not score this case.";
      if (notice.reason === "no-group")
        return "This case is not in a review group, so Review next case does not hand it out.";
      return "Waiting. Use Review next case on Pending Reviews to review it.";
  }
}

// The header pill's words for a waiting case: waiting for its OCSHR result, no OCSHR result when the model will never
// score it, else waiting for review.
export function noticeWaitingFor(notice: CaseNotice): WaitingFor {
  if (notice.kind !== "waiting") return "review";
  if (notice.reason === "ocshr-pending") return "ocshr";
  if (notice.reason === "ocshr-never") return "no-ocshr";
  return "review";
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

/**
 * The answers a case page shows: a completed review's recorded ones; else, on a page the hold locks (someone else
 * has the case, or it is waiting), the empty form, so the viewer's unsent draft is not read as the holder's work;
 * else the viewer's draft. The draft itself is kept, and comes back when the viewer takes the case again.
 */
export function formToShow<F>(access: CaseAccess, forms: { stored: F | null; draft: F | null; empty: F }): F {
  if (forms.stored) return forms.stored;
  if (access.notice && access.notice.kind !== "mine") return forms.empty;
  return forms.draft ?? forms.empty;
}
