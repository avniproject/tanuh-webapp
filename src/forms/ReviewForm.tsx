import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
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
import { differenceInYears, format, parseISO } from "date-fns";
import { useNavigate } from "react-router-dom";
import { getEncounter, isCompleted, listEncounters, submitEncounter } from "@/api/encounters";
import { getSubject } from "@/api/subjects";
import { getConcept, type ConceptAnswer } from "@/api/concepts";
import type { EncounterApiResponse, SubjectApiResponse } from "@/api/types";
import {
  AI_VERDICT_GROUP,
  AI_VERDICT_GROUP_CHILD,
  ANY_SUSPICIOUS_LESION_CONCEPT,
  ENCOUNTER_TYPE,
  HABIT_CONCEPTS,
  ORAL_IMAGE_GROUP,
  ORAL_IMAGE_GROUP_CHILD,
  PHOTO_CONCEPTS,
  PHOTO_SLOTS,
  REVIEW_CONCEPTS,
  VERDICT_VALUES,
  readObs,
  type PhotoSlot,
} from "@/constants/tanuhConcepts";
import { OPMD_OPTIONS } from "./opmdOptions";
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
  suspiciousAnswers: ConceptAnswer[];
  recommendedActionAnswers: ConceptAnswer[];
}

type FormState = {
  photoVerdicts: Partial<Record<PhotoSlot, string>>;
  opmdDiagnoses: string[];
  recommendedAction: string;
  notes: string;
};

const emptyForm: FormState = {
  photoVerdicts: {},
  opmdDiagnoses: [],
  recommendedAction: "",
  notes: "",
};

// A single reviewable photo, normalised across the two Oral Screening capture
// models. `slot` is the 1..8 position used to store the physician verdict as the
// existing `Photo N — Physician verdict` concept.
interface ReviewPhoto {
  slot: PhotoSlot;
  imageUrl: string;
  aiVerdict?: string;
}

// New encounters store images in a repeatable QuestionGroup (an array of
// `{ "Oral Image" }`) and the AI verdicts in a *parallel* repeatable group
// (`AI_VERDICT_GROUP`, an array of `{ "AI Verdict" }`) aligned by row index.
// Older encounters kept the verdict inside the image row, or used flat
// `Photo N (image)` keys. Read the image group first and map its entries to
// slots 1..N in order, pulling each verdict from the parallel array by its
// original group index (so alignment survives skipped rows); fall back to the
// in-row verdict, then to the legacy flat layout. Capped at PHOTO_SLOTS.length
// since verdict storage has only Photo 1..8 concepts.
function collectPhotos(obs: Record<string, unknown>): ReviewPhoto[] {
  const photos: ReviewPhoto[] = [];
  const group = obs[ORAL_IMAGE_GROUP.name];
  if (Array.isArray(group)) {
    const aiGroup = obs[AI_VERDICT_GROUP.name];
    const aiRows = Array.isArray(aiGroup) ? aiGroup : [];
    for (let i = 0; i < group.length; i++) {
      if (photos.length >= PHOTO_SLOTS.length) break;
      const entry = group[i];
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const imageUrl = readObs<string>(record, ORAL_IMAGE_GROUP_CHILD.image);
      if (!imageUrl) continue;
      const aiRow = aiRows[i];
      const aiVerdict =
        (aiRow && typeof aiRow === "object"
          ? readObs<string>(aiRow as Record<string, unknown>, AI_VERDICT_GROUP_CHILD.verdict)
          : undefined) ?? readObs<string>(record, ORAL_IMAGE_GROUP_CHILD.aiVerdict);
      photos.push({
        slot: PHOTO_SLOTS[photos.length],
        imageUrl,
        aiVerdict,
      });
    }
    return photos;
  }
  for (const slot of PHOTO_SLOTS) {
    const imageUrl = readObs<string>(obs, PHOTO_CONCEPTS[slot].image);
    if (!imageUrl) continue;
    photos.push({
      slot,
      imageUrl,
      aiVerdict: readObs<string>(obs, PHOTO_CONCEPTS[slot].aiVerdict),
    });
  }
  return photos;
}

function deriveAnySuspicious(
  presentPhotos: PhotoSlot[],
  photoVerdicts: Partial<Record<PhotoSlot, string>>,
): string {
  if (presentPhotos.length === 0) return "";
  if (presentPhotos.some((slot) => photoVerdicts[slot] === VERDICT_VALUES.suspicious)) return VERDICT_VALUES.yes;
  if (presentPhotos.every((slot) => Boolean(photoVerdicts[slot]))) return VERDICT_VALUES.no;
  return "";
}

const NO_ACTION = "No action";

