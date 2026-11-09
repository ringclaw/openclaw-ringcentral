// RingCentral REST API client. Supports bot static tokens and owner JWT credentials.

import { detectMime, mimeTypeFromFilePath, normalizeMimeType } from "openclaw/plugin-sdk/media-mime";
import { readResponseWithLimit } from "openclaw/plugin-sdk/media-runtime";
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
  ResolvedRingCentralOwnerCredentials,
  Task,
  TokenResponse,
  WSTokenResponse,
} from "./types.js";

export interface ClientOptions {
  serverUrl: string;
  botToken?: string;
  ownerCredentials?: ResolvedRingCentralOwnerCredentials;
  /** @deprecated Use ownerCredentials. */
  credentials?: ResolvedRingCentralOwnerCredentials;
  maxRetries?: number;
}

export interface SendPostOptions {
  parentPostId?: string | number | null;
  threadId?: string | number | null;
}

export interface DownloadAttachmentOptions {
  uri: string;
  fileName?: string;
  contentType?: string;
  maxBytes: number;
}

export interface DownloadedAttachment {
  buffer: Buffer;
  contentType: string;
  fileName: string;
  size: number;
}

type RequestBody = object | string | Uint8Array;

const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRY_AFTER_SECONDS = 30;

export class RingCentralApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    message = `RingCentral API HTTP ${status}: ${body}`,
  ) {
    super(message);
    this.name = "RingCentralApiError";
  }
}

export class RingCentralClient {
  private readonly serverUrl: string;
  private readonly botToken?: string;
  private readonly ownerCredentials?: ResolvedRingCentralOwnerCredentials;
  private readonly maxRetries: number;
  private accessToken?: string;
  private accessTokenExpiresAt = 0;
  private refreshPromise?: Promise<string>;
  private tokenGeneration = 0;

  lastStatus: number | null = null;

