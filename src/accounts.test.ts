import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveAccount, isAccountConfigured, hasPrivateApp } from "./accounts.js";

describe("resolveAccount", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.RINGCENTRAL_BOT_TOKEN;
    delete process.env.RINGCENTRAL_CLIENT_ID;
    delete process.env.RINGCENTRAL_CLIENT_SECRET;
    delete process.env.RINGCENTRAL_JWT;
    delete process.env.RINGCENTRAL_SERVER;
  });

  afterEach(() => {
    Object.assign(process.env, origEnv);
  });

  it("resolves from config", () => {
    const account = resolveAccount({ botToken: "bot-token-123" });
    expect(account.botToken).toBe("bot-token-123");
    expect(account.server).toBe("https://platform.ringcentral.com");
    expect(account.credentials).toBeUndefined();
  });

  it("resolves from env", () => {
    process.env.RINGCENTRAL_BOT_TOKEN = "env-bot-token";
    const account = resolveAccount({});
    expect(account.botToken).toBe("env-bot-token");
  });

  it("throws without bot token", () => {
    expect(() => resolveAccount({})).toThrow("bot token not configured");
  });

  it("resolves credentials when all present", () => {
    const account = resolveAccount({
      botToken: "bot",
      credentials: { clientId: "id", clientSecret: "secret", jwt: "jwt" },
    });
    expect(account.credentials).toEqual({ clientId: "id", clientSecret: "secret", jwt: "jwt" });
  });

  it("ignores partial credentials", () => {
    const account = resolveAccount({
      botToken: "bot",
      credentials: { clientId: "id" },
    });
    expect(account.credentials).toBeUndefined();
  });
});

describe("isAccountConfigured", () => {
  it("returns true with bot token", () => {
    expect(isAccountConfigured({ botToken: "token" })).toBe(true);
  });

  it("returns false without bot token", () => {
    delete process.env.RINGCENTRAL_BOT_TOKEN;
    expect(isAccountConfigured({})).toBe(false);
  });
});

describe("hasPrivateApp", () => {
  it("returns true with credentials", () => {
    expect(hasPrivateApp({
      botToken: "bot",
      credentials: { clientId: "id", clientSecret: "s", jwt: "j" },
      server: "https://example.com",
      config: {},
    })).toBe(true);
  });

  it("returns false without credentials", () => {
    expect(hasPrivateApp({
      botToken: "bot",
      server: "https://example.com",
      config: {},
    })).toBe(false);
  });
});
