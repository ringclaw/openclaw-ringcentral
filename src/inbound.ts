import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import type {
  ChannelIngressIdentityDescriptor,
  ChannelIngressRouteDescriptor,
} from "openclaw/plugin-sdk/channel-ingress-runtime";
import type { ReplyPayload } from "openclaw/plugin-sdk/reply-runtime";
import { resolveInboundAttachmentsForAgent } from "./attachments.js";
import { RingCentralApiError, type RingCentralClient } from "./client.js";
import { sendMessage, sendTypingIndicator, updateMessage } from "./send.js";
import { RINGCENTRAL_CHANNEL_ID } from "./shared.js";
import { buildChannelTarget, buildDmTarget, buildGroupTarget } from "./targets.js";
import { channelSetMatches, type ThreadParticipationTracker } from "./threading.js";
import type { Chat, PersonInfo, Post, ResolvedAccount } from "./types.js";

type ChatType = "direct" | "group" | "channel";
type ResolveAgentRoute = typeof import("openclaw/plugin-sdk/routing")["resolveAgentRoute"];
type FinalizeInboundContext =
  typeof import("openclaw/plugin-sdk/reply-runtime")["finalizeInboundContext"];
type DispatchReplyWithBufferedBlockDispatcher =
  typeof import("openclaw/plugin-sdk/reply-runtime")["dispatchReplyWithBufferedBlockDispatcher"];

const warnedDropChatIds = new Set<string>();

type ChannelRuntimeLike = {
  routing?: {
    resolveAgentRoute?: ResolveAgentRoute;
  };
  reply?: {
    finalizeInboundContext?: FinalizeInboundContext;
    dispatchReplyWithBufferedBlockDispatcher?: DispatchReplyWithBufferedBlockDispatcher;
  };
};

export interface InboundContext {
  post: Post;
  cfg: OpenClawConfig;
  botClient: RingCentralClient;
  ownerClient?: RingCentralClient;
  account: ResolvedAccount;
  botPersonId?: string;
  ownerPersonId?: string;
  channelRuntime?: unknown;
  tracker: ThreadParticipationTracker;
  markOwnPost?: (postId: string) => void;
  log?: (message: string) => void;
}

const identity = {
  primary: {
    key: "person-id",
    kind: "plugin:ringcentral-person-id",
    normalize: (value) => value.trim().toLowerCase() || null,
    sensitivity: "pii",
  },
  aliases: [
    {
      key: "email",
      kind: "plugin:ringcentral-email",
      normalizeEntry: (value: string) => {
        const normalized = value.trim().toLowerCase();
        return normalized.includes("@") ? normalized : null;
      },
      normalizeSubject: (value: string) => value.trim().toLowerCase() || null,
      dangerous: true,
      sensitivity: "pii",
    },
  ],
  isWildcardEntry: (value: string) => value.trim() === "*",
} satisfies ChannelIngressIdentityDescriptor;

const RC_TYPED_MENTION_RE = /!\[:(?<type>[A-Za-z]+)\]\((?<id>[^)]+)\)/g;
const RC_LEADING_TYPED_MENTION_RE = /^!\[:(?<type>[A-Za-z]+)\]\((?<id>[^)]+)\)\s*/;
const TYPING_POST_FAILSAFE_TTL_MS = 2 * 60_000;
const DISPATCH_START_WARN_MS = 5_000;

const personCache = new Map<string, PersonInfo | null>();

