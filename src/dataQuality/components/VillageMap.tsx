// The taluks and their villages as a map. Each taluk is tinted and outlined by its DQ Score
// band for the period; each village is shaded by how many screenings were filed in it, in up
// to four ranges, and left in its taluk's tint when it has none. The shading is a count and
// says nothing about the records' quality.
//
// Pointing at a village calls `onHover` with its id, and leaving it with null; selecting it
// calls `onSelect`. Selecting a taluk's name calls `onTaluk`. The selected village is drawn
// with a dark outline.

import { Box } from "@mui/material";
import { useMemo } from "react";
import type { TalukOutline, VillageOutline } from "../api/types";
import { pathOf, projector } from "../geo";
import { DQ } from "../tokens";
import { TALUK_TINT, VILLAGE_SHADES } from "../villages";
import type { TalukBand } from "../villages";

const WIDTH = 800;

export function VillageMap({ taluks, villages, bandOf, shadeOf, selected, onHover, onSelect, onTaluk }: {
  taluks: TalukOutline[];
  villages: VillageOutline[];
  bandOf: (unitId: string) => TalukBand;
  // The shade index of a village, or -1 for one with no screenings.
  shadeOf: (villageId: string) => number;
  selected: string | null;
  onHover: (villageId: string | null) => void;
  onSelect: (villageId: string) => void;
  onTaluk: (unitId: string) => void;
}) {
  const drawn = useMemo(() => {
    const project = projector(taluks.flatMap((one) => one.rings), WIDTH);
    return {
      width: project.width,
      height: project.height,
      taluks: taluks.map((one) => ({
        ...one,
        d: pathOf(one.rings, project),
        at: one.label ? project.point(one.label) : null,
      })),
      villages: villages.map((one) => ({ ...one, d: pathOf(one.rings, project) })),
    };
  }, [taluks, villages]);
  // The drawing is scaled to fit its longer side, so names are sized by that side to read the
  // same size on screen however tall the map is; lines keep their width with non-scaling
  // strokes.
  const fontSize = Math.max(14, Math.max(drawn.width, drawn.height) * 0.028);
  const chosen = drawn.villages.find((one) => one.village_id === selected);

  return (
    <Box
      component="svg"
      viewBox={`-8 -8 ${drawn.width + 16} ${drawn.height + 16}`}
      role="img"
      aria-label="Map of the villages, shaded by the screenings filed in each, inside taluks tinted by their DQ Score band"
      sx={{ width: "100%", height: "auto", maxHeight: 720, display: "block" }}
      onMouseLeave={() => onHover(null)}
    >
      {drawn.taluks.map((one) => (
        <path key={one.unit_id} d={one.d} fill={TALUK_TINT[bandOf(one.unit_id)].fill} />
      ))}
      {drawn.villages.map((one) => {
        const shade = shadeOf(one.village_id);
        return (
          <path
            key={one.village_id}
            d={one.d}
            fill={shade < 0 ? "transparent" : VILLAGE_SHADES[shade]}
            stroke={DQ.neutral}
            strokeWidth={0.5}
            strokeOpacity={0.6}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: "pointer" }}
            onMouseEnter={() => onHover(one.village_id)}
            onClick={() => onSelect(one.village_id)}
          >
            <title>{one.name}</title>
          </path>
        );
      })}
      {drawn.taluks.map((one) => {
        const tint = TALUK_TINT[bandOf(one.unit_id)];
        return (
          <path key={one.unit_id} d={one.d} fill="none" stroke={tint.stroke} strokeWidth={2}
            strokeDasharray={tint.dashed ? "6 4" : undefined} strokeLinejoin="round" vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: "none" }} />
        );
      })}
      {chosen && (
        <path d={chosen.d} fill="none" stroke={DQ.text} strokeWidth={2.5} vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: "none" }} />
      )}
      {drawn.taluks.map((one) =>
        one.at ? (
          <Box
            component="text"
            key={one.unit_id}
            x={one.at[0]}
            y={one.at[1]}
            textAnchor="middle"
            fontSize={fontSize}
            fontWeight={600}
            fill={DQ.text}
            stroke={DQ.surface}
            strokeWidth={fontSize * 0.2}
            paintOrder="stroke"
            tabIndex={0}
            role="button"
            aria-label={`${one.name}: open its workers`}
            onClick={() => onTaluk(one.unit_id)}
            onKeyDown={(event: React.KeyboardEvent) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onTaluk(one.unit_id);
              }
            }}
            sx={{ cursor: "pointer", outline: "none", "&:hover, &:focus-visible": { textDecoration: "underline" } }}
          >
            {one.name}
          </Box>
        ) : null,
      )}
    </Box>
  );
}
