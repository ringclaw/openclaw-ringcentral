## 2025-05-20 - Unbounded File Downloads
**Vulnerability:** The `downloadRingCentralAttachment` function defaulted to buffering the entire response into memory (`response.arrayBuffer()`) when the optional `maxBytes` parameter was omitted.
**Learning:** Optional security parameters often lead to insecure defaults. Developers might assume a reasonable system default exists, but in this case, it was unbounded, leading to potential Denial of Service (DoS) via memory exhaustion.
**Prevention:** Always enforce a safe default limit for resource-intensive operations (like file downloads) inside the utility function itself, rather than relying on the caller to provide a limit.

## 2026-02-24 - File Download Path Traversal
**Vulnerability:** File downloads via `downloadAttachment` directly used the unsanitized `attachment.name` from the RingCentral payload when saving to disk, risking path traversal (e.g., `../../../etc/passwd`).
**Learning:** External API payloads containing filenames must never be trusted blindly. The existing `sanitizeFilename` utility was insufficient because it stripped dots entirely, which would destroy valid file extensions. A dedicated file-attachment sanitizer was needed.
**Prevention:** Implement and use `sanitizeAttachmentFilename` for all external media downloads. This function preserves extensions while neutralizing `..` path traversal sequences and replacing invalid path characters. Ensure tests verify these specific attack patterns.

## 2026-03-22 - Outgoing Attachment Filename Traversal
**Vulnerability:** When uploading external media as RingCentral attachments via `uploadRingCentralAttachment`, the `loaded.filename` fetched from remote media was passed directly without sanitization, risking path traversal or malicious file naming on the remote end or local processing.
**Learning:** It's not just incoming attachments that need sanitization. Filenames fetched from *any* external source (like `fetchRemoteMedia`) must be treated as untrusted input before being sent to APIs like RingCentral's upload endpoint.
**Prevention:** Apply the existing `sanitizeAttachmentFilename` utility to all filenames fetched from external media before using them in outgoing API calls (e.g., `uploadRingCentralAttachment`). Always sanitize at the boundary where untrusted input is passed to an action.
