import { describe, expect, it } from "vitest";
import { ringCentralConfigSchema } from "./config-schema.js";

describe("ringCentralConfigSchema", () => {
  it("accepts valid minimal config", () => {
    const result = ringCentralConfigSchema.safeParse({ botToken: "tok" });
    expect(result.success).toBe(true);
  });

  it("accepts empty config (all optional)", () => {
    const result = ringCentralConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts conversationIdentity enum values", () => {
    expect(ringCentralConfigSchema.safeParse({ conversationIdentity: "bot" }).success).toBe(true);
    expect(ringCentralConfigSchema.safeParse({ conversationIdentity: "user" }).success).toBe(true);
    expect(ringCentralConfigSchema.safeParse({ conversationIdentity: "both" }).success).toBe(false);
  });

  it("accepts full canonical config", () => {
    const result = ringCentralConfigSchema.safeParse({
      enabled: true,
      name: "My Bot",
      botToken: "bot-static-token",
      conversationIdentity: "user",
      ownerCredentials: { clientId: "owner-cid", clientSecret: "owner-cs", jwt: "owner-jwt" },
      credentials: { clientId: "cid", clientSecret: "cs", jwt: "jwt-tok" },
      server: "https://platform.ringcentral.com",
      botExtensionId: "12345",
      selfOnly: false,
      dmPolicy: "allowlist",
      allowFrom: ["u1", 99],
      dangerouslyAllowEmailMatching: false,
      groupPolicy: "allowlist",
      teams: {
        "*": { requireMention: true },
        "123": { allow: true, requireMention: true, systemPrompt: "Be helpful", users: ["u1", 42] },
      },
      dm: {
        groupEnabled: true,
        groupChannels: {
          "g1": { allow: true, requireMention: false, users: ["u1"] },
        },
      },
      threadRequireMention: true,
      noThreadChannels: ["g4"],
      replyToMode: "first",
      processingPlaceholder: {
        enabled: true,
        initialText: "start",
        delayedText: "delay",
        editDelaySeconds: 3,
      },
      debugInboundMessages: true,
      historyMessageLimit: 250,
      homeChannel: "g-home",
      homeChannelName: "Home",
      requireMention: true,
      textChunkLimit: 2000,
      allowBots: false,
      workspace: "/tmp/workspace",
      actions: { messages: true, channelInfo: true, tasks: true, events: true, notes: true, adaptiveCards: true },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid groupPolicy enum", () => {
    const result = ringCentralConfigSchema.safeParse({ groupPolicy: "invalid" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid dmPolicy enum", () => {
    const result = ringCentralConfigSchema.safeParse({ dmPolicy: "invalid" });
    expect(result.success).toBe(false);
  });

  it("rejects dmPolicy open without wildcard allowFrom", () => {
    const result = ringCentralConfigSchema.safeParse({ dmPolicy: "open", allowFrom: ["u1"] });
    expect(result.success).toBe(false);
  });

  it("rejects legacy access-control fields", () => {
    expect(ringCentralConfigSchema.safeParse({ allowedUserEmails: ["owner@example.com"] }).success).toBe(false);
    expect(ringCentralConfigSchema.safeParse({ allowedChannels: ["g1"] }).success).toBe(false);
    expect(ringCentralConfigSchema.safeParse({ groups: { g1: { enabled: true } } }).success).toBe(false);
    expect(ringCentralConfigSchema.safeParse({ dm: { policy: "open" } }).success).toBe(false);
    expect(ringCentralConfigSchema.safeParse({ dm: { allowFrom: ["u1"] } }).success).toBe(false);
  });

  it("rejects invalid replyToMode and out-of-range history limit", () => {
    expect(ringCentralConfigSchema.safeParse({ replyToMode: "bad" }).success).toBe(false);
    expect(ringCentralConfigSchema.safeParse({ historyMessageLimit: 1001 }).success).toBe(false);
  });

  it("rejects non-integer textChunkLimit", () => {
    const result = ringCentralConfigSchema.safeParse({ textChunkLimit: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects textChunkLimit < 1", () => {
    const result = ringCentralConfigSchema.safeParse({ textChunkLimit: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects negative textChunkLimit", () => {
    const result = ringCentralConfigSchema.safeParse({ textChunkLimit: -10 });
    expect(result.success).toBe(false);
  });

  it("accepts valid team config with mixed user ID types", () => {
    const result = ringCentralConfigSchema.safeParse({
      teams: { "g1": { users: ["string-id", 12345] } },
    });
    expect(result.success).toBe(true);
  });

  it("accepts actions with all false", () => {
    const result = ringCentralConfigSchema.safeParse({
      actions: { messages: false, channelInfo: false, tasks: false, events: false, notes: false, adaptiveCards: false },
    });
    expect(result.success).toBe(true);
  });
});
