import { describe, expect, it, vi } from "vitest";
import {
  formatPosts,
  isPostInThread,
  loadThreadContextPosts,
  loadThreadContextText,
} from "./thread-context.js";
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

describe("thread-context", () => {
  it("formatPosts reverses newest-first API order into chronological text", () => {
    const text = formatPosts([
      makePost({ id: "p2", text: "newer", creationTime: "2026-01-01T00:02:00Z" }),
      makePost({ id: "p1", text: "older", creationTime: "2026-01-01T00:01:00Z" }),
    ]);
    expect(text.indexOf("older")).toBeLessThan(text.indexOf("newer"));
  });

  it("isPostInThread matches root id, threadId, and parentPostId", () => {
    expect(isPostInThread(makePost({ id: "root" }), "root")).toBe(true);
    expect(isPostInThread(makePost({ id: "p2", threadId: "root" }), "root")).toBe(true);
    expect(isPostInThread(makePost({ id: "p3", parentPostId: "root" }), "root")).toBe(true);
    expect(isPostInThread(makePost({ id: "p4", threadId: "other" }), "root")).toBe(false);
  });

  it("loadThreadContextPosts prefers listThreadPosts and excludes the current post", async () => {
    const client = {
      listThreadPosts: vi.fn().mockResolvedValue({
        records: [
          makePost({ id: "root", text: "root", creationTime: "2026-01-01T00:00:00Z" }),
          makePost({
            id: "p2",
            text: "reply",
            threadId: "root",
            creationTime: "2026-01-01T00:01:00Z",
          }),
          makePost({
            id: "current",
            text: "now",
            threadId: "root",
            creationTime: "2026-01-01T00:02:00Z",
          }),
        ],
      }),
      listPosts: vi.fn(),
      listLegacyGroupPosts: vi.fn(),
    };

    const posts = await loadThreadContextPosts({
      client: client as any,
      chatId: "g1",
      threadId: "root",
      limit: 20,
      excludePostId: "current",
    });

    expect(client.listThreadPosts).toHaveBeenCalledWith("root", 21);
    expect(posts.map((post) => post.id)).toEqual(["root", "p2"]);
    expect(client.listPosts).not.toHaveBeenCalled();
  });

  it("loadThreadContextPosts falls back to chat posts when thread endpoint is empty", async () => {
    const client = {
      listThreadPosts: vi.fn().mockRejectedValue(new Error("no thread api")),
      listPosts: vi.fn().mockResolvedValue({
        records: [
          makePost({ id: "noise", text: "other", creationTime: "2026-01-01T00:00:00Z" }),
          makePost({
            id: "p2",
            text: "in thread",
            threadId: "root",
            creationTime: "2026-01-01T00:01:00Z",
          }),
        ],
      }),
      listLegacyGroupPosts: vi.fn(),
    };

    const posts = await loadThreadContextPosts({
      client: client as any,
      chatId: "g1",
      threadId: "root",
      limit: 20,
    });

    expect(posts.map((post) => post.id)).toEqual(["p2"]);
  });

  it("loadThreadContextText returns undefined when all history lookups fail", async () => {
    const client = {
      listThreadPosts: vi.fn().mockRejectedValue(new Error("thread api down")),
      listPosts: vi.fn().mockRejectedValue(new Error("chat api down")),
      listLegacyGroupPosts: vi.fn().mockRejectedValue(new Error("legacy down")),
    };
    const text = await loadThreadContextText({
      client: client as any,
      chatId: "g1",
      threadId: "root",
      limit: 20,
    });
    expect(text).toBeUndefined();
  });
});
