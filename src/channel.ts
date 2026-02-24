import {
  applyAccountNameToChannelSection,
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  formatPairingApproveHint,
  migrateBaseNameToDefaultAccount,
  missingTargetError,
  normalizeAccountId,
  PAIRING_APPROVED_MESSAGE,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveChannelMediaMaxBytes,
  resolveChannelGroupToolsPolicy,
  resolveDefaultGroupPolicy,
  setAccountEnabledInConfigSection,
  type ChannelDock,
  type ChannelPlugin,
  type GroupToolPolicyConfig,
  type OpenClawConfig,
} from "openclaw/plugin-sdk";

import {
  listRingCentralAccountIds,
  resolveDefaultRingCentralAccountId,
  resolveRingCentralAccount,
  type ResolvedRingCentralAccount,
} from "./accounts.js";
import { RingCentralConfigSchema } from "./config-schema.js";
import {
  sendRingCentralMessage,
  uploadRingCentralAttachment,
  probeRingCentral,
  listRingCentralChats,
  getRingCentralChat,
} from "./api.js";
import { getRingCentralRuntime } from "./runtime.js";
import { startRingCentralMonitor, clearRingCentralWsManager } from "./monitor.js";
import {
  normalizeRingCentralTarget,
  isRingCentralChatTarget,
  parseRingCentralTarget,
} from "./targets.js";
import type { RingCentralConfig } from "./types.js";
import { ringcentralMessageActions } from "./actions-adapter.js";
import { ringcentralOnboarding } from "./onboarding.js";

const formatAllowFromEntry = (entry: string) =>
  (entry ?? "")
    .trim()
    .replace(/^(ringcentral|rc):/i, "")
    .replace(/^user:/i, "")
    .toLowerCase();

export function normalizeRingCentralAllowFromEntries(allowFrom: (string | number)[]): string[] {
  return allowFrom
    .map((entry) => String(entry))
    .filter(Boolean)
    .map(formatAllowFromEntry);
}

export const ringcentralDock: ChannelDock = {
  id: "ringcentral",
  capabilities: {
    chatTypes: ["direct", "group", "channel"],
    reactions: false,
    media: true,
    threads: true,
    blockStreaming: true,
  },
  outbound: { textChunkLimit: 4000 },
  config: {
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveRingCentralAccount({ cfg: cfg as OpenClawConfig, accountId }).config.dm?.allowFrom ??
        []
      ).map((entry) => String(entry)),
    formatAllowFrom: ({ allowFrom }) => normalizeRingCentralAllowFromEntries(allowFrom),
  },
  groups: {
    resolveRequireMention: ({ cfg, accountId }) => {
      const account = resolveRingCentralAccount({ cfg: cfg as OpenClawConfig, accountId });
      return account.config.requireMention ?? true;
    },
  },
  threading: {
    resolveReplyToMode: ({ cfg }) =>
      (cfg.channels?.ringcentral as RingCentralConfig | undefined)?.replyToMode ?? "off",
    buildToolContext: ({ context, hasRepliedRef }) => ({
      currentChannelId: (context.To as string | undefined)?.trim() || undefined,
      currentThreadTs: undefined,
      hasRepliedRef,
    }),
  },
  agentPrompt: {
    messageToolHints: () => [
      "- RingCentral message actions require a numeric `chatId`. Use `action=read` to fetch message history, `action=edit` to edit, `action=delete` to delete, `action=channel-info` to get chat details.",
      "- Use `action=search-chat` with a `query` parameter to find a chat by name or person name and get its chatId. This searches Team names, Group names, and Direct chat contact names.",
      "- Before asking user for chatId, first try `action=search-chat` to look up the chat by the name they mentioned.",
      "- When user says '刷新RingCentral群组', '初始化RingCentral', 'refresh RingCentral groups', 'initialize RingCentral', 'reload RingCentral chats', 'sync RingCentral groups', or similar, execute `action=refresh-chat-cache` to reload the chat list cache.",
      "- When user says '发给我' or 'send to me', use `action=find-direct-chat` with `memberId` set to the sender's userId to get the DM chatId, then use that chatId. Do NOT use the current group chatId.",
    ],
  },
};

