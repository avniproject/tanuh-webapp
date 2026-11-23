import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteServerDate, offsetFromDateHeader, resetServerClock, serverNow } from "./serverClock";

// FW2 (PE-249 final review): a hold is judged by the server's clock. The browser learns it from the Date header.
const SERVER = Date.UTC(2026, 10, 23, 7, 32, 7);
const HEADER = "Mon, 23 Nov 2026 07:32:07 GMT";
const MIN = 60_000;

describe("offsetFromDateHeader", () => {
  it("is the server's time less the browser's, taking the middle of the header's whole second", () => {
    expect(offsetFromDateHeader(HEADER, SERVER + 500)).toBe(0);
    // A browser fifteen minutes slow adds fifteen minutes; one twelve minutes fast takes twelve off.
    expect(offsetFromDateHeader(HEADER, SERVER + 500 - 15 * MIN)).toBe(15 * MIN);
    expect(offsetFromDateHeader(HEADER, SERVER + 500 + 12 * MIN)).toBe(-12 * MIN);
  });

  it("is null for a missing, empty or unreadable header", () => {
    expect(offsetFromDateHeader(undefined, SERVER)).toBeNull();
    expect(offsetFromDateHeader(null, SERVER)).toBeNull();
    expect(offsetFromDateHeader("", SERVER)).toBeNull();
    expect(offsetFromDateHeader("not a date", SERVER)).toBeNull();
    expect(offsetFromDateHeader(12345, SERVER)).toBeNull();
  });
});

describe("serverNow", () => {
  beforeEach(() => {
    resetServerClock();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetServerClock();
  });

  it("is the browser's clock until a response has carried a Date header", () => {
    vi.setSystemTime(SERVER);
    expect(serverNow().getTime()).toBe(SERVER);
  });

  it("follows the server's clock once a Date header has been seen, as the browser's clock moves on", () => {
    const browser = SERVER + 500 - 15 * MIN;
    vi.setSystemTime(browser);
    noteServerDate(HEADER);
    expect(serverNow().getTime()).toBe(SERVER + 500);
    vi.setSystemTime(browser + 4 * MIN);
    expect(serverNow().getTime()).toBe(SERVER + 500 + 4 * MIN);
  });

  it("keeps the last offset when a later response has no usable header", () => {
    vi.setSystemTime(SERVER + 500 - 15 * MIN);
    noteServerDate(HEADER);
    noteServerDate(undefined);
    noteServerDate("garbage");
    expect(serverNow().getTime()).toBe(SERVER + 500);
  });

  it("takes the newest header", () => {
    vi.setSystemTime(SERVER + 500 - 15 * MIN);
    noteServerDate(HEADER);
    vi.setSystemTime(SERVER + 500);
    noteServerDate(HEADER);
    expect(serverNow().getTime()).toBe(SERVER + 500);
  });
});
