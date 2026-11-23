import type { QueueGroup } from "@/constants/tanuhConcepts";

// PE-249's three review groups: orange (Adam's choice after his own test, in place of the ticket screen's amber), violet
// and teal. Shared by the group pills and the case page's screening signals, so it lives outside either component file.
export const QUEUE_GROUP_COLOURS: Record<QueueGroup, { ink: string; fill: string }> = {
  "FLW marked": { ink: "#9a3412", fill: "#ffedd5" },
  "AI marked": { ink: "#5b21b6", fill: "#ede9fe" },
  "Safety sample": { ink: "#115e59", fill: "#ccfbf1" },
};
