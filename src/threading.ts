import type { RingCentralReplyToMode } from "./types.js";

export class ThreadParticipationTracker {
  private readonly sentPostIds = new Set<string>();

  remember(postId: string | undefined | null): void {
    if (postId) {
      this.sentPostIds.add(postId);
    }
  }

  has(postId: string | undefined | null): boolean {
    return !!postId && this.sentPostIds.has(postId);
  }
}

export function channelSetMatches(entries: readonly string[] | undefined, chatId: string): boolean {
  return (entries ?? []).some((entry) => entry === "*" || entry === chatId);
}

export function resolveReplyTransport(params: {
  chatId: string;
  replyToId?: string | number | null;
  threadId?: string | number | null;
  replyToMode: RingCentralReplyToMode;
  noThreadChannels?: readonly string[];
  tracker?: ThreadParticipationTracker;
}): { parentPostId?: string | number; threadId?: string | number } {
  if (params.replyToMode === "off" || channelSetMatches(params.noThreadChannels, params.chatId)) {
    return {};
  }
  if (params.threadId) {
    return { threadId: params.threadId };
  }
  if (!params.replyToId) {
    return {};
  }
  if (params.replyToMode === "first" && params.tracker?.has(String(params.replyToId))) {
    return {};
  }
  return { parentPostId: params.replyToId };
}
