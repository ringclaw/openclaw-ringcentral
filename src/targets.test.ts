import { describe, it, expect } from "vitest";
import { parseTarget, buildTarget, buildDmTarget, buildGroupTarget, extractChatId, normalizeTarget } from "./targets.js";

describe("parseTarget", () => {
  it("parses ringcentral:dm:123", () => {
    expect(parseTarget("ringcentral:dm:123")).toEqual({ kind: "dm", id: "123" });
  });

  it("parses rc:chat:456", () => {
    expect(parseTarget("rc:chat:456")).toEqual({ kind: "chat", id: "456" });
  });

  it("parses bare numeric ID", () => {
    expect(parseTarget("789")).toEqual({ kind: "chat", id: "789" });
  });

  it("returns null for unknown format", () => {
    expect(parseTarget("unknown:format")).toBeNull();
  });
});

describe("buildTarget", () => {
  it("builds target string", () => {
    expect(buildTarget("dm", "123")).toBe("ringcentral:dm:123");
  });
});

describe("buildDmTarget", () => {
  it("builds DM target", () => {
    expect(buildDmTarget("123")).toBe("ringcentral:dm:123");
  });
});

describe("buildGroupTarget", () => {
  it("builds group target", () => {
    expect(buildGroupTarget("456")).toBe("ringcentral:group:456");
  });
});

describe("extractChatId", () => {
  it("extracts chat ID from target", () => {
    expect(extractChatId("ringcentral:dm:123")).toBe("123");
  });

  it("returns null for invalid target", () => {
    expect(extractChatId("invalid")).toBeNull();
  });
});

describe("normalizeTarget", () => {
  it("normalizes target", () => {
    expect(normalizeTarget("rc:dm:123")).toBe("ringcentral:dm:123");
  });

  it("returns undefined for unknown format", () => {
    expect(normalizeTarget("unknown")).toBeUndefined();
  });
});
