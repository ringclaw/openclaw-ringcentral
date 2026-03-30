// RingCentral REST API client — direct fetch, inspired by RingClaw client.go.
// Supports both Bot (static token) and Private App (JWT) modes.

import { getAccessToken } from "./auth.js";
import type {
  AdaptiveCard,
  Chat,
  CreateAdaptiveCardRequest,
  CreateEventRequest,
  CreateNoteRequest,
  CreateTaskRequest,
  Event,
  ExtensionInfo,
  Note,
  PaginatedRecords,
  PersonInfo,
  Post,
  Task,
} from "./types.js";

export interface ClientOptions {
  serverUrl: string;
  botToken?: string;
  credentials?: {
    clientId: string;
    clientSecret: string;
    jwt: string;
  };
}

export class RingCentralClient {
  private serverUrl: string;
  private botToken?: string;
  private credentials?: { clientId: string; clientSecret: string; jwt: string };

  constructor(opts: ClientOptions) {
    this.serverUrl = opts.serverUrl.replace(/\/$/, "");
    this.botToken = opts.botToken;
    this.credentials = opts.credentials;
  }

  private async getToken(): Promise<string> {
    if (this.botToken) return this.botToken;
    if (this.credentials) {
      return getAccessToken(
        this.serverUrl,
        this.credentials.clientId,
        this.credentials.clientSecret,
        this.credentials.jwt,
      );
    }
    throw new Error("No authentication configured");
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    contentType?: string,
  ): Promise<T> {
    const token = await this.getToken();
    const url = `${this.serverUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    let reqBody: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = contentType ?? "application/json";
      reqBody = typeof body === "string" ? body : JSON.stringify(body);
    }
    const resp = await fetch(url, { method, headers, body: reqBody });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${text}`);
    }
    if (resp.status === 204) return undefined as T;
    return (await resp.json()) as T;
  }

  // --- Extension ---

  async getExtensionInfo(): Promise<ExtensionInfo> {
    return this.request("GET", "/restapi/v1.0/account/~/extension/~");
  }

  // --- Posts ---

  async sendPost(chatId: string, text: string): Promise<Post> {
    return this.request("POST", `/team-messaging/v1/chats/${chatId}/posts`, { text });
  }

  async updatePost(chatId: string, postId: string, text: string): Promise<void> {
    await this.request("PATCH", `/team-messaging/v1/chats/${chatId}/posts/${postId}`, { text });
  }

  async deletePost(chatId: string, postId: string): Promise<void> {
    await this.request("DELETE", `/team-messaging/v1/chats/${chatId}/posts/${postId}`);
  }

  async listPosts(chatId: string, recordCount = 50): Promise<PaginatedRecords<Post>> {
    return this.request("GET", `/team-messaging/v1/chats/${chatId}/posts?recordCount=${recordCount}`);
  }

  // --- Files ---

  async uploadFile(
    chatId: string,
    fileName: string,
    fileData: Buffer | Uint8Array,
    contentType: string,
  ): Promise<Post> {
    const token = await this.getToken();
    const boundary = `----FormBoundary${Date.now()}`;
    const parts: Uint8Array[] = [];
    const enc = new TextEncoder();

    parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`));
    parts.push(fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData));
    parts.push(enc.encode(`\r\n--${boundary}--\r\n`));

    const bodyBuf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      bodyBuf.set(p, offset);
      offset += p.length;
    }

    const resp = await fetch(`${this.serverUrl}/team-messaging/v1/chats/${chatId}/posts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: bodyBuf,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Upload failed HTTP ${resp.status}: ${text}`);
    }
    return (await resp.json()) as Post;
  }

  // --- Chats ---

  async listChats(type?: string): Promise<PaginatedRecords<Chat>> {
    const params = new URLSearchParams({ recordCount: "250" });
    if (type) params.set("type", type);
    return this.request("GET", `/team-messaging/v1/chats?${params}`);
  }

  async getChat(chatId: string): Promise<Chat> {
    return this.request("GET", `/team-messaging/v1/chats/${chatId}`);
  }

  async createConversation(memberIds: string[]): Promise<Chat> {
    return this.request("POST", "/team-messaging/v1/conversations", { members: memberIds.map((id) => ({ id })) });
  }

  // --- People ---

  async getPersonInfo(personId: string): Promise<PersonInfo> {
    return this.request("GET", `/team-messaging/v1/persons/${personId}`);
  }

  // --- Tasks ---

  async listTasks(chatId: string): Promise<PaginatedRecords<Task>> {
    return this.request("GET", `/team-messaging/v1/chats/${chatId}/tasks?recordCount=50`);
  }

  async createTask(chatId: string, req: CreateTaskRequest): Promise<Task> {
    return this.request("POST", `/team-messaging/v1/chats/${chatId}/tasks`, req);
  }

  async getTask(taskId: string): Promise<Task> {
    return this.request("GET", `/team-messaging/v1/tasks/${taskId}`);
  }

  async updateTask(taskId: string, updates: Partial<CreateTaskRequest>): Promise<Task> {
    return this.request("PATCH", `/team-messaging/v1/tasks/${taskId}`, updates);
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.request("DELETE", `/team-messaging/v1/tasks/${taskId}`);
  }

  async completeTask(taskId: string, assigneeId: string): Promise<void> {
    await this.request("POST", `/team-messaging/v1/tasks/${taskId}/complete`, {
      assignees: [{ id: assigneeId, status: "Completed" }],
    });
  }

  // --- Events ---

  async listEvents(): Promise<PaginatedRecords<Event>> {
    return this.request("GET", "/team-messaging/v1/events?recordCount=50");
  }

  async createEvent(req: CreateEventRequest): Promise<Event> {
    return this.request("POST", "/team-messaging/v1/events", req);
  }

  async getEvent(eventId: string): Promise<Event> {
    return this.request("GET", `/team-messaging/v1/events/${eventId}`);
  }

  async updateEvent(eventId: string, updates: Partial<CreateEventRequest>): Promise<Event> {
    return this.request("PATCH", `/team-messaging/v1/events/${eventId}`, updates);
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.request("DELETE", `/team-messaging/v1/events/${eventId}`);
  }

  // --- Notes ---

  async listNotes(chatId: string): Promise<PaginatedRecords<Note>> {
    return this.request("GET", `/team-messaging/v1/chats/${chatId}/notes?recordCount=50`);
  }

  async createNote(chatId: string, req: CreateNoteRequest): Promise<Note> {
    return this.request("POST", `/team-messaging/v1/chats/${chatId}/notes`, req);
  }

  async getNote(noteId: string): Promise<Note> {
    return this.request("GET", `/team-messaging/v1/notes/${noteId}`);
  }

  async updateNote(noteId: string, updates: Partial<CreateNoteRequest>): Promise<Note> {
    return this.request("PATCH", `/team-messaging/v1/notes/${noteId}`, updates);
  }

  async deleteNote(noteId: string): Promise<void> {
    await this.request("DELETE", `/team-messaging/v1/notes/${noteId}`);
  }

  async publishNote(noteId: string): Promise<void> {
    await this.request("POST", `/team-messaging/v1/notes/${noteId}/publish`);
  }

  // --- Adaptive Cards ---

  async createAdaptiveCard(chatId: string, card: CreateAdaptiveCardRequest): Promise<AdaptiveCard> {
    return this.request("POST", `/team-messaging/v1/chats/${chatId}/adaptive-cards`, card);
  }

  async getAdaptiveCard(cardId: string): Promise<AdaptiveCard> {
    return this.request("GET", `/team-messaging/v1/adaptive-cards/${cardId}`);
  }

  async updateAdaptiveCard(cardId: string, card: CreateAdaptiveCardRequest): Promise<AdaptiveCard> {
    return this.request("PUT", `/team-messaging/v1/adaptive-cards/${cardId}`, card);
  }

  async deleteAdaptiveCard(cardId: string): Promise<void> {
    await this.request("DELETE", `/team-messaging/v1/adaptive-cards/${cardId}`);
  }
}

export function createBotClient(serverUrl: string, botToken: string): RingCentralClient {
  return new RingCentralClient({ serverUrl, botToken });
}

export function createPrivateClient(
  serverUrl: string,
  clientId: string,
  clientSecret: string,
  jwt: string,
): RingCentralClient {
  return new RingCentralClient({
    serverUrl,
    credentials: { clientId, clientSecret, jwt },
  });
}
