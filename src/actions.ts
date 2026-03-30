// High-level action functions for RingCentral CRUD operations.
// Used by actions-adapter.ts to handle OpenClaw agent tool calls.

import type { RingCentralClient } from "./client.js";

export async function actionSendMessage(
  client: RingCentralClient,
  chatId: string,
  text: string,
): Promise<{ success: boolean; postId?: string; error?: string }> {
  try {
    const post = await client.sendPost(chatId, text);
    return { success: true, postId: post.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function actionReadMessages(
  client: RingCentralClient,
  chatId: string,
  count = 20,
): Promise<{ success: boolean; messages?: Array<{ id: string; text: string; creatorId: string; time: string }>; error?: string }> {
  try {
    const result = await client.listPosts(chatId, count);
    return {
      success: true,
      messages: result.records.map((p) => ({
        id: p.id,
        text: p.text,
        creatorId: p.creatorId,
        time: p.creationTime,
      })),
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function actionEditMessage(
  client: RingCentralClient,
  chatId: string,
  postId: string,
  text: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await client.updatePost(chatId, postId, text);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function actionDeleteMessage(
  client: RingCentralClient,
  chatId: string,
  postId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await client.deletePost(chatId, postId);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function actionGetChannelInfo(
  client: RingCentralClient,
  chatId: string,
): Promise<{ success: boolean; chat?: { id: string; name?: string; type: string }; error?: string }> {
  try {
    const chat = await client.getChat(chatId);
    return { success: true, chat: { id: chat.id, name: chat.name, type: chat.type } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function actionListTasks(
  client: RingCentralClient,
  chatId: string,
): Promise<{ success: boolean; tasks?: Array<{ id: string; subject: string; status?: string }>; error?: string }> {
  try {
    const result = await client.listTasks(chatId);
    return {
      success: true,
      tasks: result.records.map((t) => ({ id: t.id, subject: t.subject, status: t.status })),
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function actionCreateTask(
  client: RingCentralClient,
  chatId: string,
  subject: string,
  assigneeId?: string,
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  try {
    const req = { subject, assignees: assigneeId ? [{ id: assigneeId }] : undefined };
    const task = await client.createTask(chatId, req);
    return { success: true, taskId: task.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function actionCompleteTask(
  client: RingCentralClient,
  taskId: string,
  assigneeId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await client.completeTask(taskId, assigneeId);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function actionUpdateTask(
  client: RingCentralClient,
  taskId: string,
  subject: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await client.updateTask(taskId, { subject });
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function actionDeleteTask(
  client: RingCentralClient,
  taskId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await client.deleteTask(taskId);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function actionListEvents(
  client: RingCentralClient,
): Promise<{ success: boolean; events?: Array<{ id: string; title: string; startTime: string; endTime: string }>; error?: string }> {
  try {
    const result = await client.listEvents();
    return {
      success: true,
      events: result.records.map((e) => ({
        id: e.id,
        title: e.title,
        startTime: e.startTime,
        endTime: e.endTime,
      })),
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function actionCreateEvent(
  client: RingCentralClient,
  title: string,
  startTime: string,
  endTime: string,
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const event = await client.createEvent({ title, startTime, endTime });
    return { success: true, eventId: event.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function actionUpdateEvent(
  client: RingCentralClient,
  eventId: string,
  updates: { title?: string; startTime?: string; endTime?: string },
): Promise<{ success: boolean; error?: string }> {
  try {
    await client.updateEvent(eventId, updates);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function actionDeleteEvent(
  client: RingCentralClient,
  eventId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await client.deleteEvent(eventId);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function actionListNotes(
  client: RingCentralClient,
  chatId: string,
): Promise<{ success: boolean; notes?: Array<{ id: string; title: string; status?: string }>; error?: string }> {
  try {
    const result = await client.listNotes(chatId);
    return {
      success: true,
      notes: result.records.map((n) => ({ id: n.id, title: n.title, status: n.status })),
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function actionCreateNote(
  client: RingCentralClient,
  chatId: string,
  title: string,
  body?: string,
): Promise<{ success: boolean; noteId?: string; error?: string }> {
  try {
    const note = await client.createNote(chatId, { title, body });
    await client.publishNote(note.id);
    return { success: true, noteId: note.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function actionUpdateNote(
  client: RingCentralClient,
  noteId: string,
  title: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await client.updateNote(noteId, { title });
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function actionDeleteNote(
  client: RingCentralClient,
  noteId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await client.deleteNote(noteId);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function actionPublishNote(
  client: RingCentralClient,
  noteId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await client.publishNote(noteId);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
