// WebSocket monitor for RingCentral Team Messaging.

import type { RingCentralClient } from "./client.js";
import { ANSWER_START } from "./shared.js";
import type { Post, WSEvent } from "./types.js";

export interface MonitorOptions {
  client: RingCentralClient;
  ownCreatorId?: string;
  filterOwnCreator?: boolean;
  ignoredTexts?: readonly string[];
  onMessage: (post: Post) => void;
  onConnected?: () => void;
  onDisconnected?: (error?: Error) => void;
  onDiagnostic?: (event: string, details?: Record<string, boolean | number | string>) => void;
  abortSignal: AbortSignal;
  log?: (...args: unknown[]) => void;
}

const BACKOFF_BASE = 3000;
const BACKOFF_MAX = 60000;
const PING_INTERVAL = 30000;
const PONG_TIMEOUT = 60000;
const OWN_POST_TTL_MS = 300_000;

export type InboundDropReason = "own-id" | "own-text" | "own-creator" | "answer-wrapper" | "ignored-text";

export class RingCentralWebSocketMonitor {
  private readonly sentPosts = new Map<string, number>();
  private readonly sentTexts = new Map<string, number>();
  private failures = 0;

  constructor(private readonly opts: MonitorOptions) {}

  markOwnPost(postId: string | number | undefined | null): void {
    const id = coerceId(postId);
    if (id) {
      this.sentPosts.set(id, Date.now());
    }
  }

  // Record the exact outbound body before the REST send resolves. Glip often
  // pushes PostAdded on the WebSocket first, so id-only filtering races.
  markOwnText(groupId: string | number | undefined | null, text: string | undefined | null): void {
    const key = ownTextKey(groupId, text);
    if (key) {
      this.sentTexts.set(key, Date.now());
    }
  }

  async start(): Promise<void> {
    const { abortSignal, log = console.log } = this.opts;
    while (!abortSignal.aborted) {
      try {
        await this.connectAndListen(log);
        this.failures = 0;
      } catch (err) {
        if (abortSignal.aborted) {
          break;
        }
        this.failures++;
        const backoff = Math.min(BACKOFF_BASE * (1 << Math.min(this.failures - 1, 4)), BACKOFF_MAX);
        log(`[rc-monitor] disconnected (failures=${this.failures}), retrying in ${backoff}ms`, err);
        this.opts.onDisconnected?.(err instanceof Error ? err : new Error(String(err)));
        await sleep(backoff, abortSignal);
      }
    }
  }

  private async connectAndListen(log: (...args: unknown[]) => void): Promise<void> {
    const { client, onConnected, onDiagnostic, abortSignal } = this.opts;
    const wsToken = await client.createWebSocketToken();
    const ws = new WebSocket(buildWebSocketUrl(wsToken));
    let pongTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let connected = false;

    const cleanup = () => {
      clearInterval(pingTimer);
      clearTimeout(pongTimer);
      try {
        ws.close();
      } catch {
        // ignore close races
      }
    };
    const onAbort = () => {
      cleanup();
    };
    abortSignal.addEventListener("abort", onAbort, { once: true });

    return new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => {
        log("[rc-monitor] WebSocket connected");
        onDiagnostic?.("ws_open");
      });

