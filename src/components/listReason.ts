import { signalDetailsOf } from "@/api/signalDetails";
import type { QueueGroup } from "@/constants/tanuhConcepts";
import type { WaitingFor } from "./holdPill";

export type ListReason = QueueGroup | "OCSHR pending" | "OCSHR not scored";
export type OcshrReason = Extract<ListReason, `OCSHR ${string}`>;

// The Reason pill for a case with no OCSHR result: the hourglass while it is pending, a no-result mark when the model
// will never score it, each with its own test id.
export const OCSHR_REASON_BADGE: Record<OcshrReason, { testId: string; icon: "hourglass" | "no-result" }> = {
  "OCSHR pending": { testId: "ocshr-pending-badge", icon: "hourglass" },
  "OCSHR not scored": { testId: "ocshr-not-scored-badge", icon: "no-result" },
};

// The pending list's Reason and Status words for a queue row. rowReason calls every case with no OCSHR result "OCSHR
// pending"; one the OCSHR model will never score (not sent, failed the quality check, or failed scoring) reads "OCSHR
// not scored" in Reason and "No OCSHR result" in Status instead (Adam, 23 Nov). Only the words change: sorting,
// filtering and Review next case still go by rowReason.
export function listReason(
  reason: QueueGroup | "OCSHR pending" | undefined,
  screening: { observations?: Record<string, unknown> } | undefined,
): { reason?: ListReason; waitingFor: WaitingFor } {
  if (reason !== "OCSHR pending") return { reason, waitingFor: "review" };
  const never = screening !== undefined && signalDetailsOf(screening).ocshr.state === "unavailable";
  return never ? { reason: "OCSHR not scored", waitingFor: "no-ocshr" } : { reason, waitingFor: "ocshr" };
}
