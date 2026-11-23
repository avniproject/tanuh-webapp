// Runs a form's show/hide rules in the browser on Avni's own libraries, the way avni-webapp's data
// entry app does (RuleEvaluationService.js, origin/18.3): the rule text is evaluated and handed the
// visit being filled, as an Avni Encounter whose Individual carries her earlier visits.
import { models, ruleImports } from "./avniLibs";
import type { AnswerValue, Answers, FieldValue, Row } from "./answers";
import { isBlank } from "./answers";
import type { ConceptDef, ElementDef, FormDef } from "./formDef";
import { allElements, childrenOf, isQuestionGroup } from "./formDef";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface EarlierVisit {
  uuid: string;
  encounterType: string;
  encounterDateTime: string | null;
  cancelDateTime: string | null;
  answers: Answers;
  concepts: ConceptDef[];
}

export interface Subject {
  uuid: string;
  gender: string | null;
  dateOfBirth: string | null;
  earlier: EarlierVisit[];
}

export interface VisitDraft {
  uuid: string;
  encounterType: string;
  encounterDateTime: Date;
}

export interface ElementStatus {
  visible: boolean;
  /** A value the rule computed for the question, or null. */
  value: unknown;
  /** Answer uuids the rule takes off the list. */
  hiddenAnswers: string[];
  errors: string[];
  /** The question's rule threw, so it is left out without the form having decided to hide it. */
  failed?: boolean;
}

/** Status per question; a row field of a question group is keyed `<element uuid>#<row>`. */
export type Statuses = Map<string, ElementStatus>;
export const statusKey = (elementUuid: string, row?: number): string =>
  row === undefined ? elementUuid : `${elementUuid}#${row}`;

const SHOWN: ElementStatus = { visible: true, value: null, hiddenAnswers: [], errors: [] };
const HIDDEN: ElementStatus = { visible: false, value: null, hiddenAnswers: [], errors: [] };

function modelConcept(def: ConceptDef, cache: Map<string, any>): any {
  const hit = cache.get(def.uuid);
  if (hit) return hit;
  const c = models.Concept.create(def.name, def.dataType, [], def.uuid);
  c.answers = [];
  for (const a of def.answers) c.addAnswer(models.Concept.create(a.name, "NA", [], a.uuid));
  cache.set(def.uuid, c);
  return c;
}

function observation(def: ConceptDef, value: AnswerValue, concepts: Map<string, ConceptDef>, cache: Map<string, any>): any {
  const c = modelConcept(def, cache);
  if (def.dataType === "Coded") {
    return models.Observation.create(
      c,
      Array.isArray(value) ? new models.MultipleCodedValues(value) : new models.SingleCodedValue(value),
    );
  }
  if (def.dataType === "QuestionGroup") {
    const rows = (value as Row[]).map(
      (row) =>
        new models.QuestionGroup(
          Object.entries(row)
            .filter(([uuid, v]) => !isBlank(v) && concepts.has(uuid))
            .map(([uuid, v]) => observation(concepts.get(uuid)!, v as FieldValue, concepts, cache)),
        ),
    );
    return models.Observation.create(c, new models.RepeatableQuestionGroup(rows));
  }
  const primitive = def.dataType === "Date" || def.dataType === "DateTime" ? new Date(value as string) : value;
  return models.Observation.create(c, new models.PrimitiveValue(primitive, def.dataType));
}

function observations(answers: Answers, defs: ConceptDef[], cache: Map<string, any>): any[] {
  const concepts = new Map(defs.map((d) => [d.uuid, d]));
  return Object.entries(answers)
    .filter(([uuid, v]) => !isBlank(v) && concepts.has(uuid))
    .map(([uuid, v]) => observation(concepts.get(uuid)!, v as AnswerValue, concepts, cache));
}

function encounterType(name: string): any {
  const t = new models.EncounterType();
  t.uuid = `et-${name}`;
  t.name = name;
  return t;
}

