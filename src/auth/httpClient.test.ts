import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http } from "./httpClient";
import { resetServerClock, serverNow } from "./serverClock";

// FW2: every API answer, a refusal included, sets the server clock from its Date header.
const SERVER = Date.UTC(2026, 10, 23, 7, 32, 7);
const HEADER = "Mon, 23 Nov 2026 07:32:07 GMT";
const SLOW = 15 * 60_000;

describe("http's server clock", () => {
  const original = http.defaults.adapter;
  beforeEach(() => {
    resetServerClock();
    vi.useFakeTimers();
    vi.setSystemTime(SERVER + 500 - SLOW);
  });
  afterEach(() => {
    http.defaults.adapter = original;
    vi.useRealTimers();
    resetServerClock();
  });

  it("reads the Date header of a successful answer", async () => {
    http.defaults.adapter = async (config: InternalAxiosRequestConfig) => ({
      data: {},
      status: 200,
      statusText: "OK",
      headers: new AxiosHeaders({ date: HEADER }),
      config,
    });
    await http.get("/api/anything");
    expect(serverNow().getTime()).toBe(SERVER + 500);
  });

  it("reads the Date header of a refusal, and still rejects", async () => {
    http.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      const response = { data: {}, status: 404, statusText: "Not Found", headers: new AxiosHeaders({ date: HEADER }), config };
      throw new AxiosError("nf", "ERR_BAD_REQUEST", config, undefined, response);
    };
    await expect(http.get("/api/anything")).rejects.toThrow("nf");
    expect(serverNow().getTime()).toBe(SERVER + 500);
  });

  it("leaves the clock alone for an answer without one", async () => {
    http.defaults.adapter = async (config: InternalAxiosRequestConfig) => ({
      data: {},
      status: 200,
      statusText: "OK",
      headers: new AxiosHeaders(),
      config,
    });
    await http.get("/api/anything");
    expect(serverNow().getTime()).toBe(SERVER + 500 - SLOW);
  });
});
