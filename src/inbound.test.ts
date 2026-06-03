import { describe, expect, it, vi } from "vitest";
import { resolveAccount } from "./accounts.js";
import { handleInboundPost, stripRcMentions } from "./inbound.js";
import { ThreadParticipationTracker } from "./threading.js";
import type { Post } from "./types.js";

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

  it("drops groups when groupPolicy is disabled", async () => {
    const runtime = makeRuntime();
    await handleInboundPost({
      post: makePost(),
      cfg: {},
      botClient: makeClient(),
      account: resolveAccount({ botToken: "bot", groupPolicy: "disabled" }),
      botPersonId: "bot",
      channelRuntime: runtime,
      tracker: new ThreadParticipationTracker(),
      log: vi.fn(),
    });
    expect(runtime.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
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
});
