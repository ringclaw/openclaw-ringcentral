// OpenClaw action protocol adapter — maps agent tool calls to actions.ts.

import { randomBytes } from "node:crypto";
import type { AgentToolResult } from "openclaw/plugin-sdk/agent-core";
import type {
  ChannelMessageActionAdapter,
  ChannelMessageActionName,
} from "openclaw/plugin-sdk/channel-contract";
import type { RingCentralClient } from "./client.js";
import type { CreateAdaptiveCardRequest } from "./types.js";
import { createBotClient, createOwnerClient } from "./client.js";
import { getRcConfig, hasOwnerCredentials, isAccountConfigured, resolveAccount } from "./accounts.js";
import * as actions from "./actions.js";
import { extractChatId } from "./targets.js";

const CHAT_SCOPED_ACTIONS = new Set<ActionName>([
  "send-message",
  "read-messages",
  "edit-message",
  "delete-message",
  "channel-info",
  "list-tasks",
  "create-task",
  "list-notes",
  "create-note",
  "get-note",
  "update-note",
  "delete-note",
  "publish-note",
  "create-adaptive-card",
  "get-adaptive-card",
  "update-adaptive-card",
  "delete-adaptive-card",
]);

const PROTECTED_ACTIONS = new Set<ActionName>([
  "delete-message",
  "delete-task",
  "delete-event",
  "delete-note",
  "update-task",
  "update-event",
  "update-note",
  "edit-message",
  "update-adaptive-card",
  "delete-adaptive-card",
]);

const PENDING_ACTION_TTL_MS = 2 * 60 * 1000; // 2 minutes

interface PendingAction {
  action: ActionName;
  params: Record<string, unknown>;
  expiresAt: number;
}

const pendingActions = new Map<string, PendingAction>();

export const __testing = {
  pendingActions,
};

function cleanExpiredPendingActions(): void {
  const now = Date.now();
  for (const [nonce, pending] of pendingActions) {
    if (now >= pending.expiresAt) pendingActions.delete(nonce);
  }
}

function generateNonce(): string {
  return randomBytes(16).toString("hex");
}

function buildConfirmationSummary(action: ActionName, params: Record<string, unknown>): string {
  const id = String(
    params.taskId ??
      params.eventId ??
      params.noteId ??
      params.cardId ??
      params.postId ??
      params.id ??
      params.messageId ??
      "",
  );
  return `Confirm ${action}${id ? ` (id: ${id})` : ""}?`;
}

export type ActionName =
  | "send-message"
  | "read-messages"
  | "edit-message"
  | "delete-message"
  | "channel-info"
  | "list-tasks"
  | "create-task"
  | "update-task"
  | "complete-task"
  | "delete-task"
  | "list-events"
  | "create-event"
  | "update-event"
  | "delete-event"
  | "list-notes"
  | "create-note"
  | "get-note"
  | "update-note"
  | "delete-note"
  | "publish-note"
  | "create-adaptive-card"
  | "get-adaptive-card"
  | "update-adaptive-card"
  | "delete-adaptive-card"
  | "confirm-action";

export interface ActionConfig {
  messages?: boolean;
  channelInfo?: boolean;
  tasks?: boolean;
  events?: boolean;
  notes?: boolean;
  adaptiveCards?: boolean;
}

export function getEnabledActions(config: ActionConfig = {}): ActionName[] {
  const all: ActionName[] = [];
  if (config.messages !== false) {
    all.push("send-message", "read-messages", "edit-message", "delete-message");
  }
  if (config.channelInfo !== false) {
    all.push("channel-info");
  }
  if (config.tasks !== false) {
    all.push("list-tasks", "create-task", "update-task", "complete-task", "delete-task");
  }
  if (config.events !== false) {
    all.push("list-events", "create-event", "update-event", "delete-event");
  }
  if (config.notes !== false) {
    all.push("list-notes", "create-note", "get-note", "update-note", "delete-note", "publish-note");
  }
  if (config.adaptiveCards !== false) {
    all.push(
      "create-adaptive-card",
      "get-adaptive-card",
      "update-adaptive-card",
      "delete-adaptive-card",
    );
  }
  all.push("confirm-action");
  return all;
}

function getEnabledMessageActions(config: ActionConfig = {}): ChannelMessageActionName[] {
  const enabled: ChannelMessageActionName[] = [];
  if (config.messages !== false) {
    enabled.push("send", "read", "edit", "delete");
  }
  if (config.channelInfo !== false) {
    enabled.push("channel-info");
  }
  return enabled;
}

