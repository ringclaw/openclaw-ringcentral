import { Subscriptions } from "@ringcentral/subscriptions";
import RcWsExtension from "@rc-ex/ws";
const WebSocketExtension = RcWsExtension.default ?? RcWsExtension;
type WebSocketExtension = InstanceType<typeof WebSocketExtension>;
import * as fs from "fs";
import * as path from "path";

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  resolveMentionGatingWithBypass,
  warnMissingProviderGroupPolicyFallbackOnce,
} from "openclaw/plugin-sdk";

import type { ResolvedRingCentralAccount } from "./accounts.js";
import { getRingCentralSDK } from "./auth.js";
import {
  sendRingCentralMessage,
  updateRingCentralMessage,
  deleteRingCentralMessage,
  downloadRingCentralAttachment,
  uploadRingCentralAttachment,
  getRingCentralChat,
  getRingCentralUser,
  extractRcApiError,
  formatRcApiError,
} from "./api.js";
import { getRingCentralRuntime } from "./runtime.js";
import { startChatCacheSync, stopChatCacheSync } from "./chat-cache.js";
import type {
  RingCentralWebhookEvent,
  RingCentralEventBody,
  RingCentralAttachment,
  RingCentralMention,
  RingCentralChat,
  RingCentralUser,
} from "./types.js";

// TTL cache with lazy eviction and max size bound.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 500;

type CacheEntry<T> = { value: T; expiresAt: number };

