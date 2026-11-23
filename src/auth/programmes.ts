import type { MeResponse } from "./authContext";

// A clinician's programme modules come from the Avni user groups they are in. Nothing is managed
// here: adding someone to a group in Avni is what gives them the module.
export type ProgrammeKey = "oral" | "breast";

export interface Programme {
  key: ProgrammeKey;
  name: string;
  group: string;
  home: string;
}

export const PROGRAMMES: Record<ProgrammeKey, Programme> = {
  oral: { key: "oral", name: "Oral Cancer Screening", group: "Physician", home: "/pending" },
  breast: {
    key: "breast",
    name: "Breast Cancer Screening",
    group: "Breast Cancer Clinician",
    home: "/breast",
  },
};

const ORDER: ProgrammeKey[] = ["oral", "breast"];

export function allocatedProgrammes(me: MeResponse): ProgrammeKey[] {
  const groups = new Set((me.myUserGroups ?? []).filter((g) => !g.voided).map((g) => g.groupName));
  return ORDER.filter((key) => groups.has(PROGRAMMES[key].group));
}

export function landingPath(programmes: ProgrammeKey[]): string {
  return programmes.length ? PROGRAMMES[programmes[0]].home : "/no-programme";
}

const ORAL_PATHS = ["/pending", "/completed", "/review", "/case"];
const under = (pathname: string, root: string): boolean => pathname === root || pathname.startsWith(`${root}/`);

/** The programme a screen belongs to, or null for a screen outside the programme modules. */
export function programmeOfPath(pathname: string): ProgrammeKey | null {
  if (under(pathname, "/breast")) return "breast";
  if (ORAL_PATHS.some((p) => under(pathname, p))) return "oral";
  return null;
}
