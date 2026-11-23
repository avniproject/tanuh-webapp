import type { CatchmentLocationNode } from "@/api/impl";
import type { Answers } from "@/forms/engine/answers";
import type { ConceptDef, ElementDef } from "@/forms/engine/formDef";
import type { PlaceOption } from "@/forms/screen/fields";

export interface AddressLevelType {
  uuid: string;
  name: string;
}

/**
 * The places a Location question offers: those of the location types the question itself names
 * (its concept's `lowestAddressLevelTypeUUIDs`), among the places in the clinician's own area.
 * A question that also allows places outside the catchment still offers only these here: the
 * app's sites do not forward Avni's all-locations search.
 */
export function placesFor(concept: ConceptDef, nodes: CatchmentLocationNode[], types: AddressLevelType[]): PlaceOption[] {
  const named = concept.keyValues.find((k) => k.key === "lowestAddressLevelTypeUUIDs")?.value;
  const all = nodes.map((n) => ({ uuid: n.uuid, name: n.name, type: n.type }));
  if (!Array.isArray(named) || named.length === 0) return all;
  const allowed = new Set(types.filter((t) => named.includes(t.uuid)).map((t) => t.name));
  return all.filter((p) => allowed.has(p.type));
}

/**
 * A new form starts with each place question already answered when the clinician's area holds
 * exactly one place of the kind the question asks for: the institution she works at. With several
 * to choose from, or none, the question is left for her to answer.
 */
export function prefillPlaces(
  elements: ElementDef[],
  placesOf: (element: ElementDef) => PlaceOption[],
  answers: Answers,
): Answers {
  const out: Answers = { ...answers };
  for (const e of elements) {
    if (e.parentUuid || e.concept.dataType !== "Location" || out[e.concept.uuid] !== undefined) continue;
    const places = placesOf(e);
    if (places.length === 1) out[e.concept.uuid] = places[0].uuid;
  }
  return out;
}
