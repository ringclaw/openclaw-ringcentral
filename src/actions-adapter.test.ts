import { describe, it, expect, vi } from "vitest";
import {
  __testing,
  getEnabledActions,
  handleAction,
  ringCentralMessageActions,
  type ActionName,
} from "./actions-adapter.js";
import * as actions from "./actions.js";

vi.mock("./actions.js", () => ({
  actionSendMessage: vi.fn().mockResolvedValue({ success: true, postId: "p1" }),
  actionReadMessages: vi.fn().mockResolvedValue({ success: true, messages: [] }),
  actionEditMessage: vi.fn().mockResolvedValue({ success: true }),
  actionDeleteMessage: vi.fn().mockResolvedValue({ success: true }),
  actionGetChannelInfo: vi.fn().mockResolvedValue({ success: true, chat: { id: "c1" } }),
  actionListTasks: vi.fn().mockResolvedValue({ success: true, tasks: [] }),
  actionCreateTask: vi.fn().mockResolvedValue({ success: true, taskId: "t1" }),
  actionUpdateTask: vi.fn().mockResolvedValue({ success: true }),
  actionCompleteTask: vi.fn().mockResolvedValue({ success: true }),
  actionDeleteTask: vi.fn().mockResolvedValue({ success: true }),
  actionListEvents: vi.fn().mockResolvedValue({ success: true, events: [] }),
  actionCreateEvent: vi.fn().mockResolvedValue({ success: true, eventId: "e1" }),
  actionGetEvent: vi.fn().mockResolvedValue({ success: true, event: { id: "e1" } }),
  actionUpdateEvent: vi.fn().mockResolvedValue({ success: true }),
  actionDeleteEvent: vi.fn().mockResolvedValue({ success: true }),
  actionListNotes: vi.fn().mockResolvedValue({ success: true, notes: [] }),
  actionCreateNote: vi.fn().mockResolvedValue({ success: true, noteId: "n1" }),
  actionGetNote: vi.fn().mockResolvedValue({ success: true, note: { id: "n1", title: "Note" } }),
  actionUpdateNote: vi.fn().mockResolvedValue({ success: true }),
  actionDeleteNote: vi.fn().mockResolvedValue({ success: true }),
  actionPublishNote: vi.fn().mockResolvedValue({ success: true }),
  actionCreateAdaptiveCard: vi.fn().mockResolvedValue({ success: true, cardId: "ac1" }),
  actionGetAdaptiveCard: vi.fn().mockResolvedValue({ success: true, card: { id: "ac1", type: "AdaptiveCard" } }),
  actionUpdateAdaptiveCard: vi.fn().mockResolvedValue({ success: true }),
  actionDeleteAdaptiveCard: vi.fn().mockResolvedValue({ success: true }),
}));

const mockClient = {} as any;

beforeEach(() => {
  __testing.pendingActions.clear();
  vi.clearAllMocks();
});

describe("getEnabledActions", () => {
  it("returns all actions by default", () => {
    const all = getEnabledActions();
    expect(all).toContain("send-message");
    expect(all).toContain("channel-info");
    expect(all).toContain("create-task");
    expect(all).toContain("create-event");
    expect(all).toContain("get-event");
    expect(all).toContain("create-note");
    expect(all).toContain("get-note");
    expect(all).toContain("create-adaptive-card");
    expect(all).toContain("confirm-action");
    expect(all.length).toBe(26);
  });

  it("excludes messages when disabled", () => {
    const result = getEnabledActions({ messages: false });
    expect(result).not.toContain("send-message");
    expect(result).not.toContain("read-messages");
    expect(result).not.toContain("edit-message");
    expect(result).not.toContain("delete-message");
    expect(result).toContain("channel-info");
  });

  it("excludes tasks when disabled", () => {
    const result = getEnabledActions({ tasks: false });
    expect(result).not.toContain("create-task");
    expect(result).not.toContain("list-tasks");
    expect(result).toContain("send-message");
  });

  it("excludes events when disabled", () => {
    const result = getEnabledActions({ events: false });
    expect(result).not.toContain("create-event");
  });

  it("excludes notes when disabled", () => {
    const result = getEnabledActions({ notes: false });
    expect(result).not.toContain("create-note");
    expect(result).not.toContain("get-note");
    expect(result).not.toContain("publish-note");
  });

  it("excludes adaptive cards when disabled", () => {
    const result = getEnabledActions({ adaptiveCards: false });
    expect(result).not.toContain("create-adaptive-card");
    expect(result).not.toContain("delete-adaptive-card");
  });

  it("excludes channelInfo when disabled", () => {
    const result = getEnabledActions({ channelInfo: false });
    expect(result).not.toContain("channel-info");
  });
});

