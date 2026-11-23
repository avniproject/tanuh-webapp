import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  IconButton,
  InputAdornment,
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
import { useTheme } from "@mui/material/styles";
import RateReviewIcon from "@mui/icons-material/RateReview";
import VisibilityIcon from "@mui/icons-material/Visibility";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import { useLocation, useNavigate } from "react-router-dom";
import { endOfDay, format, parseISO } from "date-fns";
import type { EncounterWithLocation } from "@/api/impl";
import { readSubjects } from "@/api/programList";
import { getCatchment } from "@/api/catchment";
import { holdDetail, takeCase, type HoldStatus } from "@/api/caseHold";
import { nextAndHeld, takeNextCase } from "@/api/queueChoice";
import {
  filterQueueRows,
  narrowQueueRows,
  queueRowSubjectId,
  rowReason,
  sortQueueRows,
  type QueueGroupFilter,
  type QueueRow,
} from "@/api/queueRows";
import {
  findCompletedEncounterUuidsWithCodedValue,
  getCachedEncounters,
  getEncounterCacheScope,
  getLatestScreeningInfoBySubject,
  getReviewScreeningPairing,
  type LatestScreeningInfo,
} from "@/api/encounters";
import { hasHighRiskModel, hasReviewQueue } from "@/api/concepts";
import { addressChain, inSubtree } from "@/api/address";
import {
  filterByPatientLocation,
  filterPendingRows,
  matchPatientLocation,
  patientsToRead,
  pendingRowKey,
  pendingRowSubjectId,
  rowsOnPage,
  selectPendingRows,
  sortPendingRows,
  withoutDeletedPatients,
  type GroupFilter,
  type PendingRow,
  type PendingSort,
} from "@/api/pendingRows";
import type { SubjectApiResponse } from "@/api/types";
import { loadListState, saveListState, type ListState } from "@/api/listState";
import {
  ENCOUNTER_ID_CONCEPT,
  ENCOUNTER_TYPE,
  PLACE_OF_REFERRAL_CONCEPT,
  QUEUE_GROUPS,
  REVIEW_CONCEPTS,
  readModelResult,
  readObs,
} from "@/constants/tanuhConcepts";
import { RISK } from "@/forms/diagnosisMapping";
import { useAsync } from "@/hooks/useAsync";
import { useAuth } from "@/auth/authContext";
import { shortUsername } from "@/auth/username";
import { LocationFilter } from "./LocationFilter";
import { FacilityFilter } from "./FacilityFilter";
import { NextCasePanel } from "./NextCasePanel";
import type { WaitingFor } from "./holdPill";
import { listReason, type ListReason } from "./listReason";
import { CategoryBadge, HoldStatusBadge, ModelResultBadge, OcshrPendingBadge, QueueGroupBadge } from "./StatusBadge";
import { chosenPlace, placeScreenings, placesToRead, readReviewsByPlace, usePendingQueue } from "./usePendingQueue";

interface Props {
  mode: "pending" | "completed";
}

const PAGE_SIZE = 50;

// Headline number card.
function StatTile({
  label,
  value,
  testId,
}: {
  label: ReactNode;
  value: number | string;
  testId?: string;
}) {
  return (
    <Paper variant="outlined" data-testid={testId} sx={{ px: 2, py: 1.25, minWidth: 168 }}>
      <Box sx={{ typography: "body2", color: "text.secondary" }}>{label}</Box>
      <Typography variant="h5" component="div" sx={{ fontWeight: 600, color: "text.primary" }}>
        {value}
      </Typography>
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

// tanuh-webapp#4: the pending tab's group filter and sorts, where the organisation has the high-risk model.
const GROUP_FILTERS: { value: GroupFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "high-risk", label: "High Risk" },
  { value: "low-risk", label: "Low Risk" },
  { value: "flw-override", label: "FLW override" },
  { value: "safety-sample", label: "Safety sample" },
  { value: "not-scored", label: "Not scored" },
];
// PE-249: the queue's group filter, where the organisation has the review queue.
const QUEUE_GROUP_FILTERS: { value: QueueGroupFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "flw", label: "FLW marked" },
  { value: "ai", label: "AI marked" },
  { value: "safety", label: "Safety sample" },
];
const SORTS: { value: PendingSort; label: string }[] = [
  { value: "group", label: "By group" },
  { value: "date", label: "By date" },
  { value: "opinion", label: "By opinion" },
];

// One row as both render paths show it, whether it came from a review or a screening.
interface RowView {
  key: string;
  href: string;
  subjectId: string;
  caseId?: string | null;
  screeningDate?: string | null;
  village?: string | null;
  healthWorker?: string | null;
  opinion?: string;
  modelResult?: string;
  group?: string;
  reviewedOn?: string | null;
  reviewedBy?: string | null;
  // PE-249: why the case is in the queue, and who is working on it. `waitingFor` gives the Status pill's words when
  // nobody has the case.
  reason?: ListReason;
  waitingFor?: WaitingFor;
  hold?: HoldStatus;
}

function reviewRowView(e: EncounterWithLocation, info: LatestScreeningInfo | undefined): RowView {
  return {
    key: e.encounterUuid,
    href: `/review/${e.encounterUuid}`,
    subjectId: e.subject.uuid,
    caseId: info?.encounterId || info?.caseId || e.subject.externalId,
    screeningDate: info?.screeningDate,
    village: e.subject.location?.["Village"],
    healthWorker: info?.healthWorker,
    opinion: info?.workerOpinion,
    modelResult: info?.modelResult,
    group: info?.reviewCategory,
    reviewedOn: e.encounterDateTime,
    reviewedBy: e.lastModifiedBy,
  };
}

