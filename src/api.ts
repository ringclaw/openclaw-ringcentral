import type { ResolvedRingCentralAccount } from "./accounts.js";
import { getRingCentralPlatform } from "./auth.js";
import { toRingCentralMarkdown } from "./markdown.js";
import type {
  RingCentralChat,
  RingCentralConversation,
  RingCentralPost,
  RingCentralUser,
  RingCentralCompany,
  RingCentralAttachment,
  RingCentralAdaptiveCard,
  RingCentralTask,
  RingCentralEvent,
  RingCentralNote,
  RingCentralWebhook,
  RingCentralTeam,
} from "./types.js";

// Team Messaging API endpoints
const TM_API_BASE = "/team-messaging/v1";

export type RingCentralApiErrorInfo = {
  httpStatus?: number;
  requestId?: string;
  errorCode?: string;
  errorMessage?: string;
  accountId?: string;
  errors?: Array<{ errorCode?: string; message?: string; parameterName?: string }>;
};

export function extractRcApiError(err: unknown, accountId?: string): RingCentralApiErrorInfo {
  const info: RingCentralApiErrorInfo = {};
  if (accountId) info.accountId = accountId;

  if (!err || typeof err !== "object") {
    info.errorMessage = String(err);
    return info;
  }

  const e = err as Record<string, unknown>;

  // @ringcentral/sdk wraps errors with response object
  const response = e.response as Record<string, unknown> | undefined;
  if (response) {
    info.httpStatus = typeof response.status === "number" ? response.status : undefined;
    
    // Extract request ID from headers
    const headers = response.headers as Record<string, unknown> | undefined;
    if (headers) {
      // headers can be a Headers object or plain object
      if (typeof (headers as any).get === "function") {
        info.requestId = (headers as any).get("x-request-id") ?? (headers as any).get("rcrequestid");
      } else {
        info.requestId = (headers["x-request-id"] ?? headers["rcrequestid"]) as string | undefined;
      }
    }
  }

  // Try to extract error body (SDK often attaches parsed JSON to error)
  const body = (e._response as Record<string, unknown> | undefined) ?? 
               (e.body as Record<string, unknown> | undefined) ??
               (e.data as Record<string, unknown> | undefined);
  if (body && typeof body === "object") {
    info.errorCode = body.errorCode as string | undefined;
    info.errorMessage = body.message as string | undefined;
    if (Array.isArray(body.errors)) {
      info.errors = body.errors;
    }
  }

  // Fallback: parse message if it looks like JSON
  if (!info.errorCode && typeof e.message === "string") {
    const msg = e.message;
    try {
      const parsed = JSON.parse(msg);
      if (parsed && typeof parsed === "object") {
        info.errorCode = parsed.errorCode;
        info.errorMessage = parsed.message ?? info.errorMessage;
        if (Array.isArray(parsed.errors)) {
          info.errors = parsed.errors;
        }
      }
    } catch {
      // Not JSON, use as-is
      info.errorMessage = info.errorMessage ?? msg;
    }
  }

  // Extract from standard Error properties
  if (!info.errorMessage && typeof e.message === "string") {
    info.errorMessage = e.message;
  }

  return info;
}

export function formatRcApiError(info: RingCentralApiErrorInfo): string {
  const parts: string[] = [];
  
  if (info.httpStatus) parts.push(`HTTP ${info.httpStatus}`);
  if (info.errorCode) parts.push(`ErrorCode=${info.errorCode}`);
  if (info.requestId) parts.push(`RequestId=${info.requestId}`);
  if (info.accountId) parts.push(`AccountId=${info.accountId}`);
  if (info.errorMessage) parts.push(`Message="${info.errorMessage}"`);
  
  if (info.errors && info.errors.length > 0) {
    const errDetails = info.errors
      .map((e) => `${e.errorCode ?? "?"}: ${e.message ?? "?"}${e.parameterName ? ` (${e.parameterName})` : ""}`)
      .join("; ");
    parts.push(`Details=[${errDetails}]`);
  }
  
  return parts.length > 0 ? parts.join(" | ") : "Unknown error";
}

export async function sendRingCentralMessage(params: {
  account: ResolvedRingCentralAccount;
  chatId: string;
  text?: string;
  attachments?: Array<{ id: string; type?: string }>;
}): Promise<{ postId?: string } | null> {
  const { account, chatId, text, attachments } = params;
  const platform = await getRingCentralPlatform(account);

  const body: Record<string, unknown> = {};
  if (text) body.text = toRingCentralMarkdown(text);
  if (attachments && attachments.length > 0) {
    body.attachments = attachments;
  }

  const response = await platform.post(`${TM_API_BASE}/chats/${chatId}/posts`, body);
  const result = (await response.json()) as RingCentralPost;
  return result ? { postId: result.id } : null;
}

