import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import RateReviewIcon from "@mui/icons-material/RateReview";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useNavigate, useSearchParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { getEncountersWithLocation, type EncounterWithLocation } from "@/api/impl";
import { listEncounters } from "@/api/encounters";
import { ENCOUNTER_TYPE, PLACE_OF_REFERRAL_CONCEPT } from "@/constants/tanuhConcepts";
import { useAsync } from "@/hooks/useAsync";
import { LocationFilter } from "./LocationFilter";

interface Props {
  mode: "pending" | "completed";
}

const PAGE_SIZE = 50;
const PLACE_OF_REFERRAL_KEY = "Place of referral";

export function EncounterList({ mode }: Props) {
  const [params, setParams] = useSearchParams();
  const referralUuid = params.get("referral");
  const pageIndex = Math.max(0, parseInt(params.get("page") ?? "0", 10) || 0);
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  // Map of subjectUuid -> Place of referral pulled from the latest Oral Screening
  const [referrals, setReferrals] = useState<Record<string, string>>({});

  const { data: pageData, error } = useAsync(
    () =>
      getEncountersWithLocation({
        encounterType: ENCOUNTER_TYPE.physicianReviewForm.name,
        status: mode === "pending" ? "scheduled" : "completed",
        // Linked-observation filter: only fires when a referral facility is picked.
        linkedEncounterType: referralUuid ? ENCOUNTER_TYPE.oralScreening.name : null,
        linkedObservationConceptUuid: referralUuid ? PLACE_OF_REFERRAL_CONCEPT.uuid : null,
        linkedLocationUuid: referralUuid,
        page: pageIndex,
        size: PAGE_SIZE,
      }),
    [mode, referralUuid, pageIndex],
  );

  useEffect(() => {
    if (!pageData) return;
    let cancelled = false;
    const subjectIds = Array.from(new Set(pageData.content.map((e) => e.subject.uuid)));
    if (subjectIds.length === 0) {
      setReferrals({});
      return;
    }
    Promise.all(
      subjectIds.map(async (sid) => {
        try {
          const res = await listEncounters({
            encounterType: ENCOUNTER_TYPE.oralScreening.name,
            subjectId: sid,
            size: 5,
          });
          const latest = res.content
            .filter((enc) => !enc.Voided && enc["Encounter date time"])
            .sort((a, b) =>
              (b["Encounter date time"] || "").localeCompare(a["Encounter date time"] || ""),
            )[0];
          const raw = latest?.observations?.[PLACE_OF_REFERRAL_KEY];
          return [sid, extractReferralName(raw)] as const;
        } catch {
          return [sid, ""] as const;
        }
      }),
    ).then((entries: ReadonlyArray<readonly [string, string]>) => {
      if (cancelled) return;
      setReferrals(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [pageData]);

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
      <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Stack spacing={1.5}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} variant="rounded" height={isMobile ? 96 : 48} />
          ))}
        </Stack>
      </Box>
    );

  const handleReferralChange = (uuid: string | null) => {
    setParams(
      (sp) => {
        if (uuid) sp.set("referral", uuid);
        else sp.delete("referral");
        sp.delete("page");
        return sp;
      },
      { replace: false },
    );
  };

  return (
    <Box>
      <Stack
        direction="column"
        spacing={1.5}
        sx={{ p: { xs: 1.5, sm: 2 }, borderBottom: "1px solid #e5e7eb" }}
      >
        <Stack
          direction={{ xs: "column", sm: "row" }}
          alignItems={{ xs: "stretch", sm: "center" }}
          spacing={{ xs: 1, sm: 2 }}
        >
          <Typography
            variant="body1"
            sx={{
              minWidth: { xs: 0, sm: 140 },
              fontWeight: 600,
              color: "text.primary",
            }}
          >
            Referral facility
          </Typography>
          <LocationFilter value={referralUuid} onChange={handleReferralChange} />
        </Stack>
        {mode === "completed" && (
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
            <TextField
              label="From"
              type="date"
              size="small"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ flex: { xs: 1, sm: "0 1 auto" } }}
            />
            <TextField
              label="To"
              type="date"
              size="small"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ flex: { xs: 1, sm: "0 1 auto" } }}
            />
          </Stack>
        )}
      </Stack>

      {filtered.length === 0 ? (
        <Typography color="text.secondary" sx={{ p: 4, textAlign: "center" }}>
          No {mode === "pending" ? "pending" : "completed"} reviews
          {referralUuid ? " for the selected referral facility." : " in your catchment."}
        </Typography>
      ) : (
        <>
          {isMobile ? (
            <Stack spacing={1.5} sx={{ p: 1.5 }}>
              {filtered.map((e: EncounterWithLocation) => {
                const displayName =
                  e.subject.displayName?.trim() ||
                  e.subject.externalId ||
                  e.subject.uuid.slice(0, 8);
                const date = mode === "pending" ? e.earliestScheduledDate : e.encounterDateTime;
                const referral = referrals[e.subject.uuid];
                return (
                  <Paper
                    key={e.encounterUuid}
                    variant="outlined"
                    onClick={() => navigate(`/review/${e.encounterUuid}`)}
                    sx={{
                      p: 1.5,
                      cursor: "pointer",
                      "&:active": { backgroundColor: "grey.100" },
                    }}
                  >
                    <Stack spacing={0.5}>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                        <Typography
                          variant="body1"
                          sx={{ fontWeight: 700, color: "text.primary" }}
                        >
                          {displayName}
                        </Typography>
                        <Button
                          size="small"
                          startIcon={mode === "pending" ? <RateReviewIcon /> : <VisibilityIcon />}
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(`/review/${e.encounterUuid}`);
                          }}
                          sx={{ flexShrink: 0 }}
                        >
                          {mode === "pending" ? "Review" : "View"}
                        </Button>
                      </Stack>
                      <Typography variant="body2" sx={{ color: "text.primary" }}>
                        <Box component="span" sx={{ color: "text.secondary", fontWeight: 500 }}>
                          {mode === "pending" ? "Scheduled: " : "Reviewed: "}
                        </Box>
                        {date ? format(parseISO(date), "dd MMM yyyy") : "—"}
                      </Typography>
                      <Typography variant="body2" sx={{ color: "text.primary" }}>
                        <Box component="span" sx={{ color: "text.secondary", fontWeight: 500 }}>
                          Place of referral:{" "}
                        </Box>
                        {referral || "—"}
                      </Typography>
                      {mode === "completed" && (
                        <Typography variant="body2" sx={{ color: "text.primary" }}>
                          <Box component="span" sx={{ color: "text.secondary", fontWeight: 500 }}>
                            Reviewed by:{" "}
                          </Box>
                          {e.lastModifiedBy || "—"}
                        </Typography>
                      )}
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          ) : (
            <Table size="small" sx={{ tableLayout: "fixed" }}>
              <TableHead>
                <TableRow sx={{ "& th": { fontWeight: 700, color: "text.primary", fontSize: "0.95rem", backgroundColor: "grey.100" } }}>
                  <TableCell sx={{ width: mode === "pending" ? "30%" : "22%" }}>Name</TableCell>
                  <TableCell sx={{ width: mode === "pending" ? "20%" : "16%" }}>
                    {mode === "pending" ? "Scheduled" : "Reviewed on"}
                  </TableCell>
                  <TableCell sx={{ width: mode === "pending" ? "35%" : "26%" }}>Place of referral</TableCell>
                  {mode === "completed" && <TableCell sx={{ width: "22%" }}>Reviewed by</TableCell>}
                  <TableCell sx={{ width: "15%" }} aria-hidden />
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((e: EncounterWithLocation) => {
                  const displayName =
                    e.subject.displayName?.trim() ||
                    e.subject.externalId ||
                    e.subject.uuid.slice(0, 8);
                  const date = mode === "pending" ? e.earliestScheduledDate : e.encounterDateTime;
                  const referral = referrals[e.subject.uuid];
                  return (
                    <TableRow
                      key={e.encounterUuid}
                      hover
                      onClick={() => navigate(`/review/${e.encounterUuid}`)}
                      sx={{ cursor: "pointer" }}
                    >
                      <TableCell sx={{ fontWeight: 600, color: "text.primary", fontSize: "0.95rem" }}>
                        {displayName}
                      </TableCell>
                      <TableCell sx={{ color: "text.primary" }}>
                        {date ? format(parseISO(date), "dd MMM yyyy") : "—"}
                      </TableCell>
                      <TableCell sx={{ color: "text.primary" }}>{referral || "—"}</TableCell>
                      {mode === "completed" && (
                        <TableCell sx={{ color: "text.primary" }}>{e.lastModifiedBy || "—"}</TableCell>
                      )}
                      <TableCell>
                        <Button
                          size="small"
                          startIcon={mode === "pending" ? <RateReviewIcon /> : <VisibilityIcon />}
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(`/review/${e.encounterUuid}`);
                          }}
                        >
                          {mode === "pending" ? "Review" : "View"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {pageData.totalElements > PAGE_SIZE && (
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
              sx={{
                "& .MuiTablePagination-toolbar": {
                  flexWrap: "wrap",
                  gap: 0.5,
                  px: { xs: 1, sm: 2 },
                },
              }}
            />
          )}
        </>
      )}
    </Box>
  );
}

// "Place of referral" can be either a plain string OR a location-hierarchy
// object (keys = AddressLevelType names, values = location titles). For the
// table column we want the deepest non-empty facility name.
function extractReferralName(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return "";
  const obj = value as Record<string, unknown>;
  // Most-specific facility level first; fallback to admin hierarchy.
  const preferred = [
    "Sub-center (HWC)",
    "Primary Health Center (PHC)",
    "Community Health Center (CHC)",
    "District Hospital",
    "Village",
    "Block",
    "District",
    "State",
  ];
  for (const k of preferred) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}
