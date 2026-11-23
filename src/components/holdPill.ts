import { format, isValid, parseISO } from "date-fns";
import type { HoldStatus } from "@/api/caseHold";
import { shortUsername } from "@/auth/username";

// The Status pill's words (PE-249): another physician by their short name, with the full username, and the time they
// took the case when it is known, in the tooltip.
export function holdPill(status: HoldStatus, suffix: string | undefined): { label: string; tooltip?: string } {
  if (status.kind === "waiting") return { label: "Waiting" };
  if (status.kind === "mine") return { label: "In review by you" };
  const since = status.since ? parseISO(status.since) : null;
  return {
    label: `In review by ${shortUsername(status.by, suffix)}`,
    tooltip: since && isValid(since) ? `${status.by} since ${format(since, "HH:mm")}` : status.by,
  };
}
