import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
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
  isScheduled,
  listEncounters,
  pairReviewsToScreenings,
  scheduleEncounter,
  submitEncounter,
} from "@/api/encounters";
import { getSubject } from "@/api/subjects";
import { getConcept, type ConceptAnswer } from "@/api/concepts";
import type { EncounterApiResponse, SubjectApiResponse } from "@/api/types";
import {
  ENCOUNTER_TYPE,
  ENCOUNTER_ID_CONCEPT,
  HABIT_CONCEPTS,
  PATIENT_ID_CONCEPT,
  SYMPTOMS_CONCEPT,
  isLegacyOralScreening,
  ORAL_IMAGE_GROUP,
  ORAL_IMAGE_GROUP_CHILD,
  ORAL_SCREENING_GROUP,
  PHOTO_CONCEPTS,
  PHOTO_SLOTS,
  QUALITY_VALUES,
  REVIEW_CONCEPTS,
  REVIEWED_ORAL_SCREENING_CONCEPT,
  REVIEW_IMAGE_GROUP,
  REVIEW_IMAGE_GROUP_CHILD,
  VERDICT_VALUES,
  VISUAL_EXAM_CONCEPTS,
  readObs,
  type PhotoSlot,
} from "@/constants/tanuhConcepts";
import {
  classificationOf,
  LIMITED_MOUTH_REVIEW,
  lookupDiagnosis,
  NON_HOMOGENEOUS_LEUKOPLAKIA,
  RISK,
} from "./diagnosisMapping";
import { MediaImg } from "@/components/MediaImg";
import { useAsync } from "@/hooks/useAsync";

interface Props {
  encounterUuid: string;
  onBack?: () => void;
}

interface LoadedState {
  review: EncounterApiResponse;
  screening: EncounterApiResponse;
  subject: SubjectApiResponse;
  physicianVerdictAnswers: ConceptAnswer[];
  provisionalDiagnosisAnswers: ConceptAnswer[];
  subTypeAnswers: ConceptAnswer[];
}

type FormState = {
  photoVerdicts: Partial<Record<PhotoSlot, string>>;
  photoQuality: Partial<Record<PhotoSlot, string>>;
  // The single photo flagged as highest-risk (null = none). Only one at a time.
  highestRiskSlot: PhotoSlot | null;
  provisionalDiagnosis: string;
  provisionalSubType: string;
  notes: string;
};

const emptyForm: FormState = {
  photoVerdicts: {},
  photoQuality: {},
  highestRiskSlot: null,
  provisionalDiagnosis: "",
  provisionalSubType: "",
  notes: "",
};

// A single reviewable photo, normalised across the two Oral Screening capture
// models. `slot` is the 1..8 position; the physician verdict is stored
// index-aligned in the review form's repeatable `Images` QuestionGroup.
interface ReviewPhoto {
  slot: PhotoSlot;
  imageUrl: string;
}

// New encounters store images in a repeatable QuestionGroup (an array of
// `{ "Oral Image" }`). There are two such groups — the "Do you see any lesions?"
// branch decides which one an encounter uses (ORAL_IMAGE_GROUP for the
// lesion-photo flow, ORAL_SCREENING_GROUP for the other) — so read both and map
// their entries to slots 1..N in order. Older encounters used flat
// `Photo N (image)` keys; fall back to that only when neither group has images.
// Capped at PHOTO_SLOTS.length. The AI verdict is no longer surfaced in the
// physician review (Requirements 2.0), so it is not read.
function collectPhotos(obs: Record<string, unknown>): ReviewPhoto[] {
  const photos: ReviewPhoto[] = [];
  for (const groupName of [ORAL_IMAGE_GROUP.name, ORAL_SCREENING_GROUP.name]) {
    const group = obs[groupName];
    if (!Array.isArray(group)) continue;
    for (const entry of group) {
      if (photos.length >= PHOTO_SLOTS.length) break;
      if (!entry || typeof entry !== "object") continue;
      const imageUrl = readObs<string>(entry as Record<string, unknown>, ORAL_IMAGE_GROUP_CHILD.image);
      if (!imageUrl) continue;
      photos.push({ slot: PHOTO_SLOTS[photos.length], imageUrl });
    }
  }
  if (photos.length > 0) return photos;
  for (const slot of PHOTO_SLOTS) {
    const imageUrl = readObs<string>(obs, PHOTO_CONCEPTS[slot].image);
    if (!imageUrl) continue;
    photos.push({ slot, imageUrl });
  }
  return photos;
}

