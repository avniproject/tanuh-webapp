import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxiosError, type AxiosResponse } from "axios";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/auth/httpClient", () => ({ http: { get: (...args: unknown[]) => get(...args) } }));

import { hasHighRiskModel, resetConceptCache } from "./concepts";
import { REVIEW_CATEGORY_CONCEPT } from "@/constants/tanuhConcepts";

const answered = (status: number) =>
  new AxiosError(`status ${status}`, "ERR_BAD_RESPONSE", undefined, undefined, { status } as AxiosResponse);
const reviewCategory = {
  data: { uuid: REVIEW_CATEGORY_CONCEPT.uuid, name: REVIEW_CATEGORY_CONCEPT.name, dataType: "Coded", conceptAnswers: [] },
};

describe("hasHighRiskModel", () => {
  beforeEach(() => {
    get.mockReset();
    resetConceptCache();
  });

  it("is off where the organisation has no Review category concept: the server answers 404", async () => {
    get.mockRejectedValueOnce(answered(404));
    await expect(hasHighRiskModel()).resolves.toBe(false);
  });

  // Review finding: one 503 during a server restart switched the model's cases off for the rest of the session.
  it("fails the load on any other error, and asks again on the next one", async () => {
    get.mockRejectedValueOnce(answered(503)).mockResolvedValueOnce(reviewCategory);
    await expect(hasHighRiskModel()).rejects.toBeInstanceOf(AxiosError);
    await expect(hasHighRiskModel()).resolves.toBe(true);
  });
});
