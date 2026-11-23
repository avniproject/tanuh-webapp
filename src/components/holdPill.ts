import { format, isValid, parseISO } from "date-fns";
import type { HoldStatus } from "@/api/caseHold";
import { shortUsername } from "@/auth/username";

// What a case nobody holds is waiting for: review; its OCSHR result, which it is not handed out without; or nothing,
// because the OCSHR model will never score it (Adam, 23 Nov), so it must not read as waiting.
export type WaitingFor = "review" | "ocshr" | "no-ocshr";

const WAITING_LABEL: Record<WaitingFor, string> = {
  review: "Waiting for review",
  ocshr: "Waiting for OCSHR result",
  "no-ocshr": "No OCSHR result",
};

// The Status pill's words (PE-249): another physician by their short name, with the full username, and the time they
// took the case when it is known, in the tooltip. A case nobody holds reads as `waitingFor` says. `withSince` (the
// case page's header, PE-250) adds the time the viewer took the case to their own hold; the list leaves it out.
export function holdPill(
  status: HoldStatus,
  suffix: string | undefined,
  { waitingFor = "review", withSince = false }: { waitingFor?: WaitingFor; withSince?: boolean } = {},
): { label: string; tooltip?: string } {
  if (status.kind === "waiting") return { label: WAITING_LABEL[waitingFor] };
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
