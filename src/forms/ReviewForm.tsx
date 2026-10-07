import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  FormHelperText,
  Grid,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { addDays, differenceInYears, format, parseISO } from "date-fns";
import { useNavigate } from "react-router-dom";
import {
  computeNextEncounterId,
  getEncounter,
  invalidateEncounterSweeps,
  isCompleted,
  isProgramEncounter,
  isScheduled,
  listVisitsFor,
  pairReviewsToScreenings,
  scheduleEncounter,
  submitEncounter,
} from "@/api/encounters";
import { getSubject } from "@/api/subjects";
import { decideCaseRoute } from "@/api/caseRoute";
import { getConcept, hasHighRiskModel, hasScreeningQualityGate, type ConceptAnswer } from "@/api/concepts";
import { buildCreatedReviewBody, decideCreate, findReviewCreatedFrom } from "@/api/reviewCreate";
import type { EncounterApiResponse, SubjectApiResponse } from "@/api/types";
import {
  ENCOUNTER_TYPE,
  ENCOUNTER_ID_CONCEPT,
  HABIT_CONCEPTS,
  MODEL_AGREEMENT_CONCEPT,
  PATIENT_ID_CONCEPT,
  SYMPTOMS_CONCEPT,
  isLegacyOralScreening,
  QUALITY_VALUES,
  REVIEW_CONCEPTS,
  REVIEWED_ORAL_SCREENING_CONCEPT,
  REVIEW_CATEGORY_VALUES,
  REVIEW_IMAGE_GROUP,
  REVIEW_IMAGE_GROUP_CHILD,
  VERDICT_VALUES,
  VISUAL_EXAM_CONCEPTS,
  deriveWorkerOpinion,
  readDataQuality,
  readModelResult,
  readModelRunTime,
  readModelVersion,
  readObs,
  readReviewCategory,
} from "@/constants/tanuhConcepts";
import { CategoryBadge, DataQualityBadge, ModelResultBadge } from "@/components/StatusBadge";
import { computeAgreement } from "./agreement";
import {
  collectPhotos,
  deriveClassification,
  emptyForm,
  isLimitedMouthAutoReview,
  prefillFromCompleted,
  type FormState,
  type ReviewPhoto,
} from "./reviewPhotos";
import {
  classificationOf,
  LIMITED_MOUTH_REVIEW,
  lookupDiagnosis,
  NON_HOMOGENEOUS_LEUKOPLAKIA,
  RISK,
} from "./diagnosisMapping";
import { MediaImg } from "@/components/MediaImg";
import { useAsync } from "@/hooks/useAsync";

// One of the two: a review's page (/review/:encounterUuid) or a screening's (/case/:screeningUuid, tanuh-webapp#5).
interface Props {
  encounterUuid?: string;
  screeningUuid?: string;
  onBack?: () => void;
}

interface LoadedState {
  // Absent on a screening's page until a review exists: its submit creates one.
  review?: EncounterApiResponse;
  // The patient's reviews, as loaded.
  reviews: EncounterApiResponse[];
  // Set when a screening's page belongs to a booked review: the page moves there.
  redirect?: string;
  screening: EncounterApiResponse;
  subject: SubjectApiResponse;
  physicianVerdictAnswers: ConceptAnswer[];
  provisionalDiagnosisAnswers: ConceptAnswer[];
  subTypeAnswers: ConceptAnswer[];
}


// Schedules the High Risk Referral visit unless the subject already has one
// open — re-reviews and double-submits must not pile up duplicate visits.
// Window: due immediately, overdue after 7 days (the scoping doc's follow-up
// convention; the sheet itself doesn't specify dates). A review recorded inside
// a program schedules it in the same enrolment, so it lands under that program
// on the phone.
async function ensureHighRiskFollowUp(review: EncounterApiResponse): Promise<void> {
  const existing = await listVisitsFor(review, ENCOUNTER_TYPE.highRiskFollowUp.name);
  if (existing.some(isScheduled)) return;
  const now = new Date();
  await scheduleEncounter({
    encounterType: ENCOUNTER_TYPE.highRiskFollowUp,
    subjectId: review["Subject ID"],
    enrolmentId: review["Enrolment ID"],
    earliestVisitDateTime: now.toISOString(),
    maxVisitDateTime: addDays(now, 7).toISOString(),
  });
}

// Schedules the Referral Slip so it lands under Visits Planned on the patient
// dashboard. Same shape and window as the High Risk Referral above; the guard
// keeps re-reviews and double-submits from stacking up slips, and the encounter
// type's eligibility rule suppresses the unplanned entry while one is pending.
async function ensureReferralSlip(review: EncounterApiResponse): Promise<void> {
  const existing = await listVisitsFor(review, ENCOUNTER_TYPE.referralSlip.name);
  if (existing.some(isScheduled)) return;
  const now = new Date();
  await scheduleEncounter({
    encounterType: ENCOUNTER_TYPE.referralSlip,
    subjectId: review["Subject ID"],
    enrolmentId: review["Enrolment ID"],
    earliestVisitDateTime: now.toISOString(),
    maxVisitDateTime: addDays(now, 7).toISOString(),
  });
}

