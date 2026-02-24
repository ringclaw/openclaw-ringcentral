import type {
  ChannelOnboardingAdapter,
  ChannelOnboardingDmPolicy,
  OpenClawConfig,
  DmPolicy,
  WizardPrompter,
} from "openclaw/plugin-sdk";
import {
  addWildcardAllowFrom,
  DEFAULT_ACCOUNT_ID,
  formatDocsLink,
  mergeAllowFromEntries,
  promptChannelAccessConfig,
} from "openclaw/plugin-sdk";

import { resolveRingCentralAccount } from "./accounts.js";
import { probeRingCentral } from "./api.js";
import type { RingCentralConfig } from "./types.js";

const channel = "ringcentral" as const;

function setRingCentralDmPolicy(cfg: OpenClawConfig, dmPolicy: DmPolicy): OpenClawConfig {
  const ringcentral = cfg.channels?.ringcentral as RingCentralConfig | undefined;
  const allowFrom =
    dmPolicy === "open"
      ? addWildcardAllowFrom(ringcentral?.dm?.allowFrom ?? ringcentral?.allowFrom)?.map((entry) =>
          String(entry),
        )
      : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      ringcentral: {
        ...ringcentral,
        dm: {
          ...ringcentral?.dm,
          policy: dmPolicy,
          ...(allowFrom ? { allowFrom } : {}),
        },
      },
    },
  };
}

function setRingCentralAllowFrom(cfg: OpenClawConfig, allowFrom: string[]): OpenClawConfig {
  const ringcentral = cfg.channels?.ringcentral as RingCentralConfig | undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      ringcentral: {
        ...ringcentral,
        dm: {
          ...ringcentral?.dm,
          allowFrom,
        },
      },
    },
  };
}

function parseAllowFromInput(raw: string): string[] {
  return raw
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function looksLikeUserId(value: string): boolean {
  return /^\d{5,}$/.test(value);
}

async function promptRingCentralAllowFrom(params: {
  cfg: OpenClawConfig;
  prompter: WizardPrompter;
}): Promise<OpenClawConfig> {
  const ringcentral = params.cfg.channels?.ringcentral as RingCentralConfig | undefined;
  const existing = ringcentral?.dm?.allowFrom ?? ringcentral?.allowFrom ?? [];
  await params.prompter.note(
    [
      "Allowlist RingCentral DMs by user ID (numeric extension ID).",
      "You can find user IDs in the RingCentral admin portal or API.",
      "Examples:",
      "- 123456789 (extension ID)",
      "- 987654321",
    ].join("\n"),
    "RingCentral allowlist",
  );

  while (true) {
    const entry = await params.prompter.text({
      message: "RingCentral allowFrom (user IDs)",
      placeholder: "123456789, 987654321",
      initialValue: existing[0] ? String(existing[0]) : undefined,
      validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
    });
    const parts = parseAllowFromInput(String(entry));
    if (parts.length === 0) {
      await params.prompter.note("Enter at least one user ID.", "RingCentral allowlist");
      continue;
    }

    const invalidParts = parts.filter((part) => !looksLikeUserId(part));
    if (invalidParts.length > 0) {
      await params.prompter.note(
        `Invalid user IDs (should be numeric): ${invalidParts.join(", ")}`,
        "RingCentral allowlist",
      );
      continue;
    }

    const unique = mergeAllowFromEntries(
      existing.map((v) => String(v).trim()).filter(Boolean),
      parts,
    );
    return setRingCentralAllowFrom(params.cfg, unique);
  }
}

async function noteRingCentralCredentialHelp(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "RingCentral requires OAuth credentials (JWT authentication):",
      "1) Create an app in RingCentral Developer Portal",
      "2) Get Client ID and Client Secret",
      "3) Generate a JWT token for authentication",
      "",
      "Tip: you can also set environment variables:",
      "  RINGCENTRAL_CLIENT_ID",
      "  RINGCENTRAL_CLIENT_SECRET",
      "  RINGCENTRAL_JWT",
      "  RINGCENTRAL_SERVER (optional, defaults to production)",
      "",
      `Docs: ${formatDocsLink("/channels/ringcentral", "ringcentral")}`,
    ].join("\n"),
    "RingCentral credentials",
  );
}

