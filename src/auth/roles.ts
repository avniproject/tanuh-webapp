import type { MeResponse } from "./authContext";

// The Avni user group whose members see the Data Quality screens.
const PROGRAMME_MANAGER_GROUP = "Programme Manager";

export function isProgrammeManager(me: MeResponse): boolean {
  return (me.myUserGroups ?? []).some(
    (g) => !g.voided && g.groupName === PROGRAMME_MANAGER_GROUP,
  );
}
