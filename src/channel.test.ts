import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAccount } from "./accounts.js";
import { ringcentralPlugin, selectSendClients } from "./channel.js";
import { createBotClient, createOwnerClient } from "./client.js";

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

function cfg(overrides: Record<string, unknown> = {}) {
  return {
    channels: {
      ringcentral: {
        botToken: "bot-token",
        server: "https://api.example.com",
        ...overrides,
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

  it("sends with owner JWT when conversationIdentity is user", async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "owner-access",
          token_type: "bearer",
          expires_in: 3600,
          scope: "TeamMessaging",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: "post-1" }));

    const result = await ringcentralPlugin.outbound!.sendText!({
      cfg: cfg({
        conversationIdentity: "user",
        botToken: undefined,
        ownerCredentials: {
          clientId: "cid",
          clientSecret: "cs",
          jwt: "owner-jwt",
        },
      }),
      accountId: "default",
      to: "team:t1",
      text: "hello from owner",
    } as any);

    expect(result).toMatchObject({ ok: true, messageId: "post-1" });
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      "https://api.example.com/restapi/oauth/token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "https://api.example.com/team-messaging/v1/chats/t1/posts",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer owner-access",
        }),
      }),
    );
  });
});

describe("selectSendClients", () => {
  it("prefers bot client in bot identity mode", () => {
    const account = resolveAccount({ botToken: "bot" });
    const botClient = createBotClient("https://api.example.com", "bot");
    const ownerClient = createOwnerClient("https://api.example.com", "cid", "cs", "jwt");
    const selected = selectSendClients(account, botClient, ownerClient, "bot-person", "owner-person");
    expect(selected.sendClient).toBe(botClient);
    expect(selected.sendFallbackClient).toBe(ownerClient);
    expect(selected.assistantPersonId).toBe("bot-person");
  });

  it("prefers owner client in user identity mode", () => {
    const account = resolveAccount({
      conversationIdentity: "user",
      ownerCredentials: { clientId: "cid", clientSecret: "cs", jwt: "jwt" },
    });
    const botClient = createBotClient("https://api.example.com", "bot");
    const ownerClient = createOwnerClient("https://api.example.com", "cid", "cs", "jwt");
    const selected = selectSendClients(account, botClient, ownerClient, "bot-person", "owner-person");
    expect(selected.sendClient).toBe(ownerClient);
    expect(selected.sendFallbackClient).toBe(botClient);
    expect(selected.assistantPersonId).toBe("owner-person");
  });
});
