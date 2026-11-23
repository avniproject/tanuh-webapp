import { Box, ButtonBase, Stack, Typography } from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AnswerValue, Answers, FieldValue, Row } from "@/forms/engine/answers";
import type { ElementDef, FormDef, PageDef } from "@/forms/engine/formDef";
import { childrenOf, isQuestionGroup, keyValue } from "@/forms/engine/formDef";
import { evaluate, formProgress, missingMandatory, sectionProgress, type FormView } from "@/forms/engine/formState";
import { isVisible, statusKey, type Subject, type VisitDraft } from "@/forms/engine/ruleRunner";
import { CR } from "@/theme/tokens";
import { Field, type PlaceOption } from "./fields";

interface Props {
  form: FormDef;
  subject: Subject;
  draft: VisitDraft;
  initialAnswers: Answers;
  places: PlaceOption[];
  placesFailed: boolean;
  submitLabel: string;
  /** Under the progress bar: "Draft saved just now", "Submitted to Avni", … */
  savedNote: string | null;
  /** The clinician may read the form but not save it. */
  readOnly: boolean;
  submitting: boolean;
  error: string | null;
  /** Every change, with the form's computed values written in: the page keeps the draft. */
  onChange: (answers: Answers) => void;
  onSubmit: (view: FormView) => void;
}

const sectionId = (page: PageDef): string => `section-${page.uuid}`;

