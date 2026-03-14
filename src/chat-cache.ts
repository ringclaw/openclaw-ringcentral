import * as fs from "fs";
import * as path from "path";

import type { ResolvedRingCentralAccount } from "./accounts.js";
import {
  listRingCentralChats,
  getRingCentralUser,
  getCurrentRingCentralUser,
} from "./api.js";
import type { RingCentralChat } from "./types.js";

export type CachedChat = {
  id: string;
  name: string;
  type: "Team" | "Direct" | "Group" | "Personal" | "Everyone" | string;
  members?: string[];
};

type ChatCacheData = {
  updatedAt: string;
  ownerId?: string;
  chats: CachedChat[];
};

type ChatCacheLogger = {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

const CHAT_TYPES = ["Personal", "Direct", "Group", "Team", "Everyone"] as const;
const CACHE_FILE = "ringcentral-chat-cache.json";

let memoryCache: CachedChat[] = [];
let searchCache: string[] = [];
let cachedOwnerId: string | undefined;
let syncContext: {
  account: ResolvedRingCentralAccount;
  workspace: string | undefined;
  logger: ChatCacheLogger;
} | null = null;

export function getCachedChats(): CachedChat[] {
  return memoryCache;
}

export function searchCachedChats(query: string): CachedChat[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const results: CachedChat[] = [];
  for (let i = 0; i < searchCache.length; i++) {
    if (searchCache[i].includes(q)) {
      results.push(memoryCache[i]);
    }
  }
  return results;
}

export function findDirectChatByMember(memberId: string): CachedChat | undefined {
  // Performance optimization: Hot loop for searching large chat arrays.
  // Using a traditional `for` loop and direct index comparisons for 2-element arrays
  // avoids callback overhead and .includes() array iteration (~40% faster).
  for (let i = 0; i < memoryCache.length; i++) {
    const c = memoryCache[i];
    if (c.type === "Direct") {
      const m = c.members;
      if (!m) continue;

      if (!cachedOwnerId) {
        // Fallback: match any Direct chat containing memberId (less precise)
        if (m.includes(memberId)) return c;
      } else if (m.length === 2) {
        // Exact match: Direct chat whose members are exactly {selfId, memberId}
        if ((m[0] === cachedOwnerId && m[1] === memberId) ||
            (m[1] === cachedOwnerId && m[0] === memberId)) {
          return c;
        }
      }
    }
  }
  return undefined;
}

function resolveCachePath(workspace: string): string {
  return path.join(workspace, "memory", CACHE_FILE);
}

async function readCacheFile(workspace: string, logger: ChatCacheLogger): Promise<{ chats: CachedChat[]; ownerId?: string }> {
  const filePath = resolveCachePath(workspace);
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const data = JSON.parse(raw) as ChatCacheData;
    return { chats: data.chats ?? [], ownerId: data.ownerId };
  } catch {
    logger.debug(`[chat-cache] No existing cache file at ${filePath}`);
    return { chats: [] };
  }
}

async function writeCacheFile(workspace: string, chats: CachedChat[], ownerId: string | undefined, logger: ChatCacheLogger): Promise<void> {
  const filePath = resolveCachePath(workspace);
  const dir = path.dirname(filePath);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    const data: ChatCacheData = {
      updatedAt: new Date().toISOString(),
      ownerId,
      chats,
    };
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
    logger.debug(`[chat-cache] Wrote ${chats.length} chats to ${filePath}`);
  } catch (err) {
    logger.error(`[chat-cache] Failed to write cache: ${String(err)}`);
  }
}

function cacheChanged(prev: CachedChat[], next: CachedChat[]): boolean {
  if (prev.length !== next.length) return true;

  const prevMap = new Map<string, string>();
  for (let i = 0; i < prev.length; i++) {
    prevMap.set(prev[i].id, prev[i].name);
  }

  for (let i = 0; i < next.length; i++) {
    const c = next[i];
    if (!prevMap.has(c.id) || prevMap.get(c.id) !== c.name) {
      return true;
    }
  }

  return false;
}

async function resolveOwnerId(
  account: ResolvedRingCentralAccount,
  logger: ChatCacheLogger,
): Promise<string | undefined> {
  try {
    const user = await getCurrentRingCentralUser({ account });
    return user?.id ?? undefined;
  } catch (err) {
    logger.warn(`[chat-cache] Failed to get current user: ${String(err)}`);
    return undefined;
  }
}

