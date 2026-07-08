import { randomBytes } from "node:crypto";
import type { AgentToolResult } from "openclaw/plugin-sdk/agent-core";
import type { ChannelAgentTool } from "openclaw/plugin-sdk/channel-contract";
import { Type } from "typebox";
import { hasOwnerCredentials, resolveAccount } from "./accounts.js";
import { createBotClient, createOwnerClient, type RingCentralClient } from "./client.js";
import { tryGetRingCentralRuntime } from "./runtime.js";
import { extractChatId } from "./targets.js";
import type {
  CreateAdaptiveCardRequest,
  CreateEventRequest,
  CreateNoteRequest,
  ResolvedAccount,
  RingCentralConfig,
} from "./types.js";

type ArtifactPendingAction =
  | {
      kind: "create-event";
      chatId: string;
      payload: CreateEventRequest;
    }
  | {
      kind: "update-event";
      chatId: string;
      eventId: string;
      payload: CreateEventRequest;
    }
  | {
      kind: "delete-event";
      chatId: string;
      eventId: string;
    }
  | {
      kind: "create-note";
      chatId: string;
      payload: CreateNoteRequest;
      publish: boolean;
    }
  | {
      kind: "update-note";
      chatId: string;
      noteId: string;
      payload: Partial<CreateNoteRequest>;
    }
  | {
      kind: "delete-note";
      chatId: string;
      noteId: string;
    }
  | {
      kind: "publish-note";
      chatId: string;
      noteId: string;
    };

interface PendingEntry {
  action: ArtifactPendingAction;
  expiresAt: number;
  summary: string;
}

const PENDING_CONFIRMATION_TTL_MS = 2 * 60 * 1000;
const pendingConfirmations = new Map<string, PendingEntry>();

export const RINGCENTRAL_ARTIFACT_TOOL_NAMES = [
  "ringcentral_confirm_artifact_action",
  "ringcentral_create_adaptive_card",
  "ringcentral_get_adaptive_card",
  "ringcentral_update_adaptive_card",
  "ringcentral_delete_adaptive_card",
  "ringcentral_list_notes",
  "ringcentral_create_note",
  "ringcentral_get_note",
  "ringcentral_update_note",
  "ringcentral_delete_note",
  "ringcentral_publish_note",
  "ringcentral_list_calendar_events",
  "ringcentral_create_calendar_event",
  "ringcentral_get_calendar_event",
  "ringcentral_update_calendar_event",
  "ringcentral_delete_calendar_event",
] as const;

export const __testing = {
  pendingConfirmations,
};

export function createRingCentralArtifactTools(cfg?: unknown): ChannelAgentTool[] {
  return [
    confirmArtifactActionTool(cfg),
    createAdaptiveCardTool(cfg),
    getAdaptiveCardTool(cfg),
    updateAdaptiveCardTool(cfg),
    deleteAdaptiveCardTool(cfg),
    listNotesTool(cfg),
    createNoteTool(cfg),
    getNoteTool(cfg),
    updateNoteTool(cfg),
    deleteNoteTool(cfg),
    publishNoteTool(cfg),
    listEventsTool(cfg),
    createEventTool(cfg),
    getEventTool(cfg),
    updateEventTool(cfg),
    deleteEventTool(cfg),
  ];
}

function confirmArtifactActionTool(cfg?: unknown): ChannelAgentTool {
  return {
    name: "ringcentral_confirm_artifact_action",
    label: "Confirm RingCentral Artifact Action",
    description: "Confirm a pending RingCentral owner-backed artifact write from the configured Home DM.",
    parameters: Type.Object({
      confirmation_id: Type.String(),
      chat_id: Type.String(),
    }),
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as Record<string, unknown>;
      return confirmArtifactAction({
        cfg,
        confirmationId: readString(params.confirmation_id),
        chatId: readChatId(params.chat_id),
      });
    },
  };
}

