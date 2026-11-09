import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAccount } from "./accounts.js";
import { RingCentralApiError } from "./client.js";
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

function makeClient(chatType = "Team", email = "user@example.com") {
  return {
    getChat: vi.fn().mockResolvedValue({ id: "g1", type: chatType, name: "General" }),
    getPersonInfo: vi.fn().mockResolvedValue({ id: "u1", email }),
    sendPost: vi.fn().mockResolvedValue({ id: "sent-1" }),
    updatePost: vi.fn(),
    deletePost: vi.fn(),
    listThreadPosts: vi.fn().mockResolvedValue({ records: [] }),
    listPosts: vi.fn().mockResolvedValue({ records: [] }),
    listLegacyGroupPosts: vi.fn().mockResolvedValue({ records: [] }),
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
        sessionKey: "agent:main:ringcentral:channel:g1",
        mainSessionKey: "agent:main:ringcentral:channel:g1",
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

  it("strips any configured bot mention id, not the owner send identity", () => {
    expect(
      stripRcMentions("![:Person](bot-ext) summarize ![:Person](owner)", ["bot-ext", "bot-person"], {
        preserveNonBotMentions: true,
      }),
    ).toBe("summarize ![:Person](owner)");
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

  it("dispatches allowed team messages through OpenClaw runtime as channel sessions", async () => {
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
      expect.objectContaining({
        Body: "hello",
        BodyForAgent: "hello",
        CommandBody: "hello",
        ChatType: "channel",
        From: "team:g1",
        NativeChannelId: "g1",
        SessionKey: "agent:main:ringcentral:channel:g1",
      }),
    );
    expect(runtime.routing.resolveAgentRoute).toHaveBeenCalledWith(
      expect.objectContaining({ peer: { kind: "channel", id: "g1" } }),
    );
  });

  it("reports persistent 401 reply failures to the channel status callback", async () => {
    const runtime = makeRuntime();
    runtime.reply.dispatchReplyWithBufferedBlockDispatcher = vi.fn(async (args: any) => {
      args.dispatcherOptions.onError(
        new RingCentralApiError(401, '{"errorCode":"TokenInvalid"}'),
        { kind: "final" },
      );
      return { queuedFinal: false, counts: {} };
    });
    const reportAuthFailure = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
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
        reportAuthFailure,
      });
    } finally {
      errorSpy.mockRestore();
    }
    expect(reportAuthFailure).toHaveBeenCalledWith(expect.stringContaining("HTTP 401"));
  });

  it("routes threaded team messages to a thread-scoped session and injects thread context", async () => {
    const runtime = makeRuntime();
    const botClient = makeClient();
    botClient.listThreadPosts.mockResolvedValue({
      records: [
        {
          id: "thread-root",
          groupId: "g1",
          type: "TextMessage",
          text: "root question",
          creatorId: "u1",
          creationTime: "2026-01-01T00:00:00Z",
          lastModifiedTime: "2026-01-01T00:00:00Z",
        },
        {
          id: "older-reply",
          groupId: "g1",
          type: "TextMessage",
          text: "earlier reply",
          creatorId: "u2",
          threadId: "thread-root",
          parentPostId: "thread-root",
          creationTime: "2026-01-01T00:01:00Z",
          lastModifiedTime: "2026-01-01T00:01:00Z",
        },
        {
          id: "p1",
          groupId: "g1",
          type: "TextMessage",
          text: "current",
          creatorId: "u1",
          threadId: "thread-root",
          parentPostId: "older-reply",
          creationTime: "2026-01-01T00:02:00Z",
          lastModifiedTime: "2026-01-01T00:02:00Z",
        },
      ],
    });

    await handleInboundPost({
      post: makePost({
        text: "![:Person](bot) follow up",
        threadId: "thread-root",
        parentPostId: "older-reply",
      }),
      cfg: {},
      botClient,
      account: resolveAccount({
        botToken: "bot",
        groupPolicy: "open",
        requireMention: true,
        processingPlaceholder: { enabled: false },
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
    });

    expect(runtime.routing.resolveAgentRoute).toHaveBeenCalledWith(
      expect.objectContaining({ peer: { kind: "channel", id: "g1" } }),
    );
    expect(runtime.reply.finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        Body: "follow up",
        CommandBody: "follow up",
        BodyForCommands: "follow up",
        SessionKey: "agent:main:ringcentral:channel:g1:thread:thread-root",
        ReplyToId: "older-reply",
        RootMessageId: "thread-root",
        BodyForAgent: expect.stringContaining("[RingCentral thread context]"),
      }),
    );
    const ctx = runtime.reply.finalizeInboundContext.mock.calls[0][0];
    expect(ctx.BodyForAgent).toContain("root question");
    expect(ctx.BodyForAgent).toContain("earlier reply");
    expect(ctx.BodyForAgent).toContain("follow up");
    expect(ctx.BodyForAgent).not.toContain("\ncurrent\n");
    expect(ctx.Body).toBe("follow up");
  });

  it("uses distinct thread session keys for different threads in the same chat", async () => {
    const runtime = makeRuntime();
    const botClient = makeClient();
    const account = resolveAccount({
      botToken: "bot",
      groupPolicy: "open",
      requireMention: false,
      processingPlaceholder: { enabled: false },
    });

    await handleInboundPost({
      post: makePost({ id: "a1", text: "thread a", threadId: "thread-a" }),
      cfg: {},
      botClient,
      account,
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
    });
    await handleInboundPost({
      post: makePost({ id: "b1", text: "thread b", threadId: "thread-b" }),
      cfg: {},
      botClient,
      account,
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
    });

    const keys = runtime.reply.finalizeInboundContext.mock.calls.map(
      ([ctx]: [{ SessionKey: string }]) => ctx.SessionKey,
    );
    expect(keys).toEqual([
      "agent:main:ringcentral:channel:g1:thread:thread-a",
      "agent:main:ringcentral:channel:g1:thread:thread-b",
    ]);
  });

  it("still dispatches when thread history lookup fails", async () => {
    const runtime = makeRuntime();
    const botClient = makeClient();
    botClient.listThreadPosts.mockRejectedValue(new Error("thread api down"));
    botClient.listPosts.mockRejectedValue(new Error("chat api down"));
    botClient.listLegacyGroupPosts.mockRejectedValue(new Error("legacy down"));

    await handleInboundPost({
      post: makePost({
        text: "![:Person](bot) still answer",
        threadId: "thread-root",
      }),
      cfg: {},
      botClient,
      account: resolveAccount({
        botToken: "bot",
        groupPolicy: "open",
        requireMention: true,
        processingPlaceholder: { enabled: false },
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
    });

    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledOnce();
    expect(runtime.reply.finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        Body: "still answer",
        BodyForAgent: "still answer",
        SessionKey: "agent:main:ringcentral:channel:g1:thread:thread-root",
      }),
    );
  });

  it("requires mentions by default when groupPolicy is open", async () => {
    const runtime = makeRuntime();
    const log = vi.fn();
    await handleInboundPost({
      post: makePost({ text: "plain group message" }),
      cfg: {},
      botClient: makeClient(),
      account: resolveAccount({
        botToken: "bot",
        groupPolicy: "open",
        debugInboundMessages: true,
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

  function dualUserAccount() {
    return resolveAccount({
      conversationIdentity: "user",
      botToken: "bot",
      botExtensionId: "bot-ext",
      ownerCredentials: { clientId: "id", clientSecret: "secret", jwt: "jwt" },
      groupPolicy: "open",
      requireMention: true,
      debugInboundMessages: true,
      processingPlaceholder: { enabled: false },
    });
  }

  it("in dual-account user identity mode, @bot still activates requireMention", async () => {
    const runtime = makeRuntime();
    const client = makeClient();
    await handleInboundPost({
      post: makePost({
        text: "![:Person](bot-ext) need the bot",
        mentions: [{ id: "bot-ext", type: "Person" }],
      }),
      cfg: {},
      botClient: client,
      ownerClient: client,
      account: dualUserAccount(),
      botPersonId: "bot-person",
      ownerPersonId: "owner",
      assistantPersonId: "owner",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
    });

    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledOnce();
    expect(runtime.reply.finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        Body: "need the bot",
        BodyForAgent: "need the bot",
      }),
    );
  });

  it("in dual-account user identity mode, @owner does not activate requireMention", async () => {
    const runtime = makeRuntime();
    const log = vi.fn();
    const client = makeClient();
    await handleInboundPost({
      post: makePost({
        text: "![:Person](owner) hey human",
        mentions: [{ id: "owner", type: "Person" }],
      }),
      cfg: {},
      botClient: client,
      ownerClient: client,
      account: dualUserAccount(),
      botPersonId: "bot-person",
      ownerPersonId: "owner",
      assistantPersonId: "owner",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
      log,
    });

    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    const drop = loggedMessages(log).find((message) => message.startsWith("[ringcentral] inbound message dropped "));
    expect(drop).toContain('"reasonCode":"activation_skipped"');
  });

  it("in dual-account user identity mode, API mentions of the bot person id activate", async () => {
    const runtime = makeRuntime();
    const client = makeClient();
    await handleInboundPost({
      post: makePost({
        text: "plain text with structured mention",
        mentions: [{ id: "bot-person", type: "Person" }],
      }),
      cfg: {},
      botClient: client,
      ownerClient: client,
      account: dualUserAccount(),
      botPersonId: "bot-person",
      ownerPersonId: "owner",
      assistantPersonId: "owner",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
    });

    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledOnce();
  });

  it("in pure user identity mode with no bot, @owner still activates", async () => {
    const runtime = makeRuntime();
    const client = makeClient();
    await handleInboundPost({
      post: makePost({
        text: "![:Person](owner) hey",
        mentions: [{ id: "owner", type: "Person" }],
      }),
      cfg: {},
      ownerClient: client,
      account: resolveAccount({
        conversationIdentity: "user",
        ownerCredentials: { clientId: "id", clientSecret: "secret", jwt: "jwt" },
        groupPolicy: "open",
        requireMention: true,
        processingPlaceholder: { enabled: false },
      }),
      ownerPersonId: "owner",
      assistantPersonId: "owner",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
    });

    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledOnce();
  });

  it("treats tracked RingCentral thread ids as thread follow-ups without another mention", async () => {
    const runtime = makeRuntime();
    const tracker = new ThreadParticipationTracker();
    tracker.remember("bot-reply", "thread-root");

    await handleInboundPost({
      post: makePost({
        parentPostId: undefined,
        threadId: "thread-root",
        text: "thread follow-up without mention",
      }),
      cfg: {},
      botClient: makeClient(),
      account: resolveAccount({
        botToken: "bot",
        groupPolicy: "open",
        requireMention: true,
        threadRequireMention: false,
        processingPlaceholder: { enabled: false },
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker,
    });

    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledOnce();
  });

  it("remembers admitted root posts so later thread replies can skip another mention", async () => {
    const runtime = makeRuntime();
    const tracker = new ThreadParticipationTracker();
    const account = resolveAccount({
      botToken: "bot",
      groupPolicy: "open",
      requireMention: true,
      threadRequireMention: false,
      processingPlaceholder: { enabled: false },
    });

    await handleInboundPost({
      post: makePost({
        id: "root-user-post",
        text: "![:Person](bot) start a thread",
        mentions: [{ id: "bot", type: "Person" }],
      }),
      cfg: {},
      botClient: makeClient(),
      account,
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker,
    });

    await handleInboundPost({
      post: makePost({
        id: "followup-post",
        parentPostId: "root-user-post",
        text: "follow-up without mention",
      }),
      cfg: {},
      botClient: makeClient(),
      account,
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker,
    });

    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(2);
  });

  it("logs accepted dispatch start, still-pending, and complete diagnostics", async () => {
    vi.useFakeTimers();
    try {
      const runtime = makeRuntime();
      const log = vi.fn();
      let resolveDispatch: ((value: { queuedFinal: boolean; counts: Record<string, never> }) => void) | undefined;
      runtime.reply.dispatchReplyWithBufferedBlockDispatcher.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveDispatch = resolve;
          }),
      );

      const pending = handleInboundPost({
        post: makePost({ groupId: "pending-chat", threadId: "thread-root" }),
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

      await vi.waitFor(() => {
        expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledOnce();
      });
      expect(loggedMessages(log).some((message) => message.startsWith("[ringcentral] inbound dispatch start "))).toBe(true);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(loggedMessages(log).some((message) => message.startsWith("[ringcentral] inbound dispatch still_pending "))).toBe(true);

      resolveDispatch?.({ queuedFinal: false, counts: {} });
      await pending;
      expect(loggedMessages(log).some((message) => message.startsWith("[ringcentral] inbound dispatch complete "))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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
    expect(message).toContain('"chatType":"channel"');
    expect(message).toContain('"textLength":8');
    expect(message).toContain('"text":"debug me"');
  });

  it("drops teams when groupPolicy is disabled", async () => {
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

  it("allows DM senders by stable person ID", async () => {
    const runtime = makeRuntime();
    await handleInboundPost({
      post: makePost({ groupId: "dm1", creatorId: "u-owner" }),
      cfg: {},
      botClient: makeClient("Direct", "owner@example.com"),
      account: resolveAccount({
        botToken: "bot",
        dmPolicy: "allowlist",
        allowFrom: ["u-owner"],
        processingPlaceholder: { enabled: false },
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
    });
    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledOnce();
  });

  it("rejects email allowFrom entries unless dangerous email matching is enabled", async () => {
    const runtime = makeRuntime();
    await handleInboundPost({
      post: makePost({ groupId: "dm1", creatorId: "u-owner" }),
      cfg: {},
      botClient: makeClient("Direct", "owner@example.com"),
      account: resolveAccount({
        botToken: "bot",
        dmPolicy: "allowlist",
        allowFrom: ["owner@example.com"],
        processingPlaceholder: { enabled: false },
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
      log: vi.fn(),
    });
    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });

  it("allows email allowFrom entries when dangerous email matching is enabled", async () => {
    const runtime = makeRuntime();
    await handleInboundPost({
      post: makePost({ groupId: "dm1", creatorId: "u-owner" }),
      cfg: {},
      botClient: makeClient("Direct", "owner@example.com"),
      account: resolveAccount({
        botToken: "bot",
        dmPolicy: "allowlist",
        allowFrom: ["owner@example.com"],
        dangerouslyAllowEmailMatching: true,
        processingPlaceholder: { enabled: false },
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
    });
    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledOnce();
  });

  it("ignores RingCentral group DMs by default", async () => {
    const runtime = makeRuntime();
    await handleInboundPost({
      post: makePost({ groupId: "gdm1" }),
      cfg: {},
      botClient: makeClient("Group"),
      account: resolveAccount({
        botToken: "bot",
        groupPolicy: "open",
        processingPlaceholder: { enabled: false },
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
      log: vi.fn(),
    });
    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });

  it("dispatches allowlisted RingCentral group DMs", async () => {
    const runtime = makeRuntime();
    await handleInboundPost({
      post: makePost({ groupId: "gdm1" }),
      cfg: {},
      botClient: makeClient("Group"),
      account: resolveAccount({
        botToken: "bot",
        dm: { groupEnabled: true, groupChannels: { gdm1: { allow: true, requireMention: false } } },
        processingPlaceholder: { enabled: false },
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
    });
    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledOnce();
    expect(runtime.reply.finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({ ChatType: "group", From: "group:gdm1" }),
    );
  });

  it("blocks unlisted RingCentral group DMs even when mentioned", async () => {
    const runtime = makeRuntime();
    const log = vi.fn();
    await handleInboundPost({
      post: makePost({ groupId: "unlisted", text: "![:Person](bot) hello" }),
      cfg: {},
      botClient: makeClient("Group"),
      account: resolveAccount({
        botToken: "bot",
        requireMention: true,
        dm: { groupEnabled: true, groupChannels: { gdm1: { allow: true } } },
        debugInboundMessages: true,
        processingPlaceholder: { enabled: false },
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
      log,
    });

    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    const drop = loggedMessages(log).find((message) => message.startsWith("[ringcentral] inbound message dropped "));
    expect(drop).toContain('"reasonCode":"route_blocked"');
  });

  it("applies Group DM wildcard defaults before an explicit allowlist entry", async () => {
    const runtime = makeRuntime();
    await handleInboundPost({
      post: makePost({ groupId: "gdm1" }),
      cfg: {},
      botClient: makeClient("Group"),
      account: resolveAccount({
        botToken: "bot",
        dm: {
          groupEnabled: true,
          groupChannels: {
            "*": { allow: false, requireMention: true },
            gdm1: { allow: true, requireMention: false },
          },
        },
        processingPlaceholder: { enabled: false },
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
    });

    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledOnce();
  });

  it("applies a Group DM wildcard default-deny to unlisted conversations", async () => {
    const runtime = makeRuntime();
    await handleInboundPost({
      post: makePost({ groupId: "unlisted", text: "![:Person](bot) hello" }),
      cfg: {},
      botClient: makeClient("Group"),
      account: resolveAccount({
        botToken: "bot",
        requireMention: true,
        dm: {
          groupEnabled: true,
          groupChannels: { "*": { allow: false }, gdm1: { allow: true } },
        },
        processingPlaceholder: { enabled: false },
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
    });

    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
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

  it("creates a typing post at dispatch start when enabled, without waiting for onReplyStart", async () => {
    const runtime = makeRuntime();
    const client = makeClient();
    const log = vi.fn();
    // Simulate typingMode=message: OpenClaw never calls onReplyStart while the
    // agent is still processing (approval wait / tools with no renderable text).
    runtime.reply.dispatchReplyWithBufferedBlockDispatcher.mockImplementationOnce(async (params: any) => {
      await params.dispatcherOptions.deliver({ text: "final reply" });
      await params.dispatcherOptions.onCleanup();
      return { queuedFinal: false, counts: {} };
    });

    await handleInboundPost({
      post: makePost({ groupId: "typing-early-start-chat" }),
      cfg: {},
      botClient: client,
      account: resolveAccount({
        botToken: "bot",
        groupPolicy: "open",
        requireMention: false,
        processingPlaceholder: { enabled: true },
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
      log,
    });

    expect(client.sendPost).toHaveBeenCalledTimes(2);
    expect(client.sendPost).toHaveBeenNthCalledWith(1, "typing-early-start-chat", "\u{1F440}", {
      parentPostId: "p1",
    });
    expect(client.sendPost).toHaveBeenNthCalledWith(2, "typing-early-start-chat", "final reply", {
      parentPostId: "p1",
    });
    expect(client.deletePost).toHaveBeenCalledWith("typing-early-start-chat", "sent-1");
    expect(
      loggedMessages(log).some((m) =>
        m.includes("created typing post postId=sent-1 chatId=typing-early-start-chat"),
      ),
    ).toBe(true);
  });

  it("does not create a second typing post when onReplyStart fires after early start", async () => {
    const runtime = makeRuntime();
    const client = makeClient();
    runtime.reply.dispatchReplyWithBufferedBlockDispatcher.mockImplementationOnce(async (params: any) => {
      await params.dispatcherOptions.onReplyStart();
      await params.dispatcherOptions.onReplyStart();
      await params.dispatcherOptions.deliver({ text: "final reply" });
      await params.dispatcherOptions.onCleanup();
      return { queuedFinal: false, counts: {} };
    });

    await handleInboundPost({
      post: makePost({ groupId: "typing-dedupe-chat" }),
      cfg: {},
      botClient: client,
      account: resolveAccount({
        botToken: "bot",
        groupPolicy: "open",
        requireMention: false,
        processingPlaceholder: { enabled: true },
      }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
    });

    // Early start + two onReplyStart calls must still yield one typing post + one reply.
    expect(client.sendPost).toHaveBeenCalledTimes(2);
    expect(client.sendPost).toHaveBeenNthCalledWith(1, "typing-dedupe-chat", "\u{1F440}", {
      parentPostId: "p1",
    });
    expect(client.deletePost).toHaveBeenCalledTimes(1);
  });

  it("edits the typing emoji once, deletes it before the actual reply, and does not edit it into reply text", async () => {
    vi.useFakeTimers();
    try {
      const runtime = makeRuntime();
      const client = makeClient();
      const log = vi.fn();
      runtime.reply.dispatchReplyWithBufferedBlockDispatcher.mockImplementationOnce(async (params: any) => {
        await params.dispatcherOptions.onReplyStart();
        await vi.advanceTimersByTimeAsync(2000);
        await params.dispatcherOptions.deliver({ text: "final reply" });
        await params.dispatcherOptions.onCleanup();
        return { queuedFinal: false, counts: {} };
      });

      await handleInboundPost({
        post: makePost({ groupId: "typing-lifecycle-chat" }),
        cfg: {},
        botClient: client,
        account: resolveAccount({
          botToken: "bot",
          groupPolicy: "open",
          requireMention: false,
          processingPlaceholder: { enabled: true },
        }),
        botPersonId: "bot",
        channelRuntime: runtime,
        tracker: new ThreadParticipationTracker(),
        log,
      });

      expect(client.sendPost).toHaveBeenCalledTimes(2);
      expect(client.sendPost).toHaveBeenNthCalledWith(1, "typing-lifecycle-chat", "\u{1F440}", {
        parentPostId: "p1",
      });
      expect(client.updatePost).toHaveBeenCalledTimes(1);
      expect(client.updatePost).toHaveBeenCalledWith("typing-lifecycle-chat", "sent-1", "\u{23F3}");
      expect(client.updatePost).not.toHaveBeenCalledWith(
        "typing-lifecycle-chat",
        "sent-1",
        "final reply",
      );
      expect(client.deletePost).toHaveBeenCalledTimes(1);
      expect(client.deletePost).toHaveBeenCalledWith("typing-lifecycle-chat", "sent-1");
      expect(client.sendPost).toHaveBeenNthCalledWith(2, "typing-lifecycle-chat", "final reply", {
        parentPostId: "p1",
      });
      expect(client.deletePost.mock.invocationCallOrder[0]).toBeLessThan(
        client.sendPost.mock.invocationCallOrder[1],
      );

      const messages = loggedMessages(log);
      expect(messages.some((m) => m.includes("created typing post postId=sent-1 chatId=typing-lifecycle-chat"))).toBe(true);
      expect(messages.some((m) => m.includes("deleted typing post postId=sent-1 chatId=typing-lifecycle-chat"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the delayed edit when cleanup happens before the edit delay", async () => {
    vi.useFakeTimers();
    try {
      const runtime = makeRuntime();
      const client = makeClient();
      runtime.reply.dispatchReplyWithBufferedBlockDispatcher.mockImplementationOnce(async (params: any) => {
        await params.dispatcherOptions.onReplyStart();
        await params.dispatcherOptions.onCleanup();
        await vi.advanceTimersByTimeAsync(2000);
        return { queuedFinal: false, counts: {} };
      });

      await handleInboundPost({
        post: makePost({ groupId: "typing-cleanup-chat" }),
        cfg: {},
        botClient: client,
        account: resolveAccount({
          botToken: "bot",
          groupPolicy: "open",
          requireMention: false,
          processingPlaceholder: { enabled: true },
        }),
        botPersonId: "bot",
        channelRuntime: runtime,
        tracker: new ThreadParticipationTracker(),
      });

      expect(client.sendPost).toHaveBeenCalledTimes(1);
      expect(client.updatePost).not.toHaveBeenCalled();
      expect(client.deletePost).toHaveBeenCalledWith("typing-cleanup-chat", "sent-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("failsafe deletes the typing post when the dispatcher never delivers or cleans up", async () => {
    vi.useFakeTimers();
    try {
      const runtime = makeRuntime();
      const client = makeClient();
      const log = vi.fn();
      runtime.reply.dispatchReplyWithBufferedBlockDispatcher.mockImplementationOnce(async (params: any) => {
        await params.dispatcherOptions.onReplyStart();
        await vi.advanceTimersByTimeAsync(120_000);
        return { queuedFinal: false, counts: {} };
      });

      await handleInboundPost({
        post: makePost({ groupId: "typing-failsafe-chat" }),
        cfg: {},
        botClient: client,
        account: resolveAccount({
          botToken: "bot",
          groupPolicy: "open",
          requireMention: false,
          processingPlaceholder: { enabled: true },
        }),
        botPersonId: "bot",
        channelRuntime: runtime,
        tracker: new ThreadParticipationTracker(),
        log,
      });

      expect(client.sendPost).toHaveBeenCalledTimes(1);
      expect(client.updatePost).toHaveBeenCalledWith("typing-failsafe-chat", "sent-1", "\u{23F3}");
      expect(client.deletePost).toHaveBeenCalledTimes(1);
      expect(client.deletePost).toHaveBeenCalledWith("typing-failsafe-chat", "sent-1");

      const messages = loggedMessages(log);
      expect(messages.some((message) => message.includes("typing post failsafe cleanup postId=sent-1 chatId=typing-failsafe-chat"))).toBe(true);
      expect(messages.some((message) => message.includes("deleted typing post postId=sent-1 chatId=typing-failsafe-chat"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not create, edit, or delete a typing post when the processing placeholder is disabled", async () => {
    const runtime = makeRuntime();
    const client = makeClient();
    runtime.reply.dispatchReplyWithBufferedBlockDispatcher.mockImplementationOnce(async (params: any) => {
      await params.dispatcherOptions.onReplyStart();
      await params.dispatcherOptions.deliver({ text: "final reply" });
      await params.dispatcherOptions.onCleanup();
      return { queuedFinal: false, counts: {} };
    });

    await handleInboundPost({
      post: makePost({ groupId: "typing-disabled-chat" }),
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

    expect(client.sendPost).toHaveBeenCalledTimes(1);
    expect(client.sendPost).toHaveBeenCalledWith("typing-disabled-chat", "final reply", {
      parentPostId: "p1",
    });
    expect(client.updatePost).not.toHaveBeenCalled();
    expect(client.deletePost).not.toHaveBeenCalled();
  });

  it("deliver retries and warns when deletePost is persistently rejected, then still sends the actual reply", async () => {
    vi.useFakeTimers();
    try {
      const runtime = makeRuntime();
      const client = makeClient();
      const log = vi.fn();
      client.deletePost.mockRejectedValue(new Error("delete denied"));
      runtime.reply.dispatchReplyWithBufferedBlockDispatcher.mockImplementationOnce(async (params: any) => {
        await params.dispatcherOptions.onReplyStart();
        const delivered = params.dispatcherOptions.deliver({ text: "final reply" });
        await vi.advanceTimersByTimeAsync(250);
        await delivered;
        await params.dispatcherOptions.onCleanup();
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
          processingPlaceholder: { enabled: true },
        }),
        botPersonId: "bot",
        channelRuntime: runtime,
        tracker: new ThreadParticipationTracker(),
        log,
      });

      // Retry once, then give up; total 2 deletePost calls.
      expect(client.deletePost).toHaveBeenCalledTimes(2);
      expect(client.sendPost).toHaveBeenCalledTimes(2);
      expect(client.sendPost).toHaveBeenNthCalledWith(2, "typing-stuck-chat", "final reply", {
        parentPostId: "p1",
      });
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
