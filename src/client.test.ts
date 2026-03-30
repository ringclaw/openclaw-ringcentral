import { describe, it, expect, vi, beforeEach } from "vitest";
import { RingCentralClient, createBotClient, createPrivateClient } from "./client.js";

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

beforeEach(() => {
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
      await expect(client.sendPost("chat1", "hi")).rejects.toThrow("No authentication configured");
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
    });

    it("handles 204 No Content", async () => {
      const client = createBotClient("https://api.example.com", "tok");
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204, text: () => Promise.resolve("") });
      await expect(client.deletePost("c", "p")).resolves.toBeUndefined();
    });
  });

  describe("posts", () => {
    const client = createBotClient("https://api.example.com", "tok");

    it("sendPost", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "p1", text: "hello", groupId: "c1", type: "TextMessage", creatorId: "u1", creationTime: "" }));
      const post = await client.sendPost("c1", "hello");
      expect(post.id).toBe("p1");
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

    it("createEvent", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "e1", title: "Meeting" }));
      const event = await client.createEvent({ title: "Meeting", startTime: "2026-01-01T10:00:00Z", endTime: "2026-01-01T11:00:00Z" });
      expect(event.id).toBe("e1");
    });
  });

  describe("notes", () => {
    const client = createBotClient("https://api.example.com", "tok");

    it("createNote and publishNote", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "n1", title: "Note" }));
      const note = await client.createNote("c1", { title: "Note" });
      expect(note.id).toBe("n1");

      mockFetch.mockResolvedValueOnce({ ok: true, status: 204, text: () => Promise.resolve("") });
      await expect(client.publishNote("n1")).resolves.toBeUndefined();
    });
  });

  describe("adaptive cards", () => {
    const client = createBotClient("https://api.example.com", "tok");

    it("createAdaptiveCard", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "ac1", type: "AdaptiveCard" }));
      const card = await client.createAdaptiveCard("c1", { type: "AdaptiveCard", body: [], version: "1.3" });
      expect(card.id).toBe("ac1");
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
});