function createAdaptiveCardTool(cfg?: unknown): ChannelAgentTool {
  return {
    name: "ringcentral_create_adaptive_card",
    label: "Create RingCentral Adaptive Card",
    description: "Create an Adaptive Card in the configured RingCentral Home chat or an allowlisted chat using the bot token.",
    parameters: Type.Object({
      chat_id: Type.Optional(Type.String()),
      card: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      text: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as Record<string, unknown>;
      return runBotCardTool(cfg, params, async (client, chatId) => {
        const card = await client.createAdaptiveCard(chatId, adaptiveCardPayload(params));
        return okResult({ success: true, card_id: card.id, type: card.type });
      });
    },
  };
}

function getAdaptiveCardTool(cfg?: unknown): ChannelAgentTool {
  return {
    name: "ringcentral_get_adaptive_card",
    label: "Get RingCentral Adaptive Card",
    description: "Read a RingCentral Adaptive Card by card ID using the bot token.",
    parameters: Type.Object({
      chat_id: Type.Optional(Type.String()),
      card_id: Type.String(),
    }),
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as Record<string, unknown>;
      const cardId = readString(params.card_id);
      if (!cardId) return errorResult("card_id is required.");
      return runBotCardTool(cfg, params, async (client) => {
        const card = await client.getAdaptiveCard(cardId);
        return okResult({ success: true, card });
      });
    },
  };
}

function updateAdaptiveCardTool(cfg?: unknown): ChannelAgentTool {
  return {
    name: "ringcentral_update_adaptive_card",
    label: "Update RingCentral Adaptive Card",
    description: "Replace an Adaptive Card from the configured RingCentral Home chat or an allowlisted chat using the bot token.",
    parameters: Type.Object({
      chat_id: Type.Optional(Type.String()),
      card_id: Type.String(),
      card: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      text: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as Record<string, unknown>;
      const cardId = readString(params.card_id);
      if (!cardId) return errorResult("card_id is required.");
      return runBotCardTool(cfg, params, async (client) => {
        const card = await client.updateAdaptiveCard(cardId, adaptiveCardPayload(params));
        return okResult({ success: true, card_id: card.id, type: card.type });
      });
    },
  };
}

function deleteAdaptiveCardTool(cfg?: unknown): ChannelAgentTool {
  return {
    name: "ringcentral_delete_adaptive_card",
    label: "Delete RingCentral Adaptive Card",
    description: "Delete an Adaptive Card by card ID using the bot token.",
    parameters: Type.Object({
      chat_id: Type.Optional(Type.String()),
      card_id: Type.String(),
    }),
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as Record<string, unknown>;
      const cardId = readString(params.card_id);
      if (!cardId) return errorResult("card_id is required.");
      return runBotCardTool(cfg, params, async (client) => {
        await client.deleteAdaptiveCard(cardId);
        return okResult({ success: true, deleted: true });
      });
    },
  };
}

function listNotesTool(cfg?: unknown): ChannelAgentTool {
  return {
    name: "ringcentral_list_notes",
    label: "List RingCentral Notes",
    description: "List notes in the configured RingCentral Home chat using owner credentials or an allowlisted chat using the bot token.",
    parameters: Type.Object({
      chat_id: Type.Optional(Type.String()),
      record_count: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
    }),
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as Record<string, unknown>;
      return runArtifactReadTool(cfg, params, async (client, chatId) => {
        const result = await client.listNotes(chatId);
        return okResult({
          success: true,
          notes: result.records,
          fetched_count: result.records.length,
        });
      });
    },
  };
}

function createNoteTool(cfg?: unknown): ChannelAgentTool {
  return {
    name: "ringcentral_create_note",
    label: "Create RingCentral Note",
    description: "Create a RingCentral note. Allowlisted chats use the bot token; other non-Home writes require Home DM confirmation.",
    parameters: Type.Object({
      chat_id: Type.Optional(Type.String()),
      title: Type.String(),
      body: Type.Optional(Type.String()),
      publish: Type.Optional(Type.Boolean()),
    }),
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as Record<string, unknown>;
      const title = readString(params.title);
      if (!title) return errorResult("title is required.");
      const action: ArtifactPendingAction = {
        kind: "create-note",
        chatId: "",
        payload: { title, body: readOptionalString(params.body) },
        publish: Boolean(params.publish),
      };
      return runOwnerWriteTool(cfg, params, action, "create note");
    },
  };
}

function getNoteTool(cfg?: unknown): ChannelAgentTool {
  return {
    name: "ringcentral_get_note",
    label: "Get RingCentral Note",
    description: "Read a RingCentral note by note ID using owner credentials or an allowlisted chat using the bot token.",
    parameters: Type.Object({
      chat_id: Type.Optional(Type.String()),
      note_id: Type.String(),
    }),
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as Record<string, unknown>;
      const noteId = readString(params.note_id);
      if (!noteId) return errorResult("note_id is required.");
      return runArtifactReadTool(cfg, params, async (client) => {
        const note = await client.getNote(noteId);
        return okResult({ success: true, note });
      });
    },
  };
}

