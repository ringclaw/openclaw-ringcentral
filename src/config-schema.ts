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
});

export const ringCentralConfigSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().optional(),
  botToken: z.string().optional(),
  credentials: credentialsSchema.optional(),
  server: z.string().optional(),
  botExtensionId: z.string().optional(),
  selfOnly: z.boolean().optional(),
  groupPolicy: z.enum(["disabled", "allowlist", "open"]).optional(),
  groups: z.record(z.string(), groupConfigSchema).optional(),
  requireMention: z.boolean().optional(),
  dm: dmSchema.optional(),
  textChunkLimit: z.number().int().min(1).optional(),
  allowBots: z.boolean().optional(),
  workspace: z.string().optional(),
  actions: actionsSchema.optional(),
});
