// The Data Quality screens' shared state: the context the API describes the tenant with, and the period
// the header has selected.
//
// `DashboardProvider` (in DashboardProvider.tsx) loads DQS's `/dashboard/context` once and
// holds it in `DashboardContext`. `useDashboard` returns it
// with the selected grain and period, read from the URL's `grain` and `period` parameters so
// that a link reopens the same view; with none in the URL, the latest week. `useParam` reads
// one other URL parameter and `useSetParams` writes several at once, which is how each view
// keeps its filters. `useLoad`
// runs an API call whenever its inputs change and reports its state.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Context, Grain, RuleInfo, Span } from "./api/types";

export interface Dashboard {
  context: Context;
  rules: Record<string, RuleInfo>;
  grain: Grain;
  span: Span | null;
  // The period before the selected one at the same grain, or null for the first.
  previousSpan: Span | null;
  // The selected grain's periods, newest first.
  spans: Span[];
  select: (grain: Grain, start?: string) => void;
}

export const DashboardContext = createContext<Dashboard | null>(null);

export type Loaded<T> =
  | { state: "loading" }
  | { state: "error"; error: Error }
  | { state: "ok"; value: T };

export function useLoad<T>(load: () => Promise<T>, inputs: unknown[]): Loaded<T> {
  const [result, setResult] = useState<Loaded<T>>({ state: "loading" });
  useEffect(() => {
    let live = true;
    setResult({ state: "loading" });
    load().then(
      (value) => live && setResult({ state: "ok", value }),
      (error: Error) => live && setResult({ state: "error", error }),
    );
    return () => {
      live = false;
    };
    // The caller lists what the call depends on, as for useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, inputs);
  return result;
}

// Sets several URL parameters in one update; null or "" removes one. A click that changes more
// than one parameter must use this: React Router applies each separate update to the URL as
// it stood before the click, so of several calls in one handler only the last takes effect.
export function useSetParams(): (changes: Record<string, string | null>) => void {
  const [, setParams] = useSearchParams();
  return useCallback(
    (changes: Record<string, string | null>) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [name, value] of Object.entries(changes)) {
            if (value == null || value === "") next.delete(name);
            else next.set(name, value);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
}

export function useParam(name: string): string | null {
  const [params] = useSearchParams();
  return params.get(name);
}

export function useDashboard(): Dashboard {
  const value = useContext(DashboardContext);
  if (!value) throw new Error("useDashboard is used outside a loaded DashboardProvider");
  return value;
}
