## 2025-05-20 - Unbounded File Downloads
**Vulnerability:** The `downloadRingCentralAttachment` function defaulted to buffering the entire response into memory (`response.arrayBuffer()`) when the optional `maxBytes` parameter was omitted.
**Learning:** Optional security parameters often lead to insecure defaults. Developers might assume a reasonable system default exists, but in this case, it was unbounded, leading to potential Denial of Service (DoS) via memory exhaustion.
**Prevention:** Always enforce a safe default limit for resource-intensive operations (like file downloads) inside the utility function itself, rather than relying on the caller to provide a limit.

## 2026-02-24 - File Download Path Traversal
**Vulnerability:** File downloads via `downloadAttachment` directly used the unsanitized `attachment.name` from the RingCentral payload when saving to disk, risking path traversal (e.g., `../../../etc/passwd`).
**Learning:** External API payloads containing filenames must never be trusted blindly. The existing `sanitizeFilename` utility was insufficient because it stripped dots entirely, which would destroy valid file extensions. A dedicated file-attachment sanitizer was needed.
**Prevention:** Implement and use `sanitizeAttachmentFilename` for all external media downloads. This function preserves extensions while neutralizing `..` path traversal sequences and replacing invalid path characters. Ensure tests verify these specific attack patterns.

## 2026-03-16 - Outbound File Download Path Traversal / Malicious Filenames
**Vulnerability:** External media URLs downloaded for outgoing attachments used the untrusted `loaded.filename` directly when constructing the `uploadRingCentralAttachment` payload. While this isn't saving to the local disk, passing unsanitized filenames to external APIs can cause path traversal or unexpected behaviors on the receiving end.
**Learning:** We sanitized inbound attachments correctly (from RingCentral -> local disk), but neglected outbound attachments (from external URL -> RingCentral). Both boundaries require sanitization.
**Prevention:** Apply the `sanitizeAttachmentFilename` helper to `loaded.filename` for outbound attachments in `src/channel.ts` and `src/monitor.ts` before passing it to `uploadRingCentralAttachment`.
