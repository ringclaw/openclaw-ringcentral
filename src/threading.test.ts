import { describe, expect, it } from "vitest";
import { resolveReplyTransport, ThreadParticipationTracker } from "./threading.js";

describe("ThreadParticipationTracker", () => {
  it("tracks bot post ids and related thread ids", () => {
    const tracker = new ThreadParticipationTracker();

    tracker.remember("bot-reply", "root-thread");

    expect(tracker.has("bot-reply")).toBe(true);
    expect(tracker.hasThread("root-thread")).toBe(true);
    expect(tracker.has("root-thread")).toBe(false);
  });

  it("can track thread ids without a bot post id", () => {
    const tracker = new ThreadParticipationTracker();

    tracker.rememberThread("root-thread");

    expect(tracker.hasThread("root-thread")).toBe(true);
  });
});

describe("resolveReplyTransport", () => {
  it("does not thread first-mode replies when replying to a tracked bot post", () => {
    const tracker = new ThreadParticipationTracker();
    tracker.remember("bot-reply", "root-thread");

    expect(
      resolveReplyTransport({
        chatId: "chat",
        replyToId: "bot-reply",
        replyToMode: "first",
        tracker,
      }),
    ).toEqual({});
  });

  it("uses RingCentral threadId when it is available", () => {
    const tracker = new ThreadParticipationTracker();
    tracker.remember("bot-reply", "root-thread");

    expect(
      resolveReplyTransport({
        chatId: "chat",
        replyToId: "bot-reply",
        threadId: "root-thread",
        replyToMode: "first",
        tracker,
      }),
    ).toEqual({ threadId: "root-thread" });
  });
});