export async function handleInboundPost(inCtx: InboundContext): Promise<void> {
  const { post, cfg, botClient, ownerClient, account, tracker } = inCtx;
  const log = inCtx.log ?? ((message: string) => console.log(message));
  const chatId = post.groupId;
  const text = post.text ?? "";
  const senderId = post.creatorId;
  const chat = await getChatSafe(botClient, chatId);
  const chatType = classifyChat(chat);
  const sender = await getPersonSafe(ownerClient ?? botClient, senderId);

  if (!account.config.allowBots && inCtx.botPersonId && senderId === inCtx.botPersonId) {
    return;
  }

  if (account.debugInboundMessages) {
    logInboundMessageDebug(log, {
      chatId,
      chatType,
      creatorId: senderId,
      text,
      parentPostId: post.parentPostId,
      threadId: post.threadId,
      postId: post.id,
    });
  }

  const mentionFacts = resolveMentionFacts({
    text,
    mentions: post.mentions,
    botPersonId: inCtx.botPersonId,
  });
  const routeDescriptors = buildRouteDescriptors({ account, chatId, chatType });
  const groupConfig = account.config.groups?.[chatId];
  const threadFollowup = isTrackedThreadFollowup(post, tracker);
  if (account.debugInboundMessages && (post.parentPostId || post.threadId)) {
    log(
      `[ringcentral] threadFollowup check postId=${post.id} parentPostId=${post.parentPostId ?? "null"} threadId=${post.threadId ?? "null"} threadFollowup=${threadFollowup}`,
    );
  }
  const requireMention = resolveRequireMention({
    account,
    chatId,
    chatType,
    groupConfigRequireMention: groupConfig?.requireMention,
    threadFollowup,
  });
  const allowFrom = buildAllowFrom({
    account,
    ownerPersonId: inCtx.ownerPersonId,
  });
  const groupAllowFrom = groupConfig?.users ?? [];

  const ingressRuntime = await import("openclaw/plugin-sdk/channel-ingress-runtime");
  const ingress = await ingressRuntime.resolveChannelMessageIngress({
    channelId: RINGCENTRAL_CHANNEL_ID,
    accountId: "default",
    identity,
    subject: {
      stableId: senderId,
      aliases: { email: sender?.email },
    },
    conversation: { kind: chatType, id: chatId },
    event: { kind: "message", authMode: "inbound", mayPair: chatType === "direct" },
    policy: {
      dmPolicy: account.allowAllUsers ? "open" : account.dmPolicy,
      groupPolicy: account.groupPolicy,
      groupAllowFromFallbackToAllowFrom: true,
      mutableIdentifierMatching: "enabled",
      activation: {
        requireMention,
        allowTextCommands: true,
        order: "after-command",
      },
    },
    allowFrom,
    groupAllowFrom,
    route: routeDescriptors,
    mentionFacts,
    useDefaultPairingStore: account.dmPolicy === "pairing",
  });

  if (ingress.ingress.admission !== "dispatch") {
    const loggingRuntime = await import("openclaw/plugin-sdk/channel-logging");
    loggingRuntime.logInboundDrop({
      log,
      channel: RINGCENTRAL_CHANNEL_ID,
      reason: ingress.ingress.reasonCode,
      target: chatId,
    });
    if (account.debugInboundMessages) {
      logInboundDropDebug(log, {
        chatId,
        chatType,
        groupConfigRequireMention: groupConfig?.requireMention,
        groupPolicy: account.groupPolicy,
        reasonCode: ingress.ingress.reasonCode,
        requireMention,
        textLength: text.length,
      });
    } else {
      logFirstInboundDropWarning(log, {
        chatId,
        chatType,
        groupConfigRequireMention: groupConfig?.requireMention,
        groupPolicy: account.groupPolicy,
        reasonCode: ingress.ingress.reasonCode,
        requireMention,
        textLength: text.length,
      });
    }
    return;
  }

  // Register the inbound post's thread so future replies in the same thread
  // are recognised as followups even when the user (not the bot) started it.
  // Store this as thread/root state only; do not add inbound post ids to the
  // bot-sent post set used by resolveReplyTransport(replyToMode:"first").
  tracker.rememberThread(post.threadId ?? post.parentPostId ?? post.id);

  const bodyForAgent = stripRcMentions(text, inCtx.botPersonId, {
    preserveNonBotMentions: chatType === "direct" && !!account.ownerCredentials,
  });
  const mediaPayload = await resolveInboundAttachmentsForAgent({
    attachments: post.attachments,
    primaryClient: botClient,
    fallbackClient: ownerClient,
    account,
    log,
  });
  const runtime = (inCtx.channelRuntime ?? {}) as ChannelRuntimeLike;
  const peer = {
    kind: chatType,
    id: chatType === "direct" ? senderId : chatId,
  };
  const route =
    runtime.routing?.resolveAgentRoute?.({
      cfg,
      channel: RINGCENTRAL_CHANNEL_ID,
      accountId: "default",
      peer,
    }) ??
    (await import("openclaw/plugin-sdk/routing")).resolveAgentRoute({
      cfg,
      channel: RINGCENTRAL_CHANNEL_ID,
      accountId: "default",
      peer,
    });
  const target = buildInboundTarget({ chatType, chatId, senderId });
  const fallbackReplyRuntime =
    runtime.reply?.finalizeInboundContext && runtime.reply?.dispatchReplyWithBufferedBlockDispatcher
      ? null
      : await import("openclaw/plugin-sdk/reply-runtime");
  const finalizeInboundContext =
    runtime.reply?.finalizeInboundContext ?? fallbackReplyRuntime!.finalizeInboundContext;
  const dispatchReplyWithBufferedBlockDispatcher =
    runtime.reply?.dispatchReplyWithBufferedBlockDispatcher ??
    fallbackReplyRuntime!.dispatchReplyWithBufferedBlockDispatcher;
  const context = finalizeInboundContext({
    Body: bodyForAgent,
    BodyForAgent: bodyForAgent,
    RawBody: text,
    CommandBody: bodyForAgent,
    BodyForCommands: bodyForAgent,
    From: target,
    To: target,
    SessionKey: route.sessionKey,
    AccountId: route.accountId ?? "default",
    MessageSid: post.id,
    MessageSidFull: post.id,
    ReplyToId: post.parentPostId,
    RootMessageId: post.threadId,
    ChatType: chatType,
    ConversationLabel: chat?.name ?? chatId,
    GroupChannel: chatType !== "direct" ? chatId : undefined,
    GroupSystemPrompt: groupConfig?.systemPrompt,
    SenderId: senderId,
    SenderName: formatPersonName(sender),
    Timestamp: Date.parse(post.creationTime) || Date.now(),
    Provider: RINGCENTRAL_CHANNEL_ID,
    Surface: RINGCENTRAL_CHANNEL_ID,
    NativeChannelId: chatId,
    OriginatingChannel: RINGCENTRAL_CHANNEL_ID,
    OriginatingTo: target,
    OwnerAllowFrom: allowFrom,
    ...mediaPayload,
  });

  const dispatchWarnTimer = setTimeout(() => {
    logInboundDispatchDiagnostic(log, "still_pending", {
      chatId,
      postId: post.id,
      parentPostId: post.parentPostId,
      threadId: post.threadId,
      routeSessionKey: route.sessionKey,
    });
  }, DISPATCH_START_WARN_MS);
  dispatchWarnTimer.unref?.();
  logInboundDispatchDiagnostic(log, "start", {
    chatId,
    postId: post.id,
    parentPostId: post.parentPostId,
    threadId: post.threadId,
    routeSessionKey: route.sessionKey,
  });
  try {
    await dispatchReplyWithBufferedBlockDispatcher({
      ctx: context,
      cfg,
      dispatcherOptions: createDispatcherOptions({
        botClient,
        ownerClient,
        account,
        chatId,
        sourcePostId: post.id,
        sourceThreadId: post.threadId,
        tracker,
        markOwnPost: inCtx.markOwnPost,
        log,
      }),
    });
    logInboundDispatchDiagnostic(log, "complete", {
      chatId,
      postId: post.id,
      parentPostId: post.parentPostId,
      threadId: post.threadId,
      routeSessionKey: route.sessionKey,
    });
  } catch (err) {
    logInboundDispatchDiagnostic(log, "failed", {
      chatId,
      postId: post.id,
      parentPostId: post.parentPostId,
      threadId: post.threadId,
      routeSessionKey: route.sessionKey,
      error: formatTypingPostError(err),
    });
    throw err;
  } finally {
    clearTimeout(dispatchWarnTimer);
  }
}

