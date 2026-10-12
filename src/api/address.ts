import { getCatchmentLocations } from "./impl";

// Moved from programList.ts (tanuh-webapp#4): the pending list's location and referral-place filters use them too.

// {address type: name} for a catchment node and its ancestors — the shape the
// server uses for a subject's `location` and for a Location observation.
export async function addressChain(nodeUuid: string): Promise<Record<string, string>> {
  const { nodes } = await getCatchmentLocations();
  const byUuid = new Map(nodes.map((n) => [n.uuid, n]));
  const chain: Record<string, string> = {};
  for (let node = byUuid.get(nodeUuid); node; node = node.parentUuid ? byUuid.get(node.parentUuid) : undefined) {
    chain[node.type] = node.name;
  }
  return chain;
}

// An address (subject location / Location observation) lies in the subtree of
// the selected node when it carries every level of the node's own chain.
export function inSubtree(address: unknown, chain: Record<string, string>): boolean {
  if (!address || typeof address !== "object") return false;
  const levels = address as Record<string, unknown>;
  return Object.entries(chain).every(([type, name]) => levels[type] === name);
}

// Which of these patients live in the location's subtree, by their address. A patient whose read failed (null) or is
// missing cannot be placed: it is kept, and listed in `unplaced`, so a filtered list never loses a case without saying
// so (tanuh-webapp#4 review). A failed read used to place the patient nowhere, and its rows dropped out silently.
export function patientsInLocation<T extends { location?: unknown }>(
  ids: Iterable<string>,
  subjects: ReadonlyMap<string, T | null>,
  chain: Record<string, string>,
): { kept: Set<string>; unplaced: Set<string> } {
  const kept = new Set<string>();
  const unplaced = new Set<string>();
  for (const id of ids) {
    const subject = subjects.get(id);
    if (!subject) {
      kept.add(id);
      unplaced.add(id);
    } else if (inSubtree(subject.location, chain)) kept.add(id);
  }
  return { kept, unplaced };
}
