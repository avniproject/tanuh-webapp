import { useEffect, useMemo, useState } from "react";
import { Alert, Autocomplete, Box, Button, Skeleton, TextField } from "@mui/material";
import {
  getCatchmentLocations,
  type CatchmentLocationNode,
  type CatchmentLocationsResponse,
} from "@/api/impl";

interface Props {
  value: string | null;
  onChange: (uuid: string | null) => void;
  // Patient/admin location TYPES to EXCLUDE. Referral facilities are not a fixed,
  // hardcoded set — they are whatever is in the user's catchment that is NOT part
  // of the patient hierarchy (the parallel facility branch). So instead of an
  // allow-list of facility type names (which drift when the org is reconfigured),
  // we show every catchment node whose type is not in this deny-list. They are
  // parallel (not nested under one another), so they render as ONE flat,
  // searchable single-select list, grouped by type. The selected facility's uuid
  // feeds the existing single linked-observation server filter.
  excludeTypes: readonly string[];
}

interface LoadState {
  tree: CatchmentLocationsResponse | null;
  error: string | null;
}

export function FacilityFilter({ value, onChange, excludeTypes }: Props) {
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

  // Flat list of facility nodes = every catchment node that is NOT part of the
  // patient hierarchy. Ordered by type name then location name (so MUI's groupBy
  // gets contiguous groups).
  const options = useMemo<CatchmentLocationNode[]>(() => {
    if (!state.tree) return [];
    const excluded = new Set(excludeTypes);
    return state.tree.nodes
      .filter((n) => !excluded.has(n.type))
      .sort((a, b) => {
        const ta = a.type.localeCompare(b.type);
        if (ta !== 0) return ta;
        return a.name.localeCompare(b.name);
      });
  }, [state.tree, excludeTypes]);

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
        Failed to load facilities: {state.error}
      </Alert>
    );
  }

  if (!state.tree) {
    return <Skeleton variant="rounded" height={40} sx={{ flex: 1, maxWidth: { sm: 360 } }} />;
  }

  if (options.length === 0) {
    return (
      <Alert severity="info" sx={{ flex: 1 }}>
        No referral facilities available in your catchment.
      </Alert>
    );
  }

  const selected = options.find((o) => o.uuid === value) ?? null;

  return (
    <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
      <Autocomplete
        size="small"
        options={options}
        value={selected}
        getOptionLabel={(o) => o.name}
        groupBy={(o) => o.type}
        isOptionEqualToValue={(o, v) => o.uuid === v.uuid}
        onChange={(_, next) => onChange(next?.uuid ?? null)}
        sx={{
          minWidth: { xs: "100%", sm: 280 },
          maxWidth: { xs: "100%", sm: 360 },
          flex: { xs: "1 1 100%", sm: "0 1 auto" },
        }}
        renderInput={(p) => <TextField {...p} label="Facility" placeholder="Search facility…" />}
      />
    </Box>
  );
}