function updateNoteTool(cfg?: unknown): ChannelAgentTool {
  return {
    name: "ringcentral_update_note",
    label: "Update RingCentral Note",
    description: "Update a RingCentral note. Allowlisted chats use the bot token; other non-Home writes require Home DM confirmation.",
    parameters: Type.Object({
      chat_id: Type.Optional(Type.String()),
      note_id: Type.String(),
      title: Type.Optional(Type.String()),
      body: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as Record<string, unknown>;
      const noteId = readString(params.note_id);
      if (!noteId) return errorResult("note_id is required.");
      const payload: Partial<CreateNoteRequest> = {};
      if (params.title !== undefined) payload.title = String(params.title);
      if (params.body !== undefined) payload.body = String(params.body);
      if (!payload.title && !payload.body) return errorResult("title or body is required.");
      return runOwnerWriteTool(
        cfg,
        params,
        { kind: "update-note", chatId: "", noteId, payload },
        `update note ${noteId}`,
      );
    },
  };
}

function deleteNoteTool(cfg?: unknown): ChannelAgentTool {
  return noteIdWriteTool({
    cfg,
    name: "ringcentral_delete_note",
    label: "Delete RingCentral Note",
    description: "Delete a RingCentral note. Allowlisted chats use the bot token; other non-Home writes require Home DM confirmation.",
    kind: "delete-note",
    summaryVerb: "delete",
  });
}

function publishNoteTool(cfg?: unknown): ChannelAgentTool {
  return noteIdWriteTool({
    cfg,
    name: "ringcentral_publish_note",
    label: "Publish RingCentral Note",
    description: "Publish a RingCentral note. Allowlisted chats use the bot token; other non-Home writes require Home DM confirmation.",
    kind: "publish-note",
    summaryVerb: "publish",
  });
}

function noteIdWriteTool(options: {
  cfg?: unknown;
  name: string;
  label: string;
  description: string;
  kind: "delete-note" | "publish-note";
  summaryVerb: string;
}): ChannelAgentTool {
  return {
    name: options.name,
    label: options.label,
    description: options.description,
    parameters: Type.Object({
      chat_id: Type.Optional(Type.String()),
      note_id: Type.String(),
    }),
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as Record<string, unknown>;
      const noteId = readString(params.note_id);
      if (!noteId) return errorResult("note_id is required.");
      return runOwnerWriteTool(
        options.cfg,
        params,
        { kind: options.kind, chatId: "", noteId },
        `${options.summaryVerb} note ${noteId}`,
      );
    },
  };
}

function listEventsTool(cfg?: unknown): ChannelAgentTool {
  return {
    name: "ringcentral_list_calendar_events",
    label: "List RingCentral Calendar Events",
    description: "List calendar events in the configured RingCentral Home chat using owner credentials or an allowlisted chat using the bot token.",
    parameters: Type.Object({
      chat_id: Type.Optional(Type.String()),
      record_count: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
    }),
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as Record<string, unknown>;
      return runArtifactReadTool(cfg, params, async (client, chatId) => {
        const result = await client.listEvents(chatId, clampCount(params.record_count, 50, 1, 100));
        return okResult({
          success: true,
          events: result.records,
          fetched_count: result.records.length,
        });
      });
    },
  };
}

function createEventTool(cfg?: unknown): ChannelAgentTool {
  return {
    name: "ringcentral_create_calendar_event",
    label: "Create RingCentral Calendar Event",
    description: "Create a RingCentral calendar event. Allowlisted chats use the bot token; other non-Home writes require Home DM confirmation.",
    parameters: Type.Object({
      chat_id: Type.Optional(Type.String()),
      title: Type.String(),
      start_time: Type.String(),
      end_time: Type.String(),
      description: Type.Optional(Type.String()),
      location: Type.Optional(Type.String()),
      all_day: Type.Optional(Type.Boolean()),
    }),
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as Record<string, unknown>;
      const payload = eventPayload(params);
      if (!payload.title || !payload.startTime || !payload.endTime) {
        return errorResult("title, start_time, and end_time are required.");
      }
      return runOwnerWriteTool(
        cfg,
        params,
        { kind: "create-event", chatId: "", payload },
        "create calendar event",
      );
    },
  };
}

