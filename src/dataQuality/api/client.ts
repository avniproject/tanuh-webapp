// Calls to the data quality service (DQS) for the Data Quality screens. Each function fetches
// one of DQS's dashboard routes for the tenant named by VITE_DQS_TENANT and returns its body.
//
// DQS is a separate service from Avni. Requests go to VITE_DQS_API_BASE_URL, "/dqs" by default:
// in development the Vite dev server forwards /dqs to VITE_DQS_PROXY_TARGET; in production the
// host serving this app has to do the same, or the variable names DQS's own address and DQS
// has to allow this app's origin. Each request carries the signed-in user's token as
// `Authorization: Bearer`, which is how DQS reads it; DQS accepts only the users its tenant
// authentication file lists.
//
// `DqsError` carries the status of a refused or failed request, so that the screens can tell
// "not allowed" (401, 403) and "nothing stored for this period" (404) from a failure.

import axios, { AxiosError } from "axios";
import { boundIdp } from "@/auth/httpClient";
import type {
  Context,
  DaysInPeriod,
  Feeds,
  Grain,
  MapOutlines,
  RulesInPeriod,
  RuleWorkersPage,
  Status,
  UnitsInPeriod,
  VillagesInPeriod,
  WorkerHistory,
  WorkerPeriodResponse,
  WorkersPage,
} from "./types";

export const TENANT = import.meta.env.VITE_DQS_TENANT || "samvit";

// The largest page DQS serves; the CSV download and a rule's workers read this many at once.
export const MAX_PAGE_SIZE = 1000;

export class DqsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const dqs = axios.create({
  baseURL: `${import.meta.env.VITE_DQS_API_BASE_URL ?? "/dqs"}/v1/${TENANT}`,
  // Repeated keys for list parameters (feeds=a&feeds=b), which is what DQS reads.
  paramsSerializer: { indexes: null },
});

dqs.interceptors.request.use(async (config) => {
  const idp = boundIdp();
  if (idp) config.headers.set("Authorization", `Bearer ${await idp.getToken()}`);
  return config;
});

type Params = Record<string, string | number | string[] | null | undefined>;

async function get<T>(path: string, params: Params = {}): Promise<T> {
  const kept = Object.fromEntries(Object.entries(params).filter(([, value]) => value != null && value !== ""));
  try {
    return (await dqs.get<T>(path, { params: kept })).data;
  } catch (error) {
    if (error instanceof AxiosError && error.response) {
      const detail = (error.response.data as { detail?: unknown } | undefined)?.detail;
      throw new DqsError(error.response.status, typeof detail === "string" ? detail : error.message);
    }
    throw error;
  }
}

const period = (grain: Grain, start: string) => `/periods/${grain}/${start}`;

export const dqsApi = {
  context: () => get<Context>("/dashboard/context"),

  workers: (
    grain: Grain,
    start: string,
    options: {
      unitId?: string | null;
      status?: Status | null;
      band?: "high" | "mid" | "low" | null;
      order?: "worker" | "trust_asc" | "trust_desc";
      page?: number;
      pageSize?: number;
    } = {},
  ) =>
    get<WorkersPage>(`${period(grain, start)}/workers`, {
      unit_id: options.unitId,
      status: options.status,
      band: options.band,
      order: options.order,
      page: options.page,
      page_size: options.pageSize,
    }),

  units: (grain: Grain, start: string) => get<UnitsInPeriod>(`${period(grain, start)}/units`),

  rules: (grain: Grain, start: string, options: { unitId?: string | null; feeds?: Feeds[] } = {}) =>
    get<RulesInPeriod>(`${period(grain, start)}/rules`, { unit_id: options.unitId, feeds: options.feeds }),

  ruleWorkers: (
    grain: Grain,
    start: string,
    ruleId: string,
    options: { unitId?: string | null; page?: number; pageSize?: number } = {},
  ) =>
    get<RuleWorkersPage>(`${period(grain, start)}/rules/${encodeURIComponent(ruleId)}/workers`, {
      unit_id: options.unitId,
      page: options.page,
      page_size: options.pageSize,
    }),

  // Every worker of a rule, a page of MAX_PAGE_SIZE at a time, as one page.
  allRuleWorkers: async (grain: Grain, start: string, ruleId: string, options: { unitId?: string | null } = {}) => {
    const first = await dqsApi.ruleWorkers(grain, start, ruleId, { ...options, pageSize: MAX_PAGE_SIZE });
    const workers = [...first.workers];
    for (let page = 2; workers.length < first.total; page++) {
      const next = await dqsApi.ruleWorkers(grain, start, ruleId, { ...options, page, pageSize: MAX_PAGE_SIZE });
      if (!next.workers.length) break;
      workers.push(...next.workers);
    }
    return { ...first, page: 1, page_size: workers.length, workers };
  },

  days: (
    grain: Grain,
    start: string,
    options: {
      unitId?: string | null;
      workerId?: string | null;
      peerGroupKey?: string | null;
      ruleId?: string | null;
    } = {},
  ) =>
    get<DaysInPeriod>(`${period(grain, start)}/days`, {
      unit_id: options.unitId,
      worker_id: options.workerId,
      peer_group_key: options.peerGroupKey,
      rule_id: options.ruleId,
    }),

  workerPeriod: (workerId: string, grain: Grain, start: string) =>
    get<WorkerPeriodResponse>(`/scores/workers/${encodeURIComponent(workerId)}/${grain}/${start}`),

  // Each village's records in the period, of one record type when `recordType` is given.
  villages: (grain: Grain, start: string, recordType?: string | null) =>
    get<VillagesInPeriod>(`${period(grain, start)}/villages`, { record_type: recordType }),

  // The taluk and village outlines; 404 until the tenant's village boundaries are imported.
  map: () => get<MapOutlines>("/map"),

  workerHistory: (workerId: string, grain: Grain) =>
    get<WorkerHistory>(`/scores/workers/${encodeURIComponent(workerId)}/${grain}`),
};
