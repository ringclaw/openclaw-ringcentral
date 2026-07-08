import { describe, expect, it } from "vitest";
import {
  buildChannelTarget,
  buildDmTarget,
  buildGroupTarget,
  buildTarget,
  buildTeamTarget,
  buildUserTarget,
  extractChatId,
  extractTargetId,
  normalizeTarget,
  parseTarget,
} from "./targets.js";

describe("parseTarget", () => {
  it("parses canonical targets", () => {
    expect(parseTarget("user:123")).toEqual({ kind: "user", id: "123" });
    expect(parseTarget("team:t1")).toEqual({ kind: "team", id: "t1" });
    expect(parseTarget("group:g1")).toEqual({ kind: "group", id: "g1" });
    expect(parseTarget("channel:c1")).toEqual({ kind: "channel", id: "c1" });
  });

  it("rejects legacy provider-prefixed targets and bare IDs", () => {
    expect(parseTarget("ringcentral:dm:123")).toBeNull();
    expect(parseTarget("rc:chat:456")).toBeNull();
    expect(parseTarget("789")).toBeNull();
  });

  it("returns null for unknown format", () => {
    expect(parseTarget("unknown:format")).toBeNull();
    expect(parseTarget("user:")).toBeNull();
  });
});

describe("buildTarget", () => {
  it("builds target strings", () => {
    expect(buildTarget("user", "123")).toBe("user:123");
    expect(buildUserTarget("123")).toBe("user:123");
    expect(buildDmTarget("123")).toBe("user:123");
    expect(buildTeamTarget("456")).toBe("team:456");
    expect(buildGroupTarget("456")).toBe("group:456");
    expect(buildChannelTarget("789")).toBe("channel:789");
  });
});

describe("extractChatId", () => {
  it("extracts chat IDs from chat-backed targets", () => {
    expect(extractChatId("team:t1")).toBe("t1");
    expect(extractChatId("group:g1")).toBe("g1");
    expect(extractChatId("channel:c1")).toBe("c1");
  });

  it("does not treat user targets as chat IDs", () => {
    expect(extractChatId("user:u1")).toBeNull();
  });
});

describe("extractTargetId", () => {
  it("extracts the raw target ID", () => {
    expect(extractTargetId("user:u1")).toBe("u1");
  });
});

describe("normalizeTarget", () => {
  it("normalizes canonical target spacing", () => {
    expect(normalizeTarget(" team:t1 ")).toBe("team:t1");
  });

  it("returns undefined for unknown format", () => {
    expect(normalizeTarget("unknown")).toBeUndefined();
  });
});
