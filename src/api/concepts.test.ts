import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxiosError, type AxiosResponse } from "axios";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/auth/httpClient", () => ({ http: { get: (...args: unknown[]) => get(...args) } }));

import { hasHighRiskModel, hasReviewQueue, resetConceptCache } from "./concepts";
import { IN_REVIEW_BY_CONCEPT, REVIEW_CATEGORY_CONCEPT } from "@/constants/tanuhConcepts";

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

  // The server still answers for a voided concept, with its name: that kept UAT's Data Quality gate on after PE-136.
  it("is off where the organisation voided its Review category concept", async () => {
    get.mockResolvedValueOnce({ data: { ...reviewCategory.data, voided: true } });
    await expect(hasHighRiskModel()).resolves.toBe(false);
  });

  // Review finding: one 503 during a server restart switched the model's cases off for the rest of the session.
  it("fails the load on any other error, and asks again on the next one", async () => {
    get.mockRejectedValueOnce(answered(503)).mockResolvedValueOnce(reviewCategory);
    await expect(hasHighRiskModel()).rejects.toBeInstanceOf(AxiosError);
    await expect(hasHighRiskModel()).resolves.toBe(true);
  });
});

// PE-249 (D3): the review queue applies only where the organisation has the "In review by" concept, asked for by name.
describe("hasReviewQueue", () => {
  const inReviewBy = { data: { uuid: "u-1", name: IN_REVIEW_BY_CONCEPT.name, dataType: "Text", conceptAnswers: [] } };

  beforeEach(() => {
    get.mockReset();
    resetConceptCache();
  });

  it("is on where the organisation has In review by, asked for by name", async () => {
    get.mockResolvedValueOnce(inReviewBy);
    await expect(hasReviewQueue()).resolves.toBe(true);
    expect(get).toHaveBeenCalledWith("/web/concept?name=In%20review%20by");
  });

  it("asks once and remembers the answer until the concept cache is reset", async () => {
    get.mockResolvedValue(inReviewBy);
    await hasReviewQueue();
    await hasReviewQueue();
    expect(get).toHaveBeenCalledTimes(1);
    resetConceptCache();
    await hasReviewQueue();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("is off where the server answers 404", async () => {
    get.mockRejectedValueOnce(answered(404));
    await expect(hasReviewQueue()).resolves.toBe(false);
  });

  it("is off where the concept is voided or comes back under another name", async () => {
    get.mockResolvedValueOnce({ data: { ...inReviewBy.data, voided: true } });
    await expect(hasReviewQueue()).resolves.toBe(false);
    resetConceptCache();
    get.mockResolvedValueOnce({ data: { ...inReviewBy.data, name: "In Review By" } });
    await expect(hasReviewQueue()).resolves.toBe(false);
  });

  it("fails the load on a 503, and asks again on the next one", async () => {
    get.mockRejectedValueOnce(answered(503)).mockResolvedValueOnce(inReviewBy);
    await expect(hasReviewQueue()).rejects.toBeInstanceOf(AxiosError);
    await expect(hasReviewQueue()).resolves.toBe(true);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
