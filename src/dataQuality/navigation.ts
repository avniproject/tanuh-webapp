// Moving between the Data Quality views while keeping the selected grain and period.
//
// The views live under /data-quality. `useGo` returns a function that opens one with the
// given URL parameters. The grain and the period are carried over from the current URL; every
// other parameter belongs to the view being left and is dropped. `withPeriod` is the same for
// a link's href.

import { useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

export type View = "health" | "workers" | "dimensions" | "guide";

export const BASE = "/data-quality";

export function withPeriod(view: View, search: string, extra: Record<string, string | null | undefined> = {}) {
  const current = new URLSearchParams(search);
  const next = new URLSearchParams();
  for (const kept of ["grain", "period"]) {
    const value = current.get(kept);
    if (value) next.set(kept, value);
  }
  for (const [name, value] of Object.entries(extra)) if (value) next.set(name, value);
  const query = next.toString();
  return `${BASE}/${view}${query ? `?${query}` : ""}`;
}

export function useGo() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  return useCallback(
    (view: View, extra: Record<string, string | null | undefined> = {}) =>
      navigate(withPeriod(view, params.toString(), extra)),
    [navigate, params],
  );
}
