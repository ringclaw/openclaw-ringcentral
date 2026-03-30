// RingCentral channel plugin — assembles all adapters.

import type {
  ChannelPlugin,
  ChannelGatewayContext,
  ChannelMeta,
  ChannelCapabilities,
  ChannelOutboundContext,
  ChannelMessageActionContext,
  ReplyPayload,
  OpenClawConfig,
} from "openclaw/plugin-sdk";

import { resolveAccount, isAccountConfigured, hasPrivateApp } from "./accounts.js";
import { createBotClient, createPrivateClient, type RingCentralClient } from "./client.js";
import { chunkText, markdownToMiniMarkdown } from "./markdown.js";
import { startMonitor } from "./monitor.js";
import { deleteMessage, sendMessage, sendTypingIndicator, updateMessage } from "./send.js";
import {
  RINGCENTRAL_CHANNEL_ID,
  DEFAULT_TEXT_CHUNK_LIMIT,
} from "./shared.js";
import { buildDmTarget, buildGroupTarget, extractChatId, normalizeTarget, RC_PREFIX } from "./targets.js";
import type { RingCentralConfig, ResolvedAccount } from "./types.js";
import { getEnabledActions, handleAction, type ActionName } from "./actions-adapter.js";
import { getRingCentralRuntime } from "./runtime.js";

function getRcConfig(cfg: OpenClawConfig): RingCentralConfig {
  const channels = (cfg as Record<string, unknown>).channels as Record<string, unknown> | undefined;
  return (channels?.ringcentral ?? {}) as RingCentralConfig;
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
  threads: false,
  reactions: false,
};

