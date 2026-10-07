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
