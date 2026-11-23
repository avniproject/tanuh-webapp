import { http } from "@/auth/httpClient";
import { getCatchmentLocations, type CatchmentLocationsResponse } from "./impl";

// The physician's places. Avni's catchment-locations call returns the places
// assigned to them, everything below, and the ancestors above, without saying
// which is which. The org-wide place list gives every real child of every
// place, so a tree node counts as theirs when it and all its real descendants
// are in the tree. An ancestor always has a real child outside the tree, so it
// does not count.

export interface Catchment {
  covered: Set<string>;
  // Covered places whose parent is not covered: the places to fetch by.
  tops: string[];
  contains(locationUuid: string | null | undefined): boolean;
}

interface OrgLocationRow {
  ID: string;
  Voided?: boolean;
  Parent?: { ID: string } | null;
}

interface OrgLocationPage {
  content: OrgLocationRow[];
  totalPages: number;
}

const PAGE_SIZE = 500;

let childrenCache: Promise<Map<string, string[]>> | null = null;
let catchmentCache: Promise<Catchment> | null = null;

async function fetchOrgChildren(): Promise<Map<string, string[]>> {
  const now = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const children = new Map<string, string[]>();
  // totalElements is the page's own count on this endpoint, so only totalPages
  // says when to stop.
  let totalPages = 1;
  for (let page = 0; page < totalPages; page++) {
    const { data } = await http.get<OrgLocationPage>("/api/locations", {
      params: { lastModifiedDateTime: "2000-01-01T00:00:00.000Z", now, size: PAGE_SIZE, page },
    });
    totalPages = data.totalPages;
    for (const row of data.content) {
      const parent = row.Parent?.ID;
      if (row.Voided || !parent) continue;
      const list = children.get(parent) ?? [];
      list.push(row.ID);
      children.set(parent, list);
    }
  }
  return children;
}

export function readOrgChildren(): Promise<Map<string, string[]>> {
  if (!childrenCache) {
    childrenCache = fetchOrgChildren().catch((err) => {
      childrenCache = null;
      throw err;
    });
  }
  return childrenCache;
}

export function buildCatchment(tree: CatchmentLocationsResponse, children: Map<string, string[]>): Catchment {
  const inTree = new Set(tree.nodes.map((n) => n.uuid));
  const memo = new Map<string, boolean>();
  const isCovered = (uuid: string): boolean => {
    const known = memo.get(uuid);
    if (known !== undefined) return known;
    memo.set(uuid, false); // a cycle in the data cannot cover itself
    const result = inTree.has(uuid) && (children.get(uuid) ?? []).every(isCovered);
    memo.set(uuid, result);
    return result;
  };
  const covered = new Set<string>();
  for (const n of tree.nodes) if (isCovered(n.uuid)) covered.add(n.uuid);
  const tops = tree.nodes
    .filter((n) => covered.has(n.uuid) && (!n.parentUuid || !covered.has(n.parentUuid)))
    .map((n) => n.uuid);
  return { covered, tops, contains: (uuid) => (uuid ? covered.has(uuid) : false) };
}

export function getCatchment(): Promise<Catchment> {
  if (!catchmentCache) {
    catchmentCache = Promise.all([getCatchmentLocations(), readOrgChildren()])
      .then(([tree, children]) => buildCatchment(tree, children))
      .catch((err) => {
        catchmentCache = null;
        throw err;
      });
  }
  return catchmentCache;
}

export function clearCatchment(): void {
  childrenCache = null;
  catchmentCache = null;
}