export async function updateRingCentralMessage(params: {
  account: ResolvedRingCentralAccount;
  chatId: string;
  postId: string;
  text: string;
}): Promise<{ postId?: string }> {
  const { account, chatId, postId, text } = params;
  const platform = await getRingCentralPlatform(account);

  const response = await platform.patch(
    `${TM_API_BASE}/chats/${chatId}/posts/${postId}`,
    { text: toRingCentralMarkdown(text) },
  );
  const result = (await response.json()) as RingCentralPost;
  return { postId: result.id };
}

export async function deleteRingCentralMessage(params: {
  account: ResolvedRingCentralAccount;
  chatId: string;
  postId: string;
}): Promise<void> {
  const { account, chatId, postId } = params;
  const platform = await getRingCentralPlatform(account);
  await platform.delete(`${TM_API_BASE}/chats/${chatId}/posts/${postId}`);
}

export async function getRingCentralPost(params: {
  account: ResolvedRingCentralAccount;
  chatId: string;
  postId: string;
}): Promise<RingCentralPost | null> {
  const { account, chatId, postId } = params;
  const platform = await getRingCentralPlatform(account);

  try {
    const response = await platform.get(`${TM_API_BASE}/chats/${chatId}/posts/${postId}`);
    return (await response.json()) as RingCentralPost;
  } catch {
    return null;
  }
}

export async function listRingCentralPosts(params: {
  account: ResolvedRingCentralAccount;
  chatId: string;
  limit?: number;
  pageToken?: string;
}): Promise<{ records: RingCentralPost[]; navigation?: { prevPageToken?: string; nextPageToken?: string } }> {
  const { account, chatId, limit, pageToken } = params;
  const platform = await getRingCentralPlatform(account);

  const queryParams: Record<string, string> = {};
  if (limit) queryParams.recordCount = String(limit);
  if (pageToken) queryParams.pageToken = pageToken;

  const response = await platform.get(`${TM_API_BASE}/chats/${chatId}/posts`, queryParams);
  const result = (await response.json()) as {
    records?: RingCentralPost[];
    navigation?: { prevPageToken?: string; nextPageToken?: string };
  };
  return {
    records: result.records ?? [],
    navigation: result.navigation,
  };
}

export async function getRingCentralChat(params: {
  account: ResolvedRingCentralAccount;
  chatId: string;
}): Promise<RingCentralChat | null> {
  const { account, chatId } = params;
  const platform = await getRingCentralPlatform(account);

  try {
    const response = await platform.get(`${TM_API_BASE}/chats/${chatId}`);
    return (await response.json()) as RingCentralChat;
  } catch {
    return null;
  }
}

export async function listRingCentralChats(params: {
  account: ResolvedRingCentralAccount;
  type?: string[];
  limit?: number;
}): Promise<RingCentralChat[]> {
  const { account, type, limit } = params;
  const platform = await getRingCentralPlatform(account);

  const queryParams: Record<string, string> = {};
  if (type && type.length > 0) queryParams.type = type.join(",");
  if (limit) queryParams.recordCount = String(limit);

  const response = await platform.get(`${TM_API_BASE}/chats`, queryParams);
  const result = (await response.json()) as { records?: RingCentralChat[] };
  return result.records ?? [];
}

// Conversations API
export async function listRingCentralConversations(params: {
  account: ResolvedRingCentralAccount;
  limit?: number;
  pageToken?: string;
}): Promise<{ records: RingCentralConversation[]; navigation?: { prevPageToken?: string; nextPageToken?: string } }> {
  const { account, limit, pageToken } = params;
  const platform = await getRingCentralPlatform(account);

  const queryParams: Record<string, string> = {};
  if (limit) queryParams.recordCount = String(limit);
  if (pageToken) queryParams.pageToken = pageToken;

  const response = await platform.get(`${TM_API_BASE}/conversations`, queryParams);
  const result = (await response.json()) as {
    records?: RingCentralConversation[];
    navigation?: { prevPageToken?: string; nextPageToken?: string };
  };
  return {
    records: result.records ?? [],
    navigation: result.navigation,
  };
}

export async function getRingCentralConversation(params: {
  account: ResolvedRingCentralAccount;
  conversationId: string;
}): Promise<RingCentralConversation | null> {
  const { account, conversationId } = params;
  const platform = await getRingCentralPlatform(account);

  try {
    const response = await platform.get(`${TM_API_BASE}/conversations/${conversationId}`);
    return (await response.json()) as RingCentralConversation;
  } catch {
    return null;
  }
}