export const ringcentralPlugin: ChannelPlugin<ResolvedRingCentralAccount> = {
  id: "ringcentral",
  meta: {
    id: "ringcentral",
    label: "RingCentral",
    selectionLabel: "RingCentral Team Messaging",
    docsPath: "/channels/ringcentral",
    docsLabel: "ringcentral",
    blurb: "RingCentral Team Messaging via REST API and WebSocket.",
    order: 56,
    quickstartAllowFrom: true,
  },
  onboarding: ringcentralOnboarding,
  pairing: {
    idLabel: "ringcentralUserId",
    normalizeAllowEntry: (entry) => formatAllowFromEntry(entry),
    notifyApproval: async ({ cfg, id }) => {
      const account = resolveRingCentralAccount({ cfg: cfg as OpenClawConfig });
      if (account.credentialSource === "none") return;
      const target = normalizeRingCentralTarget(id) ?? id;
      // For DM approval, we need to find/create a direct chat
      // This is a simplified version - in production you'd need to resolve the chat ID
      try {
        await sendRingCentralMessage({
          account,
          chatId: target,
          text: PAIRING_APPROVED_MESSAGE,
        });
      } catch {
        // Approval notification failed, but pairing still succeeds
      }
    },
  },
  capabilities: {
    chatTypes: ["direct", "group", "channel"],
    reactions: false,
    threads: true,
    media: true,
    nativeCommands: false,
    blockStreaming: true,
  },
  streaming: {
    blockStreamingCoalesceDefaults: { minChars: 1500, idleMs: 1000 },
  },
  reload: { configPrefixes: ["channels.ringcentral"] },
  configSchema: buildChannelConfigSchema(RingCentralConfigSchema),
  config: {
    listAccountIds: (cfg) => listRingCentralAccountIds(cfg as OpenClawConfig),
    resolveAccount: (cfg, accountId) =>
      resolveRingCentralAccount({ cfg: cfg as OpenClawConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultRingCentralAccountId(cfg as OpenClawConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as OpenClawConfig,
        sectionKey: "ringcentral",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg: cfg as OpenClawConfig,
        sectionKey: "ringcentral",
        accountId,
        clearBaseFields: [
          "credentials",
          "name",
        ],
      }),
    isConfigured: (account) => account.credentialSource !== "none",
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.credentialSource !== "none",
      credentialSource: account.credentialSource,
      server: account.server,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveRingCentralAccount({
        cfg: cfg as OpenClawConfig,
        accountId,
      }).config.dm?.allowFrom ?? []
      ).map((entry) => String(entry)),
    formatAllowFrom: ({ allowFrom }) => normalizeRingCentralAllowFromEntries(allowFrom),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(
        (cfg as OpenClawConfig).channels?.ringcentral?.accounts?.[resolvedAccountId],
      );
      const allowFromPath = useAccountPath
        ? `channels.ringcentral.accounts.${resolvedAccountId}.dm.`
        : "channels.ringcentral.dm.";
      return {
        policy: account.config.dm?.policy ?? "pairing",
        allowFrom: account.config.dm?.allowFrom ?? [],
        allowFromPath,
        approveHint: formatPairingApproveHint("ringcentral"),
        normalizeEntry: (raw) => formatAllowFromEntry(raw),
      };
    },
    collectWarnings: ({ account, cfg }) => {
      const warnings: string[] = [];
      const defaultGroupPolicy = resolveDefaultGroupPolicy(cfg);
      const { groupPolicy } = resolveAllowlistProviderRuntimeGroupPolicy({
        providerConfigPresent: (cfg as OpenClawConfig).channels?.ringcentral !== undefined,
        groupPolicy: account.config.groupPolicy,
        defaultGroupPolicy,
      });
      if (groupPolicy === "open") {
        const groupAllowlistConfigured =
          Boolean(account.config.groups) && Object.keys(account.config.groups ?? {}).length > 0;
        if (groupAllowlistConfigured) {
          warnings.push(
            `- RingCentral chats: groupPolicy="open" allows any member in allowed groups to trigger (mention-gated). Set channels.ringcentral.groupPolicy="allowlist" and configure channels.ringcentral.groups.`,
          );
        } else {
          warnings.push(
            `- RingCentral chats: groupPolicy="open" with no channels.ringcentral.groups allowlist; any group can trigger (mention-gated). Set channels.ringcentral.groupPolicy="allowlist" and configure channels.ringcentral.groups.`,
          );
        }
      }
      if (account.config.dm?.policy === "open") {
        warnings.push(
          `- RingCentral DMs are open to anyone. Set channels.ringcentral.dm.policy="pairing" or "allowlist".`,
        );
      }
      return warnings;
    },
  },
  groups: {
    resolveRequireMention: ({ cfg, accountId }) => {
      const account = resolveRingCentralAccount({ cfg: cfg as OpenClawConfig, accountId });
      return account.config.requireMention ?? true;
    },
    resolveToolPolicy: (params): GroupToolPolicyConfig | undefined => {
      return resolveChannelGroupToolsPolicy({
        cfg: params.cfg as OpenClawConfig,
        channel: "ringcentral",
        groupId: params.groupId,
        accountId: params.accountId,
        senderId: params.senderId,
        senderName: params.senderName,
        senderUsername: params.senderUsername,
        senderE164: params.senderE164,
      });
    },
  },
  mentions: {
    stripPatterns: () => [
      // RingCentral markdown mention pattern: ![:Person](123456)
      "!\\[:Person\\]\\(\\d+\\)",
      // Display format: @FirstName or @FirstName LastName
      // Uses (?:^|[^\\w@.]) to avoid matching email addresses like user@example.com
      // The pattern requires @ to be preceded by start of string, whitespace, or non-word char
      "(?:^|[^\\w@.])@[A-Za-z]+(?:\\s+[A-Za-z]+)?",
    ],
  },
  threading: {
    resolveReplyToMode: ({ cfg }) =>
      (cfg.channels?.ringcentral as RingCentralConfig | undefined)?.replyToMode ?? "off",
    buildToolContext: ({ context, hasRepliedRef }) => ({
      currentChannelId: (context.To as string | undefined)?.trim() || undefined,
      currentThreadTs: (context.ReplyToId as string | undefined) || undefined,
      hasRepliedRef,
    }),
  },
  messaging: {
    normalizeTarget: normalizeRingCentralTarget,
    targetResolver: {
      looksLikeId: (raw, normalized) => {
        const value = normalized ?? raw.trim();
        return isRingCentralChatTarget(value);
      },
      hint: "<chatId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, accountId, query, limit }) => {
      const account = resolveRingCentralAccount({
        cfg: cfg as OpenClawConfig,
        accountId,
      });
      const q = query?.trim().toLowerCase() || "";
      const allowFrom = account.config.dm?.allowFrom ?? [];
      const peers = Array.from(
        new Set(
          allowFrom
            .map((entry) => String(entry).trim())
            .filter((entry) => Boolean(entry) && entry !== "*")
            .map((entry) => normalizeRingCentralTarget(entry) ?? entry),
        ),
      )
        .filter((id) => (q ? id.toLowerCase().includes(q) : true))
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map((id) => ({ kind: "user", id }) as const);
      return peers;
    },
    listGroups: async ({ cfg, accountId, query, limit }) => {
      const account = resolveRingCentralAccount({
        cfg: cfg as OpenClawConfig,
        accountId,
      });
      const groups = account.config.groups ?? {};
      const q = query?.trim().toLowerCase() || "";
      const entries = Object.keys(groups)
        .filter((key) => key && key !== "*")
        .filter((key) => (q ? key.toLowerCase().includes(q) : true))
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map((id) => ({ kind: "group", id }) as const);
      return entries;
    },
    listPeersLive: async ({ cfg, accountId, query, limit }) => {
      const account = resolveRingCentralAccount({
        cfg: cfg as OpenClawConfig,
        accountId,
      });
      if (account.credentialSource === "none") return [];

      try {
        const chats = await listRingCentralChats({
          account,
          type: ["Direct", "Personal"],
          limit: limit ?? 50,
        });

        const q = query?.trim().toLowerCase() || "";
        return chats
          .filter((chat) => !q || chat.name?.toLowerCase().includes(q) || chat.id?.includes(q))
          .map((chat) => ({
            kind: "user" as const,
            id: chat.id ?? "",
            name: chat.name,
          }));
      } catch {
        return [];
      }
    },
    listGroupsLive: async ({ cfg, accountId, query, limit }) => {
      const account = resolveRingCentralAccount({
        cfg: cfg as OpenClawConfig,
        accountId,
      });
      if (account.credentialSource === "none") return [];

      try {
        const chats = await listRingCentralChats({
          account,
          type: ["Team", "Group"],
          limit: limit ?? 50,
        });

        const q = query?.trim().toLowerCase() || "";
        return chats
          .filter((chat) => !q || chat.name?.toLowerCase().includes(q) || chat.id?.includes(q))
          .map((chat) => ({
            kind: "group" as const,
            id: chat.id ?? "",
            name: chat.name,
          }));
      } catch {
        return [];
      }
    },
  },
  resolver: {
    resolveTargets: async ({ inputs, kind }) => {
      const resolved = inputs.map((input) => {
        const parsed = parseRingCentralTarget(input);
        if (parsed.type === "unknown" || !parsed.id) {
          return { input, resolved: false, note: "invalid target format" };
        }
        if (kind === "user" && parsed.type === "user") {
          return { input, resolved: true, id: parsed.id };
        }
        if (kind === "group" && parsed.type === "chat") {
          return { input, resolved: true, id: parsed.id };
        }
        return {
          input,
          resolved: false,
          note: "use rc:chat:<id> or rc:user:<id>",
        };
      });
      return resolved;
    },
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg: cfg as OpenClawConfig,
        channelKey: "ringcentral",
        accountId,
        name,
      }),
    validateInput: ({ accountId, input }) => {
      if (input.useEnv && accountId !== DEFAULT_ACCOUNT_ID) {
        return "RINGCENTRAL_* env vars can only be used for the default account.";
      }
      if (!input.useEnv && (!input.clientId || !input.clientSecret || !input.jwt)) {
        return "RingCentral requires --client-id, --client-secret, and --jwt (or use --use-env).";
      }
      return null;
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const namedConfig = applyAccountNameToChannelSection({
        cfg: cfg as OpenClawConfig,
        channelKey: "ringcentral",
        accountId,
        name: input.name as string | undefined,
      });
      const next =
        accountId !== DEFAULT_ACCOUNT_ID
          ? migrateBaseNameToDefaultAccount({
              cfg: namedConfig as OpenClawConfig,
              channelKey: "ringcentral",
            })
          : namedConfig;
      // Build nested credentials block
      const inputServer = input.server as string | undefined;
      const credentialsPatch = input.useEnv
        ? {}
        : {
            credentials: {
              ...(input.clientId ? { clientId: input.clientId } : {}),
              ...(input.clientSecret ? { clientSecret: input.clientSecret } : {}),
              ...(input.jwt ? { jwt: input.jwt } : {}),
              ...(inputServer?.trim() ? { server: inputServer.trim() } : {}),
            },
          };
      // Only include credentials if it has any values
      const hasCredentials = input.clientId || input.clientSecret || input.jwt || inputServer?.trim();
      const configPatch = input.useEnv || !hasCredentials ? {} : credentialsPatch;
      if (accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...next,
          channels: {
            ...next.channels,
            ringcentral: {
              ...next.channels?.ringcentral,
              enabled: true,
              ...configPatch,
            },
          },
        } as OpenClawConfig;
      }
      return {
        ...next,
        channels: {
          ...next.channels,
          ringcentral: {
            ...next.channels?.ringcentral,
            enabled: true,
            accounts: {
              ...next.channels?.ringcentral?.accounts,
              [accountId]: {
                ...(next.channels?.ringcentral?.accounts?.[accountId] as Record<string, unknown> | undefined),
                enabled: true,
                ...configPatch,
              },
            },
          },
        },
      } as OpenClawConfig;
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) =>
      getRingCentralRuntime().channel.text.chunkMarkdownText(text, limit),
    chunkerMode: "markdown",
    textChunkLimit: 4000,
    resolveTarget: ({ to, allowFrom, mode }) => {
      const trimmed = to?.trim() ?? "";
      const allowListRaw = (allowFrom ?? []).map((entry) => String(entry).trim()).filter(Boolean);
      const allowList = allowListRaw
        .filter((entry) => entry !== "*")
        .map((entry) => normalizeRingCentralTarget(entry))
        .filter((entry): entry is string => Boolean(entry));

      if (trimmed) {
        const normalized = normalizeRingCentralTarget(trimmed);
        if (!normalized) {
          if ((mode === "implicit" || mode === "heartbeat") && allowList.length > 0) {
            return { ok: true, to: allowList[0] };
          }
          return {
            ok: false,
            error: missingTargetError(
              "RingCentral",
              "<chatId> or channels.ringcentral.dm.allowFrom[0]",
            ),
          };
        }
        return { ok: true, to: normalized };
      }

      if (allowList.length > 0) {
        return { ok: true, to: allowList[0] };
      }
      return {
        ok: false,
        error: missingTargetError(
          "RingCentral",
          "<chatId> or channels.ringcentral.dm.allowFrom[0]",
        ),
      };
    },
    sendText: async ({ cfg, to, text, accountId }) => {
      const account = resolveRingCentralAccount({
        cfg: cfg as OpenClawConfig,
        accountId,
      });
      const result = await sendRingCentralMessage({
        account,
        chatId: to,
        text,
      });
      return {
        channel: "ringcentral",
        messageId: result?.postId ?? "",
        chatId: to,
      };
    },
    sendMedia: async ({ cfg, to, text, mediaUrl, accountId }) => {
      if (!mediaUrl) {
        throw new Error("RingCentral mediaUrl is required.");
      }
      const account = resolveRingCentralAccount({
        cfg: cfg as OpenClawConfig,
        accountId,
      });
      const runtime = getRingCentralRuntime();
      const maxBytes = resolveChannelMediaMaxBytes({
        cfg: cfg as OpenClawConfig,
        resolveChannelLimitMb: ({ cfg: c, accountId: aid }) =>
          (c.channels?.ringcentral as { accounts?: Record<string, { mediaMaxMb?: number }>; mediaMaxMb?: number } | undefined)
            ?.accounts?.[aid]?.mediaMaxMb ??
          (c.channels?.ringcentral as { mediaMaxMb?: number } | undefined)?.mediaMaxMb,
        accountId,
      });
      const loaded = await runtime.channel.media.fetchRemoteMedia(mediaUrl, {
        maxBytes: maxBytes ?? (account.config.mediaMaxMb ?? 20) * 1024 * 1024,
      });
      const upload = await uploadRingCentralAttachment({
        account,
        chatId: to,
        filename: loaded.filename ?? "attachment",
        buffer: loaded.buffer,
        contentType: loaded.contentType,
      });
      const result = await sendRingCentralMessage({
        account,
        chatId: to,
        text,
        attachments: upload.attachmentId ? [{ id: upload.attachmentId }] : undefined,
      });
      return {
        channel: "ringcentral",
        messageId: result?.postId ?? "",
        chatId: to,
      };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: (accounts) =>
      accounts.flatMap((entry) => {
        const accountId = String(entry.accountId ?? DEFAULT_ACCOUNT_ID);
        const enabled = entry.enabled !== false;
        const configured = entry.configured === true;
        if (!enabled || !configured) return [];
        const issues = [];
        if (!entry.clientId) {
          issues.push({
            channel: "ringcentral",
            accountId,
            kind: "config",
            message: "RingCentral clientId is missing.",
            fix: "Set channels.ringcentral.clientId or use rc-credentials.json.",
          });
        }
        return issues;
      }),
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      credentialSource: snapshot.credentialSource ?? "none",
      server: snapshot.server ?? null,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account }) => probeRingCentral(account),
    auditAccount: async ({ account, cfg: _cfg, timeoutMs }) => {
      const groups = account.config.groups ?? {};
      const groupIds = Object.keys(groups).filter((k) => k !== "*");

      if (!groupIds.length) return undefined;

      const start = Date.now();
      const effectiveTimeout = timeoutMs ?? 30000; // Default 30 seconds
      const results: Array<{
        id: string;
        ok: boolean;
        name?: string;
        type?: string;
        error?: string;
      }> = [];

      // Helper to check if we've exceeded the timeout
      const isTimedOut = () => Date.now() - start > effectiveTimeout;

      for (const groupId of groupIds) {
        // Check timeout before each API call
        if (isTimedOut()) {
          results.push({
            id: groupId,
            ok: false,
            error: "Audit timed out",
          });
          continue;
        }

        try {
          // Wrap the API call with a timeout
          const timeRemaining = effectiveTimeout - (Date.now() - start);
          const chatPromise = getRingCentralChat({ account, chatId: groupId });
          const timeoutPromise = new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error("Request timed out")), Math.max(timeRemaining, 1000))
          );

          const chat = await Promise.race([chatPromise, timeoutPromise]);
          results.push({
            id: groupId,
            ok: Boolean(chat),
            name: chat?.name,
            type: chat?.type,
            error: chat ? undefined : "Chat not found or no access",
          });
        } catch (err) {
          results.push({
            id: groupId,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return {
        ok: results.every((r) => r.ok),
        checkedGroups: results.length,
        groups: results,
        elapsedMs: Date.now() - start,
      };
    },
    buildAccountSnapshot: ({ account, runtime, probe, audit }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.credentialSource !== "none",
      credentialSource: account.credentialSource,
      server: account.server,
      clientId: account.clientId ? `${account.clientId.slice(0, 8)}...` : undefined,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
      dmPolicy: account.config.dm?.policy ?? "allowlist",
      probe,
      audit,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      ctx.log?.info(`[${account.accountId}] starting RingCentral WebSocket`);
      ctx.setStatus({
        accountId: account.accountId,
        running: true,
        lastStartAt: Date.now(),
        server: account.server,
      });
      const unregister = await startRingCentralMonitor({
        account,
        config: ctx.cfg as OpenClawConfig,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        statusSink: (patch) => ctx.setStatus({ accountId: account.accountId, ...patch }),
      });
      return () => {
        unregister?.();
        ctx.setStatus({
          accountId: account.accountId,
          running: false,
          lastStopAt: Date.now(),
        });
      };
    },
    logoutAccount: async ({ cfg, accountId }) => {
      // Clear cached WebSocket manager for this account to ensure
      // fresh connections are created if the account is used again.
      // This is important for:
      // 1. Releasing resources when logging out
      // 2. Ensuring credential changes take effect immediately
      // 3. Avoiding stale connections after logout
      clearRingCentralWsManager(accountId);

      // Return config unchanged - credentials remain in config file
      // for manual removal if desired
      return cfg;
    },
  },
  actions: ringcentralMessageActions,
};
