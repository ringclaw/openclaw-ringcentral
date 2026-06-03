import { describe, expect, it } from "vitest";
import {
  buildWebSocketUrl,
  extractPostFromWsFrame,
  isConnectionDetails,
  isSubscriptionConfirmation,
  markSentPost,
  shouldProcessPost,
} from "./monitor.js";
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

describe("isConnectionDetails", () => {
  it("accepts RingCentral array connection detail frames", () => {
    expect(
      isConnectionDetails([
        {
          type: "ConnectionDetails",
          status: 200,
          wsc: { token: "recovery-token", sequence: 1 },
        },
        { idleTimeout: 1800 },
      ]),
    ).toBe(true);
  });

  it("accepts object connection detail frames", () => {
    expect(isConnectionDetails({ wsc: { token: "recovery-token", sequence: 1 } })).toBe(true);
  });
});

describe("isSubscriptionConfirmation", () => {
  it("accepts object subscription responses", () => {
    expect(isSubscriptionConfirmation({ status: 200 })).toBe(true);
    expect(isSubscriptionConfirmation({ id: "sub-1", uuid: "uuid-1" })).toBe(true);
  });

  it("accepts array subscription response frames", () => {
    expect(
      isSubscriptionConfirmation([
        { type: "ClientRequest", status: 200 },
        { id: "sub-1", uuid: "uuid-1" },
      ]),
    ).toBe(true);
  });

  it("rejects malformed subscription responses", () => {
    expect(isSubscriptionConfirmation(null)).toBe(false);
    expect(isSubscriptionConfirmation([{ type: "ClientRequest", status: 400 }, { message: "bad request" }])).toBe(
      false,
    );
  });
});

describe("buildWebSocketUrl", () => {
  it("adds ws access token as access_token query param", () => {
    expect(buildWebSocketUrl({ uri: "wss://example.test/ws", ws_access_token: "token-1" })).toBe(
      "wss://example.test/ws?access_token=token-1",
    );
  });

  it("preserves existing query params", () => {
    expect(buildWebSocketUrl({ uri: "wss://example.test/ws?x=1", ws_access_token: "token-1" })).toBe(
      "wss://example.test/ws?x=1&access_token=token-1",
    );
  });

  it("does not replace an existing access token", () => {
    expect(buildWebSocketUrl({ uri: "wss://example.test/ws?access_token=existing", ws_access_token: "token-1" })).toBe(
      "wss://example.test/ws?access_token=existing",
    );
  });
});
