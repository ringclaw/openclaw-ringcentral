// RingCentral channel plugin assembly.

import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import type {
  ChannelCapabilities,
  ChannelGatewayContext,
  ChannelMeta,
  ChannelOutboundContext,
} from "openclaw/plugin-sdk/channel-contract";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
import { getRcConfig, hasOwnerCredentials, isAccountConfigured, resolveAccount } from "./accounts.js";
import { ringCentralMessageActions } from "./actions-adapter.js";
import { createRingCentralArtifactTools } from "./artifact-tools.js";
import { createBotClient, createOwnerClient, type RingCentralClient } from "./client.js";
import { ringCentralConfigSchema } from "./config-schema.js";
import { createRingCentralHistoryTool } from "./history-tool.js";
import { handleInboundPost } from "./inbound.js";
import { chunkText } from "./markdown.js";
import { RingCentralWebSocketMonitor } from "./monitor.js";
import { sendMessage } from "./send.js";
import { DEFAULT_TEXT_CHUNK_LIMIT, RINGCENTRAL_CHANNEL_ID } from "./shared.js";
import { normalizeTarget, parseTarget } from "./targets.js";
import { resolveReplyTransport, ThreadParticipationTracker } from "./threading.js";
import type { ResolvedAccount } from "./types.js";

type RuntimeState = {
  tracker: ThreadParticipationTracker;
  monitors: RingCentralWebSocketMonitor[];
};

const states = new Map<string, RuntimeState>();

function stateFor(accountId: string): RuntimeState {
  let state = states.get(accountId);
  if (!state) {
    state = { tracker: new ThreadParticipationTracker(), monitors: [] };
    states.set(accountId, state);
  }
  return state;
}

const meta: ChannelMeta = {
  id: RINGCENTRAL_CHANNEL_ID,
  label: "RingCentral",
  selectionLabel: "RingCentral Team Messaging",
  docsPath: "/channels/ringcentral",
  docsLabel: "ringcentral",
  blurb: "RingCentral Team Messaging via REST API and WebSocket.",
};

const capabilities: ChannelCapabilities = {
  chatTypes: ["direct", "group", "channel"],
  media: true,
  edit: true,
  threads: true,
  reactions: false,
};