/** @internal Exported for testing only. */
export class TtlCache<T> {
  private readonly map = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(opts: { maxSize: number; ttlMs: number }) {
    this.maxSize = opts.maxSize;
    this.ttlMs = opts.ttlMs;
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    // Optimization: Delete key if it exists so re-insertion moves it to the end (MRU).
    // This ensures Map iteration order remains sorted by expiration time (assuming constant TTL).
    if (this.map.has(key)) {
      this.map.delete(key);
    }

    if (this.map.size >= this.maxSize) {
      // Evict expired entries first.
      // Optimization: Since map is sorted by insertion/update time, oldest entries are first.
      // We only need to check from the start until we find a non-expired item.
      const now = Date.now();
      for (const [k, v] of this.map) {
        if (now > v.expiresAt) {
          this.map.delete(k);
        } else {
          // Found first non-expired item; all subsequent items are newer/later expiry.
          break;
        }
      }
      // If still at capacity after cleaning expired, evict oldest (LRU due to delete-before-set above)
      if (this.map.size >= this.maxSize) {
        const firstKey = this.map.keys().next().value;
        if (firstKey !== undefined) this.map.delete(firstKey);
      }
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.map.clear();
  }
}

const chatInfoCache = new TtlCache<RingCentralChat>({ maxSize: CACHE_MAX_SIZE, ttlMs: CACHE_TTL_MS });
const userInfoCache = new TtlCache<RingCentralUser>({ maxSize: CACHE_MAX_SIZE, ttlMs: CACHE_TTL_MS });

async function getCachedChat(
  account: ResolvedRingCentralAccount,
  chatId: string,
): Promise<RingCentralChat | null> {
  const key = `${account.accountId}:${chatId}`;
  const cached = chatInfoCache.get(key);
  if (cached) return cached;
  try {
    const data = await getRingCentralChat({ account, chatId });
    if (data) chatInfoCache.set(key, data);
    return data;
  } catch {
    return null;
  }
}

async function getCachedUser(
  account: ResolvedRingCentralAccount,
  userId: string,
): Promise<RingCentralUser | null> {
  const key = `${account.accountId}:${userId}`;
  const cached = userInfoCache.get(key);
  if (cached) return cached;
  try {
    const data = await getRingCentralUser({ account, userId });
    if (data) userInfoCache.set(key, data);
    return data;
  } catch {
    return null;
  }
}

export type RingCentralLogger = {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

/**
 * @deprecated Use OpenClaw logger (getLogger(core)) instead.
 * Kept for backward compatibility but no longer used internally.
 */
export type RingCentralRuntimeEnv = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

function createLogger(core: RingCentralCoreRuntime): RingCentralLogger {
  return core.logging.getChildLogger({ subsystem: "gateway/channels/ringcentral" });
}

// Track recently sent message IDs to avoid processing bot's own replies
const recentlySentMessageIds = new Set<string>();
const MESSAGE_ID_TTL = 60000; // 60 seconds

// Dedup inbound messages to prevent duplicate processing during WS reconnect overlap.
// Keyed by messageId; TTL long enough to cover reconnect window.
const INBOUND_DEDUP_TTL_MS = 2 * 60_000; // 2 minutes
const INBOUND_DEDUP_MAX_SIZE = 500;
const inboundDedupCache = new TtlCache<true>({ maxSize: INBOUND_DEDUP_MAX_SIZE, ttlMs: INBOUND_DEDUP_TTL_MS });

// Health check / watchdog settings (supplements autoRecover's pingServer)
const HEALTH_CHECK_INTERVAL_MS = 30_000; // check every 30s
const SLEEP_DRIFT_THRESHOLD_MS = 10_000; // >10s timer drift → system likely slept

/**
 * Thrown when /oauth/wstoken returns 429 (rate limited).
 * Callers can catch this to distinguish rate-limit pauses from other failures.
 */
export class WsTokenRateLimitError extends Error {
  public readonly retryAfterMs: number;
  constructor(retryAfterMs: number, accountId: string) {
    super(
      `[${accountId}] /oauth/wstoken rate limited (429). ` +
      `Requests paused for ${Math.ceil(retryAfterMs / 1000)}s.`,
    );
    this.name = "WsTokenRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

// WebSocket singleton per account to avoid hammering /oauth/wstoken.
// @ringcentral/subscriptions + @rc-ex/ws can swallow initial connect errors and
// repeated new Subscriptions()/newWsExtension() will trigger new wstoken calls.
type WsManager = {
  key: string;
  sdk: any;
  subscriptions: Subscriptions;
  rc: any;
  wsExt: WebSocketExtension;
  connectPromise?: Promise<void>;
  lastConnectAt?: number;
  subscribed?: boolean; // true once wsExt.subscribe() has been called
};

const wsManagers = new Map<string, WsManager>();

function buildWsManagerKey(account: ResolvedRingCentralAccount): string {
  // Changes in credentials should force a new WS manager.
  return `${account.clientId}:${account.server}:${account.jwt?.slice(0, 20)}`;
}

async function getOrCreateWsManager(
  account: ResolvedRingCentralAccount,
  logger: RingCentralLogger,
): Promise<WsManager> {
  const key = buildWsManagerKey(account);
  const cached = wsManagers.get(account.accountId);
  if (cached && cached.key === key) return cached;

  // Replace cache entry on credential change.
  const sdk = await getRingCentralSDK(account);
  const subscriptions = new Subscriptions({ sdk });
  await (subscriptions as any).init?.();

  const wsExt = new WebSocketExtension({
    debugMode: false,
    autoRecover: {
      enabled: true,
      // Exponential backoff: 5s, 10s, 20s, 40s, …, capped at 5min
      checkInterval: (retries: number) => Math.min(5000 * Math.pow(2, retries), 300_000),
      pingServerInterval: 60_000,
    },
  });

  const rc = (subscriptions as any).rc;
  if (!rc || typeof rc.installExtension !== "function") {
    throw new Error("Subscriptions.rc.installExtension is unavailable; cannot install WS extension");
  }

  logger.debug(`[${account.accountId}] Installing @rc-ex/ws extension (singleton)...`);
  await rc.installExtension(wsExt);

  const mgr: WsManager = { key, sdk, subscriptions, rc, wsExt };
  wsManagers.set(account.accountId, mgr);
  return mgr;
}

async function ensureWsConnected(
  mgr: WsManager,
  account: ResolvedRingCentralAccount,
  logger: RingCentralLogger,
): Promise<void> {
  // If already connected/open, nothing to do.
  const ws = mgr.wsExt.ws;
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) {
    return;
  }
  if (mgr.connectPromise) {
    return mgr.connectPromise;
  }

  mgr.connectPromise = (async () => {
    logger.debug(`[${account.accountId}] Forcing WS connect() (singleton)...`);
    try {
      await mgr.wsExt.connect(false);
    } catch (err) {
      // Detect 429 rate limit from /oauth/wstoken and throw a dedicated error.
      const e = err as any;
      const errStr = String(err);
      const is429 =
        e?.response?.status === 429 ||
        e?.message === "Request rate exceeded" ||
        errStr.includes("429") ||
        errStr.includes("rate") ||
        errStr.includes("Rate");
      if (is429) {
        const retryAfterHeader =
          typeof e?.response?.headers?.get === "function"
            ? e.response.headers.get("retry-after")
            : typeof e?.response?.headers?.["retry-after"] === "string"
              ? e.response.headers["retry-after"]
              : undefined;
        const retryAfterMs =
          typeof e?.retryAfter === "number"
            ? e.retryAfter
            : retryAfterHeader
              ? parseInt(retryAfterHeader, 10) * 1000
              : 60_000;
        const backoffMs =
          Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 60_000;
        throw new WsTokenRateLimitError(backoffMs, account.accountId);
      }
      throw err; // re-throw non-429 errors as-is
    }
    mgr.lastConnectAt = Date.now();
    if (!mgr.wsExt.ws) {
      throw new Error("WS connect() returned but wsExt.ws is still undefined");
    }
  })();

  try {
    await mgr.connectPromise;
  } finally {
    mgr.connectPromise = undefined;
  }
}


function trackSentMessageId(messageId: string): void {
  recentlySentMessageIds.add(messageId);
  setTimeout(() => recentlySentMessageIds.delete(messageId), MESSAGE_ID_TTL);
}

function isOwnSentMessage(messageId: string): boolean {
  return recentlySentMessageIds.has(messageId);
}

// ─── Loop guard: high-confidence structural detection of bot-generated markers ───
// Returns the marker type if matched, or null if the message is normal user content.
// Only filters text with unambiguous bot/system structural features.
// Does NOT filter: media:attachment, System: prefix, RingCentral user: prefix alone.

// Matches: "> 🦞 Xxx is thinking...", "> Xxx is thinking...", "> Xxx 正在思考..."
const THINKING_MARKER_RE = /^>\s*.+\s+is\s+thinking\.\.\.\s*$|^>\s*.+\s+正在思考[.…]*\s*$/m;
// Matches: "> --------answer--------" or "> ---------end----------" (variable dash count)
const ANSWER_WRAPPER_RE = /^>\s*-{3,}\s*answer\s*-{3,}\s*$/m;
const END_WRAPPER_RE = /^>\s*-{3,}\s*end\s*-{3,}\s*$/m;
// Matches: "Queued messages while agent was busy" (case-insensitive)
const QUEUED_BUSY_RE = /queued messages while agent was busy/i;
// Matches: "Queued #1", "Queued #23" etc.
const QUEUED_NUMBER_RE = /^queued\s+#\d+$/im;

export type LoopGuardReason = "thinking_marker" | "answer_wrapper" | "queued_busy" | "queued_number";

export function detectLoopGuardMarker(text: string): LoopGuardReason | null {
  if (THINKING_MARKER_RE.test(text)) return "thinking_marker";
  if (ANSWER_WRAPPER_RE.test(text)) return "answer_wrapper";
  if (END_WRAPPER_RE.test(text)) return "answer_wrapper";
  if (QUEUED_BUSY_RE.test(text)) return "queued_busy";
  if (QUEUED_NUMBER_RE.test(text)) return "queued_number";
  return null;
}

// ─── Attachment placeholder: silent discard for bare placeholder-only messages ───
// Matches "media:attachment" or "<media:attachment>" after stripping whitespace and
// optional blockquote prefix. Returns false if any other text is present.
const ATTACHMENT_PLACEHOLDER_RE = /^(?:>\s*)?<?media:attachment>?\s*$/i;

export function isPureAttachmentPlaceholder(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  return ATTACHMENT_PLACEHOLDER_RE.test(normalized);
}

export type RingCentralMonitorOptions = {
  account: ResolvedRingCentralAccount;
  config: OpenClawConfig;
  runtime: RingCentralRuntimeEnv;
  abortSignal: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

type RingCentralCoreRuntime = ReturnType<typeof getRingCentralRuntime>;

// Shared logger instance (lazy initialized)
let sharedLogger: RingCentralLogger | null = null;

function getLogger(core: RingCentralCoreRuntime): RingCentralLogger {
  if (!sharedLogger) {
    sharedLogger = createLogger(core);
  }
  return sharedLogger;
}

function logVerbose(
  core: RingCentralCoreRuntime,
  message: string,
) {
  if (core.logging.shouldLogVerbose()) {
    getLogger(core).debug(message);
  }
}

export function sanitizeFilename(name: string): string {
  // Replace unsafe chars with underscore.
  // We explicitly disallow dots to prevent path traversal via ".."
  // RingCentral IDs are typically numeric, so this is safe.
  return name.replace(/[^a-zA-Z0-9-_]/g, "_");
}

export function sanitizeAttachmentFilename(name: string): string {
  // Allow alphanumeric, dot, dash, underscore
  let sanitized = name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  // Prevent path traversal sequences
  sanitized = sanitized.replace(/\.\.+/g, "_");
  // Fallback if empty or hidden
  if (!sanitized || sanitized === "." || sanitized === "_") {
    return "attachment";
  }
  return sanitized;
}

/** @internal Exported for testing only. */
export function summarizeChatInfo(chat: unknown): string {
  if (!chat || typeof chat !== "object") return "null";
  const c = chat as Record<string, unknown>;
  return JSON.stringify({
    id: c.id ?? null,
    type: c.type ?? null,
    memberCount: Array.isArray(c.members) ? c.members.length : null,
    status: c.status ?? null,
  });
}

/** @internal Exported for testing only. */
export function summarizeEvent(event: unknown): string {
  if (!event || typeof event !== "object") return "null";
  const e = event as Record<string, unknown>;
  const body = (e.body && typeof e.body === "object") ? (e.body as Record<string, unknown>) : null;

  // Shape fingerprint for diagnostics: log key sets (no sensitive values).
  const bodyKeys = body ? Object.keys(body).sort() : [];
  const bodyKeySig = bodyKeys.length > 0 ? bodyKeys.join(",") : "";

  return JSON.stringify({
    event: e.event ?? null,
    subscriptionId: e.subscriptionId ?? null,
    shape: {
      hasBody: Boolean(body),
      bodyKeys: bodyKeySig || null,
    },
    body: body ? {
      id: body.id ?? null,
      groupId: body.groupId ?? null,
      type: body.type ?? null,
      eventType: body.eventType ?? null,
      creatorId: body.creatorId ?? null,
      // Prefer not to log text contents, only presence.
      hasText: Boolean((body as any).text),
      attachmentCount: Array.isArray((body as any).attachments) ? ((body as any).attachments as any[]).length : null,
      mentionCount: Array.isArray((body as any).mentions) ? ((body as any).mentions as any[]).length : null,
    } : null,
  });
}

/**
 * Save group chat message to workspace memory file.
 * File path: ${workspace}/memory/chats/YYYY-MM-DD/${chatId}.md
 */
export async function saveGroupChatMessage(params: {
  workspace: string;
  chatId: string;
  chatName?: string;
  senderId: string;
  messageText: string;
  timestamp?: string;
  logger: RingCentralLogger;
}): Promise<void> {
  const { workspace, chatId, chatName, senderId, messageText, timestamp, logger } = params;

  if (!workspace) {
    logger.debug(`[ringcentral] Cannot save chat message: workspace not configured`);
    return;
  }

  try {
    // Parse timestamp or use current time
    const msgDate = timestamp ? new Date(timestamp) : new Date();
    const dateStr = msgDate.toISOString().split("T")[0]; // YYYY-MM-DD
    const timeStr = msgDate.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Shanghai",
    });

    // Build file path
    const chatDir = path.join(workspace, "memory", "chats", dateStr);
    const safeChatId = sanitizeFilename(chatId);
    const filePath = path.join(chatDir, `${safeChatId}.md`);

    // Ensure directory exists
    await fs.promises.mkdir(chatDir, { recursive: true });

    // Format message entry
    const header = chatName ? `# ${chatName} (${chatId})\n\n` : `# Chat ${chatId}\n\n`;
    const entry = `## ${timeStr} - ${senderId}\n${messageText}\n\n---\n\n`;

    // Check if file exists; if not, write header first
    let content = entry;
    try {
      await fs.promises.access(filePath);
      // File exists, just append
    } catch {
      // File doesn't exist, prepend header
      content = header + entry;
    }

    // Append to file
    await fs.promises.appendFile(filePath, content === entry ? entry : content, "utf-8");

    logger.debug(`[ringcentral] Saved chat message to ${filePath}`);
  } catch (err) {
    logger.error(`[ringcentral] Failed to save chat message: ${String(err)}`);
  }
}

function normalizeUserId(raw?: string | null): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return "";
  return trimmed.toLowerCase();
}

export function isSenderAllowed(
  senderId: string,
  allowFrom: string[],
): boolean {
  if (allowFrom.includes("*")) return true;
  const normalizedSenderId = normalizeUserId(senderId);

  // Exact-match fast path
  if (allowFrom.includes(normalizedSenderId)) return true;

  for (let i = 0; i < allowFrom.length; i++) {
    const normalized = String(allowFrom[i]).trim().toLowerCase();
    if (!normalized) continue;
    if (normalized === normalizedSenderId) return true;

    if (normalized.startsWith("ringcentral:")) {
      if (normalized.slice(12) === normalizedSenderId) return true;
    } else if (normalized.startsWith("rc:")) {
      if (normalized.slice(3) === normalizedSenderId) return true;
    } else if (normalized.startsWith("user:")) {
      if (normalized.slice(5) === normalizedSenderId) return true;
    }
  }

  return false;
}

function findGroupEntry(
  groups: Record<string, { requireMention?: boolean; enabled?: boolean; users?: Array<string | number>; systemPrompt?: string }>,
  groupId: string,
  groupName?: string | null,
) {
  const normalizedName = groupName?.trim().toLowerCase();
  return groups[groupId]
    ?? (groupName ? groups[groupName] : undefined)
    ?? (normalizedName ? groups[normalizedName] : undefined)
    ?? groups["*"];
}

function extractMentionInfo(mentions: RingCentralMention[], botExtensionId?: string | null) {
  const personMentions = mentions.filter((entry) => entry.type === "Person");
  const hasAnyMention = personMentions.length > 0;
  const wasMentioned = botExtensionId
    ? personMentions.some((entry) => entry.id === botExtensionId)
    : false;
  return { hasAnyMention, wasMentioned };
}

function resolveBotDisplayName(params: {
  accountName?: string;
  agentId: string;
  config: OpenClawConfig;
}): string {
  const { accountName, agentId, config } = params;
  if (accountName?.trim()) return accountName.trim();
  const agent = config.agents?.list?.find((a) => a.id === agentId);
  if (agent?.name?.trim()) return agent.name.trim();
  return "OpenClaw";
}

async function processWebSocketEvent(params: {
  event: RingCentralWebhookEvent;
  account: ResolvedRingCentralAccount;
  config: OpenClawConfig;
  runtime: RingCentralRuntimeEnv;
  core: RingCentralCoreRuntime;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  ownerId?: string;
}): Promise<void> {
  const { event, account, config, runtime, core, statusSink, ownerId } = params;

  const eventBody = event.body;
  if (!eventBody) return;

  // Check event type - can be from eventType field or inferred from event path
  const eventType = eventBody.eventType;
  const eventPath = event.event ?? "";
  const isPostEvent = eventPath.includes("/glip/posts") || eventPath.includes("/team-messaging") || eventType === "PostAdded";

  if (!isPostEvent) {
    return;
  }

  statusSink?.({ lastInboundAt: Date.now() });

  await processMessageWithPipeline({
    eventBody,
    account,
    config,
    runtime,
    core,
    statusSink,
    ownerId,
  });
}

async function processMessageWithPipeline(params: {
  eventBody: RingCentralEventBody;
  account: ResolvedRingCentralAccount;
  config: OpenClawConfig;
  runtime: RingCentralRuntimeEnv;
  core: RingCentralCoreRuntime;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  ownerId?: string;
}): Promise<void> {
  const { eventBody, account, config, core, statusSink, ownerId } = params;
  const logger = getLogger(core);
  const mediaMaxMb = account.config.mediaMaxMb ?? 20;

  const chatId = String(eventBody.groupId ?? "");
  if (!chatId) return;

  const senderId = eventBody.creatorId ?? "";

  // Some WS notifications only include post id/groupId without `text`.
  // Fetch the full post content before routing (only for PostAdded events).
  let fullEventBody = eventBody;
  if (!fullEventBody.text && fullEventBody.id && fullEventBody.eventType === "PostAdded") {
    try {
      const mgr = wsManagers.get(account.accountId);
      const platform = mgr?.sdk?.platform();
      if (!platform) {
        logger.warn(`[${account.accountId}] Enrich skipped: sdk/platform not ready (postId=${fullEventBody.id})`);
      } else {
        const r = await platform.get(`/restapi/v1.0/glip/posts/${fullEventBody.id}`);
        const post = await r.json();
        fullEventBody = { ...fullEventBody, ...post };
        logger.debug(`[${account.accountId}] Enriched post ${fullEventBody.id} via REST`);
      }
    } catch (e) {
      logger.warn(`[${account.accountId}] Failed to enrich post ${fullEventBody.id}: ${String(e)}`);
    }
  }

  const messageText = (fullEventBody.text ?? "").trim();
  const attachments = fullEventBody.attachments ?? [];
  const hasMedia = attachments.length > 0;
  const rawBody = messageText || (hasMedia ? "<media:attachment>" : "");
  if (!rawBody) {
    logger.debug(
      `[${account.accountId}] DROP:empty_rawBody (postId=${fullEventBody.id ?? ""} chatId=${chatId} sender=${senderId})`,
    );
    return;
  }

  // Skip bot's own messages to avoid infinite loop
  // Check 1: Skip if this is a message we recently sent
  const messageId = fullEventBody.id ?? "";
  if (messageId && isOwnSentMessage(messageId)) {
    logVerbose(core, `skip own sent message: ${messageId}`);
    return;
  }

  // Check 1b: Inbound dedup — skip if we already processed this messageId
  // Prevents duplicate "thinking" + reply during WS reconnect overlap
  if (messageId) {
    if (inboundDedupCache.get(messageId)) {
      logVerbose(core, `dedup: skip already-processed message: ${messageId}`);
      return;
    }
    inboundDedupCache.set(messageId, true);
  }

  // Check 2: Structural loop guard — filter out bot-generated markers
  // These patterns are name-independent and match structural features only.
  const loopGuardResult = detectLoopGuardMarker(rawBody);
  if (loopGuardResult) {
    logVerbose(core, `loop guard: filtered ${loopGuardResult} (msgId=${messageId} chatId=${chatId} sender=${senderId})`);
    return;
  }

  // Check 3: Silent discard for pure attachment placeholder messages
  if (isPureAttachmentPlaceholder(rawBody)) {
    logVerbose(core, `silent: attachment-placeholder-only (msgId=${messageId} chatId=${chatId} sender=${senderId})`);
    return;
  }

  // In JWT mode (selfOnly), only accept messages from the JWT user themselves
  // This is because the bot uses the JWT user's identity, so we're essentially
  // having a conversation with ourselves (the AI assistant)
  const selfOnly = account.config.selfOnly !== false; // default true
  logger.debug(`[${account.accountId}] Processing message: senderId=${senderId}, ownerId=${ownerId}, selfOnly=${selfOnly}, chatId=${chatId}`);

  if (selfOnly && ownerId) {
    if (senderId !== ownerId) {
      logVerbose(core, `ignore message from non-owner: ${senderId} (selfOnly mode)`);
      return;
    }
  }

  logger.debug(`[${account.accountId}] Message passed selfOnly check`);

  // Fetch chat info to determine type
  let chatType = "Group";
  let chatName: string | undefined;
  let chatInfo: any | undefined;
  try {
    chatInfo = await getCachedChat(account, chatId);
    chatType = chatInfo?.type ?? "Group";
    chatName = chatInfo?.name ?? undefined;

    logger.debug(
      `[${account.accountId}] chatInfo: ${summarizeChatInfo(chatInfo)}`,
    );
  } catch (err) {
    // If we can't fetch chat info, assume it's a group (safer: triggers allowlist check).
    logger.error(`[${account.accountId}] getRingCentralChat failed: ${String(err)}`);
  }

  // Personal, PersonalChat, Direct are all DM types
  const isPersonalChat = chatType === "Personal" || chatType === "PersonalChat";
  const isDirectChat = chatType === "Direct";
  const isGroup = !(isPersonalChat || isDirectChat);

  // Session key should be per conversation id (RingCentral chatId)
  // NOTE: keep peer.kind stable for group vs dm.
  // Session routing
  // - Group/Team: route by conversation id (chatId)
  // - DM/Person: route by the *peer userId* (not chatId)
  //   Reason: some DM payloads/types can collapse to a "personal"/self chat id which would
  //   incorrectly merge multiple DMs into one session.
  const ownerIdNorm = normalizeUserId(ownerId);
  const senderIdNorm = normalizeUserId(senderId);

  // Best-effort: compute the other participant id from chatInfo.members when available.
  // RingCentral DM members usually contains 2 userIds.
  const chatMembers: string[] = Array.isArray((chatInfo as any)?.members)
    ? ((chatInfo as any).members as any[]).map((v) => normalizeUserId(String(v)))
    : [];
  const dmPeerFromMembers = chatMembers.find((id) => id && id !== ownerIdNorm) || "";

  const dmPeerUserId = !isGroup
    ? (dmPeerFromMembers || (senderIdNorm !== ownerIdNorm ? senderIdNorm : ""))
    : "";

  // Map RingCentral chat types to openclaw peerKind:
  // - Personal/Direct -> "direct" (direct message)
  // - Group -> "group" (small group chat, 3-16 people)
  // - Team -> "channel" (named team chat, similar to Slack channel)
  const peerKind: "direct" | "group" | "channel" = isGroup
    ? chatType === "Team"
      ? "channel"
      : "group"
    : "direct";

  const routePeerId = String(isGroup ? chatId : (dmPeerUserId || chatId));
  // NOTE: OpenClaw normalizes peer.kind: (dm|direct)->direct
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "ringcentral",
    accountId: account.accountId,
    peer: {
      kind: peerKind,
      id: routePeerId,
    },
  });

  logger.debug(`[${account.accountId}] Chat type: ${chatType}, isGroup: ${isGroup}`);
  logger.debug(
    `[${account.accountId}] resolvedRoute: channel=ringcentral accountId=${account.accountId} peerKind=${peerKind} peerId=${routePeerId} bindings=${Array.isArray((config as any)?.bindings) ? (config as any).bindings.length : 0} -> agentId=${(route as any)?.agentId ?? "(default)"} matchedBy=${(route as any)?.matchedBy ?? "unknown"}`,
  );

  // In selfOnly mode, only allow "Personal" chat (conversation with yourself)
  if (selfOnly && !isPersonalChat) {
    logVerbose(core, `ignore non-personal chat in selfOnly mode: chatType=${chatType}`);
    return;
  }

  const defaultGroupPolicy = typeof resolveDefaultGroupPolicy === "function"
    ? resolveDefaultGroupPolicy(config)
    : undefined;
  const { groupPolicy, providerMissingFallbackApplied } = resolveAllowlistProviderRuntimeGroupPolicy({
    providerConfigPresent: config.channels?.ringcentral !== undefined,
    groupPolicy: account.config.groupPolicy,
    defaultGroupPolicy,
  });
  warnMissingProviderGroupPolicyFallbackOnce({
    providerMissingFallbackApplied,
    providerKey: "ringcentral",
    accountId: account.accountId,
    blockedLabel: "group/team messages",
    log: (msg) => logger.warn(msg),
  });
  const groups = account.config.groups ?? {};
  const groupsConfigured = Object.keys(groups).length > 0;
  const groupEntry = isGroup ? findGroupEntry(groups, chatId, chatName) : undefined;
  let effectiveWasMentioned: boolean | undefined;

  if (isGroup) {
    logger.debug(`[${account.accountId}] Entering group processing: chatId=${chatId}, groupPolicy=${groupPolicy}, groupEntry=${!!groupEntry}`);
    if (groupPolicy === "disabled") {
      logger.debug(`[${account.accountId}] DROP: groupPolicy=disabled`);
      return;
    }
    if (groupPolicy === "allowlist") {
      if (!groupsConfigured) {
        logger.debug(`[${account.accountId}] DROP: allowlist policy but no groups configured`);
        return;
      }
      if (!groupEntry) {
        logger.debug(`[${account.accountId}] DROP: not in allowlist`);
        return;
      }
    }
    if (groupEntry?.enabled === false) {
      logVerbose(core, `drop group message (chat disabled, chat=${chatId})`);
      return;
    }

    const groupUsers = groupEntry?.users ?? [];
    if (groupUsers.length > 0) {
      const ok = isSenderAllowed(senderId, groupUsers.map((v) => String(v)));
      if (!ok) {
        logVerbose(core, `drop group message (sender not allowed, ${senderId})`);
        return;
      }
    }

    // Save group chat message to workspace for analysis/logging
    // This happens AFTER allowlist check but BEFORE mention check,
    // so we log all messages from monitored groups regardless of AI response
    const workspace = account.config.workspace ?? (config.agents as any)?.defaults?.workspace;
    logger.debug(`[${account.accountId}] Group message logging: workspace=${workspace}, chatId=${chatId}, senderId=${senderId}`);
    if (workspace) {
      void saveGroupChatMessage({
        workspace,
        chatId,
        chatName,
        senderId,
        messageText: rawBody,
        timestamp: eventBody.creationTime,
        logger,
      });
    } else {
      logger.debug(`[${account.accountId}] Skipping chat log: no workspace configured`);
    }

    // Update session metadata for allowed groups only (after allowlist check passes)
    try {
      const storePath = core.channel.session.resolveStorePath(config.session?.store, {
        agentId: route.agentId,
      });

      // If RingCentral chat has no name (often true for Group chats), create a stable label
      // by resolving up to 3 member first names and joining with commas.
      let metaLabel: string;
      if (chatName?.trim()) {
        metaLabel = chatName.trim();
      } else {
        let fallbackParts: string[] = [];
        try {
          const memberIds = Array.isArray(chatInfo?.members) ? chatInfo!.members!.slice(0, 3) : [];
          const memberNames = await Promise.all(
            memberIds.map(async (id: string) => {
              try {
                const u = await getCachedUser(account, id);
                return u?.firstName?.trim() || null;
              } catch {
                return null;
              }
            }),
          );
          fallbackParts = memberNames.filter((x): x is string => !!x);
        } catch {
          // ignore
        }

        metaLabel = fallbackParts.length > 0 ? fallbackParts.join(", ") : `chat:${chatId}`;
      }

      void core.channel.session
        .recordSessionMetaFromInbound({
          storePath,
          sessionKey: route.sessionKey,
          ctx: core.channel.reply.finalizeInboundContext({
            Provider: "ringcentral",
            Surface: "ringcentral",
            From: `ringcentral:group:${chatId}`,
            To: `ringcentral:${chatId}`,
            OriginatingChannel: "ringcentral",
            OriginatingTo: `ringcentral:${chatId}`,
            ChatType: peerKind,
            AccountId: route.accountId,
            SessionKey: route.sessionKey,
            ConversationLabel: metaLabel,
            GroupSpace: metaLabel,
            GroupSubject: metaLabel,
          }),
        })
        .catch((err) => {
          logger.error(`ringcentral: session meta update failed: ${String(err)}`);
        });
    } catch (err) {
      logger.error(`ringcentral: session meta update crashed: ${String(err)}`);
    }
  }

  const dmPolicy = account.config.dm?.policy ?? account.config.dmPolicy ?? "pairing";
  const configAllowFrom = account.config.dm?.allowFrom ?? account.config.allowFrom ?? [];
  const configAllowFromStr = configAllowFrom.map((v) => String(v));
  const shouldComputeAuth = core.channel.commands.shouldComputeCommandAuthorized(rawBody, config);
  const storeAllowFrom =
    !isGroup && (dmPolicy !== "open" || shouldComputeAuth)
      ? await core.channel.pairing.readAllowFromStore("ringcentral").catch(() => [])
      : [];
  const effectiveAllowFrom = [...configAllowFromStr, ...storeAllowFrom];
  const commandAllowFrom = isGroup ? (groupEntry?.users ?? []).map((v: string | number) => String(v)) : effectiveAllowFrom;
  const useAccessGroups = config.commands?.useAccessGroups !== false;
  const senderAllowedForCommands = isSenderAllowed(senderId, commandAllowFrom);
  const commandAuthorized = shouldComputeAuth
    ? core.channel.commands.resolveCommandAuthorizedFromAuthorizers({
      useAccessGroups,
      authorizers: [
        { configured: commandAllowFrom.length > 0, allowed: senderAllowedForCommands },
      ],
    })
    : undefined;

  const hasControlCommand = core.channel.text.hasControlCommand(rawBody, config);

  if (isGroup) {
    const requireMention = groupEntry?.requireMention ?? account.config.requireMention ?? true;
    const mentions = fullEventBody.mentions ?? [];
    const mentionInfo = extractMentionInfo(mentions, account.config.botExtensionId);
    const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
      cfg: config,
      surface: "ringcentral",
    });
    const mentionGate = resolveMentionGatingWithBypass({
      isGroup: true,
      requireMention,
      canDetectMention: Boolean(account.config.botExtensionId),
      wasMentioned: mentionInfo.wasMentioned,
      implicitMention: false,
      hasAnyMention: mentionInfo.hasAnyMention,
      allowTextCommands,
      hasControlCommand,
      commandAuthorized: commandAuthorized === true,
    });
    effectiveWasMentioned = mentionGate.effectiveWasMentioned;

    // Response decision is now delegated to the AI based on SOUL/identity
    // Plugin only handles mention gating; AI decides whether to respond or NO_REPLY

    if (mentionGate.shouldSkip) {
      logVerbose(core, `drop group message (mention required, chat=${chatId})`);
      return;
    }
  }

  // DM policy check
  // - selfOnly=true (default): only Personal chat (self) is allowed (checked above via isPersonalChat)
  // - selfOnly=false: allow DMs based on dmPolicy/allowFrom
  if (!isGroup && !selfOnly) {
    // Non-selfOnly mode: check dmPolicy and allowFrom
    if (dmPolicy === "disabled") {
      logVerbose(core, `ignore DM (dmPolicy=disabled)`);
      return;
    }
    if (dmPolicy === "allowlist" && !isSenderAllowed(senderId, effectiveAllowFrom)) {
      logVerbose(core, `ignore DM from ${senderId} (not in allowFrom)`);
      return;
    }
  }

  if (
    isGroup &&
    core.channel.commands.isControlCommandMessage(rawBody, config) &&
    commandAuthorized !== true
  ) {
    logVerbose(core, `ringcentral: drop control command from ${senderId}`);
    return;
  }

  let mediaPath: string | undefined;
  let mediaType: string | undefined;
  if (attachments.length > 0) {
    const first = attachments[0];
    const attachmentData = await downloadAttachment(first, account, mediaMaxMb, core);
    if (attachmentData) {
      mediaPath = attachmentData.path;
      mediaType = attachmentData.contentType;
    }
  }

  // NOTE: label is set later via conversationLabel (after chatName lookup).
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "RingCentral",
    from: isGroup
      ? (chatName?.trim() ? chatName.trim() : `chat:${chatId}`)
      : `user:${senderId}`,
    timestamp: eventBody.creationTime ? Date.parse(eventBody.creationTime) : undefined,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  const groupSystemPrompt = groupEntry?.systemPrompt?.trim() || undefined;

  // Resolve sender display name (best-effort, cached)
  let senderName: string | undefined;
  try {
    const userInfo = await getCachedUser(account, senderId);
    if (userInfo) {
      const parts = [userInfo.firstName?.trim(), userInfo.lastName?.trim()].filter(Boolean);
      senderName = parts.length > 0 ? parts.join(" ") : undefined;
    }
  } catch { /* ignore */ }

  // Build a better conversation label for sessions/dashboard.
  // - Prefer chatName when available
  // - Fallback to chat:<chatId>
  // NOTE: We intentionally do NOT try to expand members -> display names here yet.
  const conversationLabel = isGroup
    ? (chatName?.trim() ? chatName.trim() : `chat:${chatId}`)
    : `user:${senderId}`;

  // Use openclaw's standard session key format via resolveAgentRoute().
  // Session key format: agent:{agentId}:{channel}:{peerKind}:{peerId}
  // - Group: agent:main:ringcentral:group:{chatId}
  // - Team: agent:main:ringcentral:channel:{chatId}
  // - DM: agent:main:ringcentral:dm:{peerId} (or main session based on dmScope config)
  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: rawBody,
    RawBody: rawBody,
    CommandBody: rawBody,
    // IMPORTANT:
    // OpenClaw derives group metadata from ctx.From / ctx.To for group/channel chats.
    From: isGroup ? `ringcentral:${peerKind}:${chatId}` : `ringcentral:${senderId}`,
    // IMPORTANT: use provider/group-prefixed To for group chats so OpenClaw can infer
    // group delivery context and session type correctly.
    To: isGroup ? `ringcentral:${peerKind}:${chatId}` : `ringcentral:${chatId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: peerKind,
    ConversationLabel: conversationLabel,
    SenderId: senderId,
    SenderName: senderName,
    Timestamp: eventBody.creationTime ? Date.parse(eventBody.creationTime) : undefined,
    WasMentioned: isGroup ? effectiveWasMentioned : undefined,
    CommandAuthorized: commandAuthorized,
    CommandSource: "text" as const,
    Provider: "ringcentral",
    Surface: "ringcentral",
    MessageSid: eventBody.id,
    MessageSidFull: eventBody.id,
    MediaPath: mediaPath,
    MediaType: mediaType,
    MediaUrl: mediaPath,
    GroupSpace: isGroup ? (chatName?.trim() ? chatName.trim() : undefined) : undefined,
    // Some cores/providers prefer GroupSubject for label derivation.
    // Set it to chatName to make label resolution more robust.
    GroupSubject: isGroup ? (chatName?.trim() ? chatName.trim() : undefined) : undefined,
    GroupSystemPrompt: isGroup ? groupSystemPrompt : undefined,
    OriginatingChannel: "ringcentral",
    OriginatingTo: isGroup ? `ringcentral:group:${chatId}` : `ringcentral:${chatId}`,
    OriginatingFrom: isGroup ? `ringcentral:group:${chatId}` : `ringcentral:${senderId}`,
  });

  // DEBUG: log critical routing/meta fields to confirm which ctx values are actually being used.
  logger.debug(
    `[default] inbound-meta: isGroup=${isGroup} chatType=${chatType} chatId=${chatId} senderId=${senderId} chatName=${JSON.stringify(
      chatName ?? null,
    )} sessionKey=${route.sessionKey} ctx.From=${ctxPayload.From} ctx.To=${ctxPayload.To} ConversationLabel=${JSON.stringify(
      conversationLabel,
    )}`,
  );

  void core.channel.session
    .recordSessionMetaFromInbound({
      storePath,
      sessionKey: (ctxPayload.SessionKey as string | undefined) ?? route.sessionKey,
      ctx: ctxPayload,
    })
    .catch((err) => {
      logger.error(`ringcentral: failed updating session meta: ${String(err)}`);
    });

  // Backfill / repair session label for existing sessions.
  // Some sessions may have been created earlier with fallback labels (e.g. `chat:<id>`)
  // before we started passing ConversationLabel / GroupSpace.
  try {
    if (isGroup && chatName?.trim()) {
      const repairedLabel = chatName.trim();
      const fallbackLabel = `chat:${chatId}`;

      // If we only have a fallback label, overwrite it with the real group name.
      // NOTE: recordSessionMetaFromInbound merges meta; this second call ensures the
      // dashboard/session list picks up the newer label even for pre-existing sessions.
      // Treat a few common weak labels as eligible for repair.
      // NOTE: core may append ` id:<chatId>` when it falls back to GroupSpace/From.
      const weakLabelCandidates = new Set([
        fallbackLabel,
        `chat:${chatId} id:${chatId}`,
        `ringcentral:group:${chatId}`,
        `ringcentral:group:${chatId} id:${chatId}`,
        String(chatId),
      ]);

      const currentLabel = (conversationLabel || "").trim();

      if (!currentLabel || weakLabelCandidates.has(currentLabel)) {
        void core.channel.session.recordSessionMetaFromInbound({
          storePath,
          sessionKey: (ctxPayload.SessionKey as string | undefined) ?? route.sessionKey,
          ctx: {
            ...ctxPayload,
            ConversationLabel: repairedLabel,
            GroupSubject: repairedLabel,
            GroupSpace: repairedLabel,
          },
        });
      }
    }
  } catch (err) {
    logger.error(`ringcentral: failed repairing session label: ${String(err)}`);
  }

  // Resolve bot name for thinking indicator
  const botName = resolveBotDisplayName({
    accountName: account.config.name,
    agentId: route.agentId,
    config,
  });

  // Track typing state for cleanup
  let typingPostId: string | undefined;
  let hasDelivered = false;
  let thinkingSent = false; // Guard to prevent multiple thinking messages
  const toolCalls: { name?: string; phase?: string }[] = []; // Track tool calls for progress

  logger.debug(
    `[${account.accountId}] Dispatching: isCommand=${hasControlCommand} authorized=${commandAuthorized} sessionKey=${route.sessionKey}`,
  );

  // Helper to update thinking message with tool progress
  const updateThinkingProgress = async () => {
    if (!typingPostId) return;
    
    // Build progress text
    const lines = [`> 🦞 ${botName} is working...`];
    
    if (toolCalls.length > 0) {
      lines.push(`> `);
      for (const tool of toolCalls) {
        const statusText = tool.phase === "complete" ? "✅ Completed" : "🔄 Running";
        lines.push(`> **${tool.name || "unknown"}** ${statusText}`);
      }
    }
    
    try {
      await updateRingCentralMessage({
        account,
        chatId,
        postId: typingPostId,
        text: lines.join("\n"),
      });
    } catch (err) {
      logger.debug(`[${account.accountId}] Failed to update thinking progress: ${String(err)}`);
    }
  };

  // Extended dispatcher options with typing callbacks (onReplyStart/onIdle)
  // These are supported at runtime but not in the type definitions yet
  const dispatcherOptionsWithTyping = {
    deliver: async (payload: { text?: string; mediaUrls?: string[]; mediaUrl?: string }) => {
      hasDelivered = true;
      await deliverRingCentralReply({
        payload,
        account,
        chatId,
        core,
        config,
        statusSink,
        typingPostId,
      });
      // Clear typingPostId after first delivery (it gets updated/deleted in deliverRingCentralReply)
      typingPostId = undefined;
    },
    onError: (err: unknown, info: { kind: string }) => {
      logger.error(
        `[${account.accountId}] RingCentral ${info.kind} reply failed: ${String(err)}`,
      );
    },
    // Send thinking indicator when model STARTS generating (not before)
    // This prevents sending thinking when model decides NO_REPLY
    // Guard: only send once per reply cycle to avoid duplicate messages on tool calls
    onReplyStart: async () => {
      if (thinkingSent) {
        return; // Already sent thinking message, don't send another
      }
      thinkingSent = true;
      try {
        const thinkingResult = await sendRingCentralMessage({
          account,
          chatId,
          text: `> 🦞 ${botName} is thinking...`,
        });
        typingPostId = thinkingResult?.postId;
        if (typingPostId) trackSentMessageId(typingPostId);
      } catch (err) {
        logger.debug(`[${account.accountId}] Failed to send thinking indicator: ${String(err)}`);
      }
    },
    onIdle: async () => {
      // Cleanup typing indicator if model finished without delivering (e.g., NO_REPLY)
      if (!hasDelivered && typingPostId) {
        try {
          await deleteRingCentralMessage({ account, chatId, postId: typingPostId });
        } catch { /* ignore */ }
        typingPostId = undefined;
      }
    },
  } as Parameters<typeof core.channel.reply.dispatchReplyWithBufferedBlockDispatcher>[0]["dispatcherOptions"];

  // Reply options with tool progress tracking
  const replyOptionsWithToolProgress: Record<string, unknown> = {
    // Track tool calls and update thinking message
    onToolStart: async (payload: { name?: string; phase?: string }) => {
      logger.debug(`[${account.accountId}] onToolStart callback fired: ${JSON.stringify(payload)}`);
      const name = payload.name || "unknown";
      // Check if this tool already exists in the list
      const existingIndex = toolCalls.findIndex(t => t.name === name);
      if (existingIndex >= 0) {
        // Update existing tool (e.g., phase change)
        toolCalls[existingIndex] = { name, phase: payload.phase };
      } else {
        // Add new tool
        toolCalls.push({ name, phase: payload.phase });
      }
      await updateThinkingProgress();
    },
  };

  try {
    // Cast to any to bypass incomplete type definitions
    // replyOptions is supported at runtime with onToolStart callback
    await (core.channel.reply.dispatchReplyWithBufferedBlockDispatcher as any)({
      ctx: ctxPayload,
      cfg: config,
      dispatcherOptions: dispatcherOptionsWithTyping,
      replyOptions: replyOptionsWithToolProgress,
    });
  } catch (err) {
    logger.error(`[${account.accountId}] Command/reply dispatch failed: ${String(err)}`);
    if (typingPostId) {
      try { await deleteRingCentralMessage({ account, chatId, postId: typingPostId }); } catch { /* ignore */ }
    }
  }
}

async function downloadAttachment(
  attachment: RingCentralAttachment,
  account: ResolvedRingCentralAccount,
  mediaMaxMb: number,
  core: RingCentralCoreRuntime,
): Promise<{ path: string; contentType?: string } | null> {
  const contentUri = attachment.contentUri;
  if (!contentUri) return null;
  const maxBytes = Math.max(1, mediaMaxMb) * 1024 * 1024;
  const downloaded = await downloadRingCentralAttachment({ account, contentUri, maxBytes });

  const safeFilename = attachment.name ? sanitizeAttachmentFilename(attachment.name) : undefined;

  const saved = await core.channel.media.saveMediaBuffer(
    downloaded.buffer,
    downloaded.contentType ?? attachment.contentType,
    "inbound",
    maxBytes,
    safeFilename,
  );
  return { path: saved.path, contentType: saved.contentType };
}

async function deliverRingCentralReply(params: {
  payload: { text?: string; mediaUrls?: string[]; mediaUrl?: string };
  account: ResolvedRingCentralAccount;
  chatId: string;
  core: RingCentralCoreRuntime;
  config: OpenClawConfig;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  typingPostId?: string;
}): Promise<void> {
  const { payload, account, chatId, core, config, statusSink, typingPostId } = params;
  const logger = getLogger(core);
  const mediaList = payload.mediaUrls?.length
    ? payload.mediaUrls
    : payload.mediaUrl
      ? [payload.mediaUrl]
      : [];

  if (mediaList.length > 0) {
    let suppressCaption = false;
    if (typingPostId) {
      try {
        await deleteRingCentralMessage({
          account,
          chatId,
          postId: typingPostId,
        });
      } catch (err) {
        const errInfo = formatRcApiError(extractRcApiError(err, account.accountId));
        logger.error(`RingCentral typing cleanup failed: ${errInfo}`);
        const fallbackText = payload.text?.trim()
          ? payload.text
          : mediaList.length > 1
            ? "Sent attachments."
            : "Sent attachment.";
        try {
          await updateRingCentralMessage({
            account,
            chatId,
            postId: typingPostId,
            text: fallbackText,
          });
          suppressCaption = Boolean(payload.text?.trim());
        } catch (updateErr) {
          const updateErrInfo = formatRcApiError(extractRcApiError(updateErr, account.accountId));
          logger.error(`RingCentral typing update failed: ${updateErrInfo}`);
        }
      }
    }
    let first = true;
    for (const mediaUrl of mediaList) {
      const caption = first && !suppressCaption ? payload.text : undefined;
      first = false;
      try {
        const loaded = await core.channel.media.fetchRemoteMedia(mediaUrl, {
          maxBytes: (account.config.mediaMaxMb ?? 20) * 1024 * 1024,
        });
        const upload = await uploadRingCentralAttachment({
          account,
          chatId,
          filename: loaded.filename ?? "attachment",
          buffer: loaded.buffer,
          contentType: loaded.contentType,
        });
        if (!upload.attachmentId) {
          throw new Error("missing attachment id");
        }
        const sendResult = await sendRingCentralMessage({
          account,
          chatId,
          text: caption,
          attachments: [{ id: upload.attachmentId }],
        });
        if (sendResult?.postId) trackSentMessageId(sendResult.postId);
        statusSink?.({ lastOutboundAt: Date.now() });
      } catch (err) {
        const errInfo = formatRcApiError(extractRcApiError(err, account.accountId));
        logger.error(`RingCentral attachment send failed: ${errInfo}`);
      }
    }
    return;
  }

  if (payload.text) {
    // Delete thinking message before sending final reply
    if (typingPostId) {
      try {
        await deleteRingCentralMessage({
          account,
          chatId,
          postId: typingPostId,
        });
        logger.debug(`[${account.accountId}] Deleted thinking message before final reply`);
      } catch (err) {
        logger.debug(`[${account.accountId}] Failed to delete thinking message: ${String(err)}`);
      }
    }
    
    const chunkLimit = account.config.textChunkLimit ?? 4000;
    const chunkMode = core.channel.text.resolveChunkMode(
      config,
      "ringcentral",
      account.accountId,
    );
    const chunks = core.channel.text.chunkMarkdownTextWithMode(
      payload.text,
      chunkLimit,
      chunkMode,
    );
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        const sendResult = await sendRingCentralMessage({
          account,
          chatId,
          text: chunk,
        });
        if (sendResult?.postId) trackSentMessageId(sendResult.postId);
        statusSink?.({ lastOutboundAt: Date.now() });
      } catch (err) {
        const errInfo = formatRcApiError(extractRcApiError(err, account.accountId));
        logger.error(`RingCentral message send failed: ${errInfo}`);
        logger.error(
          `[${account.accountId}] RC_POST_SEND_FAIL chatId=${chatId} chunkIndex=${i} err=${errInfo}`,
        );
      }
    }
  }
}

export async function startRingCentralMonitor(
  options: RingCentralMonitorOptions,
): Promise<() => void> {
  const { account, config, runtime, abortSignal, statusSink } = options;
  const core = getRingCentralRuntime();
  const logger = createLogger(core);

  let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  let isShuttingDown = false;
  let ownerId: string | undefined;

  // Observability state
  let lastInboundAt = 0;
  let totalRecovers = 0;
  let lastHealthCheckWallClock = Date.now();

  // ── Step 1: Resolve ownerId before subscribing ──
  // Prefer local config (no network) to avoid rate limiting.
  const allowFrom =
    (account.config.dm?.allowFrom ?? account.config.allowFrom ?? []).map((v) => String(v));
  const allowFromFirst = allowFrom[0]?.trim();
  if (allowFromFirst) {
    ownerId = allowFromFirst;
    logger.debug(`[${account.accountId}] ownerId set from config allowFrom[0]: ${ownerId}`);
  }

  // ── Step 2: Create WS manager + connect + subscribe (once) ──
  logger.info(`[${account.accountId}] Starting RingCentral WebSocket subscription...`);

  let mgr: WsManager;
  try {
    mgr = await getOrCreateWsManager(account, logger);
  } catch (err) {
    const errStr = String(err);
    if (errStr.includes("Invalid client application")) {
      const masked = account.clientId
        ? `${account.clientId.slice(0, 4)}...${account.clientId.slice(-4)}`
        : "(empty)";
      throw new Error(
        `RingCentral clientId ${masked} is not a valid application. ` +
        `Please verify your app at https://developers.ringcentral.com → Apps → check Client ID/Secret. ` +
        `Original: ${errStr}`,
      );
    }
    throw err;
  }

  // Guard: if this WsManager already has an active subscription, skip creating new one
  // but return a proper cleanup function that manages the abort signal.
  // The framework's auto-restart may call startRingCentralMonitor multiple times;
  // we must not create duplicate subscriptions on the same wsExt.
  if (mgr.subscribed) {
    logger.info(`[${account.accountId}] WS subscription already active, returning existing cleanup`);
    // Return a cleanup that only handles the abort signal, not the WS lifecycle
    // The original cleanup owns the WS lifecycle
    return () => {
      isShuttingDown = true;
      if (healthCheckTimer) {
        clearInterval(healthCheckTimer);
        healthCheckTimer = null;
      }
      stopChatCacheSync();
      // Note: We don't call wsManagers.delete or mgr.wsExt.revoke() here
      // because this is a duplicate start - the original cleanup owns the lifecycle
    };
  }
  await ensureWsConnected(mgr, account, logger);

  // Resolve ownerId from REST if not configured
  if (!ownerId) {
    try {
      const platform = mgr.sdk.platform();
      const response = await platform.get("/restapi/v1.0/account/~/extension/~");
      const userInfo = await response.json();
      ownerId = userInfo?.id?.toString();
      logger.info(`[${account.accountId}] Authenticated as extension (REST): ${ownerId}`);
    } catch (err) {
      logger.error(
        `[${account.accountId}] Failed to get current user (REST, best-effort): ${String(err)}. ` +
        `Continuing without ownerId; self-message filtering may be degraded temporarily.`,
      );
    }
  }

  // Event handler — registered once; autoRecover reuses the subscription object
  const handleNotification = (event: unknown) => {
    logger.debug(`WebSocket notification received: ${summarizeEvent(event)}`);
    lastInboundAt = Date.now();
    const evt = event as RingCentralWebhookEvent;
    processWebSocketEvent({
      event: evt,
      account,
      config,
      runtime,
      core,
      statusSink,
      ownerId,
    }).catch((err) => {
      logger.error(`[${account.accountId}] WebSocket event processing failed: ${String(err)}`);
    });
  };

  const eventFilters = [
    "/restapi/v1.0/glip/posts",
    "/restapi/v1.0/glip/groups",
  ];

  // Subscribe once — autoRecover will restore the subscription on reconnect
  try {
    await mgr.wsExt.subscribe(eventFilters, handleNotification);
  } catch (err) {
    const errStr = String(err);
    const isSub528 = errStr.includes("SUB-528") || errStr.includes("SubscriptionWebSocket");
    if (isSub528) {
      // Fatal: missing WebSocket Subscriptions permission — retrying won't help
      clearRingCentralWsManager(account.accountId);
      throw new Error(
        `[FATAL] RingCentral app is missing the "WebSocket Subscriptions" permission. ` +
        `Go to https://developers.ringcentral.com → your app → Settings → "App Permissions" ` +
        `and enable "WebSocket Subscriptions", then restart the gateway. ` +
        `No retries will be attempted for this error.`,
      );
    }
    // Non-fatal subscribe errors: clean up WsManager to avoid leaked listeners
    clearRingCentralWsManager(account.accountId);
    throw err;
  }
  mgr.subscribed = true;

  logger.info(
    `[${account.accountId}] RingCentral WebSocket subscription established` +
    ` | autoRecover=enabled`,
  );

  // ── Step 3: Listen to autoRecover lifecycle events for observability ──
  mgr.wsExt.eventEmitter.on("autoRecoverSuccess" as string, () => {
    totalRecovers++;
    logger.info(
      `[${account.accountId}] WS session recovered successfully` +
      ` | totalRecovers=${totalRecovers}`,
    );
  });

  mgr.wsExt.eventEmitter.on("autoRecoverFailed" as string, () => {
    totalRecovers++;
    logger.warn(
      `[${account.accountId}] WS session recovery failed; SDK re-subscribed automatically` +
      ` | totalRecovers=${totalRecovers}`,
    );
  });

  mgr.wsExt.eventEmitter.on("autoRecoverError" as string, (err: unknown) => {
    const errStr = String(err);
    // Detect fatal errors that should stop retrying
    const isMissingWsPerm = errStr.includes("SUB-528") || errStr.includes("SubscriptionWebSocket");
    const isAuthError = errStr.includes("401") || errStr.includes("Unauthorized") || errStr.includes("invalid_grant");

    if (isMissingWsPerm) {
      logger.error(
        `[${account.accountId}] RingCentral app is missing the "WebSocket Subscriptions" permission. ` +
        `Go to https://developers.ringcentral.com → your app → Settings → "App Permissions" and enable "WebSocket Subscriptions", ` +
        `then re-authorize. No WebSocket push will be received until this is fixed.`,
      );
    } else if (isAuthError) {
      logger.error(`[${account.accountId}] Authentication failed during auto-recover. Please check your credentials.`);
    } else {
      logger.error(`[${account.accountId}] WS auto-recover error: ${errStr}`);
    }
  });

  // Log when a new WS object is created (reconnection happened)
  mgr.wsExt.eventEmitter.on("newWebSocketObject" as string, () => {
    logger.debug(`[${account.accountId}] New WebSocket connection established (auto-recover)`);
  });

  // Start chat cache sync
  const workspace = account.config.workspace ?? (config.agents as any)?.defaults?.workspace;
  await startChatCacheSync({
    account,
    workspace: workspace as string | undefined,
    logger,
    abortSignal,
  });

  // ─── Health check watchdog ───
  // Supplements autoRecover's pingServer by detecting:
  // 1. System sleep/wake (timer drift)
  // 2. WS readyState not OPEN (autoRecover may already be handling this)
  // On detection, triggers recover() which autoRecover may already be doing.
  lastHealthCheckWallClock = Date.now();
  healthCheckTimer = setInterval(() => {
    if (isShuttingDown || abortSignal.aborted) return;

    const now = Date.now();
    const elapsed = now - lastHealthCheckWallClock;
    lastHealthCheckWallClock = now;

    // Detect sleep/wake: if elapsed >> interval, the system likely slept.
    // Kick autoRecover immediately instead of waiting for pingServer timeout.
    if (elapsed > HEALTH_CHECK_INTERVAL_MS + SLEEP_DRIFT_THRESHOLD_MS) {
      logger.warn(
        `[${account.accountId}] System wake detected (timer drift ${Math.round(elapsed / 1000)}s). Triggering recover...`,
      );
      mgr.wsExt.recover().catch((e: unknown) => {
        logger.error(`[${account.accountId}] recover() after wake failed: ${String(e)}`);
      });
      return;
    }

    // Check WS readyState — if closed/closing, kick recover
    const ws = mgr.wsExt.ws;
    if (ws && ws.readyState !== 0 && ws.readyState !== 1) {
      logger.warn(
        `[${account.accountId}] WebSocket readyState=${ws.readyState} (not OPEN). Triggering recover...`,
      );
      mgr.wsExt.recover().catch((e: unknown) => {
        logger.error(`[${account.accountId}] recover() for closed WS failed: ${String(e)}`);
      });
    }
  }, HEALTH_CHECK_INTERVAL_MS);

  // Handle abort signal
  const cleanup = () => {
    isShuttingDown = true;
    logger.info(
      `[${account.accountId}] Stopping RingCentral WebSocket subscription...` +
      ` | totalRecovers=${totalRecovers}` +
      ` | lastInboundAt=${lastInboundAt ? new Date(lastInboundAt).toISOString() : "never"}`,
    );

    stopChatCacheSync();

    if (healthCheckTimer) {
      clearInterval(healthCheckTimer);
      healthCheckTimer = null;
    }

    // Revoke subscription + close WS + stop autoRecover interval
    mgr.subscribed = false;
    mgr.wsExt.revoke().catch((err: unknown) => {
      logger.error(`[${account.accountId}] Failed to revoke WS extension: ${String(err)}`);
    });
    wsManagers.delete(account.accountId);
  };

  if (abortSignal.aborted) {
    cleanup();
  } else {
    abortSignal.addEventListener("abort", cleanup, { once: true });
  }

  return cleanup;
}

/**
 * Clear cached WebSocket manager for a specific account.
 * This should be called when logging out an account to ensure
 * fresh connections are created on next login.
 *
 * @param accountId - The account ID to clear from cache
 * @returns true if a cached manager was found and removed, false otherwise
 */
export function clearRingCentralWsManager(accountId: string): boolean {
  const manager = wsManagers.get(accountId);
  if (!manager) {
    return false;
  }

  // Attempt to close the WebSocket connection gracefully
  try {
    const ws = manager.wsExt?.ws;
    if (ws && typeof ws.close === "function") {
      ws.close();
    }
  } catch {
    // Ignore errors during cleanup
  }

  // Remove from cache
  wsManagers.delete(accountId);
  return true;
}

/**
 * Clear all cached WebSocket managers.
 * Useful for complete cleanup during shutdown.
 */
export function clearAllRingCentralWsManagers(): void {
  for (const [accountId] of wsManagers) {
    clearRingCentralWsManager(accountId);
  }
}