// Requirements 2.0: classification is computed from the per-photo physician
// verdicts — Suspicious if any photo is Suspicious, else Non-Suspicious once all
// photos are verdicted. Empty string while still incomplete.
function deriveClassification(
  presentPhotos: PhotoSlot[],
  photoVerdicts: Partial<Record<PhotoSlot, string>>,
  photoQuality: Partial<Record<PhotoSlot, string>>,
): string {
  // Only acceptable-quality photos are assessable; "No" photos carry no verdict
  // and are excluded from the suspicious/non-suspicious roll-up.
  const assessable = presentPhotos.filter(
    (slot) => (photoQuality[slot] ?? QUALITY_VALUES.yes) !== QUALITY_VALUES.no,
  );
  if (assessable.length === 0) return "";
  if (assessable.some((slot) => photoVerdicts[slot] === VERDICT_VALUES.suspicious)) return VERDICT_VALUES.suspicious;
  if (assessable.every((slot) => Boolean(photoVerdicts[slot]))) return VERDICT_VALUES.nonSuspicious;
  return "";
}

// Schedules the High Risk Follow-up visit unless the subject already has one
// open — re-reviews and double-submits must not pile up duplicate visits.
// Window: due immediately, overdue after 7 days (the scoping doc's follow-up
// convention; the sheet itself doesn't specify dates).
async function ensureHighRiskFollowUp(subjectId: string): Promise<void> {
  const existing = await listEncounters({
    encounterType: ENCOUNTER_TYPE.highRiskFollowUp.name,
    subjectId,
    size: 50,
  });
  if (existing.content.some(isScheduled)) return;
  const now = new Date();
  await scheduleEncounter({
    "Encounter type": ENCOUNTER_TYPE.highRiskFollowUp.name,
    "Subject ID": subjectId,
    "Earliest scheduled date": now.toISOString(),
    "Max scheduled date": addDays(now, 7).toISOString(),
  });
}

async function loadReview(encounterUuid: string): Promise<LoadedState> {
  const review = await getEncounter(encounterUuid);
  const subjectId = review["Subject ID"];
  const [subject, screeningPage, reviewPage, verdictConcept, diagnosisConcept, subTypeConcept] =
    await Promise.all([
      getSubject(subjectId),
      // size must comfortably exceed any real screening/review count per subject:
      // the API pages by lastModified, so a small page can miss encounters.
      listEncounters({ encounterType: ENCOUNTER_TYPE.oralScreening.name, subjectId, size: 50 }),
      listEncounters({ encounterType: ENCOUNTER_TYPE.physicianReviewForm.name, subjectId, size: 50 }),
      getConcept(REVIEW_IMAGE_GROUP_CHILD.physicianVerdict.uuid),
      getConcept(REVIEW_CONCEPTS.provisionalDiagnosis.uuid),
      getConcept(REVIEW_CONCEPTS.provisionalSubType.uuid),
    ]);
  // Load the specific screening THIS review covers (its stamped source, or the
  // created-order paired one), not just the subject's latest — otherwise a
  // multi-screening subject's reviews would all bind to the newest screening.
  const paired = pairReviewsToScreenings(reviewPage.content, screeningPage.content);
  const screening =
    paired.get(review.ID) ??
    screeningPage.content
      .filter((e) => !e.Voided && e["Encounter date time"] != null)
      .sort((a, b) => (b["Encounter date time"] || "").localeCompare(a["Encounter date time"] || ""))[0];
  if (!screening) throw new Error("No completed Oral Screening encounter for this subject");
  return {
    review,
    screening,
    subject,
    physicianVerdictAnswers: verdictConcept.answers,
    provisionalDiagnosisAnswers: diagnosisConcept.answers,
    subTypeAnswers: subTypeConcept.answers,
  };
}

