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
import { createBotClient, createOwnerClient, type RingCentralClient } from "./client.js";
import { ringCentralConfigSchema } from "./config-schema.js";
import { createRingCentralHistoryTool } from "./history-tool.js";
import { handleInboundPost } from "./inbound.js";
import { chunkText } from "./markdown.js";
import { RingCentralWebSocketMonitor } from "./monitor.js";
import { sendMessage } from "./send.js";
import { DEFAULT_TEXT_CHUNK_LIMIT, RINGCENTRAL_CHANNEL_ID } from "./shared.js";
import { extractChatId, normalizeTarget, parseTarget } from "./targets.js";
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
      "Bot token not configured. Set botToken in config or RC_BOT_TOKEN.",
    hasConfiguredState: ({ cfg, env }) => isAccountConfigured(getRcConfig(cfg), env),
    describeAccount: (account) => ({
      accountId: "default",
      name: account.config.name ?? "RingCentral",
      enabled: account.config.enabled !== false,
      configured: !!account.botToken,
      statusState: account.botToken ? "configured" : "not configured",
      dmPolicy: account.dmPolicy,
      allowFrom: account.config.dm?.allowFrom?.map(String),
      tokenSource: account.config.botToken ? "config" : "env:RC_BOT_TOKEN",
      credentialSource: hasOwnerCredentials(account) ? "owner credentials" : "none",
    }),
  },

  gateway: {
    startAccount: async (ctx: ChannelGatewayContext<ResolvedAccount>) => {
      const { account, cfg, abortSignal, setStatus, accountId } = ctx;
      const state = stateFor(accountId);
      const botClient = createBotClient(account.server, account.botToken);
      const ownerClient = createOwnerClientFromAccount(account);
      const botPersonId = account.config.botExtensionId ?? (await resolvePersonId(botClient));
      const ownerPersonId = ownerClient ? await resolvePersonId(ownerClient) : undefined;
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
          account,
          botPersonId,
          ownerPersonId,
          channelRuntime: ctx.channelRuntime,
          tracker: state.tracker,
          markOwnPost,
          log: (message) => ctx.log?.info(message) ?? console.log(message),
        });
      };

      setStatus({ accountId, state: "connecting", statusState: "configured" } as never);
      const botMonitor = new RingCentralWebSocketMonitor({
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
      });
      const monitors = [botMonitor];
      if (ownerClient) {
        monitors.push(
          new RingCentralWebSocketMonitor({
            client: ownerClient,
            ownCreatorId: ownerPersonId,
            filterOwnCreator: false,
            ignoredTexts,
            abortSignal,
            onMessage,
            onConnected: () => ctx.log?.info("[ringcentral] owner websocket connected"),
            onDisconnected: (err) => ctx.log?.warn?.(`[ringcentral] owner websocket disconnected: ${err?.message ?? "unknown"}`),
            log: (...args) => ctx.log?.debug?.(args.map(String).join(" ")) ?? undefined,
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
      const chatId = extractChatId(outCtx.to);
      if (!chatId) {
        return {
          ok: false,
          error: new Error(`Invalid target: ${outCtx.to}`),
          channel: RINGCENTRAL_CHANNEL_ID,
          messageId: "",
        } as never;
      }
      const account = resolveAccount(getRcConfig(outCtx.cfg));
      const botClient = createBotClient(account.server, account.botToken);
      const ownerClient = createOwnerClientFromAccount(account);
      const state = stateFor(outCtx.accountId ?? "default");
      let lastPostId = "";
      for (const chunk of chunkText(outCtx.text ?? "", account.textChunkLimit ?? DEFAULT_TEXT_CHUNK_LIMIT)) {
        const result = await sendMessage({
          client: botClient,
          fallbackClient: ownerClient,
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
      const chatId = extractChatId(outCtx.to);
      if (!chatId) {
        return {
          ok: false,
          error: new Error(`Invalid target: ${outCtx.to}`),
          channel: RINGCENTRAL_CHANNEL_ID,
          messageId: "",
        } as never;
      }
      const account = resolveAccount(getRcConfig(outCtx.cfg));
      const state = stateFor(outCtx.accountId ?? "default");
      const result = await sendMessage({
        client: createBotClient(account.server, account.botToken),
        fallbackClient: createOwnerClientFromAccount(account),
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
      if (parsed?.kind === "dm" || parsed?.kind === "user") {
        return "direct";
      }
      if (parsed?.kind === "channel") {
        return "channel";
      }
      if (parsed?.kind === "group" || parsed?.kind === "chat") {
        return "group";
      }
      return undefined;
    },
    targetResolver: {
      looksLikeId: (raw) => !!extractChatId(raw),
      hint: "ringcentral:<dm|group|channel|chat>:<id>",
    },
  },

  directory: {
    self: async ({ cfg }) => {
      const account = resolveAccount(getRcConfig(cfg));
      const ext = await createBotClient(account.server, account.botToken).getExtensionInfo();
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
      return (account.allowedChannels.length ? account.allowedChannels : Object.keys(account.config.groups ?? {}))
        .slice(0, limit ?? 50)
        .map((id) => ({ kind: "group", id, name: id }));
    },
  },

  status: {
    probeAccount: async ({ account }) => {
      try {
        const ext = await createBotClient(account.server, account.botToken).getExtensionInfo();
        const owner = hasOwnerCredentials(account)
          ? await createOwnerClientFromAccount(account)?.getExtensionInfo().catch((err) => ({ error: String(err) }))
          : undefined;
        return { ok: true, extensionId: ext.id, name: ext.name, owner };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: "default",
      name: account.config.name ?? "RingCentral",
      enabled: account.config.enabled !== false,
      configured: !!account.botToken,
      statusState: runtime?.connected ? "linked" : "configured",
      connected: runtime?.connected,
      label: account.config.name ?? "RingCentral",
      dmPolicy: account.dmPolicy,
      allowFrom: account.config.dm?.allowFrom?.map(String),
      credentialSource: hasOwnerCredentials(account) ? "owner credentials" : "none",
    }) as never,
  },

  mentions: {
    stripPatterns: () => ["!\\[:Person\\]\\(\\d+\\)\\s*"],
  },

  actions: ringCentralMessageActions,
  agentTools: ({ cfg }) => [createRingCentralHistoryTool(cfg)],
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
  return createOwnerClientFromAccount(account) ?? createBotClient(account.server, account.botToken);
}

async function resolvePersonId(client: RingCentralClient): Promise<string | undefined> {
  try {
    return String((await client.getExtensionInfo()).id);
  } catch {
    return undefined;
  }
}

export const ringcentralDock = undefined;
