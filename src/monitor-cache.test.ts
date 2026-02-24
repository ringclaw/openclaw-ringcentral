import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { TtlCache } from "./monitor.js";

describe("TtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns undefined for missing keys", () => {
    const cache = new TtlCache<string>({ maxSize: 10, ttlMs: 60_000 });
    expect(cache.get("missing")).toBeUndefined();
  });

  it("stores and retrieves values", () => {
    const cache = new TtlCache<string>({ maxSize: 10, ttlMs: 60_000 });
    cache.set("a", "hello");
    expect(cache.get("a")).toBe("hello");
  });

  it("expires entries after TTL", () => {
    const cache = new TtlCache<string>({ maxSize: 10, ttlMs: 5_000 });
    cache.set("a", "hello");
    expect(cache.get("a")).toBe("hello");

    vi.advanceTimersByTime(5_001);
    expect(cache.get("a")).toBeUndefined();
  });

  it("does not expire entries before TTL", () => {
    const cache = new TtlCache<string>({ maxSize: 10, ttlMs: 5_000 });
    cache.set("a", "hello");

    vi.advanceTimersByTime(4_999);
    expect(cache.get("a")).toBe("hello");
  });

  it("evicts oldest entry when at max size", () => {
    const cache = new TtlCache<string>({ maxSize: 2, ttlMs: 60_000 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3"); // should evict "a"

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
  });

  it("evicts expired entries before falling back to oldest", () => {
    const cache = new TtlCache<string>({ maxSize: 2, ttlMs: 5_000 });
    cache.set("a", "1");

    vi.advanceTimersByTime(5_001); // "a" is now expired

    cache.set("b", "2");
    cache.set("c", "3"); // eviction pass should remove expired "a", not "b"

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
  });

  it("separates keys correctly", () => {
    const cache = new TtlCache<string>({ maxSize: 10, ttlMs: 60_000 });
    cache.set("acc1:chat1", "data1");
    cache.set("acc2:chat1", "data2");

    expect(cache.get("acc1:chat1")).toBe("data1");
    expect(cache.get("acc2:chat1")).toBe("data2");
  });

  it("clear removes all entries", () => {
    const cache = new TtlCache<string>({ maxSize: 10, ttlMs: 60_000 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });

  it("overwriting a key refreshes TTL", () => {
    const cache = new TtlCache<string>({ maxSize: 10, ttlMs: 5_000 });
    cache.set("a", "v1");

    vi.advanceTimersByTime(3_000);
    cache.set("a", "v2"); // refresh

    vi.advanceTimersByTime(3_000); // 6s from first set, 3s from refresh
    expect(cache.get("a")).toBe("v2");
  });

  it("updating a key moves it to end (MRU) preventing eviction", () => {
    const cache = new TtlCache<string>({ maxSize: 2, ttlMs: 60_000 });
    cache.set("a", "1");
    cache.set("b", "2");

    cache.set("a", "updated"); // 'a' should now be MRU (newest)

    cache.set("c", "3"); // should evict 'b' (LRU), not 'a'

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("updated");
    expect(cache.get("c")).toBe("3");
  });
});
