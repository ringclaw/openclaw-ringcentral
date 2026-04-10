// SSRF guard — validates URLs before fetching external media.

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
]);

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal"];

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(h)) return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

function isPrivateIp(hostname: string): boolean {
  // IPv6 loopback
  if (hostname === "::1" || hostname === "[::1]") return true;

  // IPv4 checks
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map(Number);
  if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return false;

  const [a, b] = nums;
  // 0.0.0.0
  if (a === 0 && b === 0 && nums[2] === 0 && nums[3] === 0) return true;
  // 127.x.x.x (loopback)
  if (a === 127) return true;
  // 10.x.x.x (RFC 1918)
  if (a === 10) return true;
  // 172.16-31.x.x (RFC 1918)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.x.x (RFC 1918)
  if (a === 192 && b === 168) return true;
  // 169.254.x.x (link-local)
  if (a === 169 && b === 254) return true;

  return false;
}

export function validateMediaUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid media URL");
  }

  if (url.protocol !== "https:") {
    throw new Error(`Blocked protocol: ${url.protocol}`);
  }

  const hostname = url.hostname.toLowerCase();

  if (isBlockedHostname(hostname)) {
    throw new Error(`Blocked host: ${hostname}`);
  }

  if (isPrivateIp(hostname)) {
    throw new Error(`Blocked private IP: ${hostname}`);
  }
}
