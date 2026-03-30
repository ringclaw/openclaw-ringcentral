import { describe, it, expect } from "vitest";
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

  it("accepts full config", () => {
    const result = ringCentralConfigSchema.safeParse({
      enabled: true,
      name: "My Bot",
      botToken: "bot-static-token",
      credentials: { clientId: "cid", clientSecret: "cs", jwt: "jwt-tok" },
      server: "https://platform.ringcentral.com",
      botExtensionId: "12345",
      selfOnly: false,
      groupPolicy: "allowlist",
      groups: {
        "123": { enabled: true, requireMention: true, systemPrompt: "Be helpful", users: ["u1", 42] },
      },
      requireMention: true,
      dm: { policy: "open", allowFrom: ["u1", 99] },
      textChunkLimit: 2000,
      allowBots: false,
      workspace: "/tmp/workspace",
      actions: { messages: true, channelInfo: true, tasks: true, events: true, notes: true },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid groupPolicy enum", () => {
    const result = ringCentralConfigSchema.safeParse({ groupPolicy: "invalid" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid dm.policy enum", () => {
    const result = ringCentralConfigSchema.safeParse({ dm: { policy: "invalid" } });
    expect(result.success).toBe(false);
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

  it("accepts valid group config with mixed user ID types", () => {
    const result = ringCentralConfigSchema.safeParse({
      groups: { "g1": { users: ["string-id", 12345] } },
    });
    expect(result.success).toBe(true);
  });

  it("accepts actions with all false", () => {
    const result = ringCentralConfigSchema.safeParse({
      actions: { messages: false, channelInfo: false, tasks: false, events: false, notes: false },
    });
    expect(result.success).toBe(true);
  });
});
