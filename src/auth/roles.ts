import type { MeResponse } from "./authContext";

const PHYSICIAN_GROUP = "Physician";
const ADMIN_GROUPS = new Set(["Administrators"]);

export function isPhysician(me: MeResponse): boolean {
  return (me.myUserGroups ?? []).some(
    (g) => !g.voided && g.groupName === PHYSICIAN_GROUP,
  );
}

export function isAdmin(me: MeResponse): boolean {
  return (me.myUserGroups ?? []).some(
    (g) => !g.voided && ADMIN_GROUPS.has(g.groupName),
  );
}
