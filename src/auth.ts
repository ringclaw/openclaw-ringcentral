// JWT authentication for Private App (optional read client).
// Inspired by RingClaw auth.go — direct fetch, no SDK dependency.

import type { TokenResponse, WSTokenResponse } from "./types.js";

export interface AuthState {
  accessToken: string;
  expiresAt: number;
}

let cachedAuth: AuthState | null = null;
let refreshPromise: Promise<AuthState> | null = null;

export function invalidateToken(): void {
  cachedAuth = null;
}

export async function getAccessToken(
  serverUrl: string,
  clientId: string,
  clientSecret: string,
  jwt: string,
): Promise<string> {
  if (cachedAuth && Date.now() < cachedAuth.expiresAt - 60_000) {
    return cachedAuth.accessToken;
  }
  if (refreshPromise) return (await refreshPromise).accessToken;

  refreshPromise = refreshToken(serverUrl, clientId, clientSecret, jwt);
  try {
    cachedAuth = await refreshPromise;
    return cachedAuth.accessToken;
  } finally {
    refreshPromise = null;
  }
}

async function refreshToken(
  serverUrl: string,
  clientId: string,
  clientSecret: string,
  jwt: string,
): Promise<AuthState> {
  const url = `${serverUrl}/restapi/oauth/token`;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token request failed HTTP ${resp.status}: ${text}`);
  }
  const data = (await resp.json()) as TokenResponse;
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export async function getWSToken(
  serverUrl: string,
  accessToken: string,
): Promise<WSTokenResponse> {
  const url = `${serverUrl}/restapi/oauth/wstoken`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (resp.status === 401) {
    invalidateToken();
    throw new Error("Token expired, invalidated for retry");
  }
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`WS token request failed HTTP ${resp.status}: ${text}`);
  }
  return (await resp.json()) as WSTokenResponse;
}

export async function getBotWSToken(
  serverUrl: string,
  botToken: string,
): Promise<WSTokenResponse> {
  const url = `${serverUrl}/restapi/oauth/wstoken`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${botToken}` },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Bot WS token request failed HTTP ${resp.status}: ${text}`);
  }
  return (await resp.json()) as WSTokenResponse;
}
