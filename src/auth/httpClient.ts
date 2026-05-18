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

export function bindIdp(idp: IdpClient): void {
  idpRef = idp;
  http.interceptors.request.use(async (config) => {
    if (idpRef) await idpRef.attachAuthHeader(http);
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
