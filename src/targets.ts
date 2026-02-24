// Target ID normalization and resolution for RingCentral

export function normalizeRingCentralTarget(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Remove common prefixes
  let normalized = trimmed
    .replace(/^(ringcentral|rc):/i, "")
    .replace(/^(chat|user|group|team):/i, "")
    .trim();

  if (!normalized) return null;

  // Sanitize unsafe characters (e.g. prevent path traversal or API route injection)
  // Replaces anything not alphanumeric, dash, or underscore with underscore.
  // RingCentral IDs are typically numeric or simple strings.
  return normalized.replace(/[^a-zA-Z0-9\-_]/g, "_");
}

export function isRingCentralChatTarget(target: string): boolean {
  const normalized = normalizeRingCentralTarget(target);
  if (!normalized) return false;
  // RingCentral chat IDs are typically numeric strings
  return /^\d+$/.test(normalized);
}

export function isRingCentralUserTarget(target: string): boolean {
  const normalized = normalizeRingCentralTarget(target);
  if (!normalized) return false;
  // User IDs can be numeric or prefixed
  return /^\d+$/.test(normalized) || normalized.toLowerCase().startsWith("user:");
}

export function formatRingCentralChatTarget(chatId: string): string {
  return `rc:chat:${chatId}`;
}

export function formatRingCentralUserTarget(userId: string): string {
  return `rc:user:${userId}`;
}

export function parseRingCentralTarget(target: string): {
  type: "chat" | "user" | "unknown";
  id: string;
} {
  const trimmed = target.trim();
  
  // Check for explicit type prefixes
  const chatMatch = trimmed.match(/^(?:ringcentral|rc)?:?chat:(.+)$/i);
  if (chatMatch) {
    return { type: "chat", id: chatMatch[1].trim() };
  }

  const userMatch = trimmed.match(/^(?:ringcentral|rc)?:?user:(.+)$/i);
  if (userMatch) {
    return { type: "user", id: userMatch[1].trim() };
  }

  const groupMatch = trimmed.match(/^(?:ringcentral|rc)?:?(?:group|team):(.+)$/i);
  if (groupMatch) {
    return { type: "chat", id: groupMatch[1].trim() };
  }

  // Remove any remaining prefix
  const cleaned = trimmed.replace(/^(?:ringcentral|rc):/i, "").trim();
  
  // Default to chat for numeric IDs
  if (/^\d+$/.test(cleaned)) {
    return { type: "chat", id: cleaned };
  }

  return { type: "unknown", id: cleaned };
}