function isTrackedThreadFollowup(post: Post, tracker: ThreadParticipationTracker): boolean {
  return Boolean(
    (post.parentPostId && (tracker.has(post.parentPostId) || tracker.hasThread(post.parentPostId))) ||
      (post.threadId && tracker.hasThread(post.threadId)),
  );
}

export function stripRcMentions(
  text: string,
  botPersonId?: string,
  opts: { preserveNonBotMentions?: boolean } = {},
): string {
  if (!text) {
    return text;
  }
  let stripped = text.trimStart();
  const leadingWhitespace = text.slice(0, text.length - stripped.length);

  if (opts.preserveNonBotMentions) {
    let addressed = false;
    while (true) {
      const match = RC_LEADING_TYPED_MENTION_RE.exec(stripped);
      if (!match?.groups) {
        break;
      }
      if (botPersonId && match.groups.id === botPersonId) {
        addressed = true;
        stripped = stripped.slice(match[0].length).trimStart();
        continue;
      }
      break;
    }
    if (botPersonId) {
      stripped = stripped.replace(RC_TYPED_MENTION_RE, (raw, _type, id) =>
        id === botPersonId ? "" : raw,
      );
    }
    return addressed ? stripped.trim() : (leadingWhitespace + stripped).trimEnd() || text;
  }

  let addressed = false;
  while (true) {
    const match = RC_LEADING_TYPED_MENTION_RE.exec(stripped);
    if (!match?.groups) {
      break;
    }
    addressed ||= !botPersonId || match.groups.id === botPersonId;
    stripped = stripped.slice(match[0].length).trimStart();
  }
  stripped = stripped.replace(RC_TYPED_MENTION_RE, "").trim();
  return addressed ? stripped : (leadingWhitespace + stripped).trimEnd() || text;
}

