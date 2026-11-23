import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";
import type { IdpClient } from "./IdpClient";
import { noteServerDate } from "./serverClock";

// Empty baseURL means same-origin: in dev, Vite proxies upstream; in prod,
// the bundle is served from the Avni origin itself.
const baseURL = import.meta.env.VITE_AVNI_API_BASE_URL ?? "";

export const http: AxiosInstance = axios.create({
  baseURL,
  withCredentials: true,
});

// PE-249 (FW2): every answer, a refusal included, tells the browser the server's clock (serverClock.ts).
http.interceptors.response.use(
  (response) => {
    noteServerDate(response.headers?.["date"]);
    return response;
  },
  (error: unknown) => {
    if (axios.isAxiosError(error)) noteServerDate(error.response?.headers?.["date"]);
    return Promise.reject(error);
  },
);

let idpRef: IdpClient | null = null;

let interceptorInstalled = false;

export function bindIdp(idp: IdpClient): void {
  idpRef = idp;
  if (interceptorInstalled) return;
  interceptorInstalled = true;
  http.interceptors.request.use(async (config) => {
    if (idpRef) await idpRef.attachAuthHeader(config);
    return config;
  });
}

// The sign-in client the app is using, once AuthProvider has bound one.
export function boundIdp(): IdpClient | null {
  return idpRef;
}

// Used before the IDP is configured; must bypass the interceptor.
export async function fetchIdpDetails<T>(): Promise<T> {
  const response = await axios.get<T>(`${baseURL}/idp-details`, {
    withCredentials: true,
    baseURL: undefined,
  });
  return response.data;
}

export type RequestConfig = AxiosRequestConfig;
