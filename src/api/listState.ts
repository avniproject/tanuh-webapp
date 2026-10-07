import type { GroupFilter, PendingSort } from "./pendingRows";

// tanuh-webapp#4: a tab's sort, filters, date range, Case ID search and page survive opening a case and coming back,
// and are gone after sign-out. One sessionStorage key per encounter-cache scope (organisation and user) holds both tabs.
export interface ListState {
  sort: PendingSort;
  group: GroupFilter;
  referral: string | null;
  loc: string | null;
  riskOnly: boolean;
  from: string;
  to: string;
  search: string;
  page: number;
}
export const DEFAULT_LIST_STATE: ListState = {
  sort: "group", group: "all", referral: null, loc: null, riskOnly: false, from: "", to: "", search: "", page: 0,
};

type Mode = "pending" | "completed";
type StateStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
const PREFIX = "list-state:";

function read(storage: StateStorage, scope: string): Partial<Record<Mode, Partial<ListState>>> {
  try {
    return JSON.parse(storage.getItem(PREFIX + scope) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

export function loadListState(storage: StateStorage, scope: string | null, mode: Mode): ListState {
  if (!scope) return DEFAULT_LIST_STATE;
  return { ...DEFAULT_LIST_STATE, ...(read(storage, scope)[mode] ?? {}) };
}

export function saveListState(storage: StateStorage, scope: string | null, mode: Mode, state: ListState): void {
  if (!scope) return;
  try {
    storage.setItem(PREFIX + scope, JSON.stringify({ ...read(storage, scope), [mode]: state }));
  } catch {
    // storage full or blocked: the choices last until the page is left, as before
  }
}

// sessionStorage survives the reload sign-out does, so sign-out clears every scope's entry.
export function clearListStates(storage: StateStorage): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k?.startsWith(PREFIX)) keys.push(k);
  }
  keys.forEach((k) => storage.removeItem(k));
}
