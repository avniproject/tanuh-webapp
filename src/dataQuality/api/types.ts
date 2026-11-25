// The shapes the DQS API returns to the dashboard routes. They mirror the response models in
// src/dqs/api/dashboard.py and src/dqs/api/scores.py; a field added there is added here.

export type Grain = "week" | "month" | "year";
export type Band = "high" | "mid" | "low";
export type Trend = "consistently_low" | "recent_slip" | "consistently_high";
export type Status = Trend | "insufficient";
export type Feeds = "sufficiency" | "provenance" | "suspicion" | "quality";

// One gate's score: `score` is 0-100, `scale` is the same on 1-5, `low` and `high` are the
// 95% interval on 0-100. For fabrication suspicion a higher value and the high band are worse.
export interface GateScore {
  score: number;
  low: number;
  high: number;
  scale: number;
  band: Band;
}

export interface Gates {
  quality: GateScore | null;
  fabrication_suspicion: GateScore | null;
  provenance_confidence: GateScore | null;
  sufficiency: GateScore | null;
  trust: GateScore | null;
}

export interface Span {
  start: string;
  end: string;
}

export interface RuleInfo {
  rule_id: string;
  title: string | null;
  dimension: string;
  feeds: Feeds;
  kind: string;
  engine: string;
  plugin: string | null;
  record_types: string[];
  scored: boolean | null;
  // "rate" for a rule scored on the share of records that failed it, "statistic" for a batch
  // rule scored on a measurement such as a ratio to peers.
  scores_on: "rate" | "statistic" | null;
  blocking: boolean | null;
  explanations: string[];
}

export interface Stamp {
  rulepack_id: string;
  rulepack_version: number | null;
  scoring_version: string;
  worker_periods: number;
  taluk_periods: number;
}

export interface Place {
  location_id: string;
  name: string | null;
}

export interface Settings {
  n_min: number;
  rule_n_min: number;
  min_peers: number;
  trend_window: number;
  band_high: number;
  band_low: number;
  band_high_scale: number;
  band_low_scale: number;
  sufficiency_full: number;
  power_p: number;
  prior_weight: number;
  anchor_green: number;
  anchor_amber: number;
  anchor_red: number;
}

export interface Context {
  tenant: string;
  rulepack_id: string;
  rulepack_version: number;
  settings: Settings | null;
  periods: Record<Grain, Span[]>;
  rules: RuleInfo[];
  scored_under: Stamp[];
  districts: Place[];
  // The record types of a screening and of the photos taken at it, which the daily counts
  // use to count screenings; both null for a tenant with no photos.
  screening_record_type: string | null;
  photo_record_type: string | null;
}

export interface WorkerRow extends Gates {
  worker_id: string;
  peer_group_key: number | null;
  name: string | null;
  village_id: string | null;
  village_name: string | null;
  taluk_id: string | null;
  taluk_name: string | null;
  n_records: number;
  insufficient: boolean;
  genuineness_not_measured: boolean | null;
  sufficiency_not_measured: boolean | null;
  provenance_not_measured: boolean | null;
  trend: Trend | null;
  status: Status | null;
  previous_trust: GateScore | null;
  // The latest visit date among the worker's records in the period.
  last_visit_date: string | null;
}

export interface BandCounts {
  period_start: string;
  period_end: string;
  records: number;
  workers: number;
  scored: number;
  insufficient: number;
  high: number;
  mid: number;
  low: number;
}

export interface WorkersPage {
  grain: Grain;
  period_start: string;
  period_end: string;
  summary: BandCounts;
  previous: BandCounts | null;
  total: number;
  page: number;
  page_size: number;
  workers: WorkerRow[];
}

export interface HistoryPoint extends Gates {
  period_start: string;
  period_end: string;
  peer_group_key: number | null;
  n_records: number;
  insufficient: boolean;
  trend: Trend | null;
}

export interface WorkerHistory {
  worker_id: string;
  grain: Grain;
  periods: HistoryPoint[];
}

export interface PreviousGates extends Gates {
  period_start: string;
  insufficient: boolean;
}

