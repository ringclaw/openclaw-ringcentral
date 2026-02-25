
import { describe, expect, it, vi, beforeEach } from "vitest";
import { searchCachedChats, __setCacheForTest } from "./chat-cache.js";
import type { CachedChat } from "./chat-cache.js";

// We need to mock api.js because chat-cache imports it
vi.mock("./api.js", () => ({
  listRingCentralChats: vi.fn(),
  getCurrentRingCentralUser: vi.fn(),
  getRingCentralUser: vi.fn(),
}));

describe("searchCachedChats", () => {
  const mockChats: CachedChat[] = [
    { id: "1", name: "Team Alpha", type: "Team" },
    { id: "2", name: "Project Beta", type: "Group" },
    { id: "3", name: "Charlie Direct", type: "Direct" },
    { id: "4", name: "General", type: "Team" },
    { id: "5", name: "random chat", type: "Group" },
  ];

  beforeEach(() => {
    // We will need to implement __setCacheForTest in chat-cache.ts
    // For now, this test will fail to compile until we modify chat-cache.ts
    // OR we can rely on startChatCacheSync if we mock fs.
    // But adding a helper is cleaner.
    if (typeof __setCacheForTest === 'function') {
        __setCacheForTest(mockChats);
    }
  });

  it("should find chats by case-insensitive name", () => {
    const results = searchCachedChats("alpha");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Team Alpha");
  });

  it("should find multiple matches", () => {
    const results = searchCachedChats("e"); // "Team", "Project", "Direct", "General" all have 'e'
    // Team Alpha (e), Project Beta (e, e), Charlie Direct (e, e), General (e, e)
    // "Team Alpha" has 'e' at index 1.
    // "Project Beta" has 'e' at 4, 10.
    // "Charlie Direct" has 'e' at 7, 12.
    // "General" has 'e' at 1, 3.
    // "random chat" - no 'e'.
    expect(results).toHaveLength(4);
  });

  it("should return empty array for empty query", () => {
    expect(searchCachedChats("")).toEqual([]);
    expect(searchCachedChats("   ")).toEqual([]);
  });

  it("should return empty array for no matches", () => {
    expect(searchCachedChats("xyz123")).toEqual([]);
  });

  it("should handle special characters", () => {
    // Assuming we might have chats with special chars
    // Since we don't in mockChats, let's just test it doesn't crash
    expect(searchCachedChats("@#$")).toEqual([]);
  });
});
