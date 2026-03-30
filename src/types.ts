// RingCentral API types — aligned with Team Messaging v1 REST API.

export interface Post {
  id: string;
  groupId: string;
  type: string;
  text: string;
  creatorId: string;
  addedPersonIds?: string[];
  creationTime: string;
  lastModifiedTime: string;
  attachments?: Attachment[];
  mentions?: Mention[];
  eventType?: string;
}

export interface Attachment {
  id: string;
  type: string;
  name?: string;
  contentUri?: string;
  contentType?: string;
  size?: number;
}

export interface Mention {
  id: string;
  type: string; // "Person" | "Team" | "File" | "Event" | "Note" | "Task"
  name?: string;
}

export interface Chat {
  id: string;
  type: string; // "Everyone" | "Personal" | "Direct" | "Group" | "Team"
  name?: string;
  description?: string;
  members?: ChatMember[];
  creationTime?: string;
}

export interface ChatMember {
  id: string;
}

export interface PersonInfo {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  extensionNumber?: string;
  status?: string;
}

export interface ExtensionInfo {
  id: number;
  extensionNumber: string;
  name: string;
}

// Task types
export interface TaskAssignee {
  id: string;
  status?: string;
}

export interface Task {
  id: string;
  subject: string;
  assignees?: TaskAssignee[];
  status?: string;
  startDate?: string;
  dueDate?: string;
  creationTime?: string;
}

export interface CreateTaskRequest {
  subject: string;
  assignees?: TaskAssignee[];
  startDate?: string;
  dueDate?: string;
}

// Event types
export interface Event {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  allDay?: boolean;
  location?: string;
  description?: string;
  creationTime?: string;
}

export interface CreateEventRequest {
  title: string;
  startTime: string;
  endTime: string;
  allDay?: boolean;
  location?: string;
  description?: string;
}

// Note types
export interface Note {
  id: string;
  title: string;
  body?: string;
  status?: string;
  creationTime?: string;
}

export interface CreateNoteRequest {
  title: string;
  body?: string;
}

// Adaptive Card types
export interface AdaptiveCard {
  id: string;
  type: string;
  creationTime?: string;
}

export interface CreateAdaptiveCardRequest {
  type: "AdaptiveCard";
  body: unknown[];
  version?: string;
  actions?: unknown[];
  [key: string]: unknown;
}

// WebSocket types
export interface WSConnectionDetails {
  wsc: {
    token: string;
    sequence: number;
  };
}

export interface WSEvent {
  uuid: string;
  event: string;
  timestamp: string;
  subscriptionId: string;
  ownerId: string;
  body: Post;
}

// Token response
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface WSTokenResponse {
  uri: string;
  ws_access_token: string;
  expires_in: number;
}

// Paginated list
export interface PaginatedRecords<T> {
  records: T[];
  navigation?: {
    prevPageToken?: string;
    nextPageToken?: string;
  };
}

// Config types
export interface RingCentralConfig {
  enabled?: boolean;
  name?: string;
  botToken?: string;
  credentials?: {
    clientId?: string;
    clientSecret?: string;
    jwt?: string;
  };
  server?: string;
  botExtensionId?: string;
  selfOnly?: boolean;
  groupPolicy?: "disabled" | "allowlist" | "open";
  groups?: Record<string, GroupConfig>;
  requireMention?: boolean;
  dm?: {
    policy?: "disabled" | "allowlist" | "pairing" | "open";
    allowFrom?: Array<string | number>;
  };
  textChunkLimit?: number;
  allowBots?: boolean;
  workspace?: string;
  actions?: {
    messages?: boolean;
    channelInfo?: boolean;
    tasks?: boolean;
    events?: boolean;
    notes?: boolean;
  };
}

export interface GroupConfig {
  enabled?: boolean;
  requireMention?: boolean;
  systemPrompt?: string;
  users?: Array<string | number>;
}

export interface ResolvedAccount {
  botToken: string;
  credentials?: {
    clientId: string;
    clientSecret: string;
    jwt: string;
  };
  server: string;
  config: RingCentralConfig;
}