function createDispatcherOptions(params: {
  botClient: RingCentralClient;
  ownerClient?: RingCentralClient;
  account: ResolvedAccount;
  chatId: string;
  sourcePostId: string;
  sourceThreadId?: string | number | null;
  tracker: ThreadParticipationTracker;
  markOwnPost?: (postId: string) => void;
  log: (message: string) => void;
}) {
  // RingCentral has no native typing API, so this channel uses one temporary
  // message as a typing indicator while OpenClaw's TypingController owns the
  // start/cleanup lifecycle.
  let typingPostId: string | undefined;
  let typingEditTimer: ReturnType<typeof setTimeout> | undefined;
  let typingFailsafeTimer: ReturnType<typeof setTimeout> | undefined;

  const cancelTypingEdit = () => {
    if (typingEditTimer) {
      clearTimeout(typingEditTimer);
      typingEditTimer = undefined;
    }
  };

  const cancelTypingFailsafe = () => {
    if (typingFailsafeTimer) {
      clearTimeout(typingFailsafeTimer);
      typingFailsafeTimer = undefined;
    }
  };

  const scheduleTypingEdit = () => {
    cancelTypingEdit();
    const { delayedText, editDelaySeconds, initialText } = params.account.processingPlaceholder;
    if (!typingPostId || !delayedText || delayedText === initialText || editDelaySeconds <= 0) {
      return;
    }
    typingEditTimer = setTimeout(() => {
      typingEditTimer = undefined;
      const idToEdit = typingPostId;
      if (!idToEdit) {
        return;
      }
      void updateMessage(params.botClient, params.chatId, idToEdit, delayedText, false).catch((err) => {
        logTypingPostWarning(params.log, "failed to edit typing post", {
          chatId: params.chatId,
          postId: idToEdit,
          error: formatTypingPostError(err),
        });
      });
    }, editDelaySeconds * 1000);
  };

  const scheduleTypingFailsafe = (postId: string) => {
    cancelTypingFailsafe();
    typingFailsafeTimer = setTimeout(() => {
      typingFailsafeTimer = undefined;
      if (typingPostId !== postId) {
        return;
      }
      params.log(
        `[ringcentral] typing post failsafe cleanup postId=${postId} chatId=${params.chatId}`,
      );
      void clearTypingPost();
    }, TYPING_POST_FAILSAFE_TTL_MS);
  };

  const startTypingPost = async () => {
    if (!params.account.processingPlaceholder.enabled || typingPostId) {
      return;
    }
    const newId = await sendTypingIndicator(
      params.botClient,
      params.chatId,
      params.account.processingPlaceholder.initialText,
      {
        fallbackClient: params.ownerClient,
        replyToId: params.sourcePostId,
        threadId: params.sourceThreadId,
        replyToMode: params.account.replyToMode,
        noThreadChannels: params.account.noThreadChannels,
        tracker: params.tracker,
        markOwnPost: params.markOwnPost,
      },
    );
    if (newId) {
      typingPostId = newId;
      params.log(
        `[ringcentral] created typing post postId=${newId} chatId=${params.chatId}`,
      );
      scheduleTypingEdit();
      scheduleTypingFailsafe(newId);
    }
  };

  const clearTypingPost = async () => {
    cancelTypingEdit();
    cancelTypingFailsafe();
    if (!typingPostId) {
      return;
    }
    const idToDelete = typingPostId;
    typingPostId = undefined;
    const deleted = await deleteTypingPostWithRetry({
      botClient: params.botClient,
      chatId: params.chatId,
      postId: idToDelete,
      log: params.log,
    });
    if (deleted) {
      params.log(
        `[ringcentral] deleted typing post postId=${idToDelete} chatId=${params.chatId}`,
      );
    }
  };

  return {
    onReplyStart: startTypingPost,
    onCleanup: clearTypingPost,
    deliver: async (payload: ReplyPayload) => {
      if (payload.text || payload.mediaUrl) {
        await clearTypingPost();
      }
      if (payload.text) {
        await sendReplyText(params, payload.text);
      }
      if (payload.mediaUrl) {
        await sendMessage({
          client: params.botClient,
          fallbackClient: params.ownerClient,
          chatId: params.chatId,
          mediaUrl: payload.mediaUrl,
          replyToId: params.sourcePostId,
          threadId: params.sourceThreadId,
          replyToMode: params.account.replyToMode,
          noThreadChannels: params.account.noThreadChannels,
          tracker: params.tracker,
          markOwnPost: params.markOwnPost,
        });
      }
    },
    onError: (err: unknown, info: { kind: string }) => {
      void clearTypingPost();
      console.error(`[ringcentral] ${info.kind} reply error:`, err);
    },
  };
}

