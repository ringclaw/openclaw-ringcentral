import { describe, it, expect, vi } from "vitest";
import { getEnabledActions, handleAction, type ActionName } from "./actions-adapter.js";
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
  actionUpdateEvent: vi.fn().mockResolvedValue({ success: true }),
  actionDeleteEvent: vi.fn().mockResolvedValue({ success: true }),
  actionListNotes: vi.fn().mockResolvedValue({ success: true, notes: [] }),
  actionCreateNote: vi.fn().mockResolvedValue({ success: true, noteId: "n1" }),
  actionUpdateNote: vi.fn().mockResolvedValue({ success: true }),
  actionDeleteNote: vi.fn().mockResolvedValue({ success: true }),
  actionPublishNote: vi.fn().mockResolvedValue({ success: true }),
}));

const mockClient = {} as any;

describe("getEnabledActions", () => {
  it("returns all actions by default", () => {
    const all = getEnabledActions();
    expect(all).toContain("send-message");
    expect(all).toContain("channel-info");
    expect(all).toContain("create-task");
    expect(all).toContain("create-event");
    expect(all).toContain("create-note");
    expect(all.length).toBe(19);
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
    expect(result).not.toContain("publish-note");
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

  it("routes edit-message", async () => {
    await handleAction(mockClient, "edit-message", { chatId: "c1", postId: "p1", text: "updated" });
    expect(actions.actionEditMessage).toHaveBeenCalledWith(mockClient, "c1", "p1", "updated");
  });

  it("routes delete-message", async () => {
    await handleAction(mockClient, "delete-message", { chatId: "c1", postId: "p1" });
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
    await handleAction(mockClient, "create-event", { title: "Meet", startTime: "2026-01-01T10:00:00Z", endTime: "2026-01-01T11:00:00Z" });
    expect(actions.actionCreateEvent).toHaveBeenCalledWith(mockClient, "Meet", "2026-01-01T10:00:00Z", "2026-01-01T11:00:00Z");
  });

  it("routes create-note with body", async () => {
    await handleAction(mockClient, "create-note", { chatId: "c1", title: "Note", body: "content" });
    expect(actions.actionCreateNote).toHaveBeenCalledWith(mockClient, "c1", "Note", "content");
  });

  it("routes publish-note", async () => {
    await handleAction(mockClient, "publish-note", { noteId: "n1" });
    expect(actions.actionPublishNote).toHaveBeenCalledWith(mockClient, "n1");
  });

  it("supports param aliases (chat_id, post_id, messageId)", async () => {
    await handleAction(mockClient, "send-message", { chat_id: "c2", message: "yo" });
    expect(actions.actionSendMessage).toHaveBeenCalledWith(mockClient, "c2", "yo");

    await handleAction(mockClient, "delete-message", { chat_id: "c2", messageId: "m1" });
    expect(actions.actionDeleteMessage).toHaveBeenCalledWith(mockClient, "c2", "m1");
  });

  it("supports title alias for subject in create-task", async () => {
    await handleAction(mockClient, "create-task", { chatId: "c1", title: "Task via title" });
    expect(actions.actionCreateTask).toHaveBeenCalledWith(mockClient, "c1", "Task via title", undefined);
  });

  it("supports id alias for taskId/eventId/noteId", async () => {
    await handleAction(mockClient, "delete-task", { id: "t99" });
    expect(actions.actionDeleteTask).toHaveBeenCalledWith(mockClient, "t99");

    await handleAction(mockClient, "delete-event", { id: "e99" });
    expect(actions.actionDeleteEvent).toHaveBeenCalledWith(mockClient, "e99");

    await handleAction(mockClient, "delete-note", { id: "n99" });
    expect(actions.actionDeleteNote).toHaveBeenCalledWith(mockClient, "n99");
  });

  it("returns error for unknown action", async () => {
    const result = await handleAction(mockClient, "unknown-action" as ActionName, {});
    expect(result).toEqual({ success: false, error: "Unknown action: unknown-action" });
  });
});
