import { getEncounter, isScheduled, listEncounters } from "@/api/encounters";
import { getFormDef } from "@/api/formLayout";
import { getCatchmentLocations } from "@/api/impl";
import { getSubject } from "@/api/subjects";
import type { EncounterApiResponse, SubjectApiResponse } from "@/api/types";
import { ConceptRegistry, answersFromApi, type Answers } from "@/forms/engine/answers";
import { allElements, type FormDef } from "@/forms/engine/formDef";
import type { EarlierVisit, Subject } from "@/forms/engine/ruleRunner";
import type { PlaceOption } from "@/forms/screen/fields";
import { BREAST_VISITS, type ClinicianFormKey } from "./breastConcepts";
import { formVisitFor } from "./breastList";

type VisitKey = "screening" | ClinicianFormKey;

export interface WomanCase {
  screening: EncounterApiResponse;
  subject: SubjectApiResponse;
  forms: Record<VisitKey, FormDef>;
  visits: Record<VisitKey, EncounterApiResponse[]>;
  /** The submitted visit of each clinician form that answers this screening, if there is one. */
  submitted: Record<ClinicianFormKey, EncounterApiResponse | null>;
  /** A visit of each clinician form that is booked and still open. */
  booked: Record<ClinicianFormKey, EncounterApiResponse | null>;
  /** She has been screened again since; the list shows that later screening. */
  newerScreening: boolean;
  places: PlaceOption[];
  /** The hospital list could not be read, as against being empty. */
  placesFailed: boolean;
}

const KEYS: VisitKey[] = ["screening", "assessment", "clinician"];

// Hospitals and centres, as against the places people live in.
const isFacility = (type: string): boolean => /hospital|centre|center/i.test(type) && !/public health|sub cent/i.test(type);

async function facilities(): Promise<PlaceOption[] | null> {
  try {
    const { nodes } = await getCatchmentLocations();
    return nodes
      .filter((n) => isFacility(n.type))
      .map((n) => ({ uuid: n.uuid, name: n.name, type: n.type }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return null; // the form says the list could not be loaded; every other question still works
  }
}

export async function loadWomanCase(screeningUuid: string): Promise<WomanCase> {
  const screening = await getEncounter(screeningUuid);
  if (screening["Encounter type"] !== BREAST_VISITS.screening.name) {
    throw new Error("This is not a Breast Cancer Screening.");
  }
  const subjectUuid = screening["Subject ID"];
  const [subject, places, ...rest] = await Promise.all([
    getSubject(subjectUuid),
    facilities(),
    ...KEYS.map((k) => getFormDef(BREAST_VISITS[k].formUuid)),
    // size must exceed any real per-woman count: the API pages by last change, not by date.
    ...KEYS.map((k) => listEncounters({ encounterType: BREAST_VISITS[k].name, subjectId: subjectUuid, size: 100 })),
  ]);
  const defs = rest.slice(0, 3) as FormDef[];
  const lists = (rest.slice(3) as Array<{ content: EncounterApiResponse[] }>).map((p) => p.content.filter((e) => !e.Voided));
  const forms = { screening: defs[0], assessment: defs[1], clinician: defs[2] };
  const visits = { screening: lists[0], assessment: lists[1], clinician: lists[2] };
  const open = (list: EncounterApiResponse[]) => list.find(isScheduled) ?? null;
  return {
    screening,
    subject,
    forms,
    visits,
    submitted: {
      assessment: formVisitFor(screening, visits.assessment),
      clinician: formVisitFor(screening, visits.clinician),
    },
    booked: { assessment: open(visits.assessment), clinician: open(visits.clinician) },
    newerScreening: visits.screening.some(
      (s) => s["Encounter date time"] != null && s["Encounter date time"] > screening["Encounter date time"]!,
    ),
    places: places ?? [],
    placesFailed: places === null,
  };
}

export function registryOf(woman: WomanCase): ConceptRegistry {
  return KEYS.reduce((r, k) => r.add(woman.forms[k]), new ConceptRegistry());
}

/** The woman as the form rules see her: who she is, and every completed breast visit with its answers. */
export function ruleSubject(woman: WomanCase, registry: ConceptRegistry): Subject {
  const obs = woman.subject.observations ?? {};
  const earlier: EarlierVisit[] = KEYS.flatMap((k) =>
    woman.visits[k]
      .filter((v) => v["Encounter date time"] != null)
      .map((v) => ({
        uuid: v.ID,
        encounterType: v["Encounter type"],
        encounterDateTime: v["Encounter date time"],
        cancelDateTime: v["Cancel date time"],
        answers: answersFromApi(v.observations ?? {}, registry),
        concepts: allElements(woman.forms[k]).map((e) => e.concept),
      })),
  );
  return {
    uuid: woman.subject.ID,
    gender: typeof obs["Gender"] === "string" ? (obs["Gender"] as string) : null,
    dateOfBirth: typeof obs["Date of birth"] === "string" ? (obs["Date of birth"] as string) : null,
    earlier,
  };
}

/** A submitted visit's answers, as the form screen takes them. */
export function visitAnswers(visit: EncounterApiResponse | null, registry: ConceptRegistry): Answers {
  return visit ? answersFromApi(visit.observations ?? {}, registry) : {};
}
