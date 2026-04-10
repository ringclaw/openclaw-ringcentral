// Cached owner identity for Self Only mode verification.
// Set once at startup via the private app's extension/~ endpoint.

let cachedOwnerId: string | null = null;

export function setOwnerId(id: string): void {
  cachedOwnerId = id;
}

export function getOwnerId(): string | null {
  return cachedOwnerId;
}

export function clearOwnerId(): void {
  cachedOwnerId = null;
}
