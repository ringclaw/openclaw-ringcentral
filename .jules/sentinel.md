## 2025-05-20 - Unbounded File Downloads
**Vulnerability:** The `downloadRingCentralAttachment` function defaulted to buffering the entire response into memory (`response.arrayBuffer()`) when the optional `maxBytes` parameter was omitted.
**Learning:** Optional security parameters often lead to insecure defaults. Developers might assume a reasonable system default exists, but in this case, it was unbounded, leading to potential Denial of Service (DoS) via memory exhaustion.
**Prevention:** Always enforce a safe default limit for resource-intensive operations (like file downloads) inside the utility function itself, rather than relying on the caller to provide a limit.

## 2026-02-24 - File Download Path Traversal
**Vulnerability:** File downloads via `downloadAttachment` directly used the unsanitized `attachment.name` from the RingCentral payload when saving to disk, risking path traversal (e.g., `../../../etc/passwd`).
**Learning:** External API payloads containing filenames must never be trusted blindly. The existing `sanitizeFilename` utility was insufficient because it stripped dots entirely, which would destroy valid file extensions. A dedicated file-attachment sanitizer was needed.
**Prevention:** Implement and use `sanitizeAttachmentFilename` for all external media downloads. This function preserves extensions while neutralizing `..` path traversal sequences and replacing invalid path characters. Ensure tests verify these specific attack patterns.
## 2025-02-23 - Path Traversal Risk in Outgoing Media Filenames
**Vulnerability:** External media filenames fetched via `fetchRemoteMedia` for outgoing attachments (`loaded.filename`) were passed directly into `uploadRingCentralAttachment` without sanitization, creating a potential path traversal vulnerability.
**Learning:** Even though `uploadRingCentralAttachment` might handle the filename correctly internally, defense-in-depth requires that any boundary accepting external file paths or names must explicitly sanitize them to prevent malicious naming or traversal (`../../etc/passwd`).
**Prevention:** Always wrap external or untrusted filenames with `sanitizeAttachmentFilename` (or an equivalent sanitization utility) before passing them to internal upload, download, or save routines.
