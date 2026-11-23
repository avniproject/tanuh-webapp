// The provider of the Data Quality screens' shared state: it loads DQS's dashboard context
// once and works out the selected grain and period from the URL. state.ts describes what it
// holds.

import { useMemo } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { dqsApi } from "./api/client";
import type { Context, Grain } from "./api/types";
import { DashboardContext, useLoad } from "./state";
import type { Dashboard, Loaded } from "./state";

export function DashboardProvider({ children }: { children: (loaded: Loaded<Context>) => ReactNode }) {
  const loaded = useLoad(() => dqsApi.context(), []);
  const [params, setParams] = useSearchParams();

  const value = useMemo<Dashboard | null>(() => {
    if (loaded.state !== "ok") return null;
    const context = loaded.value;
    const raw = params.get("grain");
    const grain: Grain = raw === "month" || raw === "year" ? raw : "week";
    const spans = [...(context.periods[grain] ?? [])].sort((a, b) => b.start.localeCompare(a.start));
    const asked = params.get("period");
    const index = Math.max(0, spans.findIndex((one) => one.start === asked));
    return {
      context,
      rules: Object.fromEntries(context.rules.map((rule) => [rule.rule_id, rule])),
      grain,
      span: spans[index] ?? null,
      previousSpan: spans[index + 1] ?? null,
      spans,
      select: (nextGrain, start) =>
        setParams((current) => {
          const next = new URLSearchParams(current);
          next.set("grain", nextGrain);
          if (start) next.set("period", start);
          else next.delete("period");
          for (const name of ["page", "worker", "rpage"]) next.delete(name);
          return next;
        }),
    };
  }, [loaded, params, setParams]);

  return <DashboardContext.Provider value={value}>{children(loaded)}</DashboardContext.Provider>;
}

