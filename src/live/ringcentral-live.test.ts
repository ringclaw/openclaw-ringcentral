import { appendFileSync } from "node:fs";
import { describe, it } from "vitest";
import {
  RingCentralApiError,
  createBotClient,
  createOwnerClient,
  type RingCentralClient,
} from "../client.js";
import { resolveAccount } from "../accounts.js";
import { resolveInboundAttachmentsForAgent } from "../attachments.js";
import { createRingCentralHistoryTool } from "../history-tool.js";
import { RingCentralWebSocketMonitor } from "../monitor.js";
import { sendMessage } from "../send.js";
import { extractChatId } from "../targets.js";
import type { CreateAdaptiveCardRequest, CreateEventRequest, ExtensionInfo, Post } from "../types.js";

const required = readBooleanEnv("RC_E2E_REQUIRED", false);
const enabled = readBooleanEnv("RC_E2E_ENABLED", false);

if (required && !enabled) {
  throw new Error("Set RC_E2E_ENABLED=true to run RingCentral live smoke tests.");
}

const liveDescribe = enabled ? describe : describe.skip;

liveDescribe("RingCentral live smoke", () => {
  it("validates bot send, owner read, history, bot receive, bot read, and bot reply", async () => {
    const summary = createLiveSummary("openclaw-ringcentral");
    summary.setContext(buildBaseSummaryContext());
    activeSummary = summary;
    let env: LiveEnv | undefined;
    let botClient: RingCentralClient | undefined;
    let ownerClient: RingCentralClient | undefined;
    const createdBotPostIds: string[] = [];
    const createdOwnerPostIds: string[] = [];
    const createdOwnerEventIds: string[] = [];
    const createdOwnerNoteIds: string[] = [];
    const createdBotAdaptiveCardIds: string[] = [];

    try {
      env = readLiveEnv();
      summary.setContext(buildSummaryContext(env));
      botClient = createBotClient(env.serverUrl, env.botToken);
      ownerClient = createOwnerClient(
        env.serverUrl,
        env.ownerClientId,
        env.ownerClientSecret,
        env.ownerJwtToken,
      );

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

      await runFileUploadScenario({
        env,
        botClient,
        ownerClient,
        createdOwnerPostIds,
      });
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
      await runThreadedReplyScenario({
        env,
        botClient,
        ownerClient,
        createdBotPostIds,
        createdOwnerPostIds,
      });
      await runThreadFollowupScenario({
        env,
        botClient,
        ownerClient,
        botExtension,
        createdBotPostIds,
        createdOwnerPostIds,
      });
      await runCalendarEventScenario({
        env,
        ownerClient,
        createdOwnerEventIds,
      });
      await runAdaptiveCardScenario({
        env,
        botClient,
        ownerClient,
        createdBotPostIds,
        createdBotAdaptiveCardIds,
      });
      await runNoteScenario({
        env,
        botClient,
        ownerClient,
        createdBotPostIds,
        createdOwnerNoteIds,
      });
    } catch (err) {
      summary.fail(err);
      throw err;
    } finally {
      try {
        if (env && botClient && ownerClient) {
          await cleanupPosts({
            cleanup: env.cleanup,
            chatId: env.chatId,
            botClient,
            ownerClient,
            botPostIds: createdBotPostIds,
            ownerPostIds: createdOwnerPostIds,
          });
          await cleanupEvents({
            cleanup: env.cleanup,
            ownerClient,
            eventIds: createdOwnerEventIds,
          });
          await cleanupAdaptiveCards({
            cleanup: env.cleanup,
            botClient,
            adaptiveCardIds: createdBotAdaptiveCardIds,
          });
          await cleanupNotes({
            cleanup: env.cleanup,
            ownerClient,
            noteIds: createdOwnerNoteIds,
          });
        }
      } finally {
        summary.write();
        if (activeSummary === summary) {
          activeSummary = undefined;
        }
      }
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
  fileUpload: boolean;
  threadFollowup: boolean;
}

interface LiveClients {
  env: LiveEnv;
  botClient: RingCentralClient;
  ownerClient: RingCentralClient;
  createdBotPostIds: string[];
  createdOwnerPostIds?: string[];
  createdOwnerNoteIds?: string[];
  createdBotAdaptiveCardIds?: string[];
}

type SummaryDetail = boolean | number | string;

interface SummaryRow {
  stage: string;
  status: "info" | "ok" | "failed";
  durationMs?: number;
  details: Record<string, SummaryDetail>;
}

class LiveSummary {
  private readonly rows = new Map<string, SummaryRow>();
  private readonly context: Record<string, SummaryDetail> = {};
  private status: "passed" | "failed" = "passed";
  private failure: { stage: string; error: string } | undefined;

  constructor(private readonly name: string) {}

  setContext(details: Record<string, SummaryDetail>): void {
    Object.assign(this.context, details);
  }

  record(stage: string, details: Record<string, SummaryDetail>): void {
    const row = this.rows.get(stage) ?? {
      stage,
      status: "info",
      details: {},
    };
    Object.assign(row.details, details);
    if (details.ok === true) {
      row.status = "ok";
    } else if (details.ok === false) {
      row.status = "failed";
    }
    if (typeof details.duration_ms === "number") {
      row.durationMs = details.duration_ms;
    }
    this.rows.set(stage, row);
  }

  fail(err: unknown): void {
    this.status = "failed";
    this.failure = summarizeFailureForSummary(err);
    this.record(this.failure.stage, {
      ok: false,
      error: this.failure.error,
    });
  }

  write(): void {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY?.trim();
    if (!summaryPath) {
      return;
    }
    appendFileSync(summaryPath, `${this.toMarkdown()}\n`, "utf8");
  }

  private toMarkdown(): string {
    const contextRows = Object.entries(this.context)
      .map(([key, value]) => `| ${escapeMarkdownCell(key)} | ${escapeMarkdownCell(value)} |`)
      .join("\n");
    const stageRows = Array.from(this.rows.values())
      .map((row) => {
        const details = Object.entries(row.details)
          .filter(([key]) => key !== "ok" && key !== "duration_ms")
          .map(([key, value]) => `${key}=${value}`)
          .join(" ");
        return `| ${escapeMarkdownCell(row.stage)} | ${escapeMarkdownCell(row.status)} | ${escapeMarkdownCell(row.durationMs ?? "")} | ${escapeMarkdownCell(details)} |`;
      })
      .join("\n");
    const failure = this.failure
      ? `\n\nFailure: ${escapeMarkdownCell(this.failure.stage)} ${escapeMarkdownCell(this.failure.error)}`
      : "";
    return [
      `## ${this.name} live smoke`,
      "",
      `Overall: ${this.status}`,
      "",
      "| Context | Value |",
      "| --- | --- |",
      contextRows || "| none | none |",
      "",
      "| Stage | Status | Duration ms | Details |",
      "| --- | --- | ---: | --- |",
      stageRows || "| none | info |  |  |",
      failure,
    ].join("\n");
  }
}

let activeSummary: LiveSummary | undefined;

function createLiveSummary(name: string): LiveSummary {
  return new LiveSummary(name);
}

function buildSummaryContext(env: LiveEnv): Record<string, SummaryDetail> {
  return {
    ...buildBaseSummaryContext(),
    cleanup: env.cleanup,
    record_count: env.recordCount,
    ws_timeout_ms: env.wsTimeoutMs,
    file_upload: env.fileUpload,
    thread_followup: env.threadFollowup,
  };
}

function buildBaseSummaryContext(): Record<string, SummaryDetail> {
  return {
    repository: process.env.GITHUB_REPOSITORY ?? "local",
    event: process.env.GITHUB_EVENT_NAME ?? "local",
    source_present: Boolean(process.env.RC_E2E_SOURCE_URL?.trim()),
    commit_present: Boolean(process.env.RC_E2E_COMMIT_SHA?.trim()),
    cleanup: readBooleanEnv("RC_E2E_CLEANUP", false),
    record_count: readRecordCount(),
    ws_timeout_ms: readPositiveIntegerEnv("RC_E2E_WS_TIMEOUT_MS", 30_000, 5_000, 120_000),
    file_upload: readBooleanEnv("RC_E2E_FILE_UPLOAD", true),
    thread_followup: readBooleanEnv("RC_E2E_THREAD_FOLLOWUP", false),
  };
}

async function runFileUploadScenario(
  params: LiveClients & {
    createdOwnerPostIds: string[];
  },
): Promise<void> {
  if (!params.env.fileUpload) {
    logSafe("file_upload", { enabled: false });
    return;
  }

  const imageFileName = buildUniqueFileName("image", "png");
  const documentFileName = buildUniqueFileName("document", "txt");
  const wsWaiter = startBotWebSocketAttachmentWait({
    botClient: params.botClient,
    chatId: params.env.chatId,
    expectedFileName: imageFileName,
    timeoutMs: params.env.wsTimeoutMs,
  });

  try {
    await liveStep("file_upload_ws_connect", () =>
      withTimeout(wsWaiter.connected, params.env.wsTimeoutMs, "file_upload_ws_connect"),
    );

    const imageUpload = await liveStep("file_upload_image", () =>
      params.ownerClient.uploadFile(
        params.env.chatId,
        imageFileName,
        tinyPngBytes(),
        "image/png",
      ),
    );
    logSafe("file_upload_image", { uploaded: true });

    const imageWsPost = await liveStep("file_upload_ws_receive", () =>
      withTimeout(wsWaiter.received, params.env.wsTimeoutMs, "file_upload_ws_receive"),
    );
    assertLive(hasAttachment(imageWsPost, imageFileName), "file_upload_ws_receive");
    logSafe("file_upload_ws_receive", { ws_received: true });

    const imagePost = await liveStep("file_upload_image_bot_read", () =>
      waitForAttachmentPost({
        client: params.botClient,
        chatId: params.env.chatId,
        fileName: imageFileName,
        uploaded: imageUpload,
        recordCount: params.env.recordCount,
      }),
    );
    assertLive(imagePost, "file_upload_image_bot_read");
    params.createdOwnerPostIds.push(String(imagePost.id));
    logSafe("file_upload_image_bot_read", { found: true });

    await assertAttachmentHandoff({
      stage: "file_upload_image_handoff",
      env: params.env,
      botClient: params.botClient,
      ownerClient: params.ownerClient,
      uploaded: imageUpload,
      post: imagePost,
    });

    const documentUpload = await liveStep("file_upload_document", () =>
      params.ownerClient.uploadFile(
        params.env.chatId,
        documentFileName,
        Buffer.from("RingCentral live smoke document attachment\n", "utf8"),
        "text/plain",
      ),
    );
    logSafe("file_upload_document", { uploaded: true });

    const documentPost = await liveStep("file_upload_document_bot_read", () =>
      waitForAttachmentPost({
        client: params.botClient,
        chatId: params.env.chatId,
        fileName: documentFileName,
        uploaded: documentUpload,
        recordCount: params.env.recordCount,
      }),
    );
    assertLive(documentPost, "file_upload_document_bot_read");
    params.createdOwnerPostIds.push(String(documentPost.id));
    logSafe("file_upload_document_bot_read", { found: true });

    await assertAttachmentHandoff({
      stage: "file_upload_document_handoff",
      env: params.env,
      botClient: params.botClient,
      ownerClient: params.ownerClient,
      uploaded: documentUpload,
      post: documentPost,
    });
  } finally {
    await wsWaiter.stop();
  }
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
    assertLive(
      botRead?.id === ownerPost.id && !!botRead?.text?.includes(ownerText),
      "bot_read_owner_message",
    );
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
    assertLive(
      ownerReadReply?.id === reply?.postId && !!ownerReadReply?.text?.includes(replyText),
      "owner_read_bot_reply",
    );
    logSafe("owner_read_bot_reply", { owner_read_found: true });
  } finally {
    await wsWaiter.stop();
  }

  assertLive(String(params.ownerExtension.id ?? ""), "owner_auth");
}

async function runThreadedReplyScenario(
  params: LiveClients & {
    createdOwnerPostIds: string[];
  },
): Promise<void> {
  const rootText = buildUniqueText("owner-thread-root");
  const replyText = buildUniqueText("bot-thread-reply");

  const root = await liveStep("owner_thread_root_send", () =>
    params.ownerClient.sendPost(params.env.chatId, rootText),
  );
  assertLive(!!root.id, "owner_thread_root_send");
  const rootId = String(root.id);
  params.createdOwnerPostIds.push(rootId);
  logSafe("owner_thread_root_send", { sent: true });

  const reply = await liveStep("bot_thread_reply", () =>
    sendMessage({
      client: params.botClient,
      chatId: params.env.chatId,
      text: replyText,
      convertMarkdown: false,
      replyToId: rootId,
    }),
  );
  assertLive(!!reply?.postId, "bot_thread_reply");
  params.createdBotPostIds.push(reply!.postId);
  logSafe("bot_thread_reply", { sent: true });

  const ownerReadReply = await liveStep("owner_read_thread_reply", () =>
    waitForPost(params.ownerClient, params.env.chatId, replyText, params.env.recordCount),
  );
  assertLive(
    ownerReadReply?.id === reply?.postId && hasThreadMetadata(ownerReadReply, rootId),
    "owner_read_thread_reply",
  );
  logSafe("owner_read_thread_reply", { owner_read_found: true, thread_metadata: true });
}

async function runThreadFollowupScenario(
  params: LiveClients & {
    botExtension: ExtensionInfo;
    createdOwnerPostIds: string[];
  },
): Promise<void> {
  if (!params.env.threadFollowup) {
    logSafe("thread_followup", { enabled: false });
    return;
  }

  const rootText = buildUniqueText("thread-followup-root");
  const rootReplyText = buildUniqueText("thread-followup-root-reply");
  const followupText = buildUniqueText("thread-followup-owner");
  const followupReplyText = buildUniqueText("thread-followup-bot-reply");
  const wsWaiter = startBotWebSocketWait({
    botClient: params.botClient,
    botPersonId: String(params.botExtension.id ?? ""),
    chatId: params.env.chatId,
    expectedText: followupText,
    timeoutMs: params.env.wsTimeoutMs,
  });

  try {
    await liveStep("thread_followup_ws_connect", () =>
      withTimeout(wsWaiter.connected, params.env.wsTimeoutMs, "thread_followup_ws_connect"),
    );

    const root = await liveStep("thread_root_send", () =>
      params.ownerClient.sendPost(params.env.chatId, rootText),
    );
    assertLive(!!root.id, "thread_root_send");
    const rootId = String(root.id);
    params.createdOwnerPostIds.push(rootId);
    logSafe("thread_root_send", { sent: true });

    const rootReply = await liveStep("bot_thread_root_reply", () =>
      sendMessage({
        client: params.botClient,
        chatId: params.env.chatId,
        text: rootReplyText,
        convertMarkdown: false,
        replyToId: rootId,
      }),
    );
    assertLive(!!rootReply?.postId, "bot_thread_root_reply");
    params.createdBotPostIds.push(rootReply!.postId);
    logSafe("bot_thread_root_reply", { sent: true });

    const followup = await liveStep("owner_thread_followup_send", () =>
      params.ownerClient.sendPost(params.env.chatId, followupText, { parentPostId: rootId }),
    );
    assertLive(!!followup.id, "owner_thread_followup_send");
    params.createdOwnerPostIds.push(String(followup.id));
    logSafe("owner_thread_followup_send", { sent: true });

    const received = await liveStep("bot_ws_thread_followup_receive", () =>
      withTimeout(wsWaiter.received, params.env.wsTimeoutMs, "bot_ws_thread_followup_receive"),
    );
    assertLive(
      received.groupId === params.env.chatId &&
        !!received.text?.includes(followupText) &&
        hasThreadMetadata(received, rootId),
      "bot_ws_thread_followup_receive",
    );
    logSafe("bot_ws_thread_followup_receive", {
      ws_received: true,
      thread_metadata: true,
    });

    const botRead = await liveStep("bot_read_thread_followup", () =>
      waitForPost(params.botClient, params.env.chatId, followupText, params.env.recordCount),
    );
    assertLive(
      botRead?.id === followup.id &&
        !!botRead?.text?.includes(followupText) &&
        hasThreadMetadata(botRead, rootId),
      "bot_read_thread_followup",
    );
    logSafe("bot_read_thread_followup", { bot_read_found: true, thread_metadata: true });

    const reply = await liveStep("bot_thread_followup_reply", () =>
      sendMessage({
        client: params.botClient,
        chatId: params.env.chatId,
        text: followupReplyText,
        convertMarkdown: false,
        replyToId: String(followup.id),
        threadId: botRead.threadId ?? rootId,
      }),
    );
    assertLive(!!reply?.postId, "bot_thread_followup_reply");
    params.createdBotPostIds.push(reply!.postId);
    logSafe("bot_thread_followup_reply", { sent: true });

    const ownerReadReply = await liveStep("owner_read_thread_followup_reply", () =>
      waitForPost(params.ownerClient, params.env.chatId, followupReplyText, params.env.recordCount),
    );
    assertLive(
      ownerReadReply?.id === reply?.postId &&
        !!ownerReadReply?.text?.includes(followupReplyText) &&
        hasThreadMetadata(ownerReadReply, rootId),
      "owner_read_thread_followup_reply",
    );
    logSafe("owner_read_thread_followup_reply", {
      owner_read_found: true,
      thread_metadata: true,
    });
  } finally {
    await wsWaiter.stop();
  }
}

async function runCalendarEventScenario(params: {
  env: LiveEnv;
  ownerClient: RingCentralClient;
  createdOwnerEventIds: string[];
}): Promise<void> {
  const eventPayload = buildCalendarEventPayload("calendar-event");
  const updatedPayload = buildCalendarEventPayload("calendar-event-updated");

  const created = await liveStep("calendar_event_create", () =>
    params.ownerClient.createEvent(params.env.chatId, eventPayload),
  );
  assertLive(!!created.id, "calendar_event_create");
  const eventId = String(created.id);
  params.createdOwnerEventIds.push(eventId);
  logSafe("calendar_event_create", { created: true });

  const listed = await liveStep("calendar_event_list", () =>
    params.ownerClient.listEvents(params.env.chatId, Math.min(params.env.recordCount, 50)),
  );
  assertLive(Array.isArray(listed.records), "calendar_event_list");
  logSafe("calendar_event_list", { listed: true });

  const read = await liveStep("calendar_event_get", () => params.ownerClient.getEvent(eventId));
  assertLive(read.id === eventId, "calendar_event_get");
  logSafe("calendar_event_get", { found: true });

  const updated = await liveStep("calendar_event_update", async () => {
    const response = await params.ownerClient.updateEvent(eventId, updatedPayload);
    return response.title === updatedPayload.title ? response : params.ownerClient.getEvent(eventId);
  });
  assertLive(updated.id === eventId && updated.title === updatedPayload.title, "calendar_event_update");
  logSafe("calendar_event_update", { updated: true });
}

async function runNoteScenario(
  params: LiveClients & {
    createdOwnerNoteIds: string[];
  },
): Promise<void> {
  const title = buildUniqueText("note-title");
  const updatedTitle = buildUniqueText("note-title-updated");
  const body = `<strong>${escapeHtml(title)}</strong>`;
  const updatedBody = `<strong>${escapeHtml(updatedTitle)}</strong>`;

  const created = await liveStep("note_create", () =>
    params.ownerClient.createNote(params.env.chatId, { title, body }),
  );
  assertLive(!!created.id, "note_create");
  params.createdOwnerNoteIds.push(created.id);
  logSafe("note_create", { created: true });

  const read = await liveStep("note_get", () =>
    params.ownerClient.getNote(created.id),
  );
  assertLive(read.id === created.id, "note_get");
  logSafe("note_get", { found: true });

  const updated = await liveStep("note_update", () =>
    params.ownerClient.updateNote(created.id, { title: updatedTitle, body: updatedBody }),
  );
  assertLive(updated.id === created.id, "note_update");
  logSafe("note_update", { updated: true });

  await liveStep("note_publish", () =>
    params.ownerClient.publishNote(created.id),
  );
  logSafe("note_publish", { published: true });
}

async function runAdaptiveCardScenario(
  params: LiveClients & {
    createdBotAdaptiveCardIds: string[];
  },
): Promise<void> {
  const initialText = buildUniqueText("adaptive-card");
  const updatedText = buildUniqueText("adaptive-card-updated");
  const card = buildAdaptiveCard(initialText);

  const created = await liveStep("adaptive_card_create", () =>
    params.botClient.createAdaptiveCard(params.env.chatId, card),
  );
  assertLive(!!created.id, "adaptive_card_create");
  params.createdBotAdaptiveCardIds.push(created.id);
  logSafe("adaptive_card_create", { created: true });

  const read = await liveStep("adaptive_card_get", () =>
    params.botClient.getAdaptiveCard(created.id),
  );
  assertLive(read.id === created.id, "adaptive_card_get");
  logSafe("adaptive_card_get", { found: true });

  const updated = await liveStep("adaptive_card_update", () =>
    params.botClient.updateAdaptiveCard(created.id, buildAdaptiveCard(updatedText)),
  );
  assertLive(updated.id === created.id, "adaptive_card_update");
  logSafe("adaptive_card_update", { updated: true });
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
    cleanup: readBooleanEnv("RC_E2E_CLEANUP", false),
    wsTimeoutMs: readPositiveIntegerEnv("RC_E2E_WS_TIMEOUT_MS", 30_000, 5_000, 120_000),
    fileUpload: readBooleanEnv("RC_E2E_FILE_UPLOAD", true),
    threadFollowup: readBooleanEnv("RC_E2E_THREAD_FOLLOWUP", false),
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

function buildUniqueFileName(label: string, extension: string): string {
  const runId = process.env.GITHUB_RUN_ID ?? "local";
  const attempt = process.env.GITHUB_RUN_ATTEMPT ?? "1";
  return `openclaw-ringcentral-e2e-${label}-${runId}-${attempt}-${Date.now()}.${extension}`;
}

function tinyPngBytes(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lS0N2wAAAABJRU5ErkJggg==",
    "base64",
  );
}

function buildCalendarEventPayload(label: string): CreateEventRequest {
  const marker = buildUniqueText(label).split("\n")[0] ?? `[openclaw-ringcentral-e2e:${label}:${Date.now()}]`;
  const start = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  return {
    title: marker,
    startTime: start,
    endTime: end,
    description: buildUniqueText(`${label}-description`),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildAdaptiveCard(text: string): CreateAdaptiveCardRequest {
  return {
    type: "AdaptiveCard",
    $schema: "https://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.3",
    body: [{ type: "TextBlock", text, wrap: true }],
  };
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

async function waitForAttachmentPost(params: {
  client: RingCentralClient;
  chatId: string;
  fileName: string;
  uploaded: unknown;
  recordCount: number;
}): Promise<Post | undefined> {
  const uploadedAsPost = normalizeUploadedPost(params.uploaded);
  if (uploadedAsPost?.attachments?.length) {
    return uploadedAsPost;
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    const posts = await readRecentPosts(params.client, params.chatId, params.recordCount);
    const found = posts.find((post) => hasAttachment(post, params.fileName));
    if (found) {
      return found;
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

function hasAttachment(post: Post, expectedFileName: string): boolean {
  const attachments = post.attachments ?? [];
  return attachments.some((attachment) => {
    const names = [attachment.fileName, attachment.name].filter(Boolean).map(String);
    if (names.some((name) => name === expectedFileName)) {
      return true;
    }
    return names.length === 0 && Boolean(attachment.contentUri ?? attachment.uri ?? attachment.id);
  });
}

function normalizeUploadedPost(uploaded: unknown): Post | undefined {
  if (!uploaded || Array.isArray(uploaded) || typeof uploaded !== "object") {
    return undefined;
  }
  const candidate = uploaded as Partial<Post>;
  return candidate.id && candidate.groupId ? (candidate as Post) : undefined;
}

function extractUploadAttachments(uploaded: unknown): Post["attachments"] {
  if (Array.isArray(uploaded)) {
    return uploaded
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
      .map((entry) => ({
        id: String(entry.id ?? ""),
        type: String(entry.type ?? "File"),
        name: typeof entry.name === "string" ? entry.name : undefined,
        fileName: typeof entry.fileName === "string" ? entry.fileName : undefined,
        contentUri: typeof entry.contentUri === "string" ? entry.contentUri : undefined,
        uri: typeof entry.uri === "string" ? entry.uri : undefined,
        contentType: typeof entry.contentType === "string" ? entry.contentType : undefined,
        size: typeof entry.size === "number" ? entry.size : undefined,
      }))
      .filter((entry) => entry.id || entry.contentUri || entry.uri);
  }
  if (uploaded && typeof uploaded === "object") {
    const maybePost = uploaded as Partial<Post>;
    if (maybePost.attachments?.length) {
      return maybePost.attachments;
    }
    const maybeAttachment = uploaded as {
      id?: unknown;
      name?: unknown;
      fileName?: unknown;
      contentUri?: unknown;
      uri?: unknown;
      contentType?: unknown;
      size?: unknown;
    };
    if (typeof maybeAttachment.contentUri === "string" || typeof maybeAttachment.uri === "string") {
      return [
        {
          id: String(maybeAttachment.id ?? ""),
          type: "File",
          name: typeof maybeAttachment.name === "string" ? maybeAttachment.name : undefined,
          fileName: typeof maybeAttachment.fileName === "string" ? maybeAttachment.fileName : undefined,
          contentUri:
            typeof maybeAttachment.contentUri === "string" ? maybeAttachment.contentUri : undefined,
          uri: typeof maybeAttachment.uri === "string" ? maybeAttachment.uri : undefined,
          contentType:
            typeof maybeAttachment.contentType === "string" ? maybeAttachment.contentType : undefined,
          size: typeof maybeAttachment.size === "number" ? maybeAttachment.size : undefined,
        },
      ];
    }
  }
  return undefined;
}

async function assertAttachmentHandoff(params: {
  stage: string;
  env: LiveEnv;
  botClient: RingCentralClient;
  ownerClient: RingCentralClient;
  uploaded: unknown;
  post: Post;
}): Promise<void> {
  const attachments = extractUploadAttachments(params.uploaded) ?? params.post.attachments;
  assertLive(attachments?.length, params.stage);
  const payload = await liveStep(params.stage, () =>
    resolveInboundAttachmentsForAgent({
      attachments,
      primaryClient: params.botClient,
      fallbackClient: params.ownerClient,
      account: resolveAccount({
        botToken: params.env.botToken,
        ownerCredentials: {
          clientId: params.env.ownerClientId,
          clientSecret: params.env.ownerClientSecret,
          jwt: params.env.ownerJwtToken,
        },
        attachments: { enabled: true, maxCount: 5, maxBytes: 5 * 1024 * 1024 },
      }),
      log: () => undefined,
    }),
  );
  const mediaPaths = (payload as { MediaPaths?: unknown }).MediaPaths;
  assertLive(Array.isArray(mediaPaths) && mediaPaths.length > 0, params.stage);
  logSafe(params.stage, { media_payload: true });
}

function hasThreadMetadata(post: Post, rootPostId: string): boolean {
  const metadata = post as Post & {
    parentId?: string | number | null;
    rootPostId?: string | number | null;
    rootId?: string | number | null;
  };
  const parent = metadata.parentPostId ?? metadata.parentId;
  if (parent && String(parent) === rootPostId) {
    return true;
  }
  return Boolean(metadata.threadId || metadata.rootPostId || metadata.rootId);
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

function startBotWebSocketAttachmentWait(params: {
  botClient: RingCentralClient;
  chatId: string;
  expectedFileName: string;
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
    filterOwnCreator: false,
    abortSignal: abortController.signal,
    ignoredTexts: [],
    onConnected: () => {
      logSafe("file_upload_ws_connect", { ws_connected: true });
      connected.resolve();
    },
    onDisconnected: (err) => {
      if (!abortController.signal.aborted) {
        connected.reject(err ?? new Error("ws disconnected"));
        received.reject(err ?? new Error("ws disconnected"));
      }
    },
    onMessage: (post) => {
      if (post.groupId === params.chatId && hasAttachment(post, params.expectedFileName)) {
        received.resolve(post);
      }
    },
    onDiagnostic: (event, details) => {
      logSafe("file_upload_ws_state", sanitizeDiagnostic(event, details));
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

async function cleanupEvents(params: {
  cleanup: boolean;
  ownerClient: RingCentralClient;
  eventIds: string[];
}): Promise<void> {
  if (!params.cleanup) {
    logSafe("calendar_event_cleanup", { enabled: false });
    return;
  }

  let cleanupEvents = true;
  for (const eventId of params.eventIds.reverse()) {
    try {
      await params.ownerClient.deleteEvent(eventId);
    } catch {
      cleanupEvents = false;
    }
  }
  logSafe("calendar_event_cleanup", { cleanup_events: cleanupEvents });
}

async function cleanupNotes(params: {
  cleanup: boolean;
  ownerClient: RingCentralClient;
  noteIds: string[];
}): Promise<void> {
  if (!params.cleanup) {
    logSafe("note_cleanup", { enabled: false });
    return;
  }

  let cleanupNotes = true;
  for (const noteId of params.noteIds.reverse()) {
    try {
      await params.ownerClient.deleteNote(noteId);
    } catch {
      cleanupNotes = false;
    }
  }
  logSafe("note_cleanup", {
    cleanup_notes: cleanupNotes,
  });
}

async function cleanupAdaptiveCards(params: {
  cleanup: boolean;
  botClient: RingCentralClient;
  adaptiveCardIds: string[];
}): Promise<void> {
  if (!params.cleanup) {
    logSafe("adaptive_card_cleanup", { enabled: false });
    return;
  }

  let cleanupAdaptiveCards = true;
  for (const cardId of params.adaptiveCardIds.reverse()) {
    try {
      await params.botClient.deleteAdaptiveCard(cardId);
    } catch {
      cleanupAdaptiveCards = false;
    }
  }
  logSafe("adaptive_card_cleanup", {
    cleanup_adaptive_cards: cleanupAdaptiveCards,
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
    target: `channel:${params.chatId}`,
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
  const safeDetails = formatSafeDetails(details);
  const suffix = Object.entries(safeDetails)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console.log(`[ringcentral-live] event=${event}${suffix ? ` ${suffix}` : ""}`);
  activeSummary?.record(event, safeDetails);
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

function formatSafeDetails(
  details: Record<string, boolean | number | string>,
): Record<string, SummaryDetail> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key, formatSafeValue(value)]),
  );
}

function formatSafeValue(value: boolean | number | string): SummaryDetail {
  if (typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  const raw = String(value);
  if (
    raw.startsWith("<masked:length=") ||
    safeStringValues.has(raw) ||
    /^HTTP \d{3}(?: [A-Z0-9_-]+)?$/.test(raw)
  ) {
    return raw;
  }
  return "<masked>";
}

const safeStringValues = new Set([
  "<masked>",
  "ws_connected",
  "ws_subscription_confirmed",
  "ws_subscription_rejected",
  "ws_subscription_request_sent",
  "ws_post_received",
  "timeout",
  "assertion failed",
  "failed",
  "missing required variables",
]);

function summarizeFailureForSummary(err: unknown): { stage: string; error: string } {
  if (err instanceof Error) {
    const liveFailure = err.message.match(
      /^RingCentral live smoke failed at ([a-z0-9_]+): (.+)$/,
    );
    if (liveFailure) {
      return {
        stage: liveFailure[1],
        error: sanitizeFailureMessage(liveFailure[2]),
      };
    }
    if (err.message.startsWith("Missing RingCentral live smoke variables:")) {
      return {
        stage: "configuration",
        error: "missing required variables",
      };
    }
  }
  return {
    stage: "unknown",
    error: "failed",
  };
}

function sanitizeFailureMessage(message: string): string {
  const clean = message.trim();
  if (/^HTTP \d{3}(?: [A-Z0-9_-]+)?$/.test(clean)) {
    return clean;
  }
  if (safeStringValues.has(clean)) {
    return clean;
  }
  return "failed";
}

function escapeMarkdownCell(value: SummaryDetail | ""): string {
  return String(value)
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
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
