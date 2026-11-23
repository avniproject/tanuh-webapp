import { format, isValid, parseISO } from "date-fns";
import type { HoldStatus } from "@/api/caseHold";
import { shortUsername } from "@/auth/username";

// The Status pill's words (PE-249): another physician by their short name, with the full username, and the time they
// took the case when it is known, in the tooltip. A case nobody holds waits for review, or, when it is not handed out
// until its OCSHR result arrives, for that result.
export function holdPill(
  status: HoldStatus,
  suffix: string | undefined,
  { awaitingOcshr = false }: { awaitingOcshr?: boolean } = {},
): { label: string; tooltip?: string } {
  if (status.kind === "waiting") return { label: awaitingOcshr ? "Waiting for OCSHR result" : "Waiting for review" };
  if (status.kind === "mine") return { label: "In review by you" };
  const since = status.since ? parseISO(status.since) : null;
  return {
    label: `In review by ${shortUsername(status.by, suffix)}`,
    tooltip: since && isValid(since) ? `${status.by} since ${format(since, "HH:mm")}` : status.by,
  };
}
