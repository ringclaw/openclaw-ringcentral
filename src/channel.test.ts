import { beforeEach, describe, expect, it, vi } from "vitest";
import { ringcentralPlugin } from "./channel.js";

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

function cfg() {
  return {
    channels: {
      ringcentral: {
        botToken: "bot-token",
        server: "https://api.example.com",
      },
    },
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("ringcentralPlugin outbound targets", () => {
  it("creates or finds a DM before sending to user targets", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: "dm-chat-1", type: "Direct" }))
      .mockResolvedValueOnce(jsonResponse({ id: "post-1" }));

    const result = await ringcentralPlugin.outbound!.sendText!({
      cfg: cfg(),
      accountId: "default",
      to: "user:u1",
      text: "hello",
    } as any);

    expect(result).toMatchObject({ ok: true, messageId: "post-1" });
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      "https://api.example.com/team-messaging/v1/conversations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ members: [{ id: "u1" }] }),
      }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "https://api.example.com/team-messaging/v1/chats/dm-chat-1/posts",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends directly to team targets", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "post-1" }));

    const result = await ringcentralPlugin.outbound!.sendText!({
      cfg: cfg(),
      accountId: "default",
      to: "team:t1",
      text: "hello",
    } as any);

    expect(result).toMatchObject({ ok: true, messageId: "post-1" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/team-messaging/v1/chats/t1/posts",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects legacy provider-prefixed targets", async () => {
    const result = await ringcentralPlugin.outbound!.sendText!({
      cfg: cfg(),
      accountId: "default",
      to: "ringcentral:group:g1",
      text: "hello",
    } as any);

    expect(result).toMatchObject({ ok: false });
    expect(String((result as any).error?.message)).toContain("Invalid RingCentral target");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