export function ReviewForm({ encounterUuid, onBack }: Props) {
  const { data: loaded, error: loadError } = useAsync(() => loadReview(encounterUuid), [encounterUuid]);
  // In-progress form state is persisted to sessionStorage keyed by the
  // encounter uuid so it survives HMR, accidental refreshes, and tab
  // switches mid-review. Cleared on successful submit.
  const storageKey = `review-form:${encounterUuid}`;
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

  // A completed review always renders from its STORED observations — an
  // in-progress draft left in sessionStorage (e.g. someone else completed the
  // review first) is stale and must not shadow the recorded answers.
  const prefilled = useMemo(
    () => (loaded && isCompleted(loaded.review) ? prefillFromCompleted(loaded.review) : null),
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
  const presentPhotos = useMemo<PhotoSlot[]>(() => photos.map((p) => p.slot), [photos]);

  if (loadError) return <Alert severity="error">{loadError}</Alert>;
  if (!loaded)
    return (
      <Box sx={{ p: 4, display: "flex", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );

  // Legacy flat-layout screenings are not supported for review: render their data
  // but disable all inputs and the Complete button (same plumbing as completed).
  const isLegacy = isLegacyOralScreening(loaded.screening.observations as Record<string, unknown>);
  // Limited-mouth-opening screenings capture no images by design (the bundle
  // forces the referral instead) — the review then rests on the visual-exam
  // findings, not photos.
  const mouthNotOpen =
    (loaded.screening.observations as Record<string, unknown>)[
      VISUAL_EXAM_CONCEPTS.ableToOpenMouth.name
    ] === "No";
  const completed = isCompleted(loaded.review);
  const readOnly = completed || isLegacy;
  // A completed review shows what was RECORDED. Re-deriving from the current
  // diagnosisMapping would silently rewrite how past reviews read whenever the
  // mapping table changes (it already changed once — the OSMF row).
  const storedObs = loaded.review.observations as Record<string, unknown>;
  const storedClassification = completed ? readObs<string>(storedObs, REVIEW_CONCEPTS.classification) : undefined;
  const storedRisk = completed ? (storedObs[REVIEW_CONCEPTS.highLowRisk.name] as string | undefined) : undefined;
  const storedAction = completed ? (storedObs[REVIEW_CONCEPTS.recommendedAction.name] as string | undefined) : undefined;
  // Limited mouth opening: the whole Diagnosis section is pre-populated with
  // the spec's fixed values — the clinician only writes Notes.
  const classification = completed
    ? (storedClassification ?? "")
    : mouthNotOpen
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
    !mouthNotOpen &&
    (!effectiveForm.provisionalDiagnosis || (needsSubType && !effectiveForm.provisionalSubType));
  const riskDisplay = completed
    ? (storedRisk ?? "—")
    : mouthNotOpen
      ? LIMITED_MOUTH_REVIEW.risk
      : derivationPending
        ? "—"
        : (mapping?.risk ?? "Not applicable");
  const actionDisplay = completed
    ? (storedAction ?? "—")
    : mouthNotOpen
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
  const diagnosisMissing = !mouthNotOpen && !effectiveForm.provisionalDiagnosis;
  const subTypeMissing = !mouthNotOpen && needsSubType && !effectiveForm.provisionalSubType;
  // Highest-risk photo is mandatory once any photo is Suspicious (the only case
  // where the checkbox is offered): exactly one must be flagged. Never on the
  // limited-mouth path — its classification is Suspicious with zero photos.
  const highestRiskRequired = !mouthNotOpen && classification === VERDICT_VALUES.suspicious;
  const highestRiskMissing = highestRiskRequired && effectiveForm.highestRiskSlot == null;
  const canSubmit =
    missingPhotoVerdicts.length === 0 && !diagnosisMissing && !subTypeMissing && !highestRiskMissing;

  const submit = async () => {
    if (readOnly || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Another physician may have completed this review since it was opened —
      // re-check so a second submit can't silently overwrite the first.
      // Best-effort (not transactional), but it closes the common case. The
      // subject's reviews are re-fetched alongside (not reused from load time)
      // so the Encounter ID sequence below is computed on current data.
      const [current, reviewsNow] = await Promise.all([
        getEncounter(loaded.review.ID),
        listEncounters({
          encounterType: ENCOUNTER_TYPE.physicianReviewForm.name,
          subjectId: loaded.review["Subject ID"],
          size: 50,
        }),
      ]);
      if (isCompleted(current)) {
        setSubmitError(
          "This review has already been completed by someone else. Go back and reopen it to see the recorded answers.",
        );
        return;
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
      observations[REVIEW_CONCEPTS.provisionalDiagnosis.name] = mouthNotOpen
        ? LIMITED_MOUTH_REVIEW.diagnosis
        : effectiveForm.provisionalDiagnosis;
      if (needsSubType && effectiveForm.provisionalSubType) {
        observations[REVIEW_CONCEPTS.provisionalSubType.name] = effectiveForm.provisionalSubType;
      }
      // Risk band + recommended action are auto-derived (read-only in the UI);
      // the limited-mouth path writes the spec's fixed values instead.
      const risk = mouthNotOpen ? LIMITED_MOUTH_REVIEW.risk : mapping?.risk;
      const action = mouthNotOpen ? LIMITED_MOUTH_REVIEW.action : mapping?.action;
      if (risk) observations[REVIEW_CONCEPTS.highLowRisk.name] = risk;
      if (action) observations[REVIEW_CONCEPTS.recommendedAction.name] = action;
      if (effectiveForm.notes.trim()) observations[REVIEW_CONCEPTS.notes.name] = effectiveForm.notes;
      observations[REVIEW_CONCEPTS.reviewTimestamp.name] = new Date().toISOString();
      // Permanently tie this review to the screening it covered, so the list can
      // label it by its own Case ID instead of the subject's latest screening.
      observations[REVIEWED_ORAL_SCREENING_CONCEPT.name] = loaded.screening.ID;
      // Rules only run on mobile, so the review's Encounter ID is written here.
      // An id already on the encounter is reused verbatim (the PUT replaces
      // observations wholesale — recomputing could change it); a subject
      // without a Patient ID gets none, exactly like the mobile rule.
      const encounterId =
        readObs<string>(current.observations ?? {}, ENCOUNTER_ID_CONCEPT) ??
        computeNextEncounterId(
          readObs<string>(loaded.subject.observations ?? {}, PATIENT_ID_CONCEPT),
          "CLR",
          reviewsNow.content,
          loaded.review.ID,
        );
      if (encounterId) observations[ENCOUNTER_ID_CONCEPT.name] = encounterId;

      await submitEncounter(loaded.review.ID, {
        "Encounter type": ENCOUNTER_TYPE.physicianReviewForm.name,
        "Subject ID": loaded.review["Subject ID"],
        "Encounter date time": new Date().toISOString(),
        observations,
      });
      // The list tabs cache their org-wide sweeps — drop them so the review
      // just completed shows up in the counts and High Risk set immediately.
      invalidateEncounterSweeps();
      // Requirements 2.0 Case Updates: a High Risk diagnosis schedules a
      // "High Risk Follow-up" visit for the screening worker (inform patient,
      // pick biopsy hospital). The review itself is already saved at this
      // point, so a failure here is reported without retrying the review.
      // Deliberately NOT triggered by the limited-mouth path: its pre-set
      // High Risk pairs with the dentist-visit action, not the biopsy flow.
      if (!mouthNotOpen && mapping?.risk === RISK.high) {
        try {
          await ensureHighRiskFollowUp(loaded.review["Subject ID"]);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setSubmitError(
            `Review saved, but scheduling the High Risk Follow-up visit failed: ${message}. ` +
              "Please raise it with the field team so the worker is informed.",
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
          {loaded.review["Encounter date time"]
            ? ` on ${format(parseISO(loaded.review["Encounter date time"]!), "dd MMM yyyy")}`
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
                {mouthNotOpen
                  ? "Pre-populated — patient unable to open mouth."
                  : "Auto-computed from photo verdicts above."}
              </Typography>
            </Box>

            {/* Provisional diagnosis — single-select, filtered by classification.
                Limited-mouth reviews fix it to N/A (read-only). */}
            {mouthNotOpen ? (
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
                {mouthNotOpen
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
                {mouthNotOpen
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" sx={{ py: 0.5 }}>
      <Typography sx={{ minWidth: 180, fontWeight: 500 }}>{label}</Typography>
      <Typography>: {value}</Typography>
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

function prefillFromCompleted(review: EncounterApiResponse): FormState {
  const obs = review.observations as Record<string, unknown>;
  const photoVerdicts: Partial<Record<PhotoSlot, string>> = {};
  const photoQuality: Partial<Record<PhotoSlot, string>> = {};
  let highestRiskSlot: PhotoSlot | null = null;
  // 2.0 reviews store verdicts in the repeatable Images group (index-aligned).
  const imagesGroup = obs[REVIEW_IMAGE_GROUP.name];
  if (Array.isArray(imagesGroup)) {
    imagesGroup.forEach((row, i) => {
      const slot = PHOTO_SLOTS[i];
      if (!slot || !row || typeof row !== "object") return;
      const r = row as Record<string, unknown>;
      const v = r[REVIEW_IMAGE_GROUP_CHILD.physicianVerdict.name];
      if (typeof v === "string") photoVerdicts[slot] = v;
      // Older completed reviews predate this field → treat as acceptable (Yes).
      const q = r[REVIEW_IMAGE_GROUP_CHILD.acceptableQuality.name];
      photoQuality[slot] = typeof q === "string" ? q : QUALITY_VALUES.yes;
      if (r[REVIEW_IMAGE_GROUP_CHILD.highestRiskPhoto.name] === QUALITY_VALUES.yes) highestRiskSlot = slot;
    });
  } else {
    // Pre-2.0 completed reviews: flat per-slot Photo N — Physician verdict.
    PHOTO_SLOTS.forEach((slot) => {
      const v = obs[PHOTO_CONCEPTS[slot].physicianVerdict.name];
      if (typeof v === "string") photoVerdicts[slot] = v;
    });
  }
  return {
    photoVerdicts,
    photoQuality,
    highestRiskSlot,
    provisionalDiagnosis: (obs[REVIEW_CONCEPTS.provisionalDiagnosis.name] as string) ?? "",
    provisionalSubType: (obs[REVIEW_CONCEPTS.provisionalSubType.name] as string) ?? "",
    notes: (readObs<string>(obs, REVIEW_CONCEPTS.notes) as string) ?? "",
  };
}