function setRingCentralGroupPolicy(
  cfg: OpenClawConfig,
  groupPolicy: "open" | "allowlist" | "disabled",
): OpenClawConfig {
  const ringcentral = cfg.channels?.ringcentral as RingCentralConfig | undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      ringcentral: {
        ...ringcentral,
        enabled: true,
        groupPolicy,
      },
    },
  };
}

function setRingCentralGroupsAllowlist(
  cfg: OpenClawConfig,
  groupIds: string[],
): OpenClawConfig {
  const ringcentral = cfg.channels?.ringcentral as RingCentralConfig | undefined;
  const existingGroups = ringcentral?.groups ?? {};
  const groups: Record<string, { enabled?: boolean }> = { ...existingGroups };
  
  for (const groupId of groupIds) {
    if (!groupId) continue;
    groups[groupId] = groups[groupId] ?? { enabled: true };
  }

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      ringcentral: {
        ...ringcentral,
        enabled: true,
        groups,
      },
    },
  };
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "RingCentral",
  channel,
  policyKey: "channels.ringcentral.dm.policy",
  allowFromKey: "channels.ringcentral.dm.allowFrom",
  getCurrent: (cfg) => {
    const ringcentral = cfg.channels?.ringcentral as RingCentralConfig | undefined;
    return ringcentral?.dm?.policy ?? ringcentral?.dmPolicy ?? "pairing";
  },
  setPolicy: (cfg, policy) => setRingCentralDmPolicy(cfg, policy),
  promptAllowFrom: promptRingCentralAllowFrom,
};