async function deleteTypingPostWithRetry(params: {
  botClient: RingCentralClient;
  chatId: string;
  postId: string;
  log: (message: string) => void;
}): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await params.botClient.deletePost(params.chatId, params.postId);
      return true;
    } catch (err) {
      if (attempt === 1) {
        await sleep(250);
        continue;
      }
      logTypingPostWarning(params.log, "typing post stuck after delete retry", {
        chatId: params.chatId,
        postId: params.postId,
        error: formatTypingPostError(err),
      });
    }
  }
  return false;
}

function logTypingPostWarning(
  log: (message: string) => void,
  event: string,
  details: {
    chatId: string;
    postId?: string;
    error: string;
  },
): void {
  log(
    `[ringcentral] WARN ${event} ${JSON.stringify({
      chatId: details.chatId,
      postId: details.postId,
      error: details.error,
    })}`,
  );
}

function formatTypingPostError(err: unknown): string {
  if (err instanceof RingCentralApiError) {
    return `HTTP ${err.status}`;
  }
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }
  return String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendReplyText(
  params: {
    botClient: RingCentralClient;
    ownerClient?: RingCentralClient;
    account: ResolvedAccount;
    chatId: string;
    sourcePostId: string;
    sourceThreadId?: string | number | null;
    tracker: ThreadParticipationTracker;
    markOwnPost?: (postId: string) => void;
  },
  text: string,
) {
  await sendMessage({
    client: params.botClient,
    fallbackClient: params.ownerClient,
    chatId: params.chatId,
    text,
    replyToId: params.sourcePostId,
    threadId: params.sourceThreadId,
    replyToMode: params.account.replyToMode,
    noThreadChannels: params.account.noThreadChannels,
    tracker: params.tracker,
    markOwnPost: params.markOwnPost,
  });
}