      ws.addEventListener("message", (event) => {
        const data = typeof event.data === "string" ? event.data : "";
        if (!data) {
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          return;
        }

        if (isConnectionDetails(parsed)) {
          onDiagnostic?.("ws_connection_details", { status: readFrameStatus(parsed) ?? 0 });
          ws.send(
            JSON.stringify([
              {
                type: "ClientRequest",
                messageId: createMessageId(),
                method: "POST",
                path: "/restapi/v1.0/subscription/",
              },
              {
                eventFilters: ["/team-messaging/v1/posts"],
                deliveryMode: { transportType: "WebSocket" },
              },
            ]),
          );
          onDiagnostic?.("ws_subscription_request_sent");
          return;
        }

        if (isSubscriptionConfirmation(parsed) && !connected) {
          connected = true;
          onDiagnostic?.("ws_subscription_confirmed", { status: readFrameStatus(parsed) ?? 0 });
          onConnected?.();
          pingTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify([{ type: "Heartbeat" }]));
              resetPongTimer();
            }
          }, PING_INTERVAL);
          return;
        }

        const rejectedStatus = readRejectedClientRequestStatus(parsed);
        if (rejectedStatus !== undefined) {
          onDiagnostic?.("ws_subscription_rejected", { status: rejectedStatus });
          cleanup();
          reject(new Error(`WebSocket subscription failed: status=${rejectedStatus}`));
          return;
        }

        if (isHeartbeatResponse(parsed)) {
          clearTimeout(pongTimer);
          onDiagnostic?.("ws_heartbeat_response");
          return;
        }

        const post = extractPostFromWsFrame(parsed);
        if (post) {
          onDiagnostic?.("ws_post_received");
          this.handlePost(post, log);
        }
      });

      ws.addEventListener("close", (event) => {
        cleanup();
        abortSignal.removeEventListener("abort", onAbort);
        onDiagnostic?.("ws_close", { code: event.code });
        if (abortSignal.aborted) {
          resolve();
        } else {
          reject(new Error(`WebSocket closed: code=${event.code} reason=${event.reason}`));
        }
      });

      ws.addEventListener("error", () => {
        cleanup();
        abortSignal.removeEventListener("abort", onAbort);
        onDiagnostic?.("ws_error");
        reject(new Error("WebSocket error"));
      });

      function resetPongTimer() {
        clearTimeout(pongTimer);
        pongTimer = setTimeout(() => {
          log("[rc-monitor] pong timeout, closing");
          cleanup();
        }, PONG_TIMEOUT);
      }
    });
  }

  private handlePost(post: Post, log: (...args: unknown[]) => void): void {
    pruneSentPosts(this.sentPosts);
    pruneSentPosts(this.sentTexts);
    const dropReason = inboundDropReason(post, {
      sentPosts: this.sentPosts,
      sentTexts: this.sentTexts,
      ownCreatorId: this.opts.ownCreatorId,
      filterOwnCreator: this.opts.filterOwnCreator,
      ignoredTexts: this.opts.ignoredTexts,
    });
    if (dropReason) {
      if (dropReason === "own-id" || dropReason === "own-text") {
        log(
          `[rc-monitor] dropped own echo (${dropReason}) chatId=${post.groupId} creatorId=${post.creatorId} postId=${post.id}`,
        );
      }
      return;
    }
    log(`[rc-monitor] received post chatId=${post.groupId} creatorId=${post.creatorId}`);
    this.opts.onMessage(post);
  }
}

export function buildWebSocketUrl(wsToken: { uri: string; ws_access_token?: string }): string {
  if (!wsToken.ws_access_token) {
    return wsToken.uri;
  }
  const url = new URL(wsToken.uri);
  if (!url.searchParams.has("access_token")) {
    url.searchParams.set("access_token", wsToken.ws_access_token);
  }
  return url.toString();
}

export async function startMonitor(opts: MonitorOptions): Promise<void> {
  await new RingCentralWebSocketMonitor(opts).start();
}

export function extractPostFromWsFrame(frame: unknown): Post | null {
  const event = Array.isArray(frame) ? frame[1] : frame;
  if (!event || typeof event !== "object") {
    return null;
  }
  const record = event as Partial<WSEvent> & Record<string, unknown>;
  const post = record.body;
  if (!post || typeof post !== "object") {
    return null;
  }
  const candidate = post as Post;
  if (!isPostAddedEvent(record, candidate)) {
    return null;
  }
  if (candidate.type && candidate.type !== "TextMessage") {
    return null;
  }
  if (typeof candidate.text !== "string") {
    return null;
  }
  const id = coerceId(candidate.id);
  const groupId = coerceId(candidate.groupId);
  if (!id || !groupId) {
    return null;
  }
  return coercePostIds(candidate);
}

export function shouldProcessPost(
  post: Post,
  params: {
    sentPosts?: Map<string, number>;
    sentTexts?: Map<string, number>;
    ownCreatorId?: string;
    filterOwnCreator?: boolean;
    ignoredTexts?: readonly string[];
  } = {},
): boolean {
  return inboundDropReason(post, params) === null;
}