async function resolvePersonName(
  account: ResolvedRingCentralAccount,
  personId: string,
  logger: ChatCacheLogger,
): Promise<string> {
  try {
    const user = await getRingCentralUser({ account, userId: personId });
    const parts = [user?.firstName, user?.lastName].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : personId;
  } catch {
    logger.debug(`[chat-cache] Failed to resolve person ${personId}`);
    return personId;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchAllChats(
  account: ResolvedRingCentralAccount,
  logger: ChatCacheLogger,
): Promise<{ chats: CachedChat[]; ownerId: string | undefined }> {
  const ownerIdPromise = resolveOwnerId(account, logger);

  const chatPromises = CHAT_TYPES.map(async (chatType) => {
    try {
      const chats = await listRingCentralChats({
        account,
        type: [chatType],
        limit: 250,
      });
      return { chatType, chats };
    } catch (err) {
      logger.error(`[chat-cache] Failed to fetch ${chatType} chats: ${String(err)}`);
      return { chatType, chats: [] as RingCentralChat[] };
    }
  });

  const [ownerId, chatResults] = await Promise.all([
    ownerIdPromise,
    Promise.all(chatPromises),
  ]);

  const result: CachedChat[] = [];
  const directChatsToResolve: Array<{ index: number; peerId: string }> = [];

  for (const { chatType, chats } of chatResults) {
    for (const chat of chats) {
      if (!chat.id) continue;

      const rawMembers = chat.members ?? [];
      const memberIds = rawMembers.map((m: unknown) =>
        typeof m === "object" && m !== null && "id" in m ? String((m as { id: unknown }).id) : String(m),
      );

      let name = chat.name ?? "";

      if (chatType === "Personal" && !name) {
        name = "(Personal)";
      }

      const idx = result.length;
      result.push({
        id: chat.id,
        name: String(name || ""),
        type: chat.type ?? chatType,
        members: memberIds,
      });

      // Collect Direct chats that need name resolution
      if (chatType === "Direct" && !name && memberIds.length > 0) {
        const peerId = memberIds.find((id) => id !== ownerId);
        if (peerId) {
          directChatsToResolve.push({ index: idx, peerId });
        }
      }
    }
  }

  // Resolve Direct chat names in batches to balance speed and rate limits
  if (directChatsToResolve.length > 0) {
    logger.debug(`[chat-cache] Resolving ${directChatsToResolve.length} Direct chat names...`);

    // Process in small batches to avoid 429 but improve over sequential
    const BATCH_SIZE = 3;
    const BATCH_DELAY_MS = 200;

    for (let i = 0; i < directChatsToResolve.length; i += BATCH_SIZE) {
      if (i > 0) {
        await sleep(BATCH_DELAY_MS);
      }

      const batch = directChatsToResolve.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async ({ index, peerId }) => {
        const name = await resolvePersonName(account, peerId, logger);
        result[index].name = String(name || "");
      }));
    }
  }

  return { chats: result, ownerId };
}

async function syncOnce(
  account: ResolvedRingCentralAccount,
  workspace: string | undefined,
  logger: ChatCacheLogger,
): Promise<void> {
  logger.debug(`[chat-cache] Syncing chats for account ${account.accountId}...`);
  try {
    const { chats, ownerId } = await fetchAllChats(account, logger);
    if (ownerId) {
      cachedOwnerId = ownerId;
    }

    const changed = cacheChanged(memoryCache, chats);
    memoryCache = chats;
    searchCache = chats.map((c) => (c.name || "").toLowerCase());

    if (workspace && changed) {
      await writeCacheFile(workspace, chats, cachedOwnerId, logger);
    }

    logger.info(`[chat-cache] Synced ${chats.length} chats (changed=${changed})`);
  } catch (err) {
    logger.error(`[chat-cache] Sync failed: ${String(err)}`);
  }
}

export async function refreshChatCache(): Promise<{ count: number }> {
  if (!syncContext) {
    return { count: memoryCache.length };
  }
  const { account, workspace, logger } = syncContext;
  await syncOnce(account, workspace, logger);
  return { count: memoryCache.length };
}

export async function startChatCacheSync(params: {
  account: ResolvedRingCentralAccount;
  workspace: string | undefined;
  logger: ChatCacheLogger;
  abortSignal: AbortSignal;
}): Promise<void> {
  const { account, workspace, logger } = params;
  syncContext = { account, workspace, logger };

  // Only restore from local file; no automatic API sync to avoid 429
  if (workspace) {
    const cached = await readCacheFile(workspace, logger);
    memoryCache = cached.chats;
    searchCache = memoryCache.map((c) => (c.name || "").toLowerCase());
    if (cached.ownerId) {
      cachedOwnerId = cached.ownerId;
    }
    if (memoryCache.length > 0) {
      logger.info(`[chat-cache] Restored ${memoryCache.length} chats from file cache (ownerId=${cachedOwnerId ?? "unknown"})`);
    }
  }
}

export function stopChatCacheSync(): void {
  syncContext = null;
}

export function __resetChatCacheForTest(): void {
  memoryCache = [];
  searchCache = [];
  cachedOwnerId = undefined;
  syncContext = null;
}
