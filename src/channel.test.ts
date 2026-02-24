import { describe, expect, it, beforeEach } from "vitest";
import type { OpenClawConfig } from "openclaw/plugin-sdk";

// Test the stripPatterns function
describe("mentions.stripPatterns", () => {
  // Import the plugin to access stripPatterns
  let ringcentralPlugin: typeof import("./channel.js").ringcentralPlugin;

  beforeEach(async () => {
    const module = await import("./channel.js");
    ringcentralPlugin = module.ringcentralPlugin;
  });

  it("should return an array of regex patterns", () => {
    const patterns = ringcentralPlugin.mentions?.stripPatterns();
    expect(patterns).toBeDefined();
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns!.length).toBeGreaterThan(0);
  });

  it("should match RingCentral markdown mention pattern ![:Person](123456)", () => {
    const patterns = ringcentralPlugin.mentions?.stripPatterns();
    const personPattern = new RegExp(patterns![0]);

    expect(personPattern.test("![:Person](123456)")).toBe(true);
    expect(personPattern.test("![:Person](987654321)")).toBe(true);
    expect(personPattern.test("Hello ![:Person](123456) world")).toBe(true);
    expect(personPattern.test("![:Person](abc)")).toBe(false); // non-numeric
    expect(personPattern.test("[:Person](123456)")).toBe(false); // missing !
  });

  it("should match @FirstName format", () => {
    const patterns = ringcentralPlugin.mentions?.stripPatterns();
    const atPattern = new RegExp(patterns![1]);

    expect(atPattern.test("@John")).toBe(true);
    expect(atPattern.test("@Jane Doe")).toBe(true);
    expect(atPattern.test("Hello @John")).toBe(true);
    expect(atPattern.test(" @Bob")).toBe(true);
  });

  it("should NOT match email addresses", () => {
    const patterns = ringcentralPlugin.mentions?.stripPatterns();
    const atPattern = new RegExp(patterns![1]);

    // Pattern should NOT match @ preceded by word characters (email format)
    expect(atPattern.test("user@example")).toBe(false);
    expect(atPattern.test("test@domain")).toBe(false);
    expect(atPattern.test("john.doe@company")).toBe(false);
  });

  it("should match @ mentions at start of string or after whitespace", () => {
    const patterns = ringcentralPlugin.mentions?.stripPatterns();
    const atPattern = new RegExp(patterns![1]);

    // Should match at beginning of string
    expect("@John".match(atPattern)).toBeTruthy();
    // Should match after space
    expect("Hello @John world".match(atPattern)).toBeTruthy();
    // Should match after newline (represented as string with space)
    expect("line1\n@John".match(atPattern)).toBeTruthy();
  });
});

// Test capabilities consistency
describe("capabilities consistency", () => {
  it("should have matching capabilities between dock and plugin", async () => {
    const { ringcentralDock, ringcentralPlugin } = await import("./channel.js");

    expect(ringcentralDock.capabilities.chatTypes).toEqual(
      ringcentralPlugin.capabilities.chatTypes
    );
    expect(ringcentralDock.capabilities.threads).toBe(
      ringcentralPlugin.capabilities.threads
    );
    expect(ringcentralDock.capabilities.media).toBe(
      ringcentralPlugin.capabilities.media
    );
    expect(ringcentralDock.capabilities.reactions).toBe(
      ringcentralPlugin.capabilities.reactions
    );
  });

  it("should include all required chat types", async () => {
    const { ringcentralPlugin } = await import("./channel.js");

    expect(ringcentralPlugin.capabilities.chatTypes).toContain("direct");
    expect(ringcentralPlugin.capabilities.chatTypes).toContain("group");
    expect(ringcentralPlugin.capabilities.chatTypes).toContain("channel");
  });

  it("should have threads enabled", async () => {
    const { ringcentralPlugin } = await import("./channel.js");
    expect(ringcentralPlugin.capabilities.threads).toBe(true);
  });
});

