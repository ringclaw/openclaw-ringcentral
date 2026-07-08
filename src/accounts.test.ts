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

  it("resolves bot config with RingCentral defaults", () => {
    const account = resolveAccount({ botToken: "bot-token-123" });
    expect(account.botToken).toBe("bot-token-123");
    expect(account.server).toBe("https://platform.ringcentral.com");
    expect(account.replyToMode).toBe("first");
    expect(account.groupPolicy).toBe("disabled");
    expect(account.dmPolicy).toBe("pairing");
    expect(account.allowFrom).toEqual([]);
    expect(account.groupDmEnabled).toBe(false);
    expect(account.groupDmChannels).toEqual({});
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

  it("resolves from new RC_* env", () => {
    process.env.RC_BOT_TOKEN = "env-bot-token";
    process.env.RC_SERVER_URL = "https://sandbox.example.com";
    process.env.RC_ALLOW_FROM = "u1,u2";
    process.env.RC_DM_POLICY = "allowlist";
    process.env.RC_GROUP_POLICY = "allowlist";
    process.env.RC_TEAMS = JSON.stringify({ t1: { allow: true } });
    process.env.RC_GROUP_DM_ENABLED = "true";
    process.env.RC_GROUP_DM_CHANNELS = JSON.stringify({ g1: { allow: true, users: ["u1"] } });
    process.env.RC_REPLY_TO_MODE = "all";
    process.env.RC_REQUIRE_MENTION = "false";
    process.env.RC_DEBUG_INBOUND_MESSAGES = "true";

    const account = resolveAccount({});

    expect(account.botToken).toBe("env-bot-token");
    expect(account.server).toBe("https://sandbox.example.com");
    expect(account.allowFrom).toEqual(["u1", "u2"]);
    expect(account.dmPolicy).toBe("allowlist");
    expect(account.groupPolicy).toBe("allowlist");
    expect(account.config.teams).toEqual({ t1: { allow: true } });
    expect(account.groupDmEnabled).toBe(true);
    expect(account.groupDmChannels).toEqual({ g1: { allow: true, users: ["u1"] } });
    expect(account.replyToMode).toBe("all");
    expect(account.requireMention).toBe(false);
    expect(account.requireMentionExplicit).toBe(true);
    expect(account.debugInboundMessages).toBe(true);
  });

  it("applies RC_TEAM_REQUIRE_MENTION to wildcard team defaults", () => {
    const account = resolveAccount(
      { botToken: "bot", teams: { t1: { allow: true } } },
      { RC_TEAM_REQUIRE_MENTION: "false" },
    );
    expect(account.config.teams).toEqual({
      t1: { allow: true },
      "*": { requireMention: false },
    });
  });

  it("requires wildcard allowFrom for public DMs", () => {
    expect(() => resolveAccount({ botToken: "bot", dmPolicy: "open" })).toThrow(
      'dmPolicy="open" requires allowFrom',
    );
    expect(resolveAccount({ botToken: "bot", dmPolicy: "open", allowFrom: ["*"] }).dmPolicy).toBe("open");
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

  it("rejects legacy config fields", () => {
    expect(() => resolveAccount({ botToken: "bot", allowedUserEmails: ["owner@example.com"] } as any)).toThrow(
      "allowedUserEmails",
    );
    expect(() => resolveAccount({ botToken: "bot", groups: { g1: { enabled: true } } } as any)).toThrow(
      "groups",
    );
    expect(() => resolveAccount({ botToken: "bot", dm: { policy: "open" } } as any)).toThrow(
      "dm.policy",
    );
  });

  it("rejects legacy RC_* env fields", () => {
    process.env.RC_BOT_TOKEN = "bot";
    process.env.RC_ALLOWED_USER_EMAILS = "owner@example.com";
    expect(() => resolveAccount({})).toThrow("RC_ALLOWED_USER_EMAILS");
  });

  it("resolves ownerCredentials and deprecated credentials alias", () => {
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
