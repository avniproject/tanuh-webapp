// The DQ Score Over Time chart: one worker's TrustIndex on the 1-5 scale for each period,
// drawn as SVG over the High, Mid and Low zones, with a dashed circle at the foot for a
// period that was Insufficient and a larger dot at the selected period.

import type { Settings } from "../api/types";
import { DQ } from "../tokens";

export interface ChartPoint {
  label: string;
  value: number | null;
  insufficient: boolean;
  current: boolean;
}

export function LineChart({ points, settings }: { points: ChartPoint[]; settings: Settings | null }) {
  const w = 380, h = 190, l = 30, r = 10, t = 10, b = 24;
  const pw = w - l - r, ph = h - t - b, n = points.length;
  const every = Math.max(1, Math.ceil(n / 6));
  const X = (i: number) => l + (n > 1 ? (i * pw) / (n - 1) : pw / 2);
  const Y = (v: number) => t + ((5 - v) / 4) * ph;
  const label = { fill: DQ.textSubtle, fontSize: 10 };

  let path = "";
  let pen = false;
  points.forEach((point, i) => {
    if (point.value == null) {
      pen = false;
      return;
    }
    path += `${pen ? "L" : "M"}${X(i).toFixed(1)} ${Y(point.value).toFixed(1)} `;
    pen = true;
  });

  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="DQ score by period" style={{ width: "100%", height: "auto", display: "block" }}>
      {settings && (
        <>
          <rect fill={DQ.surface} x={l} y={Y(settings.band_high_scale)} width={pw}
            height={Y(settings.band_low_scale) - Y(settings.band_high_scale)} />
          <rect fill={DQ.brandSubtle} x={l} y={Y(5)} width={pw} height={Y(settings.band_high_scale) - Y(5)} />
          <rect fill={DQ.dangerSubtle} x={l} y={Y(settings.band_low_scale)} width={pw}
            height={Y(1) - Y(settings.band_low_scale)} />
        </>
      )}
      {[1, 2, 3, 4, 5].map((v) => (
        <g key={v}>
          <line stroke={DQ.border} x1={l} x2={l + pw} y1={Y(v)} y2={Y(v)} />
          <text {...label} x={l - 6} y={Y(v) + 3.5} textAnchor="end">{v}</text>
        </g>
      ))}
      {points.map((point, i) =>
        i % every === 0 || i === n - 1 ? (
          <text key={`x-${i}`} {...label} x={X(i)} y={h - 6} textAnchor="middle">{point.label}</text>
        ) : null,
      )}
      <path d={path} fill="none" stroke="#111827" strokeWidth={1.5} />
      {points.map((point, i) =>
        point.value == null ? (
          point.insufficient ? (
            <circle key={`p-${i}`} cx={X(i)} cy={Y(1.25)} r={3.5} fill="none" stroke="#9ca3af" strokeDasharray="2 2" />
          ) : null
        ) : (
          <circle key={`p-${i}`} cx={X(i)} cy={Y(point.value)} r={point.current ? 4.5 : 3} fill="#111827" />
        ),
      )}
    </svg>
  );
}
