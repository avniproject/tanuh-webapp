import { describe, expect, it } from "vitest";
import type { ConceptDef } from "@/forms/engine/formDef";
import { placesFor } from "./places";

const nodes = [
  { uuid: "s", name: "Karnataka", type: "State", parentUuid: null },
  { uuid: "m1", name: "Demo Mammography Centre - Hosakote", type: "Mammography Centre", parentUuid: "d" },
  { uuid: "t1", name: "Dental hospital", type: "Taluka Hospital", parentUuid: "d" },
  { uuid: "d1", name: "Victoria Hospital", type: "District Hospital", parentUuid: "s" },
];
const types = [
  { uuid: "MC", name: "Mammography Centre" },
  { uuid: "DH", name: "District Hospital" },
  { uuid: "TH", name: "Taluka Hospital" },
];
const concept = (typeUuids: unknown): ConceptDef => ({
  uuid: "c",
  name: "PS Institution",
  dataType: "Location",
  answers: [],
  keyValues: typeUuids === undefined ? [] : [{ key: "lowestAddressLevelTypeUUIDs", value: typeUuids }],
  unit: null,
  lowAbsolute: null,
  highAbsolute: null,
});

describe("placesFor", () => {
  it("offers only the places of the location types the question names", () => {
    expect(placesFor(concept(["MC", "DH"]), nodes, types).map((p) => p.uuid)).toEqual(["m1", "d1"]);
  });
  it("offers nothing for a type it cannot name, and never falls back to every place", () => {
    expect(placesFor(concept(["UNKNOWN"]), nodes, types)).toEqual([]);
  });
  it("offers every place when the question names no type", () => {
    expect(placesFor(concept(undefined), nodes, types)).toHaveLength(4);
  });
});
