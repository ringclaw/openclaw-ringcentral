## 2025-05-20 - Unbounded File Downloads
**Vulnerability:** The `downloadRingCentralAttachment` function defaulted to buffering the entire response into memory (`response.arrayBuffer()`) when the optional `maxBytes` parameter was omitted.
**Learning:** Optional security parameters often lead to insecure defaults. Developers might assume a reasonable system default exists, but in this case, it was unbounded, leading to potential Denial of Service (DoS) via memory exhaustion.
**Prevention:** Always enforce a safe default limit for resource-intensive operations (like file downloads) inside the utility function itself, rather than relying on the caller to provide a limit.

## 2026-02-24 - File Download Path Traversal
**Vulnerability:** File downloads via `downloadAttachment` directly used the unsanitized `attachment.name` from the RingCentral payload when saving to disk, risking path traversal (e.g., `../../../etc/passwd`).
**Learning:** External API payloads containing filenames must never be trusted blindly. The existing `sanitizeFilename` utility was insufficient because it stripped dots entirely, which would destroy valid file extensions. A dedicated file-attachment sanitizer was needed.
**Prevention:** Implement and use `sanitizeAttachmentFilename` for all external media downloads. This function preserves extensions while neutralizing `..` path traversal sequences and replacing invalid path characters. Ensure tests verify these specific attack patterns.

## 2026-03-08 - File Upload Path Traversal
**Vulnerability:** External media filenames (`loaded.filename`) fetched for outgoing attachments were explicitly passed to `uploadRingCentralAttachment` without sanitization, trusting the original external filename.
**Learning:** Similarly to downloads, filenames of external origin for uploads must be sanitized to prevent malicious file naming or path traversal on the system where the upload is eventually saved.
**Prevention:** Always use `sanitizeAttachmentFilename` to sanitize `loaded.filename` before passing it to internal upload utilities.
