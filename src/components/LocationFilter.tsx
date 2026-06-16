import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, MenuItem, Skeleton, Stack, TextField } from "@mui/material";
import {
  getCatchmentLocations,
  type CatchmentLocationNode,
  type CatchmentLocationsResponse,
} from "@/api/impl";

interface Props {
  value: string | null;
  onChange: (uuid: string | null) => void;
  // When set, only nodes of these location TYPES are offered, as a nested
  // cascade. Used for the admin patient-location chain
  // (State→District→Taluka→Village). Kept nodes whose parent is filtered out are
  // re-parented to the nearest kept ancestor and become roots. Omit to show the
  // full tree. (Referral facilities are parallel, non-nested types — see
  // FacilityFilter, a flat single-select instead.)
  types?: readonly string[];
}

interface LoadState {
  tree: CatchmentLocationsResponse | null;
  error: string | null;
}

export function LocationFilter({ value, onChange, types }: Props) {
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
    let nodes = state.tree.nodes;
    if (types && types.length > 0) {
      const allowed = new Set(types);
      const byUuidAll = new Map(state.tree.nodes.map((n) => [n.uuid, n]));
      nodes = state.tree.nodes
        .filter((n) => allowed.has(n.type))
        .map((n) => {
          // Re-parent to the nearest kept ancestor; with none, the node
          // becomes a root of this filter's tree.
          let p = n.parentUuid ? byUuidAll.get(n.parentUuid) : undefined;
          while (p && !allowed.has(p.type)) {
            p = p.parentUuid ? byUuidAll.get(p.parentUuid) : undefined;
          }
          const newParent = p?.uuid ?? null;
          return newParent === (n.parentUuid ?? null) ? n : { ...n, parentUuid: newParent };
        });
    }
    const byUuid = new Map<string, CatchmentLocationNode>();
    const byParent = new Map<string | null, CatchmentLocationNode[]>();
    for (const n of nodes) {
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
  }, [state.tree, types]);

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
    // Box + CSS gap, not Stack, so the gap applies on the cross-axis too —
    // otherwise the floating MUI labels of wrapped dropdowns overlap the row above.
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        columnGap: 1.5,
        rowGap: 1.5,
      }}
    >
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
            sx={{
              minWidth: { xs: "100%", sm: 200 },
              maxWidth: { xs: "100%", sm: 260 },
              flex: { xs: "1 1 100%", sm: "0 1 auto" },
            }}
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
    </Box>
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
