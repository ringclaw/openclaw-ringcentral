import type { AgentToolResult } from "openclaw/plugin-sdk/agent-core";
import type { ChannelAgentTool } from "openclaw/plugin-sdk/channel-contract";
import { Type } from "typebox";
import { getRcConfig, hasOwnerCredentials, resolveAccount } from "./accounts.js";
import { createOwnerClient } from "./client.js";
import { extractChatId, parseTarget } from "./targets.js";
import type { PersonInfo, Post } from "./types.js";

type HistoryTargetType = "auto" | "chat" | "person";

const TARGET_MENTION_RE = /!\[:(?<type>[A-Za-z]+)\]\((?<id>[^)]+)\)/;

export function createRingCentralHistoryTool(cfg?: unknown): ChannelAgentTool {
  return {
    label: "RingCentral Recent Messages",
    name: "ringcentral_get_recent_messages",
    description: "Read recent RingCentral Team Messaging messages using owner credentials.",
    parameters: Type.Object({
      target: Type.Optional(Type.String()),
      target_type: Type.Optional(
        Type.Unsafe<HistoryTargetType>({
          type: "string",
          enum: ["auto", "chat", "person"],
        }),
      ),
      record_count: Type.Optional(Type.Number({ minimum: 1, maximum: 1000 })),
    }),
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as Record<string, unknown>;
      return await readRecentMessages({
        cfg,
        target: readString(params.target),
        targetType: readTargetType(params.target_type),
        recordCount: clampRecordCount(params.record_count),
      });
    },
  };
}

async function readRecentMessages(params: {
  cfg?: unknown;
  target?: string;
  targetType: HistoryTargetType;
  recordCount: number;
}): Promise<AgentToolResult<unknown>> {
  const account = resolveAccount(getRcConfig(params.cfg ?? {}));
  if (!hasOwnerCredentials(account)) {
    return textResult("RingCentral owner credentials are not configured.");
  }
  const client = createOwnerClient(
    account.server,
    account.ownerCredentials!.clientId,
    account.ownerCredentials!.clientSecret,
    account.ownerCredentials!.jwt,
  );
  const resolved = await resolveHistoryTarget({
    client,
    target: params.target ?? account.homeChannel,
    targetType: params.targetType,
  });
  if (!resolved) {
    return textResult("Unable to resolve RingCentral history target.");
  }
  let posts: Post[] = [];
  try {
    posts = (await client.listPosts(resolved.chatId, params.recordCount)).records ?? [];
  } catch {
    posts = [];
  }
  if (posts.length === 0) {
    try {
      posts = (await client.listLegacyGroupPosts(resolved.chatId, params.recordCount)).records ?? [];
    } catch {
      posts = [];
    }
  }
  const formatted = formatPosts(posts);
  return {
    content: [
      {
        type: "text",
        text: [
          `RingCentral history target: ${resolved.label ?? resolved.chatId}`,
          `Messages returned: ${posts.length}`,
          "",
          formatted || "(no messages)",
        ].join("\n"),
      },
    ],
    details: {
      chatId: resolved.chatId,
      label: resolved.label,
      count: posts.length,
      records: posts,
    },
  };
}

async function resolveHistoryTarget(params: {
  client: ReturnType<typeof createOwnerClient>;
  target?: string;
  targetType: HistoryTargetType;
}): Promise<{ chatId: string; label?: string } | null> {
  const target = params.target?.trim();
  if (!target) {
    return null;
  }
  const mentioned = TARGET_MENTION_RE.exec(target);
  if (mentioned?.groups?.id) {
    if (mentioned.groups.type.toLowerCase() === "person") {
      const chat = await params.client.createOrFindDm([mentioned.groups.id]);
      return { chatId: chat.id, label: mentioned.groups.id };
    }
    return { chatId: mentioned.groups.id, label: target };
  }
  const parsed = parseTarget(target);
  if (parsed && parsed.kind !== "dm" && parsed.kind !== "user") {
    return { chatId: parsed.id, label: target };
  }
  const chatId = extractChatId(target);
  if (params.targetType === "chat" && chatId) {
    return { chatId, label: target };
  }
  if (params.targetType === "person" || target.includes("@")) {
    const person = await findPerson(params.client, target);
    if (!person?.id) {
      return null;
    }
    const chat = await params.client.createOrFindDm([person.id]);
    return { chatId: chat.id, label: person.email ?? formatPersonName(person) ?? person.id };
  }
  const chats = await params.client.listChats(undefined, 250);
  const normalized = target.toLowerCase();
  const chat = chats.records.find(
    (record) => record.id === target || record.name?.toLowerCase() === normalized,
  );
  if (chat) {
    return { chatId: chat.id, label: chat.name ?? chat.id };
  }
  if (chatId) {
    return { chatId, label: target };
  }
  return null;
}

async function findPerson(
  client: ReturnType<typeof createOwnerClient>,
  query: string,
): Promise<PersonInfo | null> {
  const result = await client.searchDirectory(query);
  const normalized = query.toLowerCase();
  return (
    result.records.find((person) => person.email?.toLowerCase() === normalized) ??
    result.records[0] ??
    null
  );
}

function formatPosts(posts: Post[]): string {
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

function formatPersonName(person: PersonInfo): string | undefined {
  const name = [person.firstName, person.lastName].filter(Boolean).join(" ").trim();
  return name || undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readTargetType(value: unknown): HistoryTargetType {
  return value === "chat" || value === "person" || value === "auto" ? value : "auto";
}

function clampRecordCount(value: unknown): number {
  const parsed = Number(value ?? 250);
  return Math.min(Math.max(Number.isFinite(parsed) ? Math.trunc(parsed) : 250, 1), 1000);
}

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details: { ok: false, error: text } };
}