async function loadReview(encounterUuid: string): Promise<LoadedState> {
  const review = await getEncounter(encounterUuid);
  const subjectId = review["Subject ID"];
  // A standalone review pairs with the subject's standalone screenings; a review
  // recorded inside a program with the screenings of its own enrolment.
  const [subject, screenings, reviews, verdictConcept, diagnosisConcept, subTypeConcept] =
    await Promise.all([
      getSubject(subjectId),
      listVisitsFor(review, ENCOUNTER_TYPE.oralScreening.name),
      listVisitsFor(review, ENCOUNTER_TYPE.physicianReviewForm.name),
      getConcept(REVIEW_IMAGE_GROUP_CHILD.physicianVerdict.uuid),
      getConcept(REVIEW_CONCEPTS.provisionalDiagnosis.uuid),
      getConcept(REVIEW_CONCEPTS.provisionalSubType.uuid),
    ]);
  // Load the specific screening THIS review covers (its stamped source, or the
  // created-order paired one), not just the subject's latest — otherwise a
  // multi-screening subject's reviews would all bind to the newest screening.
  const paired = pairReviewsToScreenings(reviews, screenings);
  const screening =
    paired.get(review.ID) ??
    screenings
      .filter((e) => !e.Voided && e["Encounter date time"] != null)
      .sort((a, b) => (b["Encounter date time"] || "").localeCompare(a["Encounter date time"] || ""))[0];
  if (!screening) throw new Error("No completed Oral Screening encounter for this subject");
  return {
    review,
    reviews,
    screening,
    subject,
    physicianVerdictAnswers: verdictConcept.answers,
    provisionalDiagnosisAnswers: diagnosisConcept.answers,
    subTypeAnswers: subTypeConcept.answers,
  };
}

// tanuh-webapp#5: a screening's page. A booked review takes it to that review's page (drafts are keyed by the route,
// so one case reachable from two routes would get two drafts); a reviewed screening opens read-only on its review;
// any other screening opens without a review, and its submit creates one.
async function loadCase(screeningUuid: string): Promise<LoadedState> {
  const screening = await getEncounter(screeningUuid);
  const [subject, reviews, screenings, verdictConcept, diagnosisConcept, subTypeConcept] = await Promise.all([
    getSubject(screening["Subject ID"]),
    listVisitsFor(screening, ENCOUNTER_TYPE.physicianReviewForm.name),
    listVisitsFor(screening, ENCOUNTER_TYPE.oralScreening.name),
    getConcept(REVIEW_IMAGE_GROUP_CHILD.physicianVerdict.uuid),
    getConcept(REVIEW_CONCEPTS.provisionalDiagnosis.uuid),
    getConcept(REVIEW_CONCEPTS.provisionalSubType.uuid),
  ]);
  const route = decideCaseRoute(screening, reviews, screenings);
  return {
    review: route.kind === "reviewed" ? route.review : undefined,
    redirect: route.kind === "booked" ? route.reviewUuid : undefined,
    reviews,
    screening,
    subject,
    physicianVerdictAnswers: verdictConcept.answers,
    provisionalDiagnosisAnswers: diagnosisConcept.answers,
    subTypeAnswers: subTypeConcept.answers,
  };
}

