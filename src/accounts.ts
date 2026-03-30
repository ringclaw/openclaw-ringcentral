// Account resolution: config → env fallback. Single-account only.

import type { RingCentralConfig, ResolvedAccount } from "./types.js";

const DEFAULT_SERVER = "https://platform.ringcentral.com";

export function resolveAccount(channelConfig: RingCentralConfig | undefined): ResolvedAccount {
  const cfg = channelConfig ?? {};
  const botToken = cfg.botToken ?? process.env.RINGCENTRAL_BOT_TOKEN ?? "";
  if (!botToken) {
    throw new Error(
      "RingCentral bot token not configured. Set botToken in config or RINGCENTRAL_BOT_TOKEN env var.",
    );
  }

  const server = cfg.server ?? process.env.RINGCENTRAL_SERVER ?? DEFAULT_SERVER;

  const clientId = cfg.credentials?.clientId ?? process.env.RINGCENTRAL_CLIENT_ID;
  const clientSecret = cfg.credentials?.clientSecret ?? process.env.RINGCENTRAL_CLIENT_SECRET;
  const jwt = cfg.credentials?.jwt ?? process.env.RINGCENTRAL_JWT;

  const credentials =
    clientId && clientSecret && jwt ? { clientId, clientSecret, jwt } : undefined;

  return { botToken, credentials, server, config: cfg };
}

export function isAccountConfigured(channelConfig: RingCentralConfig | undefined): boolean {
  const cfg = channelConfig ?? {};
  return !!(cfg.botToken ?? process.env.RINGCENTRAL_BOT_TOKEN);
}

export function hasPrivateApp(account: ResolvedAccount): boolean {
  return account.credentials !== undefined;
}
