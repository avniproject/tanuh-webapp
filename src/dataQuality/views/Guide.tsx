// The How to read this view: the scoring method in plain language, quoting the tenant's
// scoring settings from the dashboard context so that the thresholds named are the ones the
// scores were computed with. Ported from dqs-demo's guide.

import type { ReactNode } from "react";
import { Box, Link, Paper, Typography } from "@mui/material";
import { Dot } from "../components/ui";
import { f2, int, pct } from "../format";
import { useDashboard } from "../state";
import { DQ } from "../tokens";
import { CONCENTRATED_SHARE, HEAVY_FAILURE_RATE, TOP_WORKERS_SHARE } from "./Dimensions";

const SECTIONS: [string, string][] = [
  ["g-what", "What is scored"],
  ["g-gates", "The three gates"],
  ["g-ti", "TrustIndex (DQ score)"],
  ["g-scale", "Scale and bands"],
  ["g-rule", "From a rule to a score"],
  ["g-ins", "Insufficient data"],
  ["g-status", "Statuses"],
  ["g-taluk", "Taluk scores"],
  ["g-nm", "Not measured"],
  ["g-map", "The maps"],
  ["g-src", "Where the numbers come from"],
];

const Terms = ({ children }: { children: ReactNode }) => (
  <Box
    component="dl"
    sx={{
      display: "grid",
      gridTemplateColumns: "max-content minmax(0,1fr)",
      columnGap: 2,
      rowGap: 0.75,
      mt: 1,
      mb: 1.75,
      "& dt": { fontWeight: 500, display: "flex", alignItems: "center", gap: 1 },
      "& dd": { m: 0 },
    }}
  >
    {children}
  </Box>
);

