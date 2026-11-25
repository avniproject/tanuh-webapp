import { describe, expect, it } from "vitest";
import type { Ring, TalukOutline } from "./api/types";
import { pathOf, projector, talukShapes } from "./geo";

// A degree square at the equator, where a degree of longitude is as long as one of latitude.
const square: Ring = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

describe("projector", () => {
  it("fits the rings to the width, keeps their shape and puts north at the top", () => {
    const project = projector([square], 100);
    expect(project.height).toBeCloseTo(100);
    expect(project.point([0, 1])).toEqual([0, 0]);
    expect(project.point([1, 0])[0]).toBeCloseTo(100);
    expect(project.point([1, 0])[1]).toBeCloseTo(100);
  });

  it("narrows longitude away from the equator", () => {
    const north: Ring = square.map(([lon, lat]) => [lon, lat + 59.5]);
    expect(projector([north], 100).height).toBeCloseTo(100 / Math.cos((60 * Math.PI) / 180), 0);
  });

  it("gives a box of no height when there are no points", () => {
    expect(projector([], 100).height).toBe(0);
  });
});

describe("pathOf", () => {
  it("draws each ring as a closed subpath and skips a ring of one point", () => {
    const project = projector([square], 10);
    expect(pathOf([square, [[0, 0]]], project)).toBe("M0.0,10.0L10.0,10.0L10.0,0.0L0.0,0.0Z");
  });
});

describe("talukShapes", () => {
  it("projects every taluk and its label point together", () => {
    const taluks: TalukOutline[] = [
      { unit_id: "block:1", name: "West", rings: [square], label: [0.5, 0.5] },
      { unit_id: "block:2", name: "East", rings: [square.map(([lon, lat]) => [lon + 1, lat])], label: null },
    ];
    const shapes = talukShapes(taluks, 200);
    expect(shapes.height).toBeCloseTo(100);
    expect(shapes.taluks[0].label?.[0]).toBeCloseTo(50);
    expect(shapes.taluks[1]).toMatchObject({ unitId: "block:2", label: null });
  });
});