export function ReviewForm({ encounterUuid, screeningUuid, onBack }: Props) {
  const { data: loaded, error: loadError } = useAsync(
    () => (screeningUuid ? loadCase(screeningUuid) : loadReview(encounterUuid ?? "")),
    [encounterUuid, screeningUuid],
  );
  // PE-96: the Data Quality card exists only for an org that carries the concept.
  const { data: qualityGate } = useAsync(() => hasScreeningQualityGate(), []);
  // tanuh-webapp#5: the model's panel exists only for an org with the high-risk model. A failed probe hides the panel
  // and nothing else; the agreement below is decided from the screening's own model result.
  const { data: modelOn } = useAsync(() => hasHighRiskModel(), []);
  // In-progress form state is persisted to sessionStorage keyed by the
  // encounter uuid so it survives HMR, accidental refreshes, and tab
  // switches mid-review. Cleared on successful submit.
  const storageKey = screeningUuid ? `review-form:case:${screeningUuid}` : `review-form:${encounterUuid}`;
  const [form, setForm] = useState<FormState | null>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as FormState) : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (form === null) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(form));
    } catch {
      // sessionStorage may be disabled (incognito quota) or full — degrade silently.
    }
  }, [form, storageKey]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (loaded?.redirect) navigate(`/review/${loaded.redirect}`, { replace: true });
  }, [loaded, navigate]);

  // A completed review always renders from its STORED observations — an
  // in-progress draft left in sessionStorage (e.g. someone else completed the
  // review first) is stale and must not shadow the recorded answers.
  const prefilled = useMemo(
    () => (loaded?.review && isCompleted(loaded.review) ? prefillFromCompleted(loaded.review) : null),
    [loaded],
  );
  const effectiveForm = prefilled ?? form ?? emptyForm;
  useEffect(() => {
    if (!prefilled) return;
    setForm(null);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // storage may be disabled — nothing to clean up.
    }
  }, [prefilled, storageKey]);

  const photos = useMemo<ReviewPhoto[]>(
    () => (loaded ? collectPhotos(loaded.screening.observations as Record<string, unknown>) : []),
    [loaded],
  );
  const presentPhotos = useMemo<number[]>(() => photos.map((p) => p.slot), [photos]);

  if (loadError) return <Alert severity="error">{loadError}</Alert>;
  if (!loaded || loaded.redirect)
    return (
      <Box sx={{ p: 4, display: "flex", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );

  // Legacy flat-layout screenings are not supported for review: render their data
  // but disable all inputs and the Complete button (same plumbing as completed).
  const isLegacy = isLegacyOralScreening(loaded.screening.observations as Record<string, unknown>);
  // Limited mouth opening: the worker may still photograph what is visible
  // (PE-126). Without photos the review rests on the visual-exam findings and
  // takes the spec's fixed values; with photos it is an ordinary photo review.
  // mouthNotOpen alone only decides what is shown (visual-exam card, the
  // no-images notice); limitedMouthFixed decides the fixed values.
  const mouthNotOpen =
    (loaded.screening.observations as Record<string, unknown>)[
      VISUAL_EXAM_CONCEPTS.ableToOpenMouth.name
    ] === "No";
  const limitedMouthFixed = isLimitedMouthAutoReview(
    loaded.screening.observations as Record<string, unknown>,
    presentPhotos.length,
  );
  const completed = !!loaded.review && isCompleted(loaded.review);
  const readOnly = completed || isLegacy;
  // A completed review shows what was RECORDED. Re-deriving from the current
  // diagnosisMapping would silently rewrite how past reviews read whenever the
  // mapping table changes (it already changed once — the OSMF row).
  const storedObs = (loaded.review?.observations ?? {}) as Record<string, unknown>;
  const storedClassification = completed ? readObs<string>(storedObs, REVIEW_CONCEPTS.classification) : undefined;
  const storedRisk = completed ? (storedObs[REVIEW_CONCEPTS.highLowRisk.name] as string | undefined) : undefined;
  const storedAction = completed ? (storedObs[REVIEW_CONCEPTS.recommendedAction.name] as string | undefined) : undefined;
  // Limited mouth opening: the whole Diagnosis section is pre-populated with
  // the spec's fixed values — the clinician only writes Notes.
  const classification = completed
    ? (storedClassification ?? "")
    : limitedMouthFixed
      ? LIMITED_MOUTH_REVIEW.classification
      : deriveClassification(presentPhotos, effectiveForm.photoVerdicts, effectiveForm.photoQuality);
  const mapping = lookupDiagnosis(effectiveForm.provisionalDiagnosis, effectiveForm.provisionalSubType);
  const needsSubType = effectiveForm.provisionalDiagnosis === NON_HOMOGENEOUS_LEUKOPLAKIA;
  const updateForm = (next: FormState) => setForm(next);

  // Risk/action display: "—" while nothing is resolvable yet (no diagnosis, or
  // sub-type still pending); "Not applicable" for diagnoses the mapping table
  // deliberately maps to nothing (Oral submucosal fibrosis) — a bare dash there
  // reads like a bug to physicians.
  const derivationPending =
    !limitedMouthFixed &&
    (!effectiveForm.provisionalDiagnosis || (needsSubType && !effectiveForm.provisionalSubType));
  const riskDisplay = completed
    ? (storedRisk ?? "—")
    : limitedMouthFixed
      ? LIMITED_MOUTH_REVIEW.risk
      : derivationPending
        ? "—"
        : (mapping?.risk ?? "Not applicable");
  const actionDisplay = completed
    ? (storedAction ?? "—")
    : limitedMouthFixed
      ? LIMITED_MOUTH_REVIEW.action
      : derivationPending
        ? "—"
        : (mapping?.action ?? "Not applicable");

  // Diagnosis list filtered by the photo-derived classification; "Not
  // applicable" diagnoses (OSMF, classificationOf === null) are always shown.
  // Before classification is known (photos not all verdicted) show everything.
  const diagnosisOptions = loaded.provisionalDiagnosisAnswers.filter((a) => {
    // "N/A" exists only for the pre-populated limited-mouth path; never offer
    // it as a pickable diagnosis.
    if (a.name === LIMITED_MOUTH_REVIEW.diagnosis) return false;
    // Read-only: nothing is pickable, so don't filter — the stored selection
    // must render regardless of what the classification filter would say.
    if (readOnly) return true;
    if (!classification) return true;
    const c = classificationOf(a.name);
    return c === null || c === classification;
  });
  // A stored diagnosis whose answer was voided later would otherwise render
  // as a blank select — surface it as its own (disabled-list) entry instead.
  const storedDiagnosisNotInOptions =
    readOnly &&
    Boolean(effectiveForm.provisionalDiagnosis) &&
    !diagnosisOptions.some((a) => a.name === effectiveForm.provisionalDiagnosis);

  const missingPhotoVerdicts = presentPhotos.filter(
    (slot) =>
      (effectiveForm.photoQuality[slot] ?? QUALITY_VALUES.yes) !== QUALITY_VALUES.no &&
      !effectiveForm.photoVerdicts[slot],
  );
  const diagnosisMissing = !limitedMouthFixed && !effectiveForm.provisionalDiagnosis;
  const subTypeMissing = !limitedMouthFixed && needsSubType && !effectiveForm.provisionalSubType;
  // Highest-risk photo is mandatory once any photo is Suspicious (the only case
  // where the checkbox is offered): exactly one must be flagged. Never on the
  // limited-mouth path — its classification is Suspicious with zero photos.
  const highestRiskRequired = !limitedMouthFixed && classification === VERDICT_VALUES.suspicious;
  const highestRiskMissing = highestRiskRequired && effectiveForm.highestRiskSlot == null;
  const canSubmit =
    missingPhotoVerdicts.length === 0 && !diagnosisMissing && !subTypeMissing && !highestRiskMissing;

  const submit = async () => {
    if (readOnly || !canSubmit) return;
    const review = loaded.review;
    // tanuh-webapp#5: without a booked review the submit creates one, for a standalone screening only (there is no
    // programme POST).
    if (!review && isProgramEncounter(loaded.screening)) {
      setSubmitError("This case is recorded inside a program and can be reviewed only from its booked review.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const patientId = readObs<string>(loaded.subject.observations ?? {}, PATIENT_ID_CONCEPT);
      let current: EncounterApiResponse | null = null;
      let encounterId: string | null;
      if (review) {
        // Another physician may have completed this review since it was opened —
        // re-check so a second submit can't silently overwrite the first.
        // Best-effort (not transactional), but it closes the common case. The
        // subject's reviews are re-fetched alongside (not reused from load time)
        // so the Encounter ID sequence below is computed on current data.
        const [fetched, reviewsNow] = await Promise.all([
          getEncounter(review.ID),
          listVisitsFor(review, ENCOUNTER_TYPE.physicianReviewForm.name),
        ]);
        current = fetched;
        if (isCompleted(current)) {
          setSubmitError(
            "This review has already been completed by someone else. Go back and reopen it to see the recorded answers.",
          );
          return;
        }
        encounterId =
          readObs<string>(current.observations ?? {}, ENCOUNTER_ID_CONCEPT) ??
          computeNextEncounterId(patientId, "CLR", reviewsNow, review.ID);
      } else {
        // The created review carries External ID review-<screening uuid>, which a GET by id also matches: a review
        // created from this screening by anyone (another physician, a second window) refuses this submit.
        const [existing, reviewsNow] = await Promise.all([
          findReviewCreatedFrom(loaded.screening.ID),
          listVisitsFor(loaded.screening, ENCOUNTER_TYPE.physicianReviewForm.name),
        ]);
        const decision = decideCreate(existing, patientId, reviewsNow);
        if (decision.kind === "refuse") {
          setSubmitError("This case has already been reviewed.");
          return;
        }
        encounterId = decision.encounterId;
      }
      const observations: Record<string, unknown> = {};
      // Physician verdicts → review form's repeatable Images QuestionGroup,
      // one row per shown photo. Each row carries the photo's Oral Image value
      // (the stored media URL from the screening) so consumers — notably the
      // mobile app's patient dashboard — can show the thumbnail next to its
      // verdict instead of relying on index alignment with the screening.
      // Photo-less reviews (limited mouth opening) skip the group entirely
      // rather than writing an empty array.
      if (photos.length > 0) {
        observations[REVIEW_IMAGE_GROUP.name] = photos.map(({ slot, imageUrl }) => {
          const quality = effectiveForm.photoQuality[slot] ?? QUALITY_VALUES.yes;
          const row: Record<string, unknown> = {
            [REVIEW_IMAGE_GROUP_CHILD.image.name]: imageUrl,
            [REVIEW_IMAGE_GROUP_CHILD.acceptableQuality.name]: quality,
          };
          // Not-acceptable photos are not assessable, so they carry no verdict.
          if (quality !== QUALITY_VALUES.no && effectiveForm.photoVerdicts[slot]) {
            row[REVIEW_IMAGE_GROUP_CHILD.physicianVerdict.name] = effectiveForm.photoVerdicts[slot];
          }
          // The single highest-risk flag lands on its row only.
          if (effectiveForm.highestRiskSlot === slot) {
            row[REVIEW_IMAGE_GROUP_CHILD.highestRiskPhoto.name] = QUALITY_VALUES.yes;
          }
          return row;
        });
      }
      if (classification) observations[REVIEW_CONCEPTS.classification.name] = classification;
      observations[REVIEW_CONCEPTS.provisionalDiagnosis.name] = limitedMouthFixed
        ? LIMITED_MOUTH_REVIEW.diagnosis
        : effectiveForm.provisionalDiagnosis;
      if (needsSubType && effectiveForm.provisionalSubType) {
        observations[REVIEW_CONCEPTS.provisionalSubType.name] = effectiveForm.provisionalSubType;
      }
      // Risk band + recommended action are auto-derived (read-only in the UI);
      // the limited-mouth path writes the spec's fixed values instead.
      const risk = limitedMouthFixed ? LIMITED_MOUTH_REVIEW.risk : mapping?.risk;
      const action = limitedMouthFixed ? LIMITED_MOUTH_REVIEW.action : mapping?.action;
      if (risk) observations[REVIEW_CONCEPTS.highLowRisk.name] = risk;
      if (action) observations[REVIEW_CONCEPTS.recommendedAction.name] = action;
      if (effectiveForm.notes.trim()) observations[REVIEW_CONCEPTS.notes.name] = effectiveForm.notes;
      observations[REVIEW_CONCEPTS.reviewTimestamp.name] = new Date().toISOString();
      // Permanently tie this review to the screening it covered, so the list can
      // label it by its own Case ID instead of the subject's latest screening.
      observations[REVIEWED_ORAL_SCREENING_CONCEPT.name] = loaded.screening.ID;
      // Rules only run on mobile, so the review's Encounter ID is written here
      // (worked out above). An id already on the encounter is reused verbatim
      // (the save replaces observations wholesale — recomputing could change
      // it); a subject without a Patient ID gets none, like the mobile rule.
      if (encounterId) observations[ENCOUNTER_ID_CONCEPT.name] = encounterId;
      // tanuh-webapp#5: whether the clinician agreed with the model, only where the model scored this screening; an
      // organisation without the configuration would reject the unknown concept for the whole submit.
      const modelResult = readModelResult((loaded.screening.observations ?? {}) as Record<string, unknown>);
      const agreement = computeAgreement(risk ?? undefined, classification, modelResult);
      if (agreement && modelResult) observations[MODEL_AGREEMENT_CONCEPT.name] = agreement;

      // The follow-ups below hang off the review: the booked one, or the one just created.
      let anchor: EncounterApiResponse;
      if (review && current) {
        await submitEncounter(
          review.ID,
          {
            "Encounter type": ENCOUNTER_TYPE.physicianReviewForm.name,
            "Subject ID": review["Subject ID"],
            "Encounter date time": new Date().toISOString(),
            // Sent back unchanged: the PUT would otherwise null the window the
            // Oral Screening rule scheduled this review in.
            "Earliest scheduled date": current["Earliest scheduled date"],
            "Max scheduled date": current["Max scheduled date"],
            observations,
          },
          { program: isProgramEncounter(review) },
        );
        anchor = review;
      } else {
        anchor = await submitEncounter(null, buildCreatedReviewBody(loaded.screening, observations, new Date().toISOString()));
      }
      // The list tabs cache their org-wide sweeps — drop them so the review
      // just completed shows up in the counts and High Risk set immediately.
      invalidateEncounterSweeps();
      // Requirements 2.0 Case Updates: a High Risk diagnosis schedules a
      // "High Risk Referral" visit for the screening worker (inform patient,
      // pick biopsy hospital), and a "Referral Slip" for them to hand over.
      // The review itself is already saved at this point, so a failure here is
      // reported without retrying the review.
      // Deliberately NOT triggered by the limited-mouth path: its pre-set
      // High Risk pairs with the dentist-visit action, not the biopsy flow.
      if (!limitedMouthFixed && mapping?.risk === RISK.high) {
        try {
          await ensureHighRiskFollowUp(anchor);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setSubmitError(
            `Review saved, but scheduling the High Risk Referral visit failed: ${message}. ` +
              "Please raise it with the field team so the worker is informed.",
          );
          return;
        }
        try {
          await ensureReferralSlip(anchor);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setSubmitError(
            `Review saved, but scheduling the Referral Slip failed: ${message}. ` +
              "The worker can still raise the slip from the patient's New Form list.",
          );
          return;
        }
      }
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        // storage may be disabled — nothing to clean up.
      }
      navigate("/pending");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  // Clinician review is name-blind: the patient name is intentionally not shown.
  // Title the page with the screening's Encounter ID (the same value the list
  // shows as Case ID), falling back to the registration/external ID; subjects
  // with neither get a neutral label rather than the raw subject UUID.
  const caseLabel =
    readObs<string>(loaded.screening.observations as Record<string, unknown>, ENCOUNTER_ID_CONCEPT) ||
    loaded.subject["External ID"] ||
    "Patient Review";

  return (
    <Stack spacing={3}>
      <Stack direction="row" alignItems="center" spacing={1}>
        {onBack && (
          <Button
            onClick={onBack}
            size="large"
            sx={{
              minWidth: 0,
              px: { xs: 1, sm: 1.5 },
              fontSize: { xs: 24, sm: 28 },
              lineHeight: 1,
              flexShrink: 0,
            }}
            aria-label="Back"
          >
            ←
          </Button>
        )}
        <Typography
          variant="h5"
          sx={{
            fontSize: { xs: "1.15rem", sm: "1.5rem" },
            fontWeight: 700,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {caseLabel}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
      </Stack>

      {isLegacy && (
        <Alert severity="warning">
          This screening was captured on an older form version and is not supported for review.
          Showing the recorded data in read-only mode.
        </Alert>
      )}

      {completed && (
        <Alert
          icon={<LockOutlinedIcon fontSize="small" />}
          severity="info"
          sx={{
            bgcolor: "grey.100",
            color: "text.primary",
            border: "1px solid",
            borderColor: "grey.300",
            "& .MuiAlert-icon": { color: "text.secondary" },
          }}
        >
          Read-only — review completed
          {loaded.review?.["Encounter date time"]
            ? ` on ${format(parseISO(loaded.review["Encounter date time"]), "dd MMM yyyy")}`
            : ""}
          .
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <RegDetailsCard subject={loaded.subject} screening={loaded.screening} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <HabitHistoryCard screening={loaded.screening} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <SymptomsCard screening={loaded.screening} />
        </Grid>
        {/* PE-96: fourth cell of a two-column grid, so on md+ it renders directly
            under Habit History (row 2, right), as in the approved prototype. Only
            for an org that carries the Data Quality concept. */}
        {qualityGate && (
          <Grid size={{ xs: 12, md: 6 }}>
            <DataQualityCard screening={loaded.screening} />
          </Grid>
        )}
        {/* tanuh-webapp#5: what the high-risk model said, beside the photos. Nothing in the form is filled from it. */}
        {modelOn && (
          <Grid size={{ xs: 12, md: 6 }}>
            <ModelPanel screening={loaded.screening} />
          </Grid>
        )}
        {/* Shown only for the limited-mouth-opening path for now — whether it
            should appear on every review is pending a decision with Tanuh. */}
        {mouthNotOpen && (
          <Grid size={{ xs: 12, md: 6 }}>
            <OralVisualExamCard screening={loaded.screening} />
          </Grid>
        )}
      </Grid>

      <Typography variant="h6">Images</Typography>
      <Stack spacing={2}>
        {presentPhotos.length === 0 &&
          (mouthNotOpen ? (
            <Alert severity="warning">
              Patient is unable to open their mouth; therefore, images are not available.
            </Alert>
          ) : (
            <Alert severity="info">No images recorded on the linked Oral Screening encounter.</Alert>
          ))}
        {photos.map((photo) => {
          const quality = effectiveForm.photoQuality[photo.slot] ?? QUALITY_VALUES.yes;
          const assessable = quality !== QUALITY_VALUES.no;
          const isHighestRisk = effectiveForm.highestRiskSlot === photo.slot;
          // Once one photo is flagged, the checkbox is disabled on every other.
          const highestRiskDisabled = effectiveForm.highestRiskSlot != null && !isHighestRisk;
          return (
            <PhotoReviewRow
              key={photo.slot}
              photo={photo}
              verdictAnswers={loaded.physicianVerdictAnswers}
              value={effectiveForm.photoVerdicts[photo.slot] ?? ""}
              quality={quality}
              isHighestRisk={isHighestRisk}
              highestRiskDisabled={highestRiskDisabled}
              highestRiskMissing={!readOnly && highestRiskMissing}
              readOnly={readOnly}
              missing={!readOnly && assessable && !effectiveForm.photoVerdicts[photo.slot]}
              onHighestRiskChange={(checked) =>
                updateForm({ ...effectiveForm, highestRiskSlot: checked ? photo.slot : null })
              }
              onQualityChange={(q) => {
                const nextQuality = { ...effectiveForm.photoQuality, [photo.slot]: q };
                // Marking a photo not-acceptable clears any verdict it had, and
                // it can no longer be the highest-risk photo.
                const nextVerdicts = { ...effectiveForm.photoVerdicts };
                if (q === QUALITY_VALUES.no) delete nextVerdicts[photo.slot];
                const clearHighestRisk =
                  q === QUALITY_VALUES.no && effectiveForm.highestRiskSlot === photo.slot;
                const nextClass = deriveClassification(presentPhotos, nextVerdicts, nextQuality);
                const dx = effectiveForm.provisionalDiagnosis;
                const dxStillValid =
                  !dx || !nextClass || classificationOf(dx) === null || classificationOf(dx) === nextClass;
                updateForm({
                  ...effectiveForm,
                  photoQuality: nextQuality,
                  photoVerdicts: nextVerdicts,
                  ...(clearHighestRisk ? { highestRiskSlot: null } : {}),
                  ...(dxStillValid ? {} : { provisionalDiagnosis: "", provisionalSubType: "" }),
                });
              }}
              onChange={(v) => {
                const nextVerdicts = { ...effectiveForm.photoVerdicts, [photo.slot]: v };
                const nextClass = deriveClassification(presentPhotos, nextVerdicts, effectiveForm.photoQuality);
                // Clear the diagnosis if the new classification no longer matches it
                // (Not-applicable diagnoses such as OSMF stay valid for either).
                const dx = effectiveForm.provisionalDiagnosis;
                const dxStillValid =
                  !dx || !nextClass || classificationOf(dx) === null || classificationOf(dx) === nextClass;
                // A non-suspicious photo can't be the highest-risk one — drop the
                // flag so it doesn't persist or block flagging another photo.
                const clearHighestRisk =
                  v === VERDICT_VALUES.nonSuspicious && effectiveForm.highestRiskSlot === photo.slot;
                updateForm({
                  ...effectiveForm,
                  photoVerdicts: nextVerdicts,
                  ...(clearHighestRisk ? { highestRiskSlot: null } : {}),
                  ...(dxStillValid ? {} : { provisionalDiagnosis: "", provisionalSubType: "" }),
                });
              }}
            />
          );
        })}
      </Stack>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">Diagnosis</Typography>

            {/* Classification — auto-computed from the photo verdicts above. */}
            <Box>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                Suspicious / Non-suspicious
              </Typography>
              <Typography
                variant="h6"
                color={classification === VERDICT_VALUES.suspicious ? "error.main" : "text.primary"}
              >
                {classification || "—"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {limitedMouthFixed
                  ? "Pre-populated — patient unable to open mouth."
                  : "Auto-computed from photo verdicts above."}
              </Typography>
            </Box>

            {/* Provisional diagnosis — single-select, filtered by classification.
                Limited-mouth reviews fix it to N/A (read-only). */}
            {limitedMouthFixed ? (
              <Box>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  Provisional diagnosis
                </Typography>
                <Typography variant="h6">{LIMITED_MOUTH_REVIEW.diagnosis}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Pre-populated — patient unable to open mouth.
                </Typography>
              </Box>
            ) : (
              <TextField
                select
                label="Provisional diagnosis"
                value={effectiveForm.provisionalDiagnosis}
                disabled={readOnly}
                required
                error={diagnosisMissing}
                helperText={diagnosisMissing ? "Select a provisional diagnosis." : ""}
                onChange={(e) => {
                  const dx = e.target.value;
                  updateForm({
                    ...effectiveForm,
                    provisionalDiagnosis: dx,
                    ...(dx === NON_HOMOGENEOUS_LEUKOPLAKIA ? {} : { provisionalSubType: "" }),
                  });
                }}
              >
                <MenuItem value="">—</MenuItem>
                {storedDiagnosisNotInOptions && (
                  <MenuItem value={effectiveForm.provisionalDiagnosis}>
                    {effectiveForm.provisionalDiagnosis}
                  </MenuItem>
                )}
                {diagnosisOptions.map((a) => (
                  <MenuItem key={a.uuid} value={a.name}>
                    {a.name}
                  </MenuItem>
                ))}
              </TextField>
            )}

            {/* Dependent sub-type — only for Non-homogeneous leukoplakia. */}
            {needsSubType && (
              <TextField
                select
                label="Provisional diagnosis sub-type"
                value={effectiveForm.provisionalSubType}
                disabled={readOnly}
                required
                error={subTypeMissing}
                helperText={subTypeMissing ? "Select a sub-type." : ""}
                onChange={(e) => updateForm({ ...effectiveForm, provisionalSubType: e.target.value })}
              >
                <MenuItem value="">—</MenuItem>
                {loaded.subTypeAnswers.map((a) => (
                  <MenuItem key={a.uuid} value={a.name}>
                    {a.name}
                  </MenuItem>
                ))}
              </TextField>
            )}

            {/* Risk band — auto-derived from the diagnosis (read-only). */}
            <Box>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                High-risk / Low-risk
              </Typography>
              <Typography
                variant="h6"
                color={riskDisplay === RISK.high ? "error.main" : "text.primary"}
              >
                {riskDisplay}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {limitedMouthFixed
                  ? "Pre-populated — patient unable to open mouth."
                  : "Auto-derived from the diagnosis."}
              </Typography>
            </Box>

            {/* Recommended action — auto-derived from the diagnosis (read-only). */}
            <Box>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                Recommended action
              </Typography>
              <Typography variant="h6">{actionDisplay}</Typography>
              <Typography variant="caption" color="text.secondary">
                {limitedMouthFixed
                  ? "Pre-populated — patient unable to open mouth."
                  : "Auto-derived from the diagnosis."}
              </Typography>
            </Box>

            <TextField
              label="Notes for Health Worker / patient"
              multiline
              minRows={3}
              value={effectiveForm.notes}
              disabled={readOnly}
              onChange={(e) => updateForm({ ...effectiveForm, notes: e.target.value })}
            />
          </Stack>
        </CardContent>
      </Card>

      {submitError && <Alert severity="error">{submitError}</Alert>}

      {!readOnly && (
        <Stack
          direction="row"
          justifyContent={{ xs: "stretch", sm: "flex-end" }}
          sx={{ pt: 1, pb: 4 }}
        >
          <Button
            variant="contained"
            size="large"
            disabled={submitting || !canSubmit}
            onClick={submit}
            sx={{
              minWidth: { xs: "100%", sm: 160 },
              width: { xs: "100%", sm: "auto" },
            }}
          >
            {submitting ? "Submitting…" : "Complete"}
          </Button>
        </Stack>
      )}
    </Stack>
  );
}

function RegDetailsCard({ subject, screening }: { subject: SubjectApiResponse; screening: EncounterApiResponse }) {
  const obs = subject.observations ?? {};
  const dob = obs["Date of birth"] as string | undefined;
  const age = dob ? differenceInYears(new Date(), parseISO(dob)) : undefined;
  const gender = (obs["Gender"] as string | undefined) ?? "—";
  const capturedOn = screening["Encounter date time"]
    ? format(parseISO(screening["Encounter date time"] as string), "dd-MM-yyyy")
    : "—";
  const loc = subject.location ?? {};
  // An address level can arrive with a null TYPE name — serialized as the
  // literal key "null" — so its title can't be matched to a labelled row.
  // When that happens (or a level's value is explicitly null) show "Unknown"
  // rather than implying the level doesn't exist.
  const getLocationValue = (key: string) => {
    const value = loc[key];
    if (value) return value;
    return value === null || loc["null"] != null ? "Unknown" : "—";
  };
  const state = getLocationValue("State");
  const district = getLocationValue("District");
  const taluka = getLocationValue("Taluka");
  const village = getLocationValue("Village");

  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          Reg Details
        </Typography>
        <DetailRow label="Age" value={age != null ? String(age) : "—"} />
        <DetailRow label="Gender" value={gender} />
        <DetailRow label="Captured on" value={capturedOn} />
        <DetailRow label="Village" value={village} />
        <DetailRow label="Taluka" value={taluka} />
        <DetailRow label="District" value={district} />
        <DetailRow label="State" value={state} />
      </CardContent>
    </Card>
  );
}

function HabitHistoryCard({ screening }: { screening: EncounterApiResponse }) {
  const obs = screening.observations as Record<string, string | undefined>;
  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          Habit History
        </Typography>
        <DetailRow label="Cigarettes / Bidi" value={obs[HABIT_CONCEPTS.cigarettesBidi.name] ?? "—"} />
        <DetailRow label="Smokeless Tobacco" value={obs[HABIT_CONCEPTS.smokelessTobacco.name] ?? "—"} />
        <DetailRow label="Areca nut" value={obs[HABIT_CONCEPTS.arecaNut.name] ?? "—"} />
        <DetailRow label="Alcohol" value={obs[HABIT_CONCEPTS.alcohol.name] ?? "—"} />
        {/* Frequency is only meaningful for current drinkers. */}
        {obs[HABIT_CONCEPTS.alcohol.name] === "Current" && (
          <DetailRow label="Frequency of alcohol" value={obs[HABIT_CONCEPTS.alcoholFrequency.name] ?? "—"} />
        )}
      </CardContent>
    </Card>
  );
}

function SymptomsCard({ screening }: { screening: EncounterApiResponse }) {
  const obs = screening.observations as Record<string, string | undefined>;
  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          Symptoms
        </Typography>
        <DetailRow label="Any symptoms" value={obs[SYMPTOMS_CONCEPT.name] ?? "—"} />
      </CardContent>
    </Card>
  );
}

// PE-96: the backend-stamped Data Quality gate and AI risk label on the screening.
// Read-only, always rendered: an unstamped screening shows "—" on both rows so
// the card is discoverable on old cases too. The caption is the client's text. A Fail screening opened by URL still
// renders (the list hides it; the detail page never redirects).
function DataQualityCard({ screening }: { screening: EncounterApiResponse }) {
  const obs = screening.observations ?? {};
  const dataQuality = readDataQuality(obs);
  return (
    <Card variant="outlined" data-testid="data-quality-card" sx={{ height: "100%" }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          Data Quality
        </Typography>
        <DetailRow label="Data Quality" value={<DataQualityBadge value={dataQuality} />} />
        {/* Wording from Fathima (Discord, 2026-09-24); the earlier "Simulated values"
            demo flag was dropped on her instruction. */}
        <Typography variant="caption" component="p" color="text.secondary" sx={{ mt: 1.5 }}>
          <Box component="strong" sx={{ fontWeight: 700 }}>
            AI-assisted pre-screening only.
          </Box>{" "}
          Not a diagnosis. Final clinical assessment remains with the clinician.
          <br />
          Risk scores are generated only after required data quality checks pass.
        </Typography>
      </CardContent>
    </Card>
  );
}

// tanuh-webapp#5: the high-risk model's values on the screening, read-only. The job writes them; a stand-in result is
// labelled a test result, and the panel says when the model disagreed with the worker or has no result.
function ModelPanel({ screening }: { screening: EncounterApiResponse }) {
  const obs = (screening.observations ?? {}) as Record<string, unknown>;
  const result = readModelResult(obs);
  const version = readModelVersion(obs);
  const runTime = readModelRunTime(obs);
  const group = readReviewCategory(obs);
  const opinion = deriveWorkerOpinion(obs);
  const note =
    group === REVIEW_CATEGORY_VALUES.flwOverride
      ? "The model found nothing suspicious, but the health worker marked a photo suspicious."
      : group === REVIEW_CATEGORY_VALUES.notScored || !result
        ? "No model result is available for this screening."
        : null;
  return (
    <Card variant="outlined" data-testid="model-panel" sx={{ height: "100%" }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          High-risk model
        </Typography>
        <DetailRow label="Worker's opinion" value={opinion ?? "—"} />
        <DetailRow label="Model result" value={<ModelResultBadge value={result} />} />
        <DetailRow label="Group" value={<CategoryBadge value={group} />} />
        <DetailRow
          label="Model version"
          value={
            version ? (
              <>
                {version}
                {version === "stub" && <Chip size="small" label="Test result" data-testid="test-result-label" />}
              </>
            ) : (
              "—"
            )
          }
        />
        <DetailRow label="Scored at" value={runTime ? format(parseISO(runTime), "dd MMM yyyy, h:mm a") : "—"} />
        {note && (
          <Typography variant="body2" sx={{ mt: 1.5 }} data-testid="model-panel-note">
            {note}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

// Visual-exam findings from the screening — the review's only clinical context
// when limited mouth opening prevented photo capture. "Do you see any lesions?"
// and the referral acknowledgment are mutually exclusive paths in the bundle,
// so rows render only when their observation exists.
function OralVisualExamCard({ screening }: { screening: EncounterApiResponse }) {
  const obs = screening.observations as Record<string, string | undefined>;
  const lesions = obs[VISUAL_EXAM_CONCEPTS.seeAnyLesions.name];
  const referralRequired = obs[VISUAL_EXAM_CONCEPTS.referralRequiredLimitedMouth.name];
  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          Oral Visual Exam
        </Typography>
        <DetailRow
          label="Able to open mouth"
          value={obs[VISUAL_EXAM_CONCEPTS.ableToOpenMouth.name] ?? "—"}
        />
        {lesions != null && <DetailRow label="Lesions seen" value={lesions} />}
        {referralRequired != null && (
          <DetailRow label="Referral required (limited mouth opening)" value={referralRequired} />
        )}
      </CardContent>
    </Card>
  );
}

// `value` may be a badge (an inline span), not just text.
function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Stack direction="row" alignItems="center" sx={{ py: 0.5 }}>
      <Typography sx={{ minWidth: 180, fontWeight: 500 }}>{label}</Typography>
      <Typography component="div" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
        : {value}
      </Typography>
    </Stack>
  );
}

function PhotoReviewRow({
  photo,
  verdictAnswers,
  value,
  quality,
  isHighestRisk,
  highestRiskDisabled,
  highestRiskMissing,
  readOnly,
  missing,
  onHighestRiskChange,
  onQualityChange,
  onChange,
}: {
  photo: ReviewPhoto;
  verdictAnswers: ConceptAnswer[];
  value: string;
  quality: string;
  isHighestRisk: boolean;
  highestRiskDisabled: boolean;
  highestRiskMissing: boolean;
  readOnly: boolean;
  missing: boolean;
  onHighestRiskChange: (checked: boolean) => void;
  onQualityChange: (q: string) => void;
  onChange: (v: string) => void;
}) {
  const { slot, imageUrl: url } = photo;
  const notAcceptable = quality === QUALITY_VALUES.no;

  return (
    <Card variant="outlined" sx={missing ? { borderColor: "error.main" } : undefined}>
      <CardContent>
        <Grid container spacing={2} alignItems="flex-start">
          <Grid size={{ xs: 12, md: 4 }}>
            <MediaImg src={url} alt={`Photo ${slot}`} />
          </Grid>
          <Grid size={{ xs: 12, md: 8 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle1">Photo {slot}</Typography>

              {/* Acceptable Quality? — gates the diagnosis below. Defaults to Yes. */}
              <FormControl disabled={readOnly}>
                <Typography variant="body2" sx={{ mb: 1, fontWeight: 600 }} color="text.primary">
                  Acceptable Quality of the photo?
                </Typography>
                <RadioGroup row value={quality} onChange={(_, q) => onQualityChange(q)}>
                  <FormControlLabel value={QUALITY_VALUES.yes} control={<Radio />} label="Yes" />
                  <FormControlLabel value={QUALITY_VALUES.no} control={<Radio />} label="No" />
                </RadioGroup>
              </FormControl>

              {/* Clinician diagnosis — only shown when the photo is acceptable. */}
              {!notAcceptable && (
                <FormControl disabled={readOnly} error={missing}>
                  <Typography variant="body2" sx={{ mb: 1, fontWeight: 600 }} color="text.primary">
                    Clinician diagnosis *
                  </Typography>
                  <RadioGroup row value={value} onChange={(_, v) => onChange(v)}>
                    {verdictAnswers.map((a) => (
                      <FormControlLabel key={a.uuid} value={a.name} control={<Radio />} label={a.name} />
                    ))}
                  </RadioGroup>
                  {missing && (
                    <FormHelperText>Clinician diagnosis is required.</FormHelperText>
                  )}
                </FormControl>
              )}

              {/* Highest Risk Photo? — at most one across the set. Once a photo
                  is flagged the checkbox is hidden on all others. Only meaningful
                  for an acceptable, suspicious photo, so hide it otherwise. */}
              {!notAcceptable && value !== VERDICT_VALUES.nonSuspicious && !highestRiskDisabled && (
                <FormControl error={highestRiskMissing}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={isHighestRisk}
                        disabled={readOnly}
                        onChange={(_, checked) => onHighestRiskChange(checked)}
                      />
                    }
                    label="Highest Risk Photo? *"
                  />
                  {highestRiskMissing && (
                    <FormHelperText>Mark the highest risk photo.</FormHelperText>
                  )}
                </FormControl>
              )}
            </Stack>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}

