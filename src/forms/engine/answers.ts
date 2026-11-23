// The clinician's answers while a form is open, keyed by concept uuid.
//   coded, single: the answer's uuid        coded, multi: answer uuids
//   numeric: a number                        text, notes, date, location: a string
//   question group: one object per row, its fields keyed the same way
import type { ConceptDef, ElementDef, FormDef } from "./formDef";
import { allElements, childrenOf, isQuestionGroup } from "./formDef";

export type FieldValue = string | number | string[];
export type Row = Record<string, FieldValue | undefined>;
export type AnswerValue = FieldValue | Row[];
export type Answers = Record<string, AnswerValue | undefined>;

export const isBlank = (v: unknown): boolean =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** Concepts of the forms on screen, by uuid and by name: the external API names answers, rules use uuids. */
export class ConceptRegistry {
  private byUuid = new Map<string, ConceptDef>();
  private byName = new Map<string, ConceptDef>();

  add(form: FormDef): this {
    for (const e of allElements(form)) {
      this.byUuid.set(e.concept.uuid, e.concept);
      this.byName.set(e.concept.name, e.concept);
    }
    return this;
  }
  uuid(uuid: string): ConceptDef | undefined {
    return this.byUuid.get(uuid);
  }
  name(name: string): ConceptDef | undefined {
    return this.byName.get(name);
  }
}

/** The data types the app can show, take an answer for, and send back unchanged. */
const READABLE = new Set(["Coded", "Numeric", "Text", "Notes", "Date", "DateTime", "Location", "Id"]);

/** `lossy`: the stored value was not taken over whole, so it must never be written back from here. */
function fieldFromApi(concept: ConceptDef, value: unknown): { value: FieldValue | undefined; lossy: boolean } {
  if (value === null || value === undefined) return { value: undefined, lossy: false };
  if (!READABLE.has(concept.dataType)) return { value: undefined, lossy: true };
  if (concept.dataType === "Coded") {
    // One stored answer comes back as a name, a stored list as a list of names, whatever the question's type.
    const names = Array.isArray(value) ? value : [value];
    const uuids = names.map((n) => concept.answers.find((a) => a.name === n)?.uuid).filter((u): u is string => !!u);
    const lossy = uuids.length !== names.length;
    if (!uuids.length) return { value: undefined, lossy };
    return { value: Array.isArray(value) ? uuids : uuids[0], lossy };
  }
  if (concept.dataType === "Numeric") {
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    return Number.isFinite(n) ? { value: n, lossy: false } : { value: undefined, lossy: true };
  }
  if (concept.dataType === "Location") {
    // {typeName: title}, the place itself first. The title is for display only: it is not the stored
    // value (an address uuid), so it is never sent back (see submit.ts).
    if (typeof value === "object" && !Array.isArray(value)) {
      const titles = Object.values(value as Record<string, unknown>).filter((v) => typeof v === "string");
      return { value: titles.length ? String(titles[0]) : undefined, lossy: true };
    }
    return { value: typeof value === "string" ? value : undefined, lossy: true };
  }
  if (typeof value === "string" || typeof value === "number") return { value: String(value), lossy: false };
  return { value: undefined, lossy: true };
}

export interface ReadAnswers {
  answers: Answers;
  /** Concept uuids of questions whose stored answer was not read in full (an answer or a record field the
   *  form does not know, a kind of value the app does not handle). A save leaves these as Avni has them. */
  unmapped: Set<string>;
}

/** An encounter's observations as the external API returns them (by concept name) → answers by uuid. */
export function answersFromApi(observations: Record<string, unknown>, registry: ConceptRegistry): ReadAnswers {
  const answers: Answers = {};
  const unmapped = new Set<string>();
  for (const [name, value] of Object.entries(observations ?? {})) {
    const concept = registry.name(name);
    if (!concept || value === null || value === undefined) continue;
    if (concept.dataType === "QuestionGroup") {
      // Avni's apps store a repeatable group as a list of records. Anything else (a single group is
      // an object keyed by field uuid) is not understood here and is left alone.
      if (!Array.isArray(value) || value.some((r) => !r || typeof r !== "object" || Array.isArray(r))) {
        unmapped.add(concept.uuid);
        continue;
      }
      answers[concept.uuid] = (value as Array<Record<string, unknown>>).map((r) => {
        const row: Row = {};
        for (const [childName, childValue] of Object.entries(r)) {
          const child = registry.name(childName);
          if (!child) {
            unmapped.add(concept.uuid);
            continue;
          }
          const read = fieldFromApi(child, childValue);
          if (read.lossy) unmapped.add(concept.uuid);
          row[child.uuid] = read.value;
        }
        return row;
      });
      continue;
    }
    const read = fieldFromApi(concept, value);
    if (read.lossy) unmapped.add(concept.uuid);
    answers[concept.uuid] = read.value;
  }
  return { answers, unmapped };
}

function fieldToApi(concept: ConceptDef, value: FieldValue | undefined): unknown {
  if (isBlank(value)) return undefined;
  if (concept.dataType === "Coded") {
    const names = (Array.isArray(value) ? value : [value])
      .map((u) => concept.answers.find((a) => a.uuid === u)?.name)
      .filter((n): n is string => !!n);
    if (!names.length) return undefined;
    return Array.isArray(value) ? names : names[0];
  }
  return value;
}

/**
 * The observations to send: keyed by concept name, as the external API takes them. A question that is
 * not visible is left out, with whatever was typed into it, and so is a row field hidden in its row.
 */
export function buildObservations(
  form: FormDef,
  isVisible: (element: ElementDef, row?: number) => boolean,
  answers: Answers,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const e of allElements(form)) {
    if (e.parentUuid || !isVisible(e)) continue;
    if (isQuestionGroup(e)) {
      const rows = (answers[e.concept.uuid] as Row[] | undefined) ?? [];
      const kids = childrenOf(form, e);
      const sent = rows
        .map((row, i) => {
          const r: Record<string, unknown> = {};
          for (const k of kids) {
            if (!isVisible(k, i)) continue;
            const v = fieldToApi(k.concept, row[k.concept.uuid]);
            if (v !== undefined) r[k.concept.name] = v;
          }
          return r;
        })
        .filter((r) => Object.keys(r).length > 0);
      if (sent.length) out[e.concept.name] = sent;
      continue;
    }
    const v = fieldToApi(e.concept, answers[e.concept.uuid] as FieldValue | undefined);
    if (v !== undefined) out[e.concept.name] = v;
  }
  return out;
}
