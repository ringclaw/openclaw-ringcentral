import { z } from "zod/v4";

const groupConfigSchema = z.object({
  enabled: z.boolean().optional(),
  requireMention: z.boolean().optional(),
  systemPrompt: z.string().optional(),
  users: z.array(z.union([z.string(), z.number()])).optional(),
});

const credentialsSchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  jwt: z.string().optional(),
});

const stringListSchema = z.array(z.string()).optional();

const processingPlaceholderSchema = z.object({
  enabled: z.boolean().optional(),
  initialText: z.string().optional(),
  delayedText: z.string().optional(),
  editDelaySeconds: z.number().int().min(0).max(60).optional(),
});

const attachmentsSchema = z.object({
  enabled: z.boolean().optional(),
  maxCount: z.number().int().min(0).max(20).optional(),
  maxBytes: z.number().int().min(1).max(100 * 1024 * 1024).optional(),
});

const dmSchema = z.object({
  policy: z.enum(["disabled", "allowlist", "pairing", "open"]).optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
});

const actionsSchema = z.object({
  messages: z.boolean().optional(),
  channelInfo: z.boolean().optional(),
  tasks: z.boolean().optional(),
  events: z.boolean().optional(),
  notes: z.boolean().optional(),
  adaptiveCards: z.boolean().optional(),
});

export const ringCentralConfigSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().optional(),
  botToken: z.string().optional(),
  ownerCredentials: credentialsSchema.optional(),
  credentials: credentialsSchema.optional(),
  server: z.string().optional(),
  botExtensionId: z.string().optional(),
  selfOnly: z.boolean().optional(),
  allowedUserEmails: stringListSchema,
  allowAllUsers: z.boolean().optional(),
  allowedChannels: stringListSchema,
  ignoredChannels: stringListSchema,
  freeResponseChannels: stringListSchema,
  threadRequireMention: z.boolean().optional(),
  noThreadChannels: stringListSchema,
  replyToMode: z.enum(["off", "first", "all"]).optional(),
  processingPlaceholder: processingPlaceholderSchema.optional(),
  attachments: attachmentsSchema.optional(),
  historyMessageLimit: z.number().int().min(1).max(1000).optional(),
  homeChannel: z.string().optional(),
  homeChannelName: z.string().optional(),
  groupPolicy: z.enum(["disabled", "allowlist", "open"]).optional(),
  groups: z.record(z.string(), groupConfigSchema).optional(),
  requireMention: z.boolean().optional(),
  dm: dmSchema.optional(),
  textChunkLimit: z.number().int().min(1).optional(),
  allowBots: z.boolean().optional(),
  workspace: z.string().optional(),
  actions: actionsSchema.optional(),
});
