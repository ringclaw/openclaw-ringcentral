import { describe, expect, it, vi, beforeEach } from "vitest";
import { searchCachedChats, startChatCacheSync, __resetChatCacheForTest, type CachedChat } from "./chat-cache.js";
import type { ResolvedRingCentralAccount } from "./accounts.js";
import * as fs from "fs";

vi.mock("fs", async () => {
  const actualFs = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actualFs,
    promises: {
      ...actualFs.promises,
      readFile: vi.fn(),
      mkdir: vi.fn(),
      writeFile: vi.fn(),
    },
  };
});

const mockAccount: ResolvedRingCentralAccount = {
  accountId: "test",
  enabled: true,
  credentialSource: "config",
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  jwt: "test-jwt",
  server: "https://platform.ringcentral.com",
  config: {},
};

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("searchCachedChats performance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetChatCacheForTest();
  });

  it("should perform search across 10,000 chats efficiently", async () => {
    // Generate 10k dummy chats
    const count = 10000;
    const dummyChats: CachedChat[] = Array.from({ length: count }, (_, i) => ({
      id: `chat-${i}`,
      name: i % 10 === 0 ? `Special Marketing Team ${i}` : `General Chat ${i}`,
      type: "Team",
    }));

    // Mock the file system to return our dummy chats so startChatCacheSync loads them
    vi.mocked(fs.promises.readFile).mockResolvedValueOnce(
      JSON.stringify({
        updatedAt: new Date().toISOString(),
        ownerId: "self-id",
        chats: dummyChats,
      })
    );

    // Load the cache
    await startChatCacheSync({
      account: mockAccount,
      workspace: "/dummy/workspace",
      logger: mockLogger,
      abortSignal: new AbortController().signal,
    });

    // Verify they were loaded
    const initialSearch = searchCachedChats("Marketing");
    expect(initialSearch.length).toBeGreaterThan(0);
    expect(initialSearch.length).toBe(1000); // i % 10 === 0 matches exactly 1/10th of 10000 = 1000

    // Measure performance
    const ITERATIONS = 100;
    const start = process.hrtime.bigint();

    for (let i = 0; i < ITERATIONS; i++) {
      searchCachedChats("marketing");
    }

    const end = process.hrtime.bigint();
    const durationNs = Number(end - start);
    const durationMs = durationNs / 1e6;
    const avgMs = durationMs / ITERATIONS;

    // Output stats for visibility
    console.log(`Average search time for 10k chats: ${avgMs.toFixed(3)}ms`);

    // The optimized version should easily run in < 10ms per iteration (often < 1ms)
    // We set a conservative threshold of 25ms to avoid test flakiness on slower CI runners
    expect(avgMs).toBeLessThan(25);
  });
});
