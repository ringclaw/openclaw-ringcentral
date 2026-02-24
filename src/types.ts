import type { DmPolicy, GroupPolicy, MarkdownConfig } from "openclaw/plugin-sdk";

// RingCentral Team Messaging API types

export type RingCentralUser = {
  id?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
};

export type RingCentralCompany = {
  id?: string;
  name?: string;
  domain?: string;
  creationTime?: string;
  lastModifiedTime?: string;
};

export type RingCentralChat = {
  id?: string;
  name?: string;
  description?: string;
  type?: "Everyone" | "Team" | "Group" | "Personal" | "Direct" | "PersonalChat";
  status?: "Active" | "Archived";
  members?: string[];
  isPublic?: boolean;
  creationTime?: string;
  lastModifiedTime?: string;
};

export type RingCentralConversation = {
  id?: string;
  type?: "Direct" | "Personal" | "Group";
  members?: Array<{ id?: string }>;
  creationTime?: string;
  lastModifiedTime?: string;
};

export type RingCentralNote = {
  id?: string;
  chatId?: string;
  creatorId?: string;
  title?: string;
  body?: string;
  status?: "Active" | "Draft";
  lockedBy?: { id?: string };
  type?: "Note";
  creationTime?: string;
  lastModifiedTime?: string;
};

export type RingCentralWebhook = {
  id?: string;
  creatorId?: string;
  chatIds?: string[];
  uri?: string;
  status?: "Active" | "Suspended" | "Frozen";
  creationTime?: string;
  lastModifiedTime?: string;
};

export type RingCentralTeam = {
  id?: string;
  name?: string;
  description?: string;
  type?: "Team";
  status?: "Active" | "Archived";
  isPublic?: boolean;
  creatorId?: string;
  members?: Array<{ id?: string; email?: string }>;
  creationTime?: string;
  lastModifiedTime?: string;
};

export type RingCentralEvent = {
  id?: string;
  chatId?: string;
  creatorId?: string;
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
  creationTime?: string;
  lastModifiedTime?: string;
};

export type RingCentralTask = {
  id?: string;
  chatId?: string;
  creatorId?: string;
  subject?: string;
  assignees?: Array<{ id?: string }>;
  completenessCondition?: "Simple" | "AllAssignees" | "Percentage";
  completenessPercentage?: number;
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
  attachments?: RingCentralAttachment[];
  status?: "Pending" | "InProgress" | "Completed";
  creationTime?: string;
  lastModifiedTime?: string;
};

export type RingCentralPost = {
  id?: string;
  groupId?: string;
  type?: "TextMessage" | "PersonJoined" | "PersonsAdded";
  text?: string;
  creatorId?: string;
  addedPersonIds?: string[];
  creationTime?: string;
  lastModifiedTime?: string;
  attachments?: RingCentralAttachment[];
  activity?: string;
  title?: string;
  iconUri?: string;
  iconEmoji?: string;
  mentions?: RingCentralMention[];
};

export type RingCentralAttachment = {
  id?: string;
  type?: string;
  name?: string;
  contentUri?: string;
  contentType?: string;
  size?: number;
};

export type RingCentralMention = {
  id?: string;
  type?: "Person" | "Team" | "File" | "Link" | "Event" | "Task" | "Note" | "Card";
  name?: string;
};