// A screening row opens the case page (tanuh-webapp#5); a booked review opens its review, as before. `subject` is the
// patient once read, which only the rows on screen are.
function pendingRowView(row: PendingRow, subject: SubjectApiResponse | null | undefined): RowView {
  const screening = row.screening;
  const obs = screening?.observations ?? {};
  const fromScreening = {
    subjectId: pendingRowSubjectId(row),
    caseId: (screening ? readObs<string>(obs, ENCOUNTER_ID_CONCEPT) : undefined) || screening?.["Subject external ID"],
    screeningDate: screening?.["Encounter date time"],
    healthWorker: screening?.audit?.["Created by"],
    opinion: screening?.workerOpinion,
    modelResult: screening ? readModelResult(obs) : undefined,
    group: row.group,
  };
  if (row.kind === "screening") {
    return {
      key: row.screening.ID,
      href: `/case/${row.screening.ID}`,
      village: subject?.location?.["Village"],
      ...fromScreening,
    };
  }
  return {
    key: row.review.encounterUuid,
    href: `/review/${row.review.encounterUuid}`,
    ...fromScreening,
    caseId: fromScreening.caseId || row.review.subject.externalId,
    village: row.review.subject.location?.["Village"] ?? subject?.location?.["Village"],
  };
}

// PE-249: a queue row. A screening row opens the case page and a booked review its review, as before; the case page
// decides what may be done there. `subject` is the patient of a screening row, read to place it.
function queueRowView(row: QueueRow, subject: SubjectApiResponse | undefined, viewer: string, now: Date): RowView {
  const screening = row.screening;
  const obs = screening?.observations ?? {};
  const fromScreening = {
    subjectId: queueRowSubjectId(row),
    caseId: (screening ? readObs<string>(obs, ENCOUNTER_ID_CONCEPT) : undefined) || screening?.["Subject external ID"],
    screeningDate: screening?.["Encounter date time"],
    healthWorker: screening?.audit?.["Created by"],
    opinion: screening?.workerOpinion,
    modelResult: screening ? readModelResult(obs) : undefined,
    ...listReason(rowReason(row), screening),
    // As rowHoldStatus, with when another physician took the case for the pill's tooltip.
    hold: holdDetail(row.stored, viewer, now),
  };
  if (row.kind === "screening") {
    return {
      key: row.screening.ID,
      href: `/case/${row.screening.ID}`,
      village: subject?.location?.["Village"],
      ...fromScreening,
    };
  }
  return {
    key: row.review.encounterUuid,
    href: `/review/${row.review.encounterUuid}`,
    ...fromScreening,
    caseId: fromScreening.caseId || row.review.subject.externalId,
    village: row.review.subject.location?.["Village"],
  };
}

function ReasonCell({ reason }: { reason: RowView["reason"] }) {
  if (!reason) return <Typography component="span" color="text.secondary">—</Typography>;
  if (reason === "OCSHR pending" || reason === "OCSHR not scored") return <OcshrPendingBadge label={reason} />;
  return <QueueGroupBadge value={reason} />;
}

