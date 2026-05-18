import { useMemo, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { listEncounters, isScheduled, isCompleted } from "@/api/encounters";
import type { EncounterApiResponse } from "@/api/types";
import { ENCOUNTER_TYPE } from "@/constants/tanuhConcepts";
import { useAsync } from "@/hooks/useAsync";

interface Props {
  mode: "pending" | "completed";
}

export function EncounterList({ mode }: Props) {
  const { data: page, error } = useAsync(
    () => listEncounters({ encounterType: ENCOUNTER_TYPE.physicianReviewForm.name, size: 100 }),
    [],
  );
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [reviewer, setReviewer] = useState<string>("");
  const navigate = useNavigate();

  const { filtered, reviewerOptions } = useMemo(() => {
    if (!page) return { filtered: null, reviewerOptions: [] as string[] };

    const completed = page.content.filter(isCompleted);
    const all = mode === "pending" ? page.content.filter(isScheduled) : completed;

    if (mode !== "completed") return { filtered: all, reviewerOptions: [] };

    const fromDate = from ? parseISO(from) : null;
    const toDate = to ? parseISO(to) : null;
    const filteredCompleted = all.filter((e) => {
      const ed = e["Encounter date time"] ? parseISO(e["Encounter date time"]) : null;
      if (fromDate && ed && ed < fromDate) return false;
      if (toDate && ed && ed > toDate) return false;
      if (reviewer && e.audit?.["Last modified by"] !== reviewer) return false;
      return true;
    });
    const reviewers = Array.from(
      new Set(completed.map((e) => e.audit?.["Last modified by"]).filter((r): r is string => Boolean(r))),
    ).sort();
    return { filtered: filteredCompleted, reviewerOptions: reviewers };
  }, [page, mode, from, to, reviewer]);

  if (error) return <Box sx={{ p: 3, color: "error.main" }}>Failed to load: {error}</Box>;
  if (!filtered)
    return (
      <Box sx={{ p: 4, display: "flex", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );

  return (
    <Box>
      {mode === "completed" && (
        <Stack direction="row" spacing={2} sx={{ p: 2, borderBottom: "1px solid #e5e7eb" }}>
          <TextField label="From" type="date" size="small" value={from} onChange={(e) => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField label="To" type="date" size="small" value={to} onChange={(e) => setTo(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField select label="Reviewer" size="small" value={reviewer} onChange={(e) => setReviewer(e.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="">All reviewers</MenuItem>
            {reviewerOptions.map((r) => (
              <MenuItem key={r} value={r}>
                {r}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      )}

      {filtered.length === 0 ? (
        <Typography color="text.secondary" sx={{ p: 4, textAlign: "center" }}>
          No {mode === "pending" ? "pending" : "completed"} reviews in your facility.
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Case ID</TableCell>
              <TableCell>{mode === "pending" ? "Scheduled" : "Reviewed on"}</TableCell>
              {mode === "completed" && <TableCell>Reviewer</TableCell>}
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((e: EncounterApiResponse) => {
              const caseId = e["Subject external ID"] || e["Subject ID"].slice(0, 8);
              const date = mode === "pending" ? e["Earliest scheduled date"] : e["Encounter date time"];
              return (
                <TableRow key={e.ID} hover>
                  <TableCell>{caseId}</TableCell>
                  <TableCell>{date ? format(parseISO(date), "dd MMM yyyy") : "—"}</TableCell>
                  {mode === "completed" && <TableCell>{e.audit?.["Last modified by"] ?? "—"}</TableCell>}
                  <TableCell align="right">
                    <Button size="small" onClick={() => navigate(`/review/${e.ID}`)}>
                      {mode === "pending" ? "Review" : "View"}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Box>
  );
}