export const ringcentralPlugin: ChannelPlugin<ResolvedAccount> = {
  id: RINGCENTRAL_CHANNEL_ID,
  meta,
  capabilities,

  config: {
    listAccountIds: () => ["default"],
    resolveAccount: (cfg: OpenClawConfig) => resolveAccount(getRcConfig(cfg)),
    defaultAccountId: () => "default",
    isEnabled: (account: ResolvedAccount) => account.config.enabled !== false,
    isConfigured: (account: ResolvedAccount) => !!account.botToken,
    unconfiguredReason: () =>
      "Bot token not configured. Set botToken in config or RINGCENTRAL_BOT_TOKEN env var.",
  },

  gateway: {
    startAccount: async (ctx: ChannelGatewayContext<ResolvedAccount>) => {
      const { account, cfg, abortSignal, setStatus } = ctx;
      const botClient = createBotClient(account.server, account.botToken);
      const readClient = hasPrivateApp(account)
        ? createPrivateClient(
            account.server,
            account.credentials!.clientId,
            account.credentials!.clientSecret,
            account.credentials!.jwt,
          )
        : botClient;

      let botExtensionId = account.config.botExtensionId;
      if (!botExtensionId) {
        try {
          const ext = await botClient.getExtensionInfo();
          botExtensionId = String(ext.id);
        } catch { /* continue without */ }
      }

      setStatus({ state: "connecting" } as any);

      await startMonitor({
        serverUrl: account.server,
        botToken: account.botToken,
        botExtensionId,
        abortSignal,
        log: (...args) => console.log(...args),
        onConnected: () => {
          setStatus({ state: "connected" } as any);
          console.log("[ringcentral] connected and listening");
        },
        onDisconnected: (err) => {
          setStatus({ state: "disconnected", error: err?.message } as any);
        },
        onMessage: (post) => {
          void handleInboundPost({ post, cfg, botClient, readClient, account, botExtensionId });
        },
      });
    },
  },

  outbound: {
    deliveryMode: "direct" as const,
    textChunkLimit: DEFAULT_TEXT_CHUNK_LIMIT,

    sendText: async (outCtx: ChannelOutboundContext) => {
      const { to, text, cfg } = outCtx as any;
      const chatId = extractChatId(to);
      if (!chatId) return { ok: false, error: new Error(`Invalid target: ${to}`), channel: RINGCENTRAL_CHANNEL_ID, messageId: "" };

      const rcCfg = getRcConfig(cfg);
      const account = resolveAccount(rcCfg);
      const client = createBotClient(account.server, account.botToken);
      const limit = rcCfg.textChunkLimit ?? DEFAULT_TEXT_CHUNK_LIMIT;
      const converted = markdownToMiniMarkdown(text ?? "");
      const chunks = chunkText(converted, limit);

      let lastPostId = "";
      for (const chunk of chunks) {
        const post = await client.sendPost(chatId, chunk);
        lastPostId = post.id;
      }
      return { ok: true, channel: RINGCENTRAL_CHANNEL_ID, messageId: lastPostId };
    },

    sendMedia: async (outCtx: ChannelOutboundContext) => {
      const { to, cfg } = outCtx as any;
      const chatId = extractChatId(to);
      if (!chatId) return { ok: false, error: new Error(`Invalid target: ${to}`), channel: RINGCENTRAL_CHANNEL_ID, messageId: "" };

      const rcCfg = getRcConfig(cfg);
      const account = resolveAccount(rcCfg);
      const client = createBotClient(account.server, account.botToken);

      const mediaUrl = (outCtx as any).mediaUrl;
      if (mediaUrl) {
        const result = await sendMessage({ client, chatId, mediaUrl });
        return { ok: true, channel: RINGCENTRAL_CHANNEL_ID, messageId: result?.postId ?? "" };
      }
      return { ok: true, channel: RINGCENTRAL_CHANNEL_ID, messageId: "" };
    },
  },

  messaging: {
    normalizeTarget: (raw: string) => normalizeTarget(raw),
  },

  status: {
    probeAccount: async (ctx: any) => {
      try {
        const client = createBotClient(ctx.account.server, ctx.account.botToken);
        const ext = await client.getExtensionInfo();
        return { ok: true, data: { extensionId: ext.id, name: ext.name } };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
      }
    },
    buildAccountSnapshot: (ctx: any) => ({
      accountId: "default",
      name: ctx.account.config.name ?? "RingCentral",
      state: "unknown" as const,
      label: ctx.account.config.name ?? "RingCentral",
    }) as any,
  },

  mentions: {
    stripPatterns: (_params: any) => ["!\\[:Person\\]\\(\\d+\\)\\s*"],
  },

  actions: {
    listActions: ({ cfg }: any) => {
      const rcCfg = getRcConfig(cfg);
      return getEnabledActions(rcCfg.actions) as any;
    },
    handleAction: async (ctx: ChannelMessageActionContext) => {
      const rcCfg = getRcConfig(ctx.cfg);
      const account = resolveAccount(rcCfg);
      const client = hasPrivateApp(account)
        ? createPrivateClient(
            account.server,
            account.credentials!.clientId,
            account.credentials!.clientSecret,
            account.credentials!.jwt,
          )
        : createBotClient(account.server, account.botToken);

      const result = await handleAction(client, ctx.action as ActionName, ctx.params);
      return { content: result, details: result } as any;
    },
  },
};

// --- Inbound Message Handler ---

interface InboundContext {
  post: { id: string; groupId: string; text: string; creatorId: string; creationTime: string };
  cfg: OpenClawConfig;
  botClient: RingCentralClient;
  readClient: RingCentralClient;
  account: ResolvedAccount;
  botExtensionId?: string;
}