export function Guide() {
  const { context } = useDashboard();
  const p = context.settings;
  const v = <T,>(x: T | null | undefined, format?: (x: T) => string) =>
    x == null ? "—" : format ? format(x) : String(x);
  const mean =
    p?.power_p === -1 ? "weighted harmonic mean" : p ? `weighted power mean with p = ${p.power_p}` : "weighted power mean";

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "220px minmax(0,1fr)" }, gap: 4 }}>
        <Box component="nav" aria-label="Sections"
          sx={{ position: { md: "sticky" }, top: { md: 16 }, alignSelf: "start", display: "grid", gap: 1 }}>
          <Typography variant="caption" sx={{ color: DQ.textSubtle, textTransform: "uppercase", letterSpacing: ".8px" }}>
            How to read this
          </Typography>
          {SECTIONS.map(([id, label]) => (
            <Link key={id} href={`#${id}`} underline="hover" variant="body2" sx={{ color: DQ.link }}>
              {label}
            </Link>
          ))}
        </Box>
        <Paper
          component="article"
          elevation={0}
          sx={{
            maxWidth: "72ch",
            borderRadius: 2,
            p: 3,
            fontSize: 14,
            lineHeight: "20px",
            "& h3": { fontSize: 18, fontWeight: 500, mt: 3, mb: 0.75 },
            "& h3:first-of-type": { mt: 0 },
            "& p": { mt: 0, mb: 1.25 },
            "& li": { mb: 1.25 },
          }}
        >
          <h3 id="g-what">What is scored</h3>
          <p>
            Each score describes a stream of data: the records one worker submitted in one period, or all records from
            one taluk in one period. It says how far that data can be trusted to support a clinical or programme
            decision. Individual records are checked against rules and keep their rule outcomes; they do not get a score
            of their own.
          </p>
          <p>
            These screens are for programme managers. The Health Check lists the five lowest and five highest DQ scores
            of the period, so that you can see who needs support first.
          </p>

          <h3 id="g-gates">The three gates</h3>
          <Terms>
            <dt>Sufficiency</dt>
            <dd>
              Is there enough data to judge? Protocol questions answered, referral details filled in, the expected oral
              images captured.
            </dd>
            <dt>Genuineness</dt>
            <dd>
              Two figures that are never combined. <b>Provenance confidence</b> is evidence that a record was captured
              live in the field: a location was captured, the visit time is plausible, the entry was made promptly. Low
              provenance is often a connectivity problem and is not treated as a sign of fabrication.{" "}
              <b>Fabrication suspicion</b> is evidence that data was manufactured, such as a GPS fix far outside the
              claimed village, or an entry completed before the visit it records.
            </dd>
            <dt>Fidelity</dt>
            <dd>
              Are the answers internally correct? The CBAC and PHQ-2 scores recomputed from their answers, referrals
              consistent with symptoms, dates in order. The engineering brief calls this gate Quality.
            </dd>
          </Terms>

          <h3 id="g-ti">TrustIndex (the DQ score)</h3>
          <p>The TrustIndex combines Fidelity, fabrication suspicion and Sufficiency:</p>
          <Box sx={{ bgcolor: DQ.surfaceSubtle, border: `1px solid ${DQ.border}`, borderRadius: 1, px: 1.75, py: 1.25, my: 1.25, overflowX: "auto", whiteSpace: "nowrap" }}>
            TrustIndex = Fidelity × (1 − suspicion ÷ 100) × min(1, Sufficiency ÷ {v(p?.sufficiency_full)})
          </Box>
          <p>
            High suspicion pulls it down in proportion. Sufficiency below {v(p?.sufficiency_full)} out of 100 pulls it
            down; above {v(p?.sufficiency_full)} it has no further effect. When suspicion or Sufficiency is not measured,
            the TrustIndex is computed without it and the gate is shown as Not measured. Provenance confidence does not
            change the TrustIndex: it widens the 95% interval shown around it, and the lower the provenance, the wider
            the interval. The DQ score is always shown with the gates beside it.
          </p>

          <h3 id="g-scale">Scale and bands</h3>
          <p>
            Scores are computed from 0 to 100 and shown from 1.00 to 5.00 (1 + 4 × score ÷ 100). Fabrication suspicion
            is shown from 0 to 100, where lower is better. The small range under a figure is its 95% interval.
          </p>
          <Terms>
            <dt><Dot kind="high" /> High</dt>
            <dd>{v(p?.band_high_scale, f2)} and above ({v(p?.band_high)} or more out of 100)</dd>
            <dt><Dot kind="mid" /> Mid</dt>
            <dd>{v(p?.band_low_scale, f2)} up to {v(p?.band_high_scale, f2)}</dd>
            <dt><Dot kind="low" /> Low</dt>
            <dd>below {v(p?.band_low_scale, f2)} (under {v(p?.band_low)})</dd>
            <dt><Dot kind="ins" /> Insufficient</dt>
            <dd>fewer than {v(p?.n_min)} records in the period</dd>
          </Terms>

          <h3 id="g-rule">From a rule to a score</h3>
          <p>
            For each rule, the period's failure rate is the records that failed divided by the records the rule applied
            to. A worker with few records gets a rate pulled toward the rate of their peer group for the same period, so
            that two failures out of six is not read as a 33% failure rate with full confidence.
          </p>
          <p>
            The adjusted rate becomes a sub-score through an anchor curve: {v(p?.anchor_green, (x) => pct(x, 0))} or less
            scores 100, {v(p?.anchor_amber, (x) => pct(x, 0))} scores 70, {v(p?.anchor_red, (x) => pct(x, 0))} or more
            scores 0, with straight lines between. A rule may set its own anchors.
          </p>
          <p>
            Sub-scores combine into a dimension score, and dimensions into a gate, by a {mean}. One rule failing badly
            pulls the dimension down and is not averaged away by several rules passing.
          </p>
          <p>
            Some rules look at a worker's records over several weeks against the other workers of the district, such as
            how often a worker records a lesion compared with their peers. They are measured each hour from the records
            received, not as each record arrives.
          </p>

          <h3 id="g-ins">Insufficient data</h3>
          <p>
            A worker-period with fewer than {v(p?.n_min)} records is marked Insufficient and gets no score; its rule
            outcomes are still kept. Within a scored period, a rule that applied to fewer than {v(p?.rule_n_min)} records
            is left out of that period's score and shown as "too few".
          </p>

          <h3 id="g-status">Statuses</h3>
          <p>
            Each status looks at the last {v(p?.trend_window)} scored periods, ending at the selected one. Periods marked
            Insufficient are skipped.
          </p>
          <Terms>
            <dt>▼▼ Consistently low</dt>
            <dd>Low in at least three quarters of them.</dd>
            <dt>▼ Recent slip</dt>
            <dd>Low this period, and not Low in either of the two scored periods before it.</dd>
            <dt>▲ Consistently high</dt>
            <dd>High in all of them.</dd>
            <dt>○ Insufficient data</dt>
            <dd>No score this period.</dd>
          </Terms>
          <p>A worker or taluk with fewer than {v(p?.trend_window)} scored periods has no status.</p>

          <h3 id="g-taluk">Taluk scores</h3>
          <p>
            A taluk's score pools every record from the taluk for the period and scores them the same way as a worker's.
            It is not the average of its workers' scores. A percentile against other taluks is shown only when the
            district has at least {v(p?.min_peers)} taluks.
          </p>

          <h3 id="g-nm">Not measured</h3>
          <p>
            A rule is shown as Not measured in a period when no outcome is stored for it: none of the period's records
            were of a type it applies to, or the engine that measures it has not run on them. A rule shown as No records
            checked had an outcome stored but applied to none of the period's records, such as an image rule when
            no images were sent. A rule marked Not scored is measured and reported but does not count towards any
            score. A dimension is Not measured when none of its
            rules had enough records to score, and a gate is Not measured when none of its dimensions was.
          </p>

          <h3 id="g-map">The maps</h3>
          <p>
            The Health Check's Map View draws the taluks with one marker each, coloured by the taluk's DQ Score band for
            the selected period: green for High, grey for Mid, red for Low, and hollow for a taluk with too few records
            or no score. Point at a marker to see the taluk's score and one dot per worker, coloured by that worker's
            band. Select a marker to list the taluk's workers.
          </p>
          <p>
            The Map tab draws the villages inside their taluks. Each taluk is tinted and outlined by its band. Each
            village is shaded by how many screenings were filed in it in the period, in up to four equal ranges up to
            the period's busiest village, so a shade means different counts in different periods. The shading is a
            count and says nothing about the screenings' quality. Point at a village to see its screenings and the
            workers who filed them, and select it to keep it beside the map. Screenings that name no village, or a
            village with no outline on the map, are counted under the map and not drawn.
          </p>

          <h3 id="g-src">Where the numbers come from</h3>
          <p>
            Every score on these screens is read from the data quality service for tenant {context.tenant}, which stores
            the scores when it loads new records each hour. The screens show what was stored and compute no score. The
            cut-offs in the note under the Quality Dimensions failures table (a failure rate of{" "}
            {pct(HEAVY_FAILURE_RATE, 0)} or more, and failures called concentrated when the top{" "}
            {pct(TOP_WORKERS_SHARE, 0)} of affected workers account for at least {pct(CONCENTRATED_SHARE, 0)} of them)
            are set by these screens and are not part of the rulepack. The scores were produced under:
          </p>
          <ul>
            {context.scored_under.length ? (
              context.scored_under.map((stamp) => (
                <li key={`${stamp.rulepack_id}-${stamp.scoring_version}`}>
                  Rulepack version {v(stamp.rulepack_version)}: {int(stamp.worker_periods)} worker-periods and{" "}
                  {int(stamp.taluk_periods)} taluk-periods
                </li>
              ))
            ) : (
              <li>—</li>
            )}
          </ul>
        </Paper>
    </Box>
  );
}
