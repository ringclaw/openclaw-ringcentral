import { z } from "zod/v4";

const allowFromEntrySchema = z.union([z.string(), z.number()]);

const teamConfigSchema = z.object({
  allow: z.boolean().optional(),
  requireMention: z.boolean().optional(),
  systemPrompt: z.string().optional(),
  users: z.array(allowFromEntrySchema).optional(),
});

const groupDmConfigSchema = teamConfigSchema;

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

const dmSchema = z
  .object({
    groupEnabled: z.boolean().optional(),
    groupChannels: z.record(z.string(), groupDmConfigSchema).optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    rejectLegacyField(value, ctx, "policy", "dmPolicy");
    rejectLegacyField(value, ctx, "allowFrom", "allowFrom");
  });

const actionsSchema = z.object({
  messages: z.boolean().optional(),
  channelInfo: z.boolean().optional(),
  tasks: z.boolean().optional(),
  events: z.boolean().optional(),
  notes: z.boolean().optional(),
  adaptiveCards: z.boolean().optional(),
});

const legacyTopLevelFields: Record<string, string> = {
  allowedUserEmails: "allowFrom",
  allowAllUsers: 'dmPolicy: "open" with allowFrom: ["*"]',
  allowedChannels: "teams",
  ignoredChannels: "teams",
  freeResponseChannels: "teams.*.requireMention=false",
  groups: "teams",
};

function rejectLegacyField(
  value: Record<string, unknown>,
  ctx: z.RefinementCtx,
  field: string,
  replacement: string,
): void {
  if (Object.prototype.hasOwnProperty.call(value, field)) {
    ctx.addIssue({
      code: "custom",
      path: [field],
      message: `Legacy RingCentral config field "${field}" is no longer supported. Use "${replacement}" instead.`,
    });
  }
}

export const ringCentralConfigSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().optional(),
  botToken: z.string().optional(),
  ownerCredentials: credentialsSchema.optional(),
  credentials: credentialsSchema.optional(),
  server: z.string().optional(),
  botExtensionId: z.string().optional(),
  selfOnly: z.boolean().optional(),
  dmPolicy: z.enum(["disabled", "allowlist", "pairing", "open"]).optional(),
  allowFrom: z.array(allowFromEntrySchema).optional(),
  dangerouslyAllowEmailMatching: z.boolean().optional(),
  groupPolicy: z.enum(["disabled", "allowlist", "open"]).optional(),
  teams: z.record(z.string(), teamConfigSchema).optional(),
  dm: dmSchema.optional(),
  threadRequireMention: z.boolean().optional(),
  noThreadChannels: stringListSchema,
  replyToMode: z.enum(["off", "first", "all"]).optional(),
  processingPlaceholder: processingPlaceholderSchema.optional(),
  attachments: attachmentsSchema.optional(),
  debugInboundMessages: z.boolean().optional(),
  historyMessageLimit: z.number().int().min(1).max(1000).optional(),
  homeChannel: z.string().optional(),
  homeChannelName: z.string().optional(),
  requireMention: z.boolean().optional(),
  textChunkLimit: z.number().int().min(1).optional(),
  allowBots: z.boolean().optional(),
  workspace: z.string().optional(),
  actions: actionsSchema.optional(),
}).passthrough().superRefine((value, ctx) => {
  for (const [field, replacement] of Object.entries(legacyTopLevelFields)) {
    rejectLegacyField(value, ctx, field, replacement);
  }
  if (value.dmPolicy === "open") {
    const allowFrom = value.allowFrom ?? [];
    if (!allowFrom.some((entry) => String(entry).trim() === "*")) {
      ctx.addIssue({
        code: "custom",
        path: ["allowFrom"],
        message: 'RingCentral dmPolicy="open" requires allowFrom to include "*".',
      });
    }
  }
});
