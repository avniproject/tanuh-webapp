// The arithmetic behind the daily counts charts, kept apart from the components so that it
// can be tested on its own. Nothing here scores: every number is a count DQS's days route
// returned.
//
// `shownCounts` is one bucket's counts kept to one record type, or with one left out, and
// `screenings` is what a tenant's screenings are, which is how the Health Check and the worker
// profile count them. `latestDay` is the last bucket that is not in the future. `levelOf` is
// the shade step a cell of the week strip is drawn in.

import type { Context, DayCount, TypeCount } from "./api/types";

export interface Counted {
  // The one record type to count, or null to count every type.
  only?: string | null;
  // A record type not to count when `only` is null.
  leaveOut?: string | null;
}

const NONE: TypeCount = { records: 0, failed: 0, unplaced: 0 };

// A bucket's counts of the record type `only` names, or without the records of `leaveOut`, or
// all of them.
export function shownCounts(day: DayCount, { only = null, leaveOut = null }: Counted = {}): TypeCount {
  if (only) return day.by_type[only] ?? NONE;
  const left = leaveOut ? day.by_type[leaveOut] : undefined;
  if (!left) return { records: day.records, failed: day.failed, unplaced: day.unplaced };
  return {
    records: day.records - left.records,
    failed: day.failed - left.failed,
    unplaced: day.unplaced - left.unplaced,
  };
}

// The last bucket up to today, or null when every bucket is still to come.
export function latestDay(days: DayCount[]): DayCount | null {
  const past = days.filter((day) => !day.future);
  return past.length ? past[past.length - 1] : null;
}

// The shade step, 0 to `steps`, of a count against the busiest count shown beside it: 0 only
// for no records, so that a quiet day never looks like an empty one.
export function levelOf(count: number, busiest: number, steps = 4): number {
  if (count <= 0 || busiest <= 0) return 0;
  return Math.max(1, Math.ceil((count / busiest) * steps));
}

// The screening record type alone when the tenant names one, else every type but the photos.
export function screenings(context: Context): Counted {
  return { only: context.screening_record_type, leaveOut: context.photo_record_type };
}