async function handleInboundPost(inCtx: InboundContext): Promise<void> {
  const { post, cfg, botClient, account } = inCtx;
  const chatId = post.groupId;
  const text = post.text ?? "";
  const senderId = post.creatorId;

  // Determine chat type
  let chatType: "direct" | "group" | "channel" = "direct";
  try {
    const chat = await botClient.getChat(chatId);
    if (chat.type === "Group" || chat.type === "Team") chatType = "group";
    else if (chat.type === "Everyone") chatType = "channel";
  } catch { /* default to direct */ }

  const from =
    chatType === "direct" ? buildDmTarget(senderId) : buildGroupTarget(chatId);
  const to =
    chatType === "direct"
      ? `${RC_PREFIX}:${senderId}`
      : `${RC_PREFIX}:${chatType}:${chatId}`;

  // Access SDK runtime functions via the channel runtime
  const runtime = getRingCentralRuntime();
  const channelRuntime = (runtime as any).channel;
  const { resolveAgentRoute } = await import("openclaw/plugin-sdk/routing" as any).catch(
    () => ({
      resolveAgentRoute: channelRuntime?.routing?.resolveAgentRoute ?? ((params: any) => ({
        agentId: "main",
        sessionKey: `agent:main:${RINGCENTRAL_CHANNEL_ID}:${params.chatType}:${chatType === "direct" ? senderId : chatId}`,
        accountId: "default",
      })),
    }),
  );

  const route = resolveAgentRoute({
    cfg,
    channel: RINGCENTRAL_CHANNEL_ID,
    chatType,
    accountId: "default",
    to,
  });

  const sessionKey =
    route.sessionKey ??
    `agent:${route.agentId}:${RINGCENTRAL_CHANNEL_ID}:${chatType}:${chatType === "direct" ? senderId : chatId}`;

  // Build MsgContext
  const finalizeInboundContext =
    channelRuntime?.reply?.finalizeInboundContext ?? ((x: any) => x);

  const ctxPayload = finalizeInboundContext({
    Body: text,
    BodyForAgent: text,
    RawBody: text,
    CommandBody: text,
    From: from,
    To: to,
    SessionKey: sessionKey,
    AccountId: "default",
    MessageSid: post.id,
    ChatType: chatType,
    GroupChannel: chatType !== "direct" ? chatId : undefined,
    SenderId: senderId,
    Timestamp: new Date(post.creationTime).getTime(),
    Provider: RINGCENTRAL_CHANNEL_ID,
    Surface: RINGCENTRAL_CHANNEL_ID,
    NativeChannelId: chatId,
    OriginatingChannel: RINGCENTRAL_CHANNEL_ID,
    OriginatingTo: to,
  });

  // Build dispatcher with typing indicator
  let typingPostId: string | undefined;

  const dispatchReplyWithBufferedBlockDispatcher =
    channelRuntime?.reply?.dispatchReplyWithBufferedBlockDispatcher;

  if (dispatchReplyWithBufferedBlockDispatcher) {
    await dispatchReplyWithBufferedBlockDispatcher({
      ctx: ctxPayload,
      cfg,
      dispatcherOptions: {
        sendTyping: async () => {
          typingPostId = await sendTypingIndicator(botClient, chatId);
        },
        clearTyping: async () => {
          if (typingPostId) {
            await deleteMessage(botClient, chatId, typingPostId);
            typingPostId = undefined;
          }
        },
        deliver: async (payload: ReplyPayload) => {
          if (typingPostId) {
            try {
              if (payload.text) {
                await updateMessage(botClient, chatId, typingPostId, payload.text);
              } else {
                await deleteMessage(botClient, chatId, typingPostId);
              }
            } catch {
              if (payload.text) {
                await sendMessage({ client: botClient, chatId, text: payload.text });
              }
            }
            typingPostId = undefined;
            return;
          }
          if (payload.text) {
            await sendMessage({ client: botClient, chatId, text: payload.text });
          }
          if (payload.mediaUrl) {
            await sendMessage({ client: botClient, chatId, mediaUrl: payload.mediaUrl });
          }
        },
        onError: (err: unknown, info: { kind: string }) => {
          console.error(`[ringcentral] ${info.kind} reply error:`, err);
        },
      },
      replyOptions: {
        agentId: route.agentId,
        sessionKey,
      },
    });
  } else {
    // Fallback: just log that runtime dispatch isn't available
    console.warn("[ringcentral] SDK dispatch not available, message not processed:", text.slice(0, 100));
  }
}

export const ringcentralDock = undefined;
