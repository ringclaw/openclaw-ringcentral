// Account resolution: config plus RC_* environment variables. Single-account only.

import type {
  ProcessingPlaceholderConfig,
  ResolvedAccount,
  ResolvedRingCentralOwnerCredentials,
  RingCentralConversationIdentity,
  RingCentralDmPolicy,
  RingCentralGroupDmConfig,
  RingCentralGroupPolicy,
  RingCentralTeamConfig,
  RingCentralConfig,
  RingCentralOwnerCredentials,
  RingCentralReplyToMode,
} from "./types.js";

export const DEFAULT_SERVER = "https://platform.ringcentral.com";
export const DEFAULT_HISTORY_MESSAGE_LIMIT = 250;
export const MAX_HISTORY_MESSAGE_LIMIT = 1000;
export const DEFAULT_ATTACHMENT_MAX_COUNT = 5;
export const DEFAULT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENT_MAX_COUNT = 20;
export const MAX_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;

const DEFAULT_PROCESSING_PLACEHOLDER: Required<ProcessingPlaceholderConfig> = {
  enabled: false,
  initialText: "👀",
  delayedText: "⏳",
  editDelaySeconds: 2,
};

const LEGACY_CONFIG_FIELDS: Record<string, string> = {
  allowedUserEmails: "allowFrom",
  allowAllUsers: 'dmPolicy: "open" with allowFrom: ["*"]',
  allowedChannels: "teams",
  ignoredChannels: "teams",
  freeResponseChannels: "teams.*.requireMention=false",
  groups: "teams",
};

const LEGACY_DM_FIELDS: Record<string, string> = {
  policy: "dmPolicy",
  allowFrom: "allowFrom",
};

const LEGACY_ENV_FIELDS: Record<string, string> = {
  RC_ALLOWED_USER_EMAILS: "RC_ALLOW_FROM",
  RC_ALLOW_ALL_USERS: 'RC_DM_POLICY=open and RC_ALLOW_FROM="*"',
  RC_ALLOWED_CHANNELS: "RC_TEAMS",
  RC_IGNORED_CHANNELS: "RC_TEAMS",
  RC_FREE_RESPONSE_CHANNELS: "RC_TEAMS",
};

