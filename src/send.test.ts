import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendMessage, sendTypingIndicator, updateMessage, deleteMessage } from "./send.js";
import { RingCentralApiError, type RingCentralClient } from "./client.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createMockClient() {
  return {
    sendPost: vi.fn().mockResolvedValue({ id: "post1", text: "", groupId: "", type: "", creatorId: "", creationTime: "" }),
    updatePost: vi.fn().mockResolvedValue(undefined),
    deletePost: vi.fn().mockResolvedValue(undefined),
    uploadFile: vi.fn().mockResolvedValue({ id: "file1", text: "", groupId: "", type: "", creatorId: "", creationTime: "" }),
  } as unknown as RingCentralClient & { sendPost: ReturnType<typeof vi.fn>; updatePost: ReturnType<typeof vi.fn>; deletePost: ReturnType<typeof vi.fn>; uploadFile: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("sendMessage", () => {
  it("sends text message with markdown conversion", async () => {
    const client = createMockClient();
    const result = await sendMessage({ client, chatId: "c1", text: "# Hello" });
    expect(result).toMatchObject({ postId: "post1" });
    expect((client as any).sendPost).toHaveBeenCalledWith("c1", "**Hello**", {});
  });

  it("sends text without markdown conversion", async () => {
    const client = createMockClient();
    await sendMessage({ client, chatId: "c1", text: "# Raw", convertMarkdown: false });
    expect((client as any).sendPost).toHaveBeenCalledWith("c1", "# Raw", {});
  });

  it("sends threaded replies when replyToId is present", async () => {
    const client = createMockClient();
    await sendMessage({ client, chatId: "c1", text: "reply", replyToId: "p-parent" });
    expect((client as any).sendPost).toHaveBeenCalledWith("c1", "reply", {
      parentPostId: "p-parent",
    });
  });

  it("uses fallback client on authz failures", async () => {
    const client = createMockClient();
    const fallbackClient = createMockClient();
    (client as any).sendPost.mockRejectedValueOnce(new RingCentralApiError(403, "forbidden"));
    const result = await sendMessage({ client, fallbackClient, chatId: "c1", text: "fallback" });
    expect(result).toMatchObject({ postId: "post1" });
    expect((fallbackClient as any).sendPost).toHaveBeenCalledWith("c1", "fallback", {});
  });

  it("falls back to unthreaded owner send when owner threaded send fails", async () => {
    const client = createMockClient();
    const fallbackClient = createMockClient();
    (client as any).sendPost.mockRejectedValueOnce(new RingCentralApiError(403, "forbidden"));
    (fallbackClient as any).sendPost
      .mockRejectedValueOnce(new RingCentralApiError(404, "thread missing"))
      .mockResolvedValueOnce({ id: "owner-unthreaded", text: "", groupId: "", type: "", creatorId: "", creationTime: "" });

    const result = await sendMessage({
      client,
      fallbackClient,
      chatId: "c1",
      text: "fallback",
      replyToId: "p-parent",
    });

    expect(result).toMatchObject({ postId: "owner-unthreaded" });
    expect((fallbackClient as any).sendPost).toHaveBeenNthCalledWith(1, "c1", "fallback", {
      parentPostId: "p-parent",
    });
    expect((fallbackClient as any).sendPost).toHaveBeenNthCalledWith(2, "c1", "fallback");
  });

  it("uploads media from URL", async () => {
    const client = createMockClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: new Map([["content-type", "image/png"]]),
    });
    const result = await sendMessage({ client, chatId: "c1", mediaUrl: "https://example.com/img.png" });
    expect(result).toMatchObject({ postId: "file1" });
    expect((client as any).uploadFile).toHaveBeenCalled();
  });

  it("falls through to text when media fetch fails", async () => {
    const client = createMockClient();
    mockFetch.mockRejectedValueOnce(new Error("network error"));
    const result = await sendMessage({ client, chatId: "c1", text: "fallback", mediaUrl: "https://bad.url/img.png" });
    expect(result).toMatchObject({ postId: "post1" });
    expect((client as any).sendPost).toHaveBeenCalledWith("c1", "fallback", {});
  });

  it("returns null when no text and no media", async () => {
    const client = createMockClient();
    const result = await sendMessage({ client, chatId: "c1" });
    expect(result).toBeNull();
  });
});

describe("sendTypingIndicator", () => {
  it("returns postId on success", async () => {
    const client = createMockClient();
    const id = await sendTypingIndicator(client, "c1");
    expect(id).toBe("post1");
    expect((client as any).sendPost).toHaveBeenCalledWith("c1", "👀", {});
  });

  it("returns undefined on failure", async () => {
    const client = createMockClient();
    (client as any).sendPost.mockRejectedValueOnce(new Error("fail"));
    const id = await sendTypingIndicator(client, "c1");
    expect(id).toBeUndefined();
  });

  it("uses custom text", async () => {
    const client = createMockClient();
    await sendTypingIndicator(client, "c1", "Thinking...");
    expect((client as any).sendPost).toHaveBeenCalledWith("c1", "Thinking...", {});
  });
});

describe("updateMessage", () => {
  it("updates with markdown conversion", async () => {
    const client = createMockClient();
    await updateMessage(client, "c1", "p1", "# Updated");
    expect((client as any).updatePost).toHaveBeenCalledWith("c1", "p1", "**Updated**");
  });

  it("updates without markdown conversion", async () => {
    const client = createMockClient();
    await updateMessage(client, "c1", "p1", "# Raw", false);
    expect((client as any).updatePost).toHaveBeenCalledWith("c1", "p1", "# Raw");
  });
});

describe("deleteMessage", () => {
  it("deletes successfully", async () => {
    const client = createMockClient();
    await expect(deleteMessage(client, "c1", "p1")).resolves.toBeUndefined();
    expect((client as any).deletePost).toHaveBeenCalledWith("c1", "p1");
  });

  it("swallows errors silently", async () => {
    const client = createMockClient();
    (client as any).deletePost.mockRejectedValueOnce(new Error("404"));
    await expect(deleteMessage(client, "c1", "p1")).resolves.toBeUndefined();
  });
});