export async function createRingCentralConversation(params: {
  account: ResolvedRingCentralAccount;
  memberIds: string[];
}): Promise<RingCentralConversation | null> {
  const { account, memberIds } = params;
  const platform = await getRingCentralPlatform(account);

  const body = {
    members: memberIds.map((id) => ({ id })),
  };

  const response = await platform.post(`${TM_API_BASE}/conversations`, body);
  return (await response.json()) as RingCentralConversation;
}

export async function getRingCentralUser(params: {
  account: ResolvedRingCentralAccount;
  userId: string;
}): Promise<RingCentralUser | null> {
  const { account, userId } = params;
  const platform = await getRingCentralPlatform(account);

  try {
    const response = await platform.get(`${TM_API_BASE}/persons/${userId}`);
    return (await response.json()) as RingCentralUser;
  } catch {
    return null;
  }
}

export async function getCurrentRingCentralUser(params: {
  account: ResolvedRingCentralAccount;
}): Promise<RingCentralUser | null> {
  const { account } = params;
  const platform = await getRingCentralPlatform(account);

  try {
    const response = await platform.get("/restapi/v1.0/account/~/extension/~");
    return (await response.json()) as RingCentralUser;
  } catch {
    return null;
  }
}

export async function getRingCentralCompanyInfo(params: {
  account: ResolvedRingCentralAccount;
}): Promise<RingCentralCompany | null> {
  const { account } = params;
  const platform = await getRingCentralPlatform(account);

  try {
    const response = await platform.get(`${TM_API_BASE}/companies/~`);
    return (await response.json()) as RingCentralCompany;
  } catch {
    return null;
  }
}

export async function uploadRingCentralAttachment(params: {
  account: ResolvedRingCentralAccount;
  chatId: string;
  filename: string;
  buffer: Buffer;
  contentType?: string;
}): Promise<{ attachmentId?: string }> {
  const { account, chatId, filename, buffer, contentType } = params;
  const platform = await getRingCentralPlatform(account);

  // Create FormData for multipart upload
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], { type: contentType || "application/octet-stream" });
  formData.append("file", blob, filename);

  const response = await platform.post(
    `${TM_API_BASE}/chats/${chatId}/files`,
    formData,
  );
  const result = (await response.json()) as RingCentralAttachment;
  return { attachmentId: result.id };
}

export async function downloadRingCentralAttachment(params: {
  account: ResolvedRingCentralAccount;
  contentUri: string;
  maxBytes?: number;
}): Promise<{ buffer: Buffer; contentType?: string }> {
  const { account, contentUri, maxBytes } = params;
  const platform = await getRingCentralPlatform(account);

  const response = await platform.get(contentUri);
  const contentType = response.headers.get("content-type") ?? undefined;

  if (maxBytes) {
    const lengthHeader = response.headers.get("content-length");
    if (lengthHeader) {
      const length = Number(lengthHeader);
      if (Number.isFinite(length) && length > maxBytes) {
        throw new Error(`RingCentral attachment exceeds max bytes (${maxBytes})`);
      }
    }
  }

  if (!maxBytes || !response.body) {
    const arrayBuffer = await response.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), contentType };
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`RingCentral attachment exceeds max bytes (${maxBytes})`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return { buffer: Buffer.concat(chunks, total), contentType };
}

// Adaptive Cards API
export async function sendRingCentralAdaptiveCard(params: {
  account: ResolvedRingCentralAccount;
  chatId: string;
  card: RingCentralAdaptiveCard;
  fallbackText?: string;
}): Promise<{ cardId?: string } | null> {
  const { account, chatId, card, fallbackText } = params;
  const platform = await getRingCentralPlatform(account);

  const body = {
    ...card,
    type: "AdaptiveCard",
    $schema: card.$schema ?? "http://adaptivecards.io/schemas/adaptive-card.json",
    version: card.version ?? "1.3",
    ...(fallbackText ? { fallbackText } : {}),
  };

  const response = await platform.post(`${TM_API_BASE}/chats/${chatId}/adaptive-cards`, body);
  const result = (await response.json()) as { id?: string };
  return result ? { cardId: result.id } : null;
}

export async function updateRingCentralAdaptiveCard(params: {
  account: ResolvedRingCentralAccount;
  cardId: string;
  card: RingCentralAdaptiveCard;
  fallbackText?: string;
}): Promise<{ cardId?: string }> {
  const { account, cardId, card, fallbackText } = params;
  const platform = await getRingCentralPlatform(account);

  const body = {
    ...card,
    type: "AdaptiveCard",
    $schema: card.$schema ?? "http://adaptivecards.io/schemas/adaptive-card.json",
    version: card.version ?? "1.3",
    ...(fallbackText ? { fallbackText } : {}),
  };

  const response = await platform.put(`${TM_API_BASE}/adaptive-cards/${cardId}`, body);
  const result = (await response.json()) as { id?: string };
  return { cardId: result.id };
}