function getEventTool(cfg?: unknown): ChannelAgentTool {
  return {
    name: "ringcentral_get_calendar_event",
    label: "Get RingCentral Calendar Event",
    description: "Read a RingCentral calendar event by event ID using owner credentials or an allowlisted chat using the bot token.",
    parameters: Type.Object({
      chat_id: Type.Optional(Type.String()),
      event_id: Type.String(),
    }),
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as Record<string, unknown>;
      const eventId = readString(params.event_id);
      if (!eventId) return errorResult("event_id is required.");
      return runArtifactReadTool(cfg, params, async (client) => {
        const event = await client.getEvent(eventId);
        return okResult({ success: true, event });
      });
    },
  };
}

function updateEventTool(cfg?: unknown): ChannelAgentTool {
  return {
    name: "ringcentral_update_calendar_event",
    label: "Update RingCentral Calendar Event",
    description: "Update a RingCentral calendar event. Allowlisted chats use the bot token; other non-Home writes require Home DM confirmation.",
    parameters: Type.Object({
      chat_id: Type.Optional(Type.String()),
      event_id: Type.String(),
      title: Type.String(),
      start_time: Type.String(),
      end_time: Type.String(),
      description: Type.Optional(Type.String()),
      location: Type.Optional(Type.String()),
      all_day: Type.Optional(Type.Boolean()),
    }),
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as Record<string, unknown>;
      const eventId = readString(params.event_id);
      if (!eventId) return errorResult("event_id is required.");
      const payload = eventPayload(params);
      if (!payload.title || !payload.startTime || !payload.endTime) {
        return errorResult("title, start_time, and end_time are required.");
      }
      return runOwnerWriteTool(
        cfg,
        params,
        { kind: "update-event", chatId: "", eventId, payload },
        `update calendar event ${eventId}`,
      );
    },
  };
}

function deleteEventTool(cfg?: unknown): ChannelAgentTool {
  return {
    name: "ringcentral_delete_calendar_event",
    label: "Delete RingCentral Calendar Event",
    description: "Delete a RingCentral calendar event. Allowlisted chats use the bot token; other non-Home writes require Home DM confirmation.",
    parameters: Type.Object({
      chat_id: Type.Optional(Type.String()),
      event_id: Type.String(),
    }),
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as Record<string, unknown>;
      const eventId = readString(params.event_id);
      if (!eventId) return errorResult("event_id is required.");
      return runOwnerWriteTool(
        cfg,
        params,
        { kind: "delete-event", chatId: "", eventId },
        `delete calendar event ${eventId}`,
      );
    },
  };
}

async function runBotCardTool(
  cfg: unknown,
  params: Record<string, unknown>,
  fn: (client: RingCentralClient, chatId: string) => Promise<AgentToolResult<unknown>>,
): Promise<AgentToolResult<unknown>> {
  const target = resolveArtifactTarget(cfg, params);
  if (!target.chatId) {
    return errorResult("chat_id is required unless RC_HOME_CHANNEL/homeChannel is configured.");
  }
  if (!target.isHome && !target.isAllowlisted) {
    return errorResult("RingCentral bot artifact tools can only target the configured Home chat or explicitly allowlisted chats.");
  }
  return runBotArtifactAction(target.account, (client) => fn(client, target.chatId));
}

async function runArtifactReadTool(
  cfg: unknown,
  params: Record<string, unknown>,
  fn: (client: RingCentralClient, chatId: string) => Promise<AgentToolResult<unknown>>,
): Promise<AgentToolResult<unknown>> {
  const target = resolveArtifactTarget(cfg, params);
  if (!target.chatId) {
    return errorResult("chat_id is required unless RC_HOME_CHANNEL/homeChannel is configured.");
  }
  if (target.isAllowlisted) {
    return runBotArtifactAction(target.account, (client) => fn(client, target.chatId));
  }
  if (!target.isHome) {
    return errorResult("RingCentral owner artifact reads can only target the configured Home chat or explicitly allowlisted chats.");
  }
  if (!hasOwnerCredentials(target.account)) {
    return errorResult("RingCentral owner credentials are not configured.");
  }
  return fn(createOwnerArtifactClientFromAccount(target.account), target.chatId);
}

