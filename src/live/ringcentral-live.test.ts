import { describe, it } from "vitest";
import {
  RingCentralApiError,
  createBotClient,
  createOwnerClient,
  type RingCentralClient,
} from "../client.js";
import { createRingCentralHistoryTool } from "../history-tool.js";
import { RingCentralWebSocketMonitor } from "../monitor.js";
import { sendMessage } from "../send.js";
import { extractChatId } from "../targets.js";
import type { ExtensionInfo, Post } from "../types.js";

const required = readBooleanEnv("RC_E2E_REQUIRED", false);
const enabled = readBooleanEnv("RC_E2E_ENABLED", false);

if (required && !enabled) {
  throw new Error("Set RC_E2E_ENABLED=true to run RingCentral live smoke tests.");
}

const liveDescribe = enabled ? describe : describe.skip;

liveDescribe("RingCentral live smoke", () => {
  it("validates bot send, owner read, history, bot receive, bot read, and bot reply", async () => {
    const env = readLiveEnv();
    const botClient = createBotClient(env.serverUrl, env.botToken);
    const ownerClient = createOwnerClient(
      env.serverUrl,
      env.ownerClientId,
      env.ownerClientSecret,
      env.ownerJwtToken,
    );
    const createdBotPostIds: string[] = [];
    const createdOwnerPostIds: string[] = [];

    try {
      logSafe("live_start", { chat: maskId(env.chatId) });

      const botExtension = await liveStep("bot_auth", () => botClient.getExtensionInfo());
      assertLive(!!botExtension.id, "bot_auth");

      const ownerExtension = await liveStep("owner_auth", () => ownerClient.getExtensionInfo());
      assertLive(!!ownerExtension.id, "owner_auth");

      const chat = await liveStep("chat_metadata_preflight", () =>
        getChatMetadata({ ownerClient, botClient, chatId: env.chatId }),
      );
      assertLive(chat.id === env.chatId, "chat_metadata_preflight");

      await liveStep("owner_history_preflight", () =>
        assertClientCanReadHistory(ownerClient, env.chatId, env.recordCount),
      );
      await liveStep("bot_history_preflight", () =>
        assertClientCanReadHistory(botClient, env.chatId, env.recordCount),
      );

      await runBotSendOwnerReadScenario({
        env,
        botClient,
        ownerClient,
        createdBotPostIds,
      });
      await runOwnerSendBotReceiveScenario({
        env,
        botClient,
        ownerClient,
        botExtension,
        ownerExtension,
        createdBotPostIds,
        createdOwnerPostIds,
      });
    } finally {
      await cleanupPosts({
        cleanup: env.cleanup,
        chatId: env.chatId,
        botClient,
        ownerClient,
        botPostIds: createdBotPostIds,
        ownerPostIds: createdOwnerPostIds,
      });
    }
  });
});

interface LiveEnv {
  serverUrl: string;
  botToken: string;
  ownerClientId: string;
  ownerClientSecret: string;
  ownerJwtToken: string;
  chatId: string;
  recordCount: number;
  cleanup: boolean;
  wsTimeoutMs: number;
}

interface LiveClients {
  env: LiveEnv;
  botClient: RingCentralClient;
  ownerClient: RingCentralClient;
  createdBotPostIds: string[];
  createdOwnerPostIds?: string[];
}

async function runBotSendOwnerReadScenario(params: LiveClients): Promise<void> {
  const uniqueText = buildUniqueText("bot-send");
  const sent = await liveStep("bot_send", () =>
    sendMessage({
      client: params.botClient,
      chatId: params.env.chatId,
      text: uniqueText,
      convertMarkdown: false,
      replyToMode: "off",
    }),
  );
  assertLive(!!sent?.postId, "bot_send");
  params.createdBotPostIds.push(sent!.postId);
  logSafe("bot_send", { sent: true });

  const found = await liveStep("owner_read_bot_message", () =>
    waitForPost(params.ownerClient, params.env.chatId, uniqueText, params.env.recordCount),
  );
  assertLive(found?.id === sent?.postId && !!found?.text?.includes(uniqueText), "owner_read_bot_message");
  logSafe("owner_read_bot_message", { found: true });

  const historyText = await liveStep("history_tool_read", () =>
    readHistoryToolText({
      serverUrl: params.env.serverUrl,
      botToken: params.env.botToken,
      ownerClientId: params.env.ownerClientId,
      ownerClientSecret: params.env.ownerClientSecret,
      ownerJwtToken: params.env.ownerJwtToken,
      chatId: params.env.chatId,
      recordCount: params.env.recordCount,
    }),
  );
  assertLive(historyText.includes(uniqueText), "history_tool_read");
  logSafe("history_tool_read", { found: true });
}

