import { z } from "zod";

import {
  BlockStreamingCoalesceSchema,
  DmPolicySchema,
  GroupPolicySchema,
  MarkdownConfigSchema,
  requireOpenAllowFrom,
} from "openclaw/plugin-sdk";

const RingCentralGroupToolPolicySchema = z
  .object({
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
  })
  .strict();

const RingCentralGroupConfigSchema = z
  .object({
    requireMention: z.boolean().optional(),
    enabled: z.boolean().optional(),
    users: z.array(z.union([z.string(), z.number()])).optional(),
    systemPrompt: z.string().optional(),
    tools: RingCentralGroupToolPolicySchema.optional(),
  })
  .strict();

const RingCentralCredentialsSchema = z
  .object({
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    jwt: z.string().optional(),
    server: z.string().optional(),
  })
  .strict();

const RingCentralDmConfigSchema = z
  .object({
    policy: DmPolicySchema.optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const RingCentralActionsConfigSchema = z
  .object({
    messages: z.boolean().optional(),
    channelInfo: z.boolean().optional(),
    tasks: z.boolean().optional(),
    events: z.boolean().optional(),
    notes: z.boolean().optional(),
  })
  .strict();

const RingCentralAccountSchemaBase = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    credentials: RingCentralCredentialsSchema.optional(),
    markdown: MarkdownConfigSchema,
    // DM configuration (nested object - preferred)
    dm: RingCentralDmConfigSchema.optional(),
    // Legacy flat DM fields (deprecated, use dm.* instead)
    dmPolicy: DmPolicySchema.optional().default("allowlist"),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    // Group configuration
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    groups: z.record(z.string(), RingCentralGroupConfigSchema.optional()).optional(),
    requireMention: z.boolean().optional(),
    // Message handling
    mediaMaxMb: z.number().int().positive().optional(),
    textChunkLimit: z.number().int().positive().optional(),
    chunkMode: z.enum(["length", "newline"]).optional(),
    blockStreaming: z.boolean().optional(),
    blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
    // Bot settings
    allowBots: z.boolean().optional(),
    botExtensionId: z.string().optional(),
    selfOnly: z.boolean().optional(),
    useAdaptiveCards: z.boolean().optional(),
    // Security
    dangerouslyAllowNameMatching: z.boolean().optional(),
    // Threading
    replyToMode: z.enum(["off", "all"]).optional(),
    // Actions configuration
    actions: RingCentralActionsConfigSchema.optional(),
    // Workspace
    workspace: z.string().optional(),
  })
  .strict();

const RingCentralAccountSchema = RingCentralAccountSchemaBase.superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message:
      'channels.ringcentral.dmPolicy="open" requires channels.ringcentral.allowFrom to include "*"',
  });
});

export const RingCentralConfigSchema = RingCentralAccountSchemaBase.extend({
  accounts: z.record(z.string(), RingCentralAccountSchema.optional()).optional(),
  defaultAccount: z.string().optional(),
}).superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message:
      'channels.ringcentral.dmPolicy="open" requires channels.ringcentral.allowFrom to include "*"',
  });
});

export type { RingCentralAccountConfig, RingCentralConfig } from "./types.js";
