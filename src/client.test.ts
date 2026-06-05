import { describe, it, expect, vi, beforeEach } from "vitest";
import { RingCentralClient, createBotClient, createOwnerClient, createPrivateClient } from "./client.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Map([["content-type", "application/json"]]),
  };
}

function binaryResponse(data: Uint8Array, status = 200, contentType = "application/octet-stream") {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: () =>
      Promise.resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
    text: () => Promise.resolve(""),
    headers: new Map([
      ["content-type", contentType],
      ["Content-Type", contentType],
    ]),
  };
}

beforeEach(() => {
  vi.useRealTimers();
  mockFetch.mockReset();
});

describe("RingCentralClient", () => {
  describe("authentication", () => {
    it("uses bot token directly", async () => {
      const client = createBotClient("https://api.example.com", "bot-tok");
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "123", text: "hi" }));
      await client.sendPost("chat1", "hello");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/team-messaging/v1/chats/chat1/posts",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer bot-tok" }),
        }),
      );
    });

    it("throws when no auth configured", async () => {
      const client = new RingCentralClient({ serverUrl: "https://api.example.com" });
      await expect(client.sendPost("chat1", "hi")).rejects.toThrow("No RingCentral authentication configured");
    });

    it("keeps owner JWT token cache per client instance", async () => {
      const first = createOwnerClient("https://api.example.com", "cid1", "cs1", "jwt1");
      const second = createOwnerClient("https://api.example.com", "cid2", "cs2", "jwt2");
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ access_token: "access-1", expires_in: 3600 }))
        .mockResolvedValueOnce(jsonResponse({ id: "p1" }))
        .mockResolvedValueOnce(jsonResponse({ access_token: "access-2", expires_in: 3600 }))
        .mockResolvedValueOnce(jsonResponse({ id: "p2" }));

      await first.sendPost("c", "one");
      await second.sendPost("c", "two");

      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe(
        `Basic ${Buffer.from("cid1:cs1").toString("base64")}`,
      );
      expect(mockFetch.mock.calls[2][1].headers.Authorization).toBe(
        `Basic ${Buffer.from("cid2:cs2").toString("base64")}`,
      );
      expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe("Bearer access-1");
      expect(mockFetch.mock.calls[3][1].headers.Authorization).toBe("Bearer access-2");
    });

    it("strips trailing slash from serverUrl", async () => {
      const client = createBotClient("https://api.example.com/", "tok");
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "1" }));
      await client.sendPost("c", "t");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/team-messaging/v1/chats/c/posts",
        expect.anything(),
      );
    });
  });

  describe("error handling", () => {
    it("throws on non-OK response", async () => {
      const client = createBotClient("https://api.example.com", "tok");
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: "not found" }, 404));
      await expect(client.getChat("bad")).rejects.toThrow("HTTP 404");
      expect(client.lastStatus).toBe(404);
    });

    it("handles 204 No Content", async () => {
      const client = createBotClient("https://api.example.com", "tok");
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204, text: () => Promise.resolve("") });
      await expect(client.deletePost("c", "p")).resolves.toBeUndefined();
    });

    it("retries HTTP 429 with Retry-After", async () => {
      vi.useFakeTimers();
      const client = createBotClient("https://api.example.com", "tok");
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: () => Promise.resolve("rate limited"),
          headers: new Map([["Retry-After", "0.5"]]),
        })
        .mockResolvedValueOnce(jsonResponse({ id: "c1", type: "Group" }));
      const promise = client.getChat("c1");
      await vi.advanceTimersByTimeAsync(500);
      await expect(promise).resolves.toMatchObject({ id: "c1" });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("posts", () => {
    const client = createBotClient("https://api.example.com", "tok");

    it("sendPost", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "p1", text: "hello", groupId: "c1", type: "TextMessage", creatorId: "u1", creationTime: "" }));
      const post = await client.sendPost("c1", "hello");
      expect(post.id).toBe("p1");
    });

    it("sendPost includes parentPostId or threadId", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "p1" }));
      await client.sendPost("c1", "hello", { parentPostId: "12345" });
      expect(JSON.parse(mockFetch.mock.calls.at(-1)![1].body)).toEqual({
        text: "hello",
        parentPostId: 12345,
      });

      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "p2" }));
      await client.sendPost("c1", "hello", { threadId: "t-1" });
      expect(JSON.parse(mockFetch.mock.calls.at(-1)![1].body)).toEqual({
        text: "hello",
        threadId: "t-1",
      });
    });

    it("updatePost", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204, text: () => Promise.resolve("") });
      await expect(client.updatePost("c1", "p1", "updated")).resolves.toBeUndefined();
    });

    it("deletePost", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204, text: () => Promise.resolve("") });
      await expect(client.deletePost("c1", "p1")).resolves.toBeUndefined();
    });

    it("listPosts", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ records: [{ id: "p1" }, { id: "p2" }] }));
      const result = await client.listPosts("c1", 10);
      expect(result.records).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("recordCount=10"),
        expect.anything(),
      );
    });

    it("createWebSocketToken", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ uri: "wss://example", ws_access_token: "ws", expires_in: 60 }));
      await expect(client.createWebSocketToken()).resolves.toMatchObject({ uri: "wss://example" });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/restapi/oauth/wstoken",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("uploadFile uses RingCentral file endpoint", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "file-post" }));
      await client.uploadFile("chat 1", "image.png", new Uint8Array([1, 2]), "image/png");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/team-messaging/v1/files?name=image.png&groupId=chat%201",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "Content-Type": "image/png" }),
        }),
      );
    });

    it("downloadAttachment uses bearer auth and returns bounded media bytes", async () => {
      mockFetch.mockResolvedValueOnce(binaryResponse(new Uint8Array([1, 2, 3]), 200, "image/png"));
      const result = await client.downloadAttachment({
        uri: "https://content.example.test/file",
        fileName: "image.png",
        maxBytes: 10,
      });

      expect(result).toMatchObject({
        contentType: "image/png",
        fileName: "image.png",
        size: 3,
      });
      expect(Buffer.from(result.buffer)).toEqual(Buffer.from([1, 2, 3]));
      expect(mockFetch).toHaveBeenCalledWith(
        "https://content.example.test/file",
        expect.objectContaining({
          method: "GET",
          headers: { Authorization: "Bearer tok" },
        }),
      );
    });

    it("downloadAttachment rejects oversized attachment bodies", async () => {
      mockFetch.mockResolvedValueOnce(binaryResponse(new Uint8Array([1, 2, 3]), 200, "text/plain"));
      await expect(
        client.downloadAttachment({
          uri: "https://content.example.test/file",
          fileName: "note.txt",
          maxBytes: 2,
        }),
      ).rejects.toThrow("RingCentral attachment too large");
    });

    it("downloadAttachment retries HTTP 429 with Retry-After", async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: () => Promise.resolve("rate limited"),
          headers: new Map([["Retry-After", "0.5"]]),
        })
        .mockResolvedValueOnce(binaryResponse(new Uint8Array([1]), 200, "text/plain"));

      const promise = client.downloadAttachment({
        uri: "https://content.example.test/file",
        fileName: "note.txt",
        maxBytes: 10,
      });
      await vi.advanceTimersByTimeAsync(500);
      await expect(promise).resolves.toMatchObject({ size: 1 });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("chats", () => {
    const client = createBotClient("https://api.example.com", "tok");

    it("getChat", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "c1", type: "Group", name: "Team" }));
      const chat = await client.getChat("c1");
      expect(chat.type).toBe("Group");
    });

    it("listChats with type filter", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ records: [] }));
      await client.listChats("Direct");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("type=Direct"),
        expect.anything(),
      );
    });

    it("createConversation", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "conv1", type: "Direct" }));
      const chat = await client.createConversation(["u1", "u2"]);
      expect(chat.id).toBe("conv1");
    });
  });

  describe("tasks", () => {
    const client = createBotClient("https://api.example.com", "tok");

    it("createTask", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "t1", subject: "Test" }));
      const task = await client.createTask("c1", { subject: "Test" });
      expect(task.id).toBe("t1");
    });

    it("completeTask", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204, text: () => Promise.resolve("") });
      await expect(client.completeTask("t1", "u1")).resolves.toBeUndefined();
    });
  });

  describe("events", () => {
    const client = createBotClient("https://api.example.com", "tok");

    it("uses group scoped endpoints for list and create events", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ records: [{ id: "e1", title: "Meeting" }] }))
        .mockResolvedValueOnce(jsonResponse({ id: "e1", title: "Meeting" }));

      const events = await client.listEvents("g1", 10);
      const event = await client.createEvent("g1", { title: "Meeting", startTime: "2026-01-01T10:00:00Z", endTime: "2026-01-01T11:00:00Z" });

      expect(events.records[0].id).toBe("e1");
      expect(event.id).toBe("e1");
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "https://api.example.com/team-messaging/v1/groups/g1/events?recordCount=10",
        expect.objectContaining({ method: "GET" }),
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "https://api.example.com/team-messaging/v1/groups/g1/events",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("uses global get, put, and delete event endpoints", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "e1", title: "Meeting" }));
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "e1", title: "Updated" }));
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204, text: () => Promise.resolve("") });

      await client.getEvent("e1");
      await client.updateEvent("e1", { title: "Updated", startTime: "2026-01-01T10:00:00Z", endTime: "2026-01-01T11:00:00Z" });
      await client.deleteEvent("e1");

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "https://api.example.com/team-messaging/v1/events/e1",
        expect.objectContaining({ method: "GET" }),
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "https://api.example.com/team-messaging/v1/events/e1",
        expect.objectContaining({ method: "PUT" }),
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        "https://api.example.com/team-messaging/v1/events/e1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  describe("notes", () => {
    const client = createBotClient("https://api.example.com", "tok");

    it("listNotes", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ records: [{ id: "n1", title: "Note" }] }));
      const result = await client.listNotes("c1");
      expect(result.records).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/team-messaging/v1/chats/c1/notes?recordCount=50",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("createNote and publishNote use verified endpoints", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "n1", title: "Note" }));
      const note = await client.createNote("c1", { title: "Note" });
      expect(note.id).toBe("n1");
      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://api.example.com/team-messaging/v1/chats/c1/notes",
        expect.objectContaining({ method: "POST" }),
      );

      mockFetch.mockResolvedValueOnce({ ok: true, status: 204, text: () => Promise.resolve("") });
      await expect(client.publishNote("n1")).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://api.example.com/team-messaging/v1/notes/n1/publish",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("get/update/delete note use note-scoped endpoints", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "n1", title: "Note" }));
      await expect(client.getNote("n1")).resolves.toMatchObject({ id: "n1" });
      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://api.example.com/team-messaging/v1/notes/n1",
        expect.objectContaining({ method: "GET" }),
      );

      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "n1", title: "Updated" }));
      await client.updateNote("n1", { title: "Updated", body: "<b>Body</b>" });
      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://api.example.com/team-messaging/v1/notes/n1",
        expect.objectContaining({ method: "PATCH" }),
      );

      mockFetch.mockResolvedValueOnce({ ok: true, status: 204, text: () => Promise.resolve("") });
      await expect(client.deleteNote("n1")).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://api.example.com/team-messaging/v1/notes/n1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  describe("adaptive cards", () => {
    const client = createBotClient("https://api.example.com", "tok");

    it("createAdaptiveCard", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "ac1", type: "AdaptiveCard" }));
      const card = await client.createAdaptiveCard("c1", { type: "AdaptiveCard", body: [], version: "1.3" });
      expect(card.id).toBe("ac1");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/team-messaging/v1/chats/c1/adaptive-cards",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("get/update/delete AdaptiveCard", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "ac1", type: "AdaptiveCard" }));
      await expect(client.getAdaptiveCard("ac1")).resolves.toMatchObject({ id: "ac1" });
      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://api.example.com/team-messaging/v1/adaptive-cards/ac1",
        expect.objectContaining({ method: "GET" }),
      );

      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "ac1", type: "AdaptiveCard" }));
      await client.updateAdaptiveCard("ac1", { type: "AdaptiveCard", body: [], version: "1.3" });
      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://api.example.com/team-messaging/v1/adaptive-cards/ac1",
        expect.objectContaining({ method: "PUT" }),
      );

      mockFetch.mockResolvedValueOnce({ ok: true, status: 204, text: () => Promise.resolve("") });
      await expect(client.deleteAdaptiveCard("ac1")).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://api.example.com/team-messaging/v1/adaptive-cards/ac1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });
});

describe("factory functions", () => {
  it("createBotClient creates a client with bot token", () => {
    const client = createBotClient("https://api.example.com", "bot-tok");
    expect(client).toBeInstanceOf(RingCentralClient);
  });

  it("createPrivateClient creates a client with credentials", () => {
    const client = createPrivateClient("https://api.example.com", "cid", "cs", "jwt");
    expect(client).toBeInstanceOf(RingCentralClient);
  });

  it("createOwnerClient creates a client with credentials", () => {
    const client = createOwnerClient("https://api.example.com", "cid", "cs", "jwt");
    expect(client).toBeInstanceOf(RingCentralClient);
  });
});