function buildAllowFrom(params: {
  account: ResolvedAccount;
  ownerPersonId?: string;
}): Array<string | number> {
  if (params.account.allowAllUsers) {
    return ["*"];
  }
  const entries = [
    ...(params.account.config.dm?.allowFrom ?? []),
    ...params.account.allowedUserEmails,
    ...(params.ownerPersonId ? [params.ownerPersonId] : []),
  ];
  return Array.from(new Set(entries.map((entry) => String(entry).trim()).filter(Boolean)));
}

function buildRouteDescriptors(params: {
  account: ResolvedAccount;
  chatId: string;
  chatType: ChatType;
}): ChannelIngressRouteDescriptor[] {
  const routes: ChannelIngressRouteDescriptor[] = [];
  if (channelSetMatches(params.account.ignoredChannels, params.chatId)) {
    routes.push({
      id: `ringcentral:ignored:${params.chatId}`,
      configured: true,
      matched: true,
      allowed: false,
      blockReason: "ignored channel",
    });
  }
  if (params.account.allowedChannels.length > 0) {
    routes.push({
      id: `ringcentral:allowed:${params.chatId}`,
      configured: true,
      matched: channelSetMatches(params.account.allowedChannels, params.chatId),
      allowed: channelSetMatches(params.account.allowedChannels, params.chatId),
      blockReason: "channel not allowlisted",
    });
  }
  if (params.chatType !== "direct" && params.account.groupPolicy === "allowlist") {
    const groupConfig = params.account.config.groups?.[params.chatId];
    routes.push({
      id: `ringcentral:group:${params.chatId}`,
      configured: !!groupConfig,
      matched: true,
      allowed: !!groupConfig && groupConfig.enabled !== false,
      blockReason: "group not allowlisted",
    });
  }
  return routes;
}

function resolveMentionFacts(params: {
  text: string;
  mentions?: Post["mentions"];
  botPersonId?: string;
}) {
  const textMentions = Array.from(params.text.matchAll(RC_TYPED_MENTION_RE));
  const explicitMentions = params.mentions ?? [];
  const hasAnyMention = textMentions.length > 0 || explicitMentions.length > 0;
  const wasMentioned = params.botPersonId
    ? textMentions.some((match) => match.groups?.id === params.botPersonId) ||
      explicitMentions.some((mention) => mention.id === params.botPersonId)
    : hasAnyMention;
  return { canDetectMention: true, wasMentioned, hasAnyMention };
}

function logInboundMessageDebug(
  log: (message: string) => void,
  details: {
    chatId: string;
    creatorId: string;
    chatType: ChatType;
    text: string;
    parentPostId?: string;
    threadId?: string;
    postId?: string;
  },
): void {
  log(
    `[ringcentral] inbound message ${JSON.stringify({
      chatId: details.chatId,
      creatorId: details.creatorId,
      chatType: details.chatType,
      textLength: details.text.length,
      text: details.text,
      postId: details.postId,
      parentPostId: details.parentPostId,
      threadId: details.threadId,
    })}`,
  );
}

