import type { MeResponse } from "./authContext";

const PHYSICIAN_GROUP = "Physician";

export function isPhysician(me: MeResponse): boolean {
  return (me.myUserGroups ?? []).some(
    (g) => !g.voided && g.groupName === PHYSICIAN_GROUP,
  );
}

// The Avni user group whose members see the Data Quality screens.
const PROGRAMME_MANAGER_GROUP = "Programme Manager";

export function isProgrammeManager(me: MeResponse): boolean {
  return (me.myUserGroups ?? []).some(
    (g) => !g.voided && g.groupName === PROGRAMME_MANAGER_GROUP,
  );
}
