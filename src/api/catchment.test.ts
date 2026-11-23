import { beforeEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/auth/httpClient", () => ({ http: { get: (...args: unknown[]) => get(...args) } }));

import { buildCatchment, clearCatchment, readOrgChildren } from "./catchment";
import type { CatchmentLocationNode, CatchmentLocationsResponse } from "./impl";

const node = (uuid: string, type: string, parentUuid: string | null): CatchmentLocationNode => ({
  uuid,
  name: uuid,
  type,
  parentUuid,
});
const tree = (nodes: CatchmentLocationNode[]): CatchmentLocationsResponse => ({
  nodes,
  rootUuids: nodes.filter((n) => n.parentUuid === null).map((n) => n.uuid),
});

// Org: State -> District A -> Taluka -> {A1, A2}; State -> District B -> B1
const orgChildren = new Map<string, string[]>([
  ["state", ["distA", "distB"]],
  ["distA", ["taluka"]],
  ["taluka", ["a1", "a2"]],
  ["distB", ["b1"]],
]);

describe("buildCatchment", () => {
  it("fails closed when the org place list is empty but the tree has places", () => {
    expect(() => buildCatchment(tree([node("state", "State", null)]), new Map())).toThrow();
  });

  it("covers a district and everything below it, not the state above", () => {
    const c = buildCatchment(
      tree([
        node("state", "State", null),
        node("distA", "District", "state"),
        node("taluka", "Taluka", "distA"),
        node("a1", "Village", "taluka"),
        node("a2", "Village", "taluka"),
      ]),
      orgChildren,
    );
    expect([...c.covered].sort()).toEqual(["a1", "a2", "distA", "taluka"]);
    expect(c.tops).toEqual(["distA"]);
    expect(c.contains("a1")).toBe(true);
    expect(c.contains("b1")).toBe(false);
    expect(c.contains("state")).toBe(false);
    expect(c.contains(undefined)).toBe(false);
    expect(c.contains(null)).toBe(false);
  });

  it("covers a single village and leaves its ancestors uncovered", () => {
    const c = buildCatchment(
      tree([
        node("state", "State", null),
        node("distA", "District", "state"),
        node("taluka", "Taluka", "distA"),
        node("a1", "Village", "taluka"),
      ]),
      orgChildren,
    );
    expect([...c.covered]).toEqual(["a1"]);
    expect(c.tops).toEqual(["a1"]);
    expect(c.contains("taluka")).toBe(false);
    expect(c.contains("distA")).toBe(false);
  });

  it("contains nothing for an empty tree", () => {
    const c = buildCatchment(tree([]), orgChildren);
    expect(c.covered.size).toBe(0);
    expect(c.tops).toEqual([]);
    expect(c.contains("a1")).toBe(false);
  });
});

describe("placesUnder", () => {
  const district = () =>
    buildCatchment(
      tree([
        node("state", "State", null),
        node("distA", "District", "state"),
        node("taluka", "Taluka", "distA"),
        node("a1", "Village", "taluka"),
        node("a2", "Village", "taluka"),
      ]),
      orgChildren,
    );

  it("gives a covered place and every covered place below it", () => {
    const c = district();
    expect([...c.placesUnder("distA")].sort()).toEqual(["a1", "a2", "distA", "taluka"]);
    expect([...c.placesUnder("taluka")].sort()).toEqual(["a1", "a2", "taluka"]);
    expect([...c.placesUnder("a1")]).toEqual(["a1"]);
  });

  it("gives nothing for a place that is not covered, or none", () => {
    const c = district();
    expect(c.placesUnder("state").size).toBe(0);
    expect(c.placesUnder("b1").size).toBe(0);
    expect(c.placesUnder(null).size).toBe(0);
    expect(c.placesUnder(undefined).size).toBe(0);
  });

  it("leaves out an uncovered place even when its parent link sits under the chosen place", () => {
    // Only a1 is covered; the taluka above it is not, so a1 is not under the taluka here.
    const c = buildCatchment(
      tree([
        node("state", "State", null),
        node("distA", "District", "state"),
        node("taluka", "Taluka", "distA"),
        node("a1", "Village", "taluka"),
      ]),
      orgChildren,
    );
    expect(c.placesUnder("taluka").size).toBe(0);
    expect([...c.placesUnder("a1")]).toEqual(["a1"]);
  });
});

const row = (id: string, parent: string | null, voided = false) => ({
  ID: id,
  Title: id,
  Type: "Village",
  Voided: voided,
  ...(parent ? { Parent: { ID: parent } } : {}),
});
const locPage = (content: unknown[], totalPages: number) => ({
  data: { content, totalElements: content.length, totalPages, pageSize: 500 },
});

describe("readOrgChildren", () => {
  beforeEach(() => {
    get.mockReset();
    clearCatchment();
  });

  it("joins every page, sends both dates and drops voided rows", async () => {
    get.mockImplementation((_url: string, { params }: { params: { page: number } }) =>
      Promise.resolve(
        params.page === 0
          ? locPage([row("state", null), row("distA", "state")], 2)
          : locPage([row("distB", "state"), row("gone", "state", true)], 2),
      ),
    );
    const children = await readOrgChildren();
    expect(children.get("state")).toEqual(["distA", "distB"]);
    expect(children.has("gone")).toBe(false);
    expect(get).toHaveBeenCalledTimes(2);
    const [url, { params }] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(url).toBe("/api/locations");
    expect(params.lastModifiedDateTime).toBe("2000-01-01T00:00:00.000Z");
    expect(params.size).toBe(500);
    expect(new Date(params.now as string).getTime()).toBeGreaterThan(Date.now());
    await readOrgChildren();
    expect(get).toHaveBeenCalledTimes(2);
  });

  // FW9: a place added or removed while the pages are read shifts the rows; a skipped row can make an ancestor look
  // covered. A place seen twice shows the shift, and the read is refused (and asked again on the next load).
  it("throws when a place comes back on two pages, and reads afresh next time", async () => {
    get.mockImplementation((_url: string, { params }: { params: { page: number } }) =>
      Promise.resolve(
        params.page === 0
          ? locPage([row("state", null), row("distA", "state")], 2)
          : locPage([row("distA", "state"), row("distB", "state")], 2),
      ),
    );
    await expect(readOrgChildren()).rejects.toThrow(/changed while it was read/);
    get.mockImplementation(() => Promise.resolve(locPage([row("state", null), row("distA", "state")], 1)));
    await expect(readOrgChildren()).resolves.toBeInstanceOf(Map);
  });

  it("throws when a voided place comes back on two pages", async () => {
    get.mockImplementation((_url: string, { params }: { params: { page: number } }) =>
      Promise.resolve(
        params.page === 0 ? locPage([row("gone", "state", true)], 2) : locPage([row("gone", "state", true)], 2),
      ),
    );
    await expect(readOrgChildren()).rejects.toThrow(/changed while it was read/);
  });

  it("rejects a response without a numeric totalPages", async () => {
    get.mockResolvedValue({ data: { content: [row("a", "p")] } });
    await expect(readOrgChildren()).rejects.toThrow();
  });

  it("clears the memo on failure and rethrows", async () => {
    get.mockRejectedValueOnce(new Error("503"));
    await expect(readOrgChildren()).rejects.toThrow("503");
    get.mockResolvedValue(locPage([row("a", null)], 1));
    await expect(readOrgChildren()).resolves.toBeInstanceOf(Map);
  });
});
