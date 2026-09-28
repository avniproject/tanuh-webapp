import { getConcept } from "./concepts";
import { isCompleted, isScheduled, sweepProgramEncounters } from "./encounters";
import { getCatchmentLocations, type EncounterListParams, type EncounterWithLocation } from "./impl";
import { getSubject } from "./subjects";
import type { SubjectApiResponse } from "./types";

// ---------------------------------------------------------------------------
// The list tabs' rows for encounters recorded INSIDE a program (Tanuh Staging
// records the oral-cancer chain in the NCD program, PE-83).
//
// The tabs normally come from /api/impl/encountersWithLocation, which reads
// only the standalone encounter table. For program encounters the same
// EncounterWithLocation rows are built here from the stock program API: the
// encounters of the type, each subject fetched once for its Case ID and
// address, and the location / referral-facility filters applied by address
// chain in the browser (the impl endpoint does those in SQL).
//
// Scale: one subject request per patient with a program review. Fine for the
// staging org; an org with many program visits needs encountersWithLocation to
// return them server-side instead (CPG-2170 territory).
// ---------------------------------------------------------------------------

// One request per patient, kept for the page's life: a subject's Case ID and
// address do not change under a review, and subject uuids are unique across
// orgs, so a sign-in change cannot serve another org's row from here.
const subjectMemo = new Map<string, Promise<SubjectApiResponse>>();

function subjectOnce(uuid: string): Promise<SubjectApiResponse> {
  let cached = subjectMemo.get(uuid);
  if (!cached) {
    cached = getSubject(uuid);
    subjectMemo.set(uuid, cached);
    cached.catch(() => subjectMemo.delete(uuid));
  }
  return cached;
}

// {address type: name} for a catchment node and its ancestors — the shape the
// server uses for a subject's `location` and for a Location observation.
async function addressChain(nodeUuid: string): Promise<Record<string, string>> {
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
function inSubtree(address: unknown, chain: Record<string, string>): boolean {
  if (!address || typeof address !== "object") return false;
  const levels = address as Record<string, unknown>;
  return Object.entries(chain).every(([type, name]) => levels[type] === name);
}

export async function getProgramEncountersWithLocation(
  p: Omit<EncounterListParams, "page" | "size">,
): Promise<EncounterWithLocation[]> {
  const encounters = (await sweepProgramEncounters(p.encounterType)).filter((e) =>
    p.status === "scheduled" ? isScheduled(e) : p.status === "completed" ? isCompleted(e) : !e.Voided,
  );
  if (encounters.length === 0) return [];

  let subjectIds = [...new Set(encounters.map((e) => e["Subject ID"]))];
  const subjects = new Map(
    await Promise.all(subjectIds.map(async (id) => [id, await subjectOnce(id)] as const)),
  );

  if (p.locationUuid) {
    const chain = await addressChain(p.locationUuid);
    subjectIds = subjectIds.filter((id) => inSubtree(subjects.get(id)?.location, chain));
  }
  if (p.linkedEncounterType && p.linkedObservationConceptUuid && p.linkedLocationUuid) {
    const [chain, concept, linked] = await Promise.all([
      addressChain(p.linkedLocationUuid),
      getConcept(p.linkedObservationConceptUuid),
      sweepProgramEncounters(p.linkedEncounterType),
    ]);
    const matching = new Set(
      linked
        .filter((e) => isCompleted(e) && inSubtree(e.observations?.[concept.name], chain))
        .map((e) => e["Subject ID"]),
    );
    subjectIds = subjectIds.filter((id) => matching.has(id));
  }

  const keep = new Set(subjectIds);
  return encounters
    .filter((e) => keep.has(e["Subject ID"]))
    .map((e) => {
      const subject = subjects.get(e["Subject ID"]);
      const location: Record<string, string> = {};
      for (const [type, name] of Object.entries(subject?.location ?? {})) if (name) location[type] = name;
      return {
        encounterUuid: e.ID,
        encounterTypeName: e["Encounter type"],
        encounterDateTime: e["Encounter date time"],
        earliestScheduledDate: e["Earliest scheduled date"],
        voided: e.Voided,
        subject: {
          uuid: e["Subject ID"],
          externalId: subject?.["External ID"] ?? e["Subject external ID"],
          // The review UI is name-blind; the impl endpoint's displayName is not shown either.
          displayName: "",
          location,
        },
        lastModifiedBy: isCompleted(e) ? (e.audit?.["Last modified by"] ?? null) : null,
      };
    });
}
