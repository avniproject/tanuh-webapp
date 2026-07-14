import type { MeResponse } from "./authContext";

const PHYSICIAN_GROUP = "Physician";

export function isPhysician(me: MeResponse): boolean {
  return (me.myUserGroups ?? []).some(
    (g) => !g.voided && g.groupName === PHYSICIAN_GROUP,
  );
}
