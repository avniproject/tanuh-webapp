import { http } from "@/auth/httpClient";

// Mobile syncs the encounter and its media on SEPARATE queues: until the
// photo file finishes uploading, the observation holds just the bare file
// name (e.g. "49ab7d66-….jpg"); after upload it is rewritten in place to the
// full S3 URL. Asking the server to sign a bare name throws (HTTP 500), so
// detect the state up front and let the UI show a "not synced yet" message.
export function isPendingMediaUpload(value: string): boolean {
  return !/^https?:\/\//i.test(value);
}

// S3 presigned URLs typically last 15–60 minutes, so entries must expire well
// before that: a session left open past the S3 expiry would otherwise reuse a
// stale URL and render a broken image (CPG-2163).
const SIGNED_URL_TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { promise: Promise<string>; signedAt: number }>();

export function getSignedMediaUrl(unsignedUrl: string): Promise<string> {
  const cached = cache.get(unsignedUrl);
  if (cached && Date.now() - cached.signedAt < SIGNED_URL_TTL_MS) return cached.promise;
  const promise = http
    .get<string>("/media/signedUrl", { params: { url: unsignedUrl } })
    .then((r) => r.data);
  cache.set(unsignedUrl, { promise, signedAt: Date.now() });
  promise.catch(() => cache.delete(unsignedUrl));
  return promise;
}

// For MediaImg's onError: the TTL can't catch a URL that expires mid-window
// (or a clock-skewed server), so the <img> failure path drops the entry and
// re-signs instead of leaving a broken thumbnail.
export function evictSignedMediaUrl(unsignedUrl: string): void {
  cache.delete(unsignedUrl);
}
