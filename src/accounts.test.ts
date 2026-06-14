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
    expect(account.requireMentionExplicit).toBe(false);
    expect(account.attachments).toEqual({
      enabled: true,
      maxCount: 5,
      maxBytes: 5 * 1024 * 1024,
    });
    expect(account.processingPlaceholder.enabled).toBe(false);
    expect(account.debugInboundMessages).toBe(false);
    expect(account.ownerCredentials).toBeUndefined();
  });

  it("resolves from RC_* env", () => {
    process.env.RC_BOT_TOKEN = "env-bot-token";
    process.env.RC_SERVER_URL = "https://sandbox.example.com";
    process.env.RC_ALLOWED_USER_EMAILS = "Owner@Example.com, teammate@example.com";
    process.env.RC_REPLY_TO_MODE = "all";
    process.env.RC_REQUIRE_MENTION = "false";
    process.env.RC_DEBUG_INBOUND_MESSAGES = "true";
    const account = resolveAccount({});
    expect(account.botToken).toBe("env-bot-token");
    expect(account.server).toBe("https://sandbox.example.com");
    expect(account.allowedUserEmails).toEqual(["owner@example.com", "teammate@example.com"]);
    expect(account.replyToMode).toBe("all");
    expect(account.requireMention).toBe(false);
    expect(account.requireMentionExplicit).toBe(true);
    expect(account.debugInboundMessages).toBe(true);
  });

  it("keeps processing placeholder opt-in via config or RC_* env", () => {
    expect(resolveAccount({ botToken: "bot" }).processingPlaceholder.enabled).toBe(false);
    expect(
      resolveAccount({
        botToken: "bot",
        processingPlaceholder: { enabled: true },
      }).processingPlaceholder.enabled,
    ).toBe(true);
    expect(
      resolveAccount(
        { botToken: "bot" },
        { RC_PROCESSING_EMOJI_ENABLED: "true" },
      ).processingPlaceholder.enabled,
    ).toBe(true);
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

  it("resolves debug inbound message logging from config", () => {
    expect(resolveAccount({ botToken: "bot", debugInboundMessages: true }).debugInboundMessages).toBe(true);
  });

  it("tracks explicit requireMention config", () => {
    const account = resolveAccount({ botToken: "bot", requireMention: false });
    expect(account.requireMention).toBe(false);
    expect(account.requireMentionExplicit).toBe(true);
  });

  it("resolves inbound attachment limits from config and RC_* env", () => {
    process.env.RC_ATTACHMENT_DOWNLOAD_ENABLED = "false";
    process.env.RC_ATTACHMENT_MAX_COUNT = "7";
    process.env.RC_ATTACHMENT_MAX_BYTES = "12345";

    expect(resolveAccount({ botToken: "bot" }).attachments).toEqual({
      enabled: false,
      maxCount: 7,
      maxBytes: 12345,
    });

    expect(
      resolveAccount({
        botToken: "bot",
        attachments: { enabled: true, maxCount: 2, maxBytes: 2048 },
      }).attachments,
    ).toEqual({
      enabled: true,
      maxCount: 2,
      maxBytes: 2048,
    });
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
    expect(hasOwnerCredentials(resolveAccount({ botToken: "bot" }, {}))).toBe(false);
  });
});