  constructor(opts: ClientOptions) {
    this.serverUrl = opts.serverUrl.replace(/\/$/, "");
    this.botToken = opts.botToken;
    this.ownerCredentials = opts.ownerCredentials ?? opts.credentials;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  private async getToken(): Promise<string> {
    if (this.botToken) {
      return this.botToken;
    }
    if (!this.ownerCredentials) {
      throw new Error("No RingCentral authentication configured");
    }
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000) {
      return this.accessToken;
    }
    this.refreshPromise ??= this.refreshJwtAccessToken();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  private async refreshJwtAccessToken(): Promise<string> {
    const credentials = this.ownerCredentials;
    if (!credentials) {
      throw new Error("Owner credentials not configured");
    }
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: credentials.jwt,
    });
    const resp = await fetch(`${this.serverUrl}/restapi/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`,
      },
      body: body.toString(),
    });
    this.lastStatus = resp.status;
    if (!resp.ok) {
      throw new RingCentralApiError(resp.status, await resp.text(), "RingCentral token request failed");
    }
    const data = (await resp.json()) as TokenResponse;
    this.accessToken = data.access_token;
    this.accessTokenExpiresAt = Date.now() + data.expires_in * 1000;
    this.tokenGeneration += 1;
    return this.accessToken;
  }

  private invalidateAccessToken(): void {
    this.accessToken = undefined;
    this.accessTokenExpiresAt = 0;
  }

  private async reauthAfter(staleGeneration: number): Promise<string> {
    if (this.tokenGeneration === staleGeneration) {
      this.invalidateAccessToken();
    }
    return this.getToken();
  }

  private async fetchWithRateLimit(execute: () => Promise<Response>): Promise<Response> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const resp = await execute();
      this.lastStatus = resp.status;
      if (resp.status === 429 && attempt < this.maxRetries) {
        await sleep(RingCentralClient.parseRetryAfter(resp.headers.get("Retry-After") ?? null));
        continue;
      }
      return resp;
    }
    throw new Error("RingCentral API retry budget exhausted");
  }

  // JWT access tokens can be revoked server-side before local expiry. One
  // reauth retry is enough; bot static tokens cannot be refreshed.
  private async authorizedFetch(execute: (token: string) => Promise<Response>): Promise<Response> {
    let token = await this.getToken();
    let generation = this.tokenGeneration;
    for (let authAttempt = 0; authAttempt < 2; authAttempt++) {
      const resp = await this.fetchWithRateLimit(() => execute(token));
      if (resp.status !== 401 || this.botToken || authAttempt === 1) {
        return resp;
      }
      const body = await resp.text();
      if (!isInvalidAccessTokenBody(body)) {
        throw new RingCentralApiError(401, body);
      }
      token = await this.reauthAfter(generation);
      generation = this.tokenGeneration;
    }
    throw new Error("RingCentral API authorization retry budget exhausted");
  }

  private static encodeId(value: string): string {
    return encodeURIComponent(value);
  }

  private static jsonIdValue(value: string | number): string | number {
    const raw = String(value).trim();
    return raw && /^[0-9]+$/.test(raw) ? Number(raw) : raw;
  }

  private static parseRetryAfter(raw: string | null): number {
    if (!raw) {
      return 1000;
    }
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) {
      return Math.min(Math.max(seconds, 0.5), MAX_RETRY_AFTER_SECONDS) * 1000;
    }
    return 1000;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: RequestBody,
    contentType?: string,
  ): Promise<T> {
    const url = `${this.serverUrl}${path}`;
    const extraHeaders: Record<string, string> = {};
    let reqBody: BodyInit | undefined;
    if (body !== undefined) {
      if (body instanceof Uint8Array) {
        extraHeaders["Content-Type"] = contentType ?? "application/octet-stream";
        reqBody = body as unknown as BodyInit;
      } else if (typeof body === "string") {
        extraHeaders["Content-Type"] = contentType ?? "text/plain";
        reqBody = body;
      } else {
        extraHeaders["Content-Type"] = contentType ?? "application/json";
        reqBody = JSON.stringify(body);
      }
    }

    const resp = await this.authorizedFetch((token) =>
      fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...extraHeaders },
        body: reqBody,
      }),
    );
    if (!resp.ok) {
      throw new RingCentralApiError(resp.status, await resp.text());
    }
    if (resp.status === 204) {
      return undefined as T;
    }
    const text = await resp.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async downloadAttachment(opts: DownloadAttachmentOptions): Promise<DownloadedAttachment> {
    const uri = opts.uri.trim();
    if (!/^https?:\/\//i.test(uri)) {
      throw new Error("RingCentral attachment URI must be HTTP(S)");
    }
    const resp = await this.authorizedFetch((token) =>
      fetch(uri, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    if (!resp.ok) {
      throw new RingCentralApiError(resp.status, await resp.text(), "RingCentral attachment download failed");
    }
    const buffer = await readResponseWithLimit(resp, opts.maxBytes, {
      chunkTimeoutMs: 30_000,
      onOverflow: ({ size, maxBytes }) =>
        new Error(`RingCentral attachment too large: ${size} bytes (limit: ${maxBytes} bytes)`),
    });
    const fileName = normalizeAttachmentFileName(opts.fileName);
    const contentType =
      normalizeMimeType(opts.contentType) ??
      normalizeMimeType(resp.headers.get("Content-Type")) ??
      (await detectMime({ buffer, filePath: fileName })) ??
      mimeTypeFromFilePath(fileName) ??
      "application/octet-stream";
    return {
      buffer,
      contentType,
      fileName,
      size: buffer.byteLength,
    };
  }

  async createWebSocketToken(): Promise<WSTokenResponse> {
    return this.request("POST", "/restapi/oauth/wstoken");
  }

  async getExtensionInfo(): Promise<ExtensionInfo> {
    return this.request("GET", "/restapi/v1.0/account/~/extension/~");
  }

  async sendPost(chatId: string, text: string, options: SendPostOptions = {}): Promise<Post> {
    const payload: Record<string, unknown> = { text };
    if (options.parentPostId) {
      payload.parentPostId = RingCentralClient.jsonIdValue(options.parentPostId);
    } else if (options.threadId) {
      payload.threadId = RingCentralClient.jsonIdValue(options.threadId);
    }
    return this.request("POST", `/team-messaging/v1/chats/${RingCentralClient.encodeId(chatId)}/posts`, payload);
  }

  async updatePost(chatId: string, postId: string, text: string): Promise<Post> {
    return this.request(
      "PATCH",
      `/team-messaging/v1/chats/${RingCentralClient.encodeId(chatId)}/posts/${RingCentralClient.encodeId(postId)}`,
      { text },
    );
  }

  async deletePost(chatId: string, postId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/team-messaging/v1/chats/${RingCentralClient.encodeId(chatId)}/posts/${RingCentralClient.encodeId(postId)}`,
    );
  }

  async listPosts(chatId: string, recordCount = 50): Promise<PaginatedRecords<Post>> {
    return this.request(
      "GET",
      `/team-messaging/v1/chats/${RingCentralClient.encodeId(chatId)}/posts?recordCount=${Math.trunc(recordCount)}`,
    );
  }

  async listLegacyGroupPosts(chatId: string, recordCount = 50): Promise<PaginatedRecords<Post>> {
    return this.request(
      "GET",
      `/restapi/v1.0/glip/groups/${RingCentralClient.encodeId(chatId)}/posts?recordCount=${Math.trunc(recordCount)}`,
    );
  }

  async listThreadPosts(threadId: string, recordCount = 50): Promise<PaginatedRecords<Post>> {
    const count = Math.trunc(recordCount);
    try {
      return await this.request(
        "GET",
        `/team-messaging/v1/threads/${RingCentralClient.encodeId(threadId)}/posts?recordCount=${count}`,
      );
    } catch {
      return this.request(
        "GET",
        `/restapi/v1.0/glip/threads/${RingCentralClient.encodeId(threadId)}/posts?recordCount=${count}`,
      );
    }
  }

  async uploadFile(
    chatId: string,
    fileName: string,
    fileData: Buffer | Uint8Array,
    contentType = "application/octet-stream",
  ): Promise<Post> {
    const path =
      `/team-messaging/v1/files?name=${RingCentralClient.encodeId(fileName || "file")}` +
      `&groupId=${RingCentralClient.encodeId(chatId)}`;
    return this.request("POST", path, fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData), contentType);
  }

  async listChats(type?: string, recordCount = 250): Promise<PaginatedRecords<Chat>> {
    const params = new URLSearchParams({ recordCount: String(recordCount) });
    if (type) {
      params.set("type", type);
    }
    return this.request("GET", `/team-messaging/v1/chats?${params}`);
  }

  async getChat(chatId: string): Promise<Chat> {
    return this.request("GET", `/team-messaging/v1/chats/${RingCentralClient.encodeId(chatId)}`);
  }

  async createConversation(memberIds: string[]): Promise<Chat> {
    return this.request("POST", "/team-messaging/v1/conversations", {
      members: memberIds.map((id) => ({ id })),
    });
  }

  async createOrFindDm(memberIds: string[]): Promise<Chat> {
    return this.createConversation(memberIds);
  }

  async getPersonInfo(personId: string): Promise<PersonInfo> {
    return this.request("GET", `/team-messaging/v1/persons/${RingCentralClient.encodeId(personId)}`);
  }

  async searchDirectory(query: string): Promise<PaginatedRecords<PersonInfo>> {
    return this.request("POST", "/restapi/v1.0/account/~/directory/entries/search", {
      searchString: query,
    });
  }

  async listTasks(chatId: string): Promise<PaginatedRecords<Task>> {
    return this.request("GET", `/team-messaging/v1/chats/${RingCentralClient.encodeId(chatId)}/tasks?recordCount=50`);
  }

  async createTask(chatId: string, req: CreateTaskRequest): Promise<Task> {
    return this.request("POST", `/team-messaging/v1/chats/${RingCentralClient.encodeId(chatId)}/tasks`, req);
  }

  async getTask(taskId: string): Promise<Task> {
    return this.request("GET", `/team-messaging/v1/tasks/${RingCentralClient.encodeId(taskId)}`);
  }

  async updateTask(taskId: string, updates: Partial<CreateTaskRequest>): Promise<Task> {
    return this.request("PATCH", `/team-messaging/v1/tasks/${RingCentralClient.encodeId(taskId)}`, updates);
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.request("DELETE", `/team-messaging/v1/tasks/${RingCentralClient.encodeId(taskId)}`);
  }

  async completeTask(taskId: string, assigneeId: string): Promise<void> {
    await this.request("POST", `/team-messaging/v1/tasks/${RingCentralClient.encodeId(taskId)}/complete`, {
      assignees: [{ id: assigneeId, status: "Completed" }],
    });
  }

  async listEvents(chatId: string, recordCount = 50): Promise<PaginatedRecords<Event>> {
    return this.request(
      "GET",
      `/team-messaging/v1/groups/${RingCentralClient.encodeId(chatId)}/events?recordCount=${Math.trunc(recordCount)}`,
    );
  }

  async createEvent(chatId: string, req: CreateEventRequest): Promise<Event> {
    return this.request("POST", `/team-messaging/v1/groups/${RingCentralClient.encodeId(chatId)}/events`, req);
  }

  async getEvent(eventId: string): Promise<Event> {
    return this.request("GET", `/team-messaging/v1/events/${RingCentralClient.encodeId(eventId)}`);
  }

  async updateEvent(eventId: string, updates: CreateEventRequest): Promise<Event> {
    return this.request("PUT", `/team-messaging/v1/events/${RingCentralClient.encodeId(eventId)}`, updates);
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.request("DELETE", `/team-messaging/v1/events/${RingCentralClient.encodeId(eventId)}`);
  }

  async listNotes(chatId: string): Promise<PaginatedRecords<Note>> {
    return this.request("GET", `/team-messaging/v1/chats/${RingCentralClient.encodeId(chatId)}/notes?recordCount=50`);
  }

  async createNote(chatId: string, req: CreateNoteRequest): Promise<Note> {
    return this.request("POST", `/team-messaging/v1/chats/${RingCentralClient.encodeId(chatId)}/notes`, req);
  }

  async getNote(noteId: string): Promise<Note> {
    return this.request("GET", `/team-messaging/v1/notes/${RingCentralClient.encodeId(noteId)}`);
  }

  async updateNote(noteId: string, updates: Partial<CreateNoteRequest>): Promise<Note> {
    return this.request("PATCH", `/team-messaging/v1/notes/${RingCentralClient.encodeId(noteId)}`, updates);
  }

  async deleteNote(noteId: string): Promise<void> {
    await this.request("DELETE", `/team-messaging/v1/notes/${RingCentralClient.encodeId(noteId)}`);
  }

  async publishNote(noteId: string): Promise<void> {
    await this.request("POST", `/team-messaging/v1/notes/${RingCentralClient.encodeId(noteId)}/publish`);
  }

  async createAdaptiveCard(chatId: string, card: CreateAdaptiveCardRequest): Promise<AdaptiveCard> {
    return this.request("POST", `/team-messaging/v1/chats/${RingCentralClient.encodeId(chatId)}/adaptive-cards`, card);
  }

  async getAdaptiveCard(cardId: string): Promise<AdaptiveCard> {
    return this.request("GET", `/team-messaging/v1/adaptive-cards/${RingCentralClient.encodeId(cardId)}`);
  }

  async updateAdaptiveCard(cardId: string, card: CreateAdaptiveCardRequest): Promise<AdaptiveCard> {
    return this.request("PUT", `/team-messaging/v1/adaptive-cards/${RingCentralClient.encodeId(cardId)}`, card);
  }

  async deleteAdaptiveCard(cardId: string): Promise<void> {
    await this.request("DELETE", `/team-messaging/v1/adaptive-cards/${RingCentralClient.encodeId(cardId)}`);
  }
}

function normalizeAttachmentFileName(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "attachment";
  }
  return trimmed.replace(/[\0\r\n]+/g, " ").trim() || "attachment";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isInvalidAccessTokenBody(body: string): boolean {
  return /TokenInvalid|OAU-213/.test(body);
}

const ownerClientCache = new Map<string, RingCentralClient>();

function ownerClientCacheKey(
  serverUrl: string,
  clientId: string,
  clientSecret: string,
  jwt: string,
): string {
  return `${serverUrl.replace(/\/$/, "")}\0${clientId}\0${clientSecret}\0${jwt}`;
}

export function createBotClient(serverUrl: string, botToken: string): RingCentralClient {
  return new RingCentralClient({ serverUrl, botToken });
}

export function createOwnerClient(
  serverUrl: string,
  clientId: string,
  clientSecret: string,
  jwt: string,
): RingCentralClient {
  const key = ownerClientCacheKey(serverUrl, clientId, clientSecret, jwt);
  const cached = ownerClientCache.get(key);
  if (cached) {
    return cached;
  }
  const client = new RingCentralClient({
    serverUrl,
    ownerCredentials: { clientId, clientSecret, jwt },
  });
  ownerClientCache.set(key, client);
  return client;
}

export function clearCachedOwnerClients(): void {
  ownerClientCache.clear();
}

/** @deprecated Use createOwnerClient. */
export const createPrivateClient = createOwnerClient;

export function isAuthzOrNotFoundError(err: unknown): boolean {
  return err instanceof RingCentralApiError && [401, 403, 404].includes(err.status);
}