export function EncounterList({ mode }: Props) {
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { state: auth } = useAuth();
  const viewer = auth.status === "ready" ? auth.user.username : "";
  // Usernames are shown without the organisation's suffix (PE-249).
  const usernameSuffix = auth.status === "ready" ? auth.user.usernameSuffix : undefined;

  // tanuh-webapp#4: the sort, filters, date range, Case ID search and page are kept for the session, per sign-in, so
  // they survive opening a case and coming back; sign-out clears them.
  const [state, setState] = useState<ListState>(() =>
    loadListState(window.sessionStorage, getEncounterCacheScope(), mode),
  );
  useEffect(() => saveListState(window.sessionStorage, getEncounterCacheScope(), mode, state), [mode, state]);
  const update = useCallback((patch: Partial<ListState>) => setState((s) => ({ ...s, ...patch })), []);
  const referralUuid = state.referral;
  const patientLocationUuid = state.loc;
  const riskOnly = mode === "completed" && state.riskOnly;
  const pageIndex = Math.max(0, state.page);
  const { from, to, search } = state;

  // Both tabs fetch ALL pages up front so sorting (pending: newest screening
  // first, ACROSS pages) and the display filters + counts (completed: High
  // Risk, date range) are correct over the whole list, not just one server
  // page; pagination then happens client-side.
  const filterParams = {
    encounterType: ENCOUNTER_TYPE.physicianReviewForm.name,
    // Linked-observation filter: only fires when a referral facility is picked.
    linkedEncounterType: referralUuid ? ENCOUNTER_TYPE.oralScreening.name : null,
    linkedObservationConceptUuid: referralUuid ? PLACE_OF_REFERRAL_CONCEPT.uuid : null,
    linkedLocationUuid: referralUuid,
  };
  // Bumped when the queue is read again after Review next case found nothing to take, so the list follows it.
  const [listVersion, setListVersion] = useState(0);
  // Standalone reviews come from the impl endpoint; reviews recorded inside a
  // program (Tanuh Staging's NCD) are built from the program API with the same
  // filters. An org without program visits adds nothing here.
  // PE-249: pending reviews are read in the chosen patient location, which is always one of the physician's places,
  // or else in each of their top places, so nothing outside them is listed. A failure to read their places fails the
  // load. The completed tab reads the same way, so its rows, total and High Risk count are theirs alone, with or
  // without the review queue switch.
  const { data: pageData, error } = useAsync(async () => {
    const catchment = await getCatchment();
    return readReviewsByPlace(placesToRead(catchment, patientLocationUuid), {
      ...filterParams,
      status: mode === "pending" ? "scheduled" : "completed",
    });
  }, [mode, referralUuid, patientLocationUuid, listVersion]);

  // tanuh-webapp#4: does the signed-in org have the high-risk model's values? Where it does, the pending tab adds the
  // screenings the model sent for review and both tabs show the model's columns; where it does not (Staging, production
  // before promotion), both tabs are as before. null while probing.
  const { data: modelOn, error: modelError } = useAsync(() => hasHighRiskModel(), [mode]);
  // PE-249 (D3): does the signed-in org have the review queue ("In review by")? Where it does, the pending tab is the
  // queue, and the high-risk model only adds its Worker's opinion and Model columns; where it does not, the pending tab
  // is as before, the model's screenings included. null while probing.
  const { data: queueOn, error: queueProbeError } = useAsync(
    () => (mode === "pending" ? hasReviewQueue() : Promise.resolve(false)),
    [mode],
  );
  const queueMode = mode === "pending" && queueOn === true;
  const pendingFromScreenings = mode === "pending" && queueOn === false && modelOn === true;

  // Review next case. Every press reads the queue again from the server; the viewer's own case is continued, else the
  // oldest waiting case of the group they have reviewed least is taken, moving on past any case someone else took
  // first. The button is never disabled for want of cases: the tab's light refresh shows takes, releases and lapsed
  // holds, but only a full read, which a press makes, finds new cases.
  const filtered = !!(patientLocationUuid || referralUuid);
  const [taking, setTaking] = useState(false);
  // A review page's Complete and review next case that saved the review but could not take the next case opens the list
  // saying so (PE-249).
  const location = useLocation();
  const [takeFailed, setTakeFailed] = useState(() => (location.state as { takeFailed?: boolean } | null)?.takeFailed === true);
  // Read once: the note is dropped from the page's history entry, so a reload does not show it again.
  useEffect(() => {
    if ((location.state as { takeFailed?: boolean } | null)?.takeFailed) {
      navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
    }
  }, [location, navigate]);
  // The cases the last press was refused, or failed, on. Until the next press reads the queue in full, the panel's
  // next-case line and Continue case leave them out, so a refresh does not offer a case a press would only be refused
  // on again. After a press that took nothing, that is every case it tried, so the line says nothing is waiting.
  const [passedOver, setPassedOver] = useState<ReadonlySet<string>>(() => new Set());

  // PE-249: the queue's own read, unfiltered by the list's choices (D7): what the tiles count and the button takes.
  // It refreshes itself while the tab is open, except during a press.
  const queue = usePendingQueue(queueMode, viewer, taking);
  const queueData = queue.data;
  const reloadQueue = queue.reload;
  // A press still running when the physician leaves the list must not navigate, or set state, afterwards (FW4).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const handleTake = useCallback(async () => {
    setTaking(true);
    setTakeFailed(false);
    setPassedOver(new Set());
    const passed = new Set<string>();
    try {
      const fresh = await reloadQueue();
      if (!mounted.current) return;
      // The case the viewer holds is taken again first, which renews the hold before its page opens (FW12).
      const reviewUuid = await takeNextCase(
        fresh.rows,
        fresh.reviewed,
        viewer,
        fresh.now,
        (row) => takeCase(row, viewer),
        fresh.held,
        passed,
      );
      if (!mounted.current) return;
      if (reviewUuid) {
        navigate(`/review/${reviewUuid}`);
        return;
      }
      // Nothing could be taken. The fresh read already shows on the tiles and in Reviewed today; when cases were tried
      // and refused, read again so they show who holds them, and the list follows.
      setPassedOver(passed);
      if (passed.size > 0) {
        await reloadQueue();
        // With a place or referral facility chosen the list narrows booked reviews by its own read, so it is read too.
        if (filtered && mounted.current) setListVersion((v) => v + 1);
      }
    } catch (err) {
      // The physician sees a plain message; the detail goes to the console (FW15).
      console.error("Review next case failed", err);
      if (mounted.current) {
        setPassedOver(passed);
        setTakeFailed(true);
      }
    } finally {
      if (mounted.current) setTaking(false);
    }
  }, [navigate, reloadQueue, viewer, filtered]);

  // The queue's rows the list shows: booked reviews narrowed by the filtered read above (chosen place, referral
  // facility), screening rows by their patient's place being the chosen place or one below it, and by the screening's
  // own place of referral, as the old list did. Worked out without a load, so a press that reads the queue again keeps
  // the list on screen; only the referral facility's place chain is read, once per choice.
  const { data: referral, error: referralError } = useAsync(
    async () => (queueMode && referralUuid ? { uuid: referralUuid, chain: await addressChain(referralUuid) } : null),
    [queueMode, referralUuid],
  );
  const queueListed = useMemo(() => {
    if (!queueMode || !queueData || !pageData) return null;
    if (referralUuid && referral?.uuid !== referralUuid) return null;
    const { catchment, subjects } = queueData;
    const place = chosenPlace(catchment, patientLocationUuid);
    return narrowQueueRows(queueData.rows, {
      bookedListed: place || referralUuid ? new Set(pageData.content.map((e) => e.encounterUuid)) : null,
      placesUnder: place ? catchment.placesUnder(place) : null,
      referralChain: referralUuid && referral ? referral.chain : null,
      subjects,
    });
  }, [queueMode, queueData, pageData, patientLocationUuid, referralUuid, referral]);

  // The pending rows: every booked review still waiting, with the screening that booked it, and every screening the
  // model sent for review that nobody has reviewed. Booked rows are narrowed by the server as before. Screening rows are
  // matched to the patient's location by a server lookup rather than a read per patient (a screening inside a program
  // still needs its patient read), and by the screening's own referral place here; one without a referral drops out
  // while that filter is set. `unchecked` holds the rows kept because their location could not be checked
  // (tanuh-webapp#4 review). The screenings come from the organisation-wide store, so first only those in the
  // physician's places are kept; one that cannot be placed is left out and counted in `unplaced` (FW5). The location
  // filter takes the chosen place only when it is one of the physician's, as the read above does.
  const { data: pending, error: rowsError } = useAsync(async () => {
    if (!pendingFromScreenings || !pageData) return null;
    const [catchment, screenings, reviews] = await Promise.all([
      getCatchment(),
      getCachedEncounters(ENCOUNTER_TYPE.oralScreening.name),
      getCachedEncounters(ENCOUNTER_TYPE.physicianReviewForm.name),
    ]);
    const all = selectPendingRows(pageData.content, screenings, reviews);
    const where = await placeScreenings(
      all.flatMap((r) => (r.kind === "screening" ? [r.screening] : [])),
      catchment,
    );
    let rows = all.filter((r) => r.kind === "booked" || where.placed.has(r.screening.ID));
    const unchecked = new Set<string>();
    const place = chosenPlace(catchment, patientLocationUuid);
    if (place) {
      const located = filterByPatientLocation(rows, await matchPatientLocation(rows, place));
      rows = located.rows;
      located.unchecked.forEach((key) => unchecked.add(key));
    }
    if (referralUuid) {
      const chain = await addressChain(referralUuid);
      rows = rows.filter(
        (r) => r.kind === "booked" || inSubtree(r.screening.observations?.[PLACE_OF_REFERRAL_CONCEPT.name], chain),
      );
    }
    return { rows, unchecked, unplaced: where.unplaced.size };
  }, [pendingFromScreenings, pageData]);

  // The patients of the rows on screen, read as those rows show and kept for the page's life; none for the rest of
  // the list. The pending tab used to read every pending patient before showing 50 (tanuh-webapp#4 review). A deleted
  // patient's rows leave the list once read; a failed read keeps its row, without the patient's details.
  const [subjects, setSubjects] = useState<ReadonlyMap<string, SubjectApiResponse | null>>(() => new Map());
  const pendingRows = useMemo(
    () => (pending ? withoutDeletedPatients(pending.rows, subjects) : null),
    [pending, subjects],
  );
  // A failed read is asked again when the list reloads, as it was when the whole list was read on every load.
  useEffect(() => {
    setSubjects((known) =>
      [...known.values()].includes(null) ? new Map([...known].filter(([, subject]) => subject !== null)) : known,
    );
  }, [pending]);

  // subjectUuid -> latest Oral Screening info (screening date, Case ID,
  // health worker) from ONE cached org-wide sweep — replaces the previous
  // request-per-subject-per-page fan-out. null while loading: rows render
  // with "—" placeholders until it lands.
  const { data: screeningInfo, error: screeningError } = useAsync(
    () => getLatestScreeningInfoBySubject(ENCOUNTER_TYPE.oralScreening.name),
    [mode],
  );

  // reviewUuid -> the specific screening that review covers, so a subject's
  // multiple reviews each show their OWN Case ID instead of all collapsing onto
  // the subject's latest screening. Falls back to `screeningInfo` (latest per
  // subject) for any review not resolved by the pairing.
  const { data: reviewPairing, error: pairingError } = useAsync(
    () =>
      getReviewScreeningPairing(
        ENCOUNTER_TYPE.physicianReviewForm.name,
        ENCOUNTER_TYPE.oralScreening.name,
      ),
    [mode],
  );

  // Which completed reviews are High Risk. The /api/impl rows carry no
  // observations, so this is resolved from /api/encounters — filtered
  // server-side via the stock `concepts` observation filter and cached.
  // null while loading (or on failure): the toggle stays disabled and the
  // count shows "…" instead of silently rendering unfiltered rows.
  const { data: highRiskUuids } = useAsync<Set<string> | null>(
    () =>
      mode === "completed"
        ? findCompletedEncounterUuidsWithCodedValue(
            ENCOUNTER_TYPE.physicianReviewForm.name,
            REVIEW_CONCEPTS.highLowRisk,
            RISK.high,
          )
        : Promise.resolve(null),
    [mode],
  );

  // The screening a given review row should be labelled by: its paired
  // screening, falling back to the subject's latest. Undefined until the
  // pairing sweep lands (rows render "—" rather than a wrong latest value).
  const infoFor = useCallback(
    (e: EncounterWithLocation) =>
      reviewPairing ? (reviewPairing[e.encounterUuid] ?? screeningInfo?.[e.subject.uuid]) : undefined,
    [reviewPairing, screeningInfo],
  );

  // PE-249: in the queue, sorting by opinion is offered only where the Worker's opinion column shows; a stored
  // "By opinion" then reads as By group.
  const sorts = queueMode && modelOn !== true ? SORTS.filter((s) => s.value !== "opinion") : SORTS;
  const sort: PendingSort = sorts.some((s) => s.value === state.sort) ? state.sort : "group";

  const views = useMemo<RowView[] | null>(() => {
    if (modelOn === null) return null;
    if (mode === "pending" && queueOn === null) return null;

    // Case ID search — applied to both tabs. Matches the Case ID actually shown
    // in the row (Encounter ID, falling back to legacy Case ID / external ID).
    // Sequence numbers are zero-padded (P0102ORA006) but clinicians type them
    // unpadded, and pre-v4 encounters carry genuinely unpadded ids, so both the
    // query and the candidate are canonicalised to an unpadded suffix first.
    // Only digits following a 3-letter type code are unpadded — the leading
    // zeros of the Patient ID itself (P0102) are significant.
    const unpad = (id: string) => id.toLowerCase().replace(/([a-z]{3})0*(\d+)$/, "$1$2");
    const query = unpad(search.trim());
    const matchesSearch = (v: RowView) => !query || unpad(v.caseId || "").includes(query);

    if (queueMode) {
      if (!queueListed || !queueData) return null;
      return filterQueueRows(sortQueueRows(queueListed, sort), state.queueGroup)
        .map((row) => queueRowView(row, queueData.subjects.get(queueRowSubjectId(row)), viewer, queueData.now))
        .filter(matchesSearch);
    }
    if (pendingFromScreenings) {
      if (!pendingRows) return null;
      return filterPendingRows(sortPendingRows(pendingRows, state.sort), state.group)
        .map((row) => pendingRowView(row, subjects.get(pendingRowSubjectId(row))))
        .filter(matchesSearch);
    }
    if (!pageData) return null;
    if (mode !== "completed") {
      // Pending: show the most recently screened patient first — across the
      // WHOLE list (all pages were fetched). Rows whose screening date hasn't
      // loaded yet (or is missing) sort to the bottom.
      return [...pageData.content]
        .sort((a, b) => (infoFor(b)?.screeningDate || "").localeCompare(infoFor(a)?.screeningDate || ""))
        .map((e) => reviewRowView(e, infoFor(e)))
        .filter(matchesSearch);
    }
    let rows = pageData.content;
    if (riskOnly && highRiskUuids) {
      rows = rows.filter((e) => highRiskUuids.has(e.encounterUuid));
    }
    const fromDate = from ? parseISO(from) : null;
    // Inclusive of the To day: a bare date parses to midnight, which would
    // silently drop everything reviewed ON that day.
    const toDate = to ? endOfDay(parseISO(to)) : null;
    return rows
      .filter((e) => {
        if (!fromDate && !toDate) return true;
        if (!e.encounterDateTime) return false;
        const d = parseISO(e.encounterDateTime);
        if (fromDate && d < fromDate) return false;
        if (toDate && d > toDate) return false;
        return true;
      })
      .map((e) => reviewRowView(e, infoFor(e)))
      .filter(matchesSearch);
  }, [
    modelOn,
    queueOn,
    queueMode,
    queueListed,
    queueData,
    viewer,
    sort,
    state.queueGroup,
    pendingFromScreenings,
    pendingRows,
    subjects,
    pageData,
    mode,
    state.sort,
    state.group,
    from,
    to,
    search,
    infoFor,
    riskOnly,
    highRiskUuids,
  ]);

  // Both tabs paginate client-side over the (sorted, filtered) full fetch.
  // Clamp the page so a filter that shrinks the list can't strand the user on
  // an out-of-range page.
  const totalRows = views?.length ?? 0;
  const effectivePageIndex = Math.min(
    pageIndex,
    Math.max(0, Math.ceil(totalRows / PAGE_SIZE) - 1),
  );
  const visibleRows = useMemo(
    () => (views ? rowsOnPage(views, effectivePageIndex, PAGE_SIZE) : []),
    [views, effectivePageIndex],
  );
  const unreadKey = pendingFromScreenings ? patientsToRead(visibleRows, subjects).join(",") : "";
  useEffect(() => {
    if (!unreadKey) return;
    let cancelled = false;
    void readSubjects(unreadKey.split(",")).then((read) => {
      if (!cancelled) setSubjects((known) => new Map([...known, ...read]));
    });
    return () => {
      cancelled = true;
    };
  }, [unreadKey]);

  const loadError =
    error ?? pairingError ?? screeningError ?? modelError ?? rowsError ?? queueProbeError ?? queue.error ?? referralError;
  if (loadError) return <Box sx={{ p: 3, color: "error.main" }}>Failed to load: {loadError}</Box>;
  if (!pageData || !views)
    return (
      <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Stack spacing={1.5}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} variant="rounded" height={isMobile ? 96 : 48} />
          ))}
        </Stack>
      </Box>
    );

  // The headline count: every row the location/referral filters allow, before the display filters (group, High Risk,
  // date range, search). On the pending tab with the model, a deleted patient's rows leave it once they have been on
  // screen, since only those patients are read.
  const listedCount = pendingFromScreenings ? (pendingRows?.length ?? 0) : pageData.totalElements;
  // The case the viewer holds, by the Case ID the list shows for it.
  // The next group and the case to continue, without the cases the last press passed over.
  const shown =
    queueMode && queueData ? nextAndHeld(queueData.rows, queueData.reviewed, passedOver, viewer, queueData.now) : null;
  const held = shown?.held;
  const heldView =
    held && queueData ? queueRowView(held, queueData.subjects.get(queueRowSubjectId(held)), viewer, queueData.now) : null;
  // The listed rows whose location, within the physician's places, could not be checked against the chosen patient
  // location, counted where they are still listed: after the referral filter, and without a deleted patient's rows.
  const uncheckedCount =
    !queueMode && pendingFromScreenings && pending && pendingRows
      ? pendingRows.filter((r) => pending.unchecked.has(pendingRowKey(r))).length
      : 0;
  // The cases left out because they could not be placed in the physician's places, or their patient could not be
  // read: the queue's, a programme review's on either tab (FW6), a screening's on the pending tab without the queue
  // (FW5).
  const unreadCount = queueMode
    ? (queueData?.unread ?? 0)
    : pageData.unread + (pendingFromScreenings ? (pending?.unplaced ?? 0) : 0);
  // High Risk count over every row the current location/referral filters allow —
  // deliberately not narrowed by the date or High Risk display filters.
  const highRiskCount =
    mode === "completed" && highRiskUuids
      ? pageData.content.filter((e) => highRiskUuids.has(e.encounterUuid)).length
      : null;

  // The model's three columns show wherever the org has the model; without it the v1.12.2 columns apply unchanged.
  // PE-249: in the queue the old Group column gives way to Reason and Status, and the row button only views.
  const showModel = modelOn === true;
  const showGroup = showModel && !queueMode;
  const viewOnly = mode === "completed" || queueMode;
  // PE-249: the queue and the completed list name a health worker without the organisation's suffix.
  const shortHealthWorker = queueMode || mode === "completed";

  const handleRiskOnlyChange = (checked: boolean) => update({ riskOnly: checked, page: 0 });
  const handleReferralChange = (uuid: string | null) => update({ referral: uuid, page: 0 });
  const handlePatientLocationChange = (uuid: string | null) => update({ loc: uuid, page: 0 });
  // Narrowing the list can leave the user on an out-of-range page; jump back to the first page of results.
  const handleSearchChange = (value: string) => update({ search: value, page: 0 });

  return (
    <Box>
      <Stack
        direction="column"
        spacing={1.5}
        sx={{ p: { xs: 1.5, sm: 2 }, borderBottom: "1px solid #e5e7eb" }}
      >
        {queueMode && queueData && (
          <NextCasePanel
            reviewed={queueData.reviewed}
            next={shown ? shown.next : null}
            held={heldView ? { caseId: heldView.caseId ?? null } : null}
            busy={taking}
            failed={takeFailed}
            onTake={() => void handleTake()}
          />
        )}
        {/* KPI row. Totals = all rows across all pages — display filters (group,
            High Risk, date range, search) narrow the rows below, not these numbers.
            PE-249: the queue's tiles count every waiting case in the physician's places, whatever the filters (D7). */}
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", rowGap: 1.5 }}>
          {queueMode && queueData ? (
            <>
              <StatTile testId="stat-waiting" label="Waiting for review" value={queueData.waiting.total} />
              {QUEUE_GROUPS.map((group) => (
                <StatTile
                  key={group}
                  testId={`stat-${group.toLowerCase().replace(/\s+/g, "-")}`}
                  label={<QueueGroupBadge value={group} />}
                  value={queueData.waiting[group]}
                />
              ))}
            </>
          ) : (
            <StatTile
              testId="stat-total"
              label={mode === "pending" ? "Pending reviews" : "Completed reviews"}
              value={listedCount}
            />
          )}
          {mode === "completed" && (
            <StatTile testId="stat-high-risk" label="High risk" value={highRiskCount ?? "…"} />
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
        <Stack
          direction={{ xs: "column", sm: "row" }}
          alignItems={{ xs: "stretch", sm: "center" }}
          spacing={{ xs: 1, sm: 2 }}
        >
          <Typography
            variant="body1"
            sx={{ minWidth: { xs: 0, sm: 140 }, fontWeight: 600, color: "text.primary" }}
          >
            Case ID
          </Typography>
          <TextField
            size="small"
            placeholder="Search by Case ID"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            sx={{ width: { xs: "100%", sm: 280 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
              endAdornment: search ? (
                <InputAdornment position="end">
                  <IconButton
                    aria-label="Clear search"
                    size="small"
                    edge="end"
                    onClick={() => handleSearchChange("")}
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : null,
            }}
          />
        </Stack>
        {(pendingFromScreenings || queueMode) && (
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
                Group
              </Typography>
              {queueMode ? (
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={state.queueGroup}
                  onChange={(_, v: QueueGroupFilter | null) => {
                    if (v) update({ queueGroup: v, page: 0 });
                  }}
                  sx={{ flexWrap: "wrap" }}
                >
                  {QUEUE_GROUP_FILTERS.map((g) => (
                    <ToggleButton key={g.value} value={g.value} sx={{ px: 1.5, textTransform: "none", fontWeight: 600 }}>
                      {g.label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              ) : (
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={state.group}
                  onChange={(_, v: GroupFilter | null) => {
                    if (v) update({ group: v, page: 0 });
                  }}
                  sx={{ flexWrap: "wrap" }}
                >
                  {GROUP_FILTERS.map((g) => (
                    <ToggleButton key={g.value} value={g.value} sx={{ px: 1.5, textTransform: "none", fontWeight: 600 }}>
                      {g.label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              )}
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
                Sort
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={sort}
                onChange={(_, v: PendingSort | null) => {
                  if (v) update({ sort: v, page: 0 });
                }}
              >
                {sorts.map((s) => (
                  <ToggleButton key={s.value} value={s.value} sx={{ px: 2, textTransform: "none", fontWeight: 600 }}>
                    {s.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Stack>
          </>
        )}
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
                <ToggleButton value="high" sx={{ px: 2, textTransform: "none", fontWeight: 600 }}>
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
                  onChange={(e) => update({ from: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                  sx={{ flex: { xs: 1, sm: "0 1 auto" } }}
                />
                <TextField
                  label="To"
                  type="date"
                  size="small"
                  value={to}
                  onChange={(e) => update({ to: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                  sx={{ flex: { xs: 1, sm: "0 1 auto" } }}
                />
              </Stack>
            </Stack>
          </>
        )}
      </Stack>

      {/* PE-249: a case that cannot be placed is left out, and the list says so. */}
      {unreadCount > 0 && (
        <Alert severity="warning" data-testid="cases-unread" sx={{ m: { xs: 1.5, sm: 2 }, mb: 0 }}>
          {unreadCount === 1
            ? "1 case could not be loaded and is not shown."
            : `${unreadCount} cases could not be loaded and are not shown.`}
        </Alert>
      )}

      {/* The location could not be checked for these cases, so they stay rather than vanish (tanuh-webapp#4 review). */}
      {uncheckedCount > 0 && (
        <Alert severity="warning" data-testid="location-unchecked" sx={{ m: { xs: 1.5, sm: 2 }, mb: 0 }}>
          {uncheckedCount === 1
            ? "1 case could not be checked against the patient location, so it is listed anyway."
            : `${uncheckedCount} cases could not be checked against the patient location, so they are listed anyway.`}
        </Alert>
      )}

      {views.length === 0 ? (
        <Typography color="text.secondary" sx={{ p: 4, textAlign: "center" }}>
          {search.trim() ? (
            <>No {mode === "pending" ? "pending" : "completed"} reviews match Case ID “{search.trim()}”.</>
          ) : (
            <>
              No {riskOnly ? "High Risk " : ""}
              {mode === "pending" ? "pending" : "completed"} reviews
              {referralUuid ? " for the selected referral facility." : "."}
            </>
          )}
        </Typography>
      ) : (
        <>
          {isMobile ? (
            <Stack spacing={1.5} sx={{ p: 1.5 }}>
              {visibleRows.map((v: RowView, index: number) => {
                const serialNumber = effectivePageIndex * PAGE_SIZE + index + 1;
                return (
                  <Paper
                    key={v.key}
                    variant="outlined"
                    onClick={() => navigate(v.href)}
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
                          startIcon={viewOnly ? <VisibilityIcon /> : <RateReviewIcon />}
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(v.href);
                          }}
                          sx={{ flexShrink: 0 }}
                        >
                          {viewOnly ? "View" : "Review"}
                        </Button>
                      </Stack>
                      <Typography variant="body2" sx={{ color: "text.primary" }}>
                        <Box component="span" sx={{ color: "text.secondary", fontWeight: 500 }}>
                          Case ID:{" "}
                        </Box>
                        {v.caseId || "—"}
                      </Typography>
                      <Typography variant="body2" sx={{ color: "text.primary" }}>
                        <Box component="span" sx={{ color: "text.secondary", fontWeight: 500 }}>
                          Screening date:{" "}
                        </Box>
                        {v.screeningDate ? format(parseISO(v.screeningDate), "dd MMM yyyy, h:mm a") : "—"}
                      </Typography>
                      <Typography variant="body2" sx={{ color: "text.primary" }}>
                        <Box component="span" sx={{ color: "text.secondary", fontWeight: 500 }}>
                          Village:{" "}
                        </Box>
                        {v.village || "—"}
                      </Typography>
                      <Typography variant="body2" sx={{ color: "text.primary" }}>
                        <Box component="span" sx={{ color: "text.secondary", fontWeight: 500 }}>
                          Health worker:{" "}
                        </Box>
                        {v.healthWorker || "—"}
                      </Typography>
                      {showModel && (
                        <Typography variant="body2" sx={{ color: "text.primary" }}>
                          <Box component="span" sx={{ color: "text.secondary", fontWeight: 500 }}>
                            Worker's opinion:{" "}
                          </Box>
                          {v.opinion || "—"}
                        </Typography>
                      )}
                      {/* A badge is a span, not text — its own row keeps the markup valid. */}
                      {showModel && (
                        <Stack direction="row" alignItems="center" spacing={0.75}>
                          <Typography variant="body2" sx={{ color: "text.secondary", fontWeight: 500 }}>
                            Model:
                          </Typography>
                          <ModelResultBadge value={v.modelResult} />
                        </Stack>
                      )}
                      {showGroup && (
                        <Stack direction="row" alignItems="center" spacing={0.75}>
                          <Typography variant="body2" sx={{ color: "text.secondary", fontWeight: 500 }}>
                            Group:
                          </Typography>
                          <CategoryBadge value={v.group} />
                        </Stack>
                      )}
                      {queueMode && (
                        <Stack direction="row" alignItems="center" spacing={0.75}>
                          <Typography variant="body2" sx={{ color: "text.secondary", fontWeight: 500 }}>
                            Reason:
                          </Typography>
                          <Typography component="span" variant="body2" sx={{ color: "text.primary" }}>
                            <ReasonCell reason={v.reason} />
                          </Typography>
                        </Stack>
                      )}
                      {queueMode && v.hold && (
                        <Stack direction="row" alignItems="center" spacing={0.75}>
                          <Typography variant="body2" sx={{ color: "text.secondary", fontWeight: 500 }}>
                            Status:
                          </Typography>
                          <HoldStatusBadge
                            status={v.hold}
                            usernameSuffix={usernameSuffix}
                            waitingFor={v.waitingFor}
                          />
                        </Stack>
                      )}
                      {mode === "completed" && (
                        <Typography variant="body2" sx={{ color: "text.primary" }}>
                          <Box component="span" sx={{ color: "text.secondary", fontWeight: 500 }}>
                            Reviewed on:{" "}
                          </Box>
                          {v.reviewedOn ? format(parseISO(v.reviewedOn), "dd MMM yyyy") : "—"}
                        </Typography>
                      )}
                      {mode === "completed" && (
                        <Typography variant="body2" sx={{ color: "text.primary" }}>
                          <Box component="span" sx={{ color: "text.secondary", fontWeight: 500 }}>
                            Reviewed by:{" "}
                          </Box>
                          {v.reviewedBy || "—"}
                        </Typography>
                      )}
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          ) : (
            // Columns take the width their content needs and cells do not wrap; a window too narrow for the table
            // scrolls it sideways instead of squashing the columns.
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small" sx={{ tableLayout: "auto", "& .MuiTableCell-root": { px: 2, py: 1.25 } }}>
                <TableHead>
                  <TableRow
                    sx={{
                      "& th": {
                        fontWeight: 700,
                        color: "text.primary",
                        fontSize: "0.95rem",
                        backgroundColor: "grey.100",
                        whiteSpace: "nowrap",
                      },
                    }}
                  >
                    <TableCell>S.No</TableCell>
                    <TableCell>Case ID</TableCell>
                    <TableCell>Screening date</TableCell>
                    <TableCell>Village</TableCell>
                    <TableCell>Health worker</TableCell>
                    {showModel && <TableCell>Worker's opinion</TableCell>}
                    {showModel && <TableCell>Model</TableCell>}
                    {showGroup && <TableCell>Group</TableCell>}
                    {queueMode && <TableCell>Reason</TableCell>}
                    {queueMode && <TableCell>Status</TableCell>}
                    {mode === "completed" && <TableCell>Reviewed on</TableCell>}
                    {mode === "completed" && <TableCell>Reviewed by</TableCell>}
                    <TableCell aria-hidden />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visibleRows.map((v: RowView, index: number) => {
                    const serialNumber = effectivePageIndex * PAGE_SIZE + index + 1;
                    return (
                      <TableRow
                        key={v.key}
                        hover
                        onClick={() => navigate(v.href)}
                        sx={{ cursor: "pointer" }}
                      >
                        <TableCell sx={{ color: "text.secondary" }}>{serialNumber}</TableCell>
                        <TableCell sx={{ color: "text.primary", whiteSpace: "nowrap" }}>{v.caseId || "—"}</TableCell>
                        <TableCell sx={{ color: "text.primary", whiteSpace: "nowrap" }}>
                          {v.screeningDate ? format(parseISO(v.screeningDate), "dd MMM yyyy, h:mm a") : "—"}
                        </TableCell>
                        <TableCell sx={{ color: "text.primary", whiteSpace: "nowrap" }}>
                          {v.village || "—"}
                        </TableCell>
                        <TableCell
                          sx={{ color: "text.primary", whiteSpace: "nowrap" }}
                          title={shortHealthWorker && v.healthWorker ? v.healthWorker : undefined}
                        >
                          {v.healthWorker
                            ? shortHealthWorker
                              ? shortUsername(v.healthWorker, usernameSuffix)
                              : v.healthWorker
                            : "—"}
                        </TableCell>
                        {showModel && <TableCell sx={{ color: "text.primary" }}>{v.opinion || "—"}</TableCell>}
                        {showModel && (
                          <TableCell sx={{ whiteSpace: "nowrap" }}>
                            <ModelResultBadge value={v.modelResult} />
                          </TableCell>
                        )}
                        {showGroup && (
                          <TableCell sx={{ whiteSpace: "nowrap" }}>
                            <CategoryBadge value={v.group} />
                          </TableCell>
                        )}
                        {queueMode && (
                          <TableCell sx={{ color: "text.primary", whiteSpace: "nowrap" }}>
                            <ReasonCell reason={v.reason} />
                          </TableCell>
                        )}
                        {queueMode && (
                          <TableCell sx={{ whiteSpace: "nowrap" }}>
                            {v.hold && (
                              <HoldStatusBadge
                                status={v.hold}
                                usernameSuffix={usernameSuffix}
                                waitingFor={v.waitingFor}
                              />
                            )}
                          </TableCell>
                        )}
                        {mode === "completed" && (
                          <TableCell sx={{ color: "text.primary" }}>
                            {v.reviewedOn ? format(parseISO(v.reviewedOn), "dd MMM yyyy") : "—"}
                          </TableCell>
                        )}
                        {mode === "completed" && (
                          <TableCell sx={{ color: "text.primary" }}>{v.reviewedBy || "—"}</TableCell>
                        )}
                        <TableCell>
                          <Button
                            size="small"
                            startIcon={viewOnly ? <VisibilityIcon /> : <RateReviewIcon />}
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(v.href);
                            }}
                          >
                            {viewOnly ? "View" : "Review"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          )}
          {totalRows > PAGE_SIZE && (
            <TablePagination
              component="div"
              count={totalRows}
              page={effectivePageIndex}
              rowsPerPage={PAGE_SIZE}
              rowsPerPageOptions={[PAGE_SIZE]}
              onPageChange={(_, next) => update({ page: next })}
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
