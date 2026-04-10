import { describe, it, expect, beforeEach } from "vitest";
import { setOwnerId, getOwnerId, clearOwnerId } from "./identity.js";

describe("identity", () => {
  beforeEach(() => {
    clearOwnerId();
  });

  it("returns null when not set", () => {
    expect(getOwnerId()).toBeNull();
  });

  it("returns the cached owner id after set", () => {
    setOwnerId("12345");
    expect(getOwnerId()).toBe("12345");
  });

  it("clears the cached owner id", () => {
    setOwnerId("12345");
    clearOwnerId();
    expect(getOwnerId()).toBeNull();
  });

  it("overwrites previous value", () => {
    setOwnerId("111");
    setOwnerId("222");
    expect(getOwnerId()).toBe("222");
  });
});
