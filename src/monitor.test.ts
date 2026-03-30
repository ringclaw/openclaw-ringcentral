import { describe, it, expect, vi } from "vitest";
import { handleWSMessage, markSentPost } from "./monitor.js";
import type { MonitorOptions } from "./monitor.js";
import { ANSWER_START, THINKING_TEXT } from "./shared.js";

function makeOpts(overrides?: Partial<MonitorOptions>): MonitorOptions {
  return {
    serverUrl: "https://api.example.com",
    botToken: "tok",
    onMessage: vi.fn(),
    abortSignal: new AbortController().signal,
    log: vi.fn(),
    ...overrides,
  };
}

function makeWSEvent(overrides?: Record<string, unknown>) {
  return [
    { type: "ServerNotification" },
    {
      uuid: "uuid-1",
      event: "/team-messaging/v1/posts?eventType=PostAdded",
      timestamp: "2026-01-01T00:00:00Z",
      subscriptionId: "sub-1",
      ownerId: "owner-1",
      body: {
        id: "post-1",
        groupId: "chat-1",
        type: "TextMessage",
        text: "Hello",
        creatorId: "user-1",
        creationTime: "2026-01-01T00:00:00Z",
      },
      ...overrides,
    },
  ];
}

describe("handleWSMessage", () => {
  it("dispatches valid PostAdded TextMessage", () => {
    const opts = makeOpts();
    const sentPosts = new Map<string, number>();
    handleWSMessage(makeWSEvent(), opts, sentPosts, undefined, vi.fn());
    expect(opts.onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "post-1", text: "Hello" }),
    );
  });

  it("ignores non-PostAdded events", () => {
    const opts = makeOpts();
    const event = makeWSEvent();
    (event[1] as any).event = "/team-messaging/v1/posts?eventType=PostChanged";
    handleWSMessage(event, opts, new Map(), undefined, vi.fn());
    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it("ignores non-TextMessage types", () => {
    const opts = makeOpts();
    const event = makeWSEvent();
    (event[1] as any).body.type = "PersonJoined";
    handleWSMessage(event, opts, new Map(), undefined, vi.fn());
    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it("ignores messages in sentPosts", () => {
    const opts = makeOpts();
    const sentPosts = new Map<string, number>([["post-1", Date.now()]]);
    handleWSMessage(makeWSEvent(), opts, sentPosts, undefined, vi.fn());
    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it("ignores messages from bot's own extension ID", () => {
    const opts = makeOpts();
    const event = makeWSEvent();
    (event[1] as any).body.creatorId = "bot-ext-123";
    handleWSMessage(event, opts, new Map(), "bot-ext-123", vi.fn());
    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it("ignores answer-wrapped messages", () => {
    const opts = makeOpts();
    const event = makeWSEvent();
    (event[1] as any).body.text = `${ANSWER_START}\nsome response`;
    handleWSMessage(event, opts, new Map(), undefined, vi.fn());
    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it("ignores thinking placeholder", () => {
    const opts = makeOpts();
    const event = makeWSEvent();
    (event[1] as any).body.text = THINKING_TEXT;
    handleWSMessage(event, opts, new Map(), undefined, vi.fn());
    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it("ignores arrays with fewer than 2 elements", () => {
    const opts = makeOpts();
    handleWSMessage([{}], opts, new Map(), undefined, vi.fn());
    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it("ignores events with no body", () => {
    const opts = makeOpts();
    const event = makeWSEvent();
    (event[1] as any).body = undefined;
    handleWSMessage(event, opts, new Map(), undefined, vi.fn());
    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it("cleans expired sentPosts entries", () => {
    const opts = makeOpts();
    const sentPosts = new Map<string, number>([
      ["old-post", Date.now() - 400_000],
      ["recent-post", Date.now()],
    ]);
    handleWSMessage(makeWSEvent(), opts, sentPosts, undefined, vi.fn());
    expect(sentPosts.has("old-post")).toBe(false);
    expect(sentPosts.has("recent-post")).toBe(true);
  });

  it("allows messages from other users even when botExtensionId set", () => {
    const opts = makeOpts();
    handleWSMessage(makeWSEvent(), opts, new Map(), "bot-ext-999", vi.fn());
    expect(opts.onMessage).toHaveBeenCalled();
  });
});

describe("markSentPost", () => {
  it("adds post ID with timestamp", () => {
    const sentPosts = new Map<string, number>();
    markSentPost(sentPosts, "p1");
    expect(sentPosts.has("p1")).toBe(true);
    expect(sentPosts.get("p1")).toBeGreaterThan(0);
  });
});
