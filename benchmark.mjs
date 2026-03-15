import { performance } from "perf_hooks";

function normalizeUserId(raw) {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return "";
  return trimmed.toLowerCase();
}

function isSenderAllowedOld(senderId, allowFrom) {
  if (allowFrom.includes("*")) return true;
  const normalizedSenderId = normalizeUserId(senderId);
  return allowFrom.some((entry) => {
    const normalized = String(entry).trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === normalizedSenderId) return true;
    if (normalized.replace(/^(ringcentral|rc):/i, "") === normalizedSenderId) return true;
    if (normalized.replace(/^user:/i, "") === normalizedSenderId) return true;
    return false;
  });
}

function isSenderAllowedNew(senderId, allowFrom) {
  if (allowFrom.includes("*")) return true;
  const normalizedSenderId = normalizeUserId(senderId);

  // Exact match fast path
  if (allowFrom.includes(normalizedSenderId)) return true;

  for (let i = 0; i < allowFrom.length; i++) {
    const normalized = String(allowFrom[i]).trim().toLowerCase();
    if (!normalized) continue;
    if (normalized === normalizedSenderId) return true;
    if (normalized.startsWith("ringcentral:") && normalized.slice(12) === normalizedSenderId) return true;
    if (normalized.startsWith("rc:") && normalized.slice(3) === normalizedSenderId) return true;
    if (normalized.startsWith("user:") && normalized.slice(5) === normalizedSenderId) return true;
  }
  return false;
}

const allowFrom = Array.from({ length: 100 }, (_, i) => `user:other${i}`).concat(["rc:target"]);

const iterations = 100000;

console.log("Warming up...");
for (let i = 0; i < 1000; i++) {
  isSenderAllowedOld("target", allowFrom);
  isSenderAllowedNew("target", allowFrom);
}

const startOld = performance.now();
for (let i = 0; i < iterations; i++) {
  isSenderAllowedOld("target", allowFrom);
}
const endOld = performance.now();

const startNew = performance.now();
for (let i = 0; i < iterations; i++) {
  isSenderAllowedNew("target", allowFrom);
}
const endNew = performance.now();

console.log(`Old: ${endOld - startOld}ms`);
console.log(`New: ${endNew - startNew}ms`);
