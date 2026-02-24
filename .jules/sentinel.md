## 2026-02-24 - Input Sanitization for RingCentral Target IDs
**Vulnerability:** `normalizeRingCentralTarget` allowed unsafe characters (like `../`, `/`, `?`) in ID strings, which could lead to Path Traversal or API Route Injection if used directly in file paths or URL construction.
**Learning:** Input normalization functions should not only strip prefixes but also enforce a strict allowlist of safe characters (e.g., alphanumeric, `-`, `_`) to prevent injection attacks. Relying on "typical" ID formats without enforcement is risky.
**Prevention:** Always implement strict input validation/sanitization at the boundary where external input enters the system, especially for identifiers used in sensitive contexts like file system access or API calls.