function logInboundDropDebug(
  log: (message: string) => void,
  details: {
    chatId: string;
    chatType: ChatType;
    groupConfigRequireMention?: boolean;
    groupPolicy: string;
    reasonCode: string;
    requireMention: boolean;
    textLength: number;
  },
): void {
  log(
    `[ringcentral] inbound message dropped ${JSON.stringify({
      chatId: details.chatId,
      chatType: details.chatType,
      groupConfigRequireMention: details.groupConfigRequireMention,
      groupPolicy: details.groupPolicy,
      reasonCode: details.reasonCode,
      requireMention: details.requireMention,
      textLength: details.textLength,
    })}`,
  );
}

function logFirstInboundDropWarning(
  log: (message: string) => void,
  details: {
    chatId: string;
    chatType: ChatType;
    groupConfigRequireMention?: boolean;
    groupPolicy: string;
    reasonCode: string;
    requireMention: boolean;
    textLength: number;
  },
): void {
  if (warnedDropChatIds.has(details.chatId)) {
    return;
  }
  warnedDropChatIds.add(details.chatId);
  log(
    `[ringcentral] WARN inbound message dropped ${JSON.stringify({
      chatId: details.chatId,
      chatType: details.chatType,
      groupConfigRequireMention: details.groupConfigRequireMention,
      groupPolicy: details.groupPolicy,
      reasonCode: details.reasonCode,
      requireMention: details.requireMention,
      textLength: details.textLength,
      debugHint: "set debugInboundMessages=true for message text and drop details",
    })}`,
  );
}

function logInboundDispatchDiagnostic(
  log: (message: string) => void,
  event: "start" | "still_pending" | "complete" | "failed",
  details: {
    chatId: string;
    postId: string;
    parentPostId?: string;
    threadId?: string;
    routeSessionKey: string;
    error?: string;
  },
): void {
  log(
    `[ringcentral] inbound dispatch ${event} ${JSON.stringify({
      chatId: details.chatId,
      postId: details.postId,
      parentPostId: details.parentPostId,
      threadId: details.threadId,
      routeSessionKey: details.routeSessionKey,
      error: details.error,
    })}`,
  );
}

function resolveRequireMention(params: {
  account: ResolvedAccount;
  chatId: string;
  chatType: ChatType;
  groupConfigRequireMention?: boolean;
  threadFollowup: boolean;
}): boolean {
  if (params.chatType === "direct") {
    return false;
  }
  if (
    channelSetMatches(params.account.freeResponseChannels, params.chatId) ||
    (params.threadFollowup && !params.account.threadRequireMention)
  ) {
    return false;
  }
  if (params.groupConfigRequireMention !== undefined) {
    return params.groupConfigRequireMention;
  }
  if (params.account.requireMentionExplicit) {
    return params.account.requireMention;
  }
  return params.account.groupPolicy === "open" ? false : params.account.requireMention;
}

async function getChatSafe(client: RingCentralClient, chatId: string): Promise<Chat | null> {
  try {
    return await client.getChat(chatId);
  } catch {
    return null;
  }
}

async function getPersonSafe(
  client: RingCentralClient,
  personId: string,
): Promise<PersonInfo | null> {
  if (personCache.has(personId)) {
    return personCache.get(personId) ?? null;
  }
  try {
    const person = await client.getPersonInfo(personId);
    personCache.set(personId, person);
    return person;
  } catch {
    personCache.set(personId, null);
    return null;
  }
}

function classifyChat(chat: Chat | null): ChatType {
  if (chat?.type === "Group" || chat?.type === "Team") {
    return "group";
  }
  if (chat?.type === "Everyone") {
    return "channel";
  }
  return "direct";
}

function buildInboundTarget(params: { chatType: ChatType; chatId: string; senderId: string }): string {
  if (params.chatType === "direct") {
    return buildDmTarget(params.senderId);
  }
  if (params.chatType === "channel") {
    return buildChannelTarget(params.chatId);
  }
  return buildGroupTarget(params.chatId);
}

function formatPersonName(person: PersonInfo | null): string | undefined {
  if (!person) {
    return undefined;
  }
  const name = [person.firstName, person.lastName].filter(Boolean).join(" ").trim();
  return name || person.email;
}
