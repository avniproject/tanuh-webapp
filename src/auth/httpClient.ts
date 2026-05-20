import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";
import type { IdpClient } from "./IdpClient";

// Empty baseURL means same-origin: in dev, Vite proxies upstream; in prod,
// the bundle is served from the Avni origin itself.
const baseURL = import.meta.env.VITE_AVNI_API_BASE_URL ?? "";

export const http: AxiosInstance = axios.create({
  baseURL,
  withCredentials: true,
});

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

// Used before the IDP is configured; must bypass the interceptor.
export async function fetchIdpDetails<T>(): Promise<T> {
  const response = await axios.get<T>(`${baseURL}/idp-details`, {
    withCredentials: true,
    baseURL: undefined,
  });
  return response.data;
}

export type RequestConfig = AxiosRequestConfig;