export const ringcentralPlugin: ChannelPlugin<ResolvedAccount> = {
  id: RINGCENTRAL_CHANNEL_ID,
  meta,
  capabilities,
  configSchema: buildChannelConfigSchema(ringCentralConfigSchema),

  config: {
    listAccountIds: () => ["default"],
    resolveAccount: (cfg: OpenClawConfig) => resolveAccount(getRcConfig(cfg)),
    defaultAccountId: () => "default",
    isEnabled: (account: ResolvedAccount) => account.config.enabled !== false,
    isConfigured: (_account: ResolvedAccount, cfg: OpenClawConfig) => isAccountConfigured(getRcConfig(cfg)),
    unconfiguredReason: () =>
      'RingCentral is not configured. Set botToken (or RC_BOT_TOKEN), or set conversationIdentity="user" with ownerCredentials.',
    hasConfiguredState: ({ cfg, env }) => isAccountConfigured(getRcConfig(cfg), env),
    describeAccount: (account) => ({
      accountId: "default",
      name: account.config.name ?? "RingCentral",
      enabled: account.config.enabled !== false,
      configured: !!account.botToken || hasOwnerCredentials(account),
      statusState: !!account.botToken || hasOwnerCredentials(account) ? "configured" : "not configured",
      dmPolicy: account.dmPolicy,
      allowFrom: account.allowFrom,
      conversationIdentity: account.conversationIdentity,
      tokenSource: account.botToken
        ? account.config.botToken
          ? "config"
          : "env:RC_BOT_TOKEN"
        : "none",
      credentialSource: hasOwnerCredentials(account) ? "owner credentials" : "none",
    }),
  },

  gateway: {
    startAccount: async (ctx: ChannelGatewayContext<ResolvedAccount>) => {
      const { account, cfg, abortSignal, setStatus, accountId } = ctx;
      const state = stateFor(accountId);
      const botClient = account.botToken ? createBotClient(account.server, account.botToken) : undefined;
      const ownerClient = createOwnerClientFromAccount(account);
      if (!botClient && !ownerClient) {
        throw new Error(
          'RingCentral is not configured. Set botToken (or RC_BOT_TOKEN), or set conversationIdentity="user" with ownerCredentials.',
        );
      }
      const botPersonId = botClient
        ? account.config.botExtensionId ?? (await resolvePersonId(botClient))
        : undefined;
      const ownerPersonId = ownerClient ? await resolvePersonId(ownerClient) : undefined;
      const { sendClient, sendFallbackClient, assistantPersonId } = selectSendClients(
        account,
        botClient,
        ownerClient,
        botPersonId,
        ownerPersonId,
      );
      const ignoredTexts = [
        account.processingPlaceholder.initialText,
        account.processingPlaceholder.delayedText,
      ];
      const seenInboundPosts = new Set<string>();
      const markOwnPost = (postId: string) => {
        state.tracker.remember(postId);
        for (const monitor of state.monitors) {
          monitor.markOwnPost(postId);
        }
      };
      const onMessage = (post: Parameters<typeof handleInboundPost>[0]["post"]) => {
        if (seenInboundPosts.has(post.id)) {
          return;
        }
        seenInboundPosts.add(post.id);
        void handleInboundPost({
          post,
          cfg,
          botClient,
          ownerClient,
          sendClient,
          sendFallbackClient,
          account,
          botPersonId,
          ownerPersonId,
          assistantPersonId,
          channelRuntime: ctx.channelRuntime,
          tracker: state.tracker,
          markOwnPost,
          log: (message) => ctx.log?.info(message) ?? console.log(message),
        });
      };

      setStatus({ accountId, state: "connecting", statusState: "configured" } as never);
      const monitors: RingCentralWebSocketMonitor[] = [];
      if (botClient) {
        monitors.push(
          new RingCentralWebSocketMonitor({
            client: botClient,
            ownCreatorId: botPersonId,
            filterOwnCreator: true,
            ignoredTexts,
            abortSignal,
            onConnected: () => {
              setStatus({ accountId, connected: true, statusState: "linked" } as never);
              ctx.log?.info("[ringcentral] bot websocket connected");
            },
            onDisconnected: (err) => {
              setStatus({ accountId, connected: false, lastError: err?.message } as never);
            },
            onMessage,
            log: (...args) => ctx.log?.info(args.map(String).join(" ")) ?? console.log(...args),
          }),
        );
      }
      if (ownerClient) {
        monitors.push(
          new RingCentralWebSocketMonitor({
            client: ownerClient,
            ownCreatorId: ownerPersonId,
            // Keep owner monitor open to self-posts so user-identity mode can
            // reply when the owner messages their own Personal/DM surfaces.
            filterOwnCreator: false,
            ignoredTexts,
            abortSignal,
            onMessage,
            onConnected: () => {
              if (!botClient) {
                setStatus({ accountId, connected: true, statusState: "linked" } as never);
              }
              ctx.log?.info("[ringcentral] owner websocket connected");
            },
            onDisconnected: (err) => {
              if (!botClient) {
                setStatus({ accountId, connected: false, lastError: err?.message } as never);
              }
              ctx.log?.warn?.(
                `[ringcentral] owner websocket disconnected: ${err?.message ?? "unknown"}`,
              );
            },
            log: (...args) =>
              botClient
                ? (ctx.log?.debug?.(args.map(String).join(" ")) ?? undefined)
                : (ctx.log?.info(args.map(String).join(" ")) ?? console.log(...args)),
          }),
        );
      }
      state.monitors = monitors;
      try {
        await Promise.all(monitors.map((monitor) => monitor.start()));
      } finally {
        state.monitors = [];
      }
    },
  },

  outbound: {
    deliveryMode: "direct",
    textChunkLimit: DEFAULT_TEXT_CHUNK_LIMIT,
    sendText: async (outCtx: ChannelOutboundContext) => {
      const account = resolveAccount(getRcConfig(outCtx.cfg));
      const botClient = account.botToken ? createBotClient(account.server, account.botToken) : undefined;
      const ownerClient = createOwnerClientFromAccount(account);
      const { sendClient, sendFallbackClient } = selectSendClients(account, botClient, ownerClient);
      let chatId: string;
      try {
        chatId = await resolveOutboundChatId(outCtx.to, sendClient, sendFallbackClient);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err : new Error(String(err)),
          channel: RINGCENTRAL_CHANNEL_ID,
          messageId: "",
        } as never;
      }
      const state = stateFor(outCtx.accountId ?? "default");
      let lastPostId = "";
      for (const chunk of chunkText(outCtx.text ?? "", account.textChunkLimit ?? DEFAULT_TEXT_CHUNK_LIMIT)) {
        const result = await sendMessage({
          client: sendClient,
          fallbackClient: sendFallbackClient,
          chatId,
          text: chunk,
          replyToId: outCtx.replyToId,
          threadId: outCtx.threadId,
          replyToMode: account.replyToMode,
          noThreadChannels: account.noThreadChannels,
          tracker: state.tracker,
          markOwnPost: (postId) => {
            lastPostId = postId;
            state.tracker.remember(postId);
            for (const monitor of state.monitors) {
              monitor.markOwnPost(postId);
            }
          },
        });
        lastPostId = result?.postId ?? lastPostId;
      }
      return { ok: true, channel: RINGCENTRAL_CHANNEL_ID, messageId: lastPostId } as never;
    },
    sendMedia: async (outCtx: ChannelOutboundContext) => {
      const account = resolveAccount(getRcConfig(outCtx.cfg));
      const botClient = account.botToken ? createBotClient(account.server, account.botToken) : undefined;
      const ownerClient = createOwnerClientFromAccount(account);
      const { sendClient, sendFallbackClient } = selectSendClients(account, botClient, ownerClient);
      let chatId: string;
      try {
        chatId = await resolveOutboundChatId(outCtx.to, sendClient, sendFallbackClient);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err : new Error(String(err)),
          channel: RINGCENTRAL_CHANNEL_ID,
          messageId: "",
        } as never;
      }
      const state = stateFor(outCtx.accountId ?? "default");
      const result = await sendMessage({
        client: sendClient,
        fallbackClient: sendFallbackClient,
        chatId,
        mediaUrl: outCtx.mediaUrl,
        replyToId: outCtx.replyToId,
        threadId: outCtx.threadId,
        replyToMode: account.replyToMode,
        noThreadChannels: account.noThreadChannels,
        tracker: state.tracker,
        markOwnPost: (postId) => {
          state.tracker.remember(postId);
          for (const monitor of state.monitors) {
            monitor.markOwnPost(postId);
          }
        },
      });
      return { ok: true, channel: RINGCENTRAL_CHANNEL_ID, messageId: result?.postId ?? "" } as never;
    },
  },

  threading: {
    resolveReplyToMode: ({ cfg }) => resolveAccount(getRcConfig(cfg)).replyToMode,
    resolveReplyTransport: ({ cfg, accountId, threadId, replyToId }) => {
      const account = resolveAccount(getRcConfig(cfg));
      const transport = resolveReplyTransport({
        chatId: "",
        threadId,
        replyToId,
        replyToMode: account.replyToMode,
        noThreadChannels: account.noThreadChannels,
        tracker: stateFor(accountId ?? "default").tracker,
      });
      if (!transport.parentPostId && !transport.threadId) {
        return null;
      }
      return {
        replyToId: transport.parentPostId ? String(transport.parentPostId) : undefined,
        threadId: transport.threadId ? String(transport.threadId) : undefined,
      };
    },
  },

  messaging: {
    targetPrefixes: ["ringcentral", "rc"],
    normalizeTarget: (raw: string) => normalizeTarget(raw),
    inferTargetChatType: ({ to }) => {
      const parsed = parseTarget(to);
      if (parsed?.kind === "user") {
        return "direct";
      }
      if (parsed?.kind === "channel" || parsed?.kind === "team") {
        return "channel";
      }
      if (parsed?.kind === "group") {
        return "group";
      }
      return undefined;
    },
    targetResolver: {
      looksLikeId: (raw) => !!parseTarget(raw),
      hint: "user:<personId>|team:<chatId>|group:<chatId>|channel:<chatId>",
    },
  },

  directory: {
    self: async ({ cfg }) => {
      const account = resolveAccount(getRcConfig(cfg));
      const ext = await createPreferredIdentityClient(account).getExtensionInfo();
      return { kind: "user", id: String(ext.id), name: ext.name, raw: ext };
    },
    listGroupsLive: async ({ cfg, limit }) => {
      const account = resolveAccount(getRcConfig(cfg));
      const chats = await createPreferredReadClient(account).listChats(undefined, limit ?? 50);
      return chats.records.map((chat) => ({
        kind: chat.type === "Everyone" ? "channel" : "group",
        id: chat.id,
        name: chat.name ?? chat.id,
        raw: chat,
      }));
    },
    listGroups: async ({ cfg, limit }) => {
      const account = resolveAccount(getRcConfig(cfg));
      return Object.keys(account.config.teams ?? {})
        .filter((id) => id !== "*")
        .slice(0, limit ?? 50)
        .map((id) => ({ kind: "channel", id, name: id }));
    },
  },

  status: {
    probeAccount: async ({ account }) => {
      try {
        const primary = createPreferredIdentityClient(account);
        const ext = await primary.getExtensionInfo();
        const owner = hasOwnerCredentials(account)
          ? await createOwnerClientFromAccount(account)?.getExtensionInfo().catch((err) => ({ error: String(err) }))
          : undefined;
        return {
          ok: true,
          extensionId: ext.id,
          name: ext.name,
          conversationIdentity: account.conversationIdentity,
          owner,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: "default",
      name: account.config.name ?? "RingCentral",
      enabled: account.config.enabled !== false,
      configured: !!account.botToken || hasOwnerCredentials(account),
      statusState: runtime?.connected ? "linked" : "configured",
      connected: runtime?.connected,
      label: account.config.name ?? "RingCentral",
      dmPolicy: account.dmPolicy,
      allowFrom: account.allowFrom,
      conversationIdentity: account.conversationIdentity,
      credentialSource: hasOwnerCredentials(account) ? "owner credentials" : "none",
    }) as never,
  },

  mentions: {
    stripPatterns: () => ["!\\[:Person\\]\\(\\d+\\)\\s*"],
  },

  actions: ringCentralMessageActions,
  agentTools: ({ cfg }) => [
    createRingCentralHistoryTool(cfg),
    ...createRingCentralArtifactTools(cfg),
  ],
};