function agentToolResult(details: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
    details,
  };
}

function readTargetChatId(params: Record<string, unknown>): string {
  const target = String(params.to ?? params.chatId ?? params.chat_id ?? "");
  return extractChatId(target) ?? target;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readAdaptiveCardPayload(params: Record<string, unknown>): CreateAdaptiveCardRequest {
  if (isRecord(params.card)) {
    return { ...params.card, type: "AdaptiveCard" } as CreateAdaptiveCardRequest;
  }
  if (Array.isArray(params.body)) {
    return {
      type: "AdaptiveCard",
      body: params.body,
      version: String(params.version ?? "1.3"),
      ...(Array.isArray(params.actions) ? { actions: params.actions } : {}),
    };
  }
  const text = String(params.text ?? params.title ?? "RingCentral Adaptive Card");
  return {
    type: "AdaptiveCard",
    version: "1.3",
    body: [{ type: "TextBlock", text, wrap: true }],
  };
}

function createActionClient(cfg: unknown): RingCentralClient {
  const rcCfg = getRcConfig(cfg);
  const account = resolveAccount(rcCfg);
  if (hasOwnerCredentials(account)) {
    return createOwnerClient(
      account.server,
      account.ownerCredentials!.clientId,
      account.ownerCredentials!.clientSecret,
      account.ownerCredentials!.jwt,
    );
  }
  return createBotClient(account.server, account.botToken);
}

export const ringCentralMessageActions: ChannelMessageActionAdapter = {
  describeMessageTool: ({ cfg }) => {
    const rcCfg = getRcConfig(cfg);
    if (!isAccountConfigured(rcCfg)) {
      return { actions: [], capabilities: [], schema: null };
    }
    return {
      actions: getEnabledMessageActions(rcCfg.actions),
      capabilities: ["delivery-pin"],
      schema: null,
    };
  },
  supportsAction: ({ action }) =>
    ["send", "read", "edit", "delete", "channel-info"].includes(action),
  extractToolSend: ({ args }) => {
    const action = String(args.action ?? "");
    if (action !== "send" && action !== "sendMessage") {
      return null;
    }
    const to = String(args.to ?? "");
    return to ? { to } : null;
  },
  prepareSendPayload: ({ ctx, payload }) => (ctx.action === "send" ? payload : null),
  handleAction: async (ctx) => {
    const client = createActionClient(ctx.cfg);
    const params = ctx.params as Record<string, unknown>;
    const chatId = readTargetChatId(params);
    const postId = String(params.postId ?? params.post_id ?? params.messageId ?? "");
    const text = String(params.text ?? params.message ?? "");
    switch (ctx.action) {
      case "send":
        return agentToolResult(await actions.actionSendMessage(client, chatId, text));
      case "read":
        return agentToolResult(await actions.actionReadMessages(client, chatId, Number(params.count) || 20));
      case "edit":
        return agentToolResult(await actions.actionEditMessage(client, chatId, postId, text));
      case "delete":
        return agentToolResult(await actions.actionDeleteMessage(client, chatId, postId));
      case "channel-info":
        return agentToolResult(await actions.actionGetChannelInfo(client, chatId));
      default:
        throw new Error(`Unsupported RingCentral action: ${ctx.action}`);
    }
  },
};

export async function handleAction(
  client: RingCentralClient,
  action: ActionName,
  params: Record<string, unknown>,
  sessionChatId?: string,
): Promise<unknown> {
  const chatId = String(params.chatId ?? params.chat_id ?? "");
  const postId = String(params.postId ?? params.post_id ?? params.messageId ?? "");
  const text = String(params.text ?? params.message ?? "");

  // Scope check: ensure chat-scoped actions target the active session's chat
  if (sessionChatId && CHAT_SCOPED_ACTIONS.has(action) && chatId && chatId !== sessionChatId) {
    return { success: false, error: `Action scope violation: chatId "${chatId}" does not match current session chat` };
  }

  // Handle confirmation flow for protected actions
  if (action === "confirm-action") {
    const nonce = String(params.nonce ?? params.confirmationId ?? "");
    cleanExpiredPendingActions();
    const pending = pendingActions.get(nonce);
    if (!pending) {
      return { success: false, error: "Invalid or expired confirmation. Please retry the original action." };
    }
    pendingActions.delete(nonce);
    return executeAction(client, pending.action, pending.params);
  }

  if (PROTECTED_ACTIONS.has(action)) {
    cleanExpiredPendingActions();
    const nonce = generateNonce();
    pendingActions.set(nonce, { action, params: { ...params }, expiresAt: Date.now() + PENDING_ACTION_TTL_MS });
    return {
      requiresConfirmation: true,
      confirmationId: nonce,
      summary: buildConfirmationSummary(action, params),
      action,
    };
  }

  return executeAction(client, action, params);
}

async function executeAction(
  client: RingCentralClient,
  action: ActionName,
  params: Record<string, unknown>,
): Promise<unknown> {
  const chatId = String(params.chatId ?? params.chat_id ?? "");
  const postId = String(params.postId ?? params.post_id ?? params.messageId ?? "");
  const text = String(params.text ?? params.message ?? "");

  switch (action) {
    case "send-message":
      return actions.actionSendMessage(client, chatId, text);
    case "read-messages":
      return actions.actionReadMessages(client, chatId, Number(params.count) || 20);
    case "edit-message":
      return actions.actionEditMessage(client, chatId, postId, text);
    case "delete-message":
      return actions.actionDeleteMessage(client, chatId, postId);
    case "channel-info":
      return actions.actionGetChannelInfo(client, chatId);
    case "list-tasks":
      return actions.actionListTasks(client, chatId);
    case "create-task": {
      const subject = String(params.subject ?? params.title ?? "");
      const assigneeId = params.assigneeId ? String(params.assigneeId) : undefined;
      return actions.actionCreateTask(client, chatId, subject, assigneeId);
    }
    case "update-task": {
      const taskId = String(params.taskId ?? params.id ?? "");
      const subject = String(params.subject ?? params.title ?? "");
      return actions.actionUpdateTask(client, taskId, subject);
    }
    case "complete-task": {
      const taskId = String(params.taskId ?? params.id ?? "");
      const assigneeId = String(params.assigneeId ?? params.assignee ?? "");
      return actions.actionCompleteTask(client, taskId, assigneeId);
    }
    case "delete-task": {
      const taskId = String(params.taskId ?? params.id ?? "");
      return actions.actionDeleteTask(client, taskId);
    }
    case "list-events":
      return actions.actionListEvents(client);
    case "create-event": {
      const title = String(params.title ?? "");
      const startTime = String(params.startTime ?? params.start ?? "");
      const endTime = String(params.endTime ?? params.end ?? "");
      return actions.actionCreateEvent(client, title, startTime, endTime);
    }
    case "update-event": {
      const eventId = String(params.eventId ?? params.id ?? "");
      return actions.actionUpdateEvent(client, eventId, {
        title: params.title ? String(params.title) : undefined,
        startTime: params.startTime ? String(params.startTime) : undefined,
        endTime: params.endTime ? String(params.endTime) : undefined,
      });
    }
    case "delete-event": {
      const eventId = String(params.eventId ?? params.id ?? "");
      return actions.actionDeleteEvent(client, eventId);
    }
    case "list-notes":
      return actions.actionListNotes(client, chatId);
    case "create-note": {
      const title = String(params.title ?? "");
      const body = params.body ? String(params.body) : undefined;
      const publish = Boolean(params.publish ?? params.publishImmediately);
      return actions.actionCreateNote(client, chatId, title, body, publish);
    }
    case "get-note": {
      const noteId = String(params.noteId ?? params.id ?? "");
      return actions.actionGetNote(client, noteId);
    }
    case "update-note": {
      const noteId = String(params.noteId ?? params.id ?? "");
      return actions.actionUpdateNote(client, noteId, {
        title: params.title ? String(params.title) : undefined,
        body: params.body ? String(params.body) : undefined,
      });
    }
    case "delete-note": {
      const noteId = String(params.noteId ?? params.id ?? "");
      return actions.actionDeleteNote(client, noteId);
    }
    case "publish-note": {
      const noteId = String(params.noteId ?? params.id ?? "");
      return actions.actionPublishNote(client, noteId);
    }
    case "create-adaptive-card":
      return actions.actionCreateAdaptiveCard(client, chatId, readAdaptiveCardPayload(params));
    case "get-adaptive-card": {
      const cardId = String(params.cardId ?? params.id ?? "");
      return actions.actionGetAdaptiveCard(client, cardId);
    }
    case "update-adaptive-card": {
      const cardId = String(params.cardId ?? params.id ?? "");
      return actions.actionUpdateAdaptiveCard(client, cardId, readAdaptiveCardPayload(params));
    }
    case "delete-adaptive-card": {
      const cardId = String(params.cardId ?? params.id ?? "");
      return actions.actionDeleteAdaptiveCard(client, cardId);
    }
    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}
