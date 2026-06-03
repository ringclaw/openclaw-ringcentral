import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hasOwnerCredentials, isAccountConfigured, resolveAccount } from "./accounts.js";

describe("resolveAccount", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("RC_") || key.startsWith("RINGCENTRAL_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("resolves bot config with Hermes defaults", () => {
    const account = resolveAccount({ botToken: "bot-token-123" });
    expect(account.botToken).toBe("bot-token-123");
    expect(account.server).toBe("https://platform.ringcentral.com");
    expect(account.replyToMode).toBe("first");
    expect(account.groupPolicy).toBe("disabled");
    expect(account.requireMention).toBe(true);
    expect(account.ownerCredentials).toBeUndefined();
  });

  it("resolves from RC_* env", () => {
    process.env.RC_BOT_TOKEN = "env-bot-token";
    process.env.RC_SERVER_URL = "https://sandbox.example.com";
    process.env.RC_ALLOWED_USER_EMAILS = "Owner@Example.com, teammate@example.com";
    process.env.RC_REPLY_TO_MODE = "all";
    const account = resolveAccount({});
    expect(account.botToken).toBe("env-bot-token");
    expect(account.server).toBe("https://sandbox.example.com");
    expect(account.allowedUserEmails).toEqual(["owner@example.com", "teammate@example.com"]);
    expect(account.replyToMode).toBe("all");
  });

  it("ignores deprecated RINGCENTRAL_* env", () => {
    process.env.RINGCENTRAL_BOT_TOKEN = "old-token";
    expect(() => resolveAccount({})).toThrow("RC_BOT_TOKEN");
    expect(isAccountConfigured({})).toBe(false);
  });

  it("resolves ownerCredentials and deprecated config alias", () => {
    const primary = resolveAccount({
      botToken: "bot",
      ownerCredentials: { clientId: "id", clientSecret: "secret", jwt: "jwt" },
    });
    expect(primary.ownerCredentials).toEqual({ clientId: "id", clientSecret: "secret", jwt: "jwt" });

    const alias = resolveAccount({
      botToken: "bot",
      credentials: { clientId: "id2", clientSecret: "secret2", jwt: "jwt2" },
    });
    expect(alias.ownerCredentials).toEqual({ clientId: "id2", clientSecret: "secret2", jwt: "jwt2" });
  });

  it("uses owner-only effective DM default when owner credentials are configured", () => {
    const account = resolveAccount({
      botToken: "bot",
      ownerCredentials: { clientId: "id", clientSecret: "secret", jwt: "jwt" },
    });
    expect(account.dmPolicy).toBe("allowlist");
  });

  it("keeps bot-only DM default open", () => {
    expect(resolveAccount({ botToken: "bot" }).dmPolicy).toBe("open");
  });
});

describe("isAccountConfigured", () => {
  it("returns true with bot token", () => {
    expect(isAccountConfigured({ botToken: "token" })).toBe(true);
  });

  it("returns true with RC_BOT_TOKEN", () => {
    expect(isAccountConfigured({}, { RC_BOT_TOKEN: "token" })).toBe(true);
  });
});

describe("hasOwnerCredentials", () => {
  it("reflects resolved owner credentials", () => {
    expect(
      hasOwnerCredentials(
        resolveAccount({
          botToken: "bot",
          ownerCredentials: { clientId: "id", clientSecret: "s", jwt: "j" },
        }),
      ),
    ).toBe(true);
    expect(hasOwnerCredentials(resolveAccount({ botToken: "bot" }))).toBe(false);
  });
});
