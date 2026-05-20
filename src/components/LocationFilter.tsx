import { useEffect, useMemo, useState } from "react";
import { Alert, Button, MenuItem, Skeleton, Stack, TextField } from "@mui/material";
import {
  getCatchmentLocations,
  type CatchmentLocationNode,
  type CatchmentLocationsResponse,
} from "@/api/impl";

interface Props {
  value: string | null;
  onChange: (uuid: string | null) => void;
}

interface LoadState {
  tree: CatchmentLocationsResponse | null;
  error: string | null;
}

export function LocationFilter({ value, onChange }: Props) {
  const [state, setState] = useState<LoadState>({ tree: null, error: null });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ tree: null, error: null });
    getCatchmentLocations()
      .then((tree) => {
        if (!cancelled) setState({ tree, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ tree: null, error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const indexed = useMemo(() => {
    if (!state.tree) return null;
    const byUuid = new Map<string, CatchmentLocationNode>();
    const byParent = new Map<string | null, CatchmentLocationNode[]>();
    for (const n of state.tree.nodes) {
      byUuid.set(n.uuid, n);
      const key = n.parentUuid ?? null;
      const list = byParent.get(key) ?? [];
      list.push(n);
      byParent.set(key, list);
    }
    // Stable label-ordered children at every level
    for (const list of byParent.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return { byUuid, byParent };
  }, [state.tree]);

  // Build the chain from root → deepest-selected by walking parents from `value`.
  // If value is null, the chain is empty.
  const selectionChain = useMemo<string[]>(() => {
    if (!indexed || !value) return [];
    const chain: string[] = [];
    let cur = indexed.byUuid.get(value);
    while (cur) {
      chain.unshift(cur.uuid);
      cur = cur.parentUuid ? indexed.byUuid.get(cur.parentUuid) : undefined;
    }
    return chain;
  }, [indexed, value]);

  if (state.error) {
    return (
      <Alert
        severity="error"
        sx={{ flex: 1 }}
        action={
          <Button color="inherit" size="small" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </Button>
        }
      >
        Failed to load locations: {state.error}
      </Alert>
    );
  }

  if (!indexed) {
    return (
      <Stack direction="row" spacing={1} sx={{ flex: 1 }}>
        <Skeleton variant="rounded" width={160} height={40} />
        <Skeleton variant="rounded" width={160} height={40} />
        <Skeleton variant="rounded" width={160} height={40} />
      </Stack>
    );
  }

  if (state.tree && state.tree.nodes.length === 0) {
    return (
      <Alert severity="info" sx={{ flex: 1 }}>
        No locations available to filter — your account has no catchment assigned.
      </Alert>
    );
  }

  // Render one dropdown per level. At level N, options = children of the
  // selection at level N-1 (or roots at level 0). Picking "All" at level N
  // clears N and emits the level N-1 uuid (or null at the top level).
  const levels = buildLevelSequence(indexed.byParent, indexed.byUuid, selectionChain);

  return (
    <Stack direction="row" spacing={1} sx={{ flex: 1, flexWrap: "wrap" }}>
      {levels.map((level, index) => {
        const selectedAtLevel = selectionChain[index] ?? "";
        const typeLabel = level.type;
        return (
          <TextField
            key={`${typeLabel}-${index}`}
            select
            size="small"
            label={typeLabel}
            value={selectedAtLevel}
            onChange={(e) => {
              const next = e.target.value;
              if (!next) {
                onChange(index === 0 ? null : (selectionChain[index - 1] ?? null));
              } else {
                onChange(next);
              }
            }}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">All {typeLabel}</MenuItem>
            {level.options.map((opt) => (
              <MenuItem key={opt.uuid} value={opt.uuid}>
                {opt.name}
              </MenuItem>
            ))}
          </TextField>
        );
      })}
      {value && (
        <Button size="small" onClick={() => onChange(null)}>
          Clear
        </Button>
      )}
    </Stack>
  );
}

interface RenderedLevel {
  type: string;
  options: CatchmentLocationNode[];
}

function buildLevelSequence(
  byParent: Map<string | null, CatchmentLocationNode[]>,
  byUuid: Map<string, CatchmentLocationNode>,
  selectionChain: string[],
): RenderedLevel[] {
  const levels: RenderedLevel[] = [];

  // Level 0: roots (parentUuid == null).
  const roots = byParent.get(null) ?? [];
  if (roots.length === 0) return levels;
  levels.push({ type: roots[0].type, options: roots });

  for (let i = 0; i < selectionChain.length; i++) {
    const parentUuid = selectionChain[i];
    const children = byParent.get(parentUuid) ?? [];
    if (children.length === 0) break;
    levels.push({ type: children[0].type, options: children });
  }

  // If no selection at level 0 yet, stop there. selectionChain.length === 0 path
  // covered by the loop not executing.
  if (selectionChain.length === 0) return levels;

  // Ensure unselected deeper level still appears when selectionChain ends mid-tree.
  const deepest = byUuid.get(selectionChain[selectionChain.length - 1]);
  if (deepest) {
    const moreChildren = byParent.get(deepest.uuid) ?? [];
    const lastRendered = levels[levels.length - 1];
    if (moreChildren.length > 0 && lastRendered.options !== moreChildren) {
      levels.push({ type: moreChildren[0].type, options: moreChildren });
    }
  }

  return levels;
}