export function inboundDropReason(
  post: Post,
  params: {
    sentPosts?: Map<string, number>;
    sentTexts?: Map<string, number>;
    ownCreatorId?: string;
    filterOwnCreator?: boolean;
    ignoredTexts?: readonly string[];
  } = {},
): InboundDropReason | null {
  const postId = coerceId(post.id);
  if (postId && params.sentPosts?.has(postId)) {
    return "own-id";
  }
  const textKey = ownTextKey(post.groupId, post.text);
  if (textKey && params.sentTexts?.has(textKey)) {
    return "own-text";
  }
  if (
    params.filterOwnCreator !== false &&
    params.ownCreatorId &&
    coerceId(post.creatorId) === coerceId(params.ownCreatorId)
  ) {
    return "own-creator";
  }
  const text = post.text ?? "";
  if (text.startsWith(ANSWER_START)) {
    return "answer-wrapper";
  }
  if ((params.ignoredTexts ?? []).includes(text)) {
    return "ignored-text";
  }
  return null;
}

export function markSentPost(sentPosts: Map<string, number>, postId: string | number): void {
  const id = coerceId(postId);
  if (id) {
    sentPosts.set(id, Date.now());
  }
}

export function markOwnText(
  sentTexts: Map<string, number>,
  groupId: string | number | undefined | null,
  text: string | undefined | null,
): void {
  const key = ownTextKey(groupId, text);
  if (key) {
    sentTexts.set(key, Date.now());
  }
}

function pruneSentPosts(sentPosts: Map<string, number>): void {
  const now = Date.now();
  for (const [id, ts] of sentPosts) {
    if (now - ts > OWN_POST_TTL_MS) {
      sentPosts.delete(id);
    }
  }
}

function ownTextKey(
  groupId: string | number | undefined | null,
  text: string | undefined | null,
): string | null {
  const chatId = coerceId(groupId);
  if (!chatId || typeof text !== "string" || !text) {
    return null;
  }
  return `${chatId}\0${text}`;
}

function coerceId(value: string | number | undefined | null): string | null {
  if (value == null) {
    return null;
  }
  const id = String(value).trim();
  return id ? id : null;
}

function coercePostIds(post: Post): Post {
  return {
    ...post,
    id: coerceId(post.id) ?? String(post.id),
    groupId: coerceId(post.groupId) ?? String(post.groupId),
    creatorId: coerceId(post.creatorId) ?? "",
    parentPostId: coerceId(post.parentPostId) ?? undefined,
    threadId: coerceId(post.threadId) ?? undefined,
  };
}

export function isConnectionDetails(value: unknown): boolean {
  const header = readFrameHeader(value);
  return !!header && "wsc" in header;
}

export function isSubscriptionConfirmation(value: unknown): boolean {
  const header = readFrameHeader(value);
  const body = readFrameBody(value);
  return (
    (header?.type === "ClientRequest" && header.status === 200) ||
    (!Array.isArray(value) && header?.status === 200) ||
    body?.status === 200 ||
    (typeof body?.id === "string" && typeof body.uuid === "string")
  );
}

function isHeartbeatResponse(value: unknown): boolean {
  const header = readFrameHeader(value);
  return header?.type === "HeartbeatResponse";
}

function readFrameHeader(value: unknown): Record<string, unknown> | null {
  const header = Array.isArray(value) ? value[0] : value;
  return header && typeof header === "object" ? (header as Record<string, unknown>) : null;
}

function readFrameBody(value: unknown): Record<string, unknown> | null {
  const body = Array.isArray(value) ? value[1] : value;
  return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
}

function readFrameStatus(value: unknown): number | undefined {
  const status = readFrameHeader(value)?.status ?? readFrameBody(value)?.status;
  return typeof status === "number" ? status : undefined;
}

function readRejectedClientRequestStatus(value: unknown): number | undefined {
  const header = readFrameHeader(value);
  const status = typeof header?.status === "number" ? header.status : undefined;
  if (header?.type !== "ClientRequest" || status === undefined || status < 400) {
    return undefined;
  }
  return status;
}

function isPostAddedEvent(record: Record<string, unknown>, post: Partial<Post>): boolean {
  if (post.eventType === "PostAdded") {
    return true;
  }
  return typeof record.event === "string" && record.event.includes("PostAdded");
}

function createMessageId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `rc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