async function runOwnerWriteTool(
  cfg: unknown,
  params: Record<string, unknown>,
  action: ArtifactPendingAction,
  summary: string,
): Promise<AgentToolResult<unknown>> {
  const target = resolveArtifactTarget(cfg, params);
  if (!target.chatId) {
    return errorResult("chat_id is required unless RC_HOME_CHANNEL/homeChannel is configured.");
  }
  const scopedAction = { ...action, chatId: target.chatId } as ArtifactPendingAction;
  if (target.isAllowlisted) {
    return runBotArtifactAction(target.account, (client) => executePendingAction(client, scopedAction));
  }
  if (!hasOwnerCredentials(target.account)) {
    return errorResult("RingCentral owner credentials are not configured.");
  }
  if (!target.account.homeChannel) {
    return errorResult("RC_HOME_CHANNEL/homeChannel must be configured before owner-backed artifact writes.");
  }
  if (!target.isHome) {
    const confirmationId = createPendingConfirmation(scopedAction, summary);
    return okResult({
      success: false,
      requiresConfirmation: true,
      confirmation_id: confirmationId,
      summary,
      target_chat_id: target.chatId,
      instruction: "Call ringcentral_confirm_artifact_action from the configured Home DM to execute this write.",
    });
  }
  return executePendingAction(createOwnerArtifactClientFromAccount(target.account), scopedAction);
}

async function confirmArtifactAction(params: {
  cfg?: unknown;
  confirmationId?: string;
  chatId?: string;
}): Promise<AgentToolResult<unknown>> {
  const account = resolveArtifactAccount(params.cfg);
  if (!account.homeChannel) {
    return errorResult("RC_HOME_CHANNEL/homeChannel must be configured before confirming artifact writes.");
  }
  if (!params.chatId || params.chatId !== account.homeChannel) {
    return errorResult("RingCentral artifact confirmations must be sent from the configured Home DM.");
  }
  if (!params.confirmationId) {
    return errorResult("confirmation_id is required.");
  }
  cleanExpiredPendingConfirmations();
  const pending = pendingConfirmations.get(params.confirmationId);
  if (!pending) {
    return errorResult("Invalid or expired artifact confirmation.");
  }
  pendingConfirmations.delete(params.confirmationId);
  const result = await executePendingAction(createOwnerArtifactClient(params.cfg), pending.action);
  return {
    ...result,
    details: {
      ...(result.details as Record<string, unknown>),
      confirmed: true,
      summary: pending.summary,
    },
  };
}

async function executePendingAction(
  client: RingCentralClient,
  action: ArtifactPendingAction,
): Promise<AgentToolResult<unknown>> {
  switch (action.kind) {
    case "create-event": {
      const event = await client.createEvent(action.chatId, action.payload);
      return okResult({ success: true, event_id: event.id, event });
    }
    case "update-event": {
      const event = await client.updateEvent(action.eventId, action.payload);
      return okResult({ success: true, event_id: event.id, event });
    }
    case "delete-event":
      await client.deleteEvent(action.eventId);
      return okResult({ success: true, event_id: action.eventId, deleted: true });
    case "create-note": {
      const note = await client.createNote(action.chatId, action.payload);
      let published = false;
      if (action.publish) {
        await client.publishNote(note.id);
        published = true;
      }
      return okResult({ success: true, note_id: note.id, published, note });
    }
    case "update-note": {
      const note = await client.updateNote(action.noteId, action.payload);
      return okResult({ success: true, note_id: note.id, note });
    }
    case "delete-note":
      await client.deleteNote(action.noteId);
      return okResult({ success: true, note_id: action.noteId, deleted: true });
    case "publish-note":
      await client.publishNote(action.noteId);
      return okResult({ success: true, note_id: action.noteId, published: true });
  }
}

function createPendingConfirmation(action: ArtifactPendingAction, summary: string): string {
  cleanExpiredPendingConfirmations();
  const confirmationId = randomBytes(16).toString("hex");
  pendingConfirmations.set(confirmationId, {
    action,
    summary,
    expiresAt: Date.now() + PENDING_CONFIRMATION_TTL_MS,
  });
  return confirmationId;
}

function cleanExpiredPendingConfirmations(): void {
  const now = Date.now();
  for (const [id, pending] of pendingConfirmations) {
    if (now >= pending.expiresAt) {
      pendingConfirmations.delete(id);
    }
  }
}

function resolveArtifactAccount(cfg: unknown) {
  return resolveAccount(resolveArtifactChannelConfig(cfg));
}

function resolveArtifactTarget(cfg: unknown, params: Record<string, unknown>): {
  account: ResolvedAccount;
  chatId: string;
  isAllowlisted: boolean;
  isHome: boolean;
} {
  const account = resolveArtifactAccount(cfg);
  const chatId = resolveToolChatId(params, account.homeChannel) ?? "";
  return {
    account,
    chatId,
    isAllowlisted: chatId ? isArtifactChatAllowlisted(account, chatId) : false,
    isHome: Boolean(chatId && account.homeChannel && chatId === account.homeChannel),
  };
}

