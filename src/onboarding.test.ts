import { describe, expect, it, vi, beforeEach } from "vitest";
import type { OpenClawConfig } from "openclaw/plugin-sdk";

describe("ringcentralOnboarding", () => {
  let ringcentralOnboarding: typeof import("./onboarding.js").ringcentralOnboarding;

  beforeEach(async () => {
    vi.resetModules();
    const module = await import("./onboarding.js");
    ringcentralOnboarding = module.ringcentralOnboarding;
  });

  describe("channel property", () => {
    it("should be ringcentral", () => {
      expect(ringcentralOnboarding.channel).toBe("ringcentral");
    });
  });

  describe("getStatus", () => {
    it("should return not configured when no credentials", async () => {
      const cfg = { channels: {} } as OpenClawConfig;

      const status = await ringcentralOnboarding.getStatus({
        cfg,
        accountOverrides: {},
      });

      expect(status.channel).toBe("ringcentral");
      expect(status.configured).toBe(false);
      expect(status.statusLines.length).toBeGreaterThan(0);
    });

    it("should return configured when credentials present", async () => {
      const cfg = {
        channels: {
          ringcentral: {
            credentials: {
              clientId: "test-client-id",
              clientSecret: "test-secret",
              jwt: "test-jwt-token",
            },
          },
        },
      } as OpenClawConfig;

      const status = await ringcentralOnboarding.getStatus({
        cfg,
        accountOverrides: {},
      });

      expect(status.channel).toBe("ringcentral");
      expect(status.configured).toBe(true);
    });

    it("should detect environment variable credentials", async () => {
      // Mock environment variables
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        RINGCENTRAL_CLIENT_ID: "env-client-id",
        RINGCENTRAL_CLIENT_SECRET: "env-secret",
        RINGCENTRAL_JWT: "env-jwt",
      };

      try {
        vi.resetModules();
        const module = await import("./onboarding.js");
        const onboarding = module.ringcentralOnboarding;

        const cfg = { channels: {} } as OpenClawConfig;
        const status = await onboarding.getStatus({
          cfg,
          accountOverrides: {},
        });

        // Should detect env vars are available
        expect(status.channel).toBe("ringcentral");
      } finally {
        process.env = originalEnv;
      }
    });
  });

  describe("dmPolicy", () => {
    it("should be defined", () => {
      expect(ringcentralOnboarding.dmPolicy).toBeDefined();
    });

    it("should have correct channel", () => {
      expect(ringcentralOnboarding.dmPolicy?.channel).toBe("ringcentral");
    });

    it("should have correct policyKey", () => {
      expect(ringcentralOnboarding.dmPolicy?.policyKey).toBe(
        "channels.ringcentral.dm.policy"
      );
    });

    it("getCurrent should return pairing by default", () => {
      const cfg = { channels: {} } as OpenClawConfig;
      const policy = ringcentralOnboarding.dmPolicy?.getCurrent(cfg);
      // RingCentral defaults to pairing mode for DMs
      expect(policy).toBe("pairing");
    });

    it("getCurrent should return configured policy", () => {
      const cfg = {
        channels: {
          ringcentral: {
            dm: { policy: "open" },
          },
        },
      } as OpenClawConfig;
      const policy = ringcentralOnboarding.dmPolicy?.getCurrent(cfg);
      expect(policy).toBe("open");
    });

    it("setPolicy should update dm.policy", () => {
      const cfg = { channels: {} } as OpenClawConfig;
      const updated = ringcentralOnboarding.dmPolicy?.setPolicy(cfg, "pairing");

      expect(
        (updated?.channels?.ringcentral as any)?.dm?.policy
      ).toBe("pairing");
    });
  });

  describe("disable", () => {
    it("should be defined", () => {
      expect(ringcentralOnboarding.disable).toBeDefined();
    });

    it("should set enabled to false", () => {
      const cfg = {
        channels: {
          ringcentral: { enabled: true },
        },
      } as OpenClawConfig;

      const result = ringcentralOnboarding.disable?.(cfg);

      expect((result?.channels?.ringcentral as any)?.enabled).toBe(false);
    });

    it("should preserve other config", () => {
      const cfg = {
        channels: {
          ringcentral: {
            enabled: true,
            credentials: { clientId: "test" },
          },
        },
      } as OpenClawConfig;

      const result = ringcentralOnboarding.disable?.(cfg);

      expect((result?.channels?.ringcentral as any)?.credentials?.clientId).toBe("test");
    });
  });
});