export async function getRingCentralAdaptiveCard(params: {
  account: ResolvedRingCentralAccount;
  cardId: string;
}): Promise<RingCentralAdaptiveCard | null> {
  const { account, cardId } = params;
  const platform = await getRingCentralPlatform(account);

  try {
    const response = await platform.get(`${TM_API_BASE}/adaptive-cards/${cardId}`);
    return (await response.json()) as RingCentralAdaptiveCard;
  } catch {
    return null;
  }
}

export async function deleteRingCentralAdaptiveCard(params: {
  account: ResolvedRingCentralAccount;
  cardId: string;
}): Promise<void> {
  const { account, cardId } = params;
  const platform = await getRingCentralPlatform(account);
  await platform.delete(`${TM_API_BASE}/adaptive-cards/${cardId}`);
}

// Favorite Chats API
export async function listRingCentralFavoriteChats(params: {
  account: ResolvedRingCentralAccount;
  limit?: number;
}): Promise<{ records: RingCentralChat[]; navigation?: { nextPageToken?: string } }> {
  const { account, limit } = params;
  const platform = await getRingCentralPlatform(account);

  const queryParams: Record<string, string> = {};
  if (limit) queryParams.recordCount = String(limit);

  const response = await platform.get(`${TM_API_BASE}/favorites`, queryParams);
  const result = (await response.json()) as {
    records?: RingCentralChat[];
    navigation?: { prevPageToken?: string; nextPageToken?: string };
  };
  return {
    records: result.records ?? [],
    navigation: result.navigation,
  };
}

export async function addRingCentralFavoriteChat(params: {
  account: ResolvedRingCentralAccount;
  chatId: string;
}): Promise<void> {
  const { account, chatId } = params;
  const platform = await getRingCentralPlatform(account);
  await platform.post(`${TM_API_BASE}/favorites`, { id: chatId });
}

export async function removeRingCentralFavoriteChat(params: {
  account: ResolvedRingCentralAccount;
  chatId: string;
}): Promise<void> {
  const { account, chatId } = params;
  const platform = await getRingCentralPlatform(account);
  await platform.delete(`${TM_API_BASE}/favorites/${chatId}`);
}

// Tasks API
export async function listRingCentralTasks(params: {
  account: ResolvedRingCentralAccount;
  chatId: string;
  assigneeId?: string;
  assigneeStatus?: "Pending" | "Completed";
  assignmentStatus?: "Unassigned" | "Assigned";
  status?: "Pending" | "InProgress" | "Completed";
  limit?: number;
  pageToken?: string;
}): Promise<{ records: RingCentralTask[]; navigation?: { nextPageToken?: string } }> {
  const { account, chatId, assigneeId, assigneeStatus, assignmentStatus, status, limit, pageToken } = params;
  const platform = await getRingCentralPlatform(account);

  const queryParams: Record<string, string> = {};
  if (assigneeId) queryParams.assigneeId = assigneeId;
  if (assigneeStatus) queryParams.assigneeStatus = assigneeStatus;
  if (assignmentStatus) queryParams.assignmentStatus = assignmentStatus;
  if (status) queryParams.status = status;
  if (limit) queryParams.recordCount = String(limit);
  if (pageToken) queryParams.pageToken = pageToken;

  const response = await platform.get(`${TM_API_BASE}/chats/${chatId}/tasks`, queryParams);
  const result = (await response.json()) as {
    records?: RingCentralTask[];
    navigation?: { prevPageToken?: string; nextPageToken?: string };
  };
  return {
    records: result.records ?? [],
    navigation: result.navigation,
  };
}

export async function createRingCentralTask(params: {
  account: ResolvedRingCentralAccount;
  chatId: string;
  subject: string;
  assignees?: Array<{ id: string }>;
  completenessCondition?: "Simple" | "AllAssignees" | "Percentage";
  startDate?: string;
  dueDate?: string;
  color?: "Black" | "Red" | "Orange" | "Yellow" | "Green" | "Blue" | "Purple" | "Magenta";
  section?: string;
  description?: string;
  recurrence?: {
    schedule?: "None" | "Daily" | "Weekdays" | "Weekly" | "Monthly" | "Yearly";
    endingCondition?: "None" | "Count" | "Date";
    endingAfter?: number;
    endingOn?: string;
  };
  attachments?: Array<{ id: string }>;
}): Promise<RingCentralTask> {
  const { account, chatId, ...taskData } = params;
  const platform = await getRingCentralPlatform(account);

  const response = await platform.post(`${TM_API_BASE}/chats/${chatId}/tasks`, taskData);
  return (await response.json()) as RingCentralTask;
}

