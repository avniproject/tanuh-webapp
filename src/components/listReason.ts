import { signalDetailsOf } from "@/api/signalDetails";
import type { QueueGroup } from "@/constants/tanuhConcepts";
import type { WaitingFor } from "./holdPill";

export type ListReason = QueueGroup | "OCSHR pending" | "OCSHR not scored";

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
