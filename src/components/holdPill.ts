import { format, isValid, parseISO } from "date-fns";
import type { HoldStatus } from "@/api/caseHold";
import { shortUsername } from "@/auth/username";

// The Status pill's words (PE-249): another physician by their short name, with the full username, and the time they
// took the case when it is known, in the tooltip. A case nobody holds waits for review, or, when it is not handed out
// until its OCSHR result arrives, for that result. `withSince` (the case page's header, PE-250) adds the time the
// viewer took the case to their own hold; the list leaves it out.
export function holdPill(
  status: HoldStatus,
  suffix: string | undefined,
  { awaitingOcshr = false, withSince = false }: { awaitingOcshr?: boolean; withSince?: boolean } = {},
): { label: string; tooltip?: string } {
  if (status.kind === "waiting") return { label: awaitingOcshr ? "Waiting for OCSHR result" : "Waiting for review" };
  if (status.kind === "mine") {
    const taken = withSince ? parseISO(status.since) : null;
    const time = taken && isValid(taken) ? ` · since ${format(taken, "h:mm a")}` : "";
    return { label: `In review by you${time}` };
  }
  const since = status.since ? parseISO(status.since) : null;
  return {
    label: `In review by ${shortUsername(status.by, suffix)}`,
    tooltip: since && isValid(since) ? `${status.by} since ${format(since, "HH:mm")}` : status.by,
  };
}