export async function getRingCentralTask(params: {
  account: ResolvedRingCentralAccount;
  taskId: string;
}): Promise<RingCentralTask | null> {
  const { account, taskId } = params;
  const platform = await getRingCentralPlatform(account);

  try {
    const response = await platform.get(`${TM_API_BASE}/tasks/${taskId}`);
    return (await response.json()) as RingCentralTask;
  } catch {
    return null;
  }
}

export async function updateRingCentralTask(params: {
  account: ResolvedRingCentralAccount;
  taskId: string;
  subject?: string;
  assignees?: Array<{ id: string }>;
  completenessCondition?: "Simple" | "AllAssignees" | "Percentage";
  startDate?: string;
  dueDate?: string;
  color?: "Black" | "Red" | "Orange" | "Yellow" | "Green" | "Blue" | "Purple" | "Magenta";
  section?: string;
  description?: string;
}): Promise<RingCentralTask> {
  const { account, taskId, ...taskData } = params;
  const platform = await getRingCentralPlatform(account);

  const response = await platform.patch(`${TM_API_BASE}/tasks/${taskId}`, taskData);
  return (await response.json()) as RingCentralTask;
}

export async function deleteRingCentralTask(params: {
  account: ResolvedRingCentralAccount;
  taskId: string;
}): Promise<void> {
  const { account, taskId } = params;
  const platform = await getRingCentralPlatform(account);
  await platform.delete(`${TM_API_BASE}/tasks/${taskId}`);
}

export async function completeRingCentralTask(params: {
  account: ResolvedRingCentralAccount;
  taskId: string;
  status: "Incomplete" | "Complete";
  assignees?: Array<{ id: string }>;
  completenessPercentage?: number;
}): Promise<void> {
  const { account, taskId, status, assignees, completenessPercentage } = params;
  const platform = await getRingCentralPlatform(account);

  const body: Record<string, unknown> = { status };
  if (assignees) body.assignees = assignees;
  if (completenessPercentage !== undefined) body.completenessPercentage = completenessPercentage;

  await platform.post(`${TM_API_BASE}/tasks/${taskId}/complete`, body);
}

// Calendar Events API
export async function listRingCentralEvents(params: {
  account: ResolvedRingCentralAccount;
  groupId: string;
  limit?: number;
  pageToken?: string;
}): Promise<{ records: RingCentralEvent[]; navigation?: { nextPageToken?: string } }> {
  const { account, groupId, limit, pageToken } = params;
  const platform = await getRingCentralPlatform(account);

  const queryParams: Record<string, string> = {};
  if (limit) queryParams.recordCount = String(limit);
  if (pageToken) queryParams.pageToken = pageToken;

  const response = await platform.get(`${TM_API_BASE}/groups/${groupId}/events`, queryParams);
  const result = (await response.json()) as {
    records?: RingCentralEvent[];
    navigation?: { prevPageToken?: string; nextPageToken?: string };
  };
  return {
    records: result.records ?? [],
    navigation: result.navigation,
  };
}

export async function createRingCentralEvent(params: {
  account: ResolvedRingCentralAccount;
  groupId: string;
  title: string;
  startTime: string;
  endTime: string;
  allDay?: boolean;
  recurrence?: "None" | "Day" | "Weekday" | "Week" | "Month" | "Year";
  endingCondition?: "None" | "Count" | "Date";
  endingAfter?: number;
  endingOn?: string;
  color?: "Black" | "Red" | "Orange" | "Yellow" | "Green" | "Blue" | "Purple" | "Magenta";
  location?: string;
  description?: string;
}): Promise<RingCentralEvent> {
  const { account, groupId, ...eventData } = params;
  const platform = await getRingCentralPlatform(account);

  const response = await platform.post(`${TM_API_BASE}/groups/${groupId}/events`, eventData);
  return (await response.json()) as RingCentralEvent;
}

export async function getRingCentralEvent(params: {
  account: ResolvedRingCentralAccount;
  eventId: string;
}): Promise<RingCentralEvent | null> {
  const { account, eventId } = params;
  const platform = await getRingCentralPlatform(account);

  try {
    const response = await platform.get(`${TM_API_BASE}/events/${eventId}`);
    return (await response.json()) as RingCentralEvent;
  } catch {
    return null;
  }
}

