import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAccessToken, invalidateToken, getWSToken, getBotWSToken } from "./auth.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  invalidateToken();
});

describe("getAccessToken", () => {
  const args = ["https://platform.ringcentral.com", "cid", "csecret", "jwt-tok"] as const;

  it("fetches a new token", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: "tok1", expires_in: 3600 }));
    const token = await getAccessToken(...args);
    expect(token).toBe("tok1");
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("returns cached token on second call", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: "tok2", expires_in: 3600 }));
    await getAccessToken(...args);
    const token = await getAccessToken(...args);
    expect(token).toBe("tok2");
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("throws on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "bad" }, 401));
    await expect(getAccessToken(...args)).rejects.toThrow("Token request failed (HTTP 401)");
  });

  it("invalidateToken forces re-fetch", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: "tok3", expires_in: 3600 }));
    await getAccessToken(...args);
    invalidateToken();
    mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: "tok4", expires_in: 3600 }));
    const token = await getAccessToken(...args);
    expect(token).toBe("tok4");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent requests", async () => {
    let resolvePromise: (v: unknown) => void;
    mockFetch.mockReturnValueOnce(
      new Promise((r) => {
        resolvePromise = r;
      }),
    );
    const p1 = getAccessToken(...args);
    const p2 = getAccessToken(...args);
    resolvePromise!(jsonResponse({ access_token: "dedup", expires_in: 3600 }));
    const [t1, t2] = await Promise.all([p1, p2]);
    expect(t1).toBe("dedup");
    expect(t2).toBe("dedup");
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});

describe("getWSToken", () => {
  it("returns WS token on success", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ uri: "wss://ws.example.com", ws_access_token: "ws-tok", expires_in: 300 }),
    );
    const result = await getWSToken("https://platform.ringcentral.com", "access-tok");
    expect(result.uri).toBe("wss://ws.example.com");
    expect(result.ws_access_token).toBe("ws-tok");
  });

  it("invalidates token and throws on 401", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));
    await expect(getWSToken("https://platform.ringcentral.com", "bad-tok")).rejects.toThrow(
      "Token expired",
    );
  });

  it("throws on other HTTP errors", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "server" }, 500));
    await expect(getWSToken("https://platform.ringcentral.com", "tok")).rejects.toThrow(
      "WS token request failed (HTTP 500)",
    );
  });
});

describe("getBotWSToken", () => {
  it("returns WS token on success", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ uri: "wss://bot.example.com", ws_access_token: "bot-ws", expires_in: 300 }),
    );
    const result = await getBotWSToken("https://platform.ringcentral.com", "bot-tok");
    expect(result.uri).toBe("wss://bot.example.com");
  });

  it("throws on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "denied" }, 403));
    await expect(getBotWSToken("https://platform.ringcentral.com", "bot-tok")).rejects.toThrow(
      "Bot WS token request failed (HTTP 403)",
    );
  });
});