// Test meta configuration
describe("meta configuration", () => {
  it("should have quickstartAllowFrom enabled", async () => {
    const { ringcentralPlugin } = await import("./channel.js");
    expect(ringcentralPlugin.meta.quickstartAllowFrom).toBe(true);
  });

  it("should have onboarding adapter configured", async () => {
    const { ringcentralPlugin } = await import("./channel.js");
    expect(ringcentralPlugin.onboarding).toBeDefined();
    expect(ringcentralPlugin.onboarding?.channel).toBe("ringcentral");
  });
});

// Test groups.resolveToolPolicy
describe("groups.resolveToolPolicy", () => {
  it("should be defined", async () => {
    const { ringcentralPlugin } = await import("./channel.js");
    expect(ringcentralPlugin.groups?.resolveToolPolicy).toBeDefined();
    expect(typeof ringcentralPlugin.groups?.resolveToolPolicy).toBe("function");
  });

  // Note: The actual resolveToolPolicy function calls resolveChannelGroupToolsPolicy
  // from the SDK, which may not be available in the test environment.
  // We test that the function exists and is callable, but skip the actual
  // policy resolution test since it depends on SDK internals.
});

// Test threading.buildToolContext
describe("threading.buildToolContext", () => {
  it("should be defined", async () => {
    const { ringcentralPlugin } = await import("./channel.js");
    expect(ringcentralPlugin.threading?.buildToolContext).toBeDefined();
  });

  it("should return correct context structure", async () => {
    const { ringcentralPlugin } = await import("./channel.js");

    const hasRepliedRef = { current: false };
    const context = {
      To: "123456789",
      ReplyToId: "post-123",
    };

    const result = ringcentralPlugin.threading?.buildToolContext?.({
      context,
      hasRepliedRef,
    });

    expect(result).toEqual({
      currentChannelId: "123456789",
      currentThreadTs: "post-123",
      hasRepliedRef,
    });
  });

  it("should handle missing ReplyToId", async () => {
    const { ringcentralPlugin } = await import("./channel.js");

    const hasRepliedRef = { current: true };
    const context = { To: "987654321" };

    const result = ringcentralPlugin.threading?.buildToolContext?.({
      context,
      hasRepliedRef,
    });

    expect(result?.currentChannelId).toBe("987654321");
    expect(result?.currentThreadTs).toBeUndefined();
    expect(result?.hasRepliedRef.current).toBe(true);
  });
});

// Test directory functions
describe("directory functions", () => {
  it("should have listPeers defined", async () => {
    const { ringcentralPlugin } = await import("./channel.js");
    expect(ringcentralPlugin.directory?.listPeers).toBeDefined();
  });

  it("should have listGroups defined", async () => {
    const { ringcentralPlugin } = await import("./channel.js");
    expect(ringcentralPlugin.directory?.listGroups).toBeDefined();
  });

  it("should have listPeersLive defined", async () => {
    const { ringcentralPlugin } = await import("./channel.js");
    expect(ringcentralPlugin.directory?.listPeersLive).toBeDefined();
  });

  it("should have listGroupsLive defined", async () => {
    const { ringcentralPlugin } = await import("./channel.js");
    expect(ringcentralPlugin.directory?.listGroupsLive).toBeDefined();
  });

  it("listPeers should filter by query", async () => {
    const { ringcentralPlugin } = await import("./channel.js");

    const cfg = {
      channels: {
        ringcentral: {
          dm: { allowFrom: ["123456", "789012", "345678"] },
        },
      },
    } as OpenClawConfig;

    const peers = await ringcentralPlugin.directory?.listPeers({
      cfg,
      accountId: "default",
      query: "123",
    });

    expect(peers).toBeDefined();
    expect(peers!.length).toBe(1);
    expect(peers![0].id).toBe("123456");
  });

  it("listPeers should respect limit", async () => {
    const { ringcentralPlugin } = await import("./channel.js");

    const cfg = {
      channels: {
        ringcentral: {
          dm: { allowFrom: ["111", "222", "333", "444", "555"] },
        },
      },
    } as OpenClawConfig;

    const peers = await ringcentralPlugin.directory?.listPeers({
      cfg,
      accountId: "default",
      limit: 2,
    });

    expect(peers).toBeDefined();
    expect(peers!.length).toBe(2);
  });

  it("listGroups should return configured groups", async () => {
    const { ringcentralPlugin } = await import("./channel.js");

    const cfg = {
      channels: {
        ringcentral: {
          groups: {
            "group-123": { requireMention: true },
            "group-456": { enabled: true },
            "*": { requireMention: false }, // wildcard should be excluded
          },
        },
      },
    } as OpenClawConfig;

    const groups = await ringcentralPlugin.directory?.listGroups({
      cfg,
      accountId: "default",
    });

    expect(groups).toBeDefined();
    expect(groups!.length).toBe(2);
    expect(groups!.map((g) => g.id)).toContain("group-123");
    expect(groups!.map((g) => g.id)).toContain("group-456");
    expect(groups!.map((g) => g.id)).not.toContain("*");
  });
});

