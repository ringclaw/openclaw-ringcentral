// OpenClaw action protocol adapter — maps agent tool calls to actions.ts.

import type { AgentToolResult } from "openclaw/plugin-sdk/agent-core";
import type {
  ChannelMessageActionAdapter,
  ChannelMessageActionName,
} from "openclaw/plugin-sdk/channel-contract";
import type { RingCentralClient } from "./client.js";
import { createBotClient, createOwnerClient } from "./client.js";
import { getRcConfig, hasOwnerCredentials, isAccountConfigured, resolveAccount } from "./accounts.js";
import * as actions from "./actions.js";
import { extractChatId } from "./targets.js";

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
  | "update-note"
  | "delete-note"
  | "publish-note";

export interface ActionConfig {
  messages?: boolean;
  channelInfo?: boolean;
  tasks?: boolean;
  events?: boolean;
  notes?: boolean;
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
    all.push("list-notes", "create-note", "update-note", "delete-note", "publish-note");
  }
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
      return actions.actionCreateNote(client, chatId, title, body);
    }
    case "update-note": {
      const noteId = String(params.noteId ?? params.id ?? "");
      const title = String(params.title ?? "");
      return actions.actionUpdateNote(client, noteId, title);
    }
    case "delete-note": {
      const noteId = String(params.noteId ?? params.id ?? "");
      return actions.actionDeleteNote(client, noteId);
    }
    case "publish-note": {
      const noteId = String(params.noteId ?? params.id ?? "");
      return actions.actionPublishNote(client, noteId);
    }
    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}
