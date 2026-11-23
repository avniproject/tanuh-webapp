// PE-249 (FW2): a hold runs for ten minutes from the server's own write time, so it is judged, and a hold time is
// written, by the server's clock. A device clock off by minutes would otherwise see a colleague's live hold as lapsed,
// or its own fresh hold as waiting. The browser learns the server's clock from the Date header on every API response
// (httpClient.ts); until one has arrived, or when a response carries none, the last known offset (at first none)
// applies.

let offsetMs = 0;

/**
 * Milliseconds to add to the browser's clock to read the server's, from a Date header received at `receivedAtMs`.
 * The header has whole seconds, so the middle of that second is taken. Null for a missing or unreadable header.
 */
export function offsetFromDateHeader(header: unknown, receivedAtMs: number): number | null {
  if (typeof header !== "string" || !header) return null;
  const serverMs = Date.parse(header);
  if (Number.isNaN(serverMs)) return null;
  return serverMs + 500 - receivedAtMs;
}

export function noteServerDate(header: unknown, receivedAtMs: number = Date.now()): void {
  const offset = offsetFromDateHeader(header, receivedAtMs);
  if (offset !== null) offsetMs = offset;
}

export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}

export function resetServerClock(): void {
  offsetMs = 0;
}
