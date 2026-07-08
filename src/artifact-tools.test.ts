import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  __testing,
  createRingCentralArtifactTools,
  RINGCENTRAL_ARTIFACT_TOOL_NAMES,
} from "./artifact-tools.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Map(),
  };
}

const cfg = {
  channels: {
    ringcentral: {
      botToken: "bot-token",
      ownerCredentials: {
        clientId: "owner-client",
        clientSecret: "owner-secret",
        jwt: "owner-jwt",
      },
      server: "https://api.example.com",
      homeChannel: "home-dm",
    },
  },
};

const allowlistedCfg = {
  channels: {
    ringcentral: {
      ...cfg.channels.ringcentral,
      teams: {
        "team-1": { allow: true },
      },
      dm: {
        groupEnabled: true,
        groupChannels: {
          "group-dm-1": { allow: true },
        },
      },
    },
  },
};

function findTool(config: unknown, name: string) {
  return createRingCentralArtifactTools(config).find((candidate) => candidate.name === name)!;
}

beforeEach(() => {
  mockFetch.mockReset();
  __testing.pendingConfirmations.clear();
});

describe("RingCentral artifact tools", () => {
  it("registers all optional artifact tools", () => {
    const tools = createRingCentralArtifactTools(cfg).map((tool) => tool.name);
    expect(tools).toEqual([...RINGCENTRAL_ARTIFACT_TOOL_NAMES]);

    const manifest = JSON.parse(readFileSync("openclaw.plugin.json", "utf8"));
    expect(manifest.channelConfigs?.ringcentral).toMatchObject({
      label: "RingCentral",
      recommendedAgent: {
        id: "ringcentral-bot",
        model: null,
        tools: { profile: null },
        workspace: null,
      },
      binding: {
        agentId: "ringcentral-bot",
        match: { channel: "ringcentral" },
      },
      schema: manifest.configSchema,
      uiHints: manifest.uiHints,
    });
    for (const toolName of RINGCENTRAL_ARTIFACT_TOOL_NAMES) {
      expect(manifest.contracts.tools).toContain(toolName);
      expect(manifest.toolMetadata[toolName]).toEqual({ optional: true });
    }
  });

  it("creates an Adaptive Card in the configured Home chat with the bot token", async () => {
    const tool = findTool(cfg, "ringcentral_create_adaptive_card");
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "card-home", type: "AdaptiveCard" }));

    const result = await tool.execute("call-1", { text: "hello" } as any);

    expect(result.details).toMatchObject({ success: true, card_id: "card-home" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/team-messaging/v1/chats/home-dm/adaptive-cards",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer bot-token" }),
      }),
    );
  });

  it("uses the bot token directly for allowlisted team artifact tools", async () => {
    const run = (name: string, args: Record<string, unknown>) =>
      findTool(allowlistedCfg, name).execute("call-1", args as any);
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: "card-1", type: "AdaptiveCard" }))
      .mockResolvedValueOnce(jsonResponse({ id: "card-1", type: "AdaptiveCard" }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ records: [{ id: "note-1", title: "Note" }] }))
      .mockResolvedValueOnce(jsonResponse({ id: "note-2", title: "Note" }))
      .mockResolvedValueOnce(jsonResponse({ id: "note-2", title: "Note" }))
      .mockResolvedValueOnce(jsonResponse({ id: "note-2", title: "Updated" }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ records: [{ id: "event-1", title: "Event" }] }))
      .mockResolvedValueOnce(jsonResponse({ id: "event-2", title: "Event" }))
      .mockResolvedValueOnce(jsonResponse({ id: "event-2", title: "Event" }))
      .mockResolvedValueOnce(jsonResponse({ id: "event-2", title: "Updated" }))
      .mockResolvedValueOnce(jsonResponse({}));

    await run("ringcentral_create_adaptive_card", { chat_id: "team-1", text: "card" });
    await run("ringcentral_update_adaptive_card", { chat_id: "team-1", card_id: "card-1", text: "card" });
    await run("ringcentral_delete_adaptive_card", { chat_id: "team-1", card_id: "card-1" });
    await run("ringcentral_list_notes", { chat_id: "team-1" });
    await run("ringcentral_create_note", { chat_id: "team-1", title: "Note" });
    await run("ringcentral_get_note", { chat_id: "team-1", note_id: "note-2" });
    await run("ringcentral_update_note", { chat_id: "team-1", note_id: "note-2", title: "Updated" });
    await run("ringcentral_delete_note", { chat_id: "team-1", note_id: "note-2" });
    await run("ringcentral_publish_note", { chat_id: "team-1", note_id: "note-2" });
    await run("ringcentral_list_calendar_events", { chat_id: "team-1" });
    await run("ringcentral_create_calendar_event", {
      chat_id: "team-1",
      title: "Event",
      start_time: "2026-06-04T10:00:00Z",
      end_time: "2026-06-04T11:00:00Z",
    });
    await run("ringcentral_get_calendar_event", { chat_id: "team-1", event_id: "event-2" });
    await run("ringcentral_update_calendar_event", {
      chat_id: "team-1",
      event_id: "event-2",
      title: "Updated",
      start_time: "2026-06-04T10:00:00Z",
      end_time: "2026-06-04T11:00:00Z",
    });
    await run("ringcentral_delete_calendar_event", { chat_id: "team-1", event_id: "event-2" });

    const calls = mockFetch.mock.calls;
    expect(calls).toHaveLength(14);
    expect(calls.map(([url]) => String(url))).not.toContain("https://api.example.com/restapi/oauth/token");
    for (const [, init] of calls) {
      expect(init).toEqual(expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer bot-token" }),
      }));
    }
  });

  it("uses the bot token directly for allowlisted group DM artifact tools", async () => {
    const tool = findTool(allowlistedCfg, "ringcentral_create_note");
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "note-group-dm", title: "Note" }));

    const result = await tool.execute("call-1", {
      chat_id: "group-dm-1",
      title: "Group DM Note",
    } as any);

    expect(result.details).toMatchObject({ success: true, note_id: "note-group-dm" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/team-messaging/v1/chats/group-dm-1/notes",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer bot-token" }),
      }),
    );
  });

  it("does not fall back to owner credentials when the allowlisted bot token path fails", async () => {
    const tool = findTool(allowlistedCfg, "ringcentral_create_note");
    mockFetch.mockResolvedValueOnce(jsonResponse({ message: "forbidden" }, 403));

    const result = await tool.execute("call-1", {
      chat_id: "team-1",
      title: "Team Note",
    } as any);

    expect(result.details).toMatchObject({
      success: false,
      error: expect.stringContaining("bot token"),
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0]?.[0])).not.toContain("/oauth/token");
  });

  it("does not treat teams wildcard defaults as artifact allowlist entries", async () => {
    const wildcardCfg = {
      channels: {
        ringcentral: {
          ...cfg.channels.ringcentral,
          teams: {
            "*": { allow: true },
          },
        },
      },
    };
    const tool = findTool(wildcardCfg, "ringcentral_create_adaptive_card");

    const result = await tool.execute("call-1", { chat_id: "team-1", text: "hello" } as any);

    expect(result.details).toMatchObject({
      success: false,
      error: expect.stringContaining("allowlisted"),
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("creates an owner note directly in Home chat", async () => {
    const tool = findTool(cfg, "ringcentral_create_note");
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: "owner-access", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ id: "note-1", title: "Note" }));

    const result = await tool.execute("call-1", { title: "Note" } as any);

    expect(result.details).toMatchObject({ success: true, note_id: "note-1" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/team-messaging/v1/chats/home-dm/notes",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer owner-access" }),
        body: JSON.stringify({ title: "Note" }),
      }),
    );
  });

  it("requires Home confirmation before owner note writes to another chat", async () => {
    const tools = createRingCentralArtifactTools(cfg);
    const createNote = tools.find((candidate) => candidate.name === "ringcentral_create_note")!;
    const confirm = tools.find((candidate) => candidate.name === "ringcentral_confirm_artifact_action")!;

    const pending = await createNote.execute("call-1", {
      chat_id: "team-1",
      title: "Team Note",
    } as any);

    expect(pending.details).toMatchObject({
      success: false,
      requiresConfirmation: true,
      target_chat_id: "team-1",
    });
    expect(mockFetch).not.toHaveBeenCalled();

    const confirmationId = (pending.details as any).confirmation_id;
    const rejected = await confirm.execute("call-2", {
      confirmation_id: confirmationId,
      chat_id: "team-1",
    } as any);
    expect(rejected.details).toMatchObject({
      success: false,
      error: expect.stringContaining("Home DM"),
    });

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: "owner-access", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ id: "note-2", title: "Team Note" }));

    const confirmed = await confirm.execute("call-3", {
      confirmation_id: confirmationId,
      chat_id: "home-dm",
    } as any);

    expect(confirmed.details).toMatchObject({
      success: true,
      confirmed: true,
      note_id: "note-2",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/team-messaging/v1/chats/team-1/notes",
      expect.objectContaining({ method: "POST" }),
    );

    const reuse = await confirm.execute("call-4", {
      confirmation_id: confirmationId,
      chat_id: "home-dm",
    } as any);
    expect(reuse.details).toMatchObject({
      success: false,
      error: expect.stringContaining("Invalid or expired"),
    });
  });

  it("requires homeChannel before owner-backed writes", async () => {
    const noHomeCfg = {
      channels: {
        ringcentral: {
          botToken: "bot-token",
          ownerCredentials: cfg.channels.ringcentral.ownerCredentials,
          server: "https://api.example.com",
        },
      },
    };
    const tool = createRingCentralArtifactTools(noHomeCfg).find(
      (candidate) => candidate.name === "ringcentral_create_calendar_event",
    )!;

    const result = await tool.execute("call-1", {
      chat_id: "team-1",
      title: "Planning",
      start_time: "2026-06-04T10:00:00Z",
      end_time: "2026-06-04T11:00:00Z",
    } as any);

    expect(result.details).toMatchObject({
      success: false,
      error: expect.stringContaining("homeChannel"),
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("requires chat_id or homeChannel for object-id artifact tools", async () => {
    const noHomeCfg = {
      channels: {
        ringcentral: {
          botToken: "bot-token",
          server: "https://api.example.com",
        },
      },
    };
    const tool = findTool(noHomeCfg, "ringcentral_get_note");

    const result = await tool.execute("call-1", { note_id: "note-1" } as any);

    expect(result.details).toMatchObject({
      success: false,
      error: expect.stringContaining("chat_id"),
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
