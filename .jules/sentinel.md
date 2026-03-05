## 2025-05-20 - Unbounded File Downloads
**Vulnerability:** The `downloadRingCentralAttachment` function defaulted to buffering the entire response into memory (`response.arrayBuffer()`) when the optional `maxBytes` parameter was omitted.
**Learning:** Optional security parameters often lead to insecure defaults. Developers might assume a reasonable system default exists, but in this case, it was unbounded, leading to potential Denial of Service (DoS) via memory exhaustion.
**Prevention:** Always enforce a safe default limit for resource-intensive operations (like file downloads) inside the utility function itself, rather than relying on the caller to provide a limit.

## 2026-02-24 - File Download Path Traversal
**Vulnerability:** File downloads via `downloadAttachment` directly used the unsanitized `attachment.name` from the RingCentral payload when saving to disk, risking path traversal (e.g., `../../../etc/passwd`).
**Learning:** External API payloads containing filenames must never be trusted blindly. The existing `sanitizeFilename` utility was insufficient because it stripped dots entirely, which would destroy valid file extensions. A dedicated file-attachment sanitizer was needed.
**Prevention:** Implement and use `sanitizeAttachmentFilename` for all external media downloads. This function preserves extensions while neutralizing `..` path traversal sequences and replacing invalid path characters. Ensure tests verify these specific attack patterns.

## 2026-03-03 - Outgoing File Download Path Traversal
**Vulnerability:** When downloading an external media URL to attach to a RingCentral outgoing message, the code relied entirely on the potentially malicious `filename` returned by the external fetch. If an attacker controlled the URL and served a file with a `Content-Disposition` containing path traversal characters, passing this unsanitized filename directly to the `uploadRingCentralAttachment` API could pose a risk to the RingCentral server or intermediary systems if they naively use the filename.
**Learning:** We must sanitize not only the filenames of incoming attachments but also the filenames fetched from external resources before they are pushed out to third-party APIs. It's important to never trust external data, regardless of the direction it's flowing.
**Prevention:** Always wrap fetched filenames with `sanitizeAttachmentFilename` before handing them off to `uploadRingCentralAttachment`.
