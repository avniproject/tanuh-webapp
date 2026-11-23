// What a form screen needs after every change: the answers with the form's computed values written
// in, each question's status, what is still missing, and each section's progress.
import type { AnswerValue, Answers, FieldValue, Row } from "./answers";
import { isBlank } from "./answers";
import type { ElementDef, FormDef, PageDef } from "./formDef";
import { allElements, childrenOf, isQuestionGroup, isReadOnly } from "./formDef";
import { isVisible, runFormRules, statusKey, type Statuses, type Subject, type VisitDraft } from "./ruleRunner";

export interface FormView {
  answers: Answers;
  statuses: Statuses;
}

function computed(element: ElementDef, value: unknown): FieldValue | undefined {
  if (value === null || value === undefined) return undefined;
  const { concept } = element;
  if (concept.dataType === "Coded") {
    // A rule names a coded answer by its name or its uuid.
    const one = (v: unknown) => concept.answers.find((a) => a.uuid === v || a.name === v)?.uuid;
    if (Array.isArray(value)) return value.map(one).filter((u): u is string => !!u);
    return one(value);
  }
  if (concept.dataType === "Numeric") return typeof value === "number" ? value : Number(value);
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Runs the form's rules and writes any value a rule computes into the answers. A computed value
 * can decide another question, so the rules run again until nothing changes (three passes at most).
 */
export function evaluate(form: FormDef, answers: Answers, subject: Subject, draft: VisitDraft): FormView {
  let current = answers;
  let statuses = runFormRules(form, current, subject, draft);
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    const next: Answers = { ...current };
    for (const e of allElements(form)) {
      if (e.parentUuid) continue;
      const value = computed(e, statuses.get(statusKey(e.uuid))?.value);
      if (value === undefined || JSON.stringify(next[e.concept.uuid]) === JSON.stringify(value)) continue;
      next[e.concept.uuid] = value;
      changed = true;
    }
    if (!changed) break;
    current = next;
    statuses = runFormRules(form, current, subject, draft);
  }
  return { answers: current, statuses };
}

export interface Missing {
  element: ElementDef;
  /** The row of its question group, for a row field. */
  row?: number;
}

const rowsOf = (answers: Answers, group: ElementDef): Row[] => (answers[group.concept.uuid] as Row[] | undefined) ?? [];

/** Every visible mandatory question still unanswered. A question group's row fields count once per row. */
export function missingMandatory(form: FormDef, statuses: Statuses, answers: Answers): Missing[] {
  const missing: Missing[] = [];
  for (const e of allElements(form)) {
    if (e.parentUuid || !isVisible(statuses, e)) continue;
    if (isQuestionGroup(e)) {
      const rows = rowsOf(answers, e);
      if (e.mandatory && rows.length === 0) missing.push({ element: e });
      rows.forEach((row, i) => {
        for (const child of childrenOf(form, e)) {
          if (child.mandatory && isVisible(statuses, child, i) && isBlank(row[child.concept.uuid])) {
            missing.push({ element: child, row: i });
          }
        }
      });
      continue;
    }
    if (e.mandatory && isBlank(answers[e.concept.uuid] as AnswerValue | undefined)) missing.push({ element: e });
  }
  return missing;
}

export interface SectionProgress {
  /** Visible mandatory questions in the section, and how many of them are answered. */
  total: number;
  done: number;
  /** No question of the section applies to this woman. */
  notApplicable: boolean;
}

export function sectionProgress(form: FormDef, page: PageDef, view: FormView): SectionProgress {
  const visible = page.elements.filter((e) => !e.parentUuid && isVisible(view.statuses, e));
  const inPage = new Set(page.elements.map((e) => e.uuid));
  const missing = missingMandatory(form, view.statuses, view.answers).filter((m) => inPage.has(m.element.uuid));
  let total = 0;
  for (const e of visible) {
    if (isQuestionGroup(e)) {
      if (e.mandatory) total++;
      rowsOf(view.answers, e).forEach((_, i) => {
        total += childrenOf(form, e).filter((c) => c.mandatory && isVisible(view.statuses, c, i)).length;
      });
    } else if (e.mandatory) total++;
  }
  // A section showing only values the form computes has nothing to ask.
  const asks = visible.some((e) => !isReadOnly(e));
  return { total, done: total - Math.min(missing.length, total), notApplicable: !asks };
}

/** Progress over the whole form, for the bar at the foot of the screen. */
export function formProgress(form: FormDef, view: FormView): { total: number; done: number } {
  return form.pages
    .map((p) => sectionProgress(form, p, view))
    .reduce((sum, p) => ({ total: sum.total + p.total, done: sum.done + p.done }), { total: 0, done: 0 });
}
