
import { describe, expect, it, vi, beforeEach } from "vitest";
import { searchCachedChats, startChatCacheSync, type CachedChat } from "./chat-cache.js";
import * as fs from "fs";

// Mock fs.promises
vi.mock("fs", () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

// Mock API (not used directly but needed for import)
vi.mock("./api.js", () => ({
  listRingCentralChats: vi.fn().mockResolvedValue([]),
  getCurrentRingCentralUser: vi.fn().mockResolvedValue({ id: "self-id" }),
  getRingCentralUser: vi.fn(),
}));

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("searchCachedChats Performance", () => {
  const TOTAL_CHATS = 10000;
  const QUERY_COUNT = 1000;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Generate a large dataset
    const chats: CachedChat[] = [];
    for (let i = 0; i < TOTAL_CHATS; i++) {
      chats.push({
        id: `chat-${i}`,
        name: `Team Project Alpha ${i} Discussion`,
        type: "Team",
        members: ["user-1", "user-2"],
      });
    }

    // Inject into cache via startChatCacheSync
    vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify({
      updatedAt: new Date().toISOString(),
      ownerId: "self-id",
      chats,
    }));

    await startChatCacheSync({
      account: { accountId: "test" } as any,
      workspace: "/tmp",
      logger: mockLogger,
      abortSignal: new AbortController().signal,
    });
  });

  it("should find chats correctly", () => {
    const results = searchCachedChats("Alpha 500");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toContain("Alpha 500");
  });

  it("benchmark search speed", () => {
    const start = performance.now();

    for (let i = 0; i < QUERY_COUNT; i++) {
      searchCachedChats("Alpha 50"); // Hits many
      searchCachedChats("Project 999"); // Hits one
      searchCachedChats("NonexistentTerm"); // Hits none
    }

    const end = performance.now();
    const duration = end - start;
    console.log(`[Benchmark] ${QUERY_COUNT * 3} searches took ${duration.toFixed(2)}ms`);

    // We don't assert duration here to avoid flakiness, but we print it.
    // The goal is to see this number drop after optimization.
  });
});