function isArtifactChatAllowlisted(account: ResolvedAccount, chatId: string): boolean {
  return account.config.teams?.[chatId]?.allow === true || account.groupDmChannels[chatId]?.allow === true;
}

async function runBotArtifactAction(
  account: ResolvedAccount,
  fn: (client: RingCentralClient) => Promise<AgentToolResult<unknown>>,
): Promise<AgentToolResult<unknown>> {
  try {
    return await fn(createBotClient(account.server, account.botToken));
  } catch (err) {
    return errorResult(`RingCentral bot token artifact operation failed: ${formatError(err)}`);
  }
}

function createOwnerArtifactClient(cfg: unknown): RingCentralClient {
  const account = resolveArtifactAccount(cfg);
  return createOwnerArtifactClientFromAccount(account);
}

function createOwnerArtifactClientFromAccount(account: ResolvedAccount): RingCentralClient {
  if (!hasOwnerCredentials(account)) {
    throw new Error("RingCentral owner credentials are not configured.");
  }
  return createOwnerClient(
    account.server,
    account.ownerCredentials!.clientId,
    account.ownerCredentials!.clientSecret,
    account.ownerCredentials!.jwt,
  );
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function resolveToolChatId(params: Record<string, unknown>, fallback?: string): string | undefined {
  return readChatId(params.chat_id ?? params.chatId ?? params.target) ?? fallback;
}

function resolveArtifactChannelConfig(cfg: unknown): RingCentralConfig {
  const localConfig = readRingCentralChannelConfig(cfg);
  if (localConfig) return localConfig;
  const runtime = tryGetRingCentralRuntime();
  if (!runtime) return {};
  try {
    return readRingCentralChannelConfig(runtime.config.current()) ?? {};
  } catch {
    return {};
  }
}

function readRingCentralChannelConfig(cfg: unknown): RingCentralConfig | undefined {
  if (!isRecord(cfg)) return undefined;
  const channels = cfg.channels;
  if (isRecord(channels) && Object.prototype.hasOwnProperty.call(channels, "ringcentral")) {
    return (channels.ringcentral ?? {}) as RingCentralConfig;
  }
  if (looksLikeRingCentralChannelConfig(cfg)) {
    return cfg as RingCentralConfig;
  }
  return undefined;
}

function looksLikeRingCentralChannelConfig(value: Record<string, unknown>): boolean {
  return [
    "botToken",
    "ownerCredentials",
    "credentials",
    "server",
    "botExtensionId",
    "dmPolicy",
    "allowFrom",
    "groupPolicy",
    "teams",
    "dm",
    "homeChannel",
    "homeChannelName",
  ].some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function readChatId(value: unknown): string | undefined {
  const raw = readString(value);
  if (!raw) return undefined;
  return extractChatId(raw) ?? raw;
}

function adaptiveCardPayload(params: Record<string, unknown>): CreateAdaptiveCardRequest {
  if (isRecord(params.card)) {
    return { ...params.card, type: "AdaptiveCard" } as CreateAdaptiveCardRequest;
  }
  const text = readString(params.text) ?? "RingCentral Adaptive Card";
  return {
    type: "AdaptiveCard",
    version: "1.3",
    body: [{ type: "TextBlock", text, wrap: true }],
  };
}

function eventPayload(params: Record<string, unknown>): CreateEventRequest {
  const payload: CreateEventRequest = {
    title: readString(params.title) ?? "",
    startTime: readString(params.start_time ?? params.startTime ?? params.start) ?? "",
    endTime: readString(params.end_time ?? params.endTime ?? params.end) ?? "",
  };
  if (params.description !== undefined) payload.description = String(params.description);
  if (params.location !== undefined) payload.location = String(params.location);
  if (params.all_day !== undefined) payload.allDay = Boolean(params.all_day);
  if (params.allDay !== undefined) payload.allDay = Boolean(params.allDay);
  return payload;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clampCount(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  return Math.min(Math.max(Number.isFinite(parsed) ? Math.trunc(parsed) : fallback, min), max);
}

function okResult(details: Record<string, unknown>): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
    details,
  };
}

function errorResult(message: string): AgentToolResult<unknown> {
  return okResult({ success: false, error: message });
}
