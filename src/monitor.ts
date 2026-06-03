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

export class RingCentralWebSocketMonitor {
  private readonly sentPosts = new Map<string, number>();
  private failures = 0;

  constructor(private readonly opts: MonitorOptions) {}

  markOwnPost(postId: string | undefined | null): void {
    if (postId) {
      this.sentPosts.set(postId, Date.now());
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
    if (!shouldProcessPost(post, {
      sentPosts: this.sentPosts,
      ownCreatorId: this.opts.ownCreatorId,
      filterOwnCreator: this.opts.filterOwnCreator,
      ignoredTexts: this.opts.ignoredTexts,
    })) {
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
  if (typeof record.event !== "string" || !record.event.includes("PostAdded")) {
    return null;
  }
  const post = record.body;
  if (!post || typeof post !== "object") {
    return null;
  }
  const candidate = post as Post;
  return candidate.type === "TextMessage" ? candidate : null;
}

export function shouldProcessPost(
  post: Post,
  params: {
    sentPosts?: Map<string, number>;
    ownCreatorId?: string;
    filterOwnCreator?: boolean;
    ignoredTexts?: readonly string[];
  } = {},
): boolean {
  if (params.sentPosts?.has(post.id)) {
    return false;
  }
  if (params.filterOwnCreator !== false && params.ownCreatorId && post.creatorId === params.ownCreatorId) {
    return false;
  }
  const text = post.text ?? "";
  if (text.startsWith(ANSWER_START)) {
    return false;
  }
  return !(params.ignoredTexts ?? []).includes(text);
}

export function markSentPost(sentPosts: Map<string, number>, postId: string): void {
  sentPosts.set(postId, Date.now());
}

function pruneSentPosts(sentPosts: Map<string, number>): void {
  const now = Date.now();
  for (const [id, ts] of sentPosts) {
    if (now - ts > OWN_POST_TTL_MS) {
      sentPosts.delete(id);
    }
  }
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
