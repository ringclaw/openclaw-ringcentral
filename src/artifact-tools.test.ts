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

  it("rejects Adaptive Card writes outside the configured Home chat", async () => {
    const tool = createRingCentralArtifactTools(cfg).find(
      (candidate) => candidate.name === "ringcentral_create_adaptive_card",
    )!;

    const result = await tool.execute("call-1", { chat_id: "team-1", text: "hello" } as any);

    expect(result.details).toMatchObject({
      success: false,
      error: expect.stringContaining("Home chat"),
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("creates an owner note directly in Home chat", async () => {
    const tool = createRingCentralArtifactTools(cfg).find(
      (candidate) => candidate.name === "ringcentral_create_note",
    )!;
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
});
