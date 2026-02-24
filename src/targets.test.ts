import { describe, expect, it } from "vitest";
import {
  normalizeRingCentralTarget,
  isRingCentralChatTarget,
  isRingCentralUserTarget,
  formatRingCentralChatTarget,
  formatRingCentralUserTarget,
  parseRingCentralTarget,
} from "./targets.js";

describe("normalizeRingCentralTarget", () => {
  it("returns null for empty string", () => {
    expect(normalizeRingCentralTarget("")).toBeNull();
    expect(normalizeRingCentralTarget("  ")).toBeNull();
  });

  it("removes ringcentral: prefix", () => {
    expect(normalizeRingCentralTarget("ringcentral:12345")).toBe("12345");
    expect(normalizeRingCentralTarget("RINGCENTRAL:12345")).toBe("12345");
  });

  it("removes rc: prefix", () => {
    expect(normalizeRingCentralTarget("rc:12345")).toBe("12345");
    expect(normalizeRingCentralTarget("RC:12345")).toBe("12345");
  });

  it("removes chat: prefix", () => {
    expect(normalizeRingCentralTarget("chat:12345")).toBe("12345");
  });

  it("removes user: prefix", () => {
    expect(normalizeRingCentralTarget("user:12345")).toBe("12345");
  });

  it("removes combined prefixes", () => {
    expect(normalizeRingCentralTarget("rc:chat:12345")).toBe("12345");
    expect(normalizeRingCentralTarget("ringcentral:user:12345")).toBe("12345");
  });

  it("sanitizes unsafe characters", () => {
    expect(normalizeRingCentralTarget("rc:chat:../../etc/passwd")).toBe("______etc_passwd");
    expect(normalizeRingCentralTarget("user:foo/bar")).toBe("foo_bar");
    expect(normalizeRingCentralTarget("group:blah..foo")).toBe("blah__foo");
    expect(normalizeRingCentralTarget("foo<bar>")).toBe("foo_bar_");
    expect(normalizeRingCentralTarget("foo\\bar")).toBe("foo_bar");
    expect(normalizeRingCentralTarget("foo?bar")).toBe("foo_bar");
    expect(normalizeRingCentralTarget("foo:bar")).toBe("foo_bar");
  });

  it("trims whitespace", () => {
    expect(normalizeRingCentralTarget("  12345  ")).toBe("12345");
  });

  it("returns plain ID as-is", () => {
    expect(normalizeRingCentralTarget("12345")).toBe("12345");
  });
});

describe("isRingCentralChatTarget", () => {
  it("returns true for numeric IDs", () => {
    expect(isRingCentralChatTarget("12345")).toBe(true);
    expect(isRingCentralChatTarget("rc:12345")).toBe(true);
    expect(isRingCentralChatTarget("chat:12345")).toBe(true);
  });

  it("returns false for non-numeric IDs", () => {
    expect(isRingCentralChatTarget("abc")).toBe(false);
    expect(isRingCentralChatTarget("12345abc")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isRingCentralChatTarget("")).toBe(false);
  });
});

describe("isRingCentralUserTarget", () => {
  it("returns true for numeric IDs", () => {
    expect(isRingCentralUserTarget("12345")).toBe(true);
    expect(isRingCentralUserTarget("rc:12345")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isRingCentralUserTarget("")).toBe(false);
  });
});

describe("formatRingCentralChatTarget", () => {
  it("formats chat ID with rc:chat: prefix", () => {
    expect(formatRingCentralChatTarget("12345")).toBe("rc:chat:12345");
  });
});

describe("formatRingCentralUserTarget", () => {
  it("formats user ID with rc:user: prefix", () => {
    expect(formatRingCentralUserTarget("12345")).toBe("rc:user:12345");
  });
});

describe("parseRingCentralTarget", () => {
  it("parses chat: prefix", () => {
    expect(parseRingCentralTarget("chat:12345")).toEqual({ type: "chat", id: "12345" });
    expect(parseRingCentralTarget("rc:chat:12345")).toEqual({ type: "chat", id: "12345" });
    expect(parseRingCentralTarget("ringcentral:chat:12345")).toEqual({ type: "chat", id: "12345" });
  });

  it("parses user: prefix", () => {
    expect(parseRingCentralTarget("user:12345")).toEqual({ type: "user", id: "12345" });
    expect(parseRingCentralTarget("rc:user:12345")).toEqual({ type: "user", id: "12345" });
  });

  it("parses group: prefix as chat", () => {
    expect(parseRingCentralTarget("group:12345")).toEqual({ type: "chat", id: "12345" });
    expect(parseRingCentralTarget("team:12345")).toEqual({ type: "chat", id: "12345" });
  });

  it("defaults numeric IDs to chat type", () => {
    expect(parseRingCentralTarget("12345")).toEqual({ type: "chat", id: "12345" });
    expect(parseRingCentralTarget("rc:12345")).toEqual({ type: "chat", id: "12345" });
  });

  it("returns unknown for non-numeric IDs without type prefix", () => {
    expect(parseRingCentralTarget("abc")).toEqual({ type: "unknown", id: "abc" });
  });

  it("trims whitespace", () => {
    expect(parseRingCentralTarget("  chat:12345  ")).toEqual({ type: "chat", id: "12345" });
  });
});
