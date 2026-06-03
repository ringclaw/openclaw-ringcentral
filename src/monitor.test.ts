import { describe, expect, it } from "vitest";
import { extractPostFromWsFrame, markSentPost, shouldProcessPost } from "./monitor.js";
import { ANSWER_START } from "./shared.js";

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

describe("extractPostFromWsFrame", () => {
  it("extracts valid array PostAdded TextMessage frames", () => {
    expect(extractPostFromWsFrame(makeWSEvent())).toEqual(
      expect.objectContaining({ id: "post-1", text: "Hello" }),
    );
  });

  it("extracts valid object PostAdded TextMessage frames", () => {
    const [, event] = makeWSEvent();
    expect(extractPostFromWsFrame(event)).toEqual(expect.objectContaining({ id: "post-1" }));
  });

  it("ignores non-PostAdded events", () => {
    const [, event] = makeWSEvent({ event: "/team-messaging/v1/posts?eventType=PostChanged" });
    expect(extractPostFromWsFrame(event)).toBeNull();
  });

  it("ignores non-text events and malformed frames", () => {
    const [, event] = makeWSEvent();
    (event as any).body.type = "PersonJoined";
    expect(extractPostFromWsFrame(event)).toBeNull();
    expect(extractPostFromWsFrame([{}])).toBeNull();
    expect(extractPostFromWsFrame({ event: "PostAdded" })).toBeNull();
  });
});

describe("shouldProcessPost", () => {
  const post = extractPostFromWsFrame(makeWSEvent())!;

  it("blocks own sent posts and own creator messages", () => {
    expect(shouldProcessPost(post, { sentPosts: new Map([["post-1", Date.now()]]) })).toBe(false);
    expect(shouldProcessPost(post, { ownCreatorId: "user-1" })).toBe(false);
    expect(shouldProcessPost(post, { ownCreatorId: "user-1", filterOwnCreator: false })).toBe(true);
  });

  it("blocks answer wrappers and configured placeholder texts", () => {
    expect(shouldProcessPost({ ...post, text: `${ANSWER_START}\nresponse` })).toBe(false);
    expect(shouldProcessPost({ ...post, text: "👀" }, { ignoredTexts: ["👀", "⏳"] })).toBe(false);
  });

  it("allows normal user messages", () => {
    expect(shouldProcessPost(post, { ownCreatorId: "other" })).toBe(true);
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