export async function updateRingCentralEvent(params: {
  account: ResolvedRingCentralAccount;
  eventId: string;
  title?: string;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
  recurrence?: "None" | "Day" | "Weekday" | "Week" | "Month" | "Year";
  endingCondition?: "None" | "Count" | "Date";
  endingAfter?: number;
  endingOn?: string;
  color?: "Black" | "Red" | "Orange" | "Yellow" | "Green" | "Blue" | "Purple" | "Magenta";
  location?: string;
  description?: string;
}): Promise<RingCentralEvent> {
  const { account, eventId, ...eventData } = params;
  const platform = await getRingCentralPlatform(account);

  const response = await platform.put(`${TM_API_BASE}/events/${eventId}`, eventData);
  return (await response.json()) as RingCentralEvent;
}

export async function deleteRingCentralEvent(params: {
  account: ResolvedRingCentralAccount;
  eventId: string;
}): Promise<void> {
  const { account, eventId } = params;
  const platform = await getRingCentralPlatform(account);
  await platform.delete(`${TM_API_BASE}/events/${eventId}`);
}

// Notes API
export async function listRingCentralNotes(params: {
  account: ResolvedRingCentralAccount;
  chatId: string;
  status?: "Active" | "Draft";
  limit?: number;
  pageToken?: string;
}): Promise<{ records: RingCentralNote[]; navigation?: { nextPageToken?: string } }> {
  const { account, chatId, status, limit, pageToken } = params;
  const platform = await getRingCentralPlatform(account);

  const queryParams: Record<string, string> = {};
  if (status) queryParams.status = status;
  if (limit) queryParams.recordCount = String(limit);
  if (pageToken) queryParams.pageToken = pageToken;

  const response = await platform.get(`${TM_API_BASE}/chats/${chatId}/notes`, queryParams);
  const result = (await response.json()) as {
    records?: RingCentralNote[];
    navigation?: { prevPageToken?: string; nextPageToken?: string };
  };
  return {
    records: result.records ?? [],
    navigation: result.navigation,
  };
}

export async function createRingCentralNote(params: {
  account: ResolvedRingCentralAccount;
  chatId: string;
  title: string;
  body?: string;
}): Promise<RingCentralNote> {
  const { account, chatId, title, body } = params;
  const platform = await getRingCentralPlatform(account);

  const response = await platform.post(`${TM_API_BASE}/chats/${chatId}/notes`, { title, body });
  return (await response.json()) as RingCentralNote;
}

export async function getRingCentralNote(params: {
  account: ResolvedRingCentralAccount;
  noteId: string;
}): Promise<RingCentralNote | null> {
  const { account, noteId } = params;
  const platform = await getRingCentralPlatform(account);

  try {
    const response = await platform.get(`${TM_API_BASE}/notes/${noteId}`);
    return (await response.json()) as RingCentralNote;
  } catch {
    return null;
  }
}

export async function updateRingCentralNote(params: {
  account: ResolvedRingCentralAccount;
  noteId: string;
  title?: string;
  body?: string;
}): Promise<RingCentralNote> {
  const { account, noteId, title, body } = params;
  const platform = await getRingCentralPlatform(account);

  const updateData: Record<string, unknown> = {};
  if (title !== undefined) updateData.title = title;
  if (body !== undefined) updateData.body = body;

  const response = await platform.patch(`${TM_API_BASE}/notes/${noteId}`, updateData);
  return (await response.json()) as RingCentralNote;
}

export async function deleteRingCentralNote(params: {
  account: ResolvedRingCentralAccount;
  noteId: string;
}): Promise<void> {
  const { account, noteId } = params;
  const platform = await getRingCentralPlatform(account);
  await platform.delete(`${TM_API_BASE}/notes/${noteId}`);
}

export async function lockRingCentralNote(params: {
  account: ResolvedRingCentralAccount;
  noteId: string;
}): Promise<void> {
  const { account, noteId } = params;
  const platform = await getRingCentralPlatform(account);
  await platform.post(`${TM_API_BASE}/notes/${noteId}/lock`, {});
}

export async function unlockRingCentralNote(params: {
  account: ResolvedRingCentralAccount;
  noteId: string;
}): Promise<void> {
  const { account, noteId } = params;
  const platform = await getRingCentralPlatform(account);
  await platform.post(`${TM_API_BASE}/notes/${noteId}/unlock`, {});
}

export async function publishRingCentralNote(params: {
  account: ResolvedRingCentralAccount;
  noteId: string;
}): Promise<RingCentralNote> {
  const { account, noteId } = params;
  const platform = await getRingCentralPlatform(account);

  const response = await platform.post(`${TM_API_BASE}/notes/${noteId}/publish`, {});

  // The publish endpoint may return an empty body (200/204) on success.
  const text = await response.text();
  if (text) {
    try {
      return JSON.parse(text) as RingCentralNote;
    } catch {
      // Body present but not valid JSON — treat 2xx as success
    }
  }
  return { id: noteId, status: "Active" } as RingCentralNote;
}