async function loadReview(encounterUuid: string): Promise<LoadedState> {
  const review = await getEncounter(encounterUuid);
  const subjectId = review["Subject ID"];
  const [subject, screeningPage, verdictConcept, suspiciousConcept, actionConcept] = await Promise.all([
    getSubject(subjectId),
    listEncounters({ encounterType: ENCOUNTER_TYPE.oralScreening.name, subjectId, size: 5 }),
    getConcept(PHOTO_CONCEPTS[1].physicianVerdict.uuid),
    getConcept(REVIEW_CONCEPTS.anyImageSuspicious.uuid),
    getConcept(REVIEW_CONCEPTS.recommendedAction.uuid),
  ]);
  const screening = screeningPage.content
    .filter((e) => !e.Voided && e["Encounter date time"] != null)
    .sort((a, b) => (b["Encounter date time"] || "").localeCompare(a["Encounter date time"] || ""))[0];
  if (!screening) throw new Error("No completed Oral Screening encounter for this subject");
  return {
    review,
    screening,
    subject,
    physicianVerdictAnswers: verdictConcept.answers,
    suspiciousAnswers: suspiciousConcept.answers,
    recommendedActionAnswers: actionConcept.answers,
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

  const effectiveForm = form ?? (loaded && isCompleted(loaded.review) ? prefillFromCompleted(loaded.review) : emptyForm);

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

  const readOnly = isCompleted(loaded.review);
  const anySuspicious = deriveAnySuspicious(presentPhotos, effectiveForm.photoVerdicts);
  const updateForm = (next: FormState) => setForm(next);

  const missingPhotoVerdicts = presentPhotos.filter((slot) => !effectiveForm.photoVerdicts[slot]);
  const diagnosisRequired = anySuspicious === VERDICT_VALUES.yes;
  const opmdMissing = diagnosisRequired && effectiveForm.opmdDiagnoses.length === 0;
  const actionMissing =
    diagnosisRequired &&
    (!effectiveForm.recommendedAction || effectiveForm.recommendedAction === NO_ACTION);
  const canSubmit = missingPhotoVerdicts.length === 0 && !opmdMissing && !actionMissing;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const observations: Record<string, unknown> = {};
      presentPhotos.forEach((slot) => {
        const v = effectiveForm.photoVerdicts[slot];
        if (v) observations[PHOTO_CONCEPTS[slot].physicianVerdict.name] = v;
      });
      if (anySuspicious) observations[REVIEW_CONCEPTS.anyImageSuspicious.name] = anySuspicious;
      if (effectiveForm.opmdDiagnoses.length > 0) observations[REVIEW_CONCEPTS.opmdDiagnoses.name] = effectiveForm.opmdDiagnoses;
      if (effectiveForm.recommendedAction) observations[REVIEW_CONCEPTS.recommendedAction.name] = effectiveForm.recommendedAction;
      if (effectiveForm.notes.trim()) observations[REVIEW_CONCEPTS.notes.name] = effectiveForm.notes;
      observations[REVIEW_CONCEPTS.reviewTimestamp.name] = new Date().toISOString();

      await submitEncounter(loaded.review.ID, {
        "Encounter type": ENCOUNTER_TYPE.physicianReviewForm.name,
        "Subject ID": loaded.review["Subject ID"],
        "Encounter date time": new Date().toISOString(),
        observations,
      });
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

  const subjectObs = (loaded.subject.observations ?? {}) as Record<string, unknown>;
  const firstName = (subjectObs["First name"] as string | undefined) ?? "";
  const lastName = (subjectObs["Last name"] as string | undefined) ?? "";
  const fullName = `${firstName} ${lastName}`.trim()
    || loaded.subject["External ID"]
    || loaded.review["Subject ID"].slice(0, 8);

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
          {fullName}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
      </Stack>

      {readOnly && (
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
      </Grid>

      <Typography variant="h6">Images</Typography>
      <Stack spacing={2}>
        {presentPhotos.length === 0 && (
          <Alert severity="info">No images recorded on the linked Oral Screening encounter.</Alert>
        )}
        {photos.map((photo) => (
          <PhotoReviewRow
            key={photo.slot}
            photo={photo}
            verdictAnswers={loaded.physicianVerdictAnswers}
            value={effectiveForm.photoVerdicts[photo.slot] ?? ""}
            readOnly={readOnly}
            missing={!readOnly && !effectiveForm.photoVerdicts[photo.slot]}
            onChange={(v) => {
              const nextVerdicts = { ...effectiveForm.photoVerdicts, [photo.slot]: v };
              const nextSuspicious = deriveAnySuspicious(presentPhotos, nextVerdicts);
              updateForm({
                ...effectiveForm,
                photoVerdicts: nextVerdicts,
                ...(nextSuspicious === VERDICT_VALUES.no ? { opmdDiagnoses: [] } : {}),
              });
            }}
          />
        ))}
      </Stack>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">Diagnosis</Typography>

            <Box>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                Any image suspicious?
              </Typography>
              <Typography variant="h6" color={anySuspicious === VERDICT_VALUES.yes ? "error.main" : "text.primary"}>
                {anySuspicious || "—"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Auto-computed from photo verdicts above. Marked &quot;Yes&quot; when any photo is Suspicious.
              </Typography>
            </Box>

            <Autocomplete
              multiple
              disableCloseOnSelect
              disabled={readOnly || anySuspicious === VERDICT_VALUES.no}
              options={OPMD_OPTIONS as unknown as string[]}
              value={effectiveForm.opmdDiagnoses}
              onChange={(_, v) => updateForm({ ...effectiveForm, opmdDiagnoses: v })}
              renderInput={(p) => (
                <TextField
                  {...p}
                  label="OPMD diagnoses"
                  placeholder="Select all that apply"
                  required={diagnosisRequired}
                  error={opmdMissing}
                  helperText={
                    opmdMissing
                      ? "Required when any image is suspicious."
                      : anySuspicious === VERDICT_VALUES.no
                        ? "Not applicable — no suspicious images."
                        : ""
                  }
                />
              )}
            />

            <TextField
              select
              label="Recommended action"
              value={effectiveForm.recommendedAction}
              disabled={readOnly}
              required={diagnosisRequired}
              error={actionMissing}
              helperText={
                actionMissing
                  ? `Required when any image is suspicious — "${NO_ACTION}" is not allowed.`
                  : ""
              }
              onChange={(e) => updateForm({ ...effectiveForm, recommendedAction: e.target.value })}
            >
              <MenuItem value="">—</MenuItem>
              {loaded.recommendedActionAnswers.map((a) => (
                <MenuItem key={a.uuid} value={a.name}>
                  {a.name}
                </MenuItem>
              ))}
            </TextField>

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
  const firstName = obs["First name"] as string | undefined;
  const lastName = obs["Last name"] as string | undefined;
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || "—";
  const dob = obs["Date of birth"] as string | undefined;
  const age = dob ? differenceInYears(new Date(), parseISO(dob)) : undefined;
  const gender = (obs["Gender"] as string | undefined) ?? "—";
  const capturedOn = screening["Encounter date time"]
    ? format(parseISO(screening["Encounter date time"] as string), "dd-MM-yyyy")
    : "—";
  const loc = subject.location ?? {};
  const getLocationValue = (key: string) => {
    const value = loc[key];
    return value ?? (value === null || loc["null"] ? "Unknown" : "—");
  };
  const state = getLocationValue("State");
  const district = getLocationValue("District");
  const village = getLocationValue("Village");

  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          Reg Details
        </Typography>
        <DetailRow label="Name" value={fullName} />
        <DetailRow label="Age" value={age != null ? String(age) : "—"} />
        <DetailRow label="Gender" value={gender} />
        <DetailRow label="Captured on" value={capturedOn} />
        <DetailRow label="Village" value={village} />
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
        <DetailRow label="Frequency of alcohol" value={obs[HABIT_CONCEPTS.alcoholFrequency.name] ?? "—"} />
        <DetailRow label="Health Worker verdict (Any suspicious lesion?)" value={obs[ANY_SUSPICIOUS_LESION_CONCEPT.name] ?? "—"} />
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
  readOnly,
  missing,
  onChange,
}: {
  photo: ReviewPhoto;
  verdictAnswers: ConceptAnswer[];
  value: string;
  readOnly: boolean;
  missing: boolean;
  onChange: (v: string) => void;
}) {
  const { slot, imageUrl: url, aiVerdict } = photo;

  return (
    <Card
      variant="outlined"
      sx={missing ? { borderColor: "error.main" } : undefined}
    >
      <CardContent>
        <Grid container spacing={2} alignItems="flex-start">
          <Grid size={{ xs: 12, md: 4 }}>
            <MediaImg src={url} alt={`Photo ${slot}`} />
          </Grid>
          <Grid size={{ xs: 12, md: 8 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle1">Photo {slot}</Typography>
              <Typography variant="caption" color="text.secondary">
                AI: {aiVerdict ?? "—"}
              </Typography>
              <FormControl disabled={readOnly} error={missing}>
                <Typography
                  variant="body2"
                  sx={{ mb: 1 }}
                  color={missing ? "error.main" : "text.primary"}
                >
                  Physician verdict {missing && "*"}
                </Typography>
                <RadioGroup row value={value} onChange={(_, v) => onChange(v)}>
                  {verdictAnswers.map((a) => (
                    <FormControlLabel key={a.uuid} value={a.name} control={<Radio />} label={a.name} />
                  ))}
                </RadioGroup>
                {missing && (
                  <FormHelperText>Physician verdict is required.</FormHelperText>
                )}
              </FormControl>
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
  PHOTO_SLOTS.forEach((slot) => {
    const v = obs[PHOTO_CONCEPTS[slot].physicianVerdict.name];
    if (typeof v === "string") photoVerdicts[slot] = v;
  });
  return {
    photoVerdicts,
    opmdDiagnoses: Array.isArray(obs[REVIEW_CONCEPTS.opmdDiagnoses.name])
      ? (obs[REVIEW_CONCEPTS.opmdDiagnoses.name] as string[])
      : [],
    recommendedAction: (obs[REVIEW_CONCEPTS.recommendedAction.name] as string) ?? "",
    notes: (obs[REVIEW_CONCEPTS.notes.name] as string) ?? "",
  };
}