async function runOwnerSendBotReceiveScenario(
  params: LiveClients & {
    botExtension: ExtensionInfo;
    ownerExtension: ExtensionInfo;
    createdOwnerPostIds: string[];
  },
): Promise<void> {
  const ownerText = buildUniqueText("owner-send");
  const replyText = buildUniqueText("bot-reply");
  const wsWaiter = startBotWebSocketWait({
    botClient: params.botClient,
    botPersonId: String(params.botExtension.id ?? ""),
    chatId: params.env.chatId,
    expectedText: ownerText,
    timeoutMs: params.env.wsTimeoutMs,
  });
  try {
    await liveStep("bot_ws_connect", () =>
      withTimeout(wsWaiter.connected, params.env.wsTimeoutMs, "bot_ws_connect"),
    );

    const ownerPost = await liveStep("owner_send", () =>
      params.ownerClient.sendPost(params.env.chatId, ownerText),
    );
    assertLive(!!ownerPost.id, "owner_send");
    params.createdOwnerPostIds.push(ownerPost.id);
    logSafe("owner_send", { sent: true });

    const received = await liveStep("bot_ws_receive", () =>
      withTimeout(wsWaiter.received, params.env.wsTimeoutMs, "bot_ws_receive"),
    );
    assertLive(received.groupId === params.env.chatId && !!received.text?.includes(ownerText), "bot_ws_receive");
    logSafe("bot_ws_receive", { ws_received: true });

    const botRead = await liveStep("bot_read_owner_message", () =>
      waitForPost(params.botClient, params.env.chatId, ownerText, params.env.recordCount),
    );
    assertLive(!!botRead?.text?.includes(ownerText), "bot_read_owner_message");
    logSafe("bot_read_owner_message", { bot_read_found: true });

    const reply = await liveStep("bot_reply", () =>
      sendMessage({
        client: params.botClient,
        chatId: params.env.chatId,
        text: replyText,
        convertMarkdown: false,
        replyToMode: "off",
      }),
    );
    assertLive(!!reply?.postId, "bot_reply");
    params.createdBotPostIds.push(reply!.postId);
    logSafe("bot_reply", { sent: true });

    const ownerReadReply = await liveStep("owner_read_bot_reply", () =>
      waitForPost(params.ownerClient, params.env.chatId, replyText, params.env.recordCount),
    );
    assertLive(!!ownerReadReply?.text?.includes(replyText), "owner_read_bot_reply");
    logSafe("owner_read_bot_reply", { owner_read_found: true });
  } finally {
    await wsWaiter.stop();
  }

  assertLive(String(params.ownerExtension.id ?? ""), "owner_auth");
}

function readLiveEnv(): LiveEnv {
  const missing: string[] = [];
  const readRequired = (name: string) => {
    const value = process.env[name]?.trim();
    if (!value) {
      missing.push(name);
    }
    return value ?? "";
  };
  const env = {
    serverUrl: process.env.RC_SERVER_URL?.trim() || "https://platform.ringcentral.com",
    botToken: readRequired("RC_BOT_TOKEN"),
    ownerClientId: readRequired("RC_USER_CLIENT_ID"),
    ownerClientSecret: readRequired("RC_USER_CLIENT_SECRET"),
    ownerJwtToken: readRequired("RC_USER_JWT_TOKEN"),
    chatId: normalizeChatId(readRequired("RC_E2E_CHAT_ID")),
    recordCount: readRecordCount(),
    cleanup: readBooleanEnv("RC_E2E_CLEANUP", true),
    wsTimeoutMs: readPositiveIntegerEnv("RC_E2E_WS_TIMEOUT_MS", 30_000, 5_000, 120_000),
  };
  if (missing.length > 0) {
    throw new Error(`Missing RingCentral live smoke variables: ${missing.join(", ")}`);
  }
  return env;
}

