// The map's geometry: DQS's outlines turned into SVG coordinates. Nothing here scores or reads
// the API; the views pass in the outlines the map route returned.
//
// `projector` fits a set of rings into a box of a given width, keeping their shape: longitude
// is scaled by the cosine of the middle latitude, which is close enough at a district's size,
// and latitude is flipped so that north is up. `pathOf` is one outline's rings as an SVG path,
// and `talukShapes` every taluk's path and label point in one projection.

import type { Ring, TalukOutline } from "./api/types";

export interface Projector {
  width: number;
  height: number;
  point: (at: [number, number]) => [number, number];
}

// A projection of every point of `rings` into a box `width` wide and as tall as their shape
// needs. With no points at all, a box of zero height in which every point lands at the origin.
export function projector(rings: Ring[], width: number): Projector {
  const points = rings.flat();
  if (!points.length) return { width, height: 0, point: () => [0, 0] };
  const lons = points.map(([lon]) => lon);
  const lats = points.map(([, lat]) => lat);
  const west = Math.min(...lons);
  const east = Math.max(...lons);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const squash = Math.cos((((north + south) / 2) * Math.PI) / 180);
  const spanX = (east - west) * squash || 1;
  const scale = width / spanX;
  const height = (north - south) * scale;
  return {
    width,
    height,
    point: ([lon, lat]) => [(lon - west) * squash * scale, (north - lat) * scale],
  };
}

// One outline as an SVG path: a closed subpath for each ring, to one decimal place.
export function pathOf(rings: Ring[], project: Projector): string {
  return rings
    .filter((ring) => ring.length > 1)
    .map((ring) => `M${ring.map((at) => project.point(at).map((n) => n.toFixed(1)).join(",")).join("L")}Z`)
    .join("");
}

export interface TalukShape {
  unitId: string;
  name: string;
  d: string;
  label: [number, number] | null;
}

// Every taluk's path and label point, projected together into a box `width` wide.
export function talukShapes(taluks: TalukOutline[], width: number): { width: number; height: number; taluks: TalukShape[] } {
  const project = projector(taluks.flatMap((one) => one.rings), width);
  return {
    width: project.width,
    height: project.height,
    taluks: taluks.map((one) => ({
      unitId: one.unit_id,
      name: one.name,
      d: pathOf(one.rings, project),
      label: one.label ? project.point(one.label) : null,
    })),
  };
}
