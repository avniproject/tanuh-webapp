import { http } from "@/auth/httpClient";

// Mobile syncs the encounter and its media on SEPARATE queues: until the
// photo file finishes uploading, the observation holds just the bare file
// name (e.g. "49ab7d66-….jpg"); after upload it is rewritten in place to the
// full S3 URL. Asking the server to sign a bare name throws (HTTP 500), so
// detect the state up front and let the UI show a "not synced yet" message.
export function isPendingMediaUpload(value: string): boolean {
  return !/^https?:\/\//i.test(value);
}

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