function Section({
  index,
  page,
  notApplicable,
  children,
}: {
  index: number;
  page: PageDef;
  notApplicable: boolean;
  children: React.ReactNode;
}) {
  return (
    <Box
      component="section"
      id={sectionId(page)}
      aria-labelledby={`${sectionId(page)}-title`}
      sx={{
        bgcolor: CR.surface,
        border: `1px solid ${CR.border}`,
        borderRadius: CR.radius.card,
        p: { xs: 2, sm: 3 },
        scrollMarginTop: 96,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: notApplicable ? 0.5 : 1 }}>
        <Box
          aria-hidden
          sx={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            bgcolor: notApplicable ? CR.divider : CR.selected,
            color: notApplicable ? CR.textSecondary : CR.heading,
            display: "grid",
            placeItems: "center",
            fontFamily: CR.font,
            fontSize: 13,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {index}
        </Box>
        <Typography
          id={`${sectionId(page)}-title`}
          component="h3"
          sx={{ fontFamily: CR.font, fontSize: 18, fontWeight: 600, color: notApplicable ? CR.textSecondary : CR.heading }}
        >
          {page.name}
        </Typography>
      </Stack>
      {notApplicable ? (
        <Typography sx={{ fontFamily: CR.font, fontSize: 14, color: CR.textSecondary }}>
          Not applicable. None of these questions apply, going by the answers so far.
        </Typography>
      ) : (
        children
      )}
    </Box>
  );
}

/**
 * A form drawn from its Avni definition: scrollable sections with a section list, the form's own
 * show/hide rules run on every change, and a bar at the foot with progress and the submit button.
 */
export function AvniForm({
  form,
  subject,
  draft,
  initialAnswers,
  places,
  placesFailed,
  submitLabel,
  savedNote,
  readOnly,
  submitting,
  error,
  onChange,
  onSubmit,
}: Props) {
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [attempted, setAttempted] = useState(false);
  const view = useMemo(() => evaluate(form, answers, subject, draft), [form, answers, subject, draft]);
  const missing = useMemo(() => missingMandatory(form, view.statuses, view.answers), [form, view]);
  const missingKeys = useMemo(() => new Set(missing.map((m) => statusKey(m.element.uuid, m.row))), [missing]);
  const progress = formProgress(form, view);
  const sections = form.pages.map((page) => ({ page, progress: sectionProgress(form, page, view) }));

  // The first render only shows what was loaded; a change after that is the clinician's.
  const touched = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (touched.current) onChangeRef.current(view.answers);
  }, [view.answers]);

  const set = (conceptUuid: string, value: AnswerValue | undefined) => {
    touched.current = true;
    setAnswers((a) => ({ ...a, [conceptUuid]: value }));
  };
  const rowsOf = (group: ElementDef): Row[] => (view.answers[group.concept.uuid] as Row[] | undefined) ?? [];
  const setRow = (group: ElementDef, index: number, conceptUuid: string, value: FieldValue | undefined) =>
    set(
      group.concept.uuid,
      rowsOf(group).map((row, i) => (i === index ? { ...row, [conceptUuid]: value } : row)),
    );

  const submit = () => {
    setAttempted(true);
    if (missing.length) {
      const first = form.pages.find((p) => p.elements.some((e) => e.uuid === missing[0].element.uuid));
      if (first) document.getElementById(sectionId(first))?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    onSubmit(view);
  };

  const field = (element: ElementDef, group?: ElementDef, row?: number) => {
    if (!isVisible(view.statuses, element, row)) return null;
    const value = group
      ? rowsOf(group)[row!]?.[element.concept.uuid]
      : (view.answers[element.concept.uuid] as FieldValue | undefined);
    return (
      <Field
        key={statusKey(element.uuid, row)}
        id={`q-${statusKey(element.uuid, row)}`}
        element={element}
        value={value}
        status={view.statuses.get(statusKey(element.uuid, row))}
        disabled={readOnly || submitting}
        places={places}
        placesFailed={placesFailed}
        required={attempted && missingKeys.has(statusKey(element.uuid, row))}
        onChange={(v) => (group ? setRow(group, row!, element.concept.uuid, v) : set(element.concept.uuid, v))}
      />
    );
  };

  const group = (element: ElementDef) => {
    if (!isVisible(view.statuses, element)) return null;
    const rows = rowsOf(element);
    const kids = childrenOf(form, element);
    const repeatable = keyValue(element, "repeatable") === true;
    return (
      <Box key={element.uuid} sx={{ py: 1.5 }} data-field={element.uuid}>
        <Typography sx={{ mb: 1, fontFamily: CR.font, fontSize: 15, fontWeight: 500, color: CR.text }}>
          {element.name}
        </Typography>
        <Stack spacing={1.5}>
          {rows.map((_, i) => (
            <Box
              key={i}
              sx={{ border: `1px solid ${CR.border}`, borderRadius: CR.radius.panel, bgcolor: CR.hover, px: 2, py: 1 }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography sx={{ fontFamily: CR.font, fontSize: 13, fontWeight: 600, color: CR.textSecondary }}>
                  Record {i + 1}
                </Typography>
                {!readOnly && (
                  <ButtonBase
                    onClick={() =>
                      set(
                        element.concept.uuid,
                        rows.filter((__, k) => k !== i),
                      )
                    }
                    sx={{ px: 1.5, py: 0.5, borderRadius: CR.radius.pill, fontFamily: CR.font, fontSize: 13, color: CR.error }}
                  >
                    Remove
                  </ButtonBase>
                )}
              </Stack>
              {kids.map((k) => field(k, element, i))}
            </Box>
          ))}
        </Stack>
        {!readOnly && (repeatable || rows.length === 0) && (
          <ButtonBase
            onClick={() => set(element.concept.uuid, [...rows, {}])}
            sx={{
              mt: 1.5,
              px: 2,
              height: 38,
              borderRadius: CR.radius.pill,
              border: `1.5px dashed ${CR.brand}`,
              fontFamily: CR.font,
              fontSize: 14,
              fontWeight: 600,
              color: CR.heading,
              "&:focus-visible": { outline: `2px solid ${CR.brand}`, outlineOffset: 2 },
            }}
          >
            {rows.length ? "Add another record" : "Add a record"}
          </ButtonBase>
        )}
      </Box>
    );
  };

  return (
    <Box>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2.5} alignItems="flex-start">
        <Box
          component="nav"
          aria-label="Sections"
          sx={{
            width: { xs: "100%", md: 240 },
            flexShrink: 0,
            position: { md: "sticky" },
            top: { md: 96 },
            bgcolor: CR.surface,
            border: `1px solid ${CR.border}`,
            borderRadius: CR.radius.card,
            p: 1.5,
          }}
        >
          <Typography sx={{ px: 1, pb: 1, fontFamily: CR.font, fontSize: 13, fontWeight: 600, color: CR.textSecondary }}>
            Sections
          </Typography>
          {sections.map(({ page, progress: p }) => {
            const complete = !p.notApplicable && p.total > 0 && p.done === p.total;
            return (
              <ButtonBase
                key={page.uuid}
                onClick={() => document.getElementById(sectionId(page))?.scrollIntoView({ behavior: "smooth", block: "start" })}
                sx={{
                  width: "100%",
                  justifyContent: "flex-start",
                  gap: 1,
                  px: 1,
                  py: 0.9,
                  borderRadius: "12px",
                  textAlign: "left",
                  "&:hover": { bgcolor: CR.navHover },
                  "&:focus-visible": { outline: `2px solid ${CR.brand}`, outlineOffset: 2 },
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    flexShrink: 0,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#fff",
                    bgcolor: complete ? CR.brand : "transparent",
                    border: `1.5px solid ${complete ? CR.brand : CR.inputBorder}`,
                  }}
                >
                  {complete ? "✓" : ""}
                </Box>
                <Typography
                  sx={{
                    flexGrow: 1,
                    fontFamily: CR.font,
                    fontSize: 13.5,
                    lineHeight: 1.3,
                    color: p.notApplicable ? CR.textMuted : CR.textTertiary,
                  }}
                >
                  {page.name}
                </Typography>
                <Typography sx={{ fontFamily: CR.font, fontSize: 12, color: CR.textSecondary, whiteSpace: "nowrap" }}>
                  {p.notApplicable ? "N/A" : p.total === 0 ? "Optional" : `${p.done}/${p.total}`}
                </Typography>
              </ButtonBase>
            );
          })}
        </Box>

        <Stack spacing={2} sx={{ flexGrow: 1, minWidth: 0, width: "100%", maxWidth: 860 }}>
          {sections.map(({ page, progress: p }, i) => (
            <Section key={page.uuid} index={i + 1} page={page} notApplicable={p.notApplicable}>
              {page.elements.filter((e) => !e.parentUuid).map((e) => (isQuestionGroup(e) ? group(e) : field(e)))}
            </Section>
          ))}
        </Stack>
      </Stack>

      <Box
        sx={{
          position: "sticky",
          bottom: 16,
          mt: 3,
          bgcolor: CR.surface,
          border: `1px solid ${CR.border}`,
          borderRadius: CR.radius.card,
          boxShadow: CR.shadow,
          px: { xs: 2, sm: 3 },
          py: 1.75,
          zIndex: 2,
        }}
      >
        {error && (
          <Box
            role="alert"
            sx={{ mb: 1.25, px: 2, py: 1, borderRadius: CR.radius.panel, bgcolor: CR.errorSubtle, color: CR.error, fontFamily: CR.font, fontSize: 14 }}
          >
            {error}
          </Box>
        )}
        {attempted && missing.length > 0 && (
          <Box
            role="alert"
            sx={{ mb: 1.25, px: 2, py: 1, borderRadius: CR.radius.panel, bgcolor: CR.errorSubtle, color: CR.error, fontFamily: CR.font, fontSize: 14 }}
          >
            {missing.length} required {missing.length === 1 ? "answer is" : "answers are"} missing. They are marked in the form.
          </Box>
        )}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Box
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              aria-label="Required answers given"
              sx={{ height: 6, borderRadius: 3, bgcolor: CR.divider, overflow: "hidden" }}
            >
              <Box
                sx={{
                  height: "100%",
                  width: `${progress.total ? (progress.done / progress.total) * 100 : 100}%`,
                  bgcolor: CR.brand,
                  transition: "width .2s",
                }}
              />
            </Box>
            <Typography sx={{ mt: 0.75, fontFamily: CR.font, fontSize: 13, color: CR.textSecondary }}>
              {progress.done} of {progress.total} required answered
              {savedNote ? ` · ${savedNote}` : ""}
            </Typography>
          </Box>
          {!readOnly && (
            <ButtonBase
              onClick={submit}
              disabled={submitting}
              sx={{
                px: 3,
                height: 46,
                borderRadius: CR.radius.pill,
                bgcolor: CR.brand,
                color: "#fff",
                fontFamily: CR.font,
                fontSize: 15,
                fontWeight: 600,
                whiteSpace: "nowrap",
                "&:hover": { bgcolor: CR.brandPressed },
                "&:focus-visible": { outline: `2px solid ${CR.brand}`, outlineOffset: 2 },
                "&.Mui-disabled": { opacity: 0.6 },
              }}
            >
              {submitting ? "Saving…" : submitLabel}
            </ButtonBase>
          )}
        </Stack>
      </Box>
    </Box>
  );
}
