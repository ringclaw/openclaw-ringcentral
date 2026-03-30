// Target ID normalization for RingCentral.
// Format: rc:{kind}:{id} where kind is dm, group, channel, user, chat

export const RC_PREFIX = "ringcentral";

export function parseTarget(raw: string): { kind: string; id: string } | null {
  // ringcentral:dm:123 or ringcentral:group:123 or rc:chat:123
  const prefixes = [`${RC_PREFIX}:`, "rc:"];
  for (const prefix of prefixes) {
    if (raw.startsWith(prefix)) {
      const rest = raw.slice(prefix.length);
      const colonIdx = rest.indexOf(":");
      if (colonIdx > 0) {
        return { kind: rest.slice(0, colonIdx), id: rest.slice(colonIdx + 1) };
      }
      return { kind: "chat", id: rest };
    }
  }
  // Bare numeric ID
  if (/^\d+$/.test(raw)) {
    return { kind: "chat", id: raw };
  }
  return null;
}

export function buildTarget(kind: string, id: string): string {
  return `${RC_PREFIX}:${kind}:${id}`;
}

export function buildDmTarget(userId: string): string {
  return buildTarget("dm", userId);
}

export function buildGroupTarget(chatId: string): string {
  return buildTarget("group", chatId);
}

export function buildChannelTarget(chatId: string): string {
  return buildTarget("channel", chatId);
}

export function extractChatId(target: string): string | null {
  const parsed = parseTarget(target);
  return parsed?.id ?? null;
}

export function normalizeTarget(raw: string): string | undefined {
  const parsed = parseTarget(raw);
  if (!parsed) return undefined;
  return buildTarget(parsed.kind, parsed.id);
}
