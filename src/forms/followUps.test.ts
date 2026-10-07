import { describe, expect, it, vi } from "vitest";
import type { EncounterApiResponse } from "@/api/types";
import { bookHighRiskFollowUps } from "./followUps";

const review = { ID: "r1", "Subject ID": "p1" } as unknown as EncounterApiResponse;
const both = ["referral", "slip"] as const;

describe("bookHighRiskFollowUps", () => {
  it("books both follow-ups on the review and reports nothing when both succeed", async () => {
    const referral = vi.fn().mockResolvedValue(undefined);
    const slip = vi.fn().mockResolvedValue(undefined);

    await expect(bookHighRiskFollowUps(review, both, { referral, slip })).resolves.toEqual({ failed: [], problem: null });

    expect(referral).toHaveBeenCalledWith(review);
    expect(slip).toHaveBeenCalledWith(review);
  });

  // Review finding: a failed High Risk Referral returned before the Referral Slip was even attempted.
  it("still books the slip when the referral fails, and says which one failed", async () => {
    const referral = vi.fn().mockRejectedValue(new Error("refused: outside the catchment"));
    const slip = vi.fn().mockResolvedValue(undefined);

    const outcome = await bookHighRiskFollowUps(review, both, { referral, slip });

    expect(slip).toHaveBeenCalledWith(review);
    expect(outcome.failed).toEqual(["referral"]);
    expect(outcome.problem).toContain("High Risk Referral");
    expect(outcome.problem).toContain("outside the catchment");
    expect(outcome.problem).not.toContain("Referral Slip failed");
  });

  it("names both when both fail", async () => {
    const outcome = await bookHighRiskFollowUps(review, both, {
      referral: vi.fn().mockRejectedValue(new Error("a")),
      slip: vi.fn().mockRejectedValue(new Error("b")),
    });

    expect(outcome.failed).toEqual(["referral", "slip"]);
    expect(outcome.problem).toContain("High Risk Referral");
    expect(outcome.problem).toContain("Referral Slip failed");
  });

  // Found live: the retry checked again for the slip it had just booked, and the server refuses that check to a
  // physician who cannot view slips, so the retry could never succeed.
  it("tries again only the bookings that failed", async () => {
    const referral = vi.fn().mockResolvedValue(undefined);
    const slip = vi.fn().mockRejectedValue(new Error("Request failed with status code 403"));

    const outcome = await bookHighRiskFollowUps(review, ["referral"], { referral, slip });

    expect(referral).toHaveBeenCalledWith(review);
    expect(slip).not.toHaveBeenCalled();
    expect(outcome).toEqual({ failed: [], problem: null });
  });
});
