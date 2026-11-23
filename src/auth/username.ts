// A username as the lists show it: without the organisation's suffix, which /me gives as `usernameSuffix`
// ("physician4@tanuh_uat_local" reads "physician4"). Only a whole trailing "@<suffix>" goes; with no suffix known, or
// nothing left before it, the username stays whole.
export function shortUsername(username: string, suffix: string | undefined): string {
  if (!suffix) return username;
  const tail = `@${suffix}`;
  return username.endsWith(tail) && username.length > tail.length ? username.slice(0, -tail.length) : username;
}
