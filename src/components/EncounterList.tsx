import { useMemo, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useNavigate, useSearchParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { getEncountersWithLocation, type EncounterWithLocation } from "@/api/impl";
import { ENCOUNTER_TYPE } from "@/constants/tanuhConcepts";
import { useAsync } from "@/hooks/useAsync";
import { LocationFilter } from "./LocationFilter";

interface Props {
  mode: "pending" | "completed";
}

const PAGE_SIZE = 50;

export function EncounterList({ mode }: Props) {
  const [params, setParams] = useSearchParams();
  const locationUuid = params.get("location");
  const pageIndex = Math.max(0, parseInt(params.get("page") ?? "0", 10) || 0);
  const navigate = useNavigate();

  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const { data: pageData, error } = useAsync(
    () =>
      getEncountersWithLocation({
        encounterType: ENCOUNTER_TYPE.physicianReviewForm.name,
        status: mode === "pending" ? "scheduled" : "completed",
        locationUuid,
        page: pageIndex,
        size: PAGE_SIZE,
      }),
    [mode, locationUuid, pageIndex],
  );

  const filtered = useMemo(() => {
    if (!pageData) return null;
    if (mode !== "completed") return pageData.content;
    const fromDate = from ? parseISO(from) : null;
    const toDate = to ? parseISO(to) : null;
    if (!fromDate && !toDate) return pageData.content;
    return pageData.content.filter((e) => {
      if (!e.encounterDateTime) return false;
      const d = parseISO(e.encounterDateTime);
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    });
  }, [pageData, mode, from, to]);

  if (error) return <Box sx={{ p: 3, color: "error.main" }}>Failed to load: {error}</Box>;
  if (!pageData || !filtered)
    return (
      <Box sx={{ p: 4, display: "flex", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );

  const handleLocationChange = (uuid: string | null) => {
    setParams(
      (sp) => {
        if (uuid) sp.set("location", uuid);
        else sp.delete("location");
        sp.delete("page");
        return sp;
      },
      { replace: false },
    );
  };

  return (
    <Box>
      <Stack
        direction="row"
        spacing={2}
        sx={{ p: 2, borderBottom: "1px solid #e5e7eb", flexWrap: "wrap" }}
        alignItems="center"
      >
        <LocationFilter value={locationUuid} onChange={handleLocationChange} />
        {mode === "completed" && (
          <Stack direction="row" spacing={1}>
            <TextField
              label="From"
              type="date"
              size="small"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="To"
              type="date"
              size="small"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Stack>
        )}
      </Stack>

      {filtered.length === 0 ? (
        <Typography color="text.secondary" sx={{ p: 4, textAlign: "center" }}>
          No {mode === "pending" ? "pending" : "completed"} reviews
          {locationUuid ? " for the selected location." : " in your catchment."}
        </Typography>
      ) : (
        <>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Case ID</TableCell>
                <TableCell>{mode === "pending" ? "Scheduled" : "Reviewed on"}</TableCell>
                <TableCell>Location</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((e: EncounterWithLocation) => {
                const caseId = e.subject.externalId || e.subject.uuid.slice(0, 8);
                const date = mode === "pending" ? e.earliestScheduledDate : e.encounterDateTime;
                const village = e.subject.location.Village ?? e.subject.location["Village"] ?? "—";
                const tooltip = describeLocation(e.subject.location);
                return (
                  <TableRow key={e.encounterUuid} hover>
                    <TableCell>{caseId}</TableCell>
                    <TableCell>{date ? format(parseISO(date), "dd MMM yyyy") : "—"}</TableCell>
                    <TableCell>
                      <Tooltip title={tooltip} arrow>
                        <span>{village}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => navigate(`/review/${e.encounterUuid}`)}>
                        {mode === "pending" ? "Review" : "View"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={pageData.totalElements}
            page={pageIndex}
            rowsPerPage={PAGE_SIZE}
            rowsPerPageOptions={[PAGE_SIZE]}
            onPageChange={(_, next) =>
              setParams((sp) => {
                sp.set("page", String(next));
                return sp;
              })
            }
          />
        </>
      )}
    </Box>
  );
}

function describeLocation(location: Record<string, string>): string {
  const parts: string[] = [];
  for (const key of ["Village", "Block", "District", "State"]) {
    if (location[key]) parts.push(`${key}: ${location[key]}`);
  }
  return parts.join(" · ") || "—";
}