// Test status.auditAccount
describe("status.auditAccount", () => {
  it("should be defined", async () => {
    const { ringcentralPlugin } = await import("./channel.js");
    expect(ringcentralPlugin.status?.auditAccount).toBeDefined();
  });

  it("should return undefined when no groups configured", async () => {
    const { ringcentralPlugin } = await import("./channel.js");

    const account = {
      accountId: "default",
      credentialSource: "config" as const,
      config: { groups: {} },
    };

    const result = await ringcentralPlugin.status?.auditAccount?.({
      account: account as any,
      cfg: {} as OpenClawConfig,
    });

    expect(result).toBeUndefined();
  });

  it("should return undefined when only wildcard group configured", async () => {
    const { ringcentralPlugin } = await import("./channel.js");

    const account = {
      accountId: "default",
      credentialSource: "config" as const,
      config: { groups: { "*": { requireMention: false } } },
    };

    const result = await ringcentralPlugin.status?.auditAccount?.({
      account: account as any,
      cfg: {} as OpenClawConfig,
    });

    expect(result).toBeUndefined();
  });

  it("should accept timeoutMs parameter", async () => {
    const { ringcentralPlugin } = await import("./channel.js");

    const account = {
      accountId: "default",
      credentialSource: "config" as const,
      config: { groups: {} },
    };

    // Should not throw when timeoutMs is provided
    const result = await ringcentralPlugin.status?.auditAccount?.({
      account: account as any,
      cfg: {} as OpenClawConfig,
      timeoutMs: 5000,
    });

    // No groups, so returns undefined
    expect(result).toBeUndefined();
  });
});

// Test gateway.logoutAccount
describe("gateway.logoutAccount", () => {
  it("should be defined", async () => {
    const { ringcentralPlugin } = await import("./channel.js");
    expect(ringcentralPlugin.gateway?.logoutAccount).toBeDefined();
  });

  it("should return the config unchanged", async () => {
    const { ringcentralPlugin } = await import("./channel.js");

    const cfg = {
      channels: {
        ringcentral: { enabled: true },
      },
    } as OpenClawConfig;

    const result = await ringcentralPlugin.gateway?.logoutAccount?.({
      cfg,
      accountId: "default",
    });

    expect(result).toEqual(cfg);
  });

  it("should clear cached WebSocket manager", async () => {
    // Test that clearRingCentralWsManager is exported and callable
    const { clearRingCentralWsManager } = await import("./monitor.js");
    expect(clearRingCentralWsManager).toBeDefined();
    expect(typeof clearRingCentralWsManager).toBe("function");

    // Calling with non-existent account should return false (no manager to clear)
    const result = clearRingCentralWsManager("non-existent-account");
    expect(result).toBe(false);
  });
});

// Test monitor.ts cache clearing functions
describe("monitor cache clearing", () => {
  it("should export clearRingCentralWsManager", async () => {
    const monitor = await import("./monitor.js");
    expect(monitor.clearRingCentralWsManager).toBeDefined();
  });

  it("should export clearAllRingCentralWsManagers", async () => {
    const monitor = await import("./monitor.js");
    expect(monitor.clearAllRingCentralWsManagers).toBeDefined();
  });

  it("clearAllRingCentralWsManagers should be callable", async () => {
    const { clearAllRingCentralWsManagers } = await import("./monitor.js");
    // Should not throw when called (even if no managers exist)
    expect(() => clearAllRingCentralWsManagers()).not.toThrow();
  });
});