// Adaptive Cards types (Microsoft Adaptive Card schema v1.3)
export type RingCentralAdaptiveCardElement = {
  type: string;
  text?: string;
  size?: "Small" | "Default" | "Medium" | "Large" | "ExtraLarge";
  weight?: "Lighter" | "Default" | "Bolder";
  color?: "Default" | "Dark" | "Light" | "Accent" | "Good" | "Warning" | "Attention";
  wrap?: boolean;
  url?: string;
  altText?: string;
  columns?: RingCentralAdaptiveCardElement[];
  items?: RingCentralAdaptiveCardElement[];
  width?: string | number;
  style?: string;
  isVisible?: boolean;
  id?: string;
  // Input elements
  label?: string;
  placeholder?: string;
  value?: string;
  isRequired?: boolean;
  // Action elements
  title?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

export type RingCentralAdaptiveCardAction = {
  type: "Action.Submit" | "Action.OpenUrl" | "Action.ShowCard" | "Action.ToggleVisibility";
  title?: string;
  url?: string;
  data?: Record<string, unknown>;
  card?: RingCentralAdaptiveCard;
  targetElements?: Array<string | { elementId: string; isVisible?: boolean }>;
};

export type RingCentralAdaptiveCard = {
  type?: "AdaptiveCard";
  $schema?: string;
  version?: string;
  body?: RingCentralAdaptiveCardElement[];
  actions?: RingCentralAdaptiveCardAction[];
  fallbackText?: string;
  speak?: string;
  lang?: string;
  verticalContentAlignment?: "Top" | "Center" | "Bottom";
  backgroundImage?: string | { url: string; fillMode?: string };
  minHeight?: string;
};

export type RingCentralWebhookEvent = {
  uuid?: string;
  event?: string;
  timestamp?: string;
  subscriptionId?: string;
  ownerId?: string;
  body?: RingCentralEventBody;
};

export type RingCentralEventBody = {
  id?: string;
  groupId?: string;
  type?: string;
  text?: string;
  creatorId?: string;
  eventType?: "PostAdded" | "PostChanged" | "PostRemoved" | "GroupJoined" | "GroupLeft" | "GroupChanged";
  creationTime?: string;
  lastModifiedTime?: string;
  attachments?: RingCentralAttachment[];
  mentions?: RingCentralMention[];
  name?: string;
  members?: string[];
  status?: string;
};

// Config types

export type RingCentralGroupToolPolicy = {
  allow?: string[];
  deny?: string[];
};

export type RingCentralGroupConfig = {
  requireMention?: boolean;
  enabled?: boolean;
  users?: Array<string | number>;
  systemPrompt?: string;
  tools?: RingCentralGroupToolPolicy;
};

export type RingCentralCredentials = {
  clientId?: string;
  clientSecret?: string;
  jwt?: string;
  server?: string;
};

export type RingCentralActionsConfig = {
  messages?: boolean;
  channelInfo?: boolean;
  tasks?: boolean;
  events?: boolean;
  notes?: boolean;
};

export type RingCentralAccountConfig = {
  enabled?: boolean;
  name?: string;
  credentials?: RingCentralCredentials;
  markdown?: MarkdownConfig;
  dmPolicy?: DmPolicy;
  allowFrom?: Array<string | number>;
  dm?: { policy?: DmPolicy; allowFrom?: Array<string | number>; enabled?: boolean };
  groupPolicy?: GroupPolicy;
  groups?: Record<string, RingCentralGroupConfig>;
  groupAllowFrom?: Array<string | number>;
  requireMention?: boolean;
  mediaMaxMb?: number;
  textChunkLimit?: number;
  chunkMode?: "length" | "newline";
  blockStreaming?: boolean;
  blockStreamingCoalesce?: { minChars?: number; idleMs?: number };
  allowBots?: boolean;
  botExtensionId?: string;
  replyToMode?: "off" | "all";
  selfOnly?: boolean; // JWT mode: only accept messages from the JWT user in Personal chat (default: true)
  useAdaptiveCards?: boolean; // Use Adaptive Cards for messages with code blocks (default: false)
  dangerouslyAllowNameMatching?: boolean; // Allow name-based allowFrom matching (insecure, default: false)
  workspace?: string; // Path to workspace for storing group chat messages
  actions?: RingCentralActionsConfig; // Action permissions for message operations
};

export type RingCentralConfig = RingCentralAccountConfig & {
  accounts?: Record<string, RingCentralAccountConfig>;
  defaultAccount?: string;
};
