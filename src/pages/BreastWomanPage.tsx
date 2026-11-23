import { Box, ButtonBase, CircularProgress, Stack, Typography } from "@mui/material";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import { invalidateEncounterSweeps, listEncounters, patchEncounter, scheduleEncounter, submitEncounter } from "@/api/encounters";
import { useAuth } from "@/auth/authContext";
import { BREAST_OBS, BREAST_VISITS, CLINICIAN_FORMS, type ClinicianFormKey } from "@/breast/breastConcepts";
import { formVisitFor, placeName, type FormStatus } from "@/breast/breastList";
import { deleteDraft, loadDraft, saveDraft, type DraftScope } from "@/breast/drafts";
import { submitClinicianForm } from "@/breast/submit";
import { Card, FormStatusPill, Pill, PillButton, RiskPill } from "@/breast/ui";
import { loadWomanCase, registryOf, ruleSubject, visitAnswers, type WomanCase } from "@/breast/womanCase";
import type { Answers } from "@/forms/engine/answers";
import type { FormView } from "@/forms/engine/formState";
import type { VisitDraft } from "@/forms/engine/ruleRunner";
import { FormAnswers } from "@/forms/readonly/FormAnswers";
import { AvniForm } from "@/forms/screen/AvniForm";
import { CR, crText } from "@/theme/tokens";

type Step = "responses" | ClinicianFormKey;

const MODEL_ANSWERS = new Set<string>([BREAST_OBS.riskClass]);

function Crumbs({ subjectId }: { subjectId: string }) {
  return (
    <Stack component="nav" aria-label="Breadcrumb" direction="row" spacing={1} sx={{ mb: 2, fontFamily: CR.font, fontSize: 14 }}>
      <Box component={RouterLink} to="/breast" sx={{ color: CR.heading, fontWeight: 500, textDecoration: "none", "&:hover": { textDecoration: "underline" } }}>
        Breast Cancer Screening
      </Box>
      <Box sx={{ color: CR.textMuted }}>/</Box>
      <Box sx={{ color: CR.textSecondary }}>Subject {subjectId}</Box>
    </Stack>
  );
}

function ModelLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={{ xs: 0.25, sm: 2 }} sx={{ py: 1.1, borderTop: `1px solid ${CR.divider}` }}>
      <Typography sx={{ flex: "0 0 52%", fontFamily: CR.font, fontSize: 14, color: CR.textSecondary }}>{label}</Typography>
      <Box sx={{ fontFamily: CR.font, fontSize: 14, fontWeight: 500, color: CR.text, overflowWrap: "anywhere" }}>{value}</Box>
    </Stack>
  );
}

/** What the screening form worked out by rule, apart from what the field worker answered. */
function ModelPanel({ woman }: { woman: WomanCase }) {
  const obs = woman.screening.observations ?? {};
  const probability = obs[BREAST_OBS.riskProbability];
  const model = obs[BREAST_OBS.riskModel];
  const hospital = placeName(obs[BREAST_OBS.facility]) ?? (obs[BREAST_OBS.otherFacility] as string | undefined);
  return (
    <Box>
      <Typography component="h3" sx={{ mb: 0.5, fontFamily: CR.font, fontSize: 16, fontWeight: 600, color: CR.heading }}>
        Risk and referral · calculated by form rule
      </Typography>
      <ModelLine label="PS Risk Class" value={<RiskPill risk={(obs[BREAST_OBS.riskClass] as string) ?? null} />} />
      <ModelLine label="PS Risk Probability" value={typeof probability === "number" ? `${(probability * 100).toFixed(1)}%` : "Not calculated"} />
      <ModelLine label="PS Risk Model" value={typeof model === "string" ? model : "Not recorded"} />
      <ModelLine label="Referral decision" value={obs[BREAST_OBS.refer] === "Yes" ? "Referred" : "Not referred"} />
      <ModelLine label="Referred to" value={hospital || "Not recorded"} />
    </Box>
  );
}

