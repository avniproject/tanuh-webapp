import type { CatchmentLocationNode } from "@/api/impl";
import type { ConceptDef } from "@/forms/engine/formDef";
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