function readEnv(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(
  value: unknown,
  fallback: boolean,
  envName?: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = value ?? (envName ? readEnv(envName, env) : undefined);
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  if (typeof raw === "boolean") {
    return raw;
  }
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function readNumber(
  value: unknown,
  fallback: number,
  envName?: string,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = value ?? (envName ? readEnv(envName, env) : undefined);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function readDelimitedEntries(
  value: unknown,
  envName?: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = value ?? (envName ? readEnv(envName, env) : undefined);
  if (Array.isArray(raw)) {
    return raw.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof raw !== "string") {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeAllowFrom(entries: Array<string | number> | string[]): string[] {
  return Array.from(new Set(entries.map((entry) => String(entry).trim()).filter(Boolean)));
}

function readPolicy<T extends string>(
  value: unknown,
  envName: string,
  env: NodeJS.ProcessEnv,
  fallback: T,
  allowed: readonly T[],
): T {
  const raw = String(value ?? readEnv(envName, env) ?? fallback).trim();
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function readRecordEnv<T extends Record<string, unknown>>(
  envName: string,
  env: NodeJS.ProcessEnv,
): T | undefined {
  const raw = readEnv(envName, env);
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as T)
      : undefined;
  } catch {
    throw new Error(`${envName} must be a JSON object.`);
  }
}

function assertNoLegacyConfig(cfg: RingCentralConfig): void {
  for (const [field, replacement] of Object.entries(LEGACY_CONFIG_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(cfg, field)) {
      throw new Error(
        `Legacy RingCentral config field "${field}" is no longer supported. Use "${replacement}" instead.`,
      );
    }
  }
  const dm = cfg.dm as Record<string, unknown> | undefined;
  if (dm) {
    for (const [field, replacement] of Object.entries(LEGACY_DM_FIELDS)) {
      if (Object.prototype.hasOwnProperty.call(dm, field)) {
        throw new Error(
          `Legacy RingCentral config field "dm.${field}" is no longer supported. Use "${replacement}" instead.`,
        );
      }
    }
  }
}

function assertNoLegacyEnv(env: NodeJS.ProcessEnv): void {
  for (const [name, replacement] of Object.entries(LEGACY_ENV_FIELDS)) {
    if (readEnv(name, env) !== undefined) {
      throw new Error(`Legacy RingCentral env "${name}" is no longer supported. Use "${replacement}" instead.`);
    }
  }
}

function resolveTeams(
  cfg: RingCentralConfig,
  env: NodeJS.ProcessEnv,
): Record<string, RingCentralTeamConfig> | undefined {
  const envTeams = readRecordEnv<Record<string, RingCentralTeamConfig>>("RC_TEAMS", env);
  const teams = cfg.teams ?? envTeams;
  const teamRequireMention = readEnv("RC_TEAM_REQUIRE_MENTION", env);
  if (teamRequireMention === undefined) {
    return teams;
  }
  return {
    ...(teams ?? {}),
    "*": {
      ...(teams?.["*"] ?? {}),
      requireMention: readBoolean(undefined, true, "RC_TEAM_REQUIRE_MENTION", env),
    },
  };
}

function resolveGroupDmChannels(
  cfg: RingCentralConfig,
  env: NodeJS.ProcessEnv,
): Record<string, RingCentralGroupDmConfig> {
  return cfg.dm?.groupChannels ?? readRecordEnv<Record<string, RingCentralGroupDmConfig>>("RC_GROUP_DM_CHANNELS", env) ?? {};
}

function resolveOwnerCredentials(
  cfg: RingCentralConfig,
  env: NodeJS.ProcessEnv,
): ResolvedRingCentralOwnerCredentials | undefined {
  const source: RingCentralOwnerCredentials | undefined =
    cfg.ownerCredentials ?? cfg.credentials;
  const clientId = source?.clientId ?? readEnv("RC_USER_CLIENT_ID", env);
  const clientSecret = source?.clientSecret ?? readEnv("RC_USER_CLIENT_SECRET", env);
  const jwt = source?.jwt ?? readEnv("RC_USER_JWT_TOKEN", env);
  return clientId && clientSecret && jwt ? { clientId, clientSecret, jwt } : undefined;
}

function resolveReplyToMode(raw: unknown, env: NodeJS.ProcessEnv): RingCentralReplyToMode {
  const mode = String(raw ?? readEnv("RC_REPLY_TO_MODE", env) ?? "first").trim().toLowerCase();
  return mode === "off" || mode === "all" || mode === "first" ? mode : "first";
}

function resolveProcessingPlaceholder(
  cfg: RingCentralConfig,
  env: NodeJS.ProcessEnv,
): Required<ProcessingPlaceholderConfig> {
  const placeholder = cfg.processingPlaceholder ?? {};
  return {
    enabled: readBoolean(
      placeholder.enabled,
      DEFAULT_PROCESSING_PLACEHOLDER.enabled,
      "RC_PROCESSING_EMOJI_ENABLED",
      env,
    ),
    initialText: placeholder.initialText ?? DEFAULT_PROCESSING_PLACEHOLDER.initialText,
    delayedText: placeholder.delayedText ?? DEFAULT_PROCESSING_PLACEHOLDER.delayedText,
    editDelaySeconds: clampInteger(
      readNumber(
        placeholder.editDelaySeconds,
        DEFAULT_PROCESSING_PLACEHOLDER.editDelaySeconds,
        "RC_PROCESSING_EMOJI_EDIT_DELAY_SECONDS",
        env,
      ),
      0,
      60,
    ),
  };
}

function resolveAttachmentDownloads(
  cfg: RingCentralConfig,
  env: NodeJS.ProcessEnv,
): ResolvedAccount["attachments"] {
  const attachments = cfg.attachments ?? {};
  return {
    enabled: readBoolean(attachments.enabled, true, "RC_ATTACHMENT_DOWNLOAD_ENABLED", env),
    maxCount: clampInteger(
      readNumber(attachments.maxCount, DEFAULT_ATTACHMENT_MAX_COUNT, "RC_ATTACHMENT_MAX_COUNT", env),
      0,
      MAX_ATTACHMENT_MAX_COUNT,
    ),
    maxBytes: clampInteger(
      readNumber(attachments.maxBytes, DEFAULT_ATTACHMENT_MAX_BYTES, "RC_ATTACHMENT_MAX_BYTES", env),
      1,
      MAX_ATTACHMENT_MAX_BYTES,
    ),
  };
}

export function getRcConfig(cfg: unknown): RingCentralConfig {
  const channels = (cfg as Record<string, unknown> | undefined)?.channels as
    | Record<string, unknown>
    | undefined;
  return (channels?.ringcentral ?? {}) as RingCentralConfig;
}

export function resolveAccount(
  channelConfig: RingCentralConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedAccount {
  const cfg = channelConfig ?? {};
  assertNoLegacyConfig(cfg);
  assertNoLegacyEnv(env);
  const conversationIdentity = readPolicy<RingCentralConversationIdentity>(
    cfg.conversationIdentity,
    "RC_CONVERSATION_IDENTITY",
    env,
    "bot",
    ["bot", "user"],
  );
  const botToken = cfg.botToken ?? readEnv("RC_BOT_TOKEN", env) ?? "";
  const ownerCredentials = resolveOwnerCredentials(cfg, env);
  if (conversationIdentity === "bot") {
    if (!botToken) {
      throw new Error("RingCentral bot token not configured. Set botToken in config or RC_BOT_TOKEN.");
    }
  } else if (!ownerCredentials) {
    throw new Error(
      'RingCentral conversationIdentity="user" requires ownerCredentials (or RC_USER_CLIENT_ID / RC_USER_CLIENT_SECRET / RC_USER_JWT_TOKEN).',
    );
  }
  const allowFrom = normalizeAllowFrom(
    cfg.allowFrom ?? readDelimitedEntries(undefined, "RC_ALLOW_FROM", env),
  );
  const dmPolicy = readPolicy<RingCentralDmPolicy>(
    cfg.dmPolicy,
    "RC_DM_POLICY",
    env,
    "pairing",
    ["disabled", "allowlist", "pairing", "open"],
  );
  if (dmPolicy === "open" && !allowFrom.includes("*")) {
    throw new Error('RingCentral dmPolicy="open" requires allowFrom to include "*".');
  }
  const groupPolicy = readPolicy<RingCentralGroupPolicy>(
    cfg.groupPolicy,
    "RC_GROUP_POLICY",
    env,
    "disabled",
    ["disabled", "allowlist", "open"],
  );

  const historyMessageLimit = clampInteger(
    readNumber(cfg.historyMessageLimit, DEFAULT_HISTORY_MESSAGE_LIMIT, "RC_HISTORY_MESSAGE_LIMIT", env),
    1,
    MAX_HISTORY_MESSAGE_LIMIT,
  );
  const requireMentionEnv = readEnv("RC_REQUIRE_MENTION", env);
  const requireMention = readBoolean(cfg.requireMention, true, "RC_REQUIRE_MENTION", env);

  return {
    botToken,
    ownerCredentials,
    credentials: ownerCredentials,
    conversationIdentity,
    server: cfg.server ?? readEnv("RC_SERVER_URL", env) ?? DEFAULT_SERVER,
    allowFrom,
    dangerouslyAllowEmailMatching: readBoolean(cfg.dangerouslyAllowEmailMatching, false, undefined, env),
    groupDmEnabled: readBoolean(cfg.dm?.groupEnabled, false, "RC_GROUP_DM_ENABLED", env),
    groupDmChannels: resolveGroupDmChannels(cfg, env),
    noThreadChannels: readDelimitedEntries(cfg.noThreadChannels, "RC_NO_THREAD_CHANNELS", env),
    replyToMode: resolveReplyToMode(cfg.replyToMode, env),
    requireMention,
    requireMentionExplicit: cfg.requireMention !== undefined || requireMentionEnv !== undefined,
    threadRequireMention: readBoolean(cfg.threadRequireMention, true, "RC_THREAD_REQUIRE_MENTION", env),
    groupPolicy,
    dmPolicy,
    textChunkLimit: cfg.textChunkLimit,
    processingPlaceholder: resolveProcessingPlaceholder(cfg, env),
    attachments: resolveAttachmentDownloads(cfg, env),
    debugInboundMessages: readBoolean(cfg.debugInboundMessages, false, "RC_DEBUG_INBOUND_MESSAGES", env),
    historyMessageLimit,
    homeChannel: cfg.homeChannel ?? readEnv("RC_HOME_CHANNEL", env),
    homeChannelName: cfg.homeChannelName ?? readEnv("RC_HOME_CHANNEL_NAME", env),
    config: { ...cfg, teams: resolveTeams(cfg, env) },
  };
}

export function isAccountConfigured(
  channelConfig: RingCentralConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const cfg = channelConfig ?? {};
  if (cfg.botToken ?? readEnv("RC_BOT_TOKEN", env)) {
    return true;
  }
  return resolveOwnerCredentials(cfg, env) !== undefined;
}

export function hasOwnerCredentials(account: ResolvedAccount): boolean {
  return account.ownerCredentials !== undefined;
}

/** @deprecated Use hasOwnerCredentials. */
export const hasPrivateApp = hasOwnerCredentials;