export function BreastWomanPage() {
  const { screeningUuid = "" } = useParams();
  const { state } = useAuth();
  const user = state.status === "ready" ? state.user : null;
  const scope: DraftScope = useMemo(
    () => ({ orgId: user?.organisationId, userUuid: user?.userUUID ?? "" }),
    [user?.organisationId, user?.userUUID],
  );
  const [woman, setWoman] = useState<WomanCase | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("responses");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState<Record<string, string>>({});
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    loadWomanCase(screeningUuid)
      .then((w) => !cancelled && setWoman(w))
      .catch((e: unknown) => !cancelled && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [screeningUuid, reload]);

  const registry = useMemo(() => (woman ? registryOf(woman) : null), [woman]);
  const subject = useMemo(() => (woman && registry ? ruleSubject(woman, registry) : null), [woman, registry]);
  // One visit under edit per form, with a stable id and time for as long as the page is open.
  const drafts = useRef<Partial<Record<ClinicianFormKey, VisitDraft>>>({});

  // Every change is kept at once: a write this small is instant, and a delayed one was lost when
  // the clinician left the page or changed step within the delay.
  const keepDraft = useCallback(
    (formKey: ClinicianFormKey, answers: Answers) => {
      const kept = saveDraft(window.localStorage, scope, screeningUuid, formKey, answers);
      setDraftSaved((d) => (!!d[formKey] === kept ? d : { ...d, [formKey]: kept ? new Date().toISOString() : "" }));
    },
    [scope, screeningUuid],
  );

  if (loadError) {
    return (
      <Box sx={crText}>
        <Crumbs subjectId="" />
        <Card sx={{ p: 4 }}>
          <Typography sx={{ fontFamily: CR.font, color: CR.error }}>This woman's record could not be opened: {loadError}</Typography>
          <Box sx={{ mt: 2 }}>
            <PillButton onClick={() => setReload((n) => n + 1)}>Try again</PillButton>
          </Box>
        </Card>
      </Box>
    );
  }
  if (!woman || !registry || !subject) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", height: "50vh" }}>
        <CircularProgress sx={{ color: CR.brand }} />
      </Box>
    );
  }

  const obs = woman.screening.observations ?? {};
  const encounterId = typeof obs[BREAST_OBS.encounterId] === "string" ? (obs[BREAST_OBS.encounterId] as string) : "";
  const subjectId = encounterId.replace(new RegExp(`${BREAST_VISITS.screening.idCode}\\d+$`), "") || woman.subject.ID.slice(0, 8);
  const hospital = placeName(obs[BREAST_OBS.facility]) ?? (obs[BREAST_OBS.otherFacility] as string | undefined) ?? null;
  const screenedBy = woman.screening.audit?.["Created by"];
  const screenedOn = format(new Date(woman.screening["Encounter date time"]!), "d MMM yyyy");

  const statusOf = (formKey: ClinicianFormKey): FormStatus =>
    woman.submitted[formKey]
      ? "submitted"
      : draftSaved[formKey] || loadDraft(window.localStorage, scope, screeningUuid, formKey)
        ? "draft"
        : "not_started";
  const stepLine = (formKey: ClinicianFormKey): string => {
    const s = statusOf(formKey);
    if (s === "submitted") return "Submitted to Avni";
    return s === "draft" ? "Draft · kept in this browser" : "Not started";
  };

  const submit = async (formKey: ClinicianFormKey, view: FormView) => {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const existing = woman.submitted[formKey] ?? woman.booked[formKey];
    const result = await submitClinicianForm(
      {
        formKey,
        form: woman.forms[formKey],
        view,
        subject: woman.subject,
        screening: woman.screening,
        existing,
        siblings: woman.visits[formKey],
        openClinicianVisit: !!woman.booked.clinician,
        places: woman.places,
        now: new Date(),
      },
      {
        create: (body) => submitEncounter(null, body),
        findSubmitted: async () => {
          const now = await listEncounters({
            encounterType: BREAST_VISITS[formKey].name,
            subjectId: woman.subject.ID,
            size: 100,
          });
          return formVisitFor(woman.screening, now.content);
        },
        patch: patchEncounter,
        schedule: scheduleEncounter,
        onSaved: () => {
          deleteDraft(window.localStorage, scope, screeningUuid, formKey);
          setDraftSaved((d) => ({ ...d, [formKey]: "" }));
          invalidateEncounterSweeps();
        },
      },
    );
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      if (result.stale) {
        drafts.current = {};
        setWoman(null);
        setReload((n) => n + 1);
      }
      return;
    }
    setNotice(result.warning ?? `${CLINICIAN_FORMS[formKey].title} saved to Avni.`);
    // What is on screen is now older than Avni. Drop it and load afresh, so the form redraws from
    // the saved visit and a second save cannot be built from, or sent to, what was there before.
    drafts.current = {};
    setWoman(null);
    setReload((n) => n + 1);
    if (formKey === "assessment" && !woman.submitted.clinician) setStep("clinician");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const formStep = (formKey: ClinicianFormKey) => {
    const submitted = woman.submitted[formKey];
    const kept = submitted ? null : loadDraft(window.localStorage, scope, screeningUuid, formKey);
    const visit = (drafts.current[formKey] ??= {
      uuid: submitted?.ID ?? woman.booked[formKey]?.ID ?? `new-${formKey}`,
      encounterType: BREAST_VISITS[formKey].name,
      encounterDateTime: submitted?.["Encounter date time"] ? new Date(submitted["Encounter date time"]) : new Date(),
    });
    const saved = draftSaved[formKey];
    return (
      <AvniForm
        // A reload after a save, or another form, starts the screen from what Avni now holds.
        key={`${formKey}-${submitted?.ID ?? "new"}-${reload}`}
        form={woman.forms[formKey]}
        subject={subject}
        draft={visit}
        initialAnswers={kept?.answers ?? visitAnswers(submitted, registry)}
        places={woman.places}
        placesFailed={woman.placesFailed}
        submitLabel={submitted ? "Update in Avni" : CLINICIAN_FORMS[formKey].submit}
        savedNote={
          submitted
            ? `Submitted to Avni on ${format(new Date(submitted["Encounter date time"]!), "d MMM yyyy")}`
            : saved
              ? "Draft saved in this browser"
              : kept
                ? `Draft from ${format(new Date(kept.savedAt), "d MMM, HH:mm")}`
                : null
        }
        readOnly={false}
        submitting={submitting}
        error={error}
        onChange={(answers) => keepDraft(formKey, answers)}
        onSubmit={(view) => void submit(formKey, view)}
      />
    );
  };

  const goTo = (next: Step) => {
    setStep(next);
    setError(null);
    window.scrollTo({ top: 0 });
  };

  const steps: Array<{ key: Step; title: string; line: string }> = [
    { key: "responses", title: "Screening responses", line: "Read-only · from Avni" },
    { key: "assessment", title: CLINICIAN_FORMS.assessment.title, line: stepLine("assessment") },
    { key: "clinician", title: CLINICIAN_FORMS.clinician.title, line: stepLine("clinician") },
  ];

  return (
    <Box sx={{ ...crText, maxWidth: 1280, mx: "auto" }}>
      <Crumbs subjectId={subjectId} />

      <Card sx={{ p: { xs: 2, sm: 3 }, mb: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flexWrap: "wrap", rowGap: 1 }}>
          <Typography component="h1" sx={{ fontFamily: CR.font, fontSize: 24, fontWeight: 600, color: CR.heading }}>
            Subject {subjectId}
          </Typography>
          <RiskPill risk={(obs[BREAST_OBS.riskClass] as string) ?? null} prefix="AI · " />
          {hospital && <Pill tone="idle">Referred to {hospital}</Pill>}
        </Stack>
        <Typography sx={{ mt: 0.75, fontFamily: CR.font, fontSize: 14, color: CR.textSecondary }}>
          {typeof obs[BREAST_OBS.age] === "number" ? `${obs[BREAST_OBS.age] as number} years · ` : ""}
          Screened {screenedOn}
          {screenedBy ? ` by ${screenedBy}` : ""}
          {encounterId ? ` · ${encounterId}` : ""}
        </Typography>
        {woman.newerScreening && (
          <Box role="status" sx={{ mt: 1.5, px: 2, py: 1, borderRadius: CR.radius.panel, bgcolor: "#fff4e0", color: "#8a5a00", fontFamily: CR.font, fontSize: 14 }}>
            She has been screened again since this screening.
          </Box>
        )}
      </Card>

      {notice && (
        <Box role="status" sx={{ mb: 2, px: 2.5, py: 1.25, borderRadius: CR.radius.panel, bgcolor: "#dff3e8", color: "#17603b", fontFamily: CR.font, fontSize: 14 }}>
          {notice}
        </Box>
      )}

      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} role="tablist" aria-label="Steps" sx={{ mb: 2.5 }}>
        {steps.map((s, i) => {
          const on = step === s.key;
          return (
            <ButtonBase
              key={s.key}
              role="tab"
              aria-selected={on}
              onClick={() => goTo(s.key)}
              sx={{
                flex: 1,
                justifyContent: "flex-start",
                gap: 1.5,
                p: 2,
                textAlign: "left",
                borderRadius: CR.radius.card,
                bgcolor: on ? CR.selected : CR.surface,
                border: `1.5px solid ${on ? CR.brand : CR.border}`,
                "&:hover": { bgcolor: on ? CR.selected : CR.navHover },
                "&:focus-visible": { outline: `2px solid ${CR.brand}`, outlineOffset: 2 },
              }}
            >
              <Box
                aria-hidden
                sx={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                  bgcolor: on ? CR.brand : CR.divider,
                  color: on ? "#fff" : CR.textSecondary,
                  fontFamily: CR.font,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {i + 1}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontFamily: CR.font, fontSize: 15, fontWeight: 600, color: on ? CR.heading : CR.text }}>{s.title}</Typography>
                <Typography sx={{ fontFamily: CR.font, fontSize: 13, color: CR.textSecondary }}>{s.line}</Typography>
              </Box>
            </ButtonBase>
          );
        })}
      </Stack>

      {step === "responses" && (
        <Card sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1040 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2, flexWrap: "wrap", rowGap: 1 }}>
            <Typography component="h2" sx={{ fontFamily: CR.font, fontSize: 20, fontWeight: 600, color: CR.heading }}>
              {woman.forms.screening.name}
            </Typography>
            <Pill tone="idle">Read-only · from Avni</Pill>
          </Stack>
          <Stack spacing={2.5}>
            <FormAnswers form={woman.forms.screening} answers={visitAnswers(woman.screening, registry)} skip={MODEL_ANSWERS} />
            <ModelPanel woman={woman} />
          </Stack>
          <Stack direction="row" justifyContent="flex-end" sx={{ mt: 3 }}>
            <PillButton variant="filled" onClick={() => goTo("assessment")}>
              Continue to additional assessment
            </PillButton>
          </Stack>
        </Card>
      )}
      {step !== "responses" && (
        <Box>
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2, flexWrap: "wrap", rowGap: 1 }}>
            <Typography component="h2" sx={{ fontFamily: CR.font, fontSize: 20, fontWeight: 600, color: CR.heading }}>
              {CLINICIAN_FORMS[step].title}
            </Typography>
            <FormStatusPill status={statusOf(step)} />
            <Typography sx={{ fontFamily: CR.font, fontSize: 13, color: CR.textSecondary }}>{woman.forms[step].name} · from Avni</Typography>
          </Stack>
          {formStep(step)}
        </Box>
      )}
    </Box>
  );
}