// Incoming Webhooks API
export async function listRingCentralWebhooks(params: {
  account: ResolvedRingCentralAccount;
  limit?: number;
  pageToken?: string;
}): Promise<{ records: RingCentralWebhook[]; navigation?: { nextPageToken?: string } }> {
  const { account, limit, pageToken } = params;
  const platform = await getRingCentralPlatform(account);

  const queryParams: Record<string, string> = {};
  if (limit) queryParams.recordCount = String(limit);
  if (pageToken) queryParams.pageToken = pageToken;

  const response = await platform.get(`${TM_API_BASE}/webhooks`, queryParams);
  const result = (await response.json()) as {
    records?: RingCentralWebhook[];
    navigation?: { prevPageToken?: string; nextPageToken?: string };
  };
  return {
    records: result.records ?? [],
    navigation: result.navigation,
  };
}

export async function createRingCentralWebhook(params: {
  account: ResolvedRingCentralAccount;
  uri: string;
  chatIds?: string[];
}): Promise<RingCentralWebhook> {
  const { account, uri, chatIds } = params;
  const platform = await getRingCentralPlatform(account);

  const body: Record<string, unknown> = { uri };
  if (chatIds && chatIds.length > 0) body.chatIds = chatIds;

  const response = await platform.post(`${TM_API_BASE}/webhooks`, body);
  return (await response.json()) as RingCentralWebhook;
}

export async function getRingCentralWebhook(params: {
  account: ResolvedRingCentralAccount;
  webhookId: string;
}): Promise<RingCentralWebhook | null> {
  const { account, webhookId } = params;
  const platform = await getRingCentralPlatform(account);

  try {
    const response = await platform.get(`${TM_API_BASE}/webhooks/${webhookId}`);
    return (await response.json()) as RingCentralWebhook;
  } catch {
    return null;
  }
}

export async function deleteRingCentralWebhook(params: {
  account: ResolvedRingCentralAccount;
  webhookId: string;
}): Promise<void> {
  const { account, webhookId } = params;
  const platform = await getRingCentralPlatform(account);
  await platform.delete(`${TM_API_BASE}/webhooks/${webhookId}`);
}

export async function activateRingCentralWebhook(params: {
  account: ResolvedRingCentralAccount;
  webhookId: string;
}): Promise<void> {
  const { account, webhookId } = params;
  const platform = await getRingCentralPlatform(account);
  await platform.post(`${TM_API_BASE}/webhooks/${webhookId}/activate`, {});
}

export async function suspendRingCentralWebhook(params: {
  account: ResolvedRingCentralAccount;
  webhookId: string;
}): Promise<void> {
  const { account, webhookId } = params;
  const platform = await getRingCentralPlatform(account);
  await platform.post(`${TM_API_BASE}/webhooks/${webhookId}/suspend`, {});
}

// Teams API
export async function listRingCentralTeams(params: {
  account: ResolvedRingCentralAccount;
  limit?: number;
  pageToken?: string;
}): Promise<{ records: RingCentralTeam[]; navigation?: { nextPageToken?: string } }> {
  const { account, limit, pageToken } = params;
  const platform = await getRingCentralPlatform(account);

  const queryParams: Record<string, string> = {};
  if (limit) queryParams.recordCount = String(limit);
  if (pageToken) queryParams.pageToken = pageToken;

  const response = await platform.get(`${TM_API_BASE}/teams`, queryParams);
  const result = (await response.json()) as {
    records?: RingCentralTeam[];
    navigation?: { prevPageToken?: string; nextPageToken?: string };
  };
  return {
    records: result.records ?? [],
    navigation: result.navigation,
  };
}

export async function createRingCentralTeam(params: {
  account: ResolvedRingCentralAccount;
  name: string;
  description?: string;
  isPublic?: boolean;
  members?: Array<{ id?: string; email?: string }>;
}): Promise<RingCentralTeam> {
  const { account, name, description, isPublic, members } = params;
  const platform = await getRingCentralPlatform(account);

  const body: Record<string, unknown> = { name };
  if (description !== undefined) body.description = description;
  if (isPublic !== undefined) body.public = isPublic;
  if (members) body.members = members;

  const response = await platform.post(`${TM_API_BASE}/teams`, body);
  return (await response.json()) as RingCentralTeam;
}

export async function getRingCentralTeam(params: {
  account: ResolvedRingCentralAccount;
  teamId: string;
}): Promise<RingCentralTeam | null> {
  const { account, teamId } = params;
  const platform = await getRingCentralPlatform(account);

  try {
    const response = await platform.get(`${TM_API_BASE}/teams/${teamId}`);
    return (await response.json()) as RingCentralTeam;
  } catch {
    return null;
  }
}

