import type { OpenClawConfig } from "openclaw/plugin-sdk";

import { listRingCentralAccountIds, resolveRingCentralAccount } from "./accounts.js";
import {
  readRingCentralMessages,
  sendRingCentralMessageAction,
  editRingCentralMessage,
  deleteRingCentralMessageAction,
  getRingCentralChatInfo,
  listRingCentralTasksAction,
  createRingCentralTaskAction,
  completeRingCentralTaskAction,
  updateRingCentralTaskAction,
  listRingCentralEventsAction,
  createRingCentralEventAction,
  updateRingCentralEventAction,
  deleteRingCentralEventAction,
  listRingCentralNotesAction,
  createRingCentralNoteAction,
  updateRingCentralNoteAction,
  publishRingCentralNoteAction,
  searchRingCentralChatAction,
  findRingCentralDirectChatAction,
  refreshRingCentralChatCacheAction,
} from "./actions.js";
import { normalizeRingCentralTarget } from "./targets.js";
import type { RingCentralActionsConfig } from "./types.js";

// Action names supported by RingCentral
type RingCentralActionName =
  | "send"
  | "read"
  | "edit"
  | "delete"
  | "channel-info"
  | "list-tasks"
  | "create-task"
  | "complete-task"
  | "update-task"
  | "list-events"
  | "create-event"
  | "update-event"
  | "delete-event"
  | "list-notes"
  | "create-note"
  | "update-note"
  | "publish-note"
  | "search-chat"
  | "find-direct-chat"
  | "refresh-chat-cache";

type ChannelMessageActionContext = {
  channel: string;
  action: string;
  cfg: OpenClawConfig;
  params: Record<string, unknown>;
  accountId?: string | null;
};

type AgentToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function jsonResult<T>(data: T): AgentToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(message: string): AgentToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

function readStringParam(
  params: Record<string, unknown>,
  key: string,
  opts?: { required?: boolean },
): string | undefined {
  const value = params[key];
  if (value === undefined || value === null) {
    if (opts?.required) {
      throw new Error(`Missing required parameter: ${key}`);
    }
    return undefined;
  }
  return String(value).trim();
}

function readNumberParam(
  params: Record<string, unknown>,
  key: string,
  opts?: { integer?: boolean },
): number | undefined {
  const value = params[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return undefined;
  }
  return opts?.integer ? Math.floor(num) : num;
}

function resolveChannelId(params: Record<string, unknown>): string {
  const chatId = readStringParam(params, "chatId") ?? readStringParam(params, "channelId") ?? readStringParam(params, "target");
  if (!chatId) {
    throw new Error("chatId, channelId, or target is required");
  }
  const normalized = normalizeRingCentralTarget(chatId);
  if (!normalized) {
    throw new Error(`Invalid RingCentral chat ID: ${chatId}`);
  }
  return normalized;
}

export type RingCentralMessageActionAdapter = {
  listActions: (params: { cfg: OpenClawConfig }) => RingCentralActionName[];
  supportsAction: (params: { action: string }) => boolean;
  handleAction: (ctx: ChannelMessageActionContext) => Promise<AgentToolResult>;
};