function createOwnerClientFromAccount(account: ResolvedAccount): RingCentralClient | undefined {
  if (!hasOwnerCredentials(account)) {
    return undefined;
  }
  return createOwnerClient(
    account.server,
    account.ownerCredentials!.clientId,
    account.ownerCredentials!.clientSecret,
    account.ownerCredentials!.jwt,
  );
}

function createPreferredReadClient(account: ResolvedAccount): RingCentralClient {
  return (
    createOwnerClientFromAccount(account) ??
    (account.botToken ? createBotClient(account.server, account.botToken) : undefined) ??
    (() => {
      throw new Error("RingCentral is not configured for read operations.");
    })()
  );
}

function createPreferredIdentityClient(account: ResolvedAccount): RingCentralClient {
  if (account.conversationIdentity === "user") {
    const owner = createOwnerClientFromAccount(account);
    if (owner) {
      return owner;
    }
  }
  if (account.botToken) {
    return createBotClient(account.server, account.botToken);
  }
  const owner = createOwnerClientFromAccount(account);
  if (owner) {
    return owner;
  }
  throw new Error("RingCentral is not configured.");
}

export function selectSendClients(
  account: ResolvedAccount,
  botClient: RingCentralClient | undefined,
  ownerClient: RingCentralClient | undefined,
  botPersonId?: string,
  ownerPersonId?: string,
): {
  sendClient: RingCentralClient;
  sendFallbackClient?: RingCentralClient;
  assistantPersonId?: string;
} {
  if (account.conversationIdentity === "user") {
    if (!ownerClient) {
      throw new Error(
        'RingCentral conversationIdentity="user" requires ownerCredentials (or RC_USER_* env vars).',
      );
    }
    return {
      sendClient: ownerClient,
      sendFallbackClient: botClient,
      assistantPersonId: ownerPersonId,
    };
  }
  if (!botClient) {
    throw new Error("RingCentral bot token not configured. Set botToken in config or RC_BOT_TOKEN.");
  }
  return {
    sendClient: botClient,
    sendFallbackClient: ownerClient,
    assistantPersonId: botPersonId,
  };
}

async function resolveOutboundChatId(
  target: string,
  primaryClient: RingCentralClient,
  fallbackClient?: RingCentralClient,
): Promise<string> {
  const parsed = parseTarget(target);
  if (!parsed) {
    throw new Error(
      `Invalid RingCentral target "${target}". Use user:<personId>, team:<chatId>, group:<chatId>, or channel:<chatId>.`,
    );
  }
  if (parsed.kind !== "user") {
    return parsed.id;
  }
  try {
    return (await primaryClient.createOrFindDm([parsed.id])).id;
  } catch (err) {
    if (fallbackClient) {
      return (await fallbackClient.createOrFindDm([parsed.id])).id;
    }
    throw err;
  }
}

async function resolvePersonId(client: RingCentralClient): Promise<string | undefined> {
  try {
    return String((await client.getExtensionInfo()).id);
  } catch {
    return undefined;
  }
}

export const ringcentralDock = undefined;
