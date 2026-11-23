// Where the review page goes once a review is saved (PE-249). Complete goes back to the list. Complete and review next
// case takes the next case the way the list's Review next case button does and opens it; with no case waiting it goes
// back to the list. When the take fails the review is already saved, so the list opens and says the take failed.
// Complete and review next case replaces the page it leaves in the history, so the page's back arrow returns to the list
// rather than walking back through the cases already completed.
export interface AfterComplete {
  path: string;
  replace?: true;
  takeFailed?: true;
}

export async function pageAfterComplete(
  andNext: boolean,
  takeNext: () => Promise<string | null>,
): Promise<AfterComplete> {
  if (!andNext) return { path: "/pending" };
  try {
    const reviewUuid = await takeNext();
    return { path: reviewUuid ? `/review/${reviewUuid}` : "/pending", replace: true };
  } catch (err) {
    // The physician sees a plain message on the list; the detail goes to the console.
    console.error("Complete and review next case: could not take the next case", err);
    return { path: "/pending", replace: true, takeFailed: true };
  }
}
