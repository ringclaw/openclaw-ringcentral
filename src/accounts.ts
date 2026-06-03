// Account resolution: config plus RC_* environment variables. Single-account only.

import type {
  ProcessingPlaceholderConfig,
  ResolvedAccount,
  ResolvedRingCentralOwnerCredentials,
  RingCentralConfig,
  RingCentralOwnerCredentials,
  RingCentralReplyToMode,
} from "./types.js";

export const DEFAULT_SERVER = "https://platform.ringcentral.com";
export const DEFAULT_HISTORY_MESSAGE_LIMIT = 250;
export const MAX_HISTORY_MESSAGE_LIMIT = 1000;

const DEFAULT_PROCESSING_PLACEHOLDER: Required<ProcessingPlaceholderConfig> = {
  enabled: true,
  initialText: "👀",
  delayedText: "⏳",
  editDelaySeconds: 2,
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

function normalizeEmails(entries: string[]): string[] {
  return Array.from(new Set(entries.map((entry) => entry.toLowerCase())));
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
  const botToken = cfg.botToken ?? readEnv("RC_BOT_TOKEN", env) ?? "";
  if (!botToken) {
    throw new Error("RingCentral bot token not configured. Set botToken in config or RC_BOT_TOKEN.");
  }

  const ownerCredentials = resolveOwnerCredentials(cfg, env);
  const allowedUserEmails = normalizeEmails(
    readDelimitedEntries(cfg.allowedUserEmails, "RC_ALLOWED_USER_EMAILS", env),
  );
  const allowAllUsers = readBoolean(cfg.allowAllUsers, false, "RC_ALLOW_ALL_USERS", env);
  const dmPolicy =
    cfg.dm?.policy ??
    (ownerCredentials && !allowAllUsers && allowedUserEmails.length === 0 && !cfg.dm?.allowFrom?.length
      ? "allowlist"
      : "open");

  const historyMessageLimit = clampInteger(
    readNumber(cfg.historyMessageLimit, DEFAULT_HISTORY_MESSAGE_LIMIT, "RC_HISTORY_MESSAGE_LIMIT", env),
    1,
    MAX_HISTORY_MESSAGE_LIMIT,
  );

  return {
    botToken,
    ownerCredentials,
    credentials: ownerCredentials,
    server: cfg.server ?? readEnv("RC_SERVER_URL", env) ?? DEFAULT_SERVER,
    allowedUserEmails,
    allowAllUsers,
    allowedChannels: readDelimitedEntries(cfg.allowedChannels, "RC_ALLOWED_CHANNELS", env),
    ignoredChannels: readDelimitedEntries(cfg.ignoredChannels, "RC_IGNORED_CHANNELS", env),
    freeResponseChannels: readDelimitedEntries(cfg.freeResponseChannels, "RC_FREE_RESPONSE_CHANNELS", env),
    noThreadChannels: readDelimitedEntries(cfg.noThreadChannels, "RC_NO_THREAD_CHANNELS", env),
    replyToMode: resolveReplyToMode(cfg.replyToMode, env),
    requireMention: readBoolean(cfg.requireMention, true, "RC_REQUIRE_MENTION", env),
    threadRequireMention: readBoolean(cfg.threadRequireMention, true, "RC_THREAD_REQUIRE_MENTION", env),
    groupPolicy: cfg.groupPolicy ?? "disabled",
    dmPolicy,
    textChunkLimit: cfg.textChunkLimit,
    processingPlaceholder: resolveProcessingPlaceholder(cfg, env),
    historyMessageLimit,
    homeChannel: cfg.homeChannel ?? readEnv("RC_HOME_CHANNEL", env),
    homeChannelName: cfg.homeChannelName ?? readEnv("RC_HOME_CHANNEL_NAME", env),
    config: cfg,
  };
}

export function isAccountConfigured(
  channelConfig: RingCentralConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const cfg = channelConfig ?? {};
  return !!(cfg.botToken ?? readEnv("RC_BOT_TOKEN", env));
}

export function hasOwnerCredentials(account: ResolvedAccount): boolean {
  return account.ownerCredentials !== undefined;
}

/** @deprecated Use hasOwnerCredentials. */
export const hasPrivateApp = hasOwnerCredentials;
