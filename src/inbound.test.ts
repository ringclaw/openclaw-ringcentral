import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAccount } from "./accounts.js";
import { handleInboundPost, stripRcMentions } from "./inbound.js";
import { ThreadParticipationTracker } from "./threading.js";
import type { Post } from "./types.js";

const saveMediaBufferMock = vi.hoisted(() => vi.fn());

vi.mock("openclaw/plugin-sdk/media-runtime", () => ({
  saveMediaBuffer: saveMediaBufferMock,
  buildAgentMediaPayload: (mediaList: Array<{ path: string; contentType?: string | null }>) => ({
    MediaPath: mediaList[0]?.path,
    MediaUrl: mediaList[0]?.path,
    MediaType: mediaList[0]?.contentType ?? undefined,
    MediaPaths: mediaList.map((media) => media.path),
    MediaUrls: mediaList.map((media) => media.path),
    MediaTypes: mediaList.map((media) => media.contentType ?? ""),
  }),
}));

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "p1",
    groupId: "g1",
    type: "TextMessage",
    text: "hello",
    creatorId: "u1",
    creationTime: "2026-01-01T00:00:00Z",
    lastModifiedTime: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeClient(chatType = "Group", email = "user@example.com") {
  return {
    getChat: vi.fn().mockResolvedValue({ id: "g1", type: chatType, name: "General" }),
    getPersonInfo: vi.fn().mockResolvedValue({ id: "u1", email }),
    sendPost: vi.fn().mockResolvedValue({ id: "sent-1" }),
    updatePost: vi.fn(),
    deletePost: vi.fn(),
    downloadAttachment: vi.fn().mockResolvedValue({
      buffer: Buffer.from("image"),
      contentType: "image/png",
      fileName: "image.png",
      size: 5,
    }),
  } as any;
}

function makeRuntime() {
  return {
    routing: {
      resolveAgentRoute: vi.fn(() => ({
        agentId: "main",
        accountId: "default",
        channel: "ringcentral",
        sessionKey: "agent:main:ringcentral:group:g1",
        mainSessionKey: "agent:main:ringcentral:group:g1",
        lastRoutePolicy: "session",
        matchedBy: "default",
      })),
    },
    reply: {
      finalizeInboundContext: vi.fn((ctx) => ctx),
      dispatchReplyWithBufferedBlockDispatcher: vi.fn(async () => ({
        queuedFinal: false,
        counts: {},
      })),
    },
  };
}

function loggedMessages(log: ReturnType<typeof vi.fn>): string[] {
  return log.mock.calls.map(([message]) => String(message));
}

describe("stripRcMentions", () => {
  it("removes leading bot mentions and inline mentions", () => {
    expect(stripRcMentions("![:Person](bot) summarize ![:Person](u2)", "bot")).toBe("summarize");
  });

  it("preserves non-bot mentions when requested", () => {
    expect(
      stripRcMentions("![:Person](bot) summarize ![:Team](g1)", "bot", {
        preserveNonBotMentions: true,
      }),
    ).toBe("summarize ![:Team](g1)");
  });
});

