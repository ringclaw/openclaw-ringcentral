// WebSocket monitor for RingCentral Team Messaging.
// Inspired by RingClaw monitor.go — simple WS connection with basic filtering.
// All policy/pipeline logic is delegated to the OpenClaw SDK.

import { getBotWSToken } from "./auth.js";
import { ANSWER_START, THINKING_TEXT } from "./shared.js";
import type { Post, WSConnectionDetails, WSEvent } from "./types.js";

export interface MonitorOptions {
  serverUrl: string;
  botToken: string;
  botExtensionId?: string;
  onMessage: (post: Post) => void;
  onConnected?: () => void;
  onDisconnected?: (error?: Error) => void;
  abortSignal: AbortSignal;
  log?: (...args: unknown[]) => void;
}

const BACKOFF_BASE = 3000;
const BACKOFF_MAX = 60000;
const PING_INTERVAL = 30000;
const PONG_TIMEOUT = 60000;

export async function startMonitor(opts: MonitorOptions): Promise<void> {
  const { serverUrl, botToken, abortSignal, log = console.log } = opts;
  const sentPosts = new Map<string, number>();
  let failures = 0;

  while (!abortSignal.aborted) {
    try {
      await connectAndListen(opts, sentPosts, log);
      failures = 0;
    } catch (err) {
      if (abortSignal.aborted) break;
      failures++;
      const backoff = Math.min(BACKOFF_BASE * (1 << Math.min(failures - 1, 4)), BACKOFF_MAX);
      log(`[rc-monitor] disconnected (failures=${failures}), retrying in ${backoff}ms`, err);
      opts.onDisconnected?.(err instanceof Error ? err : new Error(String(err)));
      await sleep(backoff, abortSignal);
    }
  }
}

async function connectAndListen(
  opts: MonitorOptions,
  sentPosts: Map<string, number>,
  log: (...args: unknown[]) => void,
): Promise<void> {
  const { serverUrl, botToken, botExtensionId, onMessage, onConnected, abortSignal } = opts;

  const wsToken = await getBotWSToken(serverUrl, botToken);
  const ws = new WebSocket(wsToken.uri);

  let pongTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let connectionDetails: WSConnectionDetails | undefined;

  const cleanup = () => {
    clearInterval(pingTimer);
    clearTimeout(pongTimer);
    try { ws.close(); } catch { /* ignore */ }
  };

  const onAbort = () => { cleanup(); };
  abortSignal.addEventListener("abort", onAbort, { once: true });

  return new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => {
      log("[rc-monitor] WebSocket connected");
    });

    ws.addEventListener("message", (event) => {
      const data = typeof event.data === "string" ? event.data : "";
      if (!data) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }

      // Handle array format: [header, body]
      if (Array.isArray(parsed)) {
        handleWSMessage(parsed, opts, sentPosts, botExtensionId, log);
        return;
      }

      const msg = parsed as Record<string, unknown>;

      // Connection details
      if (msg.wsc) {
        connectionDetails = msg as unknown as WSConnectionDetails;
        // Subscribe to post events
        const subMsg = JSON.stringify([
          {
            type: "ClientRequest",
            method: "POST",
            path: "/restapi/v1.0/subscription",
            body: {
              eventFilters: ["/team-messaging/v1/posts"],
              deliveryMode: { transportType: "WebSocket" },
            },
          },
        ]);
        ws.send(subMsg);
        return;
      }

      // Subscription confirmation
      if (msg.status === 200 || (typeof msg.id === "string" && (msg as Record<string, unknown>).uuid)) {
        onConnected?.();
        // Start ping/pong
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify([{ type: "Heartbeat" }]));
            resetPongTimer();
          }
        }, PING_INTERVAL);
        return;
      }

      // Heartbeat response
      if (msg.type === "HeartbeatResponse" || (Array.isArray(parsed) && (parsed as unknown[])[0] && typeof (parsed as unknown[])[0] === "object" && ((parsed as unknown[])[0] as Record<string, unknown>).type === "HeartbeatResponse")) {
        clearTimeout(pongTimer);
        return;
      }
    });

    ws.addEventListener("close", (event) => {
      cleanup();
      abortSignal.removeEventListener("abort", onAbort);
      if (abortSignal.aborted) {
        resolve();
      } else {
        reject(new Error(`WebSocket closed: code=${event.code} reason=${event.reason}`));
      }
    });

    ws.addEventListener("error", (event) => {
      cleanup();
      abortSignal.removeEventListener("abort", onAbort);
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

export function handleWSMessage(
  arr: unknown[],
  opts: MonitorOptions,
  sentPosts: Map<string, number>,
  botExtensionId: string | undefined,
  log: (...args: unknown[]) => void,
): void {
  if (arr.length < 2) return;
  const header = arr[0] as Record<string, unknown>;
  const body = arr[1] as WSEvent;

  if (!body?.event?.includes("PostAdded")) return;
  const post = body.body;
  if (!post || post.type !== "TextMessage") return;

  // Skip own sent posts
  if (sentPosts.has(post.id)) return;

  // Skip bot's own messages by extension ID
  if (botExtensionId && post.creatorId === botExtensionId) return;

  // Skip answer-wrapped messages and thinking placeholders
  const text = post.text ?? "";
  if (text.startsWith(ANSWER_START) || text === THINKING_TEXT) return;

  // Clean expired entries from sentPosts
  const now = Date.now();
  for (const [id, ts] of sentPosts) {
    if (now - ts > 300_000) sentPosts.delete(id);
  }

  log(`[rc-monitor] received post chatId=${post.groupId} creatorId=${post.creatorId}`);
  opts.onMessage(post);
}

export function markSentPost(sentPosts: Map<string, number>, postId: string): void {
  sentPosts.set(postId, Date.now());
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