describe("handleAction", () => {
  it("routes send-message", async () => {
    await handleAction(mockClient, "send-message", { chatId: "c1", text: "hi" });
    expect(actions.actionSendMessage).toHaveBeenCalledWith(mockClient, "c1", "hi");
  });

  it("routes read-messages with count", async () => {
    await handleAction(mockClient, "read-messages", { chatId: "c1", count: 10 });
    expect(actions.actionReadMessages).toHaveBeenCalledWith(mockClient, "c1", 10);
  });

  it("routes edit-message (requires confirmation)", async () => {
    const result = await handleAction(mockClient, "edit-message", { chatId: "c1", postId: "p1", text: "updated" }) as any;
    expect(result.requiresConfirmation).toBe(true);
    // Confirm and verify execution
    await handleAction(mockClient, "confirm-action", { nonce: result.confirmationId });
    expect(actions.actionEditMessage).toHaveBeenCalledWith(mockClient, "c1", "p1", "updated");
  });

  it("routes delete-message (requires confirmation)", async () => {
    const result = await handleAction(mockClient, "delete-message", { chatId: "c1", postId: "p1" }) as any;
    expect(result.requiresConfirmation).toBe(true);
    await handleAction(mockClient, "confirm-action", { nonce: result.confirmationId });
    expect(actions.actionDeleteMessage).toHaveBeenCalledWith(mockClient, "c1", "p1");
  });

  it("routes channel-info", async () => {
    await handleAction(mockClient, "channel-info", { chatId: "c1" });
    expect(actions.actionGetChannelInfo).toHaveBeenCalledWith(mockClient, "c1");
  });

  it("routes create-task with assignee", async () => {
    await handleAction(mockClient, "create-task", { chatId: "c1", subject: "Do it", assigneeId: "u1" });
    expect(actions.actionCreateTask).toHaveBeenCalledWith(mockClient, "c1", "Do it", "u1");
  });

  it("routes create-event", async () => {
    await handleAction(mockClient, "create-event", { chatId: "c1", title: "Meet", startTime: "2026-01-01T10:00:00Z", endTime: "2026-01-01T11:00:00Z" });
    expect(actions.actionCreateEvent).toHaveBeenCalledWith(mockClient, "c1", "Meet", "2026-01-01T10:00:00Z", "2026-01-01T11:00:00Z", undefined);
  });

  it("routes get-event", async () => {
    await handleAction(mockClient, "get-event", { eventId: "e1" });
    expect(actions.actionGetEvent).toHaveBeenCalledWith(mockClient, "e1");
  });

  it("routes create-note with body", async () => {
    await handleAction(mockClient, "create-note", { chatId: "c1", title: "Note", body: "content" });
    expect(actions.actionCreateNote).toHaveBeenCalledWith(mockClient, "c1", "Note", "content", false);
  });

  it("routes create-note with explicit publish", async () => {
    await handleAction(mockClient, "create-note", { chatId: "c1", title: "Note", publish: true });
    expect(actions.actionCreateNote).toHaveBeenCalledWith(mockClient, "c1", "Note", undefined, true);
  });

  it("routes get-note", async () => {
    await handleAction(mockClient, "get-note", { noteId: "n1" });
    expect(actions.actionGetNote).toHaveBeenCalledWith(mockClient, "n1");
  });

  it("routes publish-note", async () => {
    await handleAction(mockClient, "publish-note", { noteId: "n1" });
    expect(actions.actionPublishNote).toHaveBeenCalledWith(mockClient, "n1");
  });

  it("routes create-adaptive-card with full card payload", async () => {
    const card = { type: "AdaptiveCard", version: "1.3", body: [] };
    await handleAction(mockClient, "create-adaptive-card", { chatId: "c1", card });
    expect(actions.actionCreateAdaptiveCard).toHaveBeenCalledWith(mockClient, "c1", card);
  });

  it("routes create-adaptive-card from text", async () => {
    await handleAction(mockClient, "create-adaptive-card", { chatId: "c1", text: "hello card" });
    expect(actions.actionCreateAdaptiveCard).toHaveBeenCalledWith(
      mockClient,
      "c1",
      expect.objectContaining({
        type: "AdaptiveCard",
        body: [expect.objectContaining({ text: "hello card" })],
      }),
    );
  });

  it("routes get-adaptive-card", async () => {
    await handleAction(mockClient, "get-adaptive-card", { cardId: "ac1" });
    expect(actions.actionGetAdaptiveCard).toHaveBeenCalledWith(mockClient, "ac1");
  });

  it("supports param aliases (chat_id, post_id, messageId)", async () => {
    await handleAction(mockClient, "send-message", { chat_id: "c2", message: "yo" });
    expect(actions.actionSendMessage).toHaveBeenCalledWith(mockClient, "c2", "yo");

    const result = await handleAction(mockClient, "delete-message", { chat_id: "c2", messageId: "m1" }) as any;
    expect(result.requiresConfirmation).toBe(true);
    await handleAction(mockClient, "confirm-action", { nonce: result.confirmationId });
    expect(actions.actionDeleteMessage).toHaveBeenCalledWith(mockClient, "c2", "m1");
  });

  it("supports title alias for subject in create-task", async () => {
    await handleAction(mockClient, "create-task", { chatId: "c1", title: "Task via title" });
    expect(actions.actionCreateTask).toHaveBeenCalledWith(mockClient, "c1", "Task via title", undefined);
  });

  it("supports id alias for taskId/eventId/noteId (via confirmation)", async () => {
    let result: any;

    result = await handleAction(mockClient, "delete-task", { id: "t99" });
    expect(result.requiresConfirmation).toBe(true);
    await handleAction(mockClient, "confirm-action", { nonce: result.confirmationId });
    expect(actions.actionDeleteTask).toHaveBeenCalledWith(mockClient, "t99");

    result = await handleAction(mockClient, "delete-event", { id: "e99" });
    await handleAction(mockClient, "confirm-action", { nonce: result.confirmationId });
    expect(actions.actionDeleteEvent).toHaveBeenCalledWith(mockClient, "e99");

    result = await handleAction(mockClient, "delete-note", { id: "n99" });
    await handleAction(mockClient, "confirm-action", { nonce: result.confirmationId });
    expect(actions.actionDeleteNote).toHaveBeenCalledWith(mockClient, "n99");

    result = await handleAction(mockClient, "delete-adaptive-card", { id: "ac99" });
    await handleAction(mockClient, "confirm-action", { nonce: result.confirmationId });
    expect(actions.actionDeleteAdaptiveCard).toHaveBeenCalledWith(mockClient, "ac99");
  });

  it("returns error for unknown action", async () => {
    const result = await handleAction(mockClient, "unknown-action" as ActionName, {});
    expect(result).toEqual({ success: false, error: "Unknown action: unknown-action" });
  });

  describe("chat scope validation", () => {
    it("blocks chat-scoped action when chatId differs from sessionChatId", async () => {
      const result = await handleAction(
        mockClient,
        "send-message",
        { chatId: "evil-chat", text: "hi" },
        "session-chat",
      );
      expect(result).toEqual({
        success: false,
        error: expect.stringContaining("Action scope violation"),
      });
      expect(actions.actionSendMessage).not.toHaveBeenCalled();
    });

    it("allows chat-scoped action when chatId matches sessionChatId", async () => {
      await handleAction(
        mockClient,
        "send-message",
        { chatId: "session-chat", text: "hi" },
        "session-chat",
      );
      expect(actions.actionSendMessage).toHaveBeenCalledWith(mockClient, "session-chat", "hi");
    });

    it("allows action when no sessionChatId is provided", async () => {
      await handleAction(mockClient, "send-message", { chatId: "any-chat", text: "hi" });
      expect(actions.actionSendMessage).toHaveBeenCalledWith(mockClient, "any-chat", "hi");
    });

    it("blocks scoped note actions when chatId differs from sessionChatId", async () => {
      const result = await handleAction(
        mockClient,
        "publish-note",
        { chatId: "evil-chat", noteId: "n1" },
        "session-chat",
      );
      expect(result).toEqual({
        success: false,
        error: expect.stringContaining("Action scope violation"),
      });
      expect(actions.actionPublishNote).not.toHaveBeenCalled();
    });

    it("allows non-chat-scoped actions with different chatId", async () => {
      const result = await handleAction(
        mockClient,
        "delete-task",
        { id: "t1" },
        "session-chat",
      ) as any;
      // delete-task is a protected action, so it returns confirmation instead
      expect(result.requiresConfirmation).toBe(true);
    });
  });

  describe("confirmation flow", () => {
    it("returns confirmation for protected actions", async () => {
      const result = await handleAction(mockClient, "delete-note", { noteId: "n1" }) as any;
      expect(result.requiresConfirmation).toBe(true);
      expect(result.confirmationId).toBeTruthy();
      expect(result.summary).toContain("delete-note");
      expect(result.summary).toContain("n1");
      expect(actions.actionDeleteNote).not.toHaveBeenCalled();
    });

    it("executes action after confirmation", async () => {
      const result = await handleAction(mockClient, "delete-note", { noteId: "n1" }) as any;
      const nonce = result.confirmationId;

      await handleAction(mockClient, "confirm-action", { nonce });
      expect(actions.actionDeleteNote).toHaveBeenCalledWith(mockClient, "n1");
    });

    it("rejects invalid confirmation nonce", async () => {
      const result = await handleAction(mockClient, "confirm-action", { nonce: "bad-nonce" }) as any;
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid or expired");
    });

    it("rejects reuse of confirmation nonce", async () => {
      const result = await handleAction(mockClient, "delete-task", { id: "t1" }) as any;
      const nonce = result.confirmationId;

      await handleAction(mockClient, "confirm-action", { nonce });
      const reuse = await handleAction(mockClient, "confirm-action", { nonce }) as any;
      expect(reuse.success).toBe(false);
      expect(reuse.error).toContain("Invalid or expired");
    });

    it("does not require confirmation for non-protected actions", async () => {
      await handleAction(mockClient, "send-message", { chatId: "c1", text: "hi" });
      expect(actions.actionSendMessage).toHaveBeenCalledWith(mockClient, "c1", "hi");
    });

    it("does not require confirmation for read actions", async () => {
      await handleAction(mockClient, "list-tasks", { chatId: "c1" });
      expect(actions.actionListTasks).toHaveBeenCalledWith(mockClient, "c1");
    });

    it("requires confirmation for edit-message", async () => {
      const result = await handleAction(mockClient, "edit-message", { chatId: "c1", postId: "p1", text: "new" }) as any;
      expect(result.requiresConfirmation).toBe(true);
    });

    it("requires confirmation for update-event", async () => {
      const result = await handleAction(mockClient, "update-event", { eventId: "e1", title: "new" }) as any;
      expect(result.requiresConfirmation).toBe(true);
    });

    it("requires confirmation for update-note and preserves body updates", async () => {
      const result = await handleAction(mockClient, "update-note", { noteId: "n1", title: "new", body: "body" }) as any;
      expect(result.requiresConfirmation).toBe(true);
      await handleAction(mockClient, "confirm-action", { nonce: result.confirmationId });
      expect(actions.actionUpdateNote).toHaveBeenCalledWith(mockClient, "n1", {
        title: "new",
        body: "body",
      });
    });

    it("requires confirmation for update-adaptive-card", async () => {
      const result = await handleAction(mockClient, "update-adaptive-card", { cardId: "ac1", text: "new" }) as any;
      expect(result.requiresConfirmation).toBe(true);
    });
  });
});

describe("ringCentralMessageActions", () => {
  const cfg = { channels: { ringcentral: { botToken: "bot" } } } as any;

  it("describes shared OpenClaw message actions", () => {
    const discovery = ringCentralMessageActions.describeMessageTool({ cfg });
    expect(discovery?.actions).toEqual(["send", "read", "edit", "delete", "channel-info"]);
    expect(discovery?.capabilities).toContain("delivery-pin");
  });

  it("returns no actions when unconfigured", () => {
    expect(ringCentralMessageActions.describeMessageTool({ cfg: { channels: { ringcentral: {} } } as any })?.actions).toEqual([]);
  });

  it("extracts send target for shared send action", () => {
    expect(ringCentralMessageActions.extractToolSend?.({ args: { action: "send", to: "ringcentral:group:g1" } })).toEqual({
      to: "ringcentral:group:g1",
    });
  });

  it("routes shared read action", async () => {
    await ringCentralMessageActions.handleAction?.({
      action: "read",
      params: { to: "ringcentral:group:c1", count: 5 },
      cfg,
    } as any);
    expect(actions.actionReadMessages).toHaveBeenCalledWith(expect.anything(), "c1", 5);
  });
});
