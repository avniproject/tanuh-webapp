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
import { FacilityFilter } from "./FacilityFilter";

interface Props {
  mode: "pending" | "completed";
}

const PAGE_SIZE = 50;

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
  const pageIndex = Math.max(0, parseInt(params.get("page") ?? "0", 10) || 0);
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  // Requirements 2.0: search a patient by name (or external id). Applied
  // client-side to the loaded page.
  const [nameQuery, setNameQuery] = useState<string>("");
  // Map of subjectUuid -> info pulled from the latest Oral Screening: the
  // screening (encounter) date (shown as "Screening date" on the pending tab)
  // and the subject's external ID (the "Case ID", shown on both tabs).
  const [screeningInfo, setScreeningInfo] = useState<
    Record<string, { screeningDate: string; caseId: string }>
  >({});

  const { data: pageData, error } = useAsync(
    () =>
      getEncountersWithLocation({
        encounterType: ENCOUNTER_TYPE.physicianReviewForm.name,
        status: mode === "pending" ? "scheduled" : "completed",
        // Requirements 2.0: filter by the patient's location subtree
        // (State → District → Taluka → Village).
        locationUuid: patientLocationUuid,
        // Linked-observation filter: only fires when a referral facility is picked.
        linkedEncounterType: referralUuid ? ENCOUNTER_TYPE.oralScreening.name : null,
        linkedObservationConceptUuid: referralUuid ? PLACE_OF_REFERRAL_CONCEPT.uuid : null,
        linkedLocationUuid: referralUuid,
        page: pageIndex,
        size: PAGE_SIZE,
      }),
    [mode, referralUuid, patientLocationUuid, pageIndex],
  );

  useEffect(() => {
    if (!pageData) return;
    let cancelled = false;
    const subjectIds = Array.from(new Set(pageData.content.map((e) => e.subject.uuid)));
    if (subjectIds.length === 0) {
      setScreeningInfo({});
      return;
    }
    console.log("[CASEID-DEBUG] review.subject (impl):", pageData.content[0]?.subject);
    Promise.all(
      subjectIds.map(async (sid, i) => {
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
          if (i === 0 && latest) {
            console.log("[CASEID-DEBUG] oral screening encounter:", latest);
          }
          return [
            sid,
            {
              screeningDate: latest?.["Encounter date time"] ?? "",
              caseId: latest?.["Subject external ID"] ?? "",
            },
          ] as const;
        } catch {
          return [sid, { screeningDate: "", caseId: "" }] as const;
        }
      }),
    ).then(
      (entries: ReadonlyArray<readonly [string, { screeningDate: string; caseId: string }]>) => {
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
    const q = nameQuery.trim().toLowerCase();
    if (q) {
      rows = rows.filter((e) => {
        const name = e.subject.displayName?.toLowerCase() ?? "";
        const extId = e.subject.externalId?.toLowerCase() ?? "";
        return name.includes(q) || extId.includes(q);
      });
    }
    if (mode !== "completed") {
      // Pending: show the most recently screened patient first. Rows whose
      // screening date hasn't loaded yet (or is missing) sort to the bottom.
      return [...rows].sort((a, b) =>
        (screeningInfo[b.subject.uuid]?.screeningDate || "").localeCompare(
          screeningInfo[a.subject.uuid]?.screeningDate || "",
        ),
      );
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
  }, [pageData, mode, from, to, nameQuery, screeningInfo]);

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
        <TextField
          label="Search patient by name"
          size="small"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
          sx={{ maxWidth: { sm: 360 } }}
        />
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
                const info = screeningInfo[e.subject.uuid];
                const date = mode === "pending" ? info?.screeningDate : e.encounterDateTime;
                const village = e.subject.location?.["Village"];
                const caseId = info?.caseId || e.subject.externalId;
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
                          Village:{" "}
                        </Box>
                        {village || "—"}
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
                  <TableCell sx={{ width: mode === "pending" ? "18%" : "15%" }}>Case ID</TableCell>
                  <TableCell sx={{ width: mode === "pending" ? "25%" : "18%" }}>Name</TableCell>
                  <TableCell sx={{ width: mode === "pending" ? "17%" : "15%" }}>
                    {mode === "pending" ? "Screening date" : "Reviewed on"}
                  </TableCell>
                  <TableCell sx={{ width: mode === "pending" ? "25%" : "20%" }}>
                    Village
                  </TableCell>
                  {mode === "completed" && <TableCell sx={{ width: "18%" }}>Reviewed by</TableCell>}
                  <TableCell sx={{ width: mode === "pending" ? "15%" : "14%" }} aria-hidden />
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((e: EncounterWithLocation) => {
                  const displayName =
                    e.subject.displayName?.trim() ||
                    e.subject.externalId ||
                    e.subject.uuid.slice(0, 8);
                  const info = screeningInfo[e.subject.uuid];
                  const date = mode === "pending" ? info?.screeningDate : e.encounterDateTime;
                  const village = e.subject.location?.["Village"];
                  const caseId = info?.caseId || e.subject.externalId;
                  return (
                    <TableRow
                      key={e.encounterUuid}
                      hover
                      onClick={() => navigate(`/review/${e.encounterUuid}`)}
                      sx={{ cursor: "pointer" }}
                    >
                      <TableCell sx={{ color: "text.primary" }}>{caseId || "—"}</TableCell>
                      <TableCell sx={{ fontWeight: 600, color: "text.primary", fontSize: "0.95rem" }}>
                        {displayName}
                      </TableCell>
                      <TableCell sx={{ color: "text.primary" }}>
                        {date ? format(parseISO(date), "dd MMM yyyy") : "—"}
                      </TableCell>
                      <TableCell sx={{ color: "text.primary" }}>
                        {village || "—"}
                      </TableCell>
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