export const ringcentralMessageActions: RingCentralMessageActionAdapter = {
  listActions: ({ cfg }) => {
    const accountIds = listRingCentralAccountIds(cfg);
    if (accountIds.length === 0) return [];

    const accounts = accountIds.map((accountId) =>
      resolveRingCentralAccount({ cfg, accountId }),
    );
    const configuredAccounts = accounts.filter(
      (account) => account.credentialSource !== "none",
    );
    if (configuredAccounts.length === 0) return [];

    const actions = new Set<RingCentralActionName>(["send", "search-chat", "find-direct-chat", "refresh-chat-cache"]);

    // Check if any account has messages actions enabled
    const isActionEnabled = (key: keyof RingCentralActionsConfig, defaultValue = true) => {
      for (const account of configuredAccounts) {
        const actionsConfig = account.config.actions;
        if (!actionsConfig) return defaultValue;
        const value = actionsConfig[key];
        if (typeof value === "boolean" ? value : defaultValue) return true;
      }
      return false;
    };

    if (isActionEnabled("messages")) {
      actions.add("read");
      actions.add("edit");
      actions.add("delete");
    }

    if (isActionEnabled("channelInfo")) {
      actions.add("channel-info");
    }

    if (isActionEnabled("tasks")) {
      actions.add("list-tasks");
      actions.add("create-task");
      actions.add("complete-task");
      actions.add("update-task");
    }

    if (isActionEnabled("events")) {
      actions.add("list-events");
      actions.add("create-event");
      actions.add("update-event");
      actions.add("delete-event");
    }

    if (isActionEnabled("notes")) {
      actions.add("list-notes");
      actions.add("create-note");
      actions.add("update-note");
      actions.add("publish-note");
    }

    return Array.from(actions);
  },

  supportsAction: ({ action }) => {
    const supportedActions = new Set<string>([
      "send",
      "read",
      "edit",
      "delete",
      "channel-info",
      "list-tasks",
      "create-task",
      "complete-task",
      "update-task",
      "list-events",
      "create-event",
      "update-event",
      "delete-event",
      "list-notes",
      "create-note",
      "update-note",
      "publish-note",
      "search-chat",
      "find-direct-chat",
      "refresh-chat-cache",
    ]);
    return supportedActions.has(action);
  },

  handleAction: async (ctx) => {
    const { action, cfg, params, accountId } = ctx;

    try {
      if (action === "send") {
        const chatId = resolveChannelId(params);
        const message = readStringParam(params, "message", { required: true });
        if (!message) {
          return errorResult("message is required");
        }

        const result = await sendRingCentralMessageAction(chatId, message, {
          cfg,
          accountId: accountId ?? undefined,
        });

        return jsonResult({
          status: "ok",
          messageId: result.messageId,
          chatId,
        });
      }

      if (action === "read") {
        const chatId = resolveChannelId(params);
        const limit = readNumberParam(params, "limit", { integer: true });
        const pageToken = readStringParam(params, "pageToken") ?? readStringParam(params, "before");

        const result = await readRingCentralMessages(chatId, {
          cfg,
          accountId: accountId ?? undefined,
          limit,
          pageToken,
        });

        return jsonResult({
          status: "ok",
          chatId,
          messages: result.messages,
          hasMore: result.hasMore,
          nextPageToken: result.nextPageToken,
        });
      }

      if (action === "edit") {
        const chatId = resolveChannelId(params);
        const messageId = readStringParam(params, "messageId", { required: true });
        const message = readStringParam(params, "message", { required: true });
        if (!messageId || !message) {
          return errorResult("messageId and message are required");
        }

        const result = await editRingCentralMessage(chatId, messageId, message, {
          cfg,
          accountId: accountId ?? undefined,
        });

        return jsonResult({
          status: "ok",
          messageId: result.messageId,
          chatId,
        });
      }

      if (action === "delete") {
        const chatId = resolveChannelId(params);
        const messageId = readStringParam(params, "messageId", { required: true });
        if (!messageId) {
          return errorResult("messageId is required");
        }

        await deleteRingCentralMessageAction(chatId, messageId, {
          cfg,
          accountId: accountId ?? undefined,
        });

        return jsonResult({
          status: "ok",
          deleted: true,
          chatId,
          messageId,
        });
      }

      if (action === "channel-info") {
        const chatId = resolveChannelId(params);

        const info = await getRingCentralChatInfo(chatId, {
          cfg,
          accountId: accountId ?? undefined,
        });

        if (!info) {
          return errorResult(`Chat not found: ${chatId}`);
        }

        return jsonResult({
          status: "ok",
          ...info,
        });
      }

      // Task Actions
      if (action === "list-tasks") {
        const chatId = resolveChannelId(params);
        const limit = readNumberParam(params, "limit", { integer: true });
        const status = readStringParam(params, "status") as "Pending" | "InProgress" | "Completed" | undefined;

        const result = await listRingCentralTasksAction(chatId, {
          cfg,
          accountId: accountId ?? undefined,
          limit,
          status,
        });

        return jsonResult({
          status: "ok",
          chatId,
          tasks: result.tasks,
          hasMore: result.hasMore,
        });
      }

      if (action === "create-task") {
        const chatId = resolveChannelId(params);
        const subject = readStringParam(params, "subject", { required: true });
        if (!subject) {
          return errorResult("subject is required");
        }
        const description = readStringParam(params, "description");
        const dueDate = readStringParam(params, "dueDate");
        const assigneesRaw = params.assignees;
        const assignees = Array.isArray(assigneesRaw)
          ? assigneesRaw.map((a) => String(a))
          : undefined;

        const result = await createRingCentralTaskAction(chatId, subject, {
          cfg,
          accountId: accountId ?? undefined,
          description,
          dueDate,
          assignees,
        });

        return jsonResult({
          status: "ok",
          taskId: result.taskId,
          chatId,
        });
      }

      if (action === "complete-task") {
        const chatId = resolveChannelId(params);
        const taskId = readStringParam(params, "taskId", { required: true });
        if (!taskId) {
          return errorResult("taskId is required");
        }
        const complete = params.complete !== false;

        await completeRingCentralTaskAction(chatId, taskId, {
          cfg,
          accountId: accountId ?? undefined,
          complete,
        });

        return jsonResult({
          status: "ok",
          taskId,
          chatId,
          completed: complete,
        });
      }

      if (action === "update-task") {
        const chatId = resolveChannelId(params);
        const taskId = readStringParam(params, "taskId", { required: true });
        if (!taskId) {
          return errorResult("taskId is required");
        }
        const subject = readStringParam(params, "subject");
        const description = readStringParam(params, "description");
        const dueDate = readStringParam(params, "dueDate");
        const assigneesRaw = params.assignees;
        const assignees = Array.isArray(assigneesRaw)
          ? assigneesRaw.map((a) => String(a))
          : undefined;

        const result = await updateRingCentralTaskAction(chatId, taskId, {
          cfg,
          accountId: accountId ?? undefined,
          subject,
          description,
          dueDate,
          assignees,
        });

        return jsonResult({
          status: "ok",
          taskId: result.taskId,
          chatId,
        });
      }

      // Event Actions
      if (action === "list-events") {
        const chatId = resolveChannelId(params);
        const limit = readNumberParam(params, "limit", { integer: true });

        const result = await listRingCentralEventsAction(chatId, {
          cfg,
          accountId: accountId ?? undefined,
          limit,
        });

        return jsonResult({
          status: "ok",
          chatId,
          events: result.events,
          hasMore: result.hasMore,
        });
      }

      if (action === "create-event") {
        const chatId = resolveChannelId(params);
        const title = readStringParam(params, "title", { required: true });
        const startTime = readStringParam(params, "startTime", { required: true });
        const endTime = readStringParam(params, "endTime", { required: true });
        if (!title || !startTime || !endTime) {
          return errorResult("title, startTime, and endTime are required");
        }
        const allDay = params.allDay === true;
        const location = readStringParam(params, "location");
        const description = readStringParam(params, "description");
        const color = readStringParam(params, "color") as
          | "Black"
          | "Red"
          | "Orange"
          | "Yellow"
          | "Green"
          | "Blue"
          | "Purple"
          | "Magenta"
          | undefined;
        const recurrence = readStringParam(params, "recurrence") as
          | "None"
          | "Day"
          | "Weekday"
          | "Week"
          | "Month"
          | "Year"
          | undefined;

        const result = await createRingCentralEventAction(chatId, title, startTime, endTime, {
          cfg,
          accountId: accountId ?? undefined,
          allDay,
          location,
          description,
          color,
          recurrence,
        });

        return jsonResult({
          status: "ok",
          eventId: result.eventId,
          chatId,
        });
      }

      if (action === "update-event") {
        const chatId = resolveChannelId(params);
        const eventId = readStringParam(params, "eventId", { required: true });
        if (!eventId) {
          return errorResult("eventId is required");
        }
        const title = readStringParam(params, "title");
        const startTime = readStringParam(params, "startTime");
        const endTime = readStringParam(params, "endTime");
        const allDay = typeof params.allDay === "boolean" ? params.allDay : undefined;
        const location = readStringParam(params, "location");
        const description = readStringParam(params, "description");
        const color = readStringParam(params, "color") as
          | "Black"
          | "Red"
          | "Orange"
          | "Yellow"
          | "Green"
          | "Blue"
          | "Purple"
          | "Magenta"
          | undefined;

        const result = await updateRingCentralEventAction(chatId, eventId, {
          cfg,
          accountId: accountId ?? undefined,
          title,
          startTime,
          endTime,
          allDay,
          location,
          description,
          color,
        });

        return jsonResult({
          status: "ok",
          eventId: result.eventId,
          chatId,
        });
      }

      if (action === "delete-event") {
        const chatId = resolveChannelId(params);
        const eventId = readStringParam(params, "eventId", { required: true });
        if (!eventId) {
          return errorResult("eventId is required");
        }

        await deleteRingCentralEventAction(chatId, eventId, {
          cfg,
          accountId: accountId ?? undefined,
        });

        return jsonResult({
          status: "ok",
          deleted: true,
          chatId,
          eventId,
        });
      }

      // Note Actions
      if (action === "list-notes") {
        const chatId = resolveChannelId(params);
        const limit = readNumberParam(params, "limit", { integer: true });
        const status = readStringParam(params, "status") as "Active" | "Draft" | undefined;

        const result = await listRingCentralNotesAction(chatId, {
          cfg,
          accountId: accountId ?? undefined,
          limit,
          status,
        });

        return jsonResult({
          status: "ok",
          chatId,
          notes: result.notes,
          hasMore: result.hasMore,
        });
      }

      if (action === "create-note") {
        const chatId = resolveChannelId(params);
        const title = readStringParam(params, "title", { required: true });
        if (!title) {
          return errorResult("title is required");
        }
        const body = readStringParam(params, "body");
        const publish = params.publish !== false && params.publish !== "false";

        const result = await createRingCentralNoteAction(chatId, title, {
          cfg,
          accountId: accountId ?? undefined,
          body,
          publish,
        });

        return jsonResult({
          status: result.error ? "partial" : "ok",
          noteId: result.noteId,
          noteStatus: result.status,
          chatId,
          ...(result.error ? { error: result.error } : {}),
        });
      }

      if (action === "update-note") {
        const noteId = readStringParam(params, "noteId", { required: true });
        if (!noteId) {
          return errorResult("noteId is required");
        }
        const title = readStringParam(params, "title");
        const body = readStringParam(params, "body");

        const result = await updateRingCentralNoteAction(noteId, {
          cfg,
          accountId: accountId ?? undefined,
          title,
          body,
        });

        return jsonResult({
          status: "ok",
          noteId: result.noteId,
        });
      }

      if (action === "publish-note") {
        const noteId = readStringParam(params, "noteId", { required: true });
        if (!noteId) {
          return errorResult("noteId is required");
        }

        const result = await publishRingCentralNoteAction(noteId, {
          cfg,
          accountId: accountId ?? undefined,
        });

        return jsonResult({
          status: "ok",
          noteId: result.noteId,
          published: true,
        });
      }

      if (action === "search-chat") {
        const query = readStringParam(params, "query", { required: true });
        if (!query) {
          return errorResult("query is required");
        }

        const result = searchRingCentralChatAction(query);

        return jsonResult({
          status: "ok",
          ...result,
        });
      }

      if (action === "find-direct-chat") {
        const memberId = readStringParam(params, "memberId", { required: true });
        if (!memberId) {
          return errorResult("memberId is required");
        }

        const result = findRingCentralDirectChatAction(memberId);

        return jsonResult({
          status: result.chatId ? "ok" : "not_found",
          ...result,
        });
      }

      if (action === "refresh-chat-cache") {
        const result = await refreshRingCentralChatCacheAction();

        return jsonResult({
          status: "ok",
          refreshed: true,
          count: result.count,
        });
      }

      return errorResult(`Unsupported action: ${action}`);
    } catch (err) {
      return errorResult(String(err));
    }
  },
};
