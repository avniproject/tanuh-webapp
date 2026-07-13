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
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import RateReviewIcon from "@mui/icons-material/RateReview";
import VisibilityIcon from "@mui/icons-material/Visibility";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import { useNavigate, useSearchParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import {
  getAllEncountersWithLocation,
  getEncountersWithLocation,
  type EncounterWithLocation,
} from "@/api/impl";
import { findCompletedEncounterUuidsWithObservation, listEncounters } from "@/api/encounters";
import {
  ENCOUNTER_TYPE,
  PLACE_OF_REFERRAL_CONCEPT,
  REVIEW_CONCEPTS,
} from "@/constants/tanuhConcepts";
import { RISK } from "@/forms/diagnosisMapping";
import { useAsync } from "@/hooks/useAsync";
import { LocationFilter } from "./LocationFilter";
import { FacilityFilter } from "./FacilityFilter";

interface Props {
  mode: "pending" | "completed";
}

const PAGE_SIZE = 50;

// Headline number card. "error" tone is a status color, so it carries an icon
// alongside the color — the state must read without color alone.
function StatTile({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: number | string;
  tone?: "error";
  testId?: string;
}) {
  return (
    <Paper
      variant="outlined"
      data-testid={testId}
      sx={{
        px: 2,
        py: 1.25,
        minWidth: 168,
        ...(tone === "error"
          ? {
              borderColor: "error.light",
              bgcolor: (t) => alpha(t.palette.error.main, 0.04),
            }
          : {}),
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Stack direction="row" spacing={0.75} alignItems="center">
        {tone === "error" && <WarningAmberRoundedIcon color="error" fontSize="small" />}
        <Typography
          variant="h5"
          component="div"
          sx={{ fontWeight: 600, color: tone === "error" ? "error.main" : "text.primary" }}
        >
          {value}
        </Typography>
      </Stack>
    </Paper>
  );
}

// Two parallel branches share State → District (addressLevelTypes.json):
//  - patient/admin chain where subjects are registered: State → District →
//    Taluka → Village (e.g. Karnataka → Bengaluru Rural → Hosakote Taluk → Begur);
//  - facility branch for referrals: a Taluka Hospital (e.g. "Dental hospital").
// They must stay separate — the patient cascade is the admin chain only.
const PATIENT_LOCATION_TYPES = ["State", "District", "Taluka", "Village"] as const;
// "Place of referral" is a Location concept whose allowed (lowest) address-level
// type is "Taluka Hospital", so the referral filter lists locations of just this
// type (parallel to the patient chain, not a level within it).
const REFERRAL_FACILITY_TYPE = "Taluka Hospital";

export function EncounterList({ mode }: Props) {
  const [params, setParams] = useSearchParams();
  const referralUuid = params.get("referral");
  const patientLocationUuid = params.get("loc");
  const riskOnly = mode === "completed" && params.get("risk") === "high";
  const pageIndex = Math.max(0, parseInt(params.get("page") ?? "0", 10) || 0);
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  // Map of subjectUuid -> info pulled from the latest Oral Screening: the
  // screening (encounter) date (shown as "Screening date" on the pending tab),
  // the subject's external ID (the "Case ID"), and the health worker who filled
  // the screening (its creator) — all shown on both tabs.
  const [screeningInfo, setScreeningInfo] = useState<
    Record<string, { screeningDate: string; caseId: string; healthWorker: string }>
  >({});

  // Pending stays server-paged. Completed fetches ALL pages up front so the
  // High Risk and date filters — and the counts shown for them — are correct
  // across the whole list rather than just the visible page; pagination then
  // happens client-side over the filtered rows.
  const listParams = {
    encounterType: ENCOUNTER_TYPE.physicianReviewForm.name,
    // Requirements 2.0: filter by the patient's location subtree
    // (State → District → Taluka → Village).
    locationUuid: patientLocationUuid,
    // Linked-observation filter: only fires when a referral facility is picked.
    linkedEncounterType: referralUuid ? ENCOUNTER_TYPE.oralScreening.name : null,
    linkedObservationConceptUuid: referralUuid ? PLACE_OF_REFERRAL_CONCEPT.uuid : null,
    linkedLocationUuid: referralUuid,
  };
  const { data: pageData, error } = useAsync(
    () =>
      mode === "completed"
        ? getAllEncountersWithLocation({ ...listParams, status: "completed" })
        : getEncountersWithLocation({
            ...listParams,
            status: "scheduled",
            page: pageIndex,
            size: PAGE_SIZE,
          }),
    [mode, referralUuid, patientLocationUuid, mode === "pending" ? pageIndex : -1],
  );

  // Which completed reviews are High Risk. The /api/impl rows carry no
  // observations, so this is resolved once per visit from /api/encounters.
  // null while loading (or on failure): the toggle stays disabled and the
  // count shows "…" instead of silently rendering unfiltered rows.
  const { data: highRiskUuids } = useAsync<Set<string> | null>(
    () =>
      mode === "completed"
        ? findCompletedEncounterUuidsWithObservation(
            ENCOUNTER_TYPE.physicianReviewForm.name,
            REVIEW_CONCEPTS.highLowRisk.name,
            RISK.high,
          )
        : Promise.resolve(null),
    [mode],
  );

  useEffect(() => {
    if (!pageData) return;
    let cancelled = false;
    const subjectIds = Array.from(new Set(pageData.content.map((e) => e.subject.uuid)));
    if (subjectIds.length === 0) {
      setScreeningInfo({});
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
          return [
            sid,
            {
              screeningDate: latest?.["Encounter date time"] ?? "",
              caseId: latest?.["Subject external ID"] ?? "",
              healthWorker: latest?.audit?.["Created by"] ?? "",
            },
          ] as const;
        } catch {
          return [sid, { screeningDate: "", caseId: "", healthWorker: "" }] as const;
        }
      }),
    ).then(
      (
        entries: ReadonlyArray<
          readonly [string, { screeningDate: string; caseId: string; healthWorker: string }]
        >,
      ) => {
        if (cancelled) return;
        setScreeningInfo(Object.fromEntries(entries));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [pageData]);

  const filtered = useMemo(() => {
    if (!pageData) return null;
    let rows = pageData.content;
    if (mode !== "completed") {
      // Pending: show the most recently screened patient first. Rows whose
      // screening date hasn't loaded yet (or is missing) sort to the bottom.
      return [...rows].sort((a, b) =>
        (screeningInfo[b.subject.uuid]?.screeningDate || "").localeCompare(
          screeningInfo[a.subject.uuid]?.screeningDate || "",
        ),
      );
    }
    if (riskOnly && highRiskUuids) {
      rows = rows.filter((e) => highRiskUuids.has(e.encounterUuid));
    }
    const fromDate = from ? parseISO(from) : null;
    const toDate = to ? parseISO(to) : null;
    if (!fromDate && !toDate) return rows;
    return rows.filter((e) => {
      if (!e.encounterDateTime) return false;
      const d = parseISO(e.encounterDateTime);
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    });
  }, [pageData, mode, from, to, screeningInfo, riskOnly, highRiskUuids]);

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

  // Completed paginates client-side over the filtered rows (the fetch brought
  // everything); pending keeps server paging. Clamp the page so a filter that
  // shrinks the list can't strand the user on an out-of-range page.
  const totalRows = mode === "completed" ? filtered.length : pageData.totalElements;
  const effectivePageIndex =
    mode === "completed"
      ? Math.min(pageIndex, Math.max(0, Math.ceil(totalRows / PAGE_SIZE) - 1))
      : pageIndex;
  const visibleRows =
    mode === "completed"
      ? filtered.slice(effectivePageIndex * PAGE_SIZE, (effectivePageIndex + 1) * PAGE_SIZE)
      : filtered;
  // High Risk count over everything the current location/referral filters
  // allow — deliberately not narrowed by the date or High Risk display filters.
  const highRiskCount =
    mode === "completed" && highRiskUuids
      ? pageData.content.filter((e) => highRiskUuids.has(e.encounterUuid)).length
      : null;

  const handleRiskOnlyChange = (checked: boolean) => {
    setParams(
      (sp) => {
        if (checked) sp.set("risk", "high");
        else sp.delete("risk");
        sp.delete("page");
        return sp;
      },
      { replace: false },
    );
  };

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

  const handlePatientLocationChange = (uuid: string | null) => {
    setParams(
      (sp) => {
        if (uuid) sp.set("loc", uuid);
        else sp.delete("loc");
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
        {/* KPI row. Totals are server truth across all pages — display filters
            (High Risk, date range) narrow the rows below, not these numbers. */}
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", rowGap: 1.5 }}>
          <StatTile
            testId="stat-total"
            label={mode === "pending" ? "Pending reviews" : "Completed reviews"}
            value={pageData.totalElements}
          />
          {mode === "completed" && (
            <StatTile testId="stat-high-risk" label="High risk" value={highRiskCount ?? "…"} tone="error" />
          )}
        </Stack>
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
            Patient location
          </Typography>
          <LocationFilter
            value={patientLocationUuid}
            onChange={handlePatientLocationChange}
            types={PATIENT_LOCATION_TYPES}
          />
        </Stack>
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
          <FacilityFilter
            value={referralUuid}
            onChange={handleReferralChange}
            types={[REFERRAL_FACILITY_TYPE]}
          />
        </Stack>
        {mode === "completed" && (
          <>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              alignItems={{ xs: "stretch", sm: "center" }}
              spacing={{ xs: 1, sm: 2 }}
            >
              <Typography
                variant="body1"
                sx={{ minWidth: { xs: 0, sm: 140 }, fontWeight: 600, color: "text.primary" }}
              >
                Risk
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={riskOnly ? "high" : "all"}
                // Disabled until the risk sweep resolves — an unfiltered list
                // must never masquerade as a High Risk-filtered one.
                disabled={!highRiskUuids}
                onChange={(_, v: string | null) => {
                  if (v) handleRiskOnlyChange(v === "high");
                }}
              >
                <ToggleButton value="all" sx={{ px: 2, textTransform: "none", fontWeight: 600 }}>
                  All reviews
                </ToggleButton>
                <ToggleButton
                  value="high"
                  sx={{
                    px: 2,
                    textTransform: "none",
                    fontWeight: 600,
                    "&.Mui-selected": {
                      color: "error.main",
                      bgcolor: (t) => alpha(t.palette.error.main, 0.08),
                      "&:hover": { bgcolor: (t) => alpha(t.palette.error.main, 0.12) },
                    },
                  }}
                >
                  <WarningAmberRoundedIcon fontSize="small" sx={{ mr: 0.75 }} />
                  High Risk only
                </ToggleButton>
              </ToggleButtonGroup>
            </Stack>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              alignItems={{ xs: "stretch", sm: "center" }}
              spacing={{ xs: 1, sm: 2 }}
            >
              <Typography
                variant="body1"
                sx={{ minWidth: { xs: 0, sm: 140 }, fontWeight: 600, color: "text.primary" }}
              >
                Reviewed between
              </Typography>
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
            </Stack>
          </>
        )}
      </Stack>

      {filtered.length === 0 ? (
        <Typography color="text.secondary" sx={{ p: 4, textAlign: "center" }}>
          No {riskOnly ? "High Risk " : ""}{mode === "pending" ? "pending" : "completed"} reviews
          {referralUuid ? " for the selected referral facility." : " in your catchment."}
        </Typography>
      ) : (
        <>
          {isMobile ? (
            <Stack spacing={1.5} sx={{ p: 1.5 }}>
              {visibleRows.map((e: EncounterWithLocation, index: number) => {
                const serialNumber = effectivePageIndex * PAGE_SIZE + index + 1;
                const info = screeningInfo[e.subject.uuid];
                const date = mode === "pending" ? info?.screeningDate : e.encounterDateTime;
                const screeningTs = info?.screeningDate;
                const village = e.subject.location?.["Village"];
                const caseId = info?.caseId || e.subject.externalId;
                const healthWorker = info?.healthWorker;
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
                        <Typography variant="subtitle2" sx={{ color: "text.secondary", pt: 0.5 }}>
                          #{serialNumber}
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
                          Case ID:{" "}
                        </Box>
                        {caseId || "—"}
                      </Typography>
                      <Typography variant="body2" sx={{ color: "text.primary" }}>
                        <Box component="span" sx={{ color: "text.secondary", fontWeight: 500 }}>
                          {mode === "pending" ? "Screening date: " : "Reviewed: "}
                        </Box>
                        {date ? format(parseISO(date), "dd MMM yyyy") : "—"}
                      </Typography>
                      <Typography variant="body2" sx={{ color: "text.primary" }}>
                        <Box component="span" sx={{ color: "text.secondary", fontWeight: 500 }}>
                          Timestamp of screening:{" "}
                        </Box>
                        {screeningTs ? format(parseISO(screeningTs), "dd MMM yyyy, h:mm a") : "—"}
                      </Typography>
                      <Typography variant="body2" sx={{ color: "text.primary" }}>
                        <Box component="span" sx={{ color: "text.secondary", fontWeight: 500 }}>
                          Village:{" "}
                        </Box>
                        {village || "—"}
                      </Typography>
                      <Typography variant="body2" sx={{ color: "text.primary" }}>
                        <Box component="span" sx={{ color: "text.secondary", fontWeight: 500 }}>
                          Health worker:{" "}
                        </Box>
                        {healthWorker || "—"}
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
                  <TableCell sx={{ width: "6%" }}>S.No</TableCell>
                  <TableCell sx={{ width: mode === "pending" ? "14%" : "12%" }}>Case ID</TableCell>
                  <TableCell sx={{ width: mode === "pending" ? "15%" : "13%" }}>
                    {mode === "pending" ? "Screening date" : "Reviewed on"}
                  </TableCell>
                  <TableCell sx={{ width: mode === "pending" ? "18%" : "15%" }}>
                    Timestamp of screening
                  </TableCell>
                  <TableCell sx={{ width: mode === "pending" ? "17%" : "14%" }}>
                    Village
                  </TableCell>
                  <TableCell sx={{ width: mode === "pending" ? "16%" : "14%" }}>Health worker</TableCell>
                  {mode === "completed" && <TableCell sx={{ width: "14%" }}>Reviewed by</TableCell>}
                  <TableCell sx={{ width: mode === "pending" ? "14%" : "12%" }} aria-hidden />
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleRows.map((e: EncounterWithLocation, index: number) => {
                  const serialNumber = effectivePageIndex * PAGE_SIZE + index + 1;
                  const info = screeningInfo[e.subject.uuid];
                  const date = mode === "pending" ? info?.screeningDate : e.encounterDateTime;
                  const screeningTs = info?.screeningDate;
                  const village = e.subject.location?.["Village"];
                  const caseId = info?.caseId || e.subject.externalId;
                  const healthWorker = info?.healthWorker;
                  return (
                    <TableRow
                      key={e.encounterUuid}
                      hover
                      onClick={() => navigate(`/review/${e.encounterUuid}`)}
                      sx={{ cursor: "pointer" }}
                    >
                      <TableCell sx={{ color: "text.secondary" }}>{serialNumber}</TableCell>
                      <TableCell sx={{ color: "text.primary" }}>{caseId || "—"}</TableCell>
                      <TableCell sx={{ color: "text.primary" }}>
                        {date ? format(parseISO(date), "dd MMM yyyy") : "—"}
                      </TableCell>
                      <TableCell sx={{ color: "text.primary" }}>
                        {screeningTs ? format(parseISO(screeningTs), "dd MMM yyyy, h:mm a") : "—"}
                      </TableCell>
                      <TableCell sx={{ color: "text.primary" }}>
                        {village || "—"}
                      </TableCell>
                      <TableCell sx={{ color: "text.primary" }}>{healthWorker || "—"}</TableCell>
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
          {totalRows > PAGE_SIZE && (
            <TablePagination
              component="div"
              count={totalRows}
              page={effectivePageIndex}
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
