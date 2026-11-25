// The arithmetic behind the village map, kept apart from the component so that it can be
// tested on its own. Nothing here scores: every number is a count DQS's villages route
// returned.
//
// `countsByOutline` files each village's count under the map village it belongs to, by id or
// by one of the map village's aliases, and keeps the counts that match no outline apart.
// `shadeSteps` splits the period's counts into four equal ranges up to the busiest village,
// and `shadeOf` is the range a count falls in. `VILLAGE_SHADES` and `TALUK_TINT` are the map's
// colours for those ranges and for each taluk band.

import type { VillageCount, VillageOutline } from "./api/types";
import { DQ } from "./tokens";

export interface Filed {
  // Each map village's records and workers, by the map village's id.
  byOutline: Map<string, { n_records: number; workers: string[] }>;
  // The records filed under a village id the map has no outline for.
  unmatched: number;
}

export function countsByOutline(outlines: VillageOutline[], counts: VillageCount[]): Filed {
  const owner = new Map<string, string>();
  for (const one of outlines) {
    owner.set(one.village_id, one.village_id);
    for (const alias of one.aliases) if (!owner.has(alias)) owner.set(alias, one.village_id);
  }
  const byOutline: Filed["byOutline"] = new Map();
  let unmatched = 0;
  for (const count of counts) {
    const id = owner.get(count.village_id);
    if (!id) {
      unmatched += count.n_records;
      continue;
    }
    const held = byOutline.get(id) ?? { n_records: 0, workers: [] };
    byOutline.set(id, {
      n_records: held.n_records + count.n_records,
      workers: [...new Set([...held.workers, ...count.workers])].sort(),
    });
  }
  return { byOutline, unmatched };
}

// The upper bound of each of four equal ranges from 1 to `busiest`, so that the last is
// `busiest`; fewer when `busiest` is under four. None when no village has a record.
export function shadeSteps(busiest: number): number[] {
  if (busiest <= 0) return [];
  const step = Math.ceil(busiest / 4);
  const steps = [];
  for (let top = step; top < busiest; top += step) steps.push(top);
  return [...steps, busiest];
}

// Which range of `steps` a count falls in, from 0, or -1 for no records.
export function shadeOf(count: number, steps: number[]): number {
  if (count <= 0) return -1;
  const at = steps.findIndex((top) => count <= top);
  return at === -1 ? steps.length - 1 : at;
}

export type TalukBand = "high" | "mid" | "low" | "ins" | "none";

// From fewest to most screenings: an ochre ramp, kept apart from the band colours so that a
// shade is never read as a score.
export const VILLAGE_SHADES = ["#efe3c2", "#dcc07f", "#b98d3a", "#6f4f1a"];

export const TALUK_TINT: Record<TalukBand, { fill: string; stroke: string; dashed: boolean }> = {
  high: { fill: "#e3f2e7", stroke: DQ.success, dashed: false },
  mid: { fill: DQ.surfaceMuted, stroke: DQ.neutral, dashed: false },
  low: { fill: DQ.dangerSubtle, stroke: DQ.danger, dashed: false },
  ins: { fill: DQ.surfaceSubtle, stroke: DQ.borderStrong, dashed: true },
  none: { fill: DQ.surface, stroke: DQ.borderStrong, dashed: true },
};