/** The visit on screen as an Avni Encounter, on an Individual that holds her earlier visits. */
export function buildEntity(form: FormDef, answers: Answers, subject: Subject, draft: VisitDraft): any {
  const cache = new Map<string, any>();
  const individual = models.Individual.createEmptyInstance();
  individual.uuid = subject.uuid;
  if (subject.gender) individual.gender = models.Gender.create(subject.gender);
  individual.dateOfBirth = subject.dateOfBirth ? new Date(subject.dateOfBirth) : null;
  individual.observations = [];
  individual.enrolments = [];
  individual.encounters = [];
  for (const v of subject.earlier) {
    if (v.uuid === draft.uuid) continue;
    const e = models.Encounter.createEmptyInstance();
    e.uuid = v.uuid;
    e.encounterType = encounterType(v.encounterType);
    e.encounterDateTime = v.encounterDateTime ? new Date(v.encounterDateTime) : null;
    e.cancelDateTime = v.cancelDateTime ? new Date(v.cancelDateTime) : null;
    e.voided = false;
    e.individual = individual;
    e.observations = observations(v.answers, v.concepts, cache);
    individual.encounters.push(e);
  }
  const current = models.Encounter.createEmptyInstance();
  current.uuid = draft.uuid;
  current.encounterType = encounterType(draft.encounterType);
  current.encounterDateTime = draft.encounterDateTime;
  current.cancelDateTime = null;
  current.voided = false;
  current.individual = individual;
  current.observations = observations(answers, allElements(form).map((e) => e.concept), cache);
  individual.encounters.push(current);
  return current;
}

function runOne(element: ElementDef, entity: any, cache: Map<string, any>, row?: number): ElementStatus {
  if (!element.rule) return SHOWN;
  try {
    const formElement = new models.FormElement();
    formElement.uuid = element.uuid;
    formElement.name = element.name;
    formElement.concept = modelConcept(element.concept, cache);
    // The rule text is `'use strict'; ({params, imports}) => {...};` — its value is the function.
    const rule = (0, eval)(element.rule);
    const st = rule({
      params: { formElement, entity, questionGroupIndex: row, services: {}, user: null, myUserGroups: [] },
      imports: ruleImports,
    });
    if (!st) return HIDDEN;
    return {
      visible: st.visibility !== false,
      value: st.value ?? null,
      hiddenAnswers: (st.answersToSkip ?? []).map((a: any) => a?.concept?.uuid).filter(Boolean),
      errors: (st.validationErrors ?? []).map((m: unknown) => String(m)),
    };
  } catch (e) {
    // As in Avni's own data entry app: a rule that fails leaves its question out, and the rest of
    // the form goes on working.
    console.error(`Rule failed for "${element.name}"`, e);
    return { ...HIDDEN, failed: true };
  }
}

/** Every question's status for the answers given. A row field is run once per row of its group. */
export function runFormRules(form: FormDef, answers: Answers, subject: Subject, draft: VisitDraft): Statuses {
  const entity = buildEntity(form, answers, subject, draft);
  const cache = new Map<string, any>();
  const out: Statuses = new Map();
  for (const e of allElements(form)) {
    if (e.parentUuid) continue;
    const st = runOne(e, entity, cache);
    out.set(statusKey(e.uuid), st);
    if (!isQuestionGroup(e)) continue;
    const rows = (answers[e.concept.uuid] as Row[] | undefined) ?? [];
    for (const child of childrenOf(form, e)) {
      for (let i = 0; i < Math.max(rows.length, 1); i++) {
        out.set(statusKey(child.uuid, i), st.visible ? runOne(child, entity, cache, i) : HIDDEN);
      }
    }
  }
  return out;
}

export function isVisible(statuses: Statuses, element: ElementDef, row?: number): boolean {
  return statuses.get(statusKey(element.uuid, row))?.visible ?? true;
}
