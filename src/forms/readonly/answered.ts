import type { AnswerValue, Answers, FieldValue, Row } from "@/forms/engine/answers";
import { isBlank } from "@/forms/engine/answers";
import type { ElementDef, FormDef } from "@/forms/engine/formDef";
import { childrenOf, isQuestionGroup } from "@/forms/engine/formDef";

/** An answer as words: a coded answer by its name, several joined, a date as a day. */
export function readable(element: ElementDef, value: FieldValue | undefined): string {
  if (isBlank(value)) return "";
  const { concept } = element;
  if (concept.dataType === "Coded") {
    return (Array.isArray(value) ? value : [value])
      .map((u) => concept.answers.find((a) => a.uuid === u)?.name ?? "")
      .filter(Boolean)
      .join(", ");
  }
  if (concept.dataType === "Date" && typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  return `${String(value)}${concept.unit ? ` ${concept.unit}` : ""}`;
}

export interface AnsweredSection {
  name: string;
  rows: Array<{ element: ElementDef; text: string } | { element: ElementDef; records: Array<Array<{ element: ElementDef; text: string }>> }>;
}

/**
 * The answered questions of a visit, section by section in the form's order. A question with no
 * answer is left out: it was skipped by the form's logic or not asked.
 */
export function answeredSections(form: FormDef, answers: Answers, skip: ReadonlySet<string> = new Set()): AnsweredSection[] {
  return form.pages
    .map((page) => ({
      name: page.name,
      rows: page.elements
        .filter((e) => !e.parentUuid && !skip.has(e.concept.name))
        .map((e) => {
          const value = answers[e.concept.uuid] as AnswerValue | undefined;
          if (isQuestionGroup(e)) {
            const records = ((value as Row[] | undefined) ?? [])
              .map((row) =>
                childrenOf(form, e)
                  .map((k) => ({ element: k, text: readable(k, row[k.concept.uuid]) }))
                  .filter((f) => f.text !== ""),
              )
              .filter((r) => r.length > 0);
            return records.length ? { element: e, records } : null;
          }
          const text = readable(e, value as FieldValue | undefined);
          return text === "" ? null : { element: e, text };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null),
    }))
    .filter((s) => s.rows.length > 0);
}
