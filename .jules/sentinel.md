## 2025-03-03 - Path Traversal in Attachment Downloads
**Vulnerability:** The `downloadAttachment` function in `src/monitor.ts` passes the raw `attachment.name` directly to `core.channel.media.saveMediaBuffer` without sanitization, allowing potential path traversal if the filename contains `../` sequences.
**Learning:** External attachment filenames should never be trusted as safe file system names. They can be spoofed by attackers.
**Prevention:** Implemented and applied a `sanitizeAttachmentFilename` function that explicitly removes `..` sequences and restricts characters to an allowlist (alphanumeric, dash, underscore, and dot).