export interface UnitRow extends Gates {
  period_start: string;
  period_end: string;
  unit_id: string;
  unit_level: string;
  name: string | null;
  n_records: number;
  insufficient: boolean;
  genuineness_not_measured: boolean | null;
  sufficiency_not_measured: boolean | null;
  provenance_not_measured: boolean | null;
  trend: Trend | null;
  workers_median: number | null;
  workers_scored: number;
  workers_insufficient: number;
  previous: PreviousGates | null;
}

export interface UnitsInPeriod {
  grain: Grain;
  period_start: string;
  period_end: string;
  units: UnitRow[];
}

export interface RuleFailures {
  rule_id: string;
  title: string | null;
  dimension: string;
  feeds: Feeds;
  scored: boolean | null;
  scores_on: "rate" | "statistic" | null;
  measured: boolean;
  n_workers: number;
  // Workers whose 0-100 score for the rule is below 100.
  n_workers_flagged: number;
  n_evaluated: number;
  n_violations: number;
  rate: number | null;
}

export interface RulesInPeriod {
  grain: Grain;
  period_start: string;
  period_end: string;
  rules: RuleFailures[];
}

export interface RuleWorker extends Gates {
  worker_id: string;
  peer_group_key: number | null;
  name: string | null;
  village_name: string | null;
  taluk_id: string | null;
  taluk_name: string | null;
  status: string;
  n_evaluated: number;
  n_violations: number;
  rate: number | null;
  // The measurement of a rule scored on one; null for a rule scored on its failure rate.
  statistic: number | null;
  sub_score: number | null;
  insufficient: boolean;
}

export interface RuleWorkersPage {
  rule_id: string;
  title: string | null;
  grain: Grain;
  period_start: string;
  period_end: string;
  total: number;
  total_violations: number;
  page: number;
  page_size: number;
  workers: RuleWorker[];
}

// One rule's outcome for one worker-period, from the worker score route.
export interface RuleRow {
  rule_id: string;
  feeds: Feeds;
  dimension: string;
  status: string;
  n_evaluated: number;
  n_violations: number;
  rate: number | null;
  statistic: number | null;
}

export interface WorkerPeriod extends Gates {
  period_start: string;
  period_end: string;
  peer_group_key: number | null;
  n_records: number;
  insufficient: boolean;
  trend: Trend | null;
  rules: RuleRow[];
}

export interface WorkerPeriodResponse {
  worker_id: string;
  periods: WorkerPeriod[];
}

export interface TypeCount {
  records: number;
  failed: number;
  unplaced: number;
}

// One day, or one week of a financial year, of a period's records by visit date. Without a
// rule filter `failed` counts records that failed any scored rule; with one, `records` counts
// the records that rule checked and `failed` those it failed. `unplaced` counts records with
// no taluk. `future` is a day after today in the tenant's zone.
export interface DayCount extends TypeCount {
  start: string;
  end: string;
  future: boolean;
  by_type: Record<string, TypeCount>;
}

export interface DaysInPeriod {
  grain: Grain;
  period_start: string;
  period_end: string;
  bucket: "day" | "week";
  // When the last analytics load finished, and the latest arrival time it read.
  loaded_at: string | null;
  covered_to: string | null;
  days: DayCount[];
}

// The tenant's taluk and village outlines from DQS's map route. Every ring is a list of
// [longitude, latitude] pairs with the closing point left off. A taluk's `label` is a point
// inside it to draw its name at, null when its outline has no polygon.
export type Ring = [number, number][];

export interface TalukOutline {
  unit_id: string;
  name: string;
  rings: Ring[];
  label: [number, number] | null;
}

export interface VillageOutline {
  village_id: string;
  aliases: string[];
  name: string;
  taluk_id: string;
  rings: Ring[];
}

export interface MapOutlines {
  location_version: string;
  taluks: TalukOutline[];
  villages: VillageOutline[];
}

// The records filed in one village in a period, from DQS's villages route, and the ids of the
// workers who filed them. `name` and `taluk_id` are null when DQS's location master has no
// row for the village.
export interface VillageCount {
  village_id: string;
  name: string | null;
  taluk_id: string | null;
  n_records: number;
  workers: string[];
}

export interface VillagesInPeriod {
  grain: Grain;
  period_start: string;
  period_end: string;
  villages: VillageCount[];
  unlocated_records: number;
}