export const ringcentralOnboarding: ChannelOnboardingAdapter = {
  channel,

  getStatus: async ({ cfg }) => {
    const account = resolveRingCentralAccount({ cfg: cfg as OpenClawConfig });
    const configured = account.credentialSource !== "none";
    return {
      channel,
      configured,
      statusLines: [`RingCentral: ${configured ? "configured" : "needs credentials"}`],
      selectionHint: configured ? "configured" : "needs credentials",
      quickstartScore: configured ? 2 : 0,
    };
  },

  configure: async ({ cfg, prompter }) => {
    const account = resolveRingCentralAccount({ cfg: cfg as OpenClawConfig });
    const ringcentral = cfg.channels?.ringcentral as RingCentralConfig | undefined;

    const hasConfigCreds = Boolean(
      ringcentral?.credentials?.clientId?.trim() &&
      ringcentral?.credentials?.clientSecret?.trim() &&
      ringcentral?.credentials?.jwt?.trim(),
    );

    const canUseEnv = Boolean(
      !hasConfigCreds &&
      process.env.RINGCENTRAL_CLIENT_ID?.trim() &&
      process.env.RINGCENTRAL_CLIENT_SECRET?.trim() &&
      process.env.RINGCENTRAL_JWT?.trim(),
    );

    let next = cfg;
    let clientId: string | null = null;
    let clientSecret: string | null = null;
    let jwt: string | null = null;
    let server: string | null = null;

    if (account.credentialSource === "none") {
      await noteRingCentralCredentialHelp(prompter);
    }

    if (canUseEnv) {
      const keepEnv = await prompter.confirm({
        message:
          "RINGCENTRAL_CLIENT_ID + RINGCENTRAL_CLIENT_SECRET + RINGCENTRAL_JWT detected. Use env vars?",
        initialValue: true,
      });
      if (keepEnv) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            ringcentral: { ...next.channels?.ringcentral, enabled: true },
          },
        };
      } else {
        clientId = String(
          await prompter.text({
            message: "Enter RingCentral Client ID",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
        clientSecret = String(
          await prompter.text({
            message: "Enter RingCentral Client Secret",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
        jwt = String(
          await prompter.text({
            message: "Enter RingCentral JWT Token",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
        server = await prompter.select({
          message: "Select RingCentral Server",
          options: [
            { value: "https://platform.ringcentral.com", label: "Production" },
            { value: "https://platform.devtest.ringcentral.com", label: "Sandbox" },
          ],
          initialValue: "https://platform.ringcentral.com",
        });
      }
    } else if (hasConfigCreds) {
      const keep = await prompter.confirm({
        message: "RingCentral credentials already configured. Keep them?",
        initialValue: true,
      });
      if (!keep) {
        clientId = String(
          await prompter.text({
            message: "Enter RingCentral Client ID",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
        clientSecret = String(
          await prompter.text({
            message: "Enter RingCentral Client Secret",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
        jwt = String(
          await prompter.text({
            message: "Enter RingCentral JWT Token",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
        server = await prompter.select({
          message: "Select RingCentral Server",
          options: [
            { value: "https://platform.ringcentral.com", label: "Production" },
            { value: "https://platform.devtest.ringcentral.com", label: "Sandbox" },
          ],
          initialValue: ringcentral?.credentials?.server ?? "https://platform.ringcentral.com",
        });
      }
    } else {
      clientId = String(
        await prompter.text({
          message: "Enter RingCentral Client ID",
          validate: (value) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();
      clientSecret = String(
        await prompter.text({
          message: "Enter RingCentral Client Secret",
          validate: (value) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();
      jwt = String(
        await prompter.text({
          message: "Enter RingCentral JWT Token",
          validate: (value) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();
      server = await prompter.select({
        message: "Select RingCentral Server",
        options: [
          { value: "https://platform.ringcentral.com", label: "Production" },
          { value: "https://platform.devtest.ringcentral.com", label: "Sandbox" },
        ],
        initialValue: "https://platform.ringcentral.com",
      });
    }

    if (clientId && clientSecret && jwt) {
      next = {
        ...next,
        channels: {
          ...next.channels,
          ringcentral: {
            ...next.channels?.ringcentral,
            enabled: true,
            credentials: {
              clientId,
              clientSecret,
              jwt,
              ...(server?.trim() ? { server: server.trim() } : {}),
            },
          },
        },
      };

      // Validate credentials with probe
      const progress = prompter.progress("Validating RingCentral credentials...");
      try {
        const resolvedAccount = resolveRingCentralAccount({ cfg: next as OpenClawConfig });
        const probe = await probeRingCentral(resolvedAccount);
        if (probe.ok) {
          progress.stop("RingCentral credentials validated successfully!");
        } else {
          progress.stop(`Warning: credential validation failed - ${probe.error}`);
        }
      } catch (err) {
        progress.stop(`Warning: credential validation failed - ${String(err)}`);
      }
    }

    // Configure group access policy
    const existingGroups = Object.keys(
      (next.channels?.ringcentral as RingCentralConfig | undefined)?.groups ?? {},
    ).filter((k) => k !== "*");
    
    const accessConfig = await promptChannelAccessConfig({
      prompter,
      label: "RingCentral Teams/Groups",
      currentPolicy:
        (next.channels?.ringcentral as RingCentralConfig | undefined)?.groupPolicy ?? "allowlist",
      currentEntries: existingGroups,
      placeholder: "Team ID (e.g., 123456789012345)",
      updatePrompt: existingGroups.length > 0,
    });

    if (accessConfig) {
      if (accessConfig.policy !== "allowlist") {
        next = setRingCentralGroupPolicy(next, accessConfig.policy);
      } else {
        next = setRingCentralGroupPolicy(next, "allowlist");
        next = setRingCentralGroupsAllowlist(next, accessConfig.entries);
      }
    }

    return { cfg: next, accountId: DEFAULT_ACCOUNT_ID };
  },

  dmPolicy,

  disable: (cfg) => ({
    ...cfg,
    channels: {
      ...cfg.channels,
      ringcentral: {
        ...cfg.channels?.ringcentral,
        enabled: false,
      },
    },
  }),
};
