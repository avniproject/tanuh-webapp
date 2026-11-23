// A review's unsent answers are kept in sessionStorage per case, so they survive a refresh (ReviewForm). They are not
// tied to who is signed in, and sessionStorage survives the reload sign-out does, so sign-out clears them all (FW11).
// Kept apart from ReviewForm.tsx, which may export only components.
const PREFIX = "review-form:";

export function reviewDraftKey(page: { encounterUuid?: string; screeningUuid?: string }): string {
  return page.screeningUuid ? `${PREFIX}case:${page.screeningUuid}` : `${PREFIX}${page.encounterUuid}`;
}

export function clearReviewDrafts(storage: Pick<Storage, "key" | "length" | "removeItem">): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => storage.removeItem(k));
  } catch {
    // storage blocked: there is nothing it could have kept.
  }
}