function normalizeChatId(raw: string): string {
  return extractChatId(raw) ?? raw;
}

function readRecordCount(): number {
  return readPositiveIntegerEnv("RC_E2E_RECORD_COUNT", 50, 1, 1000);
}

function readPositiveIntegerEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(process.env[name] ?? String(fallback));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(raw);
}

function buildUniqueText(label: string): string {
  const runId = process.env.GITHUB_RUN_ID ?? "local";
  const attempt = process.env.GITHUB_RUN_ATTEMPT ?? "1";
  const marker = `[openclaw-ringcentral-e2e:${label}:${runId}:${attempt}:${Date.now()}]`;
  const sourceUrl = process.env.RC_E2E_SOURCE_URL?.trim();
  const commitSha = process.env.RC_E2E_COMMIT_SHA?.trim();
  return [
    marker,
    sourceUrl ? `source: ${sourceUrl}` : "",
    commitSha ? `commit: ${commitSha}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function waitForPost(
  client: RingCentralClient,
  chatId: string,
  expectedText: string,
  recordCount: number,
): Promise<Post | undefined> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const post = await findRecentPost(client, chatId, expectedText, recordCount);
    if (post) {
      return post;
    }
    await delay(1500);
  }
  return undefined;
}

async function findRecentPost(
  client: RingCentralClient,
  chatId: string,
  expectedText: string,
  recordCount: number,
): Promise<Post | undefined> {
  const posts = await readRecentPosts(client, chatId, recordCount);
  return posts.find((post) => post.text?.includes(expectedText));
}

async function readRecentPosts(
  client: RingCentralClient,
  chatId: string,
  recordCount: number,
): Promise<Post[]> {
  try {
    return (await client.listPosts(chatId, recordCount)).records ?? [];
  } catch {
    return (await client.listLegacyGroupPosts(chatId, recordCount)).records ?? [];
  }
}

async function getChatMetadata(params: {
  ownerClient: RingCentralClient;
  botClient: RingCentralClient;
  chatId: string;
}) {
  try {
    return await params.ownerClient.getChat(params.chatId);
  } catch {
    try {
      const chat = await params.botClient.getChat(params.chatId);
      logSafe("chat_metadata_preflight", { owner_lookup: false, bot_lookup: true });
      return chat;
    } catch (err) {
      throw err;
    }
  }
}

async function assertClientCanReadHistory(
  client: RingCentralClient,
  chatId: string,
  recordCount: number,
): Promise<void> {
  await readRecentPosts(client, chatId, Math.min(recordCount, 1));
}

function startBotWebSocketWait(params: {
  botClient: RingCentralClient;
  botPersonId: string;
  chatId: string;
  expectedText: string;
  timeoutMs: number;
}): {
  connected: Promise<void>;
  received: Promise<Post>;
  stop: () => Promise<void>;
} {
  const abortController = new AbortController();
  const connected = createDeferred<void>();
  const received = createDeferred<Post>();
  connected.promise.catch(() => undefined);
  received.promise.catch(() => undefined);
  const monitor = new RingCentralWebSocketMonitor({
    client: params.botClient,
    ownCreatorId: params.botPersonId,
    filterOwnCreator: true,
    abortSignal: abortController.signal,
    ignoredTexts: [],
    onConnected: () => {
      logSafe("bot_ws_connect", { ws_connected: true });
      connected.resolve();
    },
    onDisconnected: (err) => {
      if (!abortController.signal.aborted) {
        connected.reject(err ?? new Error("ws disconnected"));
        received.reject(err ?? new Error("ws disconnected"));
      }
    },
    onMessage: (post) => {
      if (post.groupId === params.chatId && post.text?.includes(params.expectedText)) {
        received.resolve(post);
      }
    },
    onDiagnostic: (event, details) => {
      logSafe("bot_ws_state", sanitizeDiagnostic(event, details));
    },
    log: () => undefined,
  });
  const monitorDone = monitor.start().catch((err) => {
    if (!abortController.signal.aborted) {
      connected.reject(err);
      received.reject(err);
    }
  });
  return {
    connected: connected.promise,
    received: received.promise,
    stop: async () => {
      abortController.abort();
      await monitorDone.catch(() => undefined);
    },
  };
}

async function cleanupPosts(params: {
  cleanup: boolean;
  chatId: string;
  botClient: RingCentralClient;
  ownerClient: RingCentralClient;
  botPostIds: string[];
  ownerPostIds: string[];
}): Promise<void> {
  if (!params.cleanup) {
    logSafe("cleanup", { enabled: false });
    return;
  }

  let cleanupBotPost = true;
  let cleanupOwnerPost = true;
  for (const postId of params.botPostIds.reverse()) {
    try {
      await params.botClient.deletePost(params.chatId, postId);
    } catch {
      cleanupBotPost = false;
    }
  }
  for (const postId of params.ownerPostIds.reverse()) {
    try {
      await params.ownerClient.deletePost(params.chatId, postId);
    } catch {
      cleanupOwnerPost = false;
    }
  }
  logSafe("cleanup", {
    cleanup_bot_post: cleanupBotPost,
    cleanup_owner_post: cleanupOwnerPost,
  });
}

async function readHistoryToolText(params: {
  serverUrl: string;
  botToken: string;
  ownerClientId: string;
  ownerClientSecret: string;
  ownerJwtToken: string;
  chatId: string;
  recordCount: number;
}): Promise<string> {
  const tool = createRingCentralHistoryTool({
    channels: {
      ringcentral: {
        botToken: params.botToken,
        server: params.serverUrl,
        ownerCredentials: {
          clientId: params.ownerClientId,
          clientSecret: params.ownerClientSecret,
          jwt: params.ownerJwtToken,
        },
        homeChannel: params.chatId,
      },
    },
  });
  const result = await tool.execute("ringcentral-live-smoke", {
    target: `ringcentral:chat:${params.chatId}`,
    target_type: "chat",
    record_count: params.recordCount,
  });
  return result.content
    .map((item) => (item.type === "text" ? item.text : ""))
    .filter(Boolean)
    .join("\n");
}

async function liveStep<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    logSafe(stage, { ok: true, duration_ms: Date.now() - start });
    return result;
  } catch (err) {
    throw toSafeLiveError(stage, err);
  }
}

function assertLive(condition: unknown, stage: string): asserts condition {
  if (!condition) {
    throw new Error(`RingCentral live smoke failed at ${stage}: assertion failed`);
  }
}

function toSafeLiveError(stage: string, err: unknown): Error {
  return new Error(`RingCentral live smoke failed at ${stage}: ${summarizeSafeError(err)}`);
}

function summarizeSafeError(err: unknown): string {
  if (err instanceof RingCentralApiError) {
    const code = readRingCentralErrorCode(err.body);
    return `HTTP ${err.status}${code ? ` ${code}` : ""}`;
  }
  if (err instanceof TimeoutError) {
    return "timeout";
  }
  if (err instanceof Error) {
    const subscriptionStatus = err.message.match(/^WebSocket subscription failed: status=(\d+)$/)?.[1];
    if (subscriptionStatus) {
      return `HTTP ${subscriptionStatus}`;
    }
  }
  return "failed";
}

function readRingCentralErrorCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { errors?: Array<{ errorCode?: unknown }> };
    const code = parsed.errors?.find((item) => typeof item.errorCode === "string")?.errorCode;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

function maskId(value: unknown): string {
  const raw = String(value ?? "");
  if (!raw) {
    return "<masked>";
  }
  return `<masked:length=${raw.length}>`;
}

function logSafe(event: string, details: Record<string, boolean | number | string> = {}): void {
  const suffix = Object.entries(details)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console.log(`[ringcentral-live] event=${event}${suffix ? ` ${suffix}` : ""}`);
}

function sanitizeDiagnostic(
  state: string,
  details: Record<string, boolean | number | string> = {},
): Record<string, boolean | number | string> {
  const safe: Record<string, boolean | number | string> = { state };
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "boolean" || typeof value === "number") {
      safe[key] = value;
    }
  }
  return safe;
}

function createDeferred<T>() {
  let settled = false;
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = (value) => {
      if (!settled) {
        settled = true;
        res(value);
      }
    };
    reject = (reason) => {
      if (!settled) {
        settled = true;
        rej(reason);
      }
    };
  });
  return { promise, resolve, reject };
}

class TimeoutError extends Error {
  constructor(readonly stage: string) {
    super(stage);
    this.name = "TimeoutError";
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  stage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(stage)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