describe("handleInboundPost", () => {
  beforeEach(() => {
    saveMediaBufferMock.mockReset();
    saveMediaBufferMock.mockResolvedValue({
      id: "image---saved.png",
      path: "/tmp/openclaw/media/inbound/image---saved.png",
      contentType: "image/png",
      size: 5,
    });
  });

  it("dispatches allowed group messages through OpenClaw runtime", async () => {
    const runtime = makeRuntime();
    await handleInboundPost({
      post: makePost(),
      cfg: {},
      botClient: makeClient(),
      account: resolveAccount({
        botToken: "bot",
        groupPolicy: "open",
        requireMention: false,
        processingPlaceholder: { enabled: false },
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
    });
    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledOnce();
    expect(runtime.reply.finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({ BodyForAgent: "hello", NativeChannelId: "g1" }),
    );
  });

  it("does not require mentions by default when groupPolicy is open", async () => {
    const runtime = makeRuntime();
    await handleInboundPost({
      post: makePost({ text: "plain group message" }),
      cfg: {},
      botClient: makeClient(),
      account: resolveAccount({
        botToken: "bot",
        groupPolicy: "open",
        processingPlaceholder: { enabled: false },
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
    });

    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledOnce();
  });

  it("honors explicit requireMention when groupPolicy is open", async () => {
    const runtime = makeRuntime();
    const log = vi.fn();
    await handleInboundPost({
      post: makePost({ text: "plain group message" }),
      cfg: {},
      botClient: makeClient(),
      account: resolveAccount({
        botToken: "bot",
        debugInboundMessages: true,
        groupPolicy: "open",
        requireMention: true,
        processingPlaceholder: { enabled: false },
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
      log,
    });

    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    const drop = loggedMessages(log).find((message) => message.startsWith("[ringcentral] inbound message dropped "));
    expect(drop).toContain('"reasonCode":"activation_skipped"');
    expect(drop).toContain('"groupPolicy":"open"');
    expect(drop).toContain('"requireMention":true');
  });

  it("does not log inbound message text by default", async () => {
    const runtime = makeRuntime();
    const log = vi.fn();
    await handleInboundPost({
      post: makePost({ text: "private debug text" }),
      cfg: {},
      botClient: makeClient(),
      account: resolveAccount({
        botToken: "bot",
        groupPolicy: "open",
        requireMention: false,
        processingPlaceholder: { enabled: false },
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
      log,
    });

    expect(loggedMessages(log).some((message) => message.includes("private debug text"))).toBe(false);
    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledOnce();
  });

  it("logs inbound message text when debug logging is enabled", async () => {
    const runtime = makeRuntime();
    const log = vi.fn();
    await handleInboundPost({
      post: makePost({ text: "debug me" }),
      cfg: {},
      botClient: makeClient(),
      account: resolveAccount({
        botToken: "bot",
        debugInboundMessages: true,
        groupPolicy: "open",
        requireMention: false,
        processingPlaceholder: { enabled: false },
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
      log,
    });

    const message = loggedMessages(log).find((entry) => entry.startsWith("[ringcentral] inbound message "));
    expect(message).toContain('"chatId":"g1"');
    expect(message).toContain('"creatorId":"u1"');
    expect(message).toContain('"chatType":"group"');
    expect(message).toContain('"textLength":8');
    expect(message).toContain('"text":"debug me"');
  });

  it("drops groups when groupPolicy is disabled", async () => {
    const runtime = makeRuntime();
    const client = makeClient();
    await handleInboundPost({
      post: makePost({
        attachments: [
          { id: "a1", type: "File", contentUri: "https://content.example.test/a.png" },
        ],
      }),
      cfg: {},
      botClient: client,
      account: resolveAccount({ botToken: "bot", groupPolicy: "disabled" }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
      log: vi.fn(),
    });
    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    expect(client.downloadAttachment).not.toHaveBeenCalled();
    expect(saveMediaBufferMock).not.toHaveBeenCalled();
  });

  it("logs a non-debug drop warning once per chat without message text", async () => {
    const runtime = makeRuntime();
    const client = makeClient();
    const log = vi.fn();
    const post = makePost({
      groupId: "warn-chat",
      text: "private skipped text",
      attachments: [
        {
          id: "a1",
          type: "File",
          contentUri: "https://content.example.test/private.png",
          name: "private.png",
        },
      ],
    });

    for (let i = 0; i < 2; i += 1) {
      await handleInboundPost({
        post,
        cfg: {},
        botClient: client,
        account: resolveAccount({ botToken: "bot", groupPolicy: "disabled" }),
        botPersonId: "bot",
        channelRuntime: runtime,
        tracker: new ThreadParticipationTracker(),
        log,
      });
    }

    const messages = loggedMessages(log);
    const warnings = messages.filter((message) => message.startsWith("[ringcentral] WARN inbound message dropped "));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"chatId":"warn-chat"');
    expect(warnings[0]).toContain('"groupPolicy":"disabled"');
    expect(warnings[0]).toContain('"requireMention":true');
    expect(warnings[0]).toContain('"debugHint"');
    expect(messages.join("\n")).not.toContain("private skipped text");
    expect(messages.join("\n")).not.toContain("https://content.example.test/private.png");
    expect(messages.join("\n")).not.toContain("private.png");
    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    expect(client.downloadAttachment).not.toHaveBeenCalled();
  });

  it("logs debug drop summary without attachment details", async () => {
    const runtime = makeRuntime();
    const client = makeClient();
    const log = vi.fn();
    await handleInboundPost({
      post: makePost({
        text: "drop me",
        attachments: [
          {
            id: "a1",
            type: "File",
            contentUri: "https://content.example.test/a.png",
            name: "secret.png",
          },
        ],
      }),
      cfg: {},
      botClient: client,
      account: resolveAccount({
        botToken: "bot",
        debugInboundMessages: true,
        groupPolicy: "disabled",
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
      log,
    });

    const messages = loggedMessages(log);
    expect(messages.some((message) => message.includes('"text":"drop me"'))).toBe(true);
    const drop = messages.find((message) => message.startsWith("[ringcentral] inbound message dropped "));
    expect(drop).toContain('"chatId":"g1"');
    expect(drop).toContain('"textLength":7');
    expect(drop).toContain("reasonCode");
    expect(messages.join("\n")).not.toContain("https://content.example.test/a.png");
    expect(messages.join("\n")).not.toContain("secret.png");
    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    expect(client.downloadAttachment).not.toHaveBeenCalled();
  });

  it("allows DM senders by email alias", async () => {
    const runtime = makeRuntime();
    await handleInboundPost({
      post: makePost({ groupId: "dm1", creatorId: "u-owner" }),
      cfg: {},
      botClient: makeClient("Direct", "owner@example.com"),
      account: resolveAccount({
        botToken: "bot",
        dm: { policy: "allowlist" },
        allowedUserEmails: ["owner@example.com"],
        processingPlaceholder: { enabled: false },
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
    });
    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledOnce();
  });

  it("downloads admitted attachments into OpenClaw inbound media payload", async () => {
    const runtime = makeRuntime();
    const client = makeClient();
    await handleInboundPost({
      post: makePost({
        attachments: [
          {
            id: "a1",
            type: "File",
            contentUri: "https://content.example.test/a.png",
            name: "image.png",
            contentType: "image/png",
          },
        ],
      }),
      cfg: {},
      botClient: client,
      account: resolveAccount({
        botToken: "bot",
        groupPolicy: "open",
        requireMention: false,
        processingPlaceholder: { enabled: false },
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
    });

    expect(client.downloadAttachment).toHaveBeenCalledWith({
      uri: "https://content.example.test/a.png",
      fileName: "image.png",
      contentType: "image/png",
      maxBytes: 5 * 1024 * 1024,
    });
    expect(saveMediaBufferMock).toHaveBeenCalledWith(
      Buffer.from("image"),
      "image/png",
      "inbound",
      5 * 1024 * 1024,
      "image.png",
    );
    expect(runtime.reply.finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        MediaPath: "/tmp/openclaw/media/inbound/image---saved.png",
        MediaType: "image/png",
        MediaPaths: ["/tmp/openclaw/media/inbound/image---saved.png"],
      }),
    );
  });

  it("deliver promotes the typing post to the reply in place; cleanup is a no-op", async () => {
    const runtime = makeRuntime();
    const client = makeClient();
    const log = vi.fn();
    runtime.reply.dispatchReplyWithBufferedBlockDispatcher.mockImplementationOnce(async (params: any) => {
      await params.dispatcherOptions.onReplyStart();
      const delivered = params.dispatcherOptions.deliver({ text: "final reply" });
      await delivered;
      // TypingController.cleanup() drives the platform's `onCleanup` after dispatch idle.
      await params.dispatcherOptions.onCleanup();
      return { queuedFinal: false, counts: {} };
    });

    await handleInboundPost({
      post: makePost({ groupId: "typing-promote-chat" }),
      cfg: {},
      botClient: client,
      account: resolveAccount({
        botToken: "bot",
        groupPolicy: "open",
        requireMention: false,
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
      log,
    });

    // 1. onReplyStart: post the 👀 once
    expect(client.sendPost).toHaveBeenCalledTimes(1);
    expect(client.sendPost).toHaveBeenNthCalledWith(1, "typing-promote-chat", "\u{1F440}", {
      parentPostId: "p1",
    });
    // 2. deliver: update the typing post in place to the reply; no new message, no delete
    expect(client.updatePost).toHaveBeenCalledTimes(1);
    expect(client.updatePost).toHaveBeenCalledWith("typing-promote-chat", "sent-1", "final reply");
    // 3. onCleanup: no-op (typing post was promoted, no longer in the closure)
    expect(client.deletePost).not.toHaveBeenCalled();

    const messages = loggedMessages(log);
    expect(messages.some((m) => m.includes("created typing post postId=sent-1 chatId=typing-promote-chat"))).toBe(true);
    expect(messages.some((m) => m.includes("typing post promoted to reply postId=sent-1 chatId=typing-promote-chat"))).toBe(true);
    expect(messages.some((m) => m.includes("deleted typing post"))).toBe(false);
  });

  it("deliver falls back to clear+new when updatePost fails", async () => {
    const runtime = makeRuntime();
    const client = makeClient();
    const log = vi.fn();
    client.updatePost.mockRejectedValueOnce(new Error("edit race"));
    runtime.reply.dispatchReplyWithBufferedBlockDispatcher.mockImplementationOnce(async (params: any) => {
      await params.dispatcherOptions.onReplyStart();
      const delivered = params.dispatcherOptions.deliver({ text: "final reply" });
      await delivered;
      await params.dispatcherOptions.onCleanup();
      return { queuedFinal: false, counts: {} };
    });

    await handleInboundPost({
      post: makePost({ groupId: "typing-fallback-chat" }),
      cfg: {},
      botClient: client,
      account: resolveAccount({
        botToken: "bot",
        groupPolicy: "open",
        requireMention: false,
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
      log,
    });

    // 1. sendPost: 1 for the typing post (👀) + 1 for the fallback reply
    expect(client.sendPost).toHaveBeenCalledTimes(2);
    expect(client.sendPost).toHaveBeenNthCalledWith(1, "typing-fallback-chat", "\u{1F440}", { parentPostId: "p1" });
    expect(client.sendPost).toHaveBeenNthCalledWith(2, "typing-fallback-chat", "final reply", { parentPostId: "p1" });
    // 2. updatePost: 1 call that failed
    expect(client.updatePost).toHaveBeenCalledTimes(1);
    // 3. deletePost: 1 (from the fallback path, succeeded)
    expect(client.deletePost).toHaveBeenCalledTimes(1);
    expect(client.deletePost).toHaveBeenCalledWith("typing-fallback-chat", "sent-1");

    const messages = loggedMessages(log);
    expect(messages.some((m) => m.includes("failed to update typing post, falling back to new message"))).toBe(true);
    expect(messages.some((m) => m.includes("created typing post postId=sent-1 chatId=typing-fallback-chat"))).toBe(true);
    expect(messages.some((m) => m.includes("deleted typing post postId=sent-1 chatId=typing-fallback-chat"))).toBe(true);
  });

  it("onCleanup retries and warns when deletePost is persistently rejected", async () => {
    vi.useFakeTimers();
    try {
      const runtime = makeRuntime();
      const client = makeClient();
      const log = vi.fn();
      // Skip deliver entirely (simulate: agent never produces a reply).
      client.deletePost.mockRejectedValue(new Error("delete denied"));
      runtime.reply.dispatchReplyWithBufferedBlockDispatcher.mockImplementationOnce(async (params: any) => {
        await params.dispatcherOptions.onReplyStart();
        const cleanup = params.dispatcherOptions.onCleanup();
        await vi.advanceTimersByTimeAsync(250);
        await cleanup;
        return { queuedFinal: false, counts: {} };
      });

      await handleInboundPost({
        post: makePost({ groupId: "typing-stuck-chat" }),
        cfg: {},
        botClient: client,
        account: resolveAccount({
          botToken: "bot",
          groupPolicy: "open",
          requireMention: false,
        }),
        botPersonId: "bot",
        channelRuntime: runtime,
        tracker: new ThreadParticipationTracker(),
        log,
      });

      // Retry once, then give up; total 2 deletePost calls.
      expect(client.deletePost).toHaveBeenCalledTimes(2);
      const messages = loggedMessages(log);
      expect(messages.some((message) => message.includes("typing post stuck after delete retry"))).toBe(true);
      expect(messages.join("\n")).toContain('"chatId":"typing-stuck-chat"');
      expect(messages.join("\n")).toContain('"postId":"sent-1"');
      expect(messages.join("\n")).toContain('"error":"Error: delete denied"');
      expect(messages.some((message) => message.includes("deleted typing post postId=sent-1"))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
