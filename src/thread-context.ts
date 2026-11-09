import type { RingCentralClient } from "./client.js";
import type { Post } from "./types.js";

export function formatPosts(posts: Post[]): string {
  return posts
    .slice()
    .reverse()
    .map((post) => {
      const attachments = post.attachments?.length
        ? ` attachments=${post.attachments.map((item) => item.name ?? item.type).join(",")}`
        : "";
      return `[${post.creationTime ?? "unknown time"}] ${post.creatorId || "unknown"}: ${post.text || "(empty)"}${attachments}`;
    })
    .join("\n");
}

export function isPostInThread(post: Post, threadId: string): boolean {
  const key = String(threadId);
  return (
    String(post.threadId ?? "") === key ||
    String(post.id) === key ||
    String(post.parentPostId ?? "") === key
  );
}

export async function loadThreadContextPosts(params: {
  client: RingCentralClient;
  chatId: string;
  threadId: string;
  limit: number;
  excludePostId?: string;
}): Promise<Post[]> {
  const limit = Math.max(1, Math.trunc(params.limit));
  let posts = await listThreadPostsPreferred(params.client, params.threadId, Math.max(limit + 1, limit));
  if (posts.length === 0) {
    posts = await listChatPostsFiltered(params.client, params.chatId, params.threadId, Math.max(limit * 5, 50));
  } else {
    posts = posts.filter((post) => isPostInThread(post, params.threadId));
  }

  const filtered = posts
    .filter((post) => !params.excludePostId || String(post.id) !== String(params.excludePostId))
    .slice()
    .sort((a, b) => {
      const aTime = Date.parse(a.creationTime) || 0;
      const bTime = Date.parse(b.creationTime) || 0;
      return aTime - bTime;
    });

  if (filtered.length <= limit) {
    return filtered;
  }
  return filtered.slice(filtered.length - limit);
}

export async function loadThreadContextText(params: {
  client: RingCentralClient;
  chatId: string;
  threadId: string;
  limit: number;
  excludePostId?: string;
  log?: (message: string) => void;
}): Promise<string | undefined> {
  try {
    const posts = await loadThreadContextPosts(params);
    const formatted = formatPostsChronological(posts);
    return formatted || undefined;
  } catch (err) {
    params.log?.(
      `[ringcentral] thread context load failed threadId=${params.threadId} chatId=${params.chatId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return undefined;
  }
}

function formatPostsChronological(posts: Post[]): string {
  return posts
    .map((post) => {
      const attachments = post.attachments?.length
        ? ` attachments=${post.attachments.map((item) => item.name ?? item.type).join(",")}`
        : "";
      return `[${post.creationTime ?? "unknown time"}] ${post.creatorId || "unknown"}: ${post.text || "(empty)"}${attachments}`;
    })
    .join("\n");
}

async function listThreadPostsPreferred(
  client: RingCentralClient,
  threadId: string,
  recordCount: number,
): Promise<Post[]> {
  try {
    return (await client.listThreadPosts(threadId, recordCount)).records ?? [];
  } catch {
    return [];
  }
}

async function listChatPostsFiltered(
  client: RingCentralClient,
  chatId: string,
  threadId: string,
  recordCount: number,
): Promise<Post[]> {
  let posts: Post[] = [];
  try {
    posts = (await client.listPosts(chatId, recordCount)).records ?? [];
  } catch {
    posts = [];
  }
  if (posts.length === 0) {
    try {
      posts = (await client.listLegacyGroupPosts(chatId, recordCount)).records ?? [];
    } catch {
      posts = [];
    }
  }
  return posts.filter((post) => isPostInThread(post, threadId));
}
