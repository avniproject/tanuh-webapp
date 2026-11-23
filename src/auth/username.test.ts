import { describe, expect, it } from "vitest";
import { shortUsername } from "./username";

describe("shortUsername", () => {
  it("drops the organisation's suffix from the end of a username", () => {
    expect(shortUsername("physician4@tanuh_uat_local", "tanuh_uat_local")).toBe("physician4");
  });
  it("keeps a username with another organisation's suffix, or none", () => {
    expect(shortUsername("physician4@tanuh_uat", "tanuh_uat_local")).toBe("physician4@tanuh_uat");
    expect(shortUsername("physician4", "tanuh_uat_local")).toBe("physician4");
  });
  it("drops only a whole trailing @suffix", () => {
    expect(shortUsername("dr@tanuh_uat_local.org", "tanuh_uat_local")).toBe("dr@tanuh_uat_local.org");
    expect(shortUsername("drtanuh_uat_local", "tanuh_uat_local")).toBe("drtanuh_uat_local");
    expect(shortUsername("dr@tanuh_uat_local@tanuh_uat_local", "tanuh_uat_local")).toBe("dr@tanuh_uat_local");
  });
  it("keeps the username whole when the suffix is not known", () => {
    expect(shortUsername("physician4@tanuh_uat_local", undefined)).toBe("physician4@tanuh_uat_local");
    expect(shortUsername("physician4@tanuh_uat_local", "")).toBe("physician4@tanuh_uat_local");
  });
  it("keeps a username that is nothing but the suffix", () => {
    expect(shortUsername("@tanuh_uat_local", "tanuh_uat_local")).toBe("@tanuh_uat_local");
  });
});