export async function updateRingCentralTeam(params: {
  account: ResolvedRingCentralAccount;
  teamId: string;
  name?: string;
  description?: string;
  isPublic?: boolean;
}): Promise<RingCentralTeam> {
  const { account, teamId, name, description, isPublic } = params;
  const platform = await getRingCentralPlatform(account);

  const body: Record<string, unknown> = {};
  if (name !== undefined) body.name = name;
  if (description !== undefined) body.description = description;
  if (isPublic !== undefined) body.public = isPublic;

  const response = await platform.patch(`${TM_API_BASE}/teams/${teamId}`, body);
  return (await response.json()) as RingCentralTeam;
}

export async function deleteRingCentralTeam(params: {
  account: ResolvedRingCentralAccount;
  teamId: string;
}): Promise<void> {
  const { account, teamId } = params;
  const platform = await getRingCentralPlatform(account);
  await platform.delete(`${TM_API_BASE}/teams/${teamId}`);
}

export async function joinRingCentralTeam(params: {
  account: ResolvedRingCentralAccount;
  teamId: string;
}): Promise<void> {
  const { account, teamId } = params;
  const platform = await getRingCentralPlatform(account);
  await platform.post(`${TM_API_BASE}/teams/${teamId}/join`, {});
}

export async function leaveRingCentralTeam(params: {
  account: ResolvedRingCentralAccount;
  teamId: string;
}): Promise<void> {
  const { account, teamId } = params;
  const platform = await getRingCentralPlatform(account);
  await platform.post(`${TM_API_BASE}/teams/${teamId}/leave`, {});
}

export async function addRingCentralTeamMembers(params: {
  account: ResolvedRingCentralAccount;
  teamId: string;
  members: Array<{ id?: string; email?: string }>;
}): Promise<void> {
  const { account, teamId, members } = params;
  const platform = await getRingCentralPlatform(account);
  await platform.post(`${TM_API_BASE}/teams/${teamId}/add`, { members });
}

export async function removeRingCentralTeamMembers(params: {
  account: ResolvedRingCentralAccount;
  teamId: string;
  members: Array<{ id: string }>;
}): Promise<void> {
  const { account, teamId, members } = params;
  const platform = await getRingCentralPlatform(account);
  await platform.post(`${TM_API_BASE}/teams/${teamId}/remove`, { members });
}

export async function archiveRingCentralTeam(params: {
  account: ResolvedRingCentralAccount;
  teamId: string;
}): Promise<void> {
  const { account, teamId } = params;
  const platform = await getRingCentralPlatform(account);
  await platform.post(`${TM_API_BASE}/teams/${teamId}/archive`, {});
}

export async function unarchiveRingCentralTeam(params: {
  account: ResolvedRingCentralAccount;
  teamId: string;
}): Promise<void> {
  const { account, teamId } = params;
  const platform = await getRingCentralPlatform(account);
  await platform.post(`${TM_API_BASE}/teams/${teamId}/unarchive`, {});
}

export async function probeRingCentral(
  account: ResolvedRingCentralAccount,
): Promise<{ ok: boolean; error?: string; elapsedMs: number }> {
  const start = Date.now();
  try {
    const user = await getCurrentRingCentralUser({ account });
    const elapsedMs = Date.now() - start;
    if (user?.id) {
      return { ok: true, elapsedMs };
    }
    return { ok: false, error: "Unable to fetch current user", elapsedMs };
  } catch (err) {
    const elapsedMs = Date.now() - start;
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      elapsedMs,
    };
  }
}

export async function checkWsSubscriptionPermission(
  account: ResolvedRingCentralAccount,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const platform = await getRingCentralPlatform(account);
    // Attempt a dry-run subscription to check permissions.
    // Creating a real subscription and immediately deleting is too invasive,
    // so we POST and catch the 403/SUB-528 to detect the missing permission.
    const response = await platform.post("/restapi/v1.0/subscription", {
      deliveryMode: { transportType: "WebSocket" },
      eventFilters: ["/restapi/v1.0/glip/posts"],
    });
    // If it succeeds, clean up the test subscription
    const body = await response.json();
    if (body?.id) {
      try {
        await platform.delete(`/restapi/v1.0/subscription/${body.id}`);
      } catch {
        // Best-effort cleanup
      }
    }
    return { ok: true };
  } catch (err) {
    const errStr = String(err);
    if (errStr.includes("SUB-528") || errStr.includes("SubscriptionWebSocket")) {
      return {
        ok: false,
        error: "WebSocket Subscriptions permission not enabled on this app",
      };
    }
    // Other errors (network, auth, etc.) — don't assume permission problem
    return { ok: true };
  }
}
