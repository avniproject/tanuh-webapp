import { describe, expect, it, vi } from "vitest";
import type { EncounterApiResponse } from "@/api/types";
import { bookHighRiskFollowUps } from "./followUps";

const review = { ID: "r1", "Subject ID": "p1" } as unknown as EncounterApiResponse;

describe("bookHighRiskFollowUps", () => {
  it("books both follow-ups on the review and reports nothing when both succeed", async () => {
    const referral = vi.fn().mockResolvedValue(undefined);
    const slip = vi.fn().mockResolvedValue(undefined);

    await expect(bookHighRiskFollowUps(review, { referral, slip })).resolves.toBeNull();

    expect(referral).toHaveBeenCalledWith(review);
    expect(slip).toHaveBeenCalledWith(review);
  });

  // Review finding: a failed High Risk Referral returned before the Referral Slip was even attempted.
  it("still books the slip when the referral fails, and says which one failed", async () => {
    const referral = vi.fn().mockRejectedValue(new Error("refused: outside the catchment"));
    const slip = vi.fn().mockResolvedValue(undefined);

    const problem = await bookHighRiskFollowUps(review, { referral, slip });

    expect(slip).toHaveBeenCalledWith(review);
    expect(problem).toContain("High Risk Referral");
    expect(problem).toContain("outside the catchment");
    expect(problem).not.toContain("Referral Slip failed");
  });

  it("names both when both fail", async () => {
    const problem = await bookHighRiskFollowUps(review, {
      referral: vi.fn().mockRejectedValue(new Error("a")),
      slip: vi.fn().mockRejectedValue(new Error("b")),
    });

    expect(problem).toContain("High Risk Referral");
    expect(problem).toContain("Referral Slip failed");
  });
});
