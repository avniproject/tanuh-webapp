// A form as the screens and the rule engine read it. Built from GET /web/form/{uuid}
// (FormWebProjection in avni-server) or, in tests, from a bundle's form file.

export interface AnswerDef {
  uuid: string;
  name: string;
  order: number;
  unique: boolean;
}

export interface KeyValue {
  key: string;
  value: unknown;
}

export interface ConceptDef {
  uuid: string;
  name: string;
  dataType: string;
  answers: AnswerDef[];
  keyValues: KeyValue[];
  unit: string | null;
  lowAbsolute: number | null;
  highAbsolute: number | null;
}

export interface ElementDef {
  uuid: string;
  name: string;
  displayOrder: number;
  type: string; // SingleSelect | MultiSelect, or empty for a primitive
  mandatory: boolean;
  rule: string | null;
  keyValues: KeyValue[];
  concept: ConceptDef;
  /** The question-group element this one is a row field of. */
  parentUuid: string | null;
}

export interface PageDef {
  uuid: string;
  name: string;
  displayOrder: number;
  rule: string | null;
  elements: ElementDef[];
}

export interface FormDef {
  uuid: string;
  name: string;
  formType: string;
  pages: PageDef[];
}

type Json = Record<string, unknown>;
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const byOrder = <T extends { displayOrder: number }>(list: T[]): T[] =>
  [...list].sort((a, b) => a.displayOrder - b.displayOrder);

function concept(json: Json): ConceptDef {
  // /web/form nests answers as conceptAnswers[].answerConcept; a bundle lists them flat.
  const web = arr(json.conceptAnswers);
  const answers: AnswerDef[] = (web.length ? web : arr(json.answers))
    .filter((a) => !a.voided)
    .map((a) => {
      const c = (a.answerConcept as Json | undefined) ?? a;
      return {
        uuid: String(c.uuid),
        name: String(c.name),
        order: num(a.order) ?? 0,
        unique: a.unique === true,
      };
    })
    .sort((a, b) => a.order - b.order);
  return {
    uuid: String(json.uuid),
    name: String(json.name),
    dataType: String(json.dataType),
    answers,
    keyValues: arr(json.keyValues) as unknown as KeyValue[],
    unit: text(json.unit),
    lowAbsolute: num(json.lowAbsolute),
    highAbsolute: num(json.highAbsolute),
  };
}

function element(json: Json): ElementDef {
  const group = json.group as Json | undefined;
  return {
    uuid: String(json.uuid),
    name: String(json.name),
    displayOrder: num(json.displayOrder) ?? 0,
    type: typeof json.type === "string" ? json.type : "",
    mandatory: json.mandatory === true,
    rule: text(json.rule),
    keyValues: arr(json.keyValues) as unknown as KeyValue[],
    concept: concept(json.concept as Json),
    parentUuid: text(group?.uuid) ?? text(json.parentFormElementUuid),
  };
}

/** Voided pages and questions are dropped: the clinician never sees them and nothing is sent for them. */
export function parseForm(json: unknown): FormDef {
  const form = json as Json;
  const pages = arr(form.formElementGroups)
    .filter((g) => !g.voided)
    .map((g) => ({
      uuid: String(g.uuid),
      name: String(g.name),
      displayOrder: num(g.displayOrder) ?? 0,
      rule: text(g.rule),
      elements: byOrder(
        (arr(g.applicableFormElements).length ? arr(g.applicableFormElements) : arr(g.formElements))
          .filter((e) => !e.voided)
          .map(element),
      ),
    }));
  return {
    uuid: String(form.uuid),
    name: String(form.name),
    formType: String(form.formType),
    pages: byOrder(pages),
  };
}

export const allElements = (form: FormDef): ElementDef[] => form.pages.flatMap((p) => p.elements);

export const childrenOf = (form: FormDef, parent: ElementDef): ElementDef[] =>
  allElements(form).filter((e) => e.parentUuid === parent.uuid);

export const keyValue = (holder: { keyValues: KeyValue[] }, key: string): unknown =>
  holder.keyValues.find((k) => k.key === key)?.value;

export const isQuestionGroup = (e: ElementDef): boolean => e.concept.dataType === "QuestionGroup";

/** A value the clinician cannot type: the form marks it read-only (editable:false). */
export const isReadOnly = (e: ElementDef): boolean => keyValue(e, "editable") === false;
