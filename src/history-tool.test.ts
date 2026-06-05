import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRingCentralHistoryTool } from "./history-tool.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
const origEnv = { ...process.env };

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Map(),
  };
}

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("RC_") || key.startsWith("RINGCENTRAL_")) {
      delete process.env[key];
    }
  }
  mockFetch.mockReset();
});

afterEach(() => {
  process.env = { ...origEnv };
});

describe("ringcentral_get_recent_messages", () => {
  it("returns an error when owner credentials are missing", async () => {
    const tool = createRingCentralHistoryTool({
      channels: { ringcentral: { botToken: "bot" } },
    });
    const result = await tool.execute("call-1", { target: "ringcentral:group:g1" } as any);
    expect(result.content[0]?.text).toContain("owner credentials");
  });

  it("reads recent messages for a chat target", async () => {
    const tool = createRingCentralHistoryTool({
      channels: {
        ringcentral: {
          botToken: "bot",
          ownerCredentials: { clientId: "cid", clientSecret: "cs", jwt: "jwt" },
        },
      },
    });
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: "access", expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          records: [
            {
              id: "p1",
              groupId: "g1",
              type: "TextMessage",
              text: "hello",
              creatorId: "u1",
              creationTime: "2026-01-01T00:00:00Z",
              lastModifiedTime: "2026-01-01T00:00:00Z",
            },
          ],
        }),
      );

    const result = await tool.execute("call-1", {
      target: "ringcentral:group:g1",
      record_count: 10,
    } as any);

    expect(result.content[0]?.text).toContain("hello");
    expect(result.details).toMatchObject({ chatId: "g1", count: 1 });
  });
});
