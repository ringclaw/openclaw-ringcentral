// RingCentral API types — aligned with Team Messaging v1 REST API.

export interface Post {
  id: string;
  groupId: string;
  type: string;
  text: string;
  creatorId: string;
  parentPostId?: string;
  threadId?: string;
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
  uri?: string;
  name?: string;
  fileName?: string;
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
  email?: string;
  name?: string;
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
export interface RingCentralOwnerCredentials {
  clientId?: string;
  clientSecret?: string;
  jwt?: string;
}

export interface ResolvedRingCentralOwnerCredentials {
  clientId: string;
  clientSecret: string;
  jwt: string;
}

export type RingCentralReplyToMode = "off" | "first" | "all";

export interface ProcessingPlaceholderConfig {
  enabled?: boolean;
  initialText?: string;
  delayedText?: string;
  editDelaySeconds?: number;
}

export interface AttachmentDownloadConfig {
  enabled?: boolean;
  maxCount?: number;
  maxBytes?: number;
}

export interface RingCentralConfig {
  enabled?: boolean;
  name?: string;
  botToken?: string;
  ownerCredentials?: RingCentralOwnerCredentials;
  /** @deprecated Use ownerCredentials. */
  credentials?: RingCentralOwnerCredentials;
  server?: string;
  botExtensionId?: string;
  selfOnly?: boolean;
  allowedUserEmails?: string[];
  allowAllUsers?: boolean;
  allowedChannels?: string[];
  ignoredChannels?: string[];
  freeResponseChannels?: string[];
  threadRequireMention?: boolean;
  noThreadChannels?: string[];
  replyToMode?: RingCentralReplyToMode;
  processingPlaceholder?: ProcessingPlaceholderConfig;
  attachments?: AttachmentDownloadConfig;
  debugInboundMessages?: boolean;
  historyMessageLimit?: number;
  homeChannel?: string;
  homeChannelName?: string;
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
    adaptiveCards?: boolean;
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
  ownerCredentials?: ResolvedRingCentralOwnerCredentials;
  /** @deprecated Use ownerCredentials. */
  credentials?: ResolvedRingCentralOwnerCredentials;
  server: string;
  allowedUserEmails: string[];
  allowAllUsers: boolean;
  allowedChannels: string[];
  ignoredChannels: string[];
  freeResponseChannels: string[];
  noThreadChannels: string[];
  replyToMode: RingCentralReplyToMode;
  requireMention: boolean;
  requireMentionExplicit: boolean;
  threadRequireMention: boolean;
  groupPolicy: "disabled" | "allowlist" | "open";
  dmPolicy: "disabled" | "allowlist" | "pairing" | "open";
  textChunkLimit?: number;
  processingPlaceholder: Required<ProcessingPlaceholderConfig>;
  attachments: Required<AttachmentDownloadConfig>;
  debugInboundMessages: boolean;
  historyMessageLimit: number;
  homeChannel?: string;
  homeChannelName?: string;
  config: RingCentralConfig;
}
