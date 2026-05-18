import { http } from "@/auth/httpClient";

// S3 presigned URLs typically last 15–60 minutes; this cache lives for the
// page lifetime. A long-idle tab will hit 403 and fall back to MediaImg's
// error state — acceptable for v1.
const cache = new Map<string, Promise<string>>();

export function getSignedMediaUrl(unsignedUrl: string): Promise<string> {
  const cached = cache.get(unsignedUrl);
  if (cached) return cached;
  const promise = http
    .get<string>("/media/signedUrl", { params: { url: unsignedUrl } })
    .then((r) => r.data);
  cache.set(unsignedUrl, promise);
  return promise;
}
